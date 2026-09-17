import { describe, expect, it } from "vitest";
import { DEFAULT_STEER, headingTo, steer, wrapAngle, type Mover } from "./steer";

function run(start: Mover, target: { x: number; z: number }, maxSeconds = 20) {
  let m = start;
  let steps = 0;
  let peakSpeed = 0;
  const dt = 1 / 60;
  for (; steps < maxSeconds * 60; steps++) {
    const r = steer(m, target, dt, DEFAULT_STEER);
    peakSpeed = Math.max(peakSpeed, r.speed);
    m = { position: r.position, heading: r.heading };
    if (r.arrived) return { m, seconds: steps * dt, peakSpeed, arrived: true };
  }
  return { m, seconds: steps * dt, peakSpeed, arrived: false };
}

describe("steer", () => {
  it("arrives at a target straight ahead without exceeding the gait speed", () => {
    const r = run({ position: { x: 0, z: 0 }, heading: 0 }, { x: 0, z: 2 });
    expect(r.arrived).toBe(true);
    expect(r.peakSpeed).toBeLessThanOrEqual(DEFAULT_STEER.maxSpeed + 1e-9);
    // 2 m at 0.45 m/s plus the slowdown: a few seconds, not a crawl.
    expect(r.seconds).toBeGreaterThan(4);
    expect(r.seconds).toBeLessThan(8);
  });

  it("turns round for a target behind it and gets there", () => {
    const r = run({ position: { x: 0, z: 0 }, heading: 0 }, { x: 0, z: -1 });
    expect(r.arrived).toBe(true);
    expect(Math.abs(wrapAngle(r.m.heading - Math.PI))).toBeLessThan(0.2);
  });

  it("shuffles while the heading error is large", () => {
    const r = steer(
      { position: { x: 0, z: 0 }, heading: 0 },
      { x: -1, z: -1 },
      1 / 60,
      DEFAULT_STEER,
    );
    expect(r.speed).toBeLessThan(DEFAULT_STEER.maxSpeed * 0.2);
    expect(r.turnRate).toBeCloseTo(-DEFAULT_STEER.turnRate, 5);
  });

  it("reports arrival inside the radius and stops moving", () => {
    const r = steer(
      { position: { x: 0, z: 0 }, heading: 0 },
      { x: 0.02, z: 0.02 },
      1 / 60,
      DEFAULT_STEER,
    );
    expect(r.arrived).toBe(true);
    expect(r.speed).toBe(0);
    expect(r.position).toEqual({ x: 0, z: 0 });
  });

  it("does not overshoot in one large step", () => {
    const r = steer({ position: { x: 0, z: 0 }, heading: 0 }, { x: 0, z: 0.1 }, 1, DEFAULT_STEER);
    expect(r.position.z).toBeLessThanOrEqual(0.1 + 1e-9);
  });
});

describe("headingTo", () => {
  it("is 0 toward +z and positive toward +x (the left)", () => {
    expect(headingTo({ x: 0, z: 0 }, { x: 0, z: 1 })).toBeCloseTo(0);
    expect(headingTo({ x: 0, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(Math.PI / 2);
  });
});
