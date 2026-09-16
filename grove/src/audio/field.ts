import {
  AUDIO_BUDGET, DEFAULT_HYSTERESIS, selectSources,
  type AudioBudget, type SourceCandidate, type SourceKind,
} from "./sources";
import type { PlacedNode } from "./topology";
import type { DeviceTier } from "../tape/bundle";

// The audio field of a live exhibit (AUDIO-STREAM.md §5): one Web Audio graph
// holding the non-positioned bed, a listener that follows the visitor's head,
// and a positioned source per node the tier's budget can afford.
//
//     bed (the provider's stream) ----------------------> master -> destination
//     voice(node) -> gain -> panner | stereoPanner -----/
//
// WHAT A POSITIONED SOURCE PLAYS IS NOT DECIDED HERE, and deliberately not
// invented here. AUDIO-STREAM.md §4 makes sonification the provider's, and
// says it is deterministic and seeded so that an archived bundle's hash means
// what a listener heard. A timbre invented in the client would be a second,
// unhashed sonification of the same run. So the field positions whatever
// voices its caller supplies (`VoiceFactory`) and ships none: with no factory
// it is the bed alone, which is exactly what the room does today, now routed
// through one graph with a listener on it.
//
// The tier's budget is enforced here and the ladder is in `sources.ts`.

/** One node's sound, whatever produces it. The field owns only where it is heard. */
export interface NodeVoice {
  /** What the field connects to the node's panner. */
  readonly output: AudioNode;
  dispose(): void;
}

/** Builds the voice for one node; returns null when the provider has no audio for it. */
export type VoiceFactory = (context: BaseAudioContext, node: PlacedNode) => NodeVoice | null;

export interface AudioFieldOptions {
  tier: DeviceTier;
  /** Every published node, already placed in room metres (`topology.ts`). */
  nodes: readonly PlacedNode[];
  /** An existing context to join; the field makes its own when absent. */
  context?: AudioContext;
  /** Overrides the tier's budget. For tests and for the §7 item 2 measurement. */
  budget?: AudioBudget;
  voice?: VoiceFactory;
  hysteresis?: number;
  onNotice?: (message: string) => void;
}

interface FieldSource {
  node: PlacedNode;
  kind: SourceKind;
  voice: NodeVoice | null;
  gain: GainNode;
  panner: PannerNode | null;
  stereo: StereoPannerNode | null;
}

/** Room metres per second of sound travel; only the ordering of arrivals matters, not realism. */
const REFERENCE_DISTANCE = 1;
const MAX_DISTANCE = 60;

export class AudioField {
  readonly context: AudioContext;
  readonly master: GainNode;
  /** The non-positioned bed: the provider's stream, and every node past the budget. */
  readonly bed: GainNode;

  readonly #ownsContext: boolean;
  readonly #budget: AudioBudget;
  readonly #hysteresis: number;
  readonly #voice: VoiceFactory | undefined;
  readonly #onNotice: ((message: string) => void) | undefined;
  readonly #sources = new Map<string, FieldSource>();
  readonly #nodes: PlacedNode[];
  #assignment = new Map<string, SourceKind>();
  #listener: [number, number, number] = [0, 0, 0];
  #forward: [number, number, number] = [0, 0, -1];
  #up: [number, number, number] = [0, 1, 0];
  #disposed = false;

  constructor(options: AudioFieldOptions) {
    this.#ownsContext = options.context === undefined;
    this.context = options.context ?? new AudioContext();
    this.#budget = options.budget ?? AUDIO_BUDGET[options.tier];
    this.#hysteresis = options.hysteresis ?? DEFAULT_HYSTERESIS;
    this.#voice = options.voice;
    this.#onNotice = options.onNotice;
    this.#nodes = [...options.nodes];

    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
    this.bed = this.context.createGain();
    this.bed.connect(this.master);
  }

  get budget(): AudioBudget {
    return this.#budget;
  }

