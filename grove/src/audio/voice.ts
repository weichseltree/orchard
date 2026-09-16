import type { NodeVoice, VoiceFactory } from "./field";
import type { ScoreFollower, NodeState } from "./score-live";
import type { PlacedNode } from "./topology";

// A positioned node's voice, made in the browser from the live score (#14,
// ruled 2026-09-16: client-synthesised voices per node).
//
// This overturns what AUDIO-STREAM §4 said about positioned sound: it is no
// longer the provider's seeded Opus, so an archived bundle's hash does not
// cover it. What keeps it honest instead is that it is a PURE FUNCTION of the
// score and a versioned synth: `voiceParams(state, nodeId)` under
// `SYNTH_VERSION` gives the same sound for the same frame on every visitor's
// machine, so what someone heard is reproducible from the archived score plus
// that version string. Change the mapping and the version changes with it.
//
// The mapping, and why each part:
// - Pitch is the node's IDENTITY, not its state: a stable degree of a
//   pentatonic scale chosen by hashing the node id. A node you walked up to
//   yesterday sounds like itself today, and any set of nodes is consonant.
// - Loudness is activity (`rate`, log-scaled). An idle node is SILENT, not
//   quiet (LAWS 17: an idle system should sound idle).
// - Brightness is variety (`template_entropy`): the same log line over and
//   over is dull, many kinds of line are bright.
// - Tremolo is burstiness: steady traffic is a steady tone, bursts flutter.
// - Health flattens and darkens: a sick node sags below its own pitch.
// - An anomaly (|z| >= 3) agitates the tremolo, so it is heard without
//   anything having to be read.
// - Fan-out picks the waveform: one listener is a sine, a hub is richer.

export const SYNTH_VERSION = "orchard/synth/1";

export interface VoiceParams {
  frequency: number;
  detuneCents: number;
  gain: number;
  cutoffHz: number;
  tremoloHz: number;
  tremoloDepth: number;
  waveform: OscillatorType;
}

/** Semitones above the root: two octaves of a major pentatonic scale. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21] as const;
const ROOT_HZ = 220;
/** Below this many events a second a node is idle, and idle is silent. */
export const RATE_IDLE = 0.05;
/** The rate at which a node reaches full loudness; above it, it stays there. */
const RATE_LOUD = 50;
/**
 * One voice's ceiling. Sixteen positioned voices on a Quest at this level sum
 * to under 3 before panning spreads them, and the field's master gain and the
 * browser's limiter take the rest.
 */
const VOICE_MAX_GAIN = 0.16;
export const ANOMALY_Z = 3;

