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
  if (room.id === "stair-court" || room.id === "parterre") {
    const y0 = -5.0;
    const cx = -15.5, cz = -24.5;
    const spanX = 10.5, spanZ = 6.0, rzInner = 7.5;
    const TAN_PI_8 = Math.SQRT2 - 1; // ~0.41421356

    const dx = cx - x, dz = Math.abs(z - cz);
    if (dx <= 0) {
      if (room.id === "stair-court") return y0;
    } else {
      let f1 = 0;
      if (dx > 0) {
        const A1 = spanX * spanZ;
        const B1 = spanX * rzInner - dx * spanZ - TAN_PI_8 * dz * spanX;
        const C1 = -dx * rzInner;
        const disc1 = B1 * B1 - 4 * A1 * C1;
        if (disc1 >= 0) f1 = (-B1 + Math.sqrt(disc1)) / (2 * A1);
      }
      let f0 = 0;
      if (dz > rzInner || dx > 0) {
        const A0 = spanX * spanZ;
        const B0 = spanX * rzInner - TAN_PI_8 * dx * spanZ - dz * spanX;
        const C0 = -TAN_PI_8 * dx * rzInner;
        const disc0 = B0 * B0 - 4 * A0 * C0;
        if (disc0 >= 0) f0 = (-B0 + Math.sqrt(disc0)) / (2 * A0);
      }
      const f = Math.min(1, Math.max(0, f1, f0));
      if (f > 0) {
        if (room.id === "stair-court" || (room.id === "parterre" && x >= -26.0 && dz <= 14.5)) {
          // Terrace landing connections at North (z <= -35) and South (z >= -14) doorways:
          if (dz >= 10.5 && dx >= 0.5 && dx <= 5.0) return 0;

          // West facets 1 & 2 target parterre (-1.6m); North/South facets 0 & 3 target terrace arms (-0.8m):
          const y_top = f1 >= f0 ? -1.6 : -0.8;
          return y0 + f * (y_top - y0);
        }
      }
    }
    if (room.id === "stair-court") return y0;
  }
  if (room.id === "orrery") {
    const distToCenter = Math.hypot(x, z - (-400));
    if (distToCenter <= 14.2) return base + 1.6;
    if (Math.abs(x) <= 4.2 && z >= -388 && z <= -378) {
      const t = (-378 - z) / 10;
      return base + 1.6 * Math.max(0, Math.min(1, t));
    }
    return base;
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
