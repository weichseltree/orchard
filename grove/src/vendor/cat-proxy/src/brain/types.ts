import type { ClipName, Vec2 } from "../contract";
import type { Arena } from "../arena";

/** The closed set of drive names. Every one lives in 0..1. */
export type DriveName = "energy" | "hunger" | "affection" | "curiosity" | "fear" | "grooming";

/**
 * energy: awake spends it, sleep restores it.
 * hunger: rises until fed.
 * affection: the cat's need for contact — NOT how much it has; petting brings it down.
 * curiosity: rises until something novel is investigated or played with.
 * fear: near-zero normally, spikes on a startling event, decays fast.
 * grooming: coat-care urge, rises until groomed.
 */
export type Drives = Record<DriveName, number>;

/** The closed set of behaviour ids (lowercase-kebab, stable — an ethogram will key off these). */
export type BehaviourId =
  | "sleep"
  | "greet"
  | "rest"
  | "sit-watch"
  | "groom"
  | "wander"
  | "investigate"
  | "approach-player"
  | "seek-affection"
  | "accept-petting"
  | "eat"
  | "stretch"
  | "flee"
  | "play";

export const BEHAVIOUR_IDS: readonly BehaviourId[] = [
  "sleep",
  "greet",
  "rest",
  "sit-watch",
  "groom",
  "wander",
  "investigate",
  "approach-player",
  "seek-affection",
  "accept-petting",
  "eat",
  "stretch",
  "flee",
  "play",
];

/** Where a cat may walk is asked of the room, not compiled in: see arena.ts. */
export type { Arena, Rect } from "../arena";

/** A visitor the consumer reported this tick. The id is what makes "do not pester the same
 * person twice" possible; use a stable one per person (a session id, a player id). */
export interface Visitor {
  id: string;
  at: Vec2;
}

/** A visitor, with what the brain worked out about it. */
export interface SensedVisitor extends Visitor {
  distance: number;
  /** Seconds since this cat last greeted this visitor; Infinity if never. */
  sinceGreeted: number;
}

/** Another cat on the same floor, as its own brain last reported itself. */
export interface SensedCat {
  id: string;
  at: Vec2;
  behaviour: BehaviourId | null;
  /** The visitor that cat is greeting, if any: two cats must not mob the same person. */
  greeting?: string | null;
}

/** What the consumer tells the brain each tick, besides the body. The visitor list is the
 * primary seam; WorldEvents still work and are still the way one-off things (a noise, a hand,
 * a bowl of food) arrive. */
export interface Sensed {
  visitors?: readonly Visitor[];
  cats?: readonly SensedCat[];
}

/** A remembered point of interest, with the time it was last refreshed. */
export interface KnownPoint {
  at: Vec2;
  since: number;
}

/** What the brain remembers about the world between events. */
export interface WorldMemory {
  player: KnownPoint | null;
  playerNear: boolean;
  hand: KnownPoint | null;
  food: KnownPoint | null;
  toy: KnownPoint | null;
  noise: KnownPoint | null;
}

export type SalienceSource = "noise" | "toy" | "hand" | "player" | "food";

export interface SalienceEntry {
  at: Vec2;
  since: number;
  strength: number; // 0..1 at the moment it was set; decays from there
}

export type SalienceMap = Partial<Record<SalienceSource, SalienceEntry>>;

/** Everything a utility/plan function needs beyond the raw drives. */
export interface Context {
  now: number;
  /** The room, as a pair of functions. Every target picker asks it before committing. */
  arena: Arena;
  /** This cat's footprint, in metres: what the arena's questions are asked about. */
  catRadius: number;
  position: Vec2;
  world: WorldMemory;
  playerDistance: number; // Infinity if unknown
  foodDistance: number;
  toyDistance: number;
  noiseDistance: number;
  sinceLastDone: (id: BehaviourId) => number; // seconds, Infinity if never
  sinceWoke: number; // seconds since the last sleep ended, Infinity if never slept
  current: BehaviourId | null;
  /** Visitors reported this tick, nearest first. Empty when the consumer reports none. */
  visitors: readonly SensedVisitor[];
  /** The visitor this cat may greet: the nearest one it has not greeted lately and that no
   * other cat has claimed. Null when there is nobody worth greeting. */
  greetTarget: SensedVisitor | null;
  /** The other cats reported this tick, and how far the nearest is. */
  cats: readonly SensedCat[];
  nearestCatDistance: number;
  /** True when another cat is already busy with the nearest visitor — greeting them, walking to
   * them or being petted. One cat at a person is company; two is a mobbing. */
  visitorClaimed: boolean;
}

/** What one committed episode of behaviour is doing right now (internal brain state). */
export interface ActiveEpisode {
  id: BehaviourId;
  startedAt: number;
  dwellEndAt: number;
  /** Free-form phase tag the behaviour's own plan() uses to sequence itself. */
  phase: string;
  /** Cached target for the episode (food/toy/player/random point), set once at selection. */
  target: Vec2 | null;
  /** The visitor a greeting episode is for; null for every other behaviour. */
  visitorId?: string | null;
  /** How many times this exact clip has looped, for behaviours that want "at least N". */
  clipCycles: number;
  lastClip: ClipName | null;
  /** True iff this episode replaced a previous one because an event interrupted it, rather than
   * the previous one ending on its own (dwell expiry or its own goalDone). Lets an outside
   * observer (the debug overlay, or a test) tell "the cat reacted to something" apart from "the
   * cat changed its mind" — and, read on the episode that FOLLOWS a short one, tells whether that
   * short one was legitimately cut off rather than having dithered on its own. */
  startedByInterrupt: boolean;
}

export interface DebugSnapshot {
  drives: Drives;
  behaviour: BehaviourId;
  phase: string;
  dwellRemainingS: number;
  /** When the current episode began — a stable id for "is this still the same episode as last
   * tick", since two consecutive episodes can share a behaviour id (a repeat) and would
   * otherwise be indistinguishable from the outside. */
  episodeStartedAt: number;
  /** See ActiveEpisode.startedByInterrupt. */
  startedByInterrupt: boolean;
  lastScores: { id: BehaviourId; utility: number; score: number }[];
  lookAt: Vec2 | null;
}