/** FNV-1a, 32 bit: the same node id gives the same pitch in every browser. */
export function nodeHash(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export function voiceParams(state: NodeState | null, nodeId: string): VoiceParams {
  const degree = SCALE[nodeHash(nodeId) % SCALE.length]!;
  const frequency = ROOT_HZ * 2 ** (degree / 12);
  if (!state || !(state.rate > RATE_IDLE)) {
    return { frequency, detuneCents: 0, gain: 0, cutoffHz: 800, tremoloHz: 0, tremoloDepth: 0, waveform: "sine" };
  }
  const health = clamp01(state.health);
  const loud = clamp01(Math.log1p(state.rate) / Math.log1p(RATE_LOUD));
  const anomalous = Math.abs(state.anomaly_z) >= ANOMALY_Z;
  const brightness = clamp01(state.template_entropy / 4);
  // Burstiness is the Goh-Barabasi coefficient, -1 (regular) .. 1 (bursty).
  const flutter = clamp01((state.burstiness + 1) / 2);
  return {
    frequency,
    detuneCents: -(1 - health) * 60,
    gain: VOICE_MAX_GAIN * loud * (anomalous ? 1 : 0.8),
    cutoffHz: (400 + brightness * 3600) * (0.5 + 0.5 * health),
    tremoloHz: anomalous ? 11 : 2 + 5 * flutter,
    tremoloDepth: anomalous ? 0.7 : flutter * 0.6,
    waveform: state.fan_out >= 8 ? "sawtooth" : state.fan_out >= 3 ? "triangle" : "sine",
  };
}

/**
 * How fast a voice follows the score. The score moves at 10 Hz; a time
 * constant of 80 ms reaches ~70% of a change inside one frame without
 * stepping, which is the difference between a voice and a click track.
 */
const SMOOTH_S = 0.08;

/** One node's synthesiser. A handful of nodes, no allocation per update. */
export class SynthVoice implements NodeVoice {
  readonly output: GainNode;
  #context: BaseAudioContext;
  #osc: OscillatorNode;
  #filter: BiquadFilterNode;
  #amp: GainNode;
  #lfo: OscillatorNode;
  #depth: GainNode;
  #waveform: OscillatorType = "sine";

  constructor(context: BaseAudioContext, params: VoiceParams) {
    this.#context = context;
    this.#osc = context.createOscillator();
    this.#filter = context.createBiquadFilter();
    this.#filter.type = "lowpass";
    this.#amp = context.createGain();
    this.output = context.createGain();
    this.#lfo = context.createOscillator();
    this.#depth = context.createGain();
    // osc -> filter -> amp -> output, with the LFO swinging output.gain around
    // its resting level: tremolo without a second full signal path.
    this.#osc.connect(this.#filter);
    this.#filter.connect(this.#amp);
    this.#amp.connect(this.output);
    this.#lfo.connect(this.#depth);
    this.#depth.connect(this.output.gain);
    this.#amp.gain.value = 0;
    this.update(params, true);
    this.#osc.start();
    this.#lfo.start();
  }

  update(params: VoiceParams, immediate = false): void {
    const t = this.#context.currentTime;
    const set = (param: AudioParam, value: number) => {
      if (immediate) param.setValueAtTime(value, t);
      else param.setTargetAtTime(value, t, SMOOTH_S);
    };
    if (params.waveform !== this.#waveform) {
      this.#osc.type = params.waveform;
      this.#waveform = params.waveform;
    }
    set(this.#osc.frequency, params.frequency);
    set(this.#osc.detune, params.detuneCents);
    set(this.#filter.frequency, params.cutoffHz);
    set(this.#amp.gain, params.gain);
    set(this.#lfo.frequency, Math.max(0.01, params.tremoloHz));
    set(this.output.gain, 1 - params.tremoloDepth / 2);
    set(this.#depth.gain, params.tremoloDepth / 2);
  }

  dispose(): void {
    try {
      this.#osc.stop();
      this.#lfo.stop();
    } catch {
      // Already stopped.
    }
    this.output.disconnect();
    this.#amp.disconnect();
    this.#filter.disconnect();
    this.#osc.disconnect();
    this.#lfo.disconnect();
    this.#depth.disconnect();
  }
}

/**
 * The factory the field calls when a node becomes positioned, plus the tick
 * that keeps every live voice on the score.
 *
 * Voices exist only for nodes the tier's budget has positioned (`field.ts`
 * builds and retires them), so a Quest runs sixteen of these, not the whole
 * topology.
 */
export function scoreVoices(follower: ScoreFollower, now: () => number = () => performance.now()): {
  factory: VoiceFactory;
  tick(): void;
  readonly count: number;
} {
  const live = new Map<string, { voice: SynthVoice; node: PlacedNode }>();
  let seenVersion = -1;
  let wasStale = true;
  return {
    factory: (context, node) => {
      const voice = new SynthVoice(context, voiceParams(follower.state(node.id, now()), node.id));
      const entry = { voice, node };
      live.set(node.id, entry);
      const dispose = voice.dispose.bind(voice);
      voice.dispose = () => {
        if (live.get(node.id) === entry) live.delete(node.id);
        dispose();
      };
      return voice;
    },
    tick: () => {
      const at = now();
      const stale = follower.stale(at);
      // Only when something changed: a newer frame, or the feed going quiet.
      if (follower.version === seenVersion && stale === wasStale) return;
      seenVersion = follower.version;
      wasStale = stale;
      for (const { voice, node } of live.values()) voice.update(voiceParams(follower.state(node.id, at), node.id));
    },
    get count() {
      return live.size;
    },
  };
}
