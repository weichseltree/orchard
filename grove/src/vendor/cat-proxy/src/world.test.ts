import { describe, expect, it } from "vitest";
import { exampleHallArena, runHeadless } from "./headless";
import { createBrain } from "./brain/brain";
import { defaultParams } from "./brain/params";
import { mulberry32 } from "./brain/rng";
import { randomPointNear } from "./brain/geom";
import { rectArena } from "./arena";
import { BLUE_POINT, SEAL_POINT } from "./body/appearance";
import { CatWorld } from "./world";
import type { Arena, Visitor } from "./brain/types";
import type { BodyState } from "./contract";

const hall = exampleHallArena();

const twoCats = [
  { id: "blue", appearance: BLUE_POINT, seed: 11, start: { x: -2, z: 1 } },
  { id: "seal", appearance: SEAL_POINT, seed: 29, start: { x: 2.5, z: -1 } },
];

describe("the arena is injected, not compiled in", () => {
  const radius = 0.2;

  it("only ever picks targets the room says a cat may stand on", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 400; i++) {
      const at = randomPointNear(rng, { x: 0, z: 10 }, 4, hall, radius);
      expect(hall.canStand(at.x, at.z, radius)).toBe(true);
    }
  });

  it("resolves a step into a doorway to somewhere the cat may stand", () => {
    const into = { x: 0, z: 11.6 }; // the north threshold
    expect(hall.canStand(into.x, into.z, radius)).toBe(false);
    const out = hall.resolveStep(0, 10.5, into.x, into.z, radius);
    expect(hall.canStand(out.x, out.z, radius)).toBe(true);
    expect(Math.hypot(out.x - into.x, out.z - into.z)).toBeLessThan(1.4);
  });

  it("asks the room rather than a rectangle: a custom Arena is obeyed", () => {
    // A room that is one disc, implemented by the consumer however it likes.
    const island: Arena = {
      canStand: (x, z, r) => Math.hypot(x, z) + r <= 2,
      resolveStep: (fromX, fromZ, toX, toZ, r) => {
        const d = Math.hypot(toX, toZ);
        if (d + r <= 2) return { x: toX, z: toZ };
        const k = (2 - r) / (d || 1);
        void fromX;
        void fromZ;
        return { x: toX * k, z: toZ * k };
      },
    };
    const report = runHeadless({
      cats: twoCats.map((c) => ({ ...c, start: { x: 0, z: 0 } })),
      arena: island,
      steps: 1800,
    });
    expect(report.ok).toBe(true);
    for (const cat of report.cats) expect(Math.hypot(cat.end.x, cat.end.z)).toBeLessThanOrEqual(2);
  });

  it("a different arena moves the cats: nothing is hard-coded", () => {
    const small = rectArena({ minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 });
    const report = runHeadless({
      cats: twoCats.map((c) => ({ ...c, start: { x: 0, z: 0 } })),
      arena: small,
      steps: 1800,
    });
    expect(report.ok).toBe(true);
    for (const cat of report.cats) {
      expect(cat.outOfArena).toBe(0);
      expect(Math.abs(cat.end.x)).toBeLessThanOrEqual(1.6);
      expect(Math.abs(cat.end.z)).toBeLessThanOrEqual(1.6);
    }
  });
});

describe("a headless run of the hall", () => {
  const report = runHeadless({
    cats: twoCats,
    arena: hall,
    steps: 3600, // a minute at 60 Hz
    visitors: (t) =>
      t > 5 ? [{ id: "visitor-1", at: { x: 0, z: 8 - Math.min(6, t * 0.2) } }] : [],
  });

  it("never leaves the arena or stands in a doorway", () => {
    for (const cat of report.cats) expect(cat.outOfArena, cat.id).toBe(0);
  });

  it("never lets the posture graph go inconsistent", () => {
    for (const cat of report.cats) expect(cat.postureFaults, cat.id).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("keeps the cats out of each other", () => {
    expect(report.minCatDistanceM).toBeGreaterThan(BLUE_POINT.radius + SEAL_POINT.radius - 1e-6);
  });

  it("replays exactly from the same seeds", () => {
    const again = runHeadless({
      cats: twoCats,
      arena: hall,
      steps: 3600,
      visitors: (t) =>
        t > 5 ? [{ id: "visitor-1", at: { x: 0, z: 8 - Math.min(6, t * 0.2) } }] : [],
    });
    expect(again.cats.map((c) => c.end)).toEqual(report.cats.map((c) => c.end));
    expect(again.cats.map((c) => c.behaviours)).toEqual(report.cats.map((c) => c.behaviours));
  });
});

/** Ticks one brain with a visitor standing still, and reports what it did. */
function withVisitor(
  seed: number,
  visitors: readonly Visitor[],
  seconds = 120,
): { behaviours: string[]; brain: ReturnType<typeof createBrain> } {
  const brain = createBrain(defaultParams, mulberry32(seed), hall, 0.2);
  let state: BodyState = {
    position: { x: 0, z: 0 },
    heading: 0,
    posture: "stand",
    clip: "idle",
    clipDone: false,
    arrived: true,
  };
  const behaviours: string[] = [];
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    const cmd = brain.tick(dt, state, t, { visitors });
    if (behaviours.at(-1) !== cmd.behaviour) behaviours.push(cmd.behaviour);
    // A crude body: walk straight at the target at the walk speed, and arrive.
    if (cmd.moveTo) {
      const dx = cmd.moveTo.x - state.position.x;
      const dz = cmd.moveTo.z - state.position.z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, defaultParams.speedsMPerS.walk * dt);
      state = {
        ...state,
        position:
          d > 1e-6
            ? { x: state.position.x + (dx / d) * step, z: state.position.z + (dz / d) * step }
            : state.position,
        arrived: d <= defaultParams.arrivalRadiusM,
      };
    }
  }
  return { behaviours, brain };
}

