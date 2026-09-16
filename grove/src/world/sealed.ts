import { Vector3 } from "three";
import type { Doorway, Room } from "./schema";

// A closed doorway's lens: shared by the architecture, which leaves a dark
// recess and a brass halo round it (observatory.ts), by the portal system,
// which hangs the glass there (portal.ts), and by the light bake, for
// which it is a dim emitter (lightfield.ts). Small on purpose: portal.ts is
// on the startup path and the architecture is not.

/** The sealed doors' lens and glow: the portal's glass, dimmed, for a room not yet open. */
export const SEALED_TINT = "#4b5f72";
/** A closed doorway's lens fills this much of its narrower dimension. */
export const SEALED_LENS_FRACTION = 0.42;
/** How far a sealed lens stands into the wall from its room's face, metres. */
export const SEALED_LENS_INSET_M = 0.12;

/** The lens of a closed doorway: where it stands, how big, which way it faces into the room; null for an open door or a gate. */
export function sealedLens(room: Room, door: Doorway): { center: Vector3; radius: number; normal: Vector3 } | null {
  if (!door.closed || door.width > 8) return null;
  const [x0, y0, z0] = room.bounds.min, [x1, , z1] = room.bounds.max;
  const inward = door.axis === "x"
    ? (Math.abs(door.at - x0) < 0.001 ? 1 : Math.abs(door.at - x1) < 0.001 ? -1 : 0)
    : (Math.abs(door.at - z0) < 0.001 ? 1 : Math.abs(door.at - z1) < 0.001 ? -1 : 0);
  if (inward === 0) return null;
  const radius = Math.min(door.width, door.height) * SEALED_LENS_FRACTION;
  const y = y0 + door.height / 2;
  const across = door.at + inward * SEALED_LENS_INSET_M;
  const center = door.axis === "x" ? new Vector3(across, y, door.center) : new Vector3(door.center, y, across);
  const normal = door.axis === "x" ? new Vector3(inward, 0, 0) : new Vector3(0, 0, inward);
  return { center, radius, normal };
}
