import type { BodyCommand, BodyState, Vec2, WorldEvent } from "../contract";
import type { Arena } from "../arena";
import { BEHAVIOURS } from "./behaviours";
import { tickDrives } from "./drives";
import { dist } from "./geom";
import type { BrainParams } from "./params";
import type { Rng } from "./rng";
import { logNormalDurationS } from "./rng";
import { markSalient, mostSalient } from "./salience";
import { pickNext, scoreAll, startEpisode, type Scored } from "./selection";
import type {
  ActiveEpisode,
  SensedCat,
  SensedVisitor,
  Sensed,
  Visitor,
  BehaviourId,
  Context,
  DebugSnapshot,
  Drives,
  SalienceMap,
  WorldMemory,
} from "./types";

export interface Brain {
  event(e: WorldEvent, now: number): void;
  /**
   * One step. `sensed` is the primary seam for a room full of people: pass every visitor's
   * position (and the other cats) each tick and the brain works out the nearest, the hysteresis
   * for "near", who has been greeted lately and who another cat has claimed. WorldEvents still
   * work and remain the way one-off things arrive (a noise, a hand, a bowl put down).
   */
  tick(dt: number, body: BodyState, now: number, sensed?: Sensed): BodyCommand;
  debug(): DebugSnapshot;
  /** What this cat is doing, for the OTHER cats' `sensed.cats`. */
  report(at: Vec2, id: string): SensedCat;
  /** The whole brain as plain JSON: drives, memory, the running episode, who has been greeted,
   * and the generator's position. Client-local today; a host that wanted to drive the cats
   * authoritatively later could ship this. */
  snapshot(): BrainSnapshot;
  restore(state: BrainSnapshot): void;
}

/** Plain, structured-clone-safe state. No class instances, no SharedArrayBuffer. */
export interface BrainSnapshot {
  drives: Drives;
  world: WorldMemory;
  salience: SalienceMap;
  episode: ActiveEpisode | null;
  lastDoneAt: Partial<Record<BehaviourId, number>>;
  greetedAt: Record<string, number>;
  wokeAt: number | null;
  now: number;
  /** Present when the brain was given a seeded generator that exposes its state. */
  rngState?: number;
}

/** exp2 falloff: exactly halved at `halfLifeM` metres, matching DriveRates.fearFalloffM's doc. */
function distanceFalloff(distanceM: number, halfLifeM: number): number {
  if (!Number.isFinite(distanceM)) return 0;
  return Math.pow(0.5, distanceM / halfLifeM);
}

/** How likely a toy-moved event is to actually break the cat out of its current behaviour,
 * rather than just updating where its eyes point. Sleeping cats mostly just look. */
function toyReconsiderProbability(current: BehaviourId, curiosity: number, energy: number): number {
  let p = 0.15 + curiosity * 0.6 + energy * 0.15;
  if (current === "sleep") p *= 0.08;
  else if (current === "rest") p *= 0.4;
  return Math.min(0.9, Math.max(0, p));
}

/**
 * A brain for one cat. The arena is required, not optional: a cat has to be given a room before
 * it can decide where to walk, and a consumer that could forget would get a cat walking through
 * walls. `catRadius` is the footprint the room is asked about (the body's own radius).
 */
