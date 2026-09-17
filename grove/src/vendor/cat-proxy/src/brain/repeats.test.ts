import { describe, expect, it } from "vitest";
import { defaultParams } from "./params";
import { simulate } from "./simulate";
import { episodeBehaviours, longestRun } from "./test-support";

describe("no behaviour repeats too many times in a row", () => {
  it("stays within the configured cap across a long run, for several seeds", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const timeline = simulate(defaultParams, seed, 3 * 3600, [], 2);
      const run = episodeBehaviours(timeline);
      expect(run.length).toBeGreaterThan(5); // sanity: this seed actually produced episodes
      expect(longestRun(run)).toBeLessThanOrEqual(defaultParams.maxConsecutiveRepeats);
    }
  });
});
