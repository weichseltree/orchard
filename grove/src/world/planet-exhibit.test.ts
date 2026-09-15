import { describe, expect, it } from "vitest";
import { frameOfTime, yawToward } from "./planet-exhibit";

// The two pieces of arithmetic the cutaway depends on: which tape frame a
// decoded video time names (HLS presents its first frame after zero), and
// how far to turn a world so its removed quarter faces the visitor.

describe("frameOfTime", () => {
  it("subtracts the measured presentation origin before rounding", () => {
    const origin = 0.0666667;
    expect(frameOfTime(origin, origin, 30, 1129)).toBe(0);
    expect(frameOfTime(origin + 29 / 30, origin, 30, 1129)).toBe(29);
    expect(frameOfTime(origin + 1128 / 30, origin, 30, 1129)).toBe(1128);
    // A zero origin, assumed instead of measured, is two frames out.
    expect(frameOfTime(origin + 29 / 30, 0, 30, 1129)).toBe(31);
  });

  it("holds the first frame before the origin and the last past the end", () => {
    expect(frameOfTime(0, 0.0666667, 30, 1129)).toBe(0);
    expect(frameOfTime(60, 0, 30, 1129)).toBe(1128);
  });
});

describe("yawToward", () => {
  const cut: [number, number, number] = [Math.SQRT1_2, 0, -Math.SQRT1_2];

  it("turns the +X,-Z quarter to face +Z by three quarters of a turn, as the reference viewer does", () => {
    expect(yawToward(cut, { x: 0, z: 1 })).toBeCloseTo(-3 * Math.PI / 4);
  });

  it("leaves a quarter already facing its target alone", () => {
    expect(yawToward(cut, { x: 1, z: -1 })).toBeCloseTo(0);
  });

  it("turns the quarter toward the landing from the Orrery's east world", () => {
    // World at (150, -420), landing at (0, -400): the target lies at -X, +Z.
    const yaw = yawToward(cut, { x: -150, z: 20 });
    const x = cut[0] * Math.cos(yaw) + cut[2] * Math.sin(yaw);
    const z = -cut[0] * Math.sin(yaw) + cut[2] * Math.cos(yaw);
    expect(Math.atan2(x, z)).toBeCloseTo(Math.atan2(-150, 20));
  });
});
