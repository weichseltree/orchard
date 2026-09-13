import { describe, expect, it } from "vitest";
import {
  PLAYBACK_FPS,
  advance,
  chunkOfFrame,
  clampTau,
  durationSeconds,
  durationTau,
  endTau,
  formatFrameTime,
  fractionOf,
  frameAt,
  nextSpeed,
  stepFrames,
  tauOfFraction,
  tauOfFrame,
  timeline,
  variantTimeline,
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

describe("recorded source clocks", () => {
  const times = [10, 10.1, 11.9, 12, 14];
  const irregular = timeline(5, 1, 10, { timesTau: times, sourceDtTau: 1 });

  it("round-trips every source timestamp rather than averaging irregular gaps", () => {
    for (const [frame, time] of times.entries()) {
      expect(tauOfFrame(irregular, frame)).toBe(time);
      expect(frameAt(irregular, time)).toBe(frame);
    }
    expect(tauOfFrame(irregular, 3)).toBe(12); // the old mean clock reported 13
    expect(frameAt(irregular, 11.8)).toBe(2);
    expect(stepFrames(irregular, 10.1, 1)).toBe(11.9);
    expect(tauOfFraction(irregular, 0.5)).toBe(12);
    expect(frameAt(irregular, -10)).toBe(0);
    expect(frameAt(irregular, 99)).toBe(4);
    expect(frameAt(irregular, Number.NaN)).toBe(0);
  });

  it("retains small intervals on a large absolute source clock", () => {
    const exact = [1_000_000_000, 1_000_000_000.001, 1_000_000_000.008];
    const large = timeline(3, 0.004, exact[0], { timesTau: exact });
    expect(tauOfFrame(large, 1)).toBe(exact[1]);
    expect(frameAt(large, exact[1]!)).toBe(1);
    expect(endTau(large)).toBe(exact[2]);
  });

  it("runs every frame-strided tier at the same source-time rate", () => {
    const high = timeline(801, 0.5);
    const phone = timeline(401, 1, 0, { frameStride: 2 });
    expect(advance(phone, 0, 1, 1)).toBe(advance(high, 0, 1, 1));
    expect(durationSeconds(phone)).toBe(durationSeconds(high));
    // A different retained mean on an irregular sequence must also preserve speed.
    const coarse = timeline(3, 2, 10, { timesTau: [10, 11.9, 14], frameStride: 2, sourceDtTau: 1 });
    expect(advance(coarse, 10, 0.01, 1)).toBe(advance(irregular, 10, 0.01, 1));
  });

  it("reads exact timestamps and original cadence from a bundle variant", () => {
    const exact = variantTimeline({ frames: 3, dt_tau: 2, t0_tau: 10, frame_stride: 2,
      slot_stride: 1, chunk_frames: 3, bytes: 0, chunks: [], times_tau: [10, 11.9, 14],
      source_dt_tau: 1 });
    expect(tauOfFrame(exact, 1)).toBe(11.9);
    expect(exact.playbackDtTau).toBe(1);
  });

  it.each([[10, 11], [10, 10, 14], [10, Number.NaN, 14], [9, 11, 14]])(
    "rejects a missing, folded or nonfinite frame clock %j", (...bad) => {
      expect(() => timeline(3, 2, 10, { timesTau: bad })).toThrow(/frame times/);
    },
  );
});

describe("frame-time readouts", () => {
  it("distinguishes millisecond samples on a large absolute clock", () => {
    const times = [1_000_000_000, 1_000_000_000.001, 1_000_000_000.002];
    const clock = timeline(3, 0.001, times[0], { timesTau: times });
    expect(times.map((_, frame) => formatFrameTime(clock, frame))).toEqual([
      "1000000000", "1000000000.001", "1000000000.002",
    ]);
  });

  it("retains tiny cadences near both zero and a nonzero origin", () => {
    for (const times of [[1e-20, 2e-20, 3e-20], [1, 1.000000000000001, 1.000000000000002]]) {
      const clock = timeline(3, (times[2]! - times[0]!) / 2, times[0], { timesTau: times });
      const labels = times.map((_, frame) => formatFrameTime(clock, frame));
      expect(new Set(labels).size).toBe(times.length);
      expect(labels.map(Number)).toEqual(times);
    }
  });

  it("removes ordinary floating-point noise without inventing extra precision", () => {
    const clock = timeline(4, 0.1);
    expect(tauOfFrame(clock, 3)).toBe(0.30000000000000004);
    expect(formatFrameTime(clock, 3)).toBe("0.3");
    expect(formatFrameTime(clock, 0)).toBe("0");
  });

  it("uses the local exact spacing of an irregular clock and preserves isolated times", () => {
    const times = [100, 100.00000001, 900];
    const clock = timeline(3, 400, times[0], { timesTau: times });
    expect(formatFrameTime(clock, 1)).toBe("100.00000001");
    expect(formatFrameTime(timeline(1, 0, 0.1234567890123456), 0)).toBe("0.1234567890123456");
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
