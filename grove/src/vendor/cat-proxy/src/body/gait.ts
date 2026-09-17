// Quadruped gaits as pose-of-phase functions. Walk is the lateral-sequence four-beat (LH, LF,
// RH, RF a quarter cycle apart); trot moves diagonal pairs together. Each paw follows a stance
// segment that slides back at exactly the body speed and a lifted swing forward, so at the
// exported speed the planted feet stay put on the floor. Speeds are world metres per second for a
// cat of RIG_SCALE size; the stride itself is authored in rig units.

import { RIG_SCALE } from "./appearance";
import { solveLeg, restFootOffset } from "./legs";
import { add, restPose, setLeg, smoothstep, type Pose } from "./pose";
import { bone, leg, type LegChain, type LegKind, type Side } from "./skeleton";

export interface Gait {
  /** Seconds per stride cycle. */
  period: number;
  /** World body speed the cycle is authored for, m/s, at RIG_SCALE. */
  speed: number;
  /** Fraction of the cycle each foot spends on the floor. */
  duty: number;
  /** Paw lift at mid-swing, metres. */
  lift: number;
  /** Cycle phase at which each foot touches down. */
  touchdown: Record<`${LegKind}${Side}`, number>;
  /** Vertical bob of the body, metres, twice per cycle. */
  bob: number;
}

export const GAITS = {
  walk: {
    // The stride in rig units is what is authored; the speed is the ground it covers at
    // RIG_SCALE. Cadence goes as 1/sqrt(length), so these shortened when the cats did.
    period: 0.74,
    speed: 0.41,
    duty: 0.62,
    lift: 0.03,
    touchdown: { hindL: 0, foreL: 0.25, hindR: 0.5, foreR: 0.75 },
    bob: 0.004,
  },
  trot: {
    period: 0.44,
    speed: 0.97,
    duty: 0.45,
    lift: 0.045,
    touchdown: { foreL: 0, hindR: 0, foreR: 0.5, hindL: 0.5 },
    bob: 0.008,
  },
} as const satisfies Record<string, Gait>;

export type GaitName = keyof typeof GAITS;

/** Foot travel over a stance in rig units: the body covers it while the paw is planted. */
export function stanceLength(g: Gait): number {
  return (g.speed * g.duty * g.period) / RIG_SCALE;
}

function wrap01(x: number): number {
  return x - Math.floor(x);
}

/** Puts one leg where the gait wants it at cycle phase `phase` (0..1). */
function poseLeg(p: Pose, c: LegChain, g: Gait, phase: number): void {
  const rest = restFootOffset(c);
  const L = stanceLength(g);
  const local = wrap01(phase - g.touchdown[`${c.kind}${c.side}`]);
  let fwd: number;
  let up: number;
  let meta: number;
  let paw: number;
  const metaStance = c.kind === "fore" ? 36 : 37;
  if (local < g.duty) {
    const s = local / g.duty;
    fwd = L / 2 - L * s;
    up = 0;
    meta = metaStance;
    // Toes flat on the floor, rolling on to the tip as the foot leaves.
    paw = 88 + 10 * s;
  } else {
    const s = (local - g.duty) / (1 - g.duty);
    fwd = -L / 2 + L * smoothstep(s);
    up = g.lift * Math.sin(Math.PI * s);
    // The wrist folds back early in the swing and reaches forward before touchdown.
    const fold = Math.sin(Math.PI * s);
    meta = metaStance - (c.kind === "fore" ? 50 : 25) * fold;
    paw = 98 - 45 * fold;
  }
  // The girdle pivots with the leg, as a cat's scapula does, which is where much of the reach
  // comes from; the top joint moves with it, so the target is taken relative to where it lands.
  const swing = (-GIRDLE_SWING * fwd) / (L / 2);
  p.rot[c.girdle] = [swing, 0, 0];
  const shift = girdleShift(c, swing);
  setLeg(
    p,
    c,
    solveLeg(c, { fwd: rest.fwd + fwd - shift.fwd, up: rest.up + up - shift.up }, meta, paw),
  );
}

const GIRDLE_SWING = 12;

/** How far the upper bone's head moves when the girdle bone pitches by `deg` about the body. */
function girdleShift(c: LegChain, deg: number): { fwd: number; up: number } {
  const g = bone(c.girdle);
  const gy = g.tail[1] - g.head[1];
  const gz = g.tail[2] - g.head[2];
  const r = (deg * Math.PI) / 180;
  return {
    up: gy * Math.cos(r) - gz * Math.sin(r) - gy,
    fwd: gy * Math.sin(r) + gz * Math.cos(r) - gz,
  };
}

/** The whole body at cycle phase `phase`, before the controller's procedural layers. */
export function gaitPose(name: GaitName, phase: number): Pose {
  const g = GAITS[name];
  const p = restPose();
  const cyc = 2 * Math.PI * phase;
  p.pos[1] += g.bob * (Math.sin(2 * cyc) - 1) * 0.5;
  // The pelvis rocks with the hind legs and the shoulders counter it; the tail rides up and sways.
  const rock = name === "walk" ? 3 : 2;
  add(p, "root", [0, rock * Math.sin(cyc), 2 * Math.cos(cyc)]);
  add(p, "spine2", [0, -rock * 0.6 * Math.sin(cyc), -1.5 * Math.cos(cyc)]);
  add(p, "spine3", [0, -rock * 0.4 * Math.sin(cyc), 0]);
  add(p, "neck", [name === "trot" ? 8 : 4, 0, 0]);
  add(p, "head", [name === "trot" ? -6 : -2, 0, 0]);
  const tailUp = name === "walk" ? 40 : 20;
  add(p, "tail1", [tailUp, 6 * Math.sin(cyc), 0]);
  add(p, "tail2", [15, 5 * Math.sin(cyc - 0.5), 0]);
  add(p, "tail3", [8, 4 * Math.sin(cyc - 1), 0]);
  add(p, "tail4", [2, 3 * Math.sin(cyc - 1.5), 0]);
  add(p, "tail5", [-4, 3 * Math.sin(cyc - 2), 0]);
  add(p, "tail6", [-6, 2 * Math.sin(cyc - 2.5), 0]);
  for (const c of [leg("fore", "L"), leg("fore", "R"), leg("hind", "L"), leg("hind", "R")]) {
    poseLeg(p, c, g, phase);
  }
  return p;
}
