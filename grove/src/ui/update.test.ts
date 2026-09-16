import { describe, expect, it, vi } from "vitest";
import { workerWanted } from "../sw/register";
import {
  createUpdater,
  isNewer,
  parseVersion,
  planForCue,
  planUpdate,
  preloadReloadAllowed,
  PRELOAD_RELOAD_GUARD_MS,
  safeMoment,
} from "./update";

describe("version stamps", () => {
  it("reads version.json and refuses anything without a commit", () => {
    expect(parseVersion({ commit: "abc1234", builtAt: "t", sw: true })).toEqual({
      commit: "abc1234",
      builtAt: "t",
      sw: true,
    });
    expect(parseVersion({ commit: "abc1234" })).toEqual({ commit: "abc1234", builtAt: "" });
    expect(parseVersion({ commit: "abc1234", forced: true })).toEqual({ commit: "abc1234", builtAt: "", forced: true });
    expect(parseVersion({ commit: "abc1234", forced: "yes" })).toEqual({ commit: "abc1234", builtAt: "" });
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

describe("a forced update", () => {
  const own = { commit: "abc1234", builtAt: "t1" };

  it("is asked for only by a newer stamp that says so", () => {
    expect(planUpdate(own, null)).toBe("none");
    expect(planUpdate(own, { commit: "abc1234", builtAt: "t1", forced: true })).toBe("none");
    expect(planUpdate(own, { commit: "def5678", builtAt: "t2" })).toBe("offer");
    expect(planUpdate(own, { commit: "def5678", builtAt: "t2", forced: true })).toBe("forced");
  });

  function headset(isPresenting: boolean) {
    const listeners: Array<() => void> = [];
    const xr = {
      isPresenting,
      addEventListener: (_type: "sessionend", listener: () => void) => void listeners.push(listener),
      endSession() {
        xr.isPresenting = false;
        for (const listener of listeners) listener();
      },
    };
    const offered = { isConnected: true };
    const hud = { offer: vi.fn(() => offered as unknown as HTMLElement) };
    const reload = vi.fn();
    const update = createUpdater({ hud, whenFree: safeMoment(xr), reload });
    return { xr, hud, reload, update, offered };
  }

  it("does not reload under a visitor in a headset until the session ends", () => {
    const { xr, hud, reload, update } = headset(true);
    update("forced");
    update("forced");
    expect(reload).not.toHaveBeenCalled();
    xr.endSession();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(hud.offer).not.toHaveBeenCalled();
  });

  it("reloads at once outside a session, with nothing to dismiss", () => {
    const { hud, reload, update } = headset(false);
    update("forced");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(hud.offer).not.toHaveBeenCalled();
  });

  it("takes over an offer that is up, and one that is waiting for a session to end", () => {
    const up = headset(false);
    up.update("offer");
    expect(up.hud.offer).toHaveBeenCalledTimes(1);
    up.update("offer");
    expect(up.hud.offer).toHaveBeenCalledTimes(1);
    expect(up.reload).not.toHaveBeenCalled();
    up.update("forced");
    expect(up.reload).toHaveBeenCalledTimes(1);

    const waiting = headset(true);
    waiting.update("offer");
    waiting.update("forced");
    expect(waiting.reload).not.toHaveBeenCalled();
    waiting.xr.endSession();
    expect(waiting.reload).toHaveBeenCalledTimes(1);
    expect(waiting.hud.offer).not.toHaveBeenCalled();
  });

  it("still offers, once, when nothing forces it", () => {
    const { xr, hud, reload, update, offered } = headset(true);
    update("offer");
    expect(hud.offer).not.toHaveBeenCalled();
    xr.endSession();
    expect(hud.offer).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    offered.isConnected = false; // the visitor took it; a later build may offer again
    update("offer");
    expect(hud.offer).toHaveBeenCalledTimes(2);
  });
});

describe("planForCue", () => {
  const own = { commit: "aaa", builtAt: "2026-09-16T10:00:00Z" };

  it("requires a newer build even when its stamp does not say forced", () => {
    // The cue is a host saying everyone onto the new build now.
    expect(planForCue(own, { commit: "bbb", builtAt: "2026-09-16T11:00:00Z" })).toBe("forced");
  });

  it("does nothing to a page that is already current", () => {
    // Otherwise the cue throws every visitor out of the room for no reason.
    expect(planForCue(own, { ...own })).toBe("none");
  });

  it("does nothing when the version cannot be read", () => {
    expect(planForCue(own, null)).toBe("none");
  });
});
