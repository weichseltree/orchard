import type { Hanging, Room } from "./schema";
import { BODY_RADIUS } from "./navigation";
import { standFoot } from "./stand";

// Framing: where to stand to see a hanging whole. Everything here is read from
// the scene document, not the loaded meshes, so the viewing spot is the same
// before a bundle lands, after it fails, and in the tests.

/** What a viewer looks at: a centre, the horizontal way it faces, and its size. */
export interface Face {
  centre: readonly [number, number, number];
  /** Unit, horizontal, pointing out of the face toward where a viewer stands. */
  normal: readonly [number, number];
  width: number;
  height: number;
}

export interface Pose {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Room around the hanging in the frame, so its edges are not the screen's. */
const MARGIN = 1.25;
/** Nearer than this a viewer is reading the canvas weave, not the picture. */
const NEAREST_M = 1.4;

/** The face of a hanging, from mansion.json alone. */
export function hangingFace(room: Room, hanging: Hanging): Face {
  const spawn = room.spawn.position;
  const toward = (from: readonly [number, number, number], to: readonly [number, number, number]): [number, number] =>
    unit(to[0] - from[0], to[2] - from[2]);
  switch (hanging.kind) {
    case "video":
    case "still": {
      const yaw = (hanging.rotationDeg[1] * Math.PI) / 180;
      // Local +Z is the picture's normal (labels.ts reads it the same way).
      const width = hanging.widthMeters;
      const height = hanging.kind === "still" ? hanging.heightMeters : width * (9 / 16);
      return { centre: hanging.position, normal: [Math.sin(yaw), Math.cos(yaw)], width, height };
    }
    case "tape": {
      // A tape is read from its stand, so the viewer stands behind the stand.
      const foot = standFoot(hanging, room.bounds.min[1]).position;
      return { centre: hanging.position, normal: toward(hanging.position, foot), width: hanging.longSideMeters, height: hanging.longSideMeters / 2 };
    }
    case "planet": {
      const n = hanging.worlds.length;
      const centre: [number, number, number] = [0, 0, 0];
      for (const world of hanging.worlds) for (let i = 0; i < 3; i++) centre[i]! += world.position[i]! / n;
      let spread = 0;
      for (const world of hanging.worlds) spread = Math.max(spread, Math.hypot(world.position[0] - centre[0], world.position[2] - centre[2]));
      const radius = hanging.radiusMeters;
      return { centre, normal: toward(centre, spawn), width: 2 * (spread + radius), height: 2 * radius };
    }
    case "model": {
      // Read from where the visitor lands, like its lectern (labels.ts); the
      // model's height is not known before its bundle, so its longest side
      // stands in for it, over the plinth.
      const [x, y, z] = hanging.position;
      const size = hanging.sizeMeters;
      const centre: [number, number, number] = [x, y + (hanging.plinth?.heightMeters ?? 0) + size / 2, z];
      return { centre, normal: toward(centre, spawn), width: size, height: size };
    }
    case "audio":
      return { centre: hanging.position, normal: toward(hanging.position, spawn), width: hanging.sizeMeters, height: hanging.sizeMeters };
  }
}

/**
 * Where to stand and how to look to see a face whole: back along its normal
 * until both its width and its height fit the field of view, never nearer than
 * a comfortable reading distance, and never through the room's wall -- in a
 * shallow room the viewer stands against the far wall and sees what fits.
 */
export function framingPose(face: Face, room: Room, verticalFovDeg: number, aspect: number, eyeHeight: number): Pose {
  const halfV = (verticalFovDeg * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const distance = Math.max(NEAREST_M, MARGIN * Math.max(face.height / 2 / Math.tan(halfV), face.width / 2 / Math.tan(halfH)));
  const [cx, , cz] = face.centre;
  const x = clamp(cx + face.normal[0] * distance, room.bounds.min[0] + BODY_RADIUS, room.bounds.max[0] - BODY_RADIUS);
  const z = clamp(cz + face.normal[1] * distance, room.bounds.min[2] + BODY_RADIUS, room.bounds.max[2] - BODY_RADIUS);
  return lookFrom(x, z, face.centre, room.bounds.min[1] + eyeHeight);
}

/** The yaw and pitch that look from (x, eyeY, z) at a point; the body's forward at yaw 0 is -Z. */
export function lookFrom(x: number, z: number, at: readonly [number, number, number], eyeY: number): Pose {
  const dx = at[0] - x;
  const dz = at[2] - z;
  return { x, z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(at[1] - eyeY, Math.hypot(dx, dz)) };
}

/** The next hanging in the room's authored order, wrapping; from nothing, N takes the first and Shift+N the last. */
export function nextHangingIndex(count: number, current: number | null, delta: 1 | -1): number | null {
  if (count === 0) return null;
  if (current === null || current < 0 || current >= count) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

function unit(x: number, z: number): [number, number] {
  const length = Math.hypot(x, z);
  return length < 1e-6 ? [0, 1] : [x / length, z / length];
}

function clamp(v: number, min: number, max: number): number {
  return max < min ? (min + max) / 2 : v < min ? min : v > max ? max : v;
}
