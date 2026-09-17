import { describe, expect, it } from "vitest";
import { SELECTABLE } from "./behaviours";
import { defaultParams } from "./params";
import { simulate, type SimEvent } from "./simulate";
import { episodes } from "./test-support";

// Regression test for round-2 dithering: eat/groom/play could be selected again after their own
// drive was already satisfied (goalDone's threshold wasn't also a selection-time gate), so
// softmax would pick one, it would self-terminate within a single tick, and the next decision —
// facing an almost-unchanged, flat scoring landscape — would often do the same thing again.
// Exercises food, a toy, a player (near/petting/leaving) and a loud noise, so every behaviour
// with a drive-threshold goalDone gets a real chance to run.
const events: SimEvent[] = [
  { t: 30, event: { kind: "food-offered", at: { x: -1.2, z: 0.8 } } },
  { t: 90, event: { kind: "toy-moved", at: { x: 1.5, z: -1.5 } } },
  { t: 150, event: { kind: "player-near", at: { x: 0.2, z: 0.2 } } },
  { t: 155, event: { kind: "hand-offered", at: { x: 0.1, z: 0.1 } } },
  { t: 160, event: { kind: "petted" } },
  { t: 165, event: { kind: "petted" } },
  { t: 240, event: { kind: "loud-noise", at: { x: 0.3, z: 0.3 } } },
  { t: 300, event: { kind: "player-far" } },
];

const MIN_EPISODE_S = 1.5;

describe("episodes don't dither", () => {
  it("no episode runs shorter than ~1.5s unless an event cut it short, it's flee, or it's a one-shot", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const timeline = simulate(defaultParams, seed, 600, events, 0.25);
      const eps = episodes(timeline);
      expect(eps.length).toBeGreaterThan(3); // sanity: this seed actually produced episodes

      // The last episode's real duration is unknown (the simulation just stops) — skip it.
      for (let i = 0; i < eps.length - 1; i++) {
        const current = eps[i]!;
        const next = eps[i + 1]!;
        const durationS = next.startedAt - current.startedAt;
        if (durationS >= MIN_EPISODE_S) continue;

        const cutShortByEvent = next.startedByInterrupt; // this episode ended BECAUSE of an event
        const isFlee = current.behaviour === "flee";
        const isOneShot = current.behaviour === "stretch"; // a one-shot clip: waits for clipDone
        expect(
          cutShortByEvent || isFlee || isOneShot,
          `seed ${seed}: "${current.behaviour}" at t=${current.startedAt} lasted only ${durationS.toFixed(2)}s ` +
            `(next: "${next.behaviour}", startedByInterrupt=${next.startedByInterrupt})`,
        ).toBe(true);
      }
    }
  });

  it("eat/groom/play never START a fresh episode while their own drive is already satisfied", () => {
    // A more direct check on the fix, at the exact moment it matters (selection), rather than
    // over the whole episode — mid-episode, relief legitimately drives the value below SATISFIED
    // right before goalDone ends it, which is correct and not what this checks for.
    const hungryPlayfulParams = {
      ...defaultParams,
      initialDrives: { ...defaultParams.initialDrives, hunger: 0.9, curiosity: 0.9, grooming: 0.9 },
    };
    for (let seed = 1; seed <= 60; seed++) {
      const timeline = simulate(hungryPlayfulParams, seed, 900, events, 0.25);
      const firstTickByEpisode = new Map<number, (typeof timeline)[number]>();
      for (const e of timeline) {
        if (!firstTickByEpisode.has(e.episodeStartedAt))
          firstTickByEpisode.set(e.episodeStartedAt, e);
      }
      for (const e of firstTickByEpisode.values()) {
        if (e.behaviour === "eat") expect(e.drives.hunger).toBeGreaterThan(SELECTABLE);
        if (e.behaviour === "play") expect(e.drives.curiosity).toBeGreaterThan(SELECTABLE);
        if (e.behaviour === "groom") expect(e.drives.grooming).toBeGreaterThan(SELECTABLE);
      }
    }
  });
});