  /** What each node is right now: its rung, or `bed`. */
  get assignment(): ReadonlyMap<string, SourceKind> {
    return this.#assignment;
  }

  /**
   * Route a live exhibit's `<audio>` element into the bed. The element is the
   * one `ExhibitStream` owns; once it feeds a MediaElementSource its sound
   * reaches the speakers only through this graph, so the field's master gain
   * is what a room control moves.
   */
  connectBed(element: HTMLMediaElement): MediaElementAudioSourceNode {
    const source = this.context.createMediaElementSource(element);
    source.connect(this.bed);
    return source;
  }

  /**
   * Where the visitor's head is and which way it faces, in room metres. Called
   * from the frame loop; cheap enough to call every frame, and the listener
   * is what makes a positioned source mean anything.
   */
  setListener(
    position: readonly [number, number, number],
    forward: readonly [number, number, number],
    up: readonly [number, number, number] = [0, 1, 0],
  ): void {
    if (this.#disposed) return;
    this.#listener = [position[0], position[1], position[2]];
    this.#forward = [forward[0], forward[1], forward[2]];
    this.#up = [up[0], up[1], up[2]];
    const listener = this.context.listener;
    // The AudioParam form is the current one; the setters are deprecated but
    // are still all Safari and older Chromium expose.
    if (listener.positionX) {
      const when = this.context.currentTime;
      listener.positionX.setValueAtTime(position[0], when);
      listener.positionY.setValueAtTime(position[1], when);
      listener.positionZ.setValueAtTime(position[2], when);
      listener.forwardX.setValueAtTime(forward[0], when);
      listener.forwardY.setValueAtTime(forward[1], when);
      listener.forwardZ.setValueAtTime(forward[2], when);
      listener.upX.setValueAtTime(up[0], when);
      listener.upY.setValueAtTime(up[1], when);
      listener.upZ.setValueAtTime(up[2], when);
    } else {
      const legacy = listener as unknown as {
        setPosition?: (x: number, y: number, z: number) => void;
        setOrientation?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
      };
      legacy.setPosition?.(position[0], position[1], position[2]);
      legacy.setOrientation?.(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
    }
  }

  /**
   * Re-rank the nodes against the listener and move any node whose rung
   * changed. Call at a low rate (a few times a second), not per frame: the
   * ranking only changes when the visitor moves, and rebuilding a panner is
   * not free.
   */
  reassign(): ReadonlyMap<string, SourceKind> {
    if (this.#disposed) return this.#assignment;
    const candidates: SourceCandidate[] = this.#nodes.map((node) => ({
      id: node.id,
      distance: distance(node.position, this.#listener),
    }));
    const next = selectSources(candidates, this.#budget, this.#assignment, this.#hysteresis);
    for (const node of this.#nodes) {
      const kind = next.get(node.id) ?? "bed";
      if (this.#assignment.get(node.id) === kind && this.#sources.has(node.id) === (kind !== "bed")) continue;
      this.#retire(node.id);
      if (kind !== "bed") this.#build(node, kind);
    }
    this.#assignment = next;
    // The cheap rung has no listener of its own: a StereoPanner knows nothing
    // about where the head is, so its pan is recomputed here, where the head
    // is known to have moved. A PannerNode needs none of this -- the graph's
    // listener already moved it.
    for (const source of this.#sources.values()) {
      if (!source.stereo) continue;
      source.stereo.pan.setValueAtTime(
        azimuthPan(source.node.position, this.#listener, this.#forward, this.#up),
        this.context.currentTime,
      );
    }
    return next;
  }

  #build(node: PlacedNode, kind: SourceKind): void {
    const voice = this.#voice?.(this.context, node) ?? null;
    const gain = this.context.createGain();
    let panner: PannerNode | null = null;
    let stereo: StereoPannerNode | null = null;
    if (kind === "hrtf" || kind === "panner") {
      panner = this.context.createPanner();
      panner.panningModel = kind === "hrtf" ? "HRTF" : "equalpower";
      panner.distanceModel = "inverse";
      panner.refDistance = REFERENCE_DISTANCE;
      panner.maxDistance = MAX_DISTANCE;
      if (panner.positionX) {
        const when = this.context.currentTime;
        panner.positionX.setValueAtTime(node.position[0], when);
        panner.positionY.setValueAtTime(node.position[1], when);
        panner.positionZ.setValueAtTime(node.position[2], when);
      } else {
        (panner as unknown as { setPosition?: (x: number, y: number, z: number) => void })
          .setPosition?.(node.position[0], node.position[1], node.position[2]);
      }
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      // The cheap rung: left-to-right on the listener-relative azimuth, no
      // distance model and no elevation. Set once here and refreshed by
      // `reassign`, which is also when the azimuth can have changed.
      stereo = this.context.createStereoPanner();
      stereo.pan.value = azimuthPan(node.position, this.#listener, this.#forward, this.#up);
      gain.connect(stereo);
      stereo.connect(this.master);
    }
    if (voice) voice.output.connect(gain);
    this.#sources.set(node.id, { node, kind, voice, gain, panner, stereo });
  }

  #retire(id: string): void {
    const source = this.#sources.get(id);
    if (!source) return;
    source.voice?.dispose();
    source.gain.disconnect();
    source.panner?.disconnect();
    source.stereo?.disconnect();
    this.#sources.delete(id);
  }

  /** The master gain a room control moves; 0 is silence, not a stopped stream. */
  setVolume(value: number): void {
    if (this.#disposed) return;
    this.master.gain.setValueAtTime(Math.max(0, value), this.context.currentTime);
  }

  /**
   * A context created before a gesture starts suspended; the room's unmute
   * control is what resumes it, the same discipline `media/videowall.ts` uses
   * for autoplay.
   */
  async resume(): Promise<void> {
    if (this.#disposed) return;
    try {
      await this.context.resume();
    } catch (error) {
      this.#onNotice?.(`audio field could not start: ${message(error)}`);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const id of [...this.#sources.keys()]) this.#retire(id);
    this.bed.disconnect();
    this.master.disconnect();
    // A context handed in belongs to the caller; only one we made is ours to close.
    if (this.#ownsContext) void this.context.close().catch(() => undefined);
  }
}

function distance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Left-to-right placement for the cheap rung. The node's direction is taken
 * in the LISTENER's frame, not the room's: it is how far the node lies along
 * the listener's right hand, -1 hard left through 0 straight ahead to +1 hard
 * right, so turning around swaps the sides the way it must. Height is
 * dropped; this rung has none.
 *
 * The listener's right hand is forward x up. In the right-handed space
 * three.js and Web Audio share, a default forward of -z with up of +y gives
 * +x, which is where the right hand belongs.
 */
export function azimuthPan(
  node: readonly [number, number, number],
  listener: readonly [number, number, number],
  forward: readonly [number, number, number] = [0, 0, -1],
  up: readonly [number, number, number] = [0, 1, 0],
): number {
  const dx = node[0] - listener[0];
  const dy = node[1] - listener[1];
  const dz = node[2] - listener[2];
  const length = Math.hypot(dx, dy, dz);
  if (length === 0) return 0;
  const right: [number, number, number] = [
    forward[1] * up[2] - forward[2] * up[1],
    forward[2] * up[0] - forward[0] * up[2],
    forward[0] * up[1] - forward[1] * up[0],
  ];
  const rightLength = Math.hypot(right[0], right[1], right[2]);
  // A forward that is parallel to up has no right hand; ahead is the honest answer.
  if (rightLength === 0) return 0;
  const pan = (dx * right[0] + dy * right[1] + dz * right[2]) / (length * rightLength);
  return Math.max(-1, Math.min(1, pan));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
