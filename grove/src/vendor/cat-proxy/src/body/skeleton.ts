// The cat's rig as plain numbers: bone names, parents and rest positions in metres, +z forward,
// y up, feet on y=0 in the stand posture. No THREE here so poses, gaits and the transition planner
// can be unit-tested; cat.ts turns this into a THREE.Skeleton, and every bone's rest ORIENTATION
// is identity, so a bone's local X rotation is a pitch in its parent's frame and a chain of
// pitches simply adds up (the sign convention is in pose.ts).

export type Vec3 = readonly [number, number, number];

export type Side = "L" | "R";
export type LegKind = "fore" | "hind";

export type AxialBone =
  | "root"
  | "spine1"
  | "belly"
  | "spine2"
  | "spine3"
  | "neck"
  | "head"
  | "jaw"
  | "earL"
  | "earR"
  | "tail1"
  | "tail2"
  | "tail3"
  | "tail4"
  | "tail5"
  | "tail6";

export type LegBone =
  | `shoulder${Side}`
  | `foreUpper${Side}`
  | `foreLower${Side}`
  | `foreMeta${Side}`
  | `forePaw${Side}`
  | `hip${Side}`
  | `hindUpper${Side}`
  | `hindLower${Side}`
  | `hindMeta${Side}`
  | `hindPaw${Side}`;

export type BoneName = AxialBone | LegBone;

export interface BoneDef {
  name: BoneName;
  parent: BoneName | null;
  /** Rest position of the joint, world space. */
  head: Vec3;
  /** Where the bone points at rest (the child's head, or a leaf's tip). Skinning uses the segment. */
  tail: Vec3;
}

export const TAIL_BONES: readonly AxialBone[] = [
  "tail1",
  "tail2",
  "tail3",
  "tail4",
  "tail5",
  "tail6",
];

/** A leg's five bones from the body outward: girdle, upper, lower, metacarpal/-tarsal, paw. */
export interface LegChain {
  side: Side;
  kind: LegKind;
  girdle: LegBone;
  upper: LegBone;
  lower: LegBone;
  meta: LegBone;
  paw: LegBone;
}

export function leg(kind: LegKind, side: Side): LegChain {
  return kind === "fore"
    ? {
        side,
        kind,
        girdle: `shoulder${side}`,
        upper: `foreUpper${side}`,
        lower: `foreLower${side}`,
        meta: `foreMeta${side}`,
        paw: `forePaw${side}`,
      }
    : {
        side,
        kind,
        girdle: `hip${side}`,
        upper: `hindUpper${side}`,
        lower: `hindLower${side}`,
        meta: `hindMeta${side}`,
        paw: `hindPaw${side}`,
      };
}

export const LEGS: readonly LegChain[] = [
  leg("fore", "L"),
  leg("fore", "R"),
  leg("hind", "L"),
  leg("hind", "R"),
];

// Proportions of an adult domestic cat: ~0.50 m nose to tail base, shoulders 0.25 m off the
// floor, with a Ragdoll's big head held high, wide-set ears and a tail about the body's length (~0.35 m). These are rig
// units: the Ragdolls are built RIG_SCALE (appearance.ts) times larger, which scales the whole
// rig, so every pose and clip authored here still plants its feet. The forelegs stand under the shoulders and the hind legs under the hips;
// both are digitigrade, so the wrist/hock sits well above the paw and the last bone is the toes.
const AXIAL: readonly BoneDef[] = [
  { name: "root", parent: null, head: [0, 0.195, -0.13], tail: [0, 0.205, -0.04] },
  { name: "spine1", parent: "root", head: [0, 0.205, -0.04], tail: [0, 0.215, 0.04] },
  // The pouch hangs under the ribcage on its own bone, so it can swing behind the body's motion
  // (controller.ts) instead of riding it rigidly.
  { name: "belly", parent: "spine1", head: [0, 0.15, -0.05], tail: [0, 0.115, -0.095] },
  { name: "spine2", parent: "spine1", head: [0, 0.215, 0.04], tail: [0, 0.215, 0.11] },
  { name: "spine3", parent: "spine2", head: [0, 0.215, 0.11], tail: [0, 0.225, 0.16] },
  { name: "neck", parent: "spine3", head: [0, 0.225, 0.16], tail: [0, 0.282, 0.212] },
  { name: "head", parent: "neck", head: [0, 0.282, 0.212], tail: [0, 0.276, 0.322] },
  { name: "jaw", parent: "head", head: [0, 0.258, 0.25], tail: [0, 0.25, 0.31] },
  { name: "earL", parent: "head", head: [0.043, 0.33, 0.226], tail: [0.07, 0.382, 0.222] },
  { name: "earR", parent: "head", head: [-0.043, 0.33, 0.226], tail: [-0.07, 0.382, 0.222] },
  { name: "tail1", parent: "root", head: [0, 0.2, -0.16], tail: [0, 0.195, -0.218] },
  { name: "tail2", parent: "tail1", head: [0, 0.195, -0.218], tail: [0, 0.185, -0.276] },
  { name: "tail3", parent: "tail2", head: [0, 0.185, -0.276], tail: [0, 0.168, -0.332] },
  { name: "tail4", parent: "tail3", head: [0, 0.168, -0.332], tail: [0, 0.146, -0.386] },
  { name: "tail5", parent: "tail4", head: [0, 0.146, -0.386], tail: [0, 0.12, -0.438] },
  { name: "tail6", parent: "tail5", head: [0, 0.12, -0.438], tail: [0, 0.09, -0.487] },
];

