// @someother/cat-proxy — AGPL-3.0-or-later (LICENSE beside this package; Manuel's ruling of
// 2026-09-17, matching the orchard so there is no compatibility question at the seam). The
// licence covers THIS PACKAGE only — body, brain, contract, appearance, and the .glb assets it
// generates. The rest of someotherlife is not licensed, and the owner's cat photographs are not
// part of the package and are not licensed by it.
//
// The cat proxy: the owner's two Ragdolls as a generated, skinned, low-poly body with a DOM-free
// behaviour brain. Everything here is made in code — no downloaded vertex, keyframe or texture.
//
// three.js is a PEER dependency. For a 0.x version a caret pins the minor, so a consumer on
// three ^0.186 and a dependency on ^0.185 would end up with two copies of three in one bundle and
// every `instanceof` across the seam would fail. We need nothing newer than 0.180 (SkinnedMesh,
// AnimationMixer, GLTFExporter); build against whatever single copy the host already runs.
//
// The seam is contract.ts: WorldEvent and BodyState in, BodyCommand out. The brain never imports
// three and never touches the DOM; the body never imports the brain.

export {
  CLIP_POSTURE,
  type BodyCommand,
  type BodyState,
  type ClipName,
  type Posture,
  type Vec2,
  type WorldEvent,
} from "./contract";

export {
  BLUE_POINT,
  BLUE_POINT_KG,
  CATS,
  DEFAULT_APPEARANCE,
  REFERENCE_CAT_KG,
  RIG_SCALE,
  SEAL_POINT,
  sizeForWeight,
  type CatAppearance,
  type CatColours,
  type CatId,
  type CatProportions,
} from "./body/appearance";

export { buildCat, type Cat, type CatPart } from "./body/cat";
export { CatController, FADE } from "./body/controller";
export { GAZE_PITCH_LIMIT, GAZE_YAW_LIMIT, type CatFace } from "./body/face";
export { GAITS, type Gait, type GaitName } from "./body/gait";
export { separate, type Body as SeparableBody } from "./body/separate";
export { buildClipDefs, type BodyClipName, type ClipDef } from "./body/clipdefs";
export { buildClips, sampleClip } from "./body/clips";
export { POSTURE_POSE, type Pose } from "./body/pose";
export { BONES, BONE_NAMES, type BoneName } from "./body/skeleton";
export { planTransitions, postureAfter, pathBetween } from "./body/planner";

export { CatWorld, type CatInWorld, type CatSpec, type CatWorldOptions } from "./world";
export {
  runHeadless,
  exampleHallArena,
  type HeadlessOptions,
  type HeadlessReport,
  type HeadlessCatReport,
} from "./headless";
export { buildCat as buildCatMesh, FULL_DETAIL, type CatDetail } from "./body/cat";
export { OPEN_ARENA, rectArena, type Arena, type Rect, type RectArenaSpec } from "./arena";
export { dist, fleePoint, randomPointNear, resolve } from "./brain/geom";

export {
  BEHAVIOUR_IDS,
  createBrain,
  defaultParams,
  mulberry32,
  simulate,
  type BehaviourId,
  type Brain,
  type BrainParams,
  type DebugSnapshot,
  type DriveName,
  type Drives,
  type Rng,
  type BrainSnapshot,
  type Sensed,
  type SensedCat,
  type SensedVisitor,
  type Visitor,
} from "./brain";
