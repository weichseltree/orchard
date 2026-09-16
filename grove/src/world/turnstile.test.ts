import { describe, expect, it } from "vitest";
import { TURNSTILE_MAX_MS, Turnstile } from "./turnstile";

describe("Turnstile", () => {
  it("is open until a cue closes it", () => {
    const t = new Turnstile();
    expect(t.closed(0)).toBe(false);
    expect(t.why(0)).toBeNull();
  });

  it("holds for the broadcast's lifetime and then opens", () => {
    const t = new Turnstile();
    t.hold(60_000, "the orchard is updating", 1_000);
    expect(t.closed(60_999)).toBe(true);
    expect(t.closed(61_000)).toBe(false);
  });

  it("gives the host's words as the reason, or a plain one", () => {
    const t = new Turnstile();
    t.hold(1_000, "  hold still  ", 0);
    expect(t.why(0)).toBe("hold still");
    const quiet = new Turnstile();
    quiet.hold(1_000, "", 0);
    expect(quiet.why(0)).toBe("the doors are held for a moment");
  });

  it("never holds longer than the module's own ten-minute ceiling", () => {
    // A door kept shut by a server bug is a trapped visitor.
    const t = new Turnstile();
    t.hold(24 * 3_600_000, "", 0);
    expect(t.closed(TURNSTILE_MAX_MS - 1)).toBe(true);
    expect(t.closed(TURNSTILE_MAX_MS)).toBe(false);
  });

  it("lets a second turnstile extend the hold but never cut it short", () => {
    const t = new Turnstile();
    t.hold(60_000, "long", 0);
    t.hold(5_000, "short", 1_000);
    expect(t.closed(59_000)).toBe(true);
    t.hold(120_000, "longer", 2_000);
    expect(t.closed(121_000)).toBe(true);
  });

  it("ignores a hold with no length", () => {
    const t = new Turnstile();
    t.hold(0, "x", 0);
    t.hold(Number.NaN, "x", 0);
    expect(t.closed(0)).toBe(false);
  });

  it("says the doors opened exactly once", () => {
    const t = new Turnstile();
    expect(t.opened(0)).toBe(false);
    t.hold(1_000, "wait", 0);
    expect(t.opened(500)).toBe(false);
    expect(t.opened(1_000)).toBe(true);
    expect(t.opened(1_100)).toBe(false);
    expect(t.why(1_100)).toBeNull();
  });
});
