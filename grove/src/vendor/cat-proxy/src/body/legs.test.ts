import { describe, expect, it } from "vitest";
import { footFor, restFootOffset, solveLeg } from "./legs";
import { restLegAngles } from "./pose";
import { LEGS } from "./skeleton";

describe("solveLeg", () => {
  it("returns the rest angles for the rest foot position", () => {
    for (const c of LEGS) {
      const rest = restLegAngles(c);
      const a = solveLeg(c, restFootOffset(c), rest.meta, rest.paw);
      expect(a.upper).toBeCloseTo(rest.upper, 3);
      expect(a.lower).toBeCloseTo(rest.lower, 3);
    }
  });

  it("puts the paw joint where it was asked, across a stride", () => {
    for (const c of LEGS) {
      const rest = restFootOffset(c);
      const meta = restLegAngles(c).meta;
      // A stride's reach after the girdle swing takes its share (gait.ts).
      const reach = c.kind === "fore" ? 0.075 : 0.09;
      for (const fwd of [-reach, -0.05, 0, 0.05, reach]) {
        for (const up of [0, 0.03]) {
          const target = { fwd: rest.fwd + fwd, up: rest.up + up };
          const foot = footFor(c, solveLeg(c, target, meta, 90));
          // At full reach the leg is straight and a few millimetres short: invisible.
          expect(Math.abs(foot.fwd - target.fwd)).toBeLessThan(0.004);
          expect(Math.abs(foot.up - target.up)).toBeLessThan(0.004);
        }
      }
    }
  });

  it("bends the elbow back and the knee forward", () => {
    for (const c of LEGS) {
      const rest = restFootOffset(c);
      const a = solveLeg(c, { fwd: rest.fwd, up: rest.up + 0.04 }, 30, 90);
      if (c.kind === "fore") expect(a.upper).toBeLessThan(a.lower);
      else expect(a.upper).toBeGreaterThan(a.lower);
    }
  });
});
