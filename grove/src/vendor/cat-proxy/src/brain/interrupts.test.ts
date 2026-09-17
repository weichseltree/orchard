import { describe, expect, it } from "vitest";
import { defaultParams } from "./params";
import { simulate, type SimEvent } from "./simulate";

// A very sleepy, otherwise-satisfied cat, with the softmax sharpened toward its best option so
// the *initial* pick is reliably sleep — the dynamics under test (does a loud noise break it out
// into flee) don't depend on this, but a flaky starting state would make the test flaky too.
const sleepyParams = {
  ...defaultParams,
  temperature: 0.02,
  initialDrives: {
    ...defaultParams.initialDrives,
    energy: 0.02,
    grooming: 0.05,
    curiosity: 0.05,
    fear: 0,
  },
};

describe("event interrupts", () => {
  it("a loud noise breaks a sleeping cat into flee, startling first", () => {
    const events: SimEvent[] = [{ t: 5, event: { kind: "loud-noise", at: { x: 0.2, z: 0 } } }];
    const timeline = simulate(sleepyParams, 7, 20, events, 0.25);

    const justBeforeNoise = timeline.filter((e) => e.t >= 3 && e.t < 5);
    expect(justBeforeNoise.every((e) => e.behaviour === "sleep")).toBe(true);

    const afterNoise = timeline.filter((e) => e.t >= 5);
    expect(afterNoise.some((e) => e.behaviour === "flee")).toBe(true);
    expect(afterNoise.some((e) => e.clip === "startle")).toBe(true);
    // startle always precedes the trot-away, never the other way round
    const firstFlee = afterNoise.find((e) => e.behaviour === "flee")!;
    expect(firstFlee.clip).toBe("startle");
  });

  it("a nearby loud noise always startles an awake cat, whatever it is committed to", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const events: SimEvent[] = [{ t: 30, event: { kind: "loud-noise", at: { x: 0.5, z: 0.5 } } }];
      const timeline = simulate(defaultParams, seed, 34, events, 0.25);
      const after = timeline.filter((e) => e.t >= 30);
      expect(after.some((e) => e.behaviour === "flee" && e.clip === "startle")).toBe(true);
    }
  });

  it("a distant loud noise barely registers on a sleeping cat", () => {
    const events: SimEvent[] = [{ t: 5, event: { kind: "loud-noise", at: { x: 50, z: 50 } } }];
    const timeline = simulate(sleepyParams, 7, 20, events, 0.25);
    const afterNoise = timeline.filter((e) => e.t >= 5 && e.t < 15);
    // far enough that the fear spike is negligible: no flee episode should win out
    expect(afterNoise.every((e) => e.behaviour !== "flee")).toBe(true);
  });

  it("food offered to a hungry cat leads to eating within a short window", () => {
    const hungryParams = {
      ...defaultParams,
      initialDrives: { ...defaultParams.initialDrives, hunger: 0.85 },
    };
    const events: SimEvent[] = [{ t: 3, event: { kind: "food-offered", at: { x: 1.5, z: 1.5 } } }];
    const timeline = simulate(hungryParams, 11, 120, events, 0.25);
    const afterOffer = timeline.filter((e) => e.t >= 3);
    const firstEat = afterOffer.find((e) => e.behaviour === "eat" && e.clip === "eat");
    expect(firstEat).toBeDefined();
    expect(firstEat!.t - 3).toBeLessThan(30); // arrives and starts eating well within 30s
  });

  it("petting eventually ends by the cat leaving once affection saturates", () => {
    const params = {
      ...defaultParams,
      initialDrives: { ...defaultParams.initialDrives, affection: 0.9, fear: 0 },
    };
    const events: SimEvent[] = [
      { t: 2, event: { kind: "player-near", at: { x: 0, z: 0.3 } } },
      { t: 3, event: { kind: "petted" } },
      { t: 6, event: { kind: "petted" } },
      { t: 9, event: { kind: "petted" } },
      { t: 12, event: { kind: "petted" } },
      { t: 15, event: { kind: "petted" } },
      { t: 18, event: { kind: "petted" } },
    ];
    const timeline = simulate(params, 3, 60, events, 0.25);

    expect(timeline.some((e) => e.t >= 3 && e.t < 5 && e.behaviour === "accept-petting")).toBe(
      true,
    );

    // after enough pets, affection drops below the saturation threshold and the cat leaves —
    // find the point it stops accepting petting for good and never returns to it
    const petIndices = timeline
      .map((e, i) => (e.behaviour === "accept-petting" ? i : -1))
      .filter((i) => i >= 0);
    const lastPetIndex = petIndices[petIndices.length - 1]!;
    const after = timeline.slice(lastPetIndex + 1);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((e) => e.behaviour !== "accept-petting")).toBe(true);
    expect(after.some((e) => e.clip === "walk" || e.clip === "trot")).toBe(true);
  });
});
