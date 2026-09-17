import {
  CLIP_POSTURE,
  type BodyState,
  type ClipName,
  type Posture,
  type Vec2,
  type WorldEvent,
} from "../contract";
import { rectArena, type Arena } from "../arena";
import { createBrain } from "./brain";
import { dist } from "./geom";
import type { BrainParams } from "./params";
import { mulberry32 } from "./rng";
import type { BehaviourId, Drives } from "./types";

export interface SimEvent {
  t: number;
  event: WorldEvent;
}

export interface TimelineEntry {
  t: number;
  behaviour: BehaviourId;
  clip: ClipName;
  posture: Posture;
  moveTo: Vec2 | undefined;
  lookAt: Vec2 | null;
  drives: Drives;
  position: Vec2;
  arrived: boolean;
  /** Identifies the episode (two entries share it iff they're the same episode) — the only way
   * to tell a repeat (episode N+1 happens to choose the same behaviour as episode N) from a
   * single long episode, since both look identical through `behaviour` alone. */
  episodeStartedAt: number;
  /** See ActiveEpisode.startedByInterrupt: true iff THIS episode replaced a previous one because
   * an event interrupted it. */
  startedByInterrupt: boolean;
}

const ONE_SHOT_DURATION_S = 0.6;
const LOOP_CYCLE_S = 1.5;

/**
 * Runs a brain against a fake body: the body "arrives" after distance/speed and "finishes" a
 * clip after a fixed nominal duration (shorter for one-shots than for a loop's first cycle),
 * exactly what the contract's BodyState fields need to be meaningful without any rendering. Used
 * by the test suite; also handy for eyeballing a run's shape outside a test.
 */
export function simulate(
  params: BrainParams,
  seed: number,
  seconds: number,
  events: SimEvent[] = [],
  dt = 0.25,
  arena: Arena = rectArena({ minX: -3, maxX: 3, minZ: -3, maxZ: 3 }),
): TimelineEntry[] {
  const rng = mulberry32(seed);
  const brain = createBrain(params, rng, arena);
  const body: BodyState = {
    position: { x: 0, z: 0 },
    heading: 0,
    posture: "sit",
    clip: "sit-idle",
    clipDone: true,
    arrived: true,
  };
  let clipElapsed = 0;
  const pending = [...events].sort((a, b) => a.t - b.t);
  let nextEvent = 0;
  const timeline: TimelineEntry[] = [];

  for (let t = 0; t < seconds; t += dt) {
    while (nextEvent < pending.length && pending[nextEvent]!.t <= t) {
      brain.event(pending[nextEvent]!.event, t);
      nextEvent++;
    }

    const command = brain.tick(dt, body, t);

    if (command.clip !== body.clip) {
      body.clip = command.clip;
      body.posture = CLIP_POSTURE[command.clip].to;
      clipElapsed = 0;
    } else {
      clipElapsed += dt;
    }
    body.clipDone =
      clipElapsed >= (CLIP_POSTURE[command.clip].loop ? LOOP_CYCLE_S : ONE_SHOT_DURATION_S);

    if (command.moveTo) {
      const speed =
        command.clip === "trot"
          ? params.speedsMPerS.trot
          : command.clip === "walk"
            ? params.speedsMPerS.walk
            : 0;
      const remaining = dist(body.position, command.moveTo);
      if (speed <= 0 || remaining <= params.arrivalRadiusM) {
        body.position = command.moveTo;
        body.arrived = true;
      } else {
        const step = Math.min(speed * dt, remaining);
        const dx = (command.moveTo.x - body.position.x) / remaining;
        const dz = (command.moveTo.z - body.position.z) / remaining;
        body.position = { x: body.position.x + dx * step, z: body.position.z + dz * step };
        body.heading = Math.atan2(dx, dz); // 0 = +z, per contract
        body.arrived = dist(body.position, command.moveTo) <= params.arrivalRadiusM;
      }
    } else {
      body.arrived = true;
    }

    const debug = brain.debug();
    timeline.push({
      t,
      behaviour: command.behaviour as BehaviourId,
      clip: command.clip,
      posture: body.posture,
      moveTo: command.moveTo,
      lookAt: command.lookAt ?? null,
      drives: debug.drives,
      position: { ...body.position },
      arrived: body.arrived,
      episodeStartedAt: debug.episodeStartedAt,
      startedByInterrupt: debug.startedByInterrupt,
    });
  }

  return timeline;
}
