import type { Mansion } from "../world/schema";
import { resolveMove, BODY_RADIUS } from "../world/navigation";
import type { InputState } from "./input";

// The body: where the visitor is, which room they are in, and which way they
// face. Locomotion is deliberately dull — a speed, a heading, and the clamp
// from navigation.ts. Nothing here knows about mice, thumbsticks or fingers.

export const WALK_SPEED = 2.4;
export const RUN_SPEED = 4.2;
export const MAX_PITCH = Math.PI / 2 - 0.05;

export interface Body {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  room: string;
  /** The scale of the room the body is in (schema.ts); a portal is the only thing that changes it. */
  scale: number;
  /** Set for one frame after a doorway or portal crossing. */
  crossedInto: string | null;
}

export function createBody(x: number, z: number, yaw: number, room: string, scale = 1): Body {
  return { x, z, yaw, pitch: 0, room, scale, crossedInto: null };
}

/**
 * Applies one frame of intent. `heading` is the direction "forward" means:
 * the body's yaw on the desktop, the head's yaw in XR (you walk where you
 * look, not where the rig happens to point).
 */
export function step(
  body: Body,
  input: InputState,
  dt: number,
  mansion: Mansion,
  heading: number = body.yaw,
): void {
  body.crossedInto = null;
  body.yaw -= input.yawDelta;
  body.pitch = clampPitch(body.pitch - input.pitchDelta);

  const forward = input.forward;
  const strafe = input.strafe;
  if (forward === 0 && strafe === 0) return;

  const speed = (input.run ? RUN_SPEED : WALK_SPEED) * dt;
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  // Three's forward is -Z.
  let dx = -sin * forward + cos * strafe;
  let dz = -cos * forward - sin * strafe;
  const length = Math.hypot(dx, dz);
  if (length > 1) {
    dx /= length;
    dz /= length;
  }
  const result = resolveMove(
    mansion,
    body.room,
    { x: body.x, z: body.z },
    { x: body.x + dx * speed, z: body.z + dz * speed },
    BODY_RADIUS,
  );
  body.x = result.x;
  body.z = result.z;
  if (result.crossed) {
    body.room = result.room;
    body.crossedInto = result.room;
  }
}

/**
 * Room-scale walking in XR: the head can leave the room even though the rig
 * has not moved. Push the rig back by however far the head went past the wall.
 */
export function clampHead(
  body: Body,
  headX: number,
  headZ: number,
  mansion: Mansion,
): { dx: number; dz: number } {
  const result = resolveMove(
    mansion,
    body.room,
    { x: body.x, z: body.z },
    { x: headX, z: headZ },
    BODY_RADIUS,
  );
  if (result.crossed) {
    body.room = result.room;
    body.crossedInto = result.room;
  }
  return { dx: result.x - headX, dz: result.z - headZ };
}

export function clampPitch(pitch: number): number {
  return pitch < -MAX_PITCH ? -MAX_PITCH : pitch > MAX_PITCH ? MAX_PITCH : pitch;
}

/** Teleport: only onto a floor inside a room. */
export function teleport(body: Body, mansion: Mansion, x: number, z: number): boolean {
  const room = mansion.rooms.find(
    (r) =>
      x >= r.bounds.min[0] + BODY_RADIUS &&
      x <= r.bounds.max[0] - BODY_RADIUS &&
      z >= r.bounds.min[2] + BODY_RADIUS &&
      z <= r.bounds.max[2] - BODY_RADIUS,
  );
  if (!room) return false;
  body.x = x;
  body.z = z;
  if (room.id !== body.room) {
    body.room = room.id;
    body.crossedInto = room.id;
  }
  return true;
}
