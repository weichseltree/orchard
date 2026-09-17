import { describe, expect, it } from "vitest";
import { defaultParams } from "./params";
import { simulate } from "./simulate";
import type { BehaviourId } from "./types";

describe("a 2h run looks roughly like a house cat's day", () => {
  it("spends the majority of its time asleep or resting, with only loose bounds elsewhere", () => {
    // No events: only the "at home, nothing going on" behaviours (sleep/rest/sit-watch/groom/
    // wander/stretch) are ever reachable — food/toy/player/noise-gated ones stay excluded.
    // Across several seeds, not one: a single 2h run of a stochastic model lands anywhere in a
    // wide band, so one seed tests the seed rather than the model (three of them drifted over
    // this bound when the wander target picker changed shape, with the model unchanged).
    const timeline = [1, 2, 3, 4, 5].flatMap((seed) =>
      simulate(defaultParams, seed, 2 * 3600, [], 1),
    );
    const totals: Partial<Record<BehaviourId, number>> = {};
    for (const e of timeline) totals[e.behaviour] = (totals[e.behaviour] ?? 0) + 1;
    const total = timeline.length;
    const fraction = (id: BehaviourId) => (totals[id] ?? 0) / total;

    const restful = fraction("sleep") + fraction("rest");
    expect(restful).toBeGreaterThan(0.35); // a house cat sleeps ~12-16h/day; loose lower bound
    expect(restful).toBeLessThan(0.98); // but isn't catatonic either

    // nothing that requires an event ever fires without one
    expect(fraction("flee")).toBe(0);
    expect(fraction("eat")).toBe(0);
    expect(fraction("accept-petting")).toBe(0);

    // the reachable behaviours actually get a look-in across 2h of simulated time
    const distinctSeen = new Set(timeline.map((e) => e.behaviour)).size;
    expect(distinctSeen).toBeGreaterThanOrEqual(3);
  });
});
