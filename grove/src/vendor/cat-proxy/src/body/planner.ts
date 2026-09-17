// The posture graph is a line, stand - sit - lie - loaf, and every transition clip moves one step
// along it. Planning a request is walking that line from the current posture to the posture the
// clip starts from, then playing the clip. Pure, so the brain's expectations can be tested against
// the body's without a renderer.

import { CLIP_POSTURE, type ClipName, type Posture } from "../contract";

const LINE: readonly Posture[] = ["stand", "sit", "lie", "loaf"];

const STEP_UP: Record<Posture, ClipName | null> = {
  stand: null,
  sit: "stand-up",
  lie: "get-up",
  loaf: "untuck",
};

const STEP_DOWN: Record<Posture, ClipName | null> = {
  stand: "sit-down",
  sit: "lie-down",
  lie: "tuck",
  loaf: null,
};

/** The transition clips that take the body from `from` to `to`, in order; empty when equal. */
export function pathBetween(from: Posture, to: Posture): ClipName[] {
  const out: ClipName[] = [];
  let at = LINE.indexOf(from);
  const goal = LINE.indexOf(to);
  while (at !== goal) {
    const step = at < goal ? STEP_DOWN[LINE[at]!] : STEP_UP[LINE[at]!];
    if (!step) throw new Error(`no step from ${LINE[at]}`);
    out.push(step);
    at += at < goal ? 1 : -1;
  }
  return out;
}

/** The posture a clip that starts "anywhere" should be reached from: it has a variant for stand
 * and sit, and a lying or loafing cat gets up as far as sitting first. */
export function anyPostureStart(clip: ClipName, from: Posture): Posture {
  if (clip === "startle") return from;
  return from === "stand" || from === "sit" ? from : "sit";
}

/** Every clip to play, in order, ending with `clip` itself. */
export function planTransitions(from: Posture, clip: ClipName): ClipName[] {
  const start = CLIP_POSTURE[clip].from;
  const target = start === "any" ? anyPostureStart(clip, from) : start;
  return [...pathBetween(from, target), clip];
}

/** The posture the body is in once `clip` has finished, given where it started. */
export function postureAfter(clip: ClipName, from: Posture): Posture {
  const spec = CLIP_POSTURE[clip];
  if (clip === "look-around") return anyPostureStart(clip, from);
  return spec.to;
}
