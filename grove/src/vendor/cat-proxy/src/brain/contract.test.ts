import { describe, expect, it } from "vitest";
import { CLIP_POSTURE } from "../contract";
import { defaultParams } from "./params";
import { simulate, type SimEvent } from "./simulate";

// Exercise as many behaviours as possible: food, a toy, a player who comes near and pets, and a
// loud noise, spread across a run long enough for several episodes of each.
const events: SimEvent[] = [
  { t: 30, event: { kind: "food-offered", at: { x: -1.2, z: 0.8 } } },
  { t: 90, event: { kind: "toy-moved", at: { x: 1.5, z: -1.5 } } },
  { t: 150, event: { kind: "player-near", at: { x: 0.2, z: 0.2 } } },
  { t: 155, event: { kind: "hand-offered", at: { x: 0.1, z: 0.1 } } },
  { t: 160, event: { kind: "petted" } },
  { t: 165, event: { kind: "petted" } },
  { t: 240, event: { kind: "loud-noise", at: { x: 0.3, z: 0.3 } } },
  { t: 300, event: { kind: "player-far" } },
];

describe("commands respect the contract", () => {
  it("never sends moveTo except with walk or trot", () => {
    // Whether the cat ever gets hungry enough to eat within 600s is legitimate variation (with
    // the body's real gait speeds, a satisfied cat can just never need the bowl) — so this checks
    // the invariant across seeds without assuming eat happens at all; the eat-specific shape is
    // its own test below, made deterministic instead of hoping a seed produces it.
    for (let seed = 1; seed <= 5; seed++) {
      const timeline = simulate(defaultParams, seed, 600, events, 0.25);
      for (const e of timeline) {
        if (e.moveTo !== undefined) {
          expect(["walk", "trot"]).toContain(e.clip);
        }
      }
    }
  });

  it("eat is only ever issued once arrived, never together with moveTo", () => {
    // High initial hunger makes eating happen deterministically, instead of depending on a seed
    // happening to let hunger drift up on its own.
    const hungryParams = {
      ...defaultParams,
      initialDrives: { ...defaultParams.initialDrives, hunger: 0.9 },
    };
    for (let seed = 1; seed <= 5; seed++) {
      const timeline = simulate(hungryParams, seed, 600, events, 0.25);
      expect(timeline.some((e) => e.clip === "eat" && e.moveTo === undefined)).toBe(true);
      expect(timeline.every((e) => !(e.clip === "eat" && e.moveTo !== undefined))).toBe(true);
    }
  });

  it("every emitted clip is a real clip the contract knows about", () => {
    const timeline = simulate(defaultParams, 9, 300, events, 0.25);
    for (const e of timeline) {
      expect(CLIP_POSTURE[e.clip]).toBeDefined();
    }
  });

  it("lookAt is always a point or null, never undefined", () => {
    const timeline = simulate(defaultParams, 9, 300, events, 0.25);
    for (const e of timeline) {
      expect(
        e.lookAt === null || (typeof e.lookAt.x === "number" && typeof e.lookAt.z === "number"),
      ).toBe(true);
    }
  });
});