export function createBrain(
  params: BrainParams,
  rng: Rng,
  arena: Arena,
  catRadius = params.catRadiusM,
): Brain {
  const workingParams: BrainParams = params;

  let drives: Drives = { ...params.initialDrives };
  const world: WorldMemory = {
    player: null,
    playerNear: false,
    hand: null,
    food: null,
    toy: null,
    noise: null,
  };
  const salience: SalienceMap = {};
  const lastDoneAt: Partial<Record<BehaviourId, number>> = {};
  let episode: ActiveEpisode | null = null;
  let wokeAt: number | null = null;
  let repeatStreak: { id: BehaviourId; count: number } | null = null;
  let lastScores: Scored[] = [];
  let lastBody: BodyState | null = null;
  let lastNow = 0;
  /** Visitors as of the last tick, and when this cat last greeted each of them. */
  let visitors: SensedVisitor[] = [];
  let otherCats: readonly SensedCat[] = [];
  const greetedAt = new Map<string, number>();

  /** Resolves the reported visitors: nearest first, each with how long since this cat greeted
   * it, and applies the near/far hysteresis to the existing player memory so every behaviour
   * that was written against `world.player` keeps working unchanged. */
  function senseVisitors(list: readonly Visitor[], body: BodyState, now: number): void {
    visitors = list
      .map((v) => ({
        ...v,
        distance: dist(body.position, v.at),
        sinceGreeted: greetedAt.has(v.id) ? now - greetedAt.get(v.id)! : Infinity,
      }))
      .sort((a, b) => a.distance - b.distance);
    const nearest = visitors[0];
    if (!nearest) {
      if (world.playerNear) {
        world.playerNear = false;
        world.player = null;
      }
      return;
    }
    world.player = { at: nearest.at, since: now };
    markSalient(salience, "player", nearest.at, now);
    // Hysteresis: near inside one radius, not-near only outside a wider one.
    if (nearest.distance <= workingParams.visitorNearRadiusM) world.playerNear = true;
    else if (nearest.distance > workingParams.visitorFarRadiusM) world.playerNear = false;
  }

  /** The social behaviours: the ones that end up standing next to a person. */
  const SOCIAL: readonly (BehaviourId | null)[] = [
    "greet",
    "approach-player",
    "seek-affection",
    "accept-petting",
  ];

  /** Is another cat already busy with this visitor? Distance plus what it is doing, so a cat
   * merely walking past someone does not count as claiming them. */
  function claimedByAnotherCat(at: Vec2, mine: Vec2): boolean {
    const myDistance = dist(mine, at);
    return otherCats.some(
      (c) =>
        SOCIAL.includes(c.behaviour) &&
        // Either it is already there, or it is on its way and nearer than this cat: whoever is
        // closer keeps the visitor, and the other one finds something else to do rather than
        // both converging.
        (dist(c.at, at) < workingParams.visitorFarRadiusM || dist(c.at, at) < myDistance),
    );
  }

  /** The visitor this cat may greet: nearest first, skipping anyone greeted within the cooldown
   * and anyone another cat is already greeting or is closer to. */
  function greetTargetFor(body: BodyState): SensedVisitor | null {
    for (const v of visitors) {
      if (v.sinceGreeted < workingParams.greetCooldownS) continue;
      if (otherCats.some((c) => c.greeting === v.id)) continue;
      if (claimedByAnotherCat(v.at, body.position)) continue;
      const mine = dist(body.position, v.at);
      const closer = otherCats.some(
        (c) => c.behaviour === "greet" && dist(c.at, v.at) < mine - 0.05,
      );
      if (closer) continue;
      return v;
    }
    return null;
  }

  function buildContext(now: number, body: BodyState): Context {
    const { player, food, toy, noise } = world;
    const nearestCat = otherCats.reduce(
      (best, c) => Math.min(best, dist(body.position, c.at)),
      Infinity,
    );
    const nearestVisitor = visitors[0];
    return {
      visitors,
      greetTarget: greetTargetFor(body),
      cats: otherCats,
      nearestCatDistance: nearestCat,
      visitorClaimed: nearestVisitor
        ? claimedByAnotherCat(nearestVisitor.at, body.position)
        : false,
      now,
      arena,
      catRadius,
      position: body.position,
      world,
      playerDistance: player ? dist(body.position, player.at) : Infinity,
      foodDistance: food ? dist(body.position, food.at) : Infinity,
      toyDistance: toy ? dist(body.position, toy.at) : Infinity,
      noiseDistance: noise ? dist(body.position, noise.at) : Infinity,
      sinceLastDone: (id) => (lastDoneAt[id] !== undefined ? now - lastDoneAt[id]! : Infinity),
      sinceWoke: wokeAt !== null ? now - wokeAt : Infinity,
      current: episode?.id ?? null,
    };
  }

  /** Ends the current episode (if any) and commits a new one, updating the bookkeeping every
   * exit path (natural end, forced departure, event interrupt) shares. `reason` records why —
   * see ActiveEpisode.startedByInterrupt — purely for outside observability (debug overlay,
   * tests); it plays no part in scoring. */
  function beginEpisode(
    id: BehaviourId,
    ctx: Context,
    now: number,
    reason: "natural" | "interrupt",
  ): void {
    if (episode) {
      lastDoneAt[episode.id] = now;
      if (episode.id === "sleep") wokeAt = now;
      repeatStreak =
        repeatStreak && repeatStreak.id === id
          ? { id, count: repeatStreak.count + 1 }
          : { id, count: 1 };
    } else {
      repeatStreak = { id, count: 1 };
    }
    episode = startEpisode(id, ctx, workingParams, rng, now);
    episode.startedByInterrupt = reason === "interrupt";
    if (id === "greet" && ctx.greetTarget) {
      episode.visitorId = ctx.greetTarget.id;
      // Booked at the start, so the cooldown covers the greeting itself as well as what follows:
      // it is what stops this cat turning straight round and greeting the same person again.
      greetedAt.set(ctx.greetTarget.id, now);
    }
  }

  function repeatBlockedId(): BehaviourId | null {
    if (repeatStreak && repeatStreak.count >= workingParams.maxConsecutiveRepeats)
      return repeatStreak.id;
    return null;
  }

  /** The decision made when an episode ends on its own (dwell expired or its goal is done):
   * scored with the transition-bias prior keyed off the behaviour that just finished. */
  function naturalDecision(ctx: Context, now: number): void {
    const prevId = episode?.id ?? null;
    const scored = scoreAll(drives, ctx, workingParams, prevId, null, repeatBlockedId());
    lastScores = scored;
    const nextId = pickNext(rng, scored, workingParams.temperature);
    beginEpisode(nextId, ctx, now, "natural");
  }

  /** An event-provoked reconsideration mid-episode: no transition-bias prior (that models what
   * follows a natural end, not an interruption), but the running behaviour gets the commitment
   * bonus so a mild event can't cheaply bounce it. */
  function tryInterrupt(ctx: Context, now: number, forceSwitchAwayFrom?: BehaviourId): boolean {
    if (!episode) return false;
    const protect = forceSwitchAwayFrom ? null : episode.id;
    const blocked = forceSwitchAwayFrom ?? repeatBlockedId();
    const scored = scoreAll(drives, ctx, workingParams, null, protect, blocked);
    lastScores = scored;
    const nextId = pickNext(rng, scored, workingParams.temperature);
    if (nextId !== episode.id) {
      beginEpisode(nextId, ctx, now, "interrupt");
      return true;
    }
    return false;
  }

  function applyEventEffects(e: WorldEvent, now: number): void {
    const rates = workingParams.drives;
    switch (e.kind) {
      case "player-near":
        world.player = { at: e.at, since: now };
        world.playerNear = true;
        markSalient(salience, "player", e.at, now);
        break;
      case "player-far":
        world.playerNear = false;
        world.player = null;
        break;
      case "hand-offered":
        world.hand = { at: e.at, since: now };
        markSalient(salience, "hand", e.at, now);
        break;
      case "food-offered":
        world.food = { at: e.at, since: now };
        markSalient(salience, "food", e.at, now);
        break;
      case "toy-moved":
        world.toy = { at: e.at, since: now };
        markSalient(salience, "toy", e.at, now);
        break;
      case "loud-noise": {
        world.noise = { at: e.at, since: now };
        markSalient(salience, "noise", e.at, now);
        const distanceM = lastBody ? dist(lastBody.position, e.at) : 0;
        const spike = rates.fearSpikeMax * distanceFalloff(distanceM, rates.fearFalloffM);
        drives = { ...drives, fear: Math.min(1, drives.fear + spike) };
        break;
      }
      case "petted":
        world.playerNear = true;
        drives = {
          ...drives,
          affection: Math.max(0, drives.affection - rates.petAffectionRelief),
          fear: Math.max(0, drives.fear * (1 - rates.petFearRelief)),
        };
        break;
    }
  }

  function reactToEvent(e: WorldEvent, now: number): void {
    if (!lastBody || !episode) return; // no tick yet to react from; the next tick will decide fresh
    const ctx = buildContext(now, lastBody);
    const currentId = episode.id;

    switch (e.kind) {
      case "loud-noise":
        if (drives.fear >= workingParams.startleFearThreshold) {
          if (currentId !== "flee") beginEpisode("flee", ctx, now, "interrupt");
        } else {
          tryInterrupt(ctx, now);
        }
        return;
      case "food-offered":
        if (currentId !== "flee") tryInterrupt(ctx, now);
        return;
      case "toy-moved": {
        if (currentId === "flee" || currentId === "eat") return;
        const p = toyReconsiderProbability(currentId, drives.curiosity, drives.energy);
        if (rng() < p) tryInterrupt(ctx, now);
        return;
      }
      case "player-near":
      case "hand-offered":
        if (currentId !== "flee") tryInterrupt(ctx, now);
        return;
      case "petted":
        if (drives.affection <= workingParams.petSaturationThreshold) {
          // Cats end petting sessions themselves: force a departure, never re-select petting.
          tryInterrupt(ctx, now, "accept-petting");
        } else if (currentId !== "accept-petting") {
          beginEpisode("accept-petting", ctx, now, "interrupt");
        } else {
          // Still wanted: extend the session instead of letting the dwell timer cut it short.
          episode.dwellEndAt = Math.max(
            episode.dwellEndAt,
            now +
              logNormalDurationS(
                rng,
                workingParams.behaviours["accept-petting"].dwell.medianS,
                workingParams.behaviours["accept-petting"].dwell.spread,
              ),
          );
        }
        return;
      case "player-far":
        // Memory is already updated; reconsider immediately rather than waiting for the next
        // natural decision point — otherwise a behaviour whose utility/goal depends on the
        // player (seek-affection, accept-petting) lingers for one extra tick on a now-stale
        // reason, which reads as the cat "still there" for a beat after the player left.
        if (currentId !== "flee") tryInterrupt(ctx, now);
        return;
    }
  }

  return {
    event(e, now) {
      lastNow = now;
      applyEventEffects(e, now);
      reactToEvent(e, now);
    },

    tick(dt, body, now, sensed) {
      lastNow = now;
      drives = tickDrives(drives, dt, episode?.id ?? null, workingParams.drives);
      lastBody = body;
      if (sensed?.cats) otherCats = sensed.cats;
      if (sensed?.visitors) senseVisitors(sensed.visitors, body, now);
      const ctx = buildContext(now, body);

      const dwellExpired = !episode || now >= episode.dwellEndAt;
      const goalDone = episode
        ? BEHAVIOURS[episode.id].goalDone(episode, ctx, body, drives, workingParams)
        : false;
      if (dwellExpired || goalDone) {
        naturalDecision(buildContext(now, body), now);
      }

      const active = episode!;
      const plan = BEHAVIOURS[active.id].plan(active, ctx, body, workingParams);
      const lookAt = mostSalient(salience, now, workingParams);
      const command: BodyCommand = plan.moveTo
        ? { clip: plan.clip, moveTo: plan.moveTo, lookAt, behaviour: active.id }
        : { clip: plan.clip, lookAt, behaviour: active.id };
      return command;
    },

    report(at, id) {
      return {
        id,
        at,
        behaviour: episode?.id ?? null,
        greeting: episode?.id === "greet" ? (episode.visitorId ?? null) : null,
      };
    },

    snapshot() {
      return {
        drives: { ...drives },
        world: JSON.parse(JSON.stringify(world)) as WorldMemory,
        salience: JSON.parse(JSON.stringify(salience)) as SalienceMap,
        episode: episode ? { ...episode } : null,
        lastDoneAt: { ...lastDoneAt },
        greetedAt: Object.fromEntries(greetedAt),
        wokeAt,
        now: lastNow,
        ...(typeof (rng as { state?: number }).state === "number"
          ? { rngState: (rng as { state?: number }).state! }
          : {}),
      };
    },

    restore(state) {
      drives = { ...state.drives };
      Object.assign(world, JSON.parse(JSON.stringify(state.world)) as WorldMemory);
      for (const key of Object.keys(salience)) delete salience[key as keyof SalienceMap];
      Object.assign(salience, JSON.parse(JSON.stringify(state.salience)) as SalienceMap);
      episode = state.episode ? { ...state.episode } : null;
      for (const key of Object.keys(lastDoneAt)) delete lastDoneAt[key as BehaviourId];
      Object.assign(lastDoneAt, state.lastDoneAt);
      greetedAt.clear();
      for (const [id, at] of Object.entries(state.greetedAt)) greetedAt.set(id, at);
      wokeAt = state.wokeAt;
      lastNow = state.now;
      if (state.rngState !== undefined && "setState" in rng) {
        (rng as unknown as { setState(n: number): void }).setState(state.rngState);
      }
    },

    debug() {
      const active = episode;
      return {
        drives: { ...drives },
        behaviour: active?.id ?? "rest",
        phase: active?.phase ?? "",
        dwellRemainingS: active ? active.dwellEndAt - lastNow : 0,
        episodeStartedAt: active?.startedAt ?? 0,
        startedByInterrupt: active?.startedByInterrupt ?? false,
        lastScores: lastScores.map((s) => ({ id: s.id, utility: s.utility, score: s.score })),
        lookAt: mostSalient(salience, lastNow, workingParams),
      };
    },
  };
}
