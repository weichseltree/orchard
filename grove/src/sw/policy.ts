// The service worker's decisions, as pure functions: which requests it
// touches and how, how much media it may keep, and what it throws away.
// src/sw/sw.ts only wires these to events.

/** Every cache this site owns starts with this; the kill switch deletes them all. */
export const CACHE_PREFIX = "grove-";
/** Content-hashed build output: /assets/*, /basis/*. */
export const STATIC_CACHE = "grove-static";
/** The last HTML each page answered with: the offline hall. */
export const PAGES_CACHE = "grove-pages";
/** The worker's own state (tier, bundle sizes and last use, manifests). */
export const META_CACHE = "grove-meta";
/** One cache per bundle, so a bundle is evicted whole with one `caches.delete`. */
export const MEDIA_CACHE_PREFIX = "grove-media-";

/** How long a navigation waits for the network before the cached page answers. */
export const NAVIGATION_TIMEOUT_MS = 3000;

const MB = 1e6;
const GB = 1e9;

/**
 * Media kept on the device, per tier. A Quest has the flash but a browser
 * that is not its only tenant; a phone has neither to spare.
 */
export const MEDIA_CAP_BYTES: Readonly<Record<string, number>> = {
  "vr-high": 1 * GB,
  "vr-quest": 1 * GB,
  phone: 300 * MB,
  desktop: 2 * GB,
};

/** Until the page says what it runs on, assume the smallest. */
export const DEFAULT_TIER = "phone";

/** At most this share of the origin's quota, counting everything the origin stores. */
export const QUOTA_SHARE = 0.5;

export function mediaCap(tier: string | undefined): number {
  return MEDIA_CAP_BYTES[tier ?? DEFAULT_TIER] ?? MEDIA_CAP_BYTES[DEFAULT_TIER]!;
}

/** A bundle id: the first 16 hex of the sha256 of its bundle.json. */
const BUNDLE_PATH = /^([0-9a-f]{16})\/([^?#]+)$/;

export type Route =
  /** A file of a content-addressed bundle on the media host: cache-first, verified, forever. */
  | { kind: "media"; bundle: string; rel: string; key: string }
  /** Hashed build output: cache-first. */
  | { kind: "static"; path: string }
  /** A page: network-first, the cached copy when the network is slow or gone. */
  | { kind: "page"; key: string }
  /** Not the worker's business: the browser fetches it as if there were no worker. */
  | { kind: "network" };

export interface RequestFacts {
  url: string;
  method: string;
  mode: string;
  /** Whether the request carries a Range header (`<video>` does). */
  range: boolean;
}

export interface Scope {
  /** This site's origin, `https://weichseltree.com`. */
  origin: string;
  /** Where bundles live, no trailing slash: `https://media.weichseltree.com`. */
  mediaBase: string;
}

const NETWORK: Route = { kind: "network" };

export function classify(request: RequestFacts, scope: Scope): Route {
  if (request.method !== "GET") return NETWORK;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return NETWORK;
  }
  const mediaBase = scope.mediaBase.replace(/\/+$/, "");
  if (mediaBase && request.url.startsWith(`${mediaBase}/`)) {
    // Ranges are what a <video> asks for; a partial body cannot be hashed
    // against a whole-file digest, and caching slices is the browser's job.
    if (request.range) return NETWORK;
    const rest = `${url.origin}${url.pathname}`.slice(mediaBase.length + 1);
    const match = BUNDLE_PATH.exec(rest);
    if (!match) return NETWORK;
    let rel: string;
    try {
      rel = decodeURIComponent(match[2]!);
    } catch {
      return NETWORK;
    }
    if (rel.split("/").some((part) => part === ".." || part === "")) return NETWORK;
    return { kind: "media", bundle: match[1]!, rel, key: `${mediaBase}/${match[1]}/${match[2]}` };
  }
  if (url.origin !== scope.origin) return NETWORK;
  // `?nosw` is the per-visit kill switch: the page loads straight from the
  // network and then removes the worker (src/sw/register.ts).
  if (url.searchParams.has("nosw")) return NETWORK;
  const path = url.pathname;
  // The token service, the version stamp and the worker script itself are
  // only ever right when they come from the server.
  if (path === "/auth" || path.startsWith("/auth/")) return NETWORK;
  if (path === "/version.json" || path === "/sw.js") return NETWORK;
  if (request.mode === "navigate") return { kind: "page", key: `${url.origin}${path}` };
  if (request.range) return NETWORK;
  if (path.startsWith("/assets/") || path.startsWith("/basis/")) return { kind: "static", path };
  return NETWORK;
}

// ------------------------------------------------------------ static output

/** The build's own files, `/assets/...` to a short content hash (written by build/service-worker.ts). */
export type Manifest = Readonly<Record<string, string>>;

/**
 * The cache key of a build file. The revision rides in the key so a file
 * whose name is not hashed (a baked glb under a fixed path) is still never
 * served stale: a new build is a new key.
 */
export function staticKey(origin: string, path: string, rev: string | undefined): string {
  return rev ? `${origin}${path}?__rev=${rev}` : `${origin}${path}`;
}

/**
 * Keys of the static cache that neither of the last two builds knows. One
 * generation is kept so a tab still running the previous build can finish
 * loading its chunks; anything older is gone from the server as well.
 */
export function staleStaticKeys(keys: readonly string[], keep: readonly (Manifest | undefined)[]): string[] {
  const wanted = new Set<string>();
  for (const manifest of keep) {
    if (!manifest) continue;
    for (const [path, rev] of Object.entries(manifest)) wanted.add(`${path}?__rev=${rev}`);
  }
  return keys.filter((key) => {
    let url: URL;
    try {
      url = new URL(key);
    } catch {
      return true;
    }
    return !wanted.has(`${url.pathname}${url.search}`);
  });
}

// --------------------------------------------------------------- the budget

export interface BundleUse {
  id: string;
  bytes: number;
  /** ms since the epoch of the last hit or store. */
  lastUsed: number;
}

/**
 * How many media bytes may be kept: the tier's cap, and never so many that
 * the origin as a whole passes half its quota. `others` is what the origin
 * stores besides the media caches (pages, build files, localStorage).
 */
export function mediaLimit(cap: number, quota: number | undefined, others: number): number {
  if (!quota || !Number.isFinite(quota) || quota <= 0) return cap;
  return Math.max(0, Math.min(cap, quota * QUOTA_SHARE - Math.max(0, others)));
}

/** What the origin stores besides media, from a storage estimate taken when media was `mediaBytes`. */
export function othersFrom(usage: number | undefined, mediaBytes: number): number {
  return Math.max(0, (usage ?? 0) - mediaBytes);
}

/**
 * Bundles to delete, least recently used first, until the rest fit under
 * `limit`. `keep` (the bundle being written) goes last, and only if it alone
 * is over the limit.
 */
export function planEviction(bundles: readonly BundleUse[], limit: number, keep?: string): string[] {
  let total = bundles.reduce((sum, b) => sum + b.bytes, 0);
  if (total <= limit) return [];
  const order = [...bundles].sort((a, b) => {
    if ((a.id === keep) !== (b.id === keep)) return a.id === keep ? 1 : -1;
    return a.lastUsed - b.lastUsed || a.id.localeCompare(b.id);
  });
  const evict: string[] = [];
  for (const bundle of order) {
    if (total <= limit) break;
    evict.push(bundle.id);
    total -= bundle.bytes;
  }
  return evict;
}

export function totalBytes(bundles: Iterable<BundleUse>): number {
  let total = 0;
  for (const b of bundles) total += b.bytes;
  return total;
}
