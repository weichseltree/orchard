// Scrubber time maths. Pure, so the slider, the [ ] keys, the VR thumbstick
// and the tests all agree on what a time is.
//
// A tape's own clock is tau; a variant hands us `frames` samples `dtTau` apart
// starting at `t0Tau`. Playback maps wall-clock seconds onto that clock at a
// nominal rate (PLAYBACK_FPS tape frames per second at 1x) so that 0.5x .. 4x
// mean what a viewer expects, whatever dt the tape was written with.

/** Tape frames shown per wall-clock second at 1x. */
export const PLAYBACK_FPS = 30;
export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export interface Timeline {
  /** Number of frames in the variant. */
  frames: number;
  /** Time between frames, tau. */
  dtTau: number;
  /** Tape time of frame 0, tau. */
  t0Tau: number;
}

export function timeline(frames: number, dtTau: number, t0Tau = 0): Timeline {
  return { frames: Math.max(1, Math.floor(frames)), dtTau, t0Tau };
}

/** Tape time of the last frame, tau. */
export function endTau(tl: Timeline): number {
  return tl.t0Tau + (tl.frames - 1) * tl.dtTau;
}

/** Length of the tape in tau (0 for a one-frame tape). */
export function durationTau(tl: Timeline): number {
  return (tl.frames - 1) * tl.dtTau;
}

/** Length of the tape in wall-clock seconds at 1x. */
export function durationSeconds(tl: Timeline): number {
  return (tl.frames - 1) / PLAYBACK_FPS;
}

export function clampTau(tl: Timeline, tau: number): number {
  const lo = tl.t0Tau;
  const hi = endTau(tl);
  if (!Number.isFinite(tau)) return lo;
  return tau < lo ? lo : tau > hi ? hi : tau;
}

/** Nearest frame index to a tape time, clamped into the tape. */
export function frameAt(tl: Timeline, tau: number): number {
  if (tl.dtTau === 0) return 0;
  const raw = Math.round((tau - tl.t0Tau) / tl.dtTau);
  return raw < 0 ? 0 : raw >= tl.frames ? tl.frames - 1 : raw;
}

export function tauOfFrame(tl: Timeline, frame: number): number {
  return tl.t0Tau + clampFrame(tl, frame) * tl.dtTau;
}

export function clampFrame(tl: Timeline, frame: number): number {
  const f = Math.round(frame);
  return f < 0 ? 0 : f >= tl.frames ? tl.frames - 1 : f;
}

/**
 * Where playback lands after `deltaSeconds` of wall clock at `speed`.
 * Looping wraps back to the start; otherwise it stops at the end.
 */
export function advance(
  tl: Timeline,
  tau: number,
  deltaSeconds: number,
  speed: number,
  loop = true,
): number {
  const span = durationTau(tl);
  const next = tau + deltaSeconds * speed * PLAYBACK_FPS * tl.dtTau;
  if (!loop || span <= 0) return clampTau(tl, next);
  const rel = next - tl.t0Tau;
  const wrapped = ((rel % span) + span) % span;
  return tl.t0Tau + wrapped;
}

/** The [ and ] keys, and a thumbstick nudge: move by whole frames. */
export function stepFrames(tl: Timeline, tau: number, deltaFrames: number): number {
  return tauOfFrame(tl, frameAt(tl, tau) + Math.round(deltaFrames));
}

/** 0..1 along the tape, for a slider or a pedestal progress bar. */
export function fractionOf(tl: Timeline, tau: number): number {
  const span = durationTau(tl);
  if (span <= 0) return 0;
  return (clampTau(tl, tau) - tl.t0Tau) / span;
}

/** The inverse: a slider position back to tape time. */
export function tauOfFraction(tl: Timeline, fraction: number): number {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return clampTau(tl, tl.t0Tau + f * durationTau(tl));
}

/** Which chunk holds a frame, given the variant's chunk length. */
export function chunkOfFrame(chunkFrames: number, frame: number): number {
  if (chunkFrames <= 0) return 0;
  return Math.floor(frame / chunkFrames);
}

/** The next speed in the 0.5x 1x 2x 4x ring. */
export function nextSpeed(speed: Speed): Speed {
  const i = SPEEDS.indexOf(speed);
  return SPEEDS[(i + 1) % SPEEDS.length] as Speed;
}
