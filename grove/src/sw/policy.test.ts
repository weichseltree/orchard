import { describe, expect, it } from "vitest";
import {
  classify,
  mediaCap,
  mediaLimit,
  othersFrom,
  planEviction,
  staleStaticKeys,
  staticKey,
  type RequestFacts,
} from "./policy";

const SCOPE = { origin: "https://weichseltree.com", mediaBase: "https://media.weichseltree.com" };
const ID = "0123456789abcdef";

function req(url: string, extra: Partial<RequestFacts> = {}): RequestFacts {
  return { url, method: "GET", mode: "cors", range: false, ...extra };
}

describe("classify", () => {
  it("takes a bundle file on the media host, keyed without its query", () => {
    expect(classify(req(`https://media.weichseltree.com/${ID}/720p/s0003.ts?x=1`), SCOPE)).toEqual({
      kind: "media",
      bundle: ID,
      rel: "720p/s0003.ts",
      key: `https://media.weichseltree.com/${ID}/720p/s0003.ts`,
    });
    expect(classify(req(`https://media.weichseltree.com/${ID}/bundle.json`), SCOPE)).toMatchObject({
      kind: "media",
      rel: "bundle.json",
    });
  });

  it("leaves a media request alone when it is not a bundle path, a GET, or whole", () => {
    const network = { kind: "network" };
    expect(classify(req("https://media.weichseltree.com/not-an-id/x.bin"), SCOPE)).toEqual(network);
    expect(classify(req(`https://media.weichseltree.com/${ID.toUpperCase()}/x.bin`), SCOPE)).toEqual(network);
    expect(classify(req(`https://media.weichseltree.com/${ID}/`), SCOPE)).toEqual(network);
    expect(classify(req(`https://media.weichseltree.com/${ID}/a//b`), SCOPE)).toEqual(network);
    expect(classify(req(`https://media.weichseltree.com/${ID}/%2e%2e/x`), SCOPE)).toEqual(network);
    expect(classify(req(`https://media.weichseltree.com/${ID}/x.bin`, { method: "HEAD" }), SCOPE)).toEqual(network);
    // <video> asks for ranges: straight through.
    expect(classify(req(`https://media.weichseltree.com/${ID}/clip.mp4`, { range: true }), SCOPE)).toEqual(network);
  });

  it("caches the build's own files first", () => {
    expect(classify(req("https://weichseltree.com/assets/main-a1b2c3.js"), SCOPE)).toEqual({
      kind: "static",
      path: "/assets/main-a1b2c3.js",
    });
    expect(classify(req("https://weichseltree.com/basis/1.2/basis_transcoder.wasm"), SCOPE)).toMatchObject({
      kind: "static",
    });
  });

  it("answers navigations network-first, one key per path whatever the query", () => {
    expect(classify(req("https://weichseltree.com/grove/?room=hall&yaw=90", { mode: "navigate" }), SCOPE)).toEqual({
      kind: "page",
      key: "https://weichseltree.com/grove/",
    });
    expect(classify(req("https://weichseltree.com/", { mode: "navigate" }), SCOPE)).toMatchObject({ kind: "page" });
  });

  it("never touches auth, the version stamp, the worker, ?nosw, other hosts or writes", () => {
    const network = { kind: "network" };
    for (const url of [
      "https://weichseltree.com/auth",
      "https://weichseltree.com/auth/token",
      "https://weichseltree.com/version.json",
      "https://weichseltree.com/sw.js",
      "https://weichseltree.com/src/main.ts",
      "https://maincloud.spacetimedb.com/v1/database/orchard",
      "https://challenges.cloudflare.com/turnstile/v0/api.js",
      "https://evil.example/assets/x.js",
    ]) {
      expect(classify(req(url), SCOPE), url).toEqual(network);
    }
    expect(classify(req("https://weichseltree.com/grove/?nosw", { mode: "navigate" }), SCOPE)).toEqual(network);
    expect(classify(req("https://weichseltree.com/auth/", { mode: "navigate" }), SCOPE)).toEqual(network);
    expect(classify(req("https://weichseltree.com/assets/x.js", { method: "POST" }), SCOPE)).toEqual(network);
  });

  it("matches a media base with a path prefix, and none at all", () => {
    const scope = { ...SCOPE, mediaBase: "https://cdn.example/bundles/" };
    expect(classify(req(`https://cdn.example/bundles/${ID}/a.bin`), scope)).toMatchObject({ kind: "media", rel: "a.bin" });
    expect(classify(req(`https://cdn.example/${ID}/a.bin`), scope)).toEqual({ kind: "network" });
    expect(classify(req(`https://media.weichseltree.com/${ID}/a.bin`), { ...SCOPE, mediaBase: "" })).toEqual({
      kind: "network",
    });
  });

  it("a live-stream exhibit always passes through, never as media or a page", () => {
    const exhibitUrl = "https://media.weichseltree.com/audio/live/logswarm/repo-abc123/live.m3u8";
    expect(classify(req(exhibitUrl), SCOPE)).toEqual({ kind: "exhibit", url: exhibitUrl });
    // Segments and parts under the same stream are exhibit too, not media.
    expect(classify(req(`${exhibitUrl.replace("live.m3u8", "seg-42.m4s")}`), SCOPE)).toMatchObject({ kind: "exhibit" });
    // Same pattern from the app's own origin is exhibit as well.
    const sameOrigin = "https://weichseltree.com/audio/live/logswarm/repo-abc123/live.m3u8";
    expect(classify(req(sameOrigin), SCOPE)).toEqual({ kind: "exhibit", url: sameOrigin });
    // A Range request (still no bytes to slice against a digest) is exhibit too, not silently network-only by luck.
    expect(classify(req(exhibitUrl, { range: true }), SCOPE)).toMatchObject({ kind: "exhibit" });
    // An archived recording of the same provider/stream is a bundle, not an exhibit.
    expect(classify(req(`https://media.weichseltree.com/${ID}/track.opus`), SCOPE)).toMatchObject({ kind: "media" });
  });
});