function legBones(kind: LegKind, side: Side): BoneDef[] {
  const s = side === "L" ? 1 : -1;
  const c = leg(kind, side);
  const x = (v: number): number => s * v;
  if (kind === "fore") {
    return [
      {
        name: c.girdle,
        parent: "spine3",
        head: [x(0.035), 0.23, 0.1],
        tail: [x(0.042), 0.17, 0.125],
      },
      {
        name: c.upper,
        parent: c.girdle,
        head: [x(0.042), 0.17, 0.125],
        tail: [x(0.042), 0.095, 0.08],
      },
      {
        name: c.lower,
        parent: c.upper,
        head: [x(0.042), 0.095, 0.08],
        tail: [x(0.042), 0.04, 0.115],
      },
      {
        name: c.meta,
        parent: c.lower,
        head: [x(0.042), 0.04, 0.115],
        tail: [x(0.042), 0.012, 0.135],
      },
      {
        name: c.paw,
        parent: c.meta,
        head: [x(0.042), 0.012, 0.135],
        tail: [x(0.042), 0.004, 0.175],
      },
    ];
  }
  return [
    { name: c.girdle, parent: "root", head: [x(0.035), 0.2, -0.13], tail: [x(0.045), 0.19, -0.14] },
    {
      name: c.upper,
      parent: c.girdle,
      head: [x(0.045), 0.19, -0.14],
      tail: [x(0.045), 0.12, -0.085],
    },
    {
      name: c.lower,
      parent: c.upper,
      head: [x(0.045), 0.12, -0.085],
      tail: [x(0.045), 0.065, -0.17],
    },
    {
      name: c.meta,
      parent: c.lower,
      head: [x(0.045), 0.065, -0.17],
      tail: [x(0.045), 0.012, -0.13],
    },
    { name: c.paw, parent: c.meta, head: [x(0.045), 0.012, -0.13], tail: [x(0.045), 0.004, -0.09] },
  ];
}

/** Every bone, parents before children. */
export const BONES: readonly BoneDef[] = [
  ...AXIAL,
  ...legBones("fore", "L"),
  ...legBones("fore", "R"),
  ...legBones("hind", "L"),
  ...legBones("hind", "R"),
];

export const BONE_NAMES: readonly BoneName[] = BONES.map((b) => b.name);

const BY_NAME = new Map<BoneName, BoneDef>(BONES.map((b) => [b.name, b]));

export function bone(name: BoneName): BoneDef {
  const def = BY_NAME.get(name);
  if (!def) throw new Error(`unknown bone ${name}`);
  return def;
}

/** Bone length, metres. */
export function boneLength(name: BoneName): number {
  const b = bone(name);
  return Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]);
}

/** Angle of the bone's rest direction in the sagittal plane: 0 = straight down, +90 = forward. */
export function boneRestAngle(name: BoneName): number {
  const b = bone(name);
  return (Math.atan2(b.tail[2] - b.head[2], -(b.tail[1] - b.head[1])) * 180) / Math.PI;
}

/** Parent-to-child chain from the root to `name`, root first, `name` last. */
export function chainTo(name: BoneName): BoneName[] {
  const out: BoneName[] = [];
  for (let b: BoneDef | null = bone(name); b; b = b.parent ? bone(b.parent) : null)
    out.unshift(b.name);
  return out;
}
