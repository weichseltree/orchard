import type { BehaviourId, DriveName, Drives } from "./types";
import { BEHAVIOUR_IDS } from "./types";

/** Per-second (or per-event) drive rates. Everything here is a knob an ethogram can refit. */
export interface DriveRates {
  energyAwakeDecayPerS: number;
  energyAsleepRecoverPerS: number;
  hungerGrowPerS: number;
  affectionGrowPerS: number;
  curiosityGrowPerS: number;
  fearDecayPerS: number; // exponential decay rate, fast
  groomingGrowPerS: number;
  // event-driven, instantaneous
  fearSpikeMax: number; // at zero distance
  fearFalloffM: number; // distance (m) at which a noise spike has halved
  petAffectionRelief: number; // per petted event
  petFearRelief: number; // fraction of current fear removed per petted event
  // continuous relief while the matching behaviour is active
  hungerReliefPerS: number; // while eating
  groomingReliefPerS: number; // while grooming
  curiosityReliefPerS: number; // while investigating or playing
}

/** A log-normal dwell distribution: stays close to medianS most of the time, spread widens it. */
export interface DwellSpec {
  medianS: number;
  spread: number;
}

export interface BehaviourParams {
  dwell: DwellSpec;
  baseUtility: number;
  /** Added as weight * drives[drive] to the base utility. */
  driveWeight: Partial<Record<DriveName, number>>;
}

/** Multiplicative prior on the NEXT behaviour, keyed by the one that just ended. Missing entries
 * default to 1 (no bias). This is what makes "after sleep, stretch/groom" and "no sleep->trot"
 * possible without hard-coding either as special cases in the selector. */
export type TransitionBias = Partial<Record<BehaviourId, Partial<Record<BehaviourId, number>>>>;

export interface BrainParams {
  initialDrives: Drives;
  drives: DriveRates;
  behaviours: Record<BehaviourId, BehaviourParams>;
  transitionBias: TransitionBias;
  temperature: number;
  /** Added to the currently-running behaviour's score when an EVENT tries to interrupt it. */
  commitmentBonus: number;
  /** A behaviour may not be chosen for more than this many consecutive episodes (hard cap; the
   * transition bias diagonal already discourages repeats well below this in practice). */
  maxConsecutiveRepeats: number;
  speedsMPerS: { walk: number; trot: number };
  arrivalRadiusM: number;
  playerNearRadiusM: number;
  /** A reported visitor counts as "near" inside this, and stops counting outside
   * visitorFarRadiusM: the gap is the hysteresis that stops a visitor standing on the boundary
   * from flickering the cat between behaviours. */
  visitorNearRadiusM: number;
  visitorFarRadiusM: number;
  /** How far from a visitor a greeting cat stops. Cats stop short; walking onto someone reads as
   * begging, and at a spawn point as mobbing. */
  greetDistanceM: number;
  /** How far away a visitor can be and still be worth crossing the room for, and how much that
   * proximity is worth on top of the drives. */
  greetNoticeM: number;
  greetNoticeBonus: number;
  /** A cat will not greet the same visitor again within this many seconds: the not-pestering
   * rule. */
  greetCooldownS: number;
  /** How close another cat has to be before this one keeps out of its way. */
  catAvoidM: number;
  petSaturationThreshold: number; // affection AT OR BELOW this counts as "satisfied"
  /** Fear at or above this after a loud noise is a startle reflex: flee without a scoring round,
   * which the commitment bonus and softmax would otherwise sometimes let a standing cat ignore. */
  startleFearThreshold: number;
  salienceDecayPerS: number;
  salienceFloor: number; // below this, a stimulus stops being worth looking at
  /** How far from itself a cat looks for somewhere to wander or investigate. A potter, not a
   * crossing: the dwell times were fitted with targets a couple of metres away, and a bigger
   * radius spends the day walking (the 2h budget test notices). Long journeys still happen —
   * food, a toy, a visitor to greet are wherever they are. */
  wanderRadiusM: number;
  /** The footprint the arena is asked about, metres. The body's own radius overrides it. */
  catRadiusM: number;
}

const dwell = (medianS: number, spread = 0.45): DwellSpec => ({ medianS, spread });

