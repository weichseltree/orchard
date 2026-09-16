import { describe, expect, it } from "vitest";
import { watchXrSupport, type XrSystemLike } from "./xr";

// Adapted from someotherlife's apps/client/src/xr/support.test.ts (BACKLOG 23),
// plus the out-of-order case the token exists for, which that suite never had.

class FakeEvents {
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeXr extends FakeEvents implements XrSystemLike {
  constructor(public supported: boolean | Error = false) {
    super();
  }

  isSessionSupported(mode: XRSessionMode): Promise<boolean> {
    expect(mode).toBe("immersive-vr");
    if (this.supported instanceof Error) return Promise.reject(this.supported);
    return Promise.resolve(this.supported);
  }
}

/** Answers each probe only when the test says so, in whatever order it says. */
class ManualXr extends FakeEvents implements XrSystemLike {
  readonly pending: Array<(supported: boolean) => void> = [];

  isSessionSupported(): Promise<boolean> {
    return new Promise((resolve) => this.pending.push(resolve));
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("watchXrSupport", () => {
  it("reports the first probe", async () => {
    const seen: boolean[] = [];
    watchXrSupport((s) => seen.push(s), { xr: new FakeXr(true), focus: new FakeEvents() });
    await settle();
    expect(seen).toEqual([true]);
  });

  it("re-probes when a headset appears after load", async () => {
    const xr = new FakeXr(false);
    const seen: boolean[] = [];
    watchXrSupport((s) => seen.push(s), { xr, focus: new FakeEvents() });
    await settle();
    xr.supported = true;
    xr.emit("devicechange");
    await settle();
    expect(seen).toEqual([false, true]);
  });

  it("re-probes when the window regains focus", async () => {
    const xr = new FakeXr(false);
    const focus = new FakeEvents();
    const seen: boolean[] = [];
    watchXrSupport((s) => seen.push(s), { xr, focus });
    await settle();
    xr.supported = true;
    focus.emit("focus");
    await settle();
    expect(seen).toEqual([false, true]);
  });

  it("does not let an older probe's answer land after a newer one", async () => {
    const xr = new ManualXr();
    const seen: boolean[] = [];
    watchXrSupport((s) => seen.push(s), { xr, focus: new FakeEvents() });
    xr.emit("devicechange"); // the headset came on while the load probe was still out

    const [loadProbe, deviceProbe] = xr.pending;
    deviceProbe!(true);
    await settle();
    loadProbe!(false); // the stale answer arrives last
    await settle();

    expect(seen).toEqual([true]);
  });

  it("reports only changes", async () => {
    const xr = new FakeXr(true);
    const seen: boolean[] = [];
    watchXrSupport((s) => seen.push(s), { xr, focus: new FakeEvents() });
    await settle();
    xr.emit("devicechange");
    xr.emit("devicechange");
    await settle();
    expect(seen).toEqual([true]);
  });

  it("treats a throwing isSessionSupported as unsupported", async () => {
    const seen: boolean[] = [];
    watchXrSupport((s) => seen.push(s), {
      xr: new FakeXr(new Error("no runtime")),
      focus: new FakeEvents(),
    });
    await settle();
    expect(seen).toEqual([false]);
  });

  it("reports unsupported and listens for nothing without WebXR", async () => {
    const focus = new FakeEvents();
    const seen: boolean[] = [];
    watchXrSupport((s) => seen.push(s), { xr: null, focus });
    await settle();
    expect(seen).toEqual([false]);
    expect(focus.count("focus")).toBe(0);
  });

  it("stops reporting and drops its listeners when stopped", async () => {
    const xr = new FakeXr(false);
    const focus = new FakeEvents();
    const seen: boolean[] = [];
    const stop = watchXrSupport((s) => seen.push(s), { xr, focus });
    await settle();
    stop();
    xr.supported = true;
    xr.emit("devicechange");
    focus.emit("focus");
    await settle();
    expect(seen).toEqual([false]);
    expect(xr.count("devicechange")).toBe(0);
    expect(focus.count("focus")).toBe(0);
  });
});
