import { describe, expect, it } from "vitest";
import { defaultParams } from "./params";
import { simulate, type SimEvent } from "./simulate";

describe("determinism", () => {
  const events: SimEvent[] = [
    { t: 20, event: { kind: "toy-moved", at: { x: 1.2, z: -0.8 } } },
    { t: 60, event: { kind: "player-near", at: { x: 0.5, z: 0.2 } } },
    { t: 90, event: { kind: "petted" } },
  ];

  it("replays bit-for-bit from the same seed and event schedule", () => {
    const a = simulate(defaultParams, 42, 300, events, 0.5);
    const b = simulate(defaultParams, 42, 300, events, 0.5);
    expect(a).toEqual(b);
  });

  it("actually uses the injected RNG (different seeds diverge)", () => {
    const a = simulate(defaultParams, 1, 300, events, 0.5);
    const b = simulate(defaultParams, 2, 300, events, 0.5);
    const behavioursA = a.map((e) => e.behaviour).join(",");
    const behavioursB = b.map((e) => e.behaviour).join(",");
    expect(behavioursA).not.toEqual(behavioursB);
  });
});
