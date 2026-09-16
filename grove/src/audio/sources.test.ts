import { describe, expect, it } from "vitest";
import {
  AUDIO_BUDGET, DEFAULT_HYSTERESIS, positionedCount, selectSources,
  type AudioBudget, type SourceCandidate, type SourceKind,
} from "./sources";

const budget: AudioBudget = { positioned: 5, panners: 3, hrtf: 1 };

function at(...distances: number[]): SourceCandidate[] {
  return distances.map((distance, index) => ({ id: `n${index}`, distance }));
}

describe("AUDIO_BUDGET", () => {
  it("carries a row for every device tier", () => {
    expect(Object.keys(AUDIO_BUDGET).sort()).toEqual(["desktop", "phone", "vr-high", "vr-quest"]);
  });

  it("gives vr-quest no HRTF: Quest 2 and Pico 4 are in the tier and have none", () => {
    expect(AUDIO_BUDGET["vr-quest"].hrtf).toBe(0);
    expect(AUDIO_BUDGET["vr-quest"].positioned).toBe(16);
    expect(AUDIO_BUDGET["vr-quest"].panners).toBe(6);
  });

  it("never budgets more panners than positioned sources, or more HRTF than panners", () => {
    for (const [tier, row] of Object.entries(AUDIO_BUDGET)) {
      expect(row.hrtf, tier).toBeLessThanOrEqual(row.panners);
      expect(row.panners, tier).toBeLessThanOrEqual(row.positioned);
    }
  });
});

describe("selectSources", () => {
  it("fills the rungs nearest first and folds the rest into the bed", () => {
    const got = selectSources(at(1, 2, 3, 4, 5, 6, 7), budget);
    expect(got.get("n0")).toBe("hrtf");
    expect(got.get("n1")).toBe("panner");
    expect(got.get("n2")).toBe("panner");
    expect(got.get("n3")).toBe("stereo");
    expect(got.get("n4")).toBe("stereo");
    expect(got.get("n5")).toBe("bed");
    expect(got.get("n6")).toBe("bed");
  });

  it("never positions more than the budget allows", () => {
    const got = selectSources(at(...Array.from({ length: 40 }, (_, i) => i + 1)), AUDIO_BUDGET["vr-quest"]);
    expect(positionedCount(got)).toBe(16);
    const kinds = [...got.values()];
    expect(kinds.filter((k) => k === "hrtf")).toHaveLength(0);
    expect(kinds.filter((k) => k === "panner")).toHaveLength(6);
    expect(kinds.filter((k) => k === "stereo")).toHaveLength(10);
  });

  it("gives every node a bed rung when the budget is nothing", () => {
    const got = selectSources(at(1, 2, 3), { positioned: 0, panners: 0, hrtf: 0 });
    expect([...got.values()]).toEqual(["bed", "bed", "bed"]);
  });

  it("clamps a budget whose rungs contradict each other", () => {
    // More HRTF than panners, more panners than positioned: the rungs nest.
    const got = selectSources(at(1, 2, 3, 4), { positioned: 2, panners: 9, hrtf: 9 });
    expect(positionedCount(got)).toBe(2);
    expect([...got.values()].filter((k) => k === "hrtf")).toHaveLength(2);
  });

  it("breaks ties on id, so the same inputs give the same assignment", () => {
    const tied: SourceCandidate[] = [
      { id: "zulu", distance: 4 },
      { id: "alpha", distance: 4 },
      { id: "mike", distance: 4 },
    ];
    const once = selectSources(tied, { positioned: 1, panners: 1, hrtf: 1 });
    expect(once.get("alpha")).toBe("hrtf");
    expect(selectSources([...tied].reverse(), { positioned: 1, panners: 1, hrtf: 1 })).toEqual(once);
  });

  describe("hysteresis", () => {
    const small: AudioBudget = { positioned: 1, panners: 1, hrtf: 0 };

    it("keeps an incumbent against a marginally nearer challenger", () => {
      const previous = new Map<string, SourceKind>([["n0", "panner"]]);
      // n1 is nearer, but only by 10% -- inside the 25% margin.
      const got = selectSources(at(10, 9), small, previous);
      expect(got.get("n0")).toBe("panner");
      expect(got.get("n1")).toBe("bed");
    });

    it("yields when the challenger is clearly nearer", () => {
      const previous = new Map<string, SourceKind>([["n0", "panner"]]);
      const got = selectSources(at(10, 5), small, previous);
      expect(got.get("n1")).toBe("panner");
      expect(got.get("n0")).toBe("bed");
    });

    it("does not protect a node that was only in the bed", () => {
      const previous = new Map<string, SourceKind>([["n0", "bed"], ["n1", "bed"]]);
      expect(selectSources(at(10, 9), small, previous).get("n1")).toBe("panner");
    });

    it("is off at a factor of 1", () => {
      const previous = new Map<string, SourceKind>([["n0", "panner"]]);
      expect(selectSources(at(10, 9), small, previous, 1).get("n1")).toBe("panner");
    });

    it("defaults to a quarter", () => {
      expect(DEFAULT_HYSTERESIS).toBe(1.25);
    });
  });
});
