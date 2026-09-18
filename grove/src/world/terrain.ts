import type { Doorway, Mansion, Mound, Room } from "./schema";

// The lie of the land, as one function. A room's floor is its bounds' base;
// the grounds rise in mounds; and where a doorway joins two floors of
// different height the lower room carries a flight of steps up to the
// opening. The same function places the ground mesh, the trees, the steps and
// the visitor's feet, so a hill you see is a hill you climb and a stair you
// climb is a stair you see. Rooms stay axis-aligned boxes for navigation
// (navigation.ts); height is a property of a point, never a second floor.

/** One step: the rise the eye takes and the tread the foot lands on, metres. */
export const STAIR_RISE = 0.16;
export const STAIR_TREAD = 0.29;
/** A flight is this much wider than its doorway on each side; the cheek walls stand there. */
export const STAIR_MARGIN = 0.5;

/** How many steps climb a given difference of floors. */
export function stairSteps(rise: number): number {
  return Math.max(1, Math.ceil(rise / STAIR_RISE - 1e-6));
}

/** The horizontal length a flight takes, metres, measured from the doorway plane into the lower room. */
export function stairRun(rise: number, tread: number = STAIR_TREAD): number {
  return stairSteps(rise) * tread;
}

/**
 * A mound is a compact quartic bump: exactly zero beyond its radius, smooth
 * at the rim, so a mound placed clear of a doorway never lifts the doorway.
 */
export function moundHeight(mounds: readonly Mound[], x: number, z: number): number {
  let h = 0;
  for (const m of mounds) {
    const dx = x - m.x;
    const dz = z - m.z;
    const q = (dx * dx + dz * dz) / (m.radius * m.radius);
    if (q >= 1) continue;
    const f = 1 - q;
    h += m.height * f * f;
  }
  return h;
}

export interface Flight {
  door: Doorway;
  /** The higher floor's height above this room's base. */
  rise: number;
  /** Horizontal length of the flight, from the doorway plane into the room. */
  run: number;
  /** Which way the flight descends from the doorway: +1 along the axis or -1. */
  direction: 1 | -1;
}

/**
 * The flights this room carries: one per open doorway whose neighbour's floor
 * is higher. The higher room carries none; its doorway is level with its floor.
 */
export function flightsOf(mansion: Mansion, room: Room): Flight[] {
  if (room.id === "stair-court") return [];
  const out: Flight[] = [];
  const base = room.bounds.min[1];
  for (const door of room.doorways) {
    if (door.closed) continue;
    const neighbour = mansion.rooms.find((r) => r.id === door.to);
    if (!neighbour) continue;
    const rise = neighbour.bounds.min[1] - base;
    if (rise <= 1e-6) continue;
    const axis = door.axis === "x" ? 0 : 2;
    const direction: 1 | -1 = Math.abs(door.at - room.bounds.min[axis]) < 1e-6 ? 1 : -1;
    // A door may ask for a longer going: the cellar's descents are gentler than the terrace's steps.
    out.push({ door, rise, run: stairRun(rise, door.treadMeters ?? STAIR_TREAD), direction });
  }
  return out;
}

/** Where a point stands on a flight: 0 at the foot (and beyond), 1 at the doorway plane; null when off the flight. */
export function flightFraction(flight: Flight, x: number, z: number): number | null {
  const { door } = flight;
  const along = door.axis === "x" ? x : z;
  const lateral = door.axis === "x" ? z : x;
  if (Math.abs(lateral - door.center) > door.width / 2 + STAIR_MARGIN) return null;
  const dist = (along - door.at) * flight.direction;
  if (dist < -1e-6 || dist > flight.run) return null;
  return 1 - dist / flight.run;
}

const STAR_ANGLES = [
  -Math.PI / 2,
  -3 * Math.PI / 8,
  -Math.PI / 4,
  -Math.PI / 8,
  0,
  Math.PI / 8,
  Math.PI / 4,
  3 * Math.PI / 8,
  Math.PI / 2,
];

