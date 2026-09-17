import type { BodyState, ClipName, Vec2 } from "../contract";
import type { BrainParams } from "./params";
import { dist, fleePoint, randomPointNear, resolve } from "./geom";
import type { Rng } from "./rng";
import type { ActiveEpisode, BehaviourId, Context, Drives } from "./types";

const NEG_INF = -Infinity;

// A drive at or below this is "satisfied enough that doing more is pointless" — this is
// goalDone's threshold: relief reaching this floor DURING a legitimately-started episode ends it
// early. It must NOT also be the selection gate: without a gap, a drive sitting just above it
// (e.g. grooming = 0.081) is technically selectable, gets picked, and crosses the same floor
// within a fraction of a second of continuous relief — a genuinely tiny episode that isn't
// "dithering" (nothing re-picks it in a loop) but still reads as a twitch. SELECTABLE below is
// the actual gate, comfortably above every behaviour's relief rate so an episode that starts always
// has real runway before it can end early.
export const SATISFIED = 0.08;
// Worth checking against every relief rate in DriveRates (grooming 1/60, hunger 1/90, curiosity
// 1/45 per second): the slowest still clears >1.5s of runway from SELECTABLE down to SATISFIED
// (curiosity's is the tightest, at ~0.022/s -> ~4.5s), well before drift/decay could matter.
export const SELECTABLE = SATISFIED + 0.1;

/** exp(-d/scale): 1 at zero distance, ~0.37 at d=scale, decaying smoothly past it. */
function proximity(distanceM: number, scaleM: number): number {
  if (!Number.isFinite(distanceM)) return 0;
  return Math.exp(-distanceM / scaleM);
}

/** Live distance check, deliberately NOT `body.arrived`: that flag tracks arrival against
 * whatever moveTo the body was PREVIOUSLY commanded with, which on the very first tick of a
 * fresh episode is last episode's target (or none). Position is always current, so re-deriving
 * "am I there yet" from it avoids a one-episode-long false positive (e.g. "eat" never walking to
 * the bowl because a stale `arrived: true` from the previous idle behaviour looked close enough). */
function closeEnough(a: Vec2, b: Vec2, params: BrainParams): boolean {
  return dist(a, b) <= params.arrivalRadiusM;
}

/** The same hysteresis idea as SELECTABLE, for a behaviour whose goalDone is "arrived" rather
 * than a drive threshold (wander, approach-player): a target only barely past arrivalRadiusM
 * gets reached within a single tick, which is the same one-tick-episode symptom via a different
 * mechanism. 1.5x the walk speed guarantees at least that much real travel time before arrival
 * can end the episode — walk, not trot, since both affected behaviours only ever walk. */
function minTravelM(params: BrainParams): number {
  return params.arrivalRadiusM + params.speedsMPerS.walk * 1.5;
}

export interface PlanResult {
  clip: ClipName;
  moveTo?: Vec2;
}

export interface BehaviourDef {
  id: BehaviourId;
  /** -Infinity when the behaviour's precondition (e.g. "a toy position is known") fails. */
  utility(drives: Drives, ctx: Context, params: BrainParams): number;
  /** Phase tag a freshly-selected episode starts in; defaults to "" when omitted. */
  initialPhase?: string;
  /** Called once when the episode is selected, to cache a travel target if it needs one. */
  pickTarget(ctx: Context, params: BrainParams, rng: Rng): Vec2 | null;
  /** Called every tick; mutates episode.phase to sequence itself. */
  plan(episode: ActiveEpisode, ctx: Context, body: BodyState, params: BrainParams): PlanResult;
  /** True when the behaviour's own goal is satisfied, independent of the dwell timer. */
  goalDone(
    episode: ActiveEpisode,
    ctx: Context,
    body: BodyState,
    drives: Drives,
    params: BrainParams,
  ): boolean;
}

function baseUtility(id: BehaviourId, drives: Drives, params: BrainParams): number {
  const p = params.behaviours[id];
  let u = p.baseUtility;
  for (const [drive, weight] of Object.entries(p.driveWeight)) {
    u += (weight ?? 0) * drives[drive as keyof Drives];
  }
  return u;
}

/** A one-phase idle/loop behaviour: hold a clip until dwell (or a drive threshold) ends it. */
function idleBehaviour(
  id: BehaviourId,
  clip: ClipName,
  phase: string,
  extraUtility: (drives: Drives, ctx: Context, params: BrainParams) => number,
  goalDone: (drives: Drives, params: BrainParams) => boolean = () => false,
): BehaviourDef {
  return {
    id,
    initialPhase: phase,
    utility: (drives, ctx, params) =>
      baseUtility(id, drives, params) + extraUtility(drives, ctx, params),
    pickTarget: () => null,
    plan: () => ({ clip }),
    goalDone: (_e, _ctx, _body, drives, params) => goalDone(drives, params),
  };
}

