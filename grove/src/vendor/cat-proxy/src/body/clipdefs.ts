// Every clip in the contract, authored as a pose-of-time function without THREE. One-shots start
// and end exactly in their postures' canonical poses (pose.ts) and non-gait loops do too, so any
// crossfade through a posture is invisible; the gaits start mid-stride and the crossfade absorbs
// it. clips.ts samples these into AnimationClips; clipdefs.test.ts checks the endpoints.

import type { ClipName } from "../contract";
import { GAITS, gaitPose } from "./gait";
import { solveLeg, restFootOffset } from "./legs";
import {
  add,
  clonePose,
  loafPose,
  forelegs,
  hindlegs,
  lerpPose,
  liePose,
  setLeg,
  sitPose,
  smoothstep,
  standPose,
  type Deg3,
  type Pose,
} from "./pose";
import { LEGS, type BoneName, type LegChain } from "./skeleton";

/** The body's own clip names: the contract's plus the sitting variant of look-around. */
export type BodyClipName = ClipName | "look-around-sit";

export interface ClipDef {
  duration: number;
  loop: boolean;
  /** Whether the procedural head look-at may steer the head during this clip. */
  headFree: boolean;
  at(t: number): Pose;
}

type Key = [t: number, pose: Pose];

/** Smoothstep interpolation between keyed poses; holds the ends. */
function keyed(keys: Key[]): (t: number) => Pose {
  return (t) => {
    const first = keys[0]!;
    const last = keys[keys.length - 1]!;
    if (t <= first[0]) return clonePose(first[1]);
    if (t >= last[0]) return clonePose(last[1]);
    for (let i = 0; i + 1 < keys.length; i++) {
      const [t0, p0] = keys[i]!;
      const [t1, p1] = keys[i + 1]!;
      if (t >= t0 && t <= t1) return lerpPose(p0, p1, smoothstep((t - t0) / (t1 - t0)));
    }
    return clonePose(last[1]);
  };
}

type Edits = Partial<Record<BoneName, Deg3>>;

/** A copy of `base` with rotations added and, optionally, the root moved. */
function tweak(base: Pose, edits: Edits, pos?: [number, number, number], puff?: number): Pose {
  const p = clonePose(base);
  for (const [name, d] of Object.entries(edits) as [BoneName, Deg3][]) add(p, name, d);
  if (pos) p.pos = [...pos];
  if (puff !== undefined) p.puff = puff;
  return p;
}

function legs(
  p: Pose,
  chains: LegChain[],
  a: { upper: number; lower: number; meta: number; paw: number },
): Pose {
  for (const c of chains) setLeg(p, c, a);
  return p;
}

/** Legs of a crouching body: the root has dropped by `drop`, every paw stays on the floor. */
function crouchLegs(p: Pose, drop: number): Pose {
  for (const c of LEGS) {
    const rest = restFootOffset(c);
    const meta = c.kind === "fore" ? 30 : 34;
    setLeg(p, c, solveLeg(c, { fwd: rest.fwd, up: rest.up + drop }, meta, 88));
  }
  return p;
}

// ----------------------------------------------------------------------------------------------
// Loops
// ----------------------------------------------------------------------------------------------

/** Standing still. A calm cat barely moves: a slow weight shift, the tail tip drifting, one small
 * unhurried head turn a cycle. Breathing and ear flicks come from the controller's layers, and
 * anything bigger (scanning, glancing) belongs to look-around, not here. */
function idle(): ClipDef {
  const S = standPose();
  const T = 12;
  return {
    duration: T,
    loop: true,
    headFree: true,
    at: (t) => {
      const w = Math.sin((2 * Math.PI * t) / T); // one weight shift a cycle
      const drift = Math.sin((4 * Math.PI * t) / T); // the tail tip twice as often
      // A single 5 degree head turn between 6 s and 9 s, eased in and out.
      const turn = t > 6 && t < 9 ? Math.sin(((t - 6) * Math.PI) / 3) ** 2 : 0;
      const p = tweak(S, {
        spine2: [0, 0, 0.8 * w],
        tail4: [0, 4 * drift, 0],
        tail5: [0, 6 * drift, 0],
        tail6: [0, 8 * drift, 0],
        head: [0, 5 * turn, 0],
      });
      p.pos[0] += 0.002 * w;
      return p;
    },
  };
}

function gait(name: "walk" | "trot"): ClipDef {
  const g = GAITS[name];
  return {
    duration: g.period,
    loop: true,
    headFree: true,
    at: (t) => gaitPose(name, t / g.period),
  };
}

