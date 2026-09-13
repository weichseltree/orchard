// Scrubber time maths. Pure, so the slider, the [ ] keys, the VR thumbstick
// and the tests all agree on what a time is.
//
// The legacy field names say tau; their values follow the source time unit.
// Exact frame times take precedence over a nominal cadence. Playback maps
// wall-clock seconds onto the mean ORIGINAL cadence, so retaining every
// second frame changes temporal detail without doubling simulation speed.

import type { TapeVariant } from "./bundle";

/** Source-frame cadences traversed per wall-clock second at 1x. */
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
  /** Exact timestamps for the retained frames, when the bundle carries them. */
  frameTimesTau?: readonly number[];
  /** Source-time units per original-frame cadence, before thinning. */
  playbackDtTau: number;
}

export interface TimelineOptions {
  timesTau?: readonly number[];
  frameStride?: number;
  sourceDtTau?: number;
}

export function timeline(frames: number, dtTau: number, t0Tau = 0, options: TimelineOptions = {}): Timeline {
  if (!Number.isFinite(frames) || frames < 1) throw new RangeError("a timeline needs a finite positive frame count");
  const count = Math.max(1, Math.floor(frames));
  const times = options.timesTau;
  if (times && (times.length !== count || times[0] !== t0Tau ||
      times.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= times[i - 1]!)))) {
    throw new RangeError("frame times must be finite, strictly increasing, and match the timeline");
  }
  const playbackDtTau = options.sourceDtTau ?? dtTau / Math.max(1, options.frameStride ?? 1);
  if (!Number.isFinite(dtTau) || dtTau < 0 || !Number.isFinite(t0Tau) ||
      !Number.isFinite(playbackDtTau) || playbackDtTau < 0 ||
      (count > 1 && (dtTau === 0 || playbackDtTau === 0))) {
    throw new RangeError("timeline cadence must be finite and positive for multiple frames");
  }
  return { frames: count, dtTau, t0Tau, playbackDtTau, ...(times ? { frameTimesTau: times } : {}) };
}

/** One construction path for exhibits and format tests, including old manifests. */
export function variantTimeline(variant: TapeVariant): Timeline {
  return timeline(variant.frames, variant.dt_tau, variant.t0_tau, {
    timesTau: variant.times_tau,
    frameStride: variant.frame_stride,
    sourceDtTau: variant.source_dt_tau,
  });
}

/** Tape time of the last frame, tau. */
export function endTau(tl: Timeline): number {
  return tl.frameTimesTau?.[tl.frames - 1] ?? tl.t0Tau + (tl.frames - 1) * tl.dtTau;
}

/** Length of the tape in tau (0 for a one-frame tape). */
export function durationTau(tl: Timeline): number {
  return endTau(tl) - tl.t0Tau;
}

/** Length of the tape in wall-clock seconds at 1x. */
export function durationSeconds(tl: Timeline): number {
  return tl.playbackDtTau > 0 ? durationTau(tl) / (PLAYBACK_FPS * tl.playbackDtTau) : 0;
}

export function clampTau(tl: Timeline, tau: number): number {
  const lo = tl.t0Tau;
  const hi = endTau(tl);
  if (!Number.isFinite(tau)) return lo;
  return tau < lo ? lo : tau > hi ? hi : tau;
}

/** Nearest frame index to a tape time, clamped into the tape. */
export function frameAt(tl: Timeline, tau: number): number {
  if (!Number.isFinite(tau)) return 0;
  const times = tl.frameTimesTau;
  if (times) {
    let low = 0;
    let high = times.length - 1;
    // Find the first timestamp at or beyond the playhead; nearest wins,
    // choosing the later frame on a tie, just like Math.round for old tapes.
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (times[mid]! < tau) low = mid + 1;
      else high = mid;
    }
    return low > 0 && tau - times[low - 1]! < times[low]! - tau ? low - 1 : low;
  }
  if (tl.dtTau === 0) return 0;
  const raw = Math.round((tau - tl.t0Tau) / tl.dtTau);
  return raw < 0 ? 0 : raw >= tl.frames ? tl.frames - 1 : raw;
}

export function tauOfFrame(tl: Timeline, frame: number): number {
  const index = clampFrame(tl, frame);
  return tl.frameTimesTau?.[index] ?? tl.t0Tau + index * tl.dtTau;
}

/**
 * A compact readout whose rounding error stays below 1/1000 of the nearest
 * frame spacing. Fixed significant digits hide millisecond steps on large
 * absolute clocks; full precision everywhere exposes ordinary float noise.
 * With no neighbouring frame to justify rounding, keep the round-trip text.
 */
export function formatFrameTime(tl: Timeline, frame: number): string {
  const index = clampFrame(tl, frame);
  const value = tauOfFrame(tl, index);
  const before = index > 0 ? value - tauOfFrame(tl, index - 1) : Infinity;
  const after = index + 1 < tl.frames ? tauOfFrame(tl, index + 1) - value : Infinity;
  const spacing = Math.min(before, after);
  if (!(spacing > 0) || !Number.isFinite(spacing)) return String(value);
  const tolerance = spacing / 1000;
  for (let precision = 5; precision <= 17; precision++) {
    const rounded = Number(value.toPrecision(precision));
    if (Math.abs(rounded - value) <= tolerance) return String(rounded);
  }
  return String(value);
}

export function clampFrame(tl: Timeline, frame: number): number {
  if (!Number.isFinite(frame)) return 0;
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
  const next = tau + deltaSeconds * speed * PLAYBACK_FPS * tl.playbackDtTau;
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
