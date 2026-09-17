import type { Vec2 } from "../contract";
import type { Arena } from "../arena";
import type { Rng } from "./rng";

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** A place the cat could actually go: sampled around it, rejected against the room it was given,
 * and finally resolved by the room itself so that even a failed sample lands somewhere legal.
 * Sampling around the cat rather than inside a rectangle is what lets the arena be a pair of
 * functions instead of bounds — the room knows where its walls are; we do not. */
export function randomPointNear(
  rng: Rng,
  from: Vec2,
  radiusM: number,
  arena: Arena,
  catRadius: number,
): Vec2 {
  for (let tries = 0; tries < 14; tries++) {
    const angle = rng() * Math.PI * 2;
    // sqrt keeps the samples even over the disc instead of crowding the middle.
    const r = radiusM * Math.sqrt(rng());
    const at = { x: from.x + Math.cos(angle) * r, z: from.z + Math.sin(angle) * r };
    if (arena.canStand(at.x, at.z, catRadius)) return at;
  }
  const angle = rng() * Math.PI * 2;
  return arena.resolveStep(
    from.x,
    from.z,
    from.x + Math.cos(angle) * radiusM * 0.5,
    from.z + Math.sin(angle) * radiusM * 0.5,
    catRadius,
  );
}

/** The nearest place to `to` the cat may stand, as the room sees it. */
export function resolve(from: Vec2, to: Vec2, arena: Arena, catRadius: number): Vec2 {
  return arena.resolveStep(from.x, from.z, to.x, to.z, catRadius);
}

/** A point `awayM` metres from `from`, directly opposite `source`, that the cat may stand on. */
export function fleePoint(
  from: Vec2,
  source: Vec2 | null,
  awayM: number,
  arena: Arena,
  catRadius: number,
  rng: Rng,
): Vec2 {
  let dx: number;
  let dz: number;
  if (source && dist(source, from) > 1e-6) {
    dx = from.x - source.x;
    dz = from.z - source.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
  } else {
    const angle = rng() * Math.PI * 2;
    dx = Math.cos(angle);
    dz = Math.sin(angle);
  }
  // Try the full distance, then shorter ones: a cat backed against a wall still gets somewhere.
  for (const scale of [1, 0.7, 0.45, 0.25]) {
    const at = { x: from.x + dx * awayM * scale, z: from.z + dz * awayM * scale };
    if (arena.canStand(at.x, at.z, catRadius)) return at;
  }
  return resolve(from, { x: from.x + dx * awayM, z: from.z + dz * awayM }, arena, catRadius);
}
