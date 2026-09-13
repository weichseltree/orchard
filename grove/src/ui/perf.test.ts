import { describe, expect, it } from "vitest";
import { PerfMeter } from "./perf";

describe("frame cadence", () => {
  it("keeps long stalls visible instead of applying the movement timestep cap", () => {
    const meter = new PerfMeter();
    for (let i = 0; i < 99; i++) meter.sample(0.016);
    meter.sample(0.4);
    expect(meter.snapshot()).toMatchObject({
      samples: 100, p50Ms: 16, p95Ms: 16, p99Ms: 16, maxMs: 400,
      overBudget: 1, overBudgetPercent: 1, stalls: 1, sessionStalls: 1,
    });
    expect(meter.frameMs).toBeCloseTo(19.84);
  });

  it("expires old samples but retains session stall counts", () => {
    const meter = new PerfMeter(3);
    for (const seconds of [0.5, 0.02, 0.01, 0.03]) meter.sample(seconds);
    expect(meter.snapshot()).toMatchObject({ samples: 3, meanMs: 20, p50Ms: 20, maxMs: 30, stalls: 0, sessionFrames: 4, sessionStalls: 1 });
  });

  it("changes targets without mixing desktop intervals into XR", () => {
    const meter = new PerfMeter();
    meter.sample(1 / 60);
    meter.setTargetHz(72);
    expect(meter.snapshot().samples).toBe(0);
    meter.sample(1 / 72);
    meter.sample(0.016);
    meter.setTargetHz(72);
    expect(meter.snapshot()).toMatchObject({ samples: 2, targetHz: 72, overBudget: 1, overBudgetPercent: 50 });
  });

  it("rejects invalid configuration and ignores invalid intervals", () => {
    expect(() => new PerfMeter(0)).toThrow();
    const meter = new PerfMeter();
    for (const dt of [0, -1, Infinity, NaN]) meter.sample(dt);
    expect(meter.snapshot()).toMatchObject({ samples: 0, fps: 0, meanMs: 0, p95Ms: 0 });
    expect(() => meter.setTargetHz(NaN)).toThrow();
  });
});