// No extra post-wake penalty needed: energy is highest right after sleep, and the sleep
// utility's negative energy weight already makes re-sleeping unattractive on its own.
const sleep = idleBehaviour("sleep", "sleep", "sleeping", () => 0);

const rest = idleBehaviour("rest", "lie-idle", "resting", () => 0);

const sitWatch = idleBehaviour("sit-watch", "sit-idle", "watching", () => 0);

const groom = idleBehaviour(
  "groom",
  "groom",
  "grooming",
  // Gate, not just a fading weight: once grooming is already satisfied, grooming more is not
  // worth doing at all, so this must exclude the option (-Infinity) rather than merely shrink
  // its score — a small-but-positive baseUtility would otherwise keep it selectable forever.
  (drives) => (drives.grooming <= SELECTABLE ? NEG_INF : 0),
  (drives) => drives.grooming <= SATISFIED,
);

const wander: BehaviourDef = {
  id: "wander",
  initialPhase: "wandering",
  utility: (drives, _ctx, params) => baseUtility("wander", drives, params),
  pickTarget: (ctx, params, rng) => {
    // Resample a point that's actually worth walking to (see minTravelM) — the area is only 6m
    // across, so a uniformly-drawn point landing within arm's reach of where the cat already is
    // isn't rare enough to ignore, and would otherwise end the episode within a single tick.
    let target = randomPointNear(rng, ctx.position, params.wanderRadiusM, ctx.arena, ctx.catRadius);
    for (
      let attempt = 0;
      attempt < 8 && dist(ctx.position, target) < minTravelM(params);
      attempt++
    ) {
      target = randomPointNear(rng, ctx.position, params.wanderRadiusM, ctx.arena, ctx.catRadius);
    }
    return target;
  },
  plan: (episode, _ctx, body, params) => {
    if (!episode.target || closeEnough(body.position, episode.target, params))
      return { clip: "sit-idle" };
    return { clip: "walk", moveTo: episode.target };
  },
  goalDone: (episode, _ctx, body, _drives, params) =>
    !episode.target || closeEnough(body.position, episode.target, params),
};

const investigate: BehaviourDef = {
  id: "investigate",
  initialPhase: "investigating",
  utility: (drives, ctx, params) => {
    if (!ctx.world.toy && !ctx.world.noise) return NEG_INF;
    const target = ctx.world.toy ?? ctx.world.noise!;
    const d = dist(ctx.position, target.at);
    return baseUtility("investigate", drives, params) + proximity(d, 3) * 0.3;
  },
  pickTarget: (ctx) => ctx.world.toy?.at ?? ctx.world.noise?.at ?? null,
  plan: (episode, ctx, body, params) => {
    const target = ctx.world.toy?.at ?? ctx.world.noise?.at ?? episode.target;
    if (!target || closeEnough(body.position, target, params)) return { clip: "look-around" };
    const far = dist(body.position, target) > 2;
    return { clip: far ? "trot" : "walk", moveTo: target };
  },
  goalDone: () => false,
};

const approachPlayer: BehaviourDef = {
  id: "approach-player",
  initialPhase: "approaching",
  utility: (drives, ctx, params) => {
    if (!ctx.world.player) return NEG_INF;
    // One cat at a person is company, two is a mobbing: if the other cat is already there, this
    // one finds something else to do.
    if (ctx.visitorClaimed) return NEG_INF;
    // Not just "already there" (arrivalRadiusM) but "not worth WALKING there" (minTravelM): a
    // player already close enough is a job for seek-affection/accept-petting, not a walk that
    // would satisfy itself within a single tick.
    if (ctx.playerDistance <= minTravelM(params)) return NEG_INF;
    return baseUtility("approach-player", drives, params) + proximity(ctx.playerDistance, 4) * 0.2;
  },
  pickTarget: (ctx) => ctx.world.player?.at ?? null,
  plan: (episode, ctx, body, params) => {
    const target = ctx.world.player?.at ?? episode.target;
    if (!target || closeEnough(body.position, target, params)) return { clip: "sit-idle" };
    return { clip: "walk", moveTo: target };
  },
  goalDone: (episode, ctx, body, _drives, params) => {
    // The other cat got there first: leave them to it.
    if (ctx.visitorClaimed) return true;
    const target = ctx.world.player?.at ?? episode.target;
    return !target || closeEnough(body.position, target, params);
  },
};

