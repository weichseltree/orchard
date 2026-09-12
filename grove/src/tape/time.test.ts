import { describe, expect, it } from "vitest";
import {
  PLAYBACK_FPS,
  advance,
  chunkOfFrame,
  clampTau,
  durationSeconds,
  durationTau,
  endTau,
  fractionOf,
  frameAt,
  nextSpeed,
  stepFrames,
  tauOfFraction,
  tauOfFrame,
  timeline,
} from "./time";

// The scrubber's arithmetic: the slider, the [ ] keys and the VR thumbstick
// all land on the same frame, and playback speed means what it says.

const tl = timeline(801, 0.5, 0); // the spec's vr-high variant

describe("frames and time", () => {
  it("spans (frames - 1) x dt", () => {
    expect(durationTau(tl)).toBeCloseTo(400);
    expect(endTau(tl)).toBeCloseTo(400);
    expect(durationSeconds(tl)).toBeCloseTo(800 / PLAYBACK_FPS);
  });

  it("rounds a time to its nearest frame and clamps at both ends", () => {
    expect(frameAt(tl, 0)).toBe(0);
    expect(frameAt(tl, 0.24)).toBe(0);
    expect(frameAt(tl, 0.26)).toBe(1);
    expect(frameAt(tl, 10)).toBe(20);
    expect(frameAt(tl, -100)).toBe(0);
    expect(frameAt(tl, 1e6)).toBe(800);
    expect(tauOfFrame(tl, 20)).toBeCloseTo(10);
    expect(tauOfFrame(tl, 9999)).toBeCloseTo(400);
  });

  it("respects a non-zero t0", () => {
    const offset = timeline(11, 2, 100);
    expect(clampTau(offset, 0)).toBe(100);
    expect(frameAt(offset, 104)).toBe(2);
    expect(endTau(offset)).toBe(120);
    expect(fractionOf(offset, 110)).toBeCloseTo(0.5);
  });
});

describe("playback", () => {
  it("advances 30 tape frames per second at 1x", () => {
    expect(advance(tl, 0, 1, 1)).toBeCloseTo(PLAYBACK_FPS * 0.5);
    expect(frameAt(tl, advance(tl, 0, 1, 1))).toBe(30);
  });

  it("scales with speed", () => {
    for (const speed of [0.5, 1, 2, 4]) {
      expect(frameAt(tl, advance(tl, 0, 1, speed))).toBe(30 * speed);
    }
  });

  it("wraps when looping and stops at the end when not", () => {
    const near = endTau(tl) - 1;
    const wrapped = advance(tl, near, 1, 4, true);
    expect(wrapped).toBeLessThan(near);
    expect(advance(tl, near, 1, 4, false)).toBeCloseTo(endTau(tl));
    expect(advance(tl, 0, -1, 1, true)).toBeGreaterThan(0); // stepping back wraps round
  });

  it("goes nowhere on a one-frame tape", () => {
    const single = timeline(1, 0.5, 0);
    expect(advance(single, 0, 10, 4, true)).toBe(0);
    expect(fractionOf(single, 5)).toBe(0);
  });
});

describe("scrubbing", () => {
  it("moves whole frames with [ and ]", () => {
    expect(frameAt(tl, stepFrames(tl, 10, 1))).toBe(21);
    expect(frameAt(tl, stepFrames(tl, 10, -1))).toBe(19);
    expect(frameAt(tl, stepFrames(tl, 0, -5))).toBe(0);
    expect(frameAt(tl, stepFrames(tl, endTau(tl), 5))).toBe(800);
  });

  it("round-trips a slider position", () => {
    for (const fraction of [0, 0.25, 0.5, 1]) {
      expect(fractionOf(tl, tauOfFraction(tl, fraction))).toBeCloseTo(fraction);
    }
    expect(tauOfFraction(tl, -3)).toBe(0);
    expect(tauOfFraction(tl, 9)).toBeCloseTo(400);
    expect(tauOfFraction(tl, Number.NaN)).toBe(0);
  });

  it("cycles the speed ring", () => {
    expect(nextSpeed(0.5)).toBe(1);
    expect(nextSpeed(1)).toBe(2);
    expect(nextSpeed(2)).toBe(4);
    expect(nextSpeed(4)).toBe(0.5);
  });
});

describe("chunks", () => {
  it("maps a frame to the chunk that holds it", () => {
    expect(chunkOfFrame(60, 0)).toBe(0);
    expect(chunkOfFrame(60, 59)).toBe(0);
    expect(chunkOfFrame(60, 60)).toBe(1);
    expect(chunkOfFrame(60, 800)).toBe(13);
  });
});
