// Locomotion toward a point, without THREE: turn in place when the target is far off the
// heading, arc toward it otherwise, and slow into the last stretch. Speed never exceeds what the
// gait was authored for, so the clip's stride matches the ground covered and the feet do not skate.

import type { Vec2 } from "../contract";

export interface Mover {
  position: Vec2;
  /** Radians, 0 = +z, positive turns left (about +y). */
  heading: number;
}

export interface SteerOptions {
  /** The gait's authored speed, m/s: the ceiling. */
  maxSpeed: number;
  /** Radians per second. */
  turnRate: number;
  /** The target counts as reached inside this distance. */
  arriveRadius: number;
  /** Speed ramps down linearly inside this distance. */
  slowRadius: number;
  /** Beyond this heading error the cat turns in place at a shuffle. */
  turnInPlaceAngle: number;
}

export const DEFAULT_STEER: SteerOptions = {
  maxSpeed: 0.45,
  turnRate: 3.0,
  arriveRadius: 0.06,
  slowRadius: 0.35,
  turnInPlaceAngle: 1.1,
};

export interface SteerResult {
  position: Vec2;
  heading: number;
  /** Ground speed this step, m/s. */
  speed: number;
  /** Signed turn this step, rad/s. */
  turnRate: number;
  arrived: boolean;
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function headingTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function steer(m: Mover, target: Vec2, dt: number, o: SteerOptions): SteerResult {
  const dist = distance(m.position, target);
  if (dist <= o.arriveRadius) {
    return { position: m.position, heading: m.heading, speed: 0, turnRate: 0, arrived: true };
  }
  const error = wrapAngle(headingTo(m.position, target) - m.heading);
  const maxTurn = o.turnRate * dt;
  const turn = Math.max(-maxTurn, Math.min(maxTurn, error));
  const heading = wrapAngle(m.heading + turn);

  let speed = o.maxSpeed * Math.min(1, dist / o.slowRadius);
  if (Math.abs(error) > o.turnInPlaceAngle) speed = o.maxSpeed * 0.15;
  // Do not step past the target in one frame.
  speed = Math.min(speed, dist / Math.max(dt, 1e-6));

  const position = {
    x: m.position.x + Math.sin(heading) * speed * dt,
    z: m.position.z + Math.cos(heading) * speed * dt,
  };
  return {
    position,
    heading,
    speed,
    turnRate: dt > 0 ? turn / dt : 0,
    arrived: distance(position, target) <= o.arriveRadius,
  };
}
