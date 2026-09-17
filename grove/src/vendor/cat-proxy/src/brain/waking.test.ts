import { describe, expect, it } from "vitest";
import { defaultParams } from "./params";
import { simulate } from "./simulate";
import { firstBehaviourAfterSleep } from "./test-support";

// A short sleep dwell so a run naturally wakes within the test window, and low starting energy
// so most seeds choose to sleep first (not guaranteed every seed — the softmax is still live —
// so the test only scores the seeds that did sleep, which is itself asserted to be most of them).
const params = {
  ...defaultParams,
  behaviours: {
    ...defaultParams.behaviours,
    sleep: { ...defaultParams.behaviours.sleep, dwell: { medianS: 6, spread: 0.3 } },
  },
  initialDrives: { ...defaultParams.initialDrives, energy: 0 },
};

describe("waking up", () => {
  it("the first behaviour after sleep is stretch or groom, with high probability over many seeds", () => {
    let sleptSeeds = 0;
    let matches = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const timeline = simulate(params, seed, 45, [], 0.25);
      const first = firstBehaviourAfterSleep(timeline);
      if (first === undefined) continue;
      sleptSeeds++;
      if (first === "stretch" || first === "groom") matches++;
    }
    expect(sleptSeeds).toBeGreaterThan(20); // sanity: enough seeds actually slept to judge by
    expect(matches / sleptSeeds).toBeGreaterThanOrEqual(0.8);
  });
});