function sitIdle(): ClipDef {
  const S = sitPose();
  const a = tweak(S, { head: [0, -18, 0], neck: [0, -5, 0], tail6: [0, 20, 0], tail5: [0, 8, 0] });
  const b = tweak(S, { head: [-4, -18, 4], tail6: [0, -15, 0], tail5: [0, -10, 0] });
  const c = tweak(S, { head: [4, 10, 0], earL: [0, 0, 20], earR: [0, 0, -20], tail6: [0, 10, 0] });
  return {
    duration: 4,
    loop: true,
    headFree: true,
    at: keyed([
      [0, S],
      [1.2, a],
      [2.0, b],
      [3.0, c],
      [4, S],
    ]),
  };
}

function lieIdle(): ClipDef {
  const L = liePose();
  const sweep = (yaw: number, headYaw: number): Pose =>
    tweak(L, {
      head: [-3, headYaw, 0],
      tail1: [0, yaw, 0],
      tail2: [0, yaw, 0],
      tail3: [0, yaw, 0],
      tail4: [0, yaw * 0.7, 0],
      tail5: [0, yaw * 0.5, 0],
    });
  return {
    duration: 4,
    loop: true,
    headFree: true,
    at: keyed([
      [0, L],
      [1.5, sweep(12, 15)],
      [3.0, sweep(-8, -10)],
      [4, L],
    ]),
  };
}

function sleep(): ClipDef {
  const C = loafPose();
  const T = 4;
  return {
    duration: T,
    loop: true,
    headFree: false,
    at: (t) => {
      // Slow breathing: the flank swells and the whole body lifts a few millimetres.
      const breath = (1 - Math.cos((2 * Math.PI * t) / T)) / 2;
      const p = tweak(C, {
        spine1: [-1.5 * breath, 0, 0],
        spine2: [-1.5 * breath, 0, 0],
        root: [1.2 * breath, 0, 0],
      });
      p.pos[1] += 0.003 * breath;
      // One ear twitch a cycle.
      const tw = Math.max(0, Math.sin(((t - 2.4) * Math.PI) / 0.3)) * (t > 2.4 && t < 2.7 ? 1 : 0);
      add(p, "earL", [0, 0, 25 * tw]);
      return p;
    },
  };
}

/** Sitting: the left forepaw comes up to the mouth for two licks, then wipes over the face twice. */
function groom(): ClipDef {
  const S = sitPose();
  const paw = (p: Pose, a: { upper: number; lower: number; meta: number; paw: number }): Pose =>
    legs(p, [forelegs()[0]!], a);
  const up = paw(tweak(S, { head: [26, 14, 0], neck: [10, 6, 0], spine3: [4, 0, 0] }), {
    upper: 62,
    lower: 135,
    meta: 165,
    paw: 175,
  });
  const lick = paw(
    tweak(S, { head: [34, 14, 0], neck: [12, 6, 0], spine3: [4, 0, 0], jaw: [8, 0, 0] }),
    { upper: 62, lower: 140, meta: 170, paw: 178 },
  );
  const wipeUp = paw(
    tweak(S, { head: [40, 8, -6], neck: [8, 4, 0], spine3: [4, 0, 0], earL: [-20, 0, 10] }),
    { upper: 100, lower: 165, meta: 180, paw: 180 },
  );
  const wipeDown = paw(tweak(S, { head: [14, 14, 6], neck: [8, 6, 0], spine3: [4, 0, 0] }), {
    upper: 55,
    lower: 125,
    meta: 150,
    paw: 165,
  });
  return {
    duration: 3.6,
    loop: true,
    headFree: false,
    at: keyed([
      [0, S],
      [0.45, up],
      [0.7, lick],
      [0.9, up],
      [1.1, lick],
      [1.35, up],
      [1.75, wipeUp],
      [2.15, wipeDown],
      [2.5, wipeUp],
      [2.9, wipeDown],
      [3.6, S],
    ]),
  };
}

/** Standing: head down to the floor, chewing, back up. */
function eat(): ClipDef {
  const S = standPose();
  const down = tweak(S, {
    neck: [48, 0, 0],
    head: [30, 0, 0],
    spine3: [6, 0, 0],
    spine2: [3, 0, 0],
  });
  const base = keyed([
    [0, S],
    [0.6, down],
    [3.0, down],
    [3.6, S],
  ]);
  return {
    duration: 3.6,
    loop: true,
    headFree: false,
    at: (t) => {
      const p = base(t);
      const chewing = t > 0.6 && t < 3.0 ? 1 : 0;
      const chew = (1 - Math.cos(2 * Math.PI * (t - 0.6) * 3.5)) / 2;
      add(p, "jaw", [10 * chew * chewing, 0, 0]);
      add(p, "head", [
        3 * chew * chewing,
        2 * Math.sin(2 * Math.PI * (t - 0.6) * 0.8) * chewing,
        0,
      ]);
      return p;
    },
  };
}

