// Planar two-link IK for a leg, in the sagittal plane. The gait places each paw on a path and
// this turns the path into link angles, which is what keeps the feet from sliding: the foot is
// where the maths says it is, not where a hand-tuned swing happens to put it.

import { boneLength, bone, type LegChain } from "./skeleton";
import type { LegAngles } from "./pose";

/** A point in the sagittal plane relative to the leg's top joint: forward and up, metres. */
export interface Planar {
  fwd: number;
  up: number;
}

/** Where the paw joint (top of the toes) sits relative to the upper bone's head at rest. */
export function restFootOffset(c: LegChain): Planar {
  const top = bone(c.upper).head;
  const foot = bone(c.paw).head;
  return { fwd: foot[2] - top[2], up: foot[1] - top[1] };
}

/** Link angles that put the paw joint at `foot` (relative to the top joint) with the given
 * metacarpal and paw angles. The elbow bends backward on a foreleg and the knee forward on a hind
 * leg, as in the animal. Out-of-reach targets straighten the leg toward them. */
export function solveLeg(c: LegChain, foot: Planar, meta: number, paw: number): LegAngles {
  const a = boneLength(c.upper);
  const b = boneLength(c.lower);
  const m = boneLength(c.meta);
  const mr = (meta * Math.PI) / 180;
  // The wrist/hock is one metacarpal length back up the meta link from the paw joint.
  const wrist: Planar = { fwd: foot.fwd - m * Math.sin(mr), up: foot.up + m * Math.cos(mr) };
  const d = Math.min(Math.hypot(wrist.fwd, wrist.up), a + b - 1e-4);
  const toWrist = Math.atan2(wrist.fwd, -wrist.up);
  const cosAlpha = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
  const alpha = Math.acos(cosAlpha);
  const upperRad = c.kind === "fore" ? toWrist - alpha : toWrist + alpha;
  const elbow: Planar = { fwd: a * Math.sin(upperRad), up: -a * Math.cos(upperRad) };
  const lowerRad = Math.atan2(wrist.fwd - elbow.fwd, -(wrist.up - elbow.up));
  return {
    upper: (upperRad * 180) / Math.PI,
    lower: (lowerRad * 180) / Math.PI,
    meta,
    paw,
  };
}

/** Forward kinematics of the same model, for tests: the paw joint for a set of link angles. */
export function footFor(c: LegChain, angles: LegAngles): Planar {
  const links: [number, number][] = [
    [boneLength(c.upper), angles.upper],
    [boneLength(c.lower), angles.lower],
    [boneLength(c.meta), angles.meta],
  ];
  const p: Planar = { fwd: 0, up: 0 };
  for (const [len, deg] of links) {
    const r = (deg * Math.PI) / 180;
    p.fwd += len * Math.sin(r);
    p.up -= len * Math.cos(r);
  }
  return p;
}
