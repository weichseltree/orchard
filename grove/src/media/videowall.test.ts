import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoWall } from "./videowall";

const hls = vi.hoisted(() => ({ created: 0, destroyed: 0, fail: false, failSource: false, supported: true }));
vi.mock("hls.js", () => ({
  default: class {
    static isSupported() { return hls.supported; }
    constructor() {
      if (hls.fail) throw new Error("decoder unavailable");
      ++hls.created;
    }
    loadSource() { if (hls.failSource) throw new Error("invalid source"); }
    attachMedia() {}
    destroy() { ++hls.destroyed; }
  },
}));

class VideoStub {
  style = { cssText: "" };
  muted = true;
  defaultPlaybackRate = 1;
  playbackRate = 1;
  src = "";
  native: CanPlayTypeResult = "";
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  load = vi.fn();
  setAttribute() {}
  removeAttribute() { this.src = ""; }
  remove() {}
  canPlayType() { return this.native; }
}

const walls: VideoWall[] = [];
async function wall(native: CanPlayTypeResult = "", onNotice = vi.fn()): Promise<VideoWall> {
  const video = new VideoStub();
  video.native = native;
  vi.stubGlobal("document", { createElement: () => video, body: { append() {} } });
  const result = await VideoWall.create({ master: "/test/master.m3u8", widthMeters: 6, onNotice });
  walls.push(result);
  return result;
}

beforeEach(() => {
  hls.created = 0; hls.destroyed = 0; hls.fail = false;
  hls.failSource = false; hls.supported = true;
  vi.stubGlobal("MediaSource", {});
  vi.stubGlobal("ManagedMediaSource", undefined);
});
afterEach(() => {
  for (const item of walls.splice(0)) item.dispose();
  vi.unstubAllGlobals();
});

describe("the one video decoder", () => {
  it("cancels a pending attachment before handing the decoder to the next room", async () => {
    const first = await wall();
    const second = await wall();
    const pending = first.attach();
    expect(first.attach()).toBe(pending);
    first.release();
    expect(await second.attach()).toBe(true);
    expect(await pending).toBe(false);
    expect(first.mode).toBe("poster");
    expect(second.mode).toBe("hls.js");
    expect(hls.created).toBe(1);
    first.release();
    const third = await wall();
    expect(await third.attach()).toBe(false);
  });

  it("returns the decoder after startup failure so a different wall can play", async () => {
    hls.fail = true;
    const notice = vi.fn();
    const first = await wall("", notice);
    expect(await first.attach()).toBe(false);
    expect(notice).toHaveBeenCalledWith(expect.stringContaining("decoder unavailable"));
    hls.fail = false;
    const second = await wall();
    expect(await second.attach()).toBe(true);
  });

  it("destroys a partially started decoder and allows the same wall to retry", async () => {
    hls.failSource = true;
    const first = await wall();
    expect(await first.attach()).toBe(false);
    expect(hls.destroyed).toBe(1);
    expect(first.mode).toBe("poster");
    hls.failSource = false;
    expect(await first.attach()).toBe(true);
  });

  it("uses native playback without importing an HLS decoder when MSE is absent", async () => {
    vi.stubGlobal("MediaSource", undefined);
    const native = await wall("probably");
    expect(await native.attach()).toBe(true);
    expect(native.mode).toBe("native");
    expect(hls.created).toBe(0);
  });

  it("leaves an unsupported wall at its poster without blocking later native playback", async () => {
    vi.stubGlobal("MediaSource", undefined);
    const first = await wall();
    expect(await first.attach()).toBe(false);
    const native = await wall("probably");
    expect(await native.attach()).toBe(true);
    expect(hls.created).toBe(0);
  });

  it("falls back to native playback when MSE exists but HLS does not support it", async () => {
    hls.supported = false;
    const native = await wall("probably");
    expect(await native.attach()).toBe(true);
    expect(native.mode).toBe("native");
    expect(hls.created).toBe(0);
  });

  it("does not attach a wall disposed while its HLS module was loading", async () => {
    const first = await wall();
    const pending = first.attach();
    first.dispose();
    expect(await pending).toBe(false);
    expect(hls.created).toBe(0);
    const next = await wall();
    expect(await next.attach()).toBe(true);
  });
});

describe("playback rate", () => {
  it("runs at the hanging's rate, and keeps it through a reload, which resets the element to its default", async () => {
    const video = new VideoStub();
    vi.stubGlobal("document", { createElement: () => video, body: { append() {} } });
    const slow = await VideoWall.create({ master: "/test/master.m3u8", widthMeters: 6, playbackRate: 0.25 });
    walls.push(slow);
    expect(slow.playbackRate).toBe(0.25);
    expect(video.defaultPlaybackRate).toBe(0.25);
    expect(video.playbackRate).toBe(0.25);
    expect(await slow.attach()).toBe(true);
    expect(video.playbackRate).toBe(0.25);
    slow.release();
    // As recorded when the document says nothing.
    const plain = await wall();
    expect(plain.playbackRate).toBe(1);
  });
});
