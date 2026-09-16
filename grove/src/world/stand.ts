import { Euler, MathUtils, Quaternion, Vector3 } from "three";

// The reading stand at a tape: one tilted plate over a brass stem. Its upper
// part is the wall text's face (labels.ts paints it in the visitor's
// language); the strip along its foot is the tape's own, a lit bar for where
// the record stands and a lamp for whether it runs (tape-exhibit.ts). The two
// modules never see each other's meshes: both place theirs from this frame,
// so the text sits on the plate the tape built. It replaced the plinth that
// stood beside the sheet with the bar on top (ruled 2026-09-16).

/** The plate: its face for the text, its strip for the tape's bar and lamp; metres. */
export const STAND = {
  width: 1.0,
  faceHeight: 0.72,
  stripHeight: 0.16,
  /** The plate's top edge above the stand's foot. */
  top: 1.1,
  tiltDeg: 32,
  thickness: 0.035,
  /** The brass shows this much round the face and the strip. */
  border: 0.03,
  texture: [1024, 736] as const,
} as const;

export interface StandFrame {
  foot: Vector3;
  /** Horizontal, the way a reader faces the plate from. */
  front: Vector3;
  /** A reader's right. */
  right: Vector3;
  /** The plate's quaternion: local +z its normal, local +y up its face. */
  quaternion: Quaternion;
  normal: Vector3;
  up: Vector3;
  /** The whole plate's centre. */
  centre: Vector3;
  /** The text's face, the upper part of the plate. */
  faceCentre: Vector3;
  /** The tape's strip along the plate's foot. */
  stripCentre: Vector3;
}

/** The plate's total height, face and strip. */
export function standHeight(): number {
  return STAND.faceHeight + STAND.stripHeight;
}

/**
 * Where a tape's stand stands: the document's `pedestal` when it authors
 * one, else half the long side ahead of the sheet's centre on +z, a step
 * back. Always on the room's floor. Both the tape and the wall text place
 * from this, so a document without a `pedestal` still gets one stand with
 * the text on it.
 */
export function standFoot(
  hanging: { position: readonly [number, number, number]; longSideMeters: number; pedestal?: { position: readonly [number, number, number]; rotationDeg: readonly [number, number, number] } | undefined },
  floor: number,
): { position: [number, number, number]; rotationDeg: readonly [number, number, number] } {
  if (hanging.pedestal) {
    return { position: [hanging.pedestal.position[0], floor, hanging.pedestal.position[2]], rotationDeg: hanging.pedestal.rotationDeg };
  }
  return { position: [hanging.position[0], floor, hanging.position[2] + hanging.longSideMeters / 2 + 0.6], rotationDeg: [0, 0, 0] };
}

/**
 * Where a stand's plate is for a foot and a yaw (degrees about y; 0 faces +z).
 * Plate up-vector (0, sin t, -cos t) and normal (0, cos t, sin t) in the
 * stand's frame with the reader at +z: a rotation of -(90° - t) about x,
 * then the yaw that turns +z onto `front`.
 */
export function standFrame(position: readonly [number, number, number], rotationDeg: readonly [number, number, number] = [0, 0, 0]): StandFrame {
  const foot = new Vector3(position[0], position[1], position[2]);
  const yaw = MathUtils.degToRad(rotationDeg[1]);
  const tilt = MathUtils.degToRad(STAND.tiltDeg);
  const front = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const quaternion = new Quaternion().setFromEuler(new Euler(0, yaw, 0)).multiply(new Quaternion().setFromEuler(new Euler(-(Math.PI / 2 - tilt), 0, 0)));
  const normal = new Vector3(0, 0, 1).applyQuaternion(quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(quaternion);
  const height = standHeight();
  const centre = new Vector3(foot.x, foot.y + STAND.top - (height / 2) * Math.sin(tilt), foot.z);
  return {
    foot,
    front,
    right,
    quaternion,
    normal,
    up,
    centre,
    faceCentre: centre.clone().addScaledVector(up, STAND.stripHeight / 2),
    stripCentre: centre.clone().addScaledVector(up, -STAND.faceHeight / 2),
  };
}
