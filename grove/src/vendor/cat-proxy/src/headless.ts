// A headless run of the whole thing — brains, bodies, clips, steering, separation — with no
// renderer, no canvas and no DOM, so a consumer's CI can prove the cats behave in ITS room before
// anything is hung on a wall. It is the same code path the viewer runs; only the drawing is
// missing.
//
// It answers three questions: did a cat ever leave the arena or stand in a keep-out, did the
// posture graph ever go inconsistent (a clip played from a posture it cannot start in, or a
// posture that jumped a step), and what did the cats actually spend their time doing.

import { CLIP_POSTURE, type Posture, type Vec2, type WorldEvent } from "./contract";
import type { Arena } from "./arena";
import { rectArena } from "./arena";
import type { BehaviourId, Visitor } from "./brain/types";
import { CatWorld, type CatSpec, type CatWorldOptions } from "./world";

const POSTURE_LINE: readonly Posture[] = ["stand", "sit", "lie", "loaf"];

export interface HeadlessOptions extends CatWorldOptions {
  /** How many steps to run, and how long each one is. 60 Hz by default. */
  steps: number;
  dt?: number;
  /** Where the visitors are at time `t`; called once a step. Default: nobody in the room. */
  visitors?: (t: number, step: number) => readonly Visitor[];
  /** Events to fire at a given time, in seconds. */
  events?: readonly { t: number; event: WorldEvent }[];
}

export interface HeadlessCatReport {
  id: string;
  /** Ticks spent in each behaviour. */
  behaviours: Partial<Record<BehaviourId, number>>;
  postures: Partial<Record<Posture, number>>;
  /** Steps whose position was outside the arena or inside a keep-out. Should be zero. */
  outOfArena: number;
  /** Posture-graph complaints, as readable strings. Should be empty. */
  postureFaults: string[];
  /** How far this cat walked, in metres, and where it ended. */
  distanceM: number;
  end: Vec2;
  greeted: string[];
}

export interface HeadlessReport {
  seconds: number;
  steps: number;
  cats: HeadlessCatReport[];
  /** The closest the cats ever came to each other, centre to centre. */
  minCatDistanceM: number;
  /** True when nothing left the arena and no posture fault was seen. */
  ok: boolean;
}

/** Runs the cats headlessly and reports what happened. Deterministic: same seeds, same report. */
export function runHeadless(options: HeadlessOptions): HeadlessReport {
  const dt = options.dt ?? 1 / 60;
  const world = new CatWorld(options);
  const arena: Arena = options.arena;
  const reports = new Map<string, HeadlessCatReport>(
    world.cats.map((c) => [
      c.id,
      {
        id: c.id,
        behaviours: {},
        postures: {},
        outOfArena: 0,
        postureFaults: [],
        distanceM: 0,
        end: { ...c.state.position },
        greeted: [],
      },
    ]),
  );
  const lastPosture = new Map<string, Posture>(world.cats.map((c) => [c.id, c.state.posture]));
  const pending = [...(options.events ?? [])].sort((a, b) => a.t - b.t);
  let minCatDistanceM = Infinity;
  let now = 0;

  for (let step = 0; step < options.steps; step++) {
    now += dt;
    while (pending.length > 0 && pending[0]!.t <= now) world.event(pending.shift()!.event, now);
    const visitors = options.visitors?.(now, step) ?? [];
    const before = world.cats.map((c) => ({ ...c.state.position }));
    world.tick(dt, now, visitors);

    world.cats.forEach((cat, i) => {
      const report = reports.get(cat.id)!;
      const behaviour = cat.command?.behaviour as BehaviourId | undefined;
      if (behaviour) report.behaviours[behaviour] = (report.behaviours[behaviour] ?? 0) + 1;
      report.postures[cat.state.posture] = (report.postures[cat.state.posture] ?? 0) + 1;
      if (!arena.canStand(cat.state.position.x, cat.state.position.z, catRadius(cat))) {
        report.outOfArena++;
      }
      const spec = CLIP_POSTURE[cat.state.clip];
      if (spec.from !== "any" && spec.from !== cat.state.posture) {
        report.postureFaults.push(
          `${cat.state.clip} played from ${cat.state.posture} at ${now.toFixed(2)}s`,
        );
      }
      const previous = lastPosture.get(cat.id)!;
      if (previous !== cat.state.posture) {
        const stepSize = Math.abs(
          POSTURE_LINE.indexOf(previous) - POSTURE_LINE.indexOf(cat.state.posture),
        );
        // Every transition clip moves one step along stand - sit - lie - loaf; a startle is the
        // one clip allowed to jump, because it stands the cat up from wherever it was.
        if (stepSize > 1 && cat.state.clip !== "startle" && cat.command?.clip !== "startle") {
          report.postureFaults.push(
            `${previous} -> ${cat.state.posture} in one step at ${now.toFixed(2)}s`,
          );
        }
        lastPosture.set(cat.id, cat.state.posture);
      }
      const moved = Math.hypot(
        cat.state.position.x - before[i]!.x,
        cat.state.position.z - before[i]!.z,
      );
      report.distanceM += moved;
      report.end = { ...cat.state.position };
      const greeting = cat.brain.report(cat.state.position, cat.id).greeting;
      if (greeting && !report.greeted.includes(greeting)) report.greeted.push(greeting);
    });

    for (let i = 0; i < world.cats.length; i++) {
      for (let j = i + 1; j < world.cats.length; j++) {
        const a = world.cats[i]!.state.position;
        const b = world.cats[j]!.state.position;
        minCatDistanceM = Math.min(minCatDistanceM, Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
  }

  const cats = [...reports.values()];
  return {
    seconds: options.steps * dt,
    steps: options.steps,
    cats,
    minCatDistanceM,
    ok: cats.every((c) => c.outOfArena === 0 && c.postureFaults.length === 0),
  };
}

/** A stand-in for the orchard's hall while we have no room to ask: 20 x 24 m with its six
 * doorway thresholds and a wall hanging's footprint kept out. The real consumer implements
 * `Arena` over its own navigation instead — its columns move, and ours cannot know. */
export function exampleHallArena(): Arena {
  return rectArena({
    minX: -10,
    maxX: 10,
    minZ: -12,
    maxZ: 12,
    keepOut: [
      { minX: -1.6, maxX: 1.6, minZ: 11.2, maxZ: 12 }, // north doorway threshold
      { minX: -1.6, maxX: 1.6, minZ: -12, maxZ: -11.2 }, // south
      { minX: 9.2, maxX: 10, minZ: -2.4, maxZ: 2.4 }, // east
      { minX: -10, maxX: -9.2, minZ: -2.4, maxZ: 2.4 }, // west
      { minX: 5.6, maxX: 8.4, minZ: 11.2, maxZ: 12 }, // north-east
      { minX: -8.4, maxX: -5.6, minZ: 11.2, maxZ: 12 }, // north-west
      { minX: 8.6, maxX: 10, minZ: 3.2, maxZ: 7.2 }, // the east wall hanging's footprint
    ],
  });
}

/** The footprint the arena is asked about for this cat. */
function catRadius(cat: { controller: { cat: { appearance: { radius: number } } } }): number {
  return cat.controller.cat.appearance.radius;
}

export type { CatSpec };