/** A head scan, ears turning ahead of the eyes; the same offsets over either base posture. */
function lookAround(base: Pose): ClipDef {
  const left = tweak(base, {
    head: [0, 42, 0],
    neck: [0, 16, 0],
    earL: [0, 25, 0],
    earR: [0, 25, 0],
  });
  const leftHold = tweak(base, {
    head: [-5, 42, 0],
    neck: [0, 16, 0],
    earL: [0, 20, 0],
    earR: [0, 30, 0],
  });
  const right = tweak(base, {
    head: [0, -42, 0],
    neck: [0, -16, 0],
    earL: [0, -25, 0],
    earR: [0, -25, 0],
  });
  const rightHold = tweak(base, {
    head: [4, -42, 0],
    neck: [0, -16, 0],
    earL: [0, -30, 0],
    earR: [0, -20, 0],
  });
  const upward = tweak(base, {
    head: [-14, 0, 0],
    neck: [-6, 0, 0],
    earL: [0, 0, 15],
    earR: [0, 0, -15],
  });
  return {
    duration: 4.4,
    loop: true,
    headFree: false,
    at: keyed([
      [0, base],
      [0.7, left],
      [1.5, leftHold],
      [2.3, right],
      [3.1, rightHold],
      [3.8, upward],
      [4.4, base],
    ]),
  };
}

// ----------------------------------------------------------------------------------------------
// One-shots
// ----------------------------------------------------------------------------------------------

function sitDown(): ClipDef {
  const S = standPose();
  const SIT = sitPose();
  const mid = lerpPose(S, SIT, 0.5);
  add(mid, "head", [6, 0, 0]);
  return {
    duration: 1.0,
    loop: false,
    headFree: true,
    at: keyed([
      [0, S],
      [0.55, mid],
      [1.0, SIT],
    ]),
  };
}

function standUp(): ClipDef {
  const S = standPose();
  const SIT = sitPose();
  const mid = lerpPose(SIT, S, 0.5);
  add(mid, "neck", [-5, 0, 0]);
  return {
    duration: 0.8,
    loop: false,
    headFree: true,
    at: keyed([
      [0, SIT],
      [0.4, mid],
      [0.8, S],
    ]),
  };
}

/** Sitting to sphinx: the forelegs walk forward and down, the chest follows. */
function lieDown(): ClipDef {
  const SIT = sitPose();
  const LIE = liePose();
  const half = lerpPose(SIT, LIE, 0.5);
  half.pos = [0, 0.095, -0.112];
  legs(half, [forelegs()[0]!], { upper: 40, lower: 70, meta: 80, paw: 90 });
  legs(half, [forelegs()[1]!], { upper: 10, lower: 30, meta: 40, paw: 88 });
  add(half, "head", [8, 0, 0]);
  return {
    duration: 1.2,
    loop: false,
    headFree: true,
    at: keyed([
      [0, SIT],
      [0.6, half],
      [1.2, LIE],
    ]),
  };
}

function getUp(): ClipDef {
  const SIT = sitPose();
  const LIE = liePose();
  const half = lerpPose(LIE, SIT, 0.5);
  legs(half, [forelegs()[0]!], { upper: 20, lower: 40, meta: 50, paw: 88 });
  legs(half, [forelegs()[1]!], { upper: 45, lower: 80, meta: 85, paw: 90 });
  return {
    duration: 1.0,
    loop: false,
    headFree: true,
    at: keyed([
      [0, LIE],
      [0.5, half],
      [1.0, SIT],
    ]),
  };
}

function tuck(): ClipDef {
  const LIE = liePose();
  const LOAF = loafPose();
  const half = lerpPose(LIE, LOAF, 0.5);
  add(half, "head", [-10, 0, 0]);
  return {
    duration: 1.6,
    loop: false,
    headFree: false,
    at: keyed([
      [0, LIE],
      [0.8, half],
      [1.6, LOAF],
    ]),
  };
}

function untuck(): ClipDef {
  const LIE = liePose();
  const LOAF = loafPose();
  const half = lerpPose(LOAF, LIE, 0.5);
  add(half, "head", [-12, 0, 0]);
  return {
    duration: 1.3,
    loop: false,
    headFree: false,
    at: keyed([
      [0, LOAF],
      [0.6, half],
      [1.3, LIE],
    ]),
  };
}

/** Forelegs out and chest to the floor with the rump high, then up and a long push back
 * through the hind legs. */
