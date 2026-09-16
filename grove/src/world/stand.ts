import { BoxGeometry, Euler, Group, MathUtils, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from "three";

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

export interface Stand {
  group: Group;
  progress: Mesh;
  light: Mesh;
  progressWidth: number;
  dispose(): void;
}

/** Turns a plate's back toward the reader's far side. */
const ABOUT_FACE = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);

/**
 * The reading stand's body: a brass plate over a stem, dark on its back, a
 * dark strip along its foot carrying the lit bar for where the record stands
 * and the lamp for whether it runs (tape-exhibit.ts drives them). The
 * plate's face above the strip is left to the wall text (labels.ts), which
 * paints it from the same frame. The room builds it from the document alone
 * (world.ts), so it stands whether or not the tape loads; `accent` is the
 * bar's colour.
 */
export function buildStand(frame: StandFrame, accent: string | number): Stand {
  const group = new Group();
  group.name = "stand";
  // The architecture's brass and inset (observatory.ts's palette), so the stand belongs to the room.
  const brass = new MeshBasicMaterial({ color: 0xa98551 });
  const dark = new MeshBasicMaterial({ color: 0x101b27 });
  const track = new MeshBasicMaterial({ color: 0x1a221c });
  const height = standHeight();
  const disposables: Array<{ dispose(): void }> = [brass, dark, track];

  const plate = new Mesh(new BoxGeometry(STAND.width + 2 * STAND.border, height + 2 * STAND.border, STAND.thickness), brass);
  plate.name = "stand-plate";
  plate.position.copy(frame.centre);
  plate.quaternion.copy(frame.quaternion);
  group.add(plate);
  disposables.push(plate.geometry);

  const back = new Mesh(new PlaneGeometry(STAND.width, height), dark);
  back.name = "stand-back";
  back.position.copy(frame.centre).addScaledVector(frame.normal, -(STAND.thickness / 2 + 0.002));
  back.quaternion.copy(frame.quaternion).multiply(ABOUT_FACE);
  group.add(back);
  disposables.push(back.geometry);

  // The strip and its controls, in the plate's own frame: x to the reader's right, y up the plate, z off it.
  const controls = new Group();
  controls.name = "stand-controls";
  controls.position.copy(frame.stripCentre).addScaledVector(frame.normal, STAND.thickness / 2 + 0.002);
  controls.quaternion.copy(frame.quaternion);
  group.add(controls);
  const strip = new Mesh(new PlaneGeometry(STAND.width, STAND.stripHeight), dark);
  strip.name = "stand-strip";
  controls.add(strip);
  disposables.push(strip.geometry);

  const width = STAND.width - 0.3;
  const bar = new Group();
  bar.position.set(-0.08, 0, 0.002);
  controls.add(bar);
  const rail = new Mesh(new PlaneGeometry(width, 0.04), track);
  rail.name = "stand-track";
  bar.add(rail);
  disposables.push(rail.geometry);
  const progress = new Mesh(new PlaneGeometry(width, 0.04), new MeshBasicMaterial({ color: accent }));
  progress.name = "stand-progress";
  progress.position.z = 0.001;
  progress.scale.x = 0.001;
  bar.add(progress);
  const light = new Mesh(new PlaneGeometry(0.06, 0.06), new MeshBasicMaterial({ color: accent }));
  light.name = "stand-lamp";
  light.position.set(width / 2 + 0.09, 0, 0.001);
  bar.add(light);

  // The stem up under the plate, and its foot on the floor.
  const stemHeight = Math.max(0.1, frame.centre.y - frame.foot.y - 0.06);
  const stem = new Mesh(new BoxGeometry(0.08, stemHeight, 0.08), brass);
  stem.name = "stand-stem";
  stem.position.set(frame.foot.x, frame.foot.y + stemHeight / 2, frame.foot.z);
  group.add(stem);
  disposables.push(stem.geometry);
  const base = new Mesh(new BoxGeometry(0.56, 0.03, 0.42), dark);
  base.name = "stand-base";
  base.position.set(frame.foot.x, frame.foot.y + 0.015, frame.foot.z);
  base.rotation.y = Math.atan2(frame.front.x, frame.front.z);
  group.add(base);
  disposables.push(base.geometry);

  return {
    group,
    progress,
    light,
    progressWidth: width,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
