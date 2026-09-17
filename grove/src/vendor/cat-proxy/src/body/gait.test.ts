import { describe, expect, it } from "vitest";
import { defaultParams } from "../brain/params";
import { RIG_SCALE } from "./appearance";
import { GAITS, gaitPose, type GaitName } from "./gait";
import { footFor } from "./legs";
import { legTop, PAW_JOINT_Y, plantLeg, restLegAngles, sitPose, type Pose } from "./pose";
import { chainTo, LEGS, type LegChain } from "./skeleton";

/** The paw joint in the body's frame (rig units), from the pose's absolute link angles. */
function paw(p: Pose, c: LegChain): { z: number; y: number } {
  const rest = restLegAngles(c);
  const abs = (name: string): number =>
    chainTo(name as LegChain["upper"]).reduce((sum, b) => sum + p.rot[b][0], 0);
  const top = legTop(p, c);
  const foot = footFor(c, {
    upper: rest.upper - abs(c.upper),
    lower: rest.lower - abs(c.lower),
    meta: rest.meta - abs(c.meta),
    paw: rest.paw - abs(c.paw),
  });
  return { z: top.z + foot.fwd, y: top.y + foot.up };
}

describe("gaits", () => {
  it("match the brain's speeds", () => {
    expect(defaultParams.speedsMPerS.walk).toBe(GAITS.walk.speed);
    expect(defaultParams.speedsMPerS.trot).toBe(GAITS.trot.speed);
  });

  for (const name of ["walk", "trot"] as GaitName[]) {
    it(`${name}: a planted paw moves back at exactly the body's speed, so it does not slide`, () => {
      const g = GAITS[name];
      // Rig units per unit of phase. A cat of any size plays the clip at RIG_SCALE / size, so in
      // the world the body covers size * this while the planted paw covers the same backward.
      const perPhase = (g.speed * g.period) / RIG_SCALE;
      for (const c of LEGS) {
        const down = g.touchdown[`${c.kind}${c.side}`];
        const a = down + 0.1 * g.duty;
        const b = down + 0.9 * g.duty;
        const pa = paw(gaitPose(name, a % 1), c);
        const pb = paw(gaitPose(name, b % 1), c);
        const expected = -perPhase * (b - a);
        expect(Math.abs(pb.z - pa.z - expected), `${c.kind}${c.side} slide`).toBeLessThan(0.004);
        expect(Math.abs(pa.y - PAW_JOINT_Y), `${c.kind}${c.side} on the floor`).toBeLessThan(0.004);
      }
    });
  }
});

describe("plantLeg", () => {
  it("puts the paw joint where it was asked, under a pitched body", () => {
    for (const c of LEGS) {
      const p = sitPose();
      const target = { z: legTop(p, c).z + 0.03, y: PAW_JOINT_Y };
      plantLeg(p, c, target, c.kind === "fore" ? 12 : 90, 90);
      const at = paw(p, c);
      expect(Math.abs(at.z - target.z), `${c.kind}${c.side} z`).toBeLessThan(0.003);
      expect(Math.abs(at.y - target.y), `${c.kind}${c.side} y`).toBeLessThan(0.003);
    }
  });
});