describe("greeting a visitor", () => {
  it("a cat greets someone who arrives, and stops by itself", () => {
    const { behaviours } = withVisitor(3, [{ id: "v1", at: { x: 3, z: 3 } }], 300);
    expect(behaviours).toContain("greet");
    // And it does not stay in it: something else follows.
    const last = behaviours.lastIndexOf("greet");
    expect(last).toBeLessThan(behaviours.length - 1);
  });

  it("does not pester: the same visitor is not greeted again within the cooldown", () => {
    const visitor = [{ id: "v1", at: { x: 3, z: 3 } }];
    const { brain } = withVisitor(3, visitor, 300);
    const snap = brain.snapshot();
    expect(snap.greetedAt["v1"]).toBeGreaterThan(0);
    // Two greetings of the same person inside one cooldown would mean the rule does nothing.
    const { behaviours } = withVisitor(3, visitor, defaultParams.greetCooldownS - 10);
    const greetings = behaviours.filter((b) => b === "greet").length;
    expect(greetings).toBeLessThanOrEqual(1);
  });

  it("two cats do not mob the same visitor", () => {
    const visitor = { id: "v1", at: { x: 0, z: 4 } };
    const report = runHeadless({
      cats: twoCats.map((c) => ({ ...c, start: { x: c.id === "blue" ? -1 : 1, z: 0 } })),
      arena: hall,
      steps: 5400,
      visitors: () => [visitor],
    });
    // Whoever gets there first claims them; the other cat is not greeting the same person.
    const greeters = report.cats.filter((c) => c.greeted.includes("v1"));
    expect(greeters.length).toBeLessThanOrEqual(1);
  });

  it("two cats never both crowd the same person", () => {
    const visitor = { id: "v1", at: { x: 0, z: 3 } };
    const world = new CatWorld({
      cats: twoCats.map((c) => ({ ...c, start: { x: c.id === "blue" ? -1.5 : 1.5, z: 0 } })),
      arena: hall,
      params: {
        ...defaultParams,
        initialDrives: { ...defaultParams.initialDrives, affection: 0.9 },
      },
    });
    const social = ["greet", "approach-player", "seek-affection", "accept-petting"];
    let bothSocial = 0;
    for (let i = 0; i < 5400; i++) {
      world.tick(1 / 60, i / 60, [visitor]);
      const busy = world.cats.filter((c) => social.includes(String(c.command?.behaviour)));
      if (busy.length > 1) bothSocial++;
    }
    expect(bothSocial, "at most one cat is ever with the visitor").toBe(0);
  });

  it("stops greeting when the visitor leaves", () => {
    const brain = createBrain(defaultParams, mulberry32(5), hall, 0.2);
    let state: BodyState = {
      position: { x: 0, z: 0 },
      heading: 0,
      posture: "stand",
      clip: "idle",
      clipDone: false,
      arrived: true,
    };
    let sawGreet = false;
    for (let t = 0; t < 400; t += 1 / 30) {
      const visitors = t < 200 ? [{ id: "v1", at: { x: 1.2, z: 0 } }] : [];
      const cmd = brain.tick(1 / 30, state, t, { visitors });
      if (cmd.behaviour === "greet") sawGreet = true;
      if (t > 210) expect(cmd.behaviour).not.toBe("greet");
      state = { ...state, arrived: true };
    }
    expect(sawGreet).toBe(true);
  });
});

describe("the cats know about each other", () => {
  it("each brain is told what the other cat is doing", () => {
    const world = new CatWorld({ cats: twoCats, arena: hall });
    world.tick(1 / 60, 0.1);
    const report = world.cats[0]!.brain.report(world.cats[0]!.state.position, "blue");
    expect(report.id).toBe("blue");
    expect(report.behaviour).not.toBeNull();
  });

  it("a brain's state survives a snapshot and restore", () => {
    const world = new CatWorld({ cats: twoCats, arena: hall });
    for (let i = 0; i < 600; i++) world.tick(1 / 60, i / 60, [{ id: "v1", at: { x: 2, z: 2 } }]);
    const saved = JSON.parse(JSON.stringify(world.snapshot())) as ReturnType<CatWorld["snapshot"]>;
    const other = new CatWorld({ cats: twoCats, arena: hall });
    other.restore(saved);
    expect(other.cats[0]!.brain.snapshot().drives).toEqual(world.cats[0]!.brain.snapshot().drives);
    expect(other.cats[0]!.brain.snapshot().greetedAt).toEqual(
      world.cats[0]!.brain.snapshot().greetedAt,
    );
  });
});
