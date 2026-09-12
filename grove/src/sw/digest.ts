// Which sha256 a bundle claims for each of its files. Pure: the service worker
// (src/sw/sw.ts) and the tape stream (src/tape/stream.ts) both read it.
//
// A bundle states its digests in one of three places, and a file is looked up
// in each in turn (`lookupDigest`):
//
//   1. `bundle.json` `files: {"<relpath>": {"sha256": "...", "bytes": n}}`,
//      the per-file map every kind of bundle is gaining;
//   2. a tape's `bundle.json`: `variants.*.chunks[].sha256` and
//      `poster_sha256`, which the bundle id covers;
//   3. `media.json`, which older video and still bundles carry and
//      `bundle.json` points at with `"media": "media.json"`. The id does NOT
//      cover it (an encoder that is not bit-stable cannot be in the id; see
//      orchard/bundle.py), so a mismatch against it may mean the bundle was
//      re-pushed rather than that the bytes are bad.

export type DigestSource = "bundle" | "media";

export interface DigestEntry {
  sha256: string;
  /** Size in bytes, when the bundle says; a cheap check before hashing. */
  bytes?: number;
  source: DigestSource;
}

/** Relative path inside the bundle (`720p/s0003.ts`) to what it should hash to. */
export type DigestMap = Map<string, DigestEntry>;

const HEX64 = /^[0-9a-f]{64}$/;

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && HEX64.test(value.toLowerCase());
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function put(map: DigestMap, file: unknown, sha256: unknown, bytes: unknown, source: DigestSource): void {
  if (typeof file !== "string" || !file || !isSha256(sha256)) return;
  const entry: DigestEntry = { sha256: sha256.toLowerCase(), source };
  if (typeof bytes === "number" && Number.isInteger(bytes) && bytes >= 0) entry.bytes = bytes;
  map.set(normalizeRel(file), entry);
}

/**
 * The new per-file map, `bundle.json` `files`. Kept in one small function
 * because its shape was settled in another worktree: if it lands as a list of
 * `{file, sha256, bytes}` instead, this is the only place to change.
 */
export function filesField(doc: Record<string, unknown>, into: DigestMap, source: DigestSource): void {
  const files = doc["files"];
  if (Array.isArray(files)) {
    for (const f of files) {
      const r = record(f);
      if (r) put(into, r["file"], r["sha256"], r["bytes"], source);
    }
    return;
  }
  const map = record(files);
  if (!map) return;
  for (const [file, value] of Object.entries(map)) {
    const r = record(value);
    if (r) put(into, file, r["sha256"], r["bytes"], source);
  }
}

/** Every digest `bundle.json` states for the files beside it. */
export function digestsFromBundle(doc: unknown): DigestMap {
  const map: DigestMap = new Map();
  const d = record(doc);
  if (!d) return map;
  // A tape's chunks and poster: covered by the id.
  const variants = record(d["variants"]);
  if (variants) {
    for (const variant of Object.values(variants)) {
      const chunks = record(variant)?.["chunks"];
      if (!Array.isArray(chunks)) continue;
      for (const chunk of chunks) {
        const c = record(chunk);
        if (c) put(map, c["file"], c["sha256"], c["bytes"], "bundle");
      }
    }
  }
  put(map, d["poster"], d["poster_sha256"], undefined, "bundle");
  // The per-file map wins where both name a file: it is the newer writer.
  filesField(d, map, "bundle");
  return map;
}

/** `media.json` (`orchard/media/1`, `orchard/bundle-media/1`): `files: [{file, bytes, sha256}]`. */
export function digestsFromMedia(doc: unknown): DigestMap {
  const map: DigestMap = new Map();
  const d = record(doc);
  if (d) filesField(d, map, "media");
  return map;
}

/** The sidecar `bundle.json` points at for its digests (`"media": "media.json"`), or null. */
export function mediaFileOf(doc: unknown): string | null {
  const media = record(doc)?.["media"];
  return typeof media === "string" && media && !media.includes("..") ? normalizeRel(media) : null;
}

/** The files a bundle never has a digest for: the documents that name the digests. */
export function isDigestDocument(rel: string, doc?: unknown): boolean {
  return rel === "bundle.json" || rel === (mediaFileOf(doc) ?? "media.json");
}

/** The digest for `rel`: the bundle's own claim first, then the media sidecar's. */
export function lookupDigest(
  rel: string,
  fromBundle: DigestMap,
  fromMedia?: DigestMap | null,
): DigestEntry | null {
  const key = normalizeRel(rel);
  return fromBundle.get(key) ?? fromMedia?.get(key) ?? null;
}

export function normalizeRel(rel: string): string {
  return rel.replace(/^\.?\/+/, "");
}

/** Lower-case hex sha256 of the bytes. Needs a secure context (crypto.subtle). */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** True when this context can hash (crypto.subtle is absent outside https and localhost). */
export function canHash(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle?.digest === "function";
}

/** Whether `data` is what `entry` promises. Size first: it is free. */
export async function matchesDigest(entry: DigestEntry, data: ArrayBuffer): Promise<boolean> {
  if (entry.bytes !== undefined && entry.bytes !== data.byteLength) return false;
  return (await sha256Hex(data)) === entry.sha256;
}
