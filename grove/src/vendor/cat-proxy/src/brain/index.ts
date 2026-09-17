export { createBrain, type Brain, type BrainSnapshot } from "./brain";
export {
  defaultParams,
  type BrainParams,
  type BehaviourParams,
  type DriveRates,
  type DwellSpec,
  type TransitionBias,
} from "./params";
export { simulate, type SimEvent, type TimelineEntry } from "./simulate";
export { mulberry32, type Rng } from "./rng";
export { dist, fleePoint, randomPointNear, resolve } from "./geom";
export {
  BEHAVIOUR_IDS,
  type Arena,
  type Rect,
  type Sensed,
  type SensedCat,
  type SensedVisitor,
  type Visitor,
  type BehaviourId,
  type Context,
  type DebugSnapshot,
  type DriveName,
  type Drives,
  type WorldMemory,
} from "./types";
