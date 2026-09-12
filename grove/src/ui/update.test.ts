import { describe, expect, it } from "vitest";
import { workerWanted } from "../sw/register";
import { isNewer, parseVersion, preloadReloadAllowed, PRELOAD_RELOAD_GUARD_MS } from "./update";

describe("version stamps", () => {
  it("reads version.json and refuses anything without a commit", () => {
    expect(parseVersion({ commit: "abc1234", builtAt: "t", sw: true })).toEqual({
      commit: "abc1234",
      builtAt: "t",
      sw: true,
    });
    expect(parseVersion({ commit: "abc1234" })).toEqual({ commit: "abc1234", builtAt: "" });
    expect(parseVersion({ commit: "" })).toBeNull();
    expect(parseVersion("<!doctype html>")).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  it("offers a reload for another commit, and for a rebuild of the same dirty tree", () => {
    const own = { commit: "abc1234", builtAt: "t1" };
    expect(isNewer(own, { commit: "abc1234", builtAt: "t2" })).toBe(false);
    expect(isNewer(own, { commit: "def5678", builtAt: "t2" })).toBe(true);
    const dirty = { commit: "abc1234-dirty", builtAt: "t1" };
    expect(isNewer(dirty, { commit: "abc1234-dirty", builtAt: "t1" })).toBe(false);
    expect(isNewer(dirty, { commit: "abc1234-dirty", builtAt: "t2" })).toBe(true);
    // A page built without a stamp (dev) never nags.
    expect(isNewer({ commit: "", builtAt: "" }, { commit: "def5678", builtAt: "t" })).toBe(false);
  });

  it("reloads once for a stale lazy import, not in a loop", () => {
    const now = 1_000_000;
    expect(preloadReloadAllowed(null, now)).toBe(true);
    expect(preloadReloadAllowed(String(now - 1000), now)).toBe(false);
    expect(preloadReloadAllowed(String(now - PRELOAD_RELOAD_GUARD_MS - 1), now)).toBe(true);
    expect(preloadReloadAllowed("garbage", now)).toBe(true);
  });
});

describe("the kill switch", () => {
  it("wants the worker unless ?nosw or version.json says sw: false", () => {
    expect(workerWanted("", { sw: true })).toBe(true);
    expect(workerWanted("?room=hall", null)).toBe(true);
    expect(workerWanted("?nosw", { sw: true })).toBe(false);
    expect(workerWanted("?room=hall&nosw=1", null)).toBe(false);
    expect(workerWanted("", { sw: false })).toBe(false);
  });
});