function stretch(): ClipDef {
  const S = standPose();
  const dog = tweak(
    S,
    {
      root: [24, 0, 0],
      spine3: [-6, 0, 0],
      neck: [-34, 0, 0],
      head: [6, 0, 0],
      tail1: [45, 0, 0],
      tail2: [15, 0, 0],
      tail3: [8, 0, 0],
    },
    [0, 0.215, -0.13],
  );
  legs(dog, forelegs(), { upper: 62, lower: 96, meta: 96, paw: 96 });
  legs(dog, hindlegs(), { upper: 24, lower: -50, meta: 42, paw: 86 });
  const dogHold = tweak(dog, { head: [0, 6, 0], earL: [0, 0, 12], earR: [0, 0, -12] });
  const rear = tweak(
    S,
    {
      root: [-10, 0, 0],
      spine1: [10, 0, 0],
      spine2: [8, 0, 0],
      neck: [-6, 0, 0],
      head: [4, 0, 0],
      tail1: [30, 0, 0],
      tail2: [10, 0, 0],
    },
    [0, 0.16, -0.16],
  );
  legs(rear, forelegs(), { upper: 0, lower: 6, meta: 30, paw: 85 });
  legs(rear, hindlegs(), { upper: -42, lower: -22, meta: 14, paw: 60 });
  const rearHold = tweak(rear, { head: [-4, 0, 0] });
  return {
    duration: 2.8,
    loop: false,
    headFree: false,
    at: keyed([
      [0, S],
      [0.5, dog],
      [1.3, dogHold],
      [1.75, rear],
      [2.25, rearHold],
      [2.8, S],
    ]),
  };
}

/** A crouch with the ears flat and the tail up and puffed, a hop (the controller moves the body
 * back under it), a crouched landing, then a wary rise. Starts in the crouch, from anywhere. */
function startle(): ClipDef {
  const S = standPose();
  const flat: Edits = {
    earL: [-65, 0, 20],
    earR: [-65, 0, -20],
    tail1: [70, 0, 0],
    tail2: [25, 0, 0],
    tail3: [10, 0, 0],
    head: [-8, 0, 0],
    neck: [6, 0, 0],
  };
  const crouch = crouchLegs(tweak(S, flat, [0, 0.13, -0.13], 1.7), 0.065);
  const air = tweak(S, flat, [0, 0.2, -0.13], 1.7);
  legs(air, forelegs(), { upper: -30, lower: 40, meta: 10, paw: 70 });
  legs(air, hindlegs(), { upper: 50, lower: -70, meta: 60, paw: 88 });
  const landed = crouchLegs(tweak(S, flat, [0, 0.14, -0.13], 1.6), 0.055);
  const wary = tweak(
    S,
    {
      earL: [-20, 0, 8],
      earR: [-20, 0, -8],
      tail1: [40, 0, 0],
      tail2: [12, 0, 0],
      head: [-4, 0, 0],
    },
    [0, 0.185, -0.13],
    1.25,
  );
  crouchLegs(wary, 0.01);
  return {
    duration: 1.1,
    loop: false,
    headFree: false,
    at: keyed([
      [0, crouch],
      [0.14, crouch],
      [0.3, air],
      [0.44, landed],
      [0.7, wary],
      [1.1, S],
    ]),
  };
}

/** Head bump then a flank slide along something on the cat's left. */
function rub(): ClipDef {
  const S = standPose();
  const bump = tweak(S, {
    neck: [16, 10, 0],
    head: [6, 30, 34],
    root: [0, 6, 0],
    tail1: [45, 0, 0],
    tail2: [15, 0, 0],
  });
  const push = tweak(S, {
    neck: [8, -4, 0],
    head: [2, 0, 38],
    root: [0, 14, 8],
    spine1: [0, 6, 2],
    spine2: [0, 6, 2],
    tail1: [55, 15, 0],
    tail2: [15, 10, 0],
    tail3: [5, 10, 0],
  });
  const flank = tweak(S, {
    neck: [0, -14, 0],
    head: [0, -10, 10],
    root: [0, -14, 16],
    spine1: [0, -8, 4],
    spine2: [0, -8, 4],
    spine3: [0, -4, 0],
    tail1: [60, 25, 0],
    tail2: [15, 15, 0],
    tail3: [5, 15, 0],
    tail4: [0, 10, 0],
  });
  const settle = tweak(S, { root: [0, -4, 4], tail1: [30, 10, 0], tail2: [8, 5, 0] });
  return {
    duration: 2.6,
    loop: false,
    headFree: false,
    at: keyed([
      [0, S],
      [0.5, bump],
      [1.0, push],
      [1.7, flank],
      [2.2, settle],
      [2.6, S],
    ]),
  };
}

export function buildClipDefs(): Record<BodyClipName, ClipDef> {
  return {
    idle: idle(),
    walk: gait("walk"),
    trot: gait("trot"),
    "sit-idle": sitIdle(),
    "lie-idle": lieIdle(),
    sleep: sleep(),
    groom: groom(),
    eat: eat(),
    "look-around": lookAround(standPose()),
    "look-around-sit": lookAround(sitPose()),
    "sit-down": sitDown(),
    "stand-up": standUp(),
    "lie-down": lieDown(),
    "get-up": getUp(),
    tuck: tuck(),
    untuck: untuck(),
    stretch: stretch(),
    startle: startle(),
    rub: rub(),
  };
}
