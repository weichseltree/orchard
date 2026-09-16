// Whether the visitor means to go through. The blend and the crossing used
// to be purely positional: an eye drifting into the core was stepped through,
// and a body brushing past the sphere got the same fade as one walking
// straight in. Intent is a scalar in [0, 1], estimated each frame from the
// eye's filtered velocity (is it closing on the centre, and would it pass
// through the core or miss?), the gaze (is the camera aimed at the centre?)
// and proximity, then integrated with an exponential filter that rises fast
// on a head-on approach and falls slowly, so it never flickers. Everything
// here is plain numbers: no allocation per frame, no three.js.

/** Inside this fraction of the radius the blend is complete and a crossing always happens. */
export const STRICT_CORE = 0.3;
/** With full intent the crossing core grows to this fraction of the radius. */
export const RELAXED_CORE = 0.55;

export const INTENT = {
  /** Closing speed, metres per second, that counts as a full approach (a walk is 2.4). */
  approachSpeed: 1.5,
  /** Intent is gathered within this many radii of the centre; beyond it, nothing. */
  reach: 3,
  /** Time constants of the integrator, seconds: quick to believe, slow to forget. */
  riseSeconds: 0.18,
  fallSeconds: 0.7,
  /** The eye's velocity is smoothed over this long, so a jittering head does not count as motion. */
  velocitySeconds: 0.08,
  /** A frame longer than this is a jump (a tab in the background, a teleport): the velocity restarts. */
  maxStep: 0.25,
  /** So is a frame that moved the eye faster than this, metres per second: nobody walks at it. */
  maxSpeed: 12,
  /** With full intent the blend opens this far outside the sphere, as a fraction of its radius. */
  earlyStart: 0.35,
} as const;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface IntentState {
  /** The estimate, 0..1. */
  intent: number;
  /** The filtered eye velocity, metres per second. */
  vx: number;
  vy: number;
  vz: number;
  /** The previous eye, valid once `seen`. */
  px: number;
  py: number;
  pz: number;
  seen: boolean;
}

export interface IntentSample {
  eye: Vec3Like;
  /** The camera's forward direction, unit length; in a headset, where the head points. */
  forward: Vec3Like;
  center: Vec3Like;
  radius: number;
}

export function createIntentState(): IntentState {
  return { intent: 0, vx: 0, vy: 0, vz: 0, px: 0, py: 0, pz: 0, seen: false };
}

/** Forget the motion history (after a crossing or a teleport the eye jumps) and the estimate with it. */
export function resetIntent(state: IntentState): void {
  state.intent = 0;
  state.vx = state.vy = state.vz = 0;
  state.seen = false;
}

