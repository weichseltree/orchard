// A pose is one number triple per bone plus where the root sits. Angles are degrees, applied in
// THREE's "YXZ" order. Sign conventions, from the right-handed frame with y up and +z forward
// (so +x points to the cat's LEFT):
//   x: +pitches the bone's forward end DOWN (nose down, a leg swings backward; the tail bones
//      point backward, so +x on a tail bone lifts the tip UP)
//   y: +yaws it to the LEFT
//   z: +rolls it, top toward the left
// Every bone's rest orientation is identity (skeleton.ts), so a chain of x rotations adds up,
// which is what makes leg poses expressible as absolute link angles (see setLeg).

import {
  BONE_NAMES,
  bone,
  boneRestAngle,
  chainTo,
  leg,
  TAIL_BONES,
  type BoneName,
  type LegChain,
  type Vec3,
} from "./skeleton";
import type { Posture } from "../contract";
import { solveLeg } from "./legs";

export type Deg3 = [number, number, number];

export interface Pose {
  /** Root bone position, world space. */
  pos: [number, number, number];
  rot: Record<BoneName, Deg3>;
  /** Tail thickness multiplier: 1 normally, >1 when the tail is puffed. */
  puff: number;
}

export function restPose(): Pose {
  const rot = {} as Record<BoneName, Deg3>;
  for (const name of BONE_NAMES) rot[name] = [0, 0, 0];
  const root = bone("root").head;
  return { pos: [root[0], root[1], root[2]], rot, puff: 1 };
}

export function clonePose(p: Pose): Pose {
  const rot = {} as Record<BoneName, Deg3>;
  for (const name of BONE_NAMES) rot[name] = [...p.rot[name]];
  return { pos: [...p.pos], rot, puff: p.puff };
}

/** Adds a rotation onto a bone's existing one. */
export function add(p: Pose, name: BoneName, d: Deg3): void {
  const r = p.rot[name];
  r[0] += d[0];
  r[1] += d[1];
  r[2] += d[2];
}

export function set(p: Pose, name: BoneName, d: Deg3): void {
  p.rot[name] = [d[0], d[1], d[2]];
}

/** Component-wise mix; fine for our ranges, which never wrap. */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out = clonePose(a);
  for (const name of BONE_NAMES) {
    const ra = a.rot[name];
    const rb = b.rot[name];
    out.rot[name] = [
      ra[0] + (rb[0] - ra[0]) * t,
      ra[1] + (rb[1] - ra[1]) * t,
      ra[2] + (rb[2] - ra[2]) * t,
    ];
  }
  out.pos = [
    a.pos[0] + (b.pos[0] - a.pos[0]) * t,
    a.pos[1] + (b.pos[1] - a.pos[1]) * t,
    a.pos[2] + (b.pos[2] - a.pos[2]) * t,
  ];
  out.puff = a.puff + (b.puff - a.puff) * t;
  return out;
}

export function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Absolute angles of a leg's four links in the sagittal plane: 0 = straight down, +90 = forward. */
export interface LegAngles {
  upper: number;
  lower: number;
  meta: number;
  paw: number;
}

export function restLegAngles(c: LegChain): LegAngles {
  return {
    upper: boneRestAngle(c.upper),
    lower: boneRestAngle(c.lower),
    meta: boneRestAngle(c.meta),
    paw: boneRestAngle(c.paw),
  };
}

/** Sum of the x rotations from the root down to and including `name`: the bone's absolute pitch
 * while the chain has no yaw or roll, which holds for legs. */
function absolutePitch(p: Pose, name: BoneName): number {
  let sum = 0;
  for (const b of chainTo(name)) sum += p.rot[b][0];
  return sum;
}

/** Poses a leg by absolute link angles, whatever the body above it is doing. A link at angle a
 * needs an absolute pitch of (rest - a) (pitch + swings a link backward), and its local pitch is
 * that minus its parent's. */
export function setLeg(p: Pose, c: LegChain, a: LegAngles): void {
  const rest = restLegAngles(c);
  let parent = absolutePitch(p, c.girdle);
  for (const k of ["upper", "lower", "meta", "paw"] as const) {
    const abs = rest[k] - a[k];
    p.rot[c[k]] = [abs - parent, p.rot[c[k]][1], p.rot[c[k]][2]];
    parent = abs;
  }
}

const DEG = Math.PI / 180;

/** Where a leg's top joint (the upper bone's head) sits in the pose, from pitch-only kinematics
 * down the chain from the root: forward (z) and up (y) in the body's frame. Exact while nothing
 * above the leg yaws or rolls, which holds for every pose that plants a leg. */
export function legTop(p: Pose, c: LegChain): { z: number; y: number } {
  const chain = chainTo(c.upper);
  let y = p.pos[1];
  let z = p.pos[2];
  let pitch = 0;
  for (let i = 0; i < chain.length; i++) {
    const name = chain[i]!;
    if (i > 0) {
      const b = bone(name).head;
      const parent = bone(chain[i - 1]!).head;
      const dy = b[1] - parent[1];
      const dz = b[2] - parent[2];
      const r = pitch * DEG;
      y += dy * Math.cos(r) - dz * Math.sin(r);
      z += dy * Math.sin(r) + dz * Math.cos(r);
    }
    pitch += p.rot[name][0];
  }
  return { z, y };
}

/** The paw joint rests on the floor at rest; a planted foot puts it back there. */
export const PAW_JOINT_Y = bone("forePawL").head[1];

/** Solves a leg so its paw joint lands at `foot` (body frame, z forward, y up) with the given
 * metacarpal and paw angles, wherever the body above it has been moved. */
