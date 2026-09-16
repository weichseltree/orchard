import type { Doorway, Mansion, Room } from "./schema";
import { keepOnFlight } from "./terrain";

// Where a step is allowed to land. M0 keeps its promise the cheap way: a per
// room axis-aligned clamp, opened along the one axis a doorway pierces, and
// only across the width of the opening. No mesh collision, but also no walking
// out through a wall and looking at the hall from outside.

/** How far the body's centre stays off a wall, metres. */
export const BODY_RADIUS = 0.35;
/** Shoulder room: the aperture a body may pass is the opening minus this. */
export const DOOR_SHOULDER = 0.15;

export interface MoveResult {
  x: number;
  z: number;
  /** The room the clamped point is in; may differ from the one asked about. */
  room: string;
  /** True when this step crossed a doorway. */
  crossed: boolean;
  /**
   * The room behind a doorway this step was lined up with and `locked` refused,
   * or null. A locked doorway is a wall, and a wall the body can see through
   * needs a reason given or it reads as a bug; this is what the caller says it
   * about. Only set while the body is actually in the opening.
   */
  locked: string | null;
}

interface Span {
  min: number;
  max: number;
}

// resolveMove runs at least once per frame, twice in XR. The spans and the
// open-doorway list are scratch, reused rather than rebuilt; only the result
// object is fresh, because callers keep it.
const _spanX: Span = { min: 0, max: 0 };
const _spanZ: Span = { min: 0, max: 0 };
const _open: Array<{ door: Doorway; neighbour: Room }> = [];
const _nSpanX: Span = { min: 0, max: 0 };
const _nSpanZ: Span = { min: 0, max: 0 };

function inset(room: Room, radius: number, x: Span, z: Span): void {
  x.min = room.bounds.min[0] + radius;
  x.max = room.bounds.max[0] - radius;
  z.min = room.bounds.min[2] + radius;
  z.max = room.bounds.max[2] - radius;
}

function clamp(span: Span, v: number): number {
  if (span.max < span.min) return (span.min + span.max) / 2;
  return v < span.min ? span.min : v > span.max ? span.max : v;
}

/** Is a lateral coordinate inside the passable part of an opening? */
export function inAperture(door: Doorway, lateral: number, radius: number): boolean {
  const half = door.width / 2 - radius - DOOR_SHOULDER;
  if (half <= 0) return false;
  return Math.abs(lateral - door.center) <= half;
}

function lateralOf(door: Doorway, x: number, z: number): number {
  return door.axis === "z" ? x : z;
}

/**
 * Clamps a desired position into the room the body is in, letting it through a
 * doorway whose opening it lines up with. Pure: the same inputs always give the
 * same answer, which is what the tests check and what keeps desktop, phone and
 * XR locomotion honest with each other.
 *
 * `locked` is asked about the room on the far side of each doorway, and a
 * doorway it refuses behaves exactly like a `closed` one: a wall. The caller
 * decides what locked means -- in the grove it is a room the server will not
 * let this visitor into -- and a caller that passes nothing has no locks. The
 * predicate must be pure for this function to stay pure.
 */
export function resolveMove(
  mansion: Mansion,
  roomId: string,
  from: { x: number; z: number },
  to: { x: number; z: number },
  radius: number = BODY_RADIUS,
  locked?: (roomId: string) => boolean,
): MoveResult {
  const room = mansion.rooms.find((r) => r.id === roomId);
  if (!room) return { x: to.x, z: to.z, room: roomId, crossed: false, locked: null };

  inset(room, radius, _spanX, _spanZ);
  const span = { x: _spanX, z: _spanZ };
  const open = _open;
  open.length = 0;
  let lockedRoom: string | null = null;
  for (const door of room.doorways) {
    if (door.closed) continue;
    const neighbour = mansion.rooms.find((r) => r.id === door.to);
    if (!neighbour) continue;
    // The body must line up with the opening both where it is and where it is
    // going, or a sideways slide along the wall would pop it through.
    if (!inAperture(door, lateralOf(door, from.x, from.z), radius)) continue;
    if (!inAperture(door, lateralOf(door, to.x, to.z), radius)) continue;
    // Asked only of a doorway the body is walking into, so that a lock is
    // reported when it is met rather than for every door in the room.
    if (locked?.(door.to)) {
      lockedRoom ??= door.to;
      continue;
    }
    open.push({ door, neighbour });
    const axis = door.axis === "x" ? 0 : 2;
    const target = door.axis === "x" ? span.x : span.z;
    // Extend the wall the doorway is in out to the far side of the neighbour.
    if (Math.abs(door.at - room.bounds.min[axis]) < 1e-6) {
      target.min = neighbour.bounds.min[axis] + radius;
    } else if (Math.abs(door.at - room.bounds.max[axis]) < 1e-6) {
      target.max = neighbour.bounds.max[axis] - radius;
    }
  }

  let x = clamp(span.x, to.x);
  let z = clamp(span.z, to.z);
  // A body that has climbed a flight stays between its cheek walls.
  ({ x, z } = keepOnFlight(mansion, room, from, { x, z }, radius));

  // Past the doorway plane means the body is now in the other room.
  for (const { door, neighbour } of open) {
    const axis = door.axis === "x" ? 0 : 2;
    const here = axis === 0 ? x : z;
    const leaving =
      Math.abs(door.at - room.bounds.min[axis]) < 1e-6 ? here < door.at : here > door.at;
    if (!leaving) continue;
    inset(neighbour, radius, _nSpanX, _nSpanZ);
    // Re-clamp laterally: the neighbour may be a narrower room.
    const nx = door.axis === "x" ? x : clamp(_nSpanX, x);
    const nz = door.axis === "z" ? z : clamp(_nSpanZ, z);
    return { x: nx, z: nz, room: neighbour.id, crossed: true, locked: lockedRoom };
  }

  return { x, z, room: room.id, crossed: false, locked: lockedRoom };
}

/** Whether a point is inside a room's footprint (used by teleport targeting). */
export function insideRoom(room: Room, x: number, z: number, radius = 0): boolean {
  return (
    x >= room.bounds.min[0] + radius &&
    x <= room.bounds.max[0] - radius &&
    z >= room.bounds.min[2] + radius &&
    z <= room.bounds.max[2] - radius
  );
}

/** The room a world point falls in, if any. */
export function roomAt(mansion: Mansion, x: number, z: number): Room | undefined {
  return mansion.rooms.find((room) => insideRoom(room, x, z));
}

/**
 * The rooms a body in `from` could walk to: across doorways that are not
 * closed and lead to rooms `locked` does not refuse, the same walls
 * `resolveMove` enforces. A teleport must stay inside this set, or a pointer
 * aimed through a sealed doorway would land where no walk could go. A portal is
 * not a doorway, so the far side of one is a different set.
 */
export function reachableRooms(
  mansion: Mansion,
  from: string,
  locked?: (roomId: string) => boolean,
): Set<string> {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const room = mansion.rooms.find((r) => r.id === queue.pop());
    if (!room) continue;
    for (const door of room.doorways) {
      if (door.closed || seen.has(door.to) || locked?.(door.to)) continue;
      if (!mansion.rooms.some((r) => r.id === door.to)) continue;
      seen.add(door.to);
      queue.push(door.to);
    }
  }
  return seen;
}