const seekAffection: BehaviourDef = {
  id: "seek-affection",
  initialPhase: "seeking-affection",
  utility: (drives, ctx, params) => {
    if (!ctx.world.player) return NEG_INF;
    if (ctx.visitorClaimed) return NEG_INF;
    return baseUtility("seek-affection", drives, params) + proximity(ctx.playerDistance, 4) * 0.15;
  },
  pickTarget: (ctx) => ctx.world.player?.at ?? null,
  plan: (episode, ctx, body, params) => {
    const target = ctx.world.player?.at ?? episode.target;
    if (target && !closeEnough(body.position, target, params))
      return { clip: "walk", moveTo: target };
    return { clip: "rub" };
  },
  goalDone: (_episode, ctx) => !ctx.world.playerNear || ctx.visitorClaimed,
};

// Unlike groom/eat/play, accept-petting is entered by direct event force (brain.ts calls
// beginEpisode straight from the "petted" handler, not through the normal softmax), so it can't
// be protected the same way (gating selection on "affection already low" would just stop the cat
// responding to being petted at all). Its hazard is different: `petted` is a big INSTANT relief
// (petAffectionRelief), not gradual, so a single pet can cross petSaturationThreshold within the
// very next tick if affection wasn't very high to begin with — a one-tick petting session. A
// minimum episode age before goalDone can fire gives every petting session a believable floor,
// the same way flee's phase requirement guarantees startle plays out before it can end.
const MIN_PETTING_S = 2;

const acceptPetting: BehaviourDef = {
  id: "accept-petting",
  initialPhase: "being-petted",
  utility: (drives, ctx, params) => {
    if (!ctx.world.playerNear) return NEG_INF;
    return baseUtility("accept-petting", drives, params) + drives.affection * 0.5;
  },
  pickTarget: () => null,
  plan: () => ({ clip: "sit-idle" }),
  goalDone: (episode, ctx, _body, drives, params) =>
    ctx.now - episode.startedAt >= MIN_PETTING_S &&
    drives.affection <= params.petSaturationThreshold,
};

const eat: BehaviourDef = {
  id: "eat",
  initialPhase: "eating",
  utility: (drives, ctx, params) => {
    // Same gate as groom/play (see SELECTABLE): a bowl the cat already ate its fill from must not
    // remain selectable just because it's still "known", or it flashes in and straight back out.
    if (!ctx.world.food || drives.hunger <= SELECTABLE) return NEG_INF;
    return baseUtility("eat", drives, params) + proximity(ctx.foodDistance, 3) * 0.2;
  },
  pickTarget: (ctx) => ctx.world.food?.at ?? null,
  plan: (episode, ctx, body, params) => {
    const target = ctx.world.food?.at ?? episode.target;
    if (target && !closeEnough(body.position, target, params))
      return { clip: "walk", moveTo: target };
    return { clip: "eat" }; // no moveTo once settled — the contract's eat clip is stand+loop only
  },
  goalDone: (_episode, _ctx, _body, drives) => drives.hunger <= SATISFIED,
};

const stretch: BehaviourDef = {
  id: "stretch",
  initialPhase: "stretching",
  utility: (drives, ctx, params) => {
    const p = baseUtility("stretch", drives, params);
    // Only worth doing shortly after waking or a long idle spell; otherwise stays negative.
    const wakeBoost = ctx.sinceWoke < 30 ? 1.5 : 0;
    return p + wakeBoost;
  },
  pickTarget: () => null,
  plan: () => ({ clip: "stretch" }),
  // Gated on the body ACTUALLY playing "stretch": on the tick the episode is created, body still
  // reflects the previous clip, whose stale clipDone must not be read as this one's.
  goalDone: (_episode, _ctx, body) => body.clip === "stretch" && body.clipDone,
};

const flee: BehaviourDef = {
  id: "flee",
  initialPhase: "startle",
  utility: (drives, _ctx, params) => {
    if (drives.fear < 0.05) return NEG_INF;
    return baseUtility("flee", drives, params);
  },
  pickTarget: (ctx, _params, rng) =>
    fleePoint(ctx.position, ctx.world.noise?.at ?? null, 2.5, ctx.arena, ctx.catRadius, rng),
  plan: (episode, _ctx, body, params) => {
    if (episode.phase === "startle") {
      if (body.clip === "startle" && body.clipDone) episode.phase = "trot-away";
      else return { clip: "startle" };
    }
    if (!episode.target || closeEnough(body.position, episode.target, params))
      return { clip: "sit-idle" };
    return { clip: "trot", moveTo: episode.target };
  },
  goalDone: (episode, _ctx, body, drives, params) =>
    episode.phase === "trot-away" &&
    (!episode.target || closeEnough(body.position, episode.target, params)) &&
    drives.fear < 0.15,
};