export function clamp01(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

/** Hermite ease, 0..1 → 0..1, flat at both ends. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** The exponential filter's gain for a step of `dt` at time constant `tau`. */
export function filterGain(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

/**
 * One frame of the estimate. `dt` is seconds since the previous sample; the
 * eye's velocity is derived from the previous sample, so the first call after
 * a reset only starts the clock.
 */
export function updateIntent(state: IntentState, sample: IntentSample, dt: number): number {
  if (!(dt > 0)) return state.intent;
  const { eye, forward, center, radius } = sample;

  // The eye's velocity, filtered; a jump in time restarts it.
  const rx = (eye.x - state.px) / dt;
  const ry = (eye.y - state.py) / dt;
  const rz = (eye.z - state.pz) / dt;
  if (!state.seen || dt > INTENT.maxStep || Math.hypot(rx, ry, rz) > INTENT.maxSpeed) {
    state.vx = state.vy = state.vz = 0;
    state.seen = true;
  } else {
    const g = filterGain(dt, INTENT.velocitySeconds);
    state.vx += (rx - state.vx) * g;
    state.vy += (ry - state.vy) * g;
    state.vz += (rz - state.vz) * g;
  }
  state.px = eye.x;
  state.py = eye.y;
  state.pz = eye.z;

  const evidence = intentEvidence(state, forward, center, eye, radius);
  const tau = evidence > state.intent ? INTENT.riseSeconds : INTENT.fallSeconds;
  state.intent = clamp01(state.intent + (evidence - state.intent) * filterGain(dt, tau));
  return state.intent;
}

/** The instantaneous evidence, 0..1, before the integrator: what this frame alone says. */
export function intentEvidence(
  velocity: { vx: number; vy: number; vz: number },
  forward: Vec3Like,
  center: Vec3Like,
  eye: Vec3Like,
  radius: number,
): number {
  const tx = center.x - eye.x;
  const ty = center.y - eye.y;
  const tz = center.z - eye.z;
  const d = Math.hypot(tx, ty, tz);
  // Beyond reach nothing counts; at the rim and inside, everything does.
  const near = clamp01((INTENT.reach * radius - d) / ((INTENT.reach - 1) * radius));
  if (near <= 0) return 0;
  if (d < 1e-6) return near;
  const dx = tx / d;
  const dy = ty / d;
  const dz = tz / d;

  // Closing speed toward the centre, and whether that motion would pass
  // through the core or miss the sphere: the miss distance is the impact
  // parameter of the current velocity, scored from the core (a hit) to the
  // rim (a brush).
  const { vx, vy, vz } = velocity;
  const speed = Math.hypot(vx, vy, vz);
  const closing = vx * dx + vy * dy + vz * dz;
  const approach = clamp01(closing / INTENT.approachSpeed);
  let motionAim = 0;
  if (speed > 1e-3 && closing > 0) {
    const cos = Math.min(1, closing / speed);
    const miss = d * Math.sqrt(1 - cos * cos);
    motionAim = 1 - smoothstep(STRICT_CORE * radius, radius, miss);
  }

  // The gaze: how far from the centre the camera's axis passes, scored the
  // same way, and nothing at all when the head points away (walking backwards).
  const fd = forward.x * dx + forward.y * dy + forward.z * dz;
  let gazeAim = 0;
  if (fd > -0.1) {
    const cos = Math.min(1, Math.max(0, fd));
    const miss = d * Math.sqrt(1 - cos * cos);
    gazeAim = (1 - smoothstep(STRICT_CORE * radius, radius, miss)) * smoothstep(-0.1, 0.3, fd);
  }

  return near * approach * motionAim * (0.15 + 0.85 * gazeAim);
}

/** How committed the visitor is: intent below 0.3 counts for nothing, above 0.9 for everything. */
export function commitment(intent: number): number {
  return smoothstep(0.3, 0.9, intent);
}

/** The fraction of the radius that triggers the crossing: strict at no intent, relaxed at full. */
export function coreFor(intent: number): number {
  return STRICT_CORE + (RELAXED_CORE - STRICT_CORE) * commitment(intent);
}

/**
 * How far into the blend an eye at `distance` from the centre is, 0..1,
 * eased: it reaches 1 exactly where the crossing happens, so the far
 * camera's scale slide ends at one-to-one at the moment of the step through.
 * With intent the blend starts outside the sphere and completes at the
 * relaxed core; without, it matches `blendAt` eased.
 */
export function shapedBlend(distance: number, radius: number, intent: number): number {
  const c = commitment(intent);
  const outer = radius * (1 + INTENT.earlyStart * c);
  const inner = radius * coreFor(intent);
  if (distance >= outer) return 0;
  if (distance <= inner) return 1;
  return smoothstep(0, 1, (outer - distance) / (outer - inner));
}

/** The afterglow's alpha, `elapsed` seconds into a fade of `duration`, from `peak` down to 0, eased. */
export function afterglowAlpha(elapsed: number, duration: number, peak: number): number {
  if (elapsed >= duration) return 0;
  return peak * (1 - smoothstep(0, 1, elapsed / duration));
}

/**
 * The fraction of the vertical field of view a sphere of `radius` at
 * `distance` spans: 1 from inside or when it fills the view, toward 0 far off.
 */
export function screenCoverage(distance: number, radius: number, fovRadians: number): number {
  if (distance <= radius) return 1;
  const angular = Math.asin(radius / distance);
  return clamp01(angular / (fovRadians / 2));
}

/** The far view's resolution as a fraction of the drawing buffer, in steps so the viewport rarely changes. */
export function viewScaleFor(blend: number, coverage: number, min = 0.5, steps = 8): number {
  const want = min + (1 - min) * Math.max(blend, smoothstep(0.3, 1, coverage));
  return Math.min(1, Math.max(min, Math.round(want * steps) / steps));
}

/**
 * Whether the eye counts as inside the sphere for the material's side, with
 * a band of hysteresis just outside the surface: the switch to the inside
 * happens a little before the eye touches the surface, where the far
 * hemisphere shows the same silhouette, so the surface never clips against
 * the near plane and a visitor lingering at the rim never sees it flicker.
 */
export function insideWithHysteresis(wasInside: boolean, distance: number, radius: number): boolean {
  if (distance < radius * 1.06) return true;
  if (distance > radius * 1.15) return false;
  return wasInside;
}

/** Whether an end is near enough for a live far view, with hysteresis so it does not blink at the boundary. */
export function liveWithHysteresis(wasLive: boolean, distance: number, radius: number, radii: number): boolean {
  if (distance < radius * radii) return true;
  if (distance > radius * (radii + 1)) return false;
  return wasLive;
}
