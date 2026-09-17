import type { Mansion, Room } from "../world/schema";
import { BODY_RADIUS, insideRoom, reachableRooms, roomAt } from "../world/navigation";
import { floorAt } from "../world/terrain";
import { clampPitch, moveTo, STRIDE, type Body } from "./locomotion";

// Go, the verb (INTERACTION.md §1.2): click or tap a floor point and the body
// glides there. A glide is a walk in a straight line that nobody has to steer,
// so it is planned by walking it first, through the same clamp, and refused
// when the walk would not arrive.

export interface Glide {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  fromYaw: number;
  toYaw: number;
  fromPitch: number;
  toPitch: number;
  /** Whether the glide turns the head as well; looking around during it gives the head back. */
  turn: boolean;
  elapsed: number;
  duration: number;
}

export type GlideRefusal = "no floor" | "locked" | "out of reach" | "in the way";

/**
 * The room a floor point belongs to for this body: one of its own scale, its
 * own room when that holds the point, else the one whose floor is nearest the
 * height given. Rooms stand over one another (the club under the north wing),
 * so a plan position alone does not name a room.
 */
export function roomUnder(mansion: Mansion, body: Body, x: number, z: number, y = body.y, radius = BODY_RADIUS): Room | undefined {
  const scale = mansion.rooms.find((r) => r.id === body.room)?.scale ?? 1;
  return roomAt({ ...mansion, rooms: mansion.rooms.filter((r) => r.scale === scale) }, x, z, radius, y, body.room);
}

/** How near the walk must end to the point asked for, metres. */
const ARRIVE_M = 0.05;

/**
 * Checks a floor point and plans the glide to it, or says why not: the point
 * must be a floor a body fits on, in a room of the body's scale that a walk
 * could reach, and the straight walk there must arrive. `face` turns the head
 * to a yaw and pitch on the way (framing an exhibit).
 */
export function planGlide(
  mansion: Mansion,
  body: Body,
  x: number,
  z: number,
  locked?: (roomId: string) => boolean,
  face?: { yaw: number; pitch: number },
): Glide | GlideRefusal {
  const room = roomUnder(mansion, body, x, z);
  if (!room) return "no floor";
  if (room.id !== body.room) {
    if (locked?.(room.id)) return "locked";
    if (!reachableRooms(mansion, body.room, locked).has(room.id)) return "out of reach";
  }
  // Stride by stride, and on the line all the way: a walk that slid along a
  // wall into a doorway would arrive, but not by the glide the visitor sees.
  const trial: Body = { ...body, crossedInto: null, lockedOut: null };
  const strides = Math.max(1, Math.ceil(Math.hypot(x - body.x, z - body.z) / STRIDE));
  for (let i = 1; i <= strides; i++) {
    const px = body.x + ((x - body.x) * i) / strides;
    const pz = body.z + ((z - body.z) * i) / strides;
    moveTo(trial, px, pz, mansion, locked);
    if (Math.hypot(trial.x - px, trial.z - pz) > ARRIVE_M) return trial.lockedOut ? "locked" : "in the way";
  }
  if (trial.room !== room.id) return "in the way";
  const toYaw = face ? body.yaw + wrap(face.yaw - body.yaw) : body.yaw;
  const toPitch = face ? clampPitch(face.pitch) : body.pitch;
  const distance = Math.hypot(x - body.x, z - body.z);
  return {
    fromX: body.x,
    fromZ: body.z,
    toX: x,
    toZ: z,
    fromYaw: body.yaw,
    toYaw,
    fromPitch: body.pitch,
    toPitch,
    turn: face !== undefined,
    elapsed: 0,
    duration: glideSeconds(distance, Math.abs(toYaw - body.yaw)),
  };
}

/** Long enough to read as motion, short enough that a far point is not a wait. */
export function glideSeconds(distance: number, turn = 0): number {
  return Math.min(1.8, Math.max(0.4, 0.35 + distance * 0.08 + turn * 0.25));
}

/** Slow out, slow in: a glide that starts and stops like a step, not a cut. */
export function ease(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * One frame of a glide. "blocked" when the body is no longer where the glide
 * put it: a door locked under it, or a portal took it elsewhere.
 */
export function stepGlide(
  body: Body,
  glide: Glide,
  dt: number,
  mansion: Mansion,
  locked?: (roomId: string) => boolean,
): "moving" | "arrived" | "blocked" {
  glide.elapsed += dt;
  const t = Math.min(1, glide.elapsed / glide.duration);
  const e = ease(t);
  const x = glide.fromX + (glide.toX - glide.fromX) * e;
  const z = glide.fromZ + (glide.toZ - glide.fromZ) * e;
  moveTo(body, x, z, mansion, locked);
  if (glide.turn) {
    body.yaw = glide.fromYaw + (glide.toYaw - glide.fromYaw) * e;
    body.pitch = glide.fromPitch + (glide.toPitch - glide.fromPitch) * e;
  }
  if (Math.hypot(body.x - x, body.z - z) > 0.25) return "blocked";
  return t >= 1 ? "arrived" : "moving";
}

/**
 * Where a view ray meets a floor: the nearest room floor of this scale the
 * ray comes down onto, then corrected twice for the grounds' mounds and the
 * stairs. Walls are not in it; `planGlide` refuses a point behind one.
 */
export function floorHit(
  mansion: Mansion,
  scale: number,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
): { x: number; y: number; z: number; room: Room; distance: number } | null {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = direction;
  if (dy >= -1e-4) return null;
  let best: { x: number; y: number; z: number; room: Room; distance: number } | null = null;
  for (const room of mansion.rooms) {
    if (room.scale !== scale) continue;
    let t = (room.bounds.min[1] - oy) / dy;
    if (t <= 0) continue;
    let x = ox + dx * t;
    let z = oz + dz * t;
    if (!insideRoom(room, x, z)) continue;
    for (let i = 0; i < 2; i++) {
      t = (floorAt(mansion, room, x, z) - oy) / dy;
      x = ox + dx * t;
      z = oz + dz * t;
    }
    if (t > 0 && insideRoom(room, x, z) && (!best || t < best.distance)) {
      best = { x, y: oy + dy * t, z, room, distance: t };
    }
  }
  return best;
}

/** An angle folded into -pi..pi, so a turn takes the short way round. */
export function wrap(angle: number): number {
  return angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));
}