describe("static revisions", () => {
  it("keys a file by its revision and drops what neither of the last two builds ships", () => {
    const o = "https://weichseltree.com";
    const now = { "/assets/a.js": "111", "/assets/hall.glb": "222" };
    const before = { "/assets/old.js": "333", "/assets/hall.glb": "444" };
    const keys = [
      staticKey(o, "/assets/a.js", "111"),
      staticKey(o, "/assets/hall.glb", "222"),
      staticKey(o, "/assets/hall.glb", "444"),
      staticKey(o, "/assets/old.js", "333"),
      staticKey(o, "/assets/older.js", "555"),
      staticKey(o, "/assets/hall.glb", "000"),
    ];
    expect(staleStaticKeys(keys, [now, before])).toEqual([
      `${o}/assets/older.js?__rev=555`,
      `${o}/assets/hall.glb?__rev=000`,
    ]);
    expect(staleStaticKeys(keys, [now, undefined])).toHaveLength(4);
  });
});

describe("the media budget", () => {
  it("caps per tier and falls back to the smallest", () => {
    expect(mediaCap("vr-quest")).toBe(1e9);
    expect(mediaCap("phone")).toBe(300e6);
    expect(mediaCap("desktop")).toBe(2e9);
    expect(mediaCap(undefined)).toBe(300e6);
    expect(mediaCap("toaster")).toBe(300e6);
  });

  it("keeps the whole origin under half its quota", () => {
    // 10 GB quota: the cap is what binds.
    expect(mediaLimit(2e9, 10e9, 100e6)).toBe(2e9);
    // 1 GB quota, 100 MB of other things: media may have 400 MB.
    expect(mediaLimit(2e9, 1e9, 100e6)).toBe(400e6);
    // Others already past half: nothing.
    expect(mediaLimit(2e9, 1e9, 600e6)).toBe(0);
    // No estimate: the cap.
    expect(mediaLimit(300e6, undefined, 0)).toBe(300e6);
    expect(othersFrom(500e6, 450e6)).toBe(50e6);
    expect(othersFrom(undefined, 450e6)).toBe(0);
  });

  it("evicts whole bundles, least recently used first", () => {
    const bundles = [
      { id: "a", bytes: 100, lastUsed: 3 },
      { id: "b", bytes: 100, lastUsed: 1 },
      { id: "c", bytes: 100, lastUsed: 2 },
    ];
    expect(planEviction(bundles, 300)).toEqual([]);
    expect(planEviction(bundles, 250)).toEqual(["b"]);
    expect(planEviction(bundles, 150)).toEqual(["b", "c"]);
  });

  it("evicts the bundle being written last, and only when it alone is over", () => {
    const bundles = [
      { id: "new", bytes: 200, lastUsed: 0 },
      { id: "old", bytes: 100, lastUsed: 5 },
    ];
    expect(planEviction(bundles, 250, "new")).toEqual(["old"]);
    expect(planEviction(bundles, 150, "new")).toEqual(["old", "new"]);
  });
});
