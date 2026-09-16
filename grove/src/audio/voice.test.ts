import { describe, expect, it } from "vitest";
import { ScoreFollower, SCORE_SCHEMA, type NodeState } from "./score-live";
import { ANOMALY_Z, RATE_IDLE, SYNTH_VERSION, nodeHash, scoreVoices, voiceParams } from "./voice";

const calm: NodeState = { rate: 5, burstiness: -0.5, template_entropy: 2, fan_out: 1, anomaly_z: 0, health: 1 };

describe("voiceParams", () => {
  it("is a pure function: the same frame sounds the same on every machine", () => {
    // What keeps client synthesis honest now that the hash no longer covers it.
    expect(voiceParams(calm, "api")).toEqual(voiceParams({ ...calm }, "api"));
    expect(SYNTH_VERSION).toBe("orchard/synth/1");
  });

  it("gives a node its pitch from its identity, not its state", () => {
    const a = voiceParams(calm, "api").frequency;
    expect(voiceParams({ ...calm, rate: 40, health: 0.2 }, "api").frequency).toBe(a);
  });

  it("keeps pitches on the scale, so any set of nodes is consonant", () => {
    const allowed = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21].map((s) => 220 * 2 ** (s / 12));
    for (const id of ["api", "db", "worker-1", "worker-2", "cache", "queue", "auth", "ingest"]) {
      expect(allowed.some((f) => Math.abs(f - voiceParams(calm, id).frequency) < 1e-9)).toBe(true);
    }
  });

  it("makes an idle node silent, not quiet", () => {
    expect(voiceParams({ ...calm, rate: RATE_IDLE }, "api").gain).toBe(0);
    expect(voiceParams({ ...calm, rate: 0 }, "api").gain).toBe(0);
    expect(voiceParams(null, "api").gain).toBe(0);
  });

  it("gets louder with activity, and stops getting louder at the ceiling", () => {
    const quiet = voiceParams({ ...calm, rate: 1 }, "api").gain;
    const busy = voiceParams({ ...calm, rate: 20 }, "api").gain;
    const flooded = voiceParams({ ...calm, rate: 10_000 }, "api").gain;
    expect(busy).toBeGreaterThan(quiet);
    expect(flooded).toBe(voiceParams({ ...calm, rate: 50 }, "api").gain);
    expect(flooded).toBeLessThanOrEqual(0.16);
  });

  it("sags a sick node below its own pitch and darkens it", () => {
    const well = voiceParams(calm, "api");
    const sick = voiceParams({ ...calm, health: 0 }, "api");
    expect(sick.detuneCents).toBeLessThan(well.detuneCents);
    expect(sick.cutoffHz).toBeLessThan(well.cutoffHz);
  });

  it("agitates an anomaly so it is heard without being read", () => {
    const normal = voiceParams(calm, "api");
    const odd = voiceParams({ ...calm, anomaly_z: -ANOMALY_Z }, "api");
    expect(odd.tremoloHz).toBeGreaterThan(normal.tremoloHz);
    expect(odd.tremoloDepth).toBeGreaterThan(normal.tremoloDepth);
  });

  it("flutters bursty traffic and holds steady traffic still", () => {
    expect(voiceParams({ ...calm, burstiness: 1 }, "api").tremoloDepth).toBeGreaterThan(voiceParams({ ...calm, burstiness: -1 }, "api").tremoloDepth);
  });

  it("richens the waveform with fan-out", () => {
    expect(voiceParams({ ...calm, fan_out: 1 }, "api").waveform).toBe("sine");
    expect(voiceParams({ ...calm, fan_out: 4 }, "api").waveform).toBe("triangle");
    expect(voiceParams({ ...calm, fan_out: 12 }, "api").waveform).toBe("sawtooth");
  });

  it("never produces a number an AudioParam would reject", () => {
    const wild: NodeState = { rate: 1e12, burstiness: 50, template_entropy: -3, fan_out: -1, anomaly_z: 1e9, health: 7 };
    for (const value of Object.values(voiceParams(wild, "api"))) {
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("hashes ids the same way every time", () => {
    expect(nodeHash("api")).toBe(nodeHash("api"));
    expect(nodeHash("api")).not.toBe(nodeHash("apj"));
  });
});

/** Just enough of an AudioContext to count what a voice is told. */
function fakeContext() {
  const updates: string[] = [];
  const param = (name: string) => ({
    value: 0,
    setValueAtTime: () => updates.push(`${name}:set`),
    setTargetAtTime: () => updates.push(`${name}:target`),
  });
  const node = (name: string, extra: Record<string, unknown> = {}) => ({
    connect: () => undefined, disconnect: () => undefined, start: () => undefined, stop: () => undefined,
    ...extra, name,
  });
  const context = {
    currentTime: 0,
    createOscillator: () => node("osc", { type: "sine", frequency: param("freq"), detune: param("detune") }),
    createBiquadFilter: () => node("filter", { type: "lowpass", frequency: param("cutoff") }),
    createGain: () => node("gain", { gain: param("gain") }),
  };
  return { context: context as unknown as BaseAudioContext, updates };
}

function scoreDoc(index: number, nodes: Record<string, NodeState>) {
  return { schema: SCORE_SCHEMA, rate_hz: 10, frames: [{ index, t: index / 10, nodes }] };
}

describe("scoreVoices", () => {
  const node = { id: "api", label: "api", position: [0, 0, 0] as [number, number, number] };

  it("updates live voices only when a newer frame arrives", () => {
    let now = 0;
    const follower = new ScoreFollower();
    follower.ingest(scoreDoc(1, { api: calm }), now);
    const voices = scoreVoices(follower, () => now);
    const { context, updates } = fakeContext();
    voices.factory(context, node);
    voices.tick();
    const afterFirst = updates.length;
    voices.tick();
    expect(updates.length).toBe(afterFirst);
    now = 100;
    follower.ingest(scoreDoc(2, { api: { ...calm, rate: 30 } }), now);
    voices.tick();
    expect(updates.length).toBeGreaterThan(afterFirst);
  });

  it("updates once more when the feed goes stale, so the room falls silent", () => {
    let now = 0;
    const follower = new ScoreFollower();
    follower.ingest(scoreDoc(1, { api: calm }), now);
    const voices = scoreVoices(follower, () => now);
    const { context, updates } = fakeContext();
    voices.factory(context, node);
    voices.tick();
    const before = updates.length;
    now = 10_000;
    voices.tick();
    expect(updates.length).toBeGreaterThan(before);
  });

  it("forgets a voice the field retires", () => {
    const follower = new ScoreFollower();
    const voices = scoreVoices(follower, () => 0);
    const voice = voices.factory(fakeContext().context, node)!;
    expect(voices.count).toBe(1);
    voice.dispose();
    expect(voices.count).toBe(0);
  });
});
