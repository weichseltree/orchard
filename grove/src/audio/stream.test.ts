import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_LAG_SECONDS, lagSeconds, shouldFallSilent } from "./stream";

describe("lagSeconds", () => {
  it("is the live edge minus current time", () => {
    expect(lagSeconds(100, 97)).toBe(3);
    expect(lagSeconds(100, 100)).toBe(0);
  });

  it("never goes negative: a currentTime ahead of a stale edge reads as caught up", () => {
    expect(lagSeconds(100, 103)).toBe(0);
  });
});

describe("shouldFallSilent", () => {
  it("is false at and under the budget, true past it", () => {
    expect(shouldFallSilent(10, 10)).toBe(false);
    expect(shouldFallSilent(10.1, 10)).toBe(true);
    expect(shouldFallSilent(0, 10)).toBe(false);
  });

  it("defaults to AUDIO-STREAM.md §3's 10 s budget", () => {
    expect(shouldFallSilent(DEFAULT_MAX_LAG_SECONDS + 0.01)).toBe(true);
    expect(shouldFallSilent(DEFAULT_MAX_LAG_SECONDS)).toBe(false);
  });
});
