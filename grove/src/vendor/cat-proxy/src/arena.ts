// Where a cat may walk — injected, never compiled in, and a pair of FUNCTIONS rather than a list
// of rectangles. The consumer's room is the authority: the orchard's hall generates its columns at
// runtime and drops them where a doorway or a hanging suppresses one, so any static array we
// carried would be wrong the first time an exhibit moved. Asking the room instead keeps the cats
// obeying exactly the walls and obstacles its visitors walk on.
//
// This is the grove's own shape (grove/src/world/navigation.ts: resolveMove, insideRoom,
// inAperture, BODY_RADIUS), so no adapter is needed at the seam.

import type { Vec2 } from "./contract";

export interface Arena {
  /** Clamp a proposed step; returns where the cat may actually stand. */
  resolveStep(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
  ): { x: number; z: number };
  /** May a cat of this radius stand here at all? For target selection. */
  canStand(x: number, z: number, radius: number): boolean;
}

/** An axis-aligned rectangle on the floor, metres. */
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RectArenaSpec extends Rect {
  /** Places inside the rectangle a cat may not stand: for our own page and tests. A real room
   * implements `Arena` over its own navigation instead. */
  keepOut?: readonly Rect[];
}

function insideRect(x: number, z: number, r: Rect, margin: number): boolean {
  return (
    x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin
  );
}

/**
 * The default arena: one rectangle, optionally with keep-outs. Enough for the viewer, the tests
 * and anyone whose room really is a box; a room with geometry should implement `Arena` itself.
 */
export function rectArena(spec: RectArenaSpec): Arena & { spec: RectArenaSpec } {
  const zones = spec.keepOut ?? [];
  const eps = 1e-3;

  const canStand = (x: number, z: number, radius: number): boolean => {
    if (
      x < spec.minX + radius ||
      x > spec.maxX - radius ||
      z < spec.minZ + radius ||
      z > spec.maxZ - radius
    ) {
      return false;
    }
    return !zones.some((r) => insideRect(x, z, r, radius));
  };

  /** Out of one keep-out, over whichever edge is nearest that still leaves the cat in the room. */
  const leave = (x: number, z: number, r: Rect, radius: number): Vec2 => {
    const options = [
      { at: { x: r.minX - radius - eps, z }, cost: x - (r.minX - radius) },
      { at: { x: r.maxX + radius + eps, z }, cost: r.maxX + radius - x },
      { at: { x, z: r.minZ - radius - eps }, cost: z - (r.minZ - radius) },
      { at: { x, z: r.maxZ + radius + eps }, cost: r.maxZ + radius - z },
    ].sort((a, b) => a.cost - b.cost);
    const inRoom = options.find(
      (o) =>
        o.at.x >= spec.minX + radius &&
        o.at.x <= spec.maxX - radius &&
        o.at.z >= spec.minZ + radius &&
        o.at.z <= spec.maxZ - radius,
    );
    return (inRoom ?? options[0]!).at;
  };

  const resolveStep = (
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
  ): Vec2 => {
    let x = Math.min(spec.maxX - radius, Math.max(spec.minX + radius, toX));
    let z = Math.min(spec.maxZ - radius, Math.max(spec.minZ + radius, toZ));
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const r of zones) {
        if (insideRect(x, z, r, radius)) {
          const out = leave(x, z, r, radius);
          x = out.x;
          z = out.z;
          moved = true;
        }
      }
      x = Math.min(spec.maxX - radius, Math.max(spec.minX + radius, x));
      z = Math.min(spec.maxZ - radius, Math.max(spec.minZ + radius, z));
      if (!moved) break;
    }
    // A step that cannot be resolved (a cat already standing somewhere illegal, a rectangle
    // narrower than the cat) leaves it where it was rather than teleporting it.
    if (!canStand(x, z, radius) && canStand(fromX, fromZ, radius)) return { x: fromX, z: fromZ };
    return { x, z };
  };

  return { canStand, resolveStep, spec };
}

/** An arena with nothing in it: for a test that does not care, and for a body with no room yet. */
export const OPEN_ARENA: Arena = {
  canStand: () => true,
  resolveStep: (_fromX, _fromZ, toX, toZ) => ({ x: toX, z: toZ }),
};