export const defaultParams: BrainParams = {
  // A demo cat should start mid-day awake, not freshly risen from a nap: energy is alertness
  // (sleep/rest use a NEGATIVE weight on it — see the note below), so 0.6 here still left sleep
  // as a real, if minority, first pick (~5% of seeds) because it's the LOWEST-scoring option
  // rather than an excluded one — softmax never zeroes an option, by design. 0.85 pushes sleep's
  // score further negative without special-casing the first decision, so an occasional nap is
  // still possible (this is a starting DRIVE, not a forced state) but no longer the common case.
  initialDrives: {
    energy: 0.85,
    hunger: 0.3,
    affection: 0.4,
    curiosity: 0.3,
    fear: 0,
    grooming: 0.3,
  },
  drives: {
    energyAwakeDecayPerS: 1 / (3 * 3600), // ~3h awake drains it
    energyAsleepRecoverPerS: 1 / (25 * 60), // ~25 min sleep refills it
    hungerGrowPerS: 1 / (5 * 3600),
    affectionGrowPerS: 1 / (2 * 3600),
    curiosityGrowPerS: 1 / (1.5 * 3600),
    fearDecayPerS: 1 / 8, // ~8s time-constant, fast
    groomingGrowPerS: 1 / (2.5 * 3600),
    fearSpikeMax: 0.9,
    fearFalloffM: 4,
    petAffectionRelief: 0.35,
    petFearRelief: 0.6,
    hungerReliefPerS: 1 / 90, // a bowl empties the drive in ~90s of eating
    groomingReliefPerS: 1 / 60,
    curiosityReliefPerS: 1 / 45,
  },
  // Weight sign follows "does high drive make this MORE wanted": positive for hunger->eat,
  // curiosity->investigate/play, affection->approach/seek/accept, grooming->groom, fear->flee.
  // energy is alertness (rises awake->tired is LOW energy), so sleep/rest use a negative energy
  // weight against a positive base — high when tired, negative once fully rested — while
  // wander/play use a positive one (an energetic cat is the one that goes exploring).
  behaviours: {
    sleep: { dwell: dwell(1800, 0.5), baseUtility: 0.55, driveWeight: { energy: -1.35, fear: -1 } },
    // Greeting is short and sociable: a curious, affectionate cat wants it, a frightened one
    // does not. It ends itself when the dwell runs out, which is what "loses interest" means.
    greet: {
      dwell: dwell(18, 0.4),
      baseUtility: 0.05,
      driveWeight: { affection: 0.5, curiosity: 0.35, fear: -1.2 },
    },
    rest: { dwell: dwell(600, 0.5), baseUtility: 0.35, driveWeight: { energy: -0.7, fear: -0.5 } },
    "sit-watch": { dwell: dwell(240, 0.5), baseUtility: 0.2, driveWeight: { curiosity: 0.4 } },
    groom: { dwell: dwell(150, 0.4), baseUtility: 0.1, driveWeight: { grooming: 1.1, fear: -0.4 } },
    wander: {
      dwell: dwell(120, 0.5),
      baseUtility: 0.1,
      driveWeight: { curiosity: 0.35, energy: 0.25 },
    },
    investigate: { dwell: dwell(45, 0.4), baseUtility: 0.05, driveWeight: { curiosity: 0.9 } },
    "approach-player": { dwell: dwell(20, 0.35), baseUtility: 0, driveWeight: { affection: 0.7 } },
    "seek-affection": { dwell: dwell(30, 0.4), baseUtility: 0, driveWeight: { affection: 1.0 } },
    "accept-petting": { dwell: dwell(25, 0.5), baseUtility: 0, driveWeight: {} },
    eat: { dwell: dwell(90, 0.3), baseUtility: -0.1, driveWeight: { hunger: 1.3 } },
    stretch: { dwell: dwell(4, 0.25), baseUtility: -0.3, driveWeight: {} },
    flee: { dwell: dwell(6, 0.3), baseUtility: 0, driveWeight: { fear: 1.6 } },
    play: {
      dwell: dwell(40, 0.45),
      baseUtility: -0.1,
      driveWeight: { curiosity: 0.6, energy: 0.2 },
    },
  },
  transitionBias: {
    sleep: { stretch: 6, groom: 3, rest: 1.5, wander: 0.15, play: 0.05, "sit-watch": 0.3, flee: 1 },
    rest: { stretch: 2, groom: 1.6, sleep: 0.6 },
    "accept-petting": { wander: 1.6, "sit-watch": 1.3 },
  },
  temperature: 0.35,
  commitmentBonus: 0.5,
  maxConsecutiveRepeats: 3,
  speedsMPerS: { walk: 0.41, trot: 0.97 },
  arrivalRadiusM: 0.25,
  playerNearRadiusM: 1.8,
  petSaturationThreshold: 0.15,
  startleFearThreshold: 0.35,
  salienceDecayPerS: 1 / 6,
  salienceFloor: 0.08,
  wanderRadiusM: 2.5,
  catRadiusM: 0.35,
  visitorNearRadiusM: 1.8,
  visitorFarRadiusM: 2.6,
  greetDistanceM: 0.8,
  greetNoticeM: 5,
  greetNoticeBonus: 0.5,
  greetCooldownS: 120,
  catAvoidM: 1.2,
};

// Every behaviour id must have params — a missing entry would silently exclude it forever.
for (const id of BEHAVIOUR_IDS) {
  if (!defaultParams.behaviours[id]) {
    throw new Error(`params.ts: missing BehaviourParams for "${id}"`);
  }
}

export default defaultParams;