export function plantLeg(
  p: Pose,
  c: LegChain,
  foot: { z: number; y: number },
  meta: number,
  paw: number,
): void {
  const top = legTop(p, c);
  setLeg(p, c, solveLeg(c, { fwd: foot.z - top.z, up: foot.y - top.y }, meta, paw));
}

/** Applies a smaller rotation to each tail bone so the tail curves rather than kinks. */
export function curlTail(p: Pose, perBone: Deg3): void {
  for (const t of TAIL_BONES) add(p, t, perBone);
}

const ROOT_REST: Vec3 = bone("root").head;

// ----------------------------------------------------------------------------------------------
// The four canonical posture poses. Every clip starts and ends in one of these, exactly, so a
// crossfade between any two clips through the same posture never pops.
// ----------------------------------------------------------------------------------------------

export function standPose(): Pose {
  return restPose();
}

/** Forelegs straight, haunches folded with the hocks flat on the floor, back sloping up to the
 * shoulders, head level. A Ragdoll sits tall on a deep rump of fur, so the hips sit high enough
 * for it not to sink into the floor; the feet are planted by IK wherever that leaves them. */
export function sitPose(): Pose {
  const p = restPose();
  p.pos = [0, 0.108, -0.1];
  set(p, "root", [-30, 0, 0]);
  // A sitting cat's pouch draws up against the ribs and spreads on the floor rather than
  // hanging; without this it sinks through it.
  set(p, "belly", [30, 0, 0]);
  set(p, "spine3", [4, 0, 0]);
  set(p, "neck", [12, 0, 0]);
  set(p, "head", [12, 0, 0]);
  // The shoulder blades rock forward over the planted forelegs, which is what lets them reach.
  set(p, "shoulderL", [30, 0, 0]);
  set(p, "shoulderR", [30, 0, 0]);
  for (const c of forelegs()) plantLeg(p, c, { z: legTop(p, c).z + 0.01, y: PAW_JOINT_Y }, 12, 86);
  for (const c of hindlegs()) plantLeg(p, c, { z: legTop(p, c).z + 0.075, y: PAW_JOINT_Y }, 90, 90);
  // The tail drops to the floor and lies swept round to one side. The rest tail already droops
  // more per bone toward the tip, so flattening it needs the larger lifts on bones 2 and 3.
  set(p, "tail1", [-14, 14, 0]);
  set(p, "tail2", [34, 14, 0]);
  set(p, "tail3", [26, 16, 0]);
  set(p, "tail4", [10, 16, 0]);
  set(p, "tail5", [8, 14, 0]);
  set(p, "tail6", [10, 10, 0]);
  return p;
}

/** Sphinx: belly on the floor, forelegs out in front, hind legs tucked under, head up. */
export function liePose(): Pose {
  const p = restPose();
  p.pos = [0, 0.132, -0.12];
  set(p, "root", [0, 0, 0]);
  set(p, "belly", [26, 0, 0]);
  set(p, "spine3", [-4, 0, 0]);
  set(p, "neck", [-16, 0, 0]);
  set(p, "head", [12, 0, 0]);
  // Forearms flat on the floor: lift the joints by the fur under them.
  for (const c of forelegs())
    plantLeg(p, c, { z: legTop(p, c).z + 0.12, y: PAW_JOINT_Y + 0.026 }, 92, 92);
  for (const c of hindlegs()) plantLeg(p, c, { z: legTop(p, c).z + 0.06, y: PAW_JOINT_Y }, 90, 90);
  // The plume lies along the floor, curving forward round the left flank.
  set(p, "tail1", [-36, 26, 0]);
  set(p, "tail2", [30, 28, 0]);
  set(p, "tail3", [22, 26, 0]);
  set(p, "tail4", [8, 22, 0]);
  set(p, "tail5", [6, 16, 0]);
  set(p, "tail6", [8, 10, 0]);
  return p;
}

/** The loaf: lying with the front paws tucked under the chest, the hind legs folded alongside,
 * the back level and the head up — the pose in the owner's bed photos. The tail lies along the
 * left flank rather than over the face. */
export function loafPose(): Pose {
  const p = restPose();
  p.pos = [0, 0.126, -0.12];
  set(p, "root", [0, 0, 0]);
  set(p, "belly", [32, 0, 0]);
  set(p, "spine2", [-1, 0, 0]);
  set(p, "spine3", [-3, 0, 0]);
  set(p, "neck", [-10, 0, 0]);
  set(p, "head", [12, 0, 0]);
  // The forelegs fold: the elbow drops back beside the chest and the forearm lies flat under it,
  // so only the toes show at the front.
  for (const c of forelegs())
    plantLeg(p, c, { z: legTop(p, c).z + 0.055, y: PAW_JOINT_Y + 0.021 }, 104, 96);
  for (const c of hindlegs())
    plantLeg(p, c, { z: legTop(p, c).z + 0.055, y: PAW_JOINT_Y + 0.004 }, 90, 90);
  set(p, "tail1", [-34, 30, 0]);
  set(p, "tail2", [30, 32, 0]);
  set(p, "tail3", [24, 30, 0]);
  set(p, "tail4", [8, 26, 0]);
  set(p, "tail5", [6, 18, 0]);
  set(p, "tail6", [8, 12, 0]);
  return p;
}

export const POSTURE_POSE: Record<Posture, () => Pose> = {
  stand: standPose,
  sit: sitPose,
  lie: liePose,
  loaf: loafPose,
};

export function forelegs(): LegChain[] {
  return [leg("fore", "L"), leg("fore", "R")];
}

export function hindlegs(): LegChain[] {
  return [leg("hind", "L"), leg("hind", "R")];
}

export { ROOT_REST };
