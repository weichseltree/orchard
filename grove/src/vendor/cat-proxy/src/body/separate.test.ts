import { describe, expect, it } from "vitest";
import { separate } from "./separate";

describe("separate", () => {
  it("leaves bodies that do not overlap where they are", () => {
    const a = { x: 0, z: 0 };
    const b = { x: 1, z: 0 };
    const out = separate([
      { position: a, radius: 0.2 },
      { position: b, radius: 0.2 },
    ]);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });

  it("pushes overlapping bodies apart to exactly their combined radii, half each", () => {
    const out = separate([
      { position: { x: 0, z: 0 }, radius: 0.2 },
      { position: { x: 0.3, z: 0 }, radius: 0.2 },
    ]);
    expect(out[0]!.x).toBeCloseTo(-0.05, 9);
    expect(out[1]!.x).toBeCloseTo(0.35, 9);
    expect(Math.hypot(out[1]!.x - out[0]!.x, out[1]!.z - out[0]!.z)).toBeCloseTo(0.4, 9);
  });

  it("separates bodies standing on the same spot without producing NaN", () => {
    const out = separate([
      { position: { x: 1, z: 1 }, radius: 0.21 },
      { position: { x: 1, z: 1 }, radius: 0.2 },
    ]);
    for (const p of out) expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    expect(Math.hypot(out[1]!.x - out[0]!.x, out[1]!.z - out[0]!.z)).toBeCloseTo(0.41, 9);
  });

  it("two cats walking into each other never overlap after a frame's separation", () => {
    let a = { x: -1, z: 0 };
    let b = { x: 1, z: 0.05 };
    for (let f = 0; f < 200; f++) {
      a = { x: a.x + 0.01, z: a.z };
      b = { x: b.x - 0.01, z: b.z };
      [a, b] = separate([
        { position: a, radius: 0.21 },
        { position: b, radius: 0.2 },
      ]) as [typeof a, typeof b];
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(0.41 - 1e-9);
    }
  });
});