/** Outer radius of the half-octagram (8-pointed star) staircase at a given angle. */
function starOuterRadius(angle: number): number {
  const a = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, angle));
  let k = 0;
  for (let i = 0; i < 8; i++) {
    if (a >= STAR_ANGLES[i]! && a <= STAR_ANGLES[i + 1]! + 1e-9) {
      k = i;
      break;
    }
  }
  const a0 = STAR_ANGLES[k]!, a1 = STAR_ANGLES[k + 1]!;
  const r0_max = Math.min(7.5 / Math.max(0.01, Math.cos(a0)), 13.5 / Math.max(0.01, Math.abs(Math.sin(a0))));
  const r1_max = Math.min(7.5 / Math.max(0.01, Math.cos(a1)), 13.5 / Math.max(0.01, Math.abs(Math.sin(a1))));
  const r0 = r0_max * (k % 2 === 1 ? 0.765367 : 1.0);
  const r1 = r1_max * ((k + 1) % 2 === 1 ? 0.765367 : 1.0);
  const x0 = r0 * Math.cos(a0), z0 = r0 * Math.sin(a0);
  const x1 = r1 * Math.cos(a1), z1 = r1 * Math.sin(a1);
  const cross = x0 * z1 - z0 * x1;
  const denom = (z1 - z0) * Math.cos(a) - (x1 - x0) * Math.sin(a);
  return Math.abs(denom) > 1e-6 ? Math.abs(cross / denom) : r0;
}

/**
 * The height of the floor under a point of this room. Steps are a smooth
 * ramp for the body, so the eye glides rather than hops; the steps you see
 * are drawn to the same run and rise (observatory.ts), never more than one
 * riser from where the foot is.
 */
export function floorAt(mansion: Mansion, room: Room, x: number, z: number): number {
  const base = room.bounds.min[1];
  let h = base;
  if (room.fallback.kind === "ground") h += moundHeight(mansion.terrain.mounds, x, z);
  if (room.id === "stair-court") {
    const y0 = base;
    if (x >= -12.5) return y0;
    const cx = -12.5, cz = -24.5;
    const dx = cx - x, dz = z - cz;
    const r = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx); // [-PI/2, PI/2]
    const sinA = Math.abs(Math.sin(angle));
    const t_terrace = Math.min(1, Math.max(0, (sinA - 0.5) / 0.366));
    const y_top = -1.6 + t_terrace * 1.6;
    const R_max = starOuterRadius(angle);
    const t_r = Math.min(1, Math.max(0, r / R_max));
    return y0 + t_r * (y_top - y0);
  }
  for (const flight of flightsOf(mansion, room)) {
    const t = flightFraction(flight, x, z);
    if (t === null) continue;
    h = Math.max(h, base + flight.rise * t);
  }
  return h;
}

/**
 * The cheek walls of a flight, both ways: a body that has climbed onto a
 * flight may not step off it sideways into the air, and a body walking past
 * a raised flight may not walk through its cheek into it. Only the second
 * of those used to be enforced by the drawn stone; with the walk clamped
 * INTO the flight's span, a visitor walking the terrace by the orangery was
 * pulled through one cheek wall and held against the other (Manuel,
 * 2026-09-17). Returns the corrected destination.
 */
export function keepOnFlight(
  mansion: Mansion,
  room: Room,
  from: { x: number; z: number },
  to: { x: number; z: number },
  radius: number,
): { x: number; z: number } {
  for (const flight of flightsOf(mansion, room)) {
    const lateralOf = (p: { x: number; z: number }) => (flight.door.axis === "x" ? p.z : p.x);
    const centre = flight.door.center;
    const t = flightFraction(flight, from.x, from.z);
    const on = t !== null && t >= 0.02;
    const half = flight.door.width / 2 + STAIR_MARGIN;
    const lateral = lateralOf(to);
    let clamped = lateral;
    if (on) {
      // Between the cheeks, the way the steps are drawn.
      clamped = Math.min(centre + half - radius, Math.max(centre - half + radius, lateral));
    } else {
      // Outside it: the cheek is a wall as high as the flight beside it, so
      // the body stops at its face rather than stepping into mid-flight.
      const into = flightFraction(flight, to.x, to.z);
      const rise = into === null ? 0 : flight.rise * into;
      if (into === null || rise <= STAIR_RISE) continue;
      const side = Math.sign(lateralOf(from) - centre) || 1;
      const face = centre + side * (half + radius);
      clamped = side > 0 ? Math.max(face, lateral) : Math.min(face, lateral);
    }
    if (clamped === lateral) continue;
    return flight.door.axis === "x" ? { x: to.x, z: clamped } : { x: clamped, z: to.z };
  }
  return { x: to.x, z: to.z };
}
