import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  digestsFromBundle,
  digestsFromMedia,
  isDigestDocument,
  lookupDigest,
  matchesDigest,
  mediaFileOf,
  sha256Hex,
} from "./digest";

const hex = (s: string) => createHash("sha256").update(s).digest("hex");
const A = hex("a");
const B = hex("b");
const C = hex("c");

// The shapes orchard/bundle.py writes (tape: digests in bundle.json; video and
// still: in media.json), and the per-file `files` map being added.
const tape = {
  schema: "orchard/bundle/1",
  kind: "tape",
  id: "0123456789abcdef",
  poster: "poster.png",
  poster_sha256: C,
  variants: {
    "vr-quest": { chunks: [{ file: "vr-quest/c0000.bin", frame0: 0, frames: 60, sha256: A, bytes: 1 }] },
    phone: { chunks: [{ file: "phone/c0000.bin", frame0: 0, frames: 60, sha256: B }] },
    preview: { chunks: [{ file: "preview/c0000.bin", frame0: 0, frames: 60, sha256: "" }] },
  },
};

const video = { schema: "orchard/bundle/1", kind: "video", id: "fedcba9876543210", media: "media.json", poster: "poster.jpg" };
const videoMedia = {
  schema: "orchard/bundle-media/1",
  files: [
    { file: "720p/index.m3u8", bytes: 1, sha256: A },
    { file: "720p/s0000.ts", bytes: 1, sha256: B.toUpperCase() },
    { file: "poster.jpg", bytes: 1, sha256: C },
  ],
};

describe("digest maps", () => {
  it("reads a tape's chunk and poster digests from bundle.json, skipping empty ones", () => {
    const map = digestsFromBundle(tape);
    expect(map.get("vr-quest/c0000.bin")).toEqual({ sha256: A, bytes: 1, source: "bundle" });
    expect(map.get("phone/c0000.bin")).toEqual({ sha256: B, source: "bundle" });
    expect(map.get("poster.png")?.sha256).toBe(C);
    expect(map.has("preview/c0000.bin")).toBe(false);
  });

  it("reads media.json, lower-casing, and knows it is not covered by the id", () => {
    const map = digestsFromMedia(videoMedia);
    expect(map.get("720p/s0000.ts")).toEqual({ sha256: B, bytes: 1, source: "media" });
    expect(mediaFileOf(video)).toBe("media.json");
    expect(mediaFileOf(tape)).toBeNull();
    expect(mediaFileOf({ media: "../x.json" })).toBeNull();
  });

  it("reads the per-file map in bundle.json, as a record or as a list", () => {
    const record = digestsFromBundle({ ...video, files: { "720p/s0000.ts": { sha256: A, bytes: 9 } } });
    expect(record.get("720p/s0000.ts")).toEqual({ sha256: A, bytes: 9, source: "bundle" });
    const list = digestsFromBundle({ ...video, files: [{ file: "full.jpg", sha256: B }] });
    expect(list.get("full.jpg")?.sha256).toBe(B);
  });

  it("looks in bundle.json first, then the sidecar", () => {
    const own = digestsFromBundle({ ...video, files: { "poster.jpg": { sha256: A } } });
    const side = digestsFromMedia(videoMedia);
    expect(lookupDigest("poster.jpg", own, side)?.sha256).toBe(A);
    expect(lookupDigest("720p/s0000.ts", own, side)?.source).toBe("media");
    expect(lookupDigest("./720p/s0000.ts", own, side)?.sha256).toBe(B);
    expect(lookupDigest("1080p/s0000.ts", own, side)).toBeNull();
    expect(lookupDigest("x", own)).toBeNull();
  });

  it("ignores what is not a bundle", () => {
    expect(digestsFromBundle(null).size).toBe(0);
    expect(digestsFromBundle("x").size).toBe(0);
    expect(digestsFromBundle({ variants: { v: { chunks: [{ file: "c.bin", sha256: "nothex" }] } } }).size).toBe(0);
    expect(digestsFromMedia({ files: "nope" }).size).toBe(0);
  });

  it("never expects a digest for the documents that carry them", () => {
    expect(isDigestDocument("bundle.json")).toBe(true);
    expect(isDigestDocument("media.json", video)).toBe(true);
    expect(isDigestDocument("digests.json", { media: "digests.json" })).toBe(true);
    expect(isDigestDocument("poster.jpg", video)).toBe(false);
  });
});

describe("hashing", () => {
  it("hashes like everyone else and checks the size first", async () => {
    const bytes = new TextEncoder().encode("a");
    expect(await sha256Hex(bytes)).toBe(A);
    const buffer = bytes.buffer.slice(0) as ArrayBuffer;
    expect(await matchesDigest({ sha256: A, source: "bundle" }, buffer)).toBe(true);
    expect(await matchesDigest({ sha256: A, bytes: 2, source: "bundle" }, buffer)).toBe(false);
    expect(await matchesDigest({ sha256: B, source: "media" }, buffer)).toBe(false);
  });
});
