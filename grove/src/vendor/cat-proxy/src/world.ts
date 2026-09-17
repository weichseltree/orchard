// A floor with cats on it: the piece a consumer actually wires up. It owns one brain and one body
// per cat, tells each brain about the visitors and about the other cats, keeps the cats apart and
// inside the arena they were given, and hands back what each one is doing.
//
// Everything is client-local and deterministic: seeded generators, an injected clock (`now` is
// passed in, never read from Date), no shared state and no server. A later authoritative host
// could drive the same code — `snapshot()`/`restore()` on each brain is plain JSON — but nothing
// here assumes one.

import * as THREE from "three";
import type { BodyCommand, BodyState, Vec2, WorldEvent } from "./contract";
import { DEFAULT_APPEARANCE, type CatAppearance } from "./body/appearance";
import { CatController } from "./body/controller";
import type { CatDetail } from "./body/cat";
import { separate } from "./body/separate";
import type { Arena } from "./arena";
import { createBrain, type Brain, type BrainSnapshot } from "./brain/brain";
import { defaultParams, type BrainParams } from "./brain/params";
import { mulberry32 } from "./brain/rng";
import type { SensedCat, Visitor } from "./brain/types";

export interface CatSpec {
  /** Stable id: the other cats' reports and any saved state key off it. */
  id: string;
  appearance?: CatAppearance;
  /** Seed for this cat's brain. Same seed, same behaviour, every run. */
  seed: number;
  start?: Vec2;
  heading?: number;
  detail?: number;
}

export interface CatWorldOptions {
  cats: readonly CatSpec[];
  /** The room, asked rather than described: every target is tested with `canStand` and every
   * step is put through `resolveStep`. Required — a cat without a room walks through walls. */
  arena: Arena;
  /** Overrides for the brain's parameters. */
  params?: BrainParams;
}

export interface CatInWorld {
  readonly id: string;
  readonly controller: CatController;
  readonly brain: Brain;
  /** The body's last reported state. */
  state: BodyState;
  /** The last command the brain gave, for an overlay or a log. */
  command: BodyCommand | null;
}

/** How far outside the arena a cat may stray before it is put back: its own footprint. */
function margin(cat: CatInWorld): number {
  return cat.controller.cat.appearance.radius;
}

export class CatWorld {
  readonly cats: CatInWorld[];
  readonly arena: Arena;
  readonly params: BrainParams;
  /** Scene content: add this to the host's scene graph. */
  readonly group = new THREE.Group();

  constructor(options: CatWorldOptions) {
    this.arena = options.arena;
    this.params = options.params ?? defaultParams;
    this.group.name = "cats";
    this.cats = options.cats.map((spec) => {
      const detail: CatDetail | undefined =
        spec.detail === undefined ? undefined : { detail: spec.detail };
      const controller = new CatController(spec.appearance ?? DEFAULT_APPEARANCE, detail);
      // The body walks the room too: every step it integrates goes through resolveStep, so a
      // steering arc cannot cut a corner the visitors cannot cut.
      controller.useArena(this.arena);
      const wanted = spec.start ?? { x: 0, z: 0 };
      const radius = controller.cat.appearance.radius;
      const start = this.arena.resolveStep(wanted.x, wanted.z, wanted.x, wanted.z, radius);
      controller.place(start, spec.heading ?? 0);
      this.group.add(controller.group);
      return {
        id: spec.id,
        controller,
        brain: createBrain(
          this.params,
          mulberry32(spec.seed),
          this.arena,
          controller.cat.appearance.radius,
        ),
        state: controller.update(0),
        command: null,
      };
    });
  }

  /** A world event (a noise, food put down, a hand offered) reaches every cat. */
  event(e: WorldEvent, now: number): void {
    for (const cat of this.cats) cat.brain.event(e, now);
  }

  /** One step. `visitors` is the whole list every tick — the brains work out who is nearest,
   * who has been greeted lately and who another cat has already gone to. */
  tick(dt: number, now: number, visitors: readonly Visitor[] = []): void {
    for (const cat of this.cats) {
      const others: SensedCat[] = this.cats
        .filter((c) => c !== cat)
        .map((c) => c.brain.report(c.state.position, c.id));
      const command = cat.brain.tick(dt, cat.state, now, { visitors, cats: others });
      cat.command = command;
      cat.controller.apply(command);
      cat.state = cat.controller.update(dt);
    }
    this.resolveCollisions();
  }

  /** Pushes overlapping cats apart, then puts anything that has wandered out of the arena or
   * into a keep-out back where it belongs. Positional only: each brain keeps its own plan. */
  private resolveCollisions(): void {
    const moved = separate(
      this.cats.map((c) => ({
        position: c.state.position,
        radius: c.controller.cat.appearance.radius,
      })),
    );
    this.cats.forEach((cat, i) => {
      const pushed = moved[i]!;
      const inside = this.arena.resolveStep(
        cat.state.position.x,
        cat.state.position.z,
        pushed.x,
        pushed.z,
        margin(cat),
      );
      if (inside.x === cat.state.position.x && inside.z === cat.state.position.z) return;
      cat.state = { ...cat.state, position: inside };
      cat.controller.place(inside, cat.state.heading);
    });
  }

  /** Plain JSON for every brain, keyed by cat id. */
  snapshot(): Record<string, BrainSnapshot> {
    return Object.fromEntries(this.cats.map((c) => [c.id, c.brain.snapshot()]));
  }

  restore(state: Record<string, BrainSnapshot>): void {
    for (const cat of this.cats) {
      const saved = state[cat.id];
      if (saved) cat.brain.restore(saved);
    }
  }

  dispose(): void {
    for (const cat of this.cats) cat.controller.group.removeFromParent();
  }
}