const play: BehaviourDef = {
  id: "play",
  initialPhase: "playing",
  utility: (drives, ctx, params) => {
    // Same gate as groom/eat (see SELECTABLE).
    if (!ctx.world.toy || drives.curiosity <= SELECTABLE) return NEG_INF;
    return baseUtility("play", drives, params) + proximity(ctx.toyDistance, 3) * 0.2;
  },
  pickTarget: (ctx) => ctx.world.toy?.at ?? null,
  plan: (episode, ctx, body, params) => {
    const target = ctx.world.toy?.at ?? episode.target;
    if (target && !closeEnough(body.position, target, params))
      return { clip: "trot", moveTo: target };
    return { clip: "look-around" };
  },
  goalDone: (_episode, _ctx, _body, drives) => drives.curiosity <= SATISFIED,
};

/**
 * Greeting a visitor: the one behaviour that is about a person rather than a thing. The cat
 * notices someone it has not just greeted, walks to a polite distance — NOT onto them, and never
 * into a keep-out — looks up at them, rubs or looks about, and then loses interest by itself when
 * the dwell runs out. Two rules keep it from being a nuisance:
 *   - it will not greet the same visitor again for params.greetCooldownS (ctx.greetTarget is
 *     already filtered by that), so it does not pester;
 *   - a visitor another cat is already greeting is not a target either (also filtered in
 *     ctx.greetTarget), so the two cats cannot mob one person, or the spawn.
 */
const greet: BehaviourDef = {
  id: "greet",
  initialPhase: "approaching",
  utility: (drives, ctx, params) => {
    const target = ctx.greetTarget;
    if (!target) return NEG_INF;
    // Close enough that walking over would be silly is seek-affection's job, not greeting's.
    if (target.distance < params.greetDistanceM * 0.6) return NEG_INF;
    return (
      baseUtility("greet", drives, params) +
      proximity(target.distance, params.greetNoticeM) * params.greetNoticeBonus
    );
  },
  pickTarget: (ctx, params) => {
    const target = ctx.greetTarget;
    if (!target) return null;
    return politeSpot(ctx.position, target.at, params, ctx);
  },
  plan: (episode, ctx, body, params) => {
    const visitor = ctx.visitors.find((v) => v.id === episode.visitorId) ?? ctx.greetTarget;
    const spot = visitor ? politeSpot(body.position, visitor.at, params, ctx) : episode.target;
    if (spot && !closeEnough(body.position, spot, params) && episode.phase === "approaching") {
      episode.target = spot;
      return { clip: "walk", moveTo: spot };
    }
    // Arrived: look up at them, with the odd rub or look about.
    if (episode.phase === "approaching") episode.phase = "greeting";
    if (episode.clipCycles === 0 && episode.lastClip !== "rub") return { clip: "rub" };
    return { clip: "look-around" };
  },
  goalDone: (episode, ctx) =>
    // The visitor walked off, or somebody else got there first.
    !ctx.visitors.some((v) => v.id === episode.visitorId) ||
    ctx.cats.some((c) => c.greeting === episode.visitorId),
};

/** A spot `greetDistanceM` short of the visitor, on the cat's side of them, that the cat is
 * allowed to stand on. Cats stop a polite distance away; walking onto a person reads as begging
 * (and, at a spawn point, as mobbing). */
function politeSpot(from: Vec2, visitor: Vec2, params: BrainParams, ctx: Context): Vec2 {
  const dx = from.x - visitor.x;
  const dz = from.z - visitor.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return resolve(from, from, ctx.arena, ctx.catRadius);
  const k = params.greetDistanceM / len;
  // The polite spot has to be somewhere the cat may actually stand: behind it, beside it, or as
  // close as the room allows.
  for (const scale of [1, 1.35, 1.8]) {
    const at = { x: visitor.x + dx * k * scale, z: visitor.z + dz * k * scale };
    if (ctx.arena.canStand(at.x, at.z, ctx.catRadius)) return at;
  }
  return resolve(from, { x: visitor.x + dx * k, z: visitor.z + dz * k }, ctx.arena, ctx.catRadius);
}

export const BEHAVIOURS: Record<BehaviourId, BehaviourDef> = {
  sleep,
  greet,
  rest,
  "sit-watch": sitWatch,
  groom,
  wander,
  investigate,
  "approach-player": approachPlayer,
  "seek-affection": seekAffection,
  "accept-petting": acceptPetting,
  eat,
  stretch,
  flee,
  play,
};
