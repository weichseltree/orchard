// The grove's service worker, built to dist/sw.js by build/service-worker.ts
// and registered at scope "/" by src/sw/register.ts. Only in a build: `vite
// dev` never registers it.
//
//   media host, /<16 hex>/...   cache-first, one cache per bundle, forever;
//                               verified against the bundle's own sha256
//                               before it is kept, a mismatch is a network
//                               error; Range requests pass through
//   /assets/*, /basis/*         cache-first, keyed by the build's revision
//   navigations                 network-first, 3 s, then the cached page
//   everything else             not touched (auth, version.json, the socket)
//
// The decisions are in policy.ts and digest.ts, with tests; this file is
// wiring. Media is capped per device tier (the page posts it) and at half the
// origin's quota, evicting whole bundles, least recently used first.

import {
  classify,
  mediaCap,
  mediaLimit,
  othersFrom,
  planEviction,
  staleStaticKeys,
  staticKey,
  totalBytes,
  CACHE_PREFIX,
  DEFAULT_TIER,
  MEDIA_CACHE_PREFIX,
  META_CACHE,
  NAVIGATION_TIMEOUT_MS,
  PAGES_CACHE,
  STATIC_CACHE,
  type Manifest,
  type Route,
} from "./policy";
import {
  canHash,
  digestsFromBundle,
  digestsFromMedia,
  isDigestDocument,
  lookupDigest,
  matchesDigest,
  mediaFileOf,
  type DigestMap,
} from "./digest";

declare const __GROVE_BUILD__: string;
declare const __GROVE_MEDIA_BASE__: string;
declare const __GROVE_MANIFEST__: Manifest;

// The DOM lib is what the rest of src/ compiles against, and it has no
// service-worker types; these are the few this file uses.
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  readonly preloadResponse: Promise<Response | undefined>;
  respondWith(response: Response | Promise<Response>): void;
}
interface ExtendableMessageEvent extends ExtendableEvent {
  readonly data: unknown;
}
interface WorkerScope {
  readonly location: Location;
  readonly registration: { navigationPreload?: { enable(): Promise<void> } };
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
  addEventListener(type: "message", listener: (event: ExtendableMessageEvent) => void): void;
}

const worker = self as unknown as WorkerScope;
const BUILD = __GROVE_BUILD__;
const MANIFEST = __GROVE_MANIFEST__;
const SCOPE = { origin: worker.location.origin, mediaBase: __GROVE_MEDIA_BASE__ };
const STATE_KEY = `${SCOPE.origin}/__grove/state.json`;
const TAG = "[grove sw]";
/**
 * Which worker build stored a page. A page is only as good as the build files
 * it names, and those are collected two builds on; its page goes with them.
 */
const PAGE_BUILD_HEADER = "x-grove-build";

// ------------------------------------------------------------------ state

interface State {
  tier: string;
  bundles: Record<string, { bytes: number; lastUsed: number }>;
  manifest?: { build: string; entries: Manifest };
  previousManifest?: { build: string; entries: Manifest };
}

let statePromise: Promise<State> | null = null;

function state(): Promise<State> {
  statePromise ??= loadState();
  return statePromise;
}

async function loadState(): Promise<State> {
  try {
    const saved = await (await caches.open(META_CACHE)).match(STATE_KEY);
    if (saved) {
      const doc = (await saved.json()) as Partial<State>;
      return { tier: doc.tier ?? DEFAULT_TIER, bundles: doc.bundles ?? {}, ...pickManifests(doc) };
    }
  } catch (error) {
    console.warn(TAG, "state unreadable, rebuilding it", error);
  }
  return { tier: DEFAULT_TIER, bundles: await measureMediaCaches() };
}

function pickManifests(doc: Partial<State>): Pick<State, "manifest" | "previousManifest"> {
  return {
    ...(doc.manifest ? { manifest: doc.manifest } : {}),
    ...(doc.previousManifest ? { previousManifest: doc.previousManifest } : {}),
  };
}

/** Sizes of the media caches from their Content-Length headers, when the state was lost. */
async function measureMediaCaches(): Promise<State["bundles"]> {
  const bundles: State["bundles"] = {};
  for (const name of await caches.keys()) {
    if (!name.startsWith(MEDIA_CACHE_PREFIX)) continue;
    const cache = await caches.open(name);
    let bytes = 0;
    for (const request of await cache.keys()) {
      const hit = await cache.match(request);
      bytes += Number(hit?.headers.get("content-length") ?? 0) || 0;
    }
    bundles[name.slice(MEDIA_CACHE_PREFIX.length)] = { bytes, lastUsed: 0 };
  }
  return bundles;
}

let saving: Promise<void> | null = null;

/** Writes the state within a second, coalescing everything that changed meanwhile. */
function persist(): Promise<void> {
  saving ??= new Promise((resolve) => setTimeout(resolve, 1000)).then(async () => {
    saving = null;
    const body = JSON.stringify(await state());
    await (await caches.open(META_CACHE)).put(
      STATE_KEY,
      new Response(body, { headers: { "content-type": "application/json" } }),
    );
  });
  return saving;
}

// -------------------------------------------------------------- lifecycle

worker.addEventListener("install", (event) => {
  // Nothing is precached: a phone must not download the desktop's lightmaps
  // to install a worker. Take over at once so a fixed worker fixes open tabs.
  event.waitUntil(worker.skipWaiting());
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await worker.clients.claim();
      await worker.registration.navigationPreload?.enable().catch(() => undefined);
      await collectStatic();
    })(),
  );
});

/** Drops build files neither this build nor the one before it ships. */
async function collectStatic(): Promise<void> {
  const st = await state();
  if (st.manifest?.build !== BUILD) {
    if (st.manifest) st.previousManifest = st.manifest;
    st.manifest = { build: BUILD, entries: MANIFEST };
  }
  const cache = await caches.open(STATIC_CACHE);
  const keys = (await cache.keys()).map((r) => r.url);
  const stale = staleStaticKeys(keys, [st.manifest.entries, st.previousManifest?.entries]);
  await Promise.all(stale.map((key) => cache.delete(key)));
  const builds = new Set([st.manifest.build, st.previousManifest?.build]);
  const pages = await caches.open(PAGES_CACHE);
  for (const request of await pages.keys()) {
    const stored = await pages.match(request);
    if (!builds.has(stored?.headers.get(PAGE_BUILD_HEADER) ?? "")) await pages.delete(request);
  }
  // A cache this version does not know is a former layout; media caches stay.
  const known = new Set([STATIC_CACHE, PAGES_CACHE, META_CACHE]);
  for (const name of await caches.keys()) {
    if (name.startsWith(CACHE_PREFIX) && !name.startsWith(MEDIA_CACHE_PREFIX) && !known.has(name)) {
      await caches.delete(name);
    }
  }
  await persist();
}

worker.addEventListener("message", (event) => {
  const data = event.data as { type?: unknown; tier?: unknown; bundle?: unknown } | null;
  if (data?.type === "grove-forget" && typeof data.bundle === "string") {
    event.waitUntil(dropBundle(data.bundle).then(persist));
    return;
  }
  if (data?.type !== "grove-tier" || typeof data.tier !== "string") return;
  const tier = data.tier;
  event.waitUntil(
    (async () => {
      const st = await state();
      if (st.tier === tier) return;
      st.tier = tier;
      await enforceBudget();
      await persist();
    })(),
  );
});

// ------------------------------------------------------------------ fetch

worker.addEventListener("fetch", (event) => {
  const request = event.request;
  const route: Route = classify(
    { url: request.url, method: request.method, mode: request.mode, range: request.headers.has("range") },
    SCOPE,
  );
  switch (route.kind) {
    case "media":
      event.respondWith(media(event, route));
      return;
    case "static":
      event.respondWith(staticFile(event, route.path));
      return;
    case "page":
      event.respondWith(page(event, route.key));
      return;
    case "network":
      // A navigation still has its preload in flight; use it rather than
      // fetching the page twice. Everything else is left to the browser.
      if (request.mode === "navigate") {
        event.respondWith(event.preloadResponse.then((r) => r ?? fetch(request)));
      }
      return;
  }
});

// ------------------------------------------------------------------ pages

function page(event: FetchEvent, key: string): Promise<Response> {
  const network = (async () => (await event.preloadResponse) ?? (await fetch(event.request)))();
  // Registered before anything reads the body, so this clone is taken first;
  // the page is stored even when the cached copy answered.
  event.waitUntil(network.then((response) => keepPage(key, response.clone())).catch(() => undefined));
  return Promise.race([
    network,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("slow")), NAVIGATION_TIMEOUT_MS)),
  ]).catch(async () => {
    const cached = await (await caches.open(PAGES_CACHE)).match(key);
    // Nothing cached: keep waiting for the network, and fail as it fails.
    return cached ?? network;
  });
}

/** Stores a page, stamped with this worker's build (see collectStatic). */
async function keepPage(key: string, response: Response): Promise<void> {
  const html = (response.headers.get("content-type") ?? "").includes("text/html");
  if (response.status !== 200 || response.type !== "basic" || !html) return;
  const headers = new Headers(response.headers);
  headers.set(PAGE_BUILD_HEADER, BUILD);
  const body = await response.arrayBuffer();
  await (await caches.open(PAGES_CACHE)).put(key, new Response(body, { status: 200, headers }));
}

// ------------------------------------------------------------ build files

async function staticFile(event: FetchEvent, path: string): Promise<Response> {
  const cache = await caches.open(STATIC_CACHE);
  const rev = MANIFEST[path];
  // A path this build does not ship belongs to an older tab's build: whatever
  // revision is still here is the right one for it.
  const hit = rev
    ? await cache.match(staticKey(SCOPE.origin, path, rev))
    : await cache.match(`${SCOPE.origin}${path}`, { ignoreSearch: true });
  if (hit) return hit;
  const response = await fetch(event.request);
  if (rev && response.status === 200 && response.type === "basic") {
    event.waitUntil(cache.put(staticKey(SCOPE.origin, path, rev), response.clone()));
  }
  return response;
}

// ------------------------------------------------------------------ media

type MediaRoute = Extract<Route, { kind: "media" }>;

/** One network fetch per file however many requests ask for it at once. */
type Fetched =
  | { kind: "ok"; body: ArrayBuffer; init: ResponseInit; stored: Promise<void> }
  /** Not a 200 the worker can read (a 404, an opaque answer): handed on uncached. */
  | { kind: "pass"; response: Response }
  | { kind: "bad" };

/** Until a file is stored, later requests for it share the first one's fetch. */
const inflight = new Map<string, Promise<Fetched>>();

async function media(event: FetchEvent, route: MediaRoute): Promise<Response> {
  const cache = await caches.open(MEDIA_CACHE_PREFIX + route.bundle);
  const hit = await cache.match(route.key);
  if (hit) {
    touch(route.bundle);
    event.waitUntil(persist());
    return hit;
  }
  let pending = inflight.get(route.key);
  if (!pending) {
    const started = fetchMedia(event, route, cache);
    pending = started;
    inflight.set(route.key, started);
    void started
      .then((f) => (f.kind === "ok" ? f.stored : undefined))
      .catch(() => undefined)
      .finally(() => inflight.delete(route.key));
  }
  const fetched = await pending;
  if (fetched.kind === "bad") return Response.error();
  if (fetched.kind === "pass") return fetched.response.clone();
  // A Response copies the bytes it is given, so every waiter gets its own.
  return new Response(fetched.body, fetched.init);
}

async function fetchMedia(event: FetchEvent, route: MediaRoute, cache: Cache): Promise<Fetched> {
  const response = await corsFetch(event.request, route.key);
  if (response.status !== 200 || response.type === "opaque" || response.type === "opaqueredirect") {
    return { kind: "pass", response };
  }
  const body = await response.arrayBuffer();
  const init = initOf(response);

  if (route.rel === "bundle.json") {
    // The id is the hash of this file's canonical form, which is Python's
    // JSON and cannot be reproduced here byte for byte; what can be checked
    // is that the file claims the address it was fetched from.
    const doc = parseJson(body);
    if (!doc || (doc as { id?: unknown }).id !== route.bundle) {
      console.warn(TAG, `${route.key}: not the bundle.json of ${route.bundle}; not kept`);
      return { kind: "pass", response: new Response(body, init) };
    }
    bundles.set(route.bundle, Promise.resolve({ doc, map: digestsFromBundle(doc) }));
  } else if (!(await verified(route, body))) {
    console.error(TAG, `${route.key}: sha256 does not match the bundle's; refused, not cached`);
    return { kind: "bad" };
  }
  const stored = store(cache, route, new Response(body, init), body.byteLength);
  event.waitUntil(stored);
  return { kind: "ok", body, init, stored };
}

function initOf(response: Response): ResponseInit {
  return { status: response.status, statusText: response.statusText, headers: response.headers };
}

/**
 * The file as a CORS response, so its bytes can be read and hashed. An
 * `<img>` or a poster without `crossorigin` asks in no-cors mode; the
 * worker asks again in cors mode and hands that back, which satisfies it.
 */
async function corsFetch(request: Request, key: string): Promise<Response> {
  if (request.mode === "cors") return fetch(request);
  try {
    return await fetch(key, { mode: "cors", credentials: "omit" });
  } catch {
    return fetch(request);
  }
}

function parseJson(body: ArrayBuffer): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------- verification

interface BundleDigests {
  doc: unknown;
  map: DigestMap;
}

const bundles = new Map<string, Promise<BundleDigests>>();
const sidecars = new Map<string, Promise<DigestMap>>();
/** Bundles whose media.json was re-read after a mismatch, once per worker lifetime. */
const refreshed = new Set<string>();

/** False only for a known digest that the bytes do not match. */
async function verified(route: MediaRoute, body: ArrayBuffer): Promise<boolean> {
  if (!canHash()) return true;
  const { doc, map } = await bundleDigests(route.bundle);
  if (isDigestDocument(route.rel, doc)) return true;
  const sidecar = mediaFileOf(doc);
  let entry = lookupDigest(route.rel, map);
  if (!entry && sidecar) entry = lookupDigest(route.rel, map, await sidecarDigests(route.bundle, sidecar));
  if (!entry) return true; // no digest known: the address is still content-addressed
  if (await matchesDigest(entry, body)) return true;
  if (entry.source !== "media" || !sidecar || refreshed.has(route.bundle)) return false;
  // media.json is not covered by the id: a re-pushed bundle changes it and
  // its segments together. Read it again once; if it moved, what this worker
  // kept of the bundle is of the old encoding and goes.
  refreshed.add(route.bundle);
  const fresh = await sidecarDigests(route.bundle, sidecar, true);
  const again = lookupDigest(route.rel, map, fresh);
  return again !== null && again.sha256 !== entry.sha256 && (await matchesDigest(again, body));
}

function bundleKey(bundle: string, rel: string): string {
  return `${SCOPE.mediaBase}/${bundle}/${rel}`;
}

/** The bundle's bundle.json: from memory, else its cache, else the network (and then cached). */
function bundleDigests(bundle: string): Promise<BundleDigests> {
  let pending = bundles.get(bundle);
  if (!pending) {
    pending = (async () => {
      const key = bundleKey(bundle, "bundle.json");
      const cache = await caches.open(MEDIA_CACHE_PREFIX + bundle);
      let response = await cache.match(key);
      if (!response) {
        const fresh = await fetch(key, { mode: "cors", credentials: "omit" }).catch(() => null);
        if (!fresh?.ok) return { doc: null, map: new Map() };
        const body = await fresh.arrayBuffer();
        const doc = parseJson(body);
        if ((doc as { id?: unknown } | null)?.id === bundle) {
          const route: MediaRoute = { kind: "media", bundle, rel: "bundle.json", key };
          await store(cache, route, new Response(body, initOf(fresh)), body.byteLength);
        }
        return { doc, map: digestsFromBundle(doc) };
      }
      const doc = parseJson(await response.arrayBuffer());
      return { doc, map: digestsFromBundle(doc) };
    })();
    // A failed read is not remembered: the next file tries again.
    pending.then((d) => d.doc === null && bundles.delete(bundle), () => bundles.delete(bundle));
    bundles.set(bundle, pending);
  }
  return pending;
}

/** The bundle's media.json digests; `refresh` goes past the cache to the network. */
function sidecarDigests(bundle: string, file: string, refresh = false): Promise<DigestMap> {
  const memo = `${bundle}/${file}`;
  let pending = refresh ? undefined : sidecars.get(memo);
  if (!pending) {
    pending = (async () => {
      const key = bundleKey(bundle, file);
      const cacheName = MEDIA_CACHE_PREFIX + bundle;
      let cache = await caches.open(cacheName);
      const cached = refresh ? undefined : await cache.match(key);
      if (cached) return digestsFromMedia(parseJson(await cached.arrayBuffer()));
      const fresh = await fetch(key, { mode: "cors", credentials: "omit", cache: "no-cache" }).catch(() => null);
      if (!fresh?.ok) return new Map();
      const body = await fresh.arrayBuffer();
      const map = digestsFromMedia(parseJson(body));
      if (refresh) {
        const old = await cache.match(key);
        const oldMap = old ? digestsFromMedia(parseJson(await old.arrayBuffer())) : null;
        if (oldMap && !sameDigests(oldMap, map)) {
          console.warn(TAG, `bundle ${bundle} was re-pushed with new bytes; dropping what was kept of it`);
          await dropBundle(bundle);
          cache = await caches.open(cacheName);
        }
      }
      if (map.size > 0) {
        const route: MediaRoute = { kind: "media", bundle, rel: file, key };
        await store(cache, route, new Response(body, initOf(fresh)), body.byteLength);
      }
      return map;
    })();
    pending.then((m) => m.size === 0 && sidecars.delete(memo), () => sidecars.delete(memo));
    sidecars.set(memo, pending);
  }
  return pending;
}

function sameDigests(a: DigestMap, b: DigestMap): boolean {
  if (a.size !== b.size) return false;
  for (const [rel, entry] of a) if (b.get(rel)?.sha256 !== entry.sha256) return false;
  return true;
}

// ----------------------------------------------------------------- budget

/** What the origin stores besides media, and its quota, as of the last storage estimate. */
let others: number | null = null;
let quota: number | undefined;
let estimatedAt = 0;
const ESTIMATE_EVERY_MS = 10_000;

function touch(bundle: string): void {
  void state().then((st) => {
    const entry = (st.bundles[bundle] ??= { bytes: 0, lastUsed: 0 });
    entry.lastUsed = Date.now();
  });
}

async function store(cache: Cache, route: MediaRoute, response: Response, bytes: number): Promise<void> {
  const st = await state();
  // A file bigger than everything this device may keep is served, not kept.
  if (bytes > mediaCap(st.tier)) return;
  // Two requests racing for one file can both land here; count it once.
  const existed = (await cache.match(route.key)) !== undefined;
  try {
    await cache.put(route.key, response);
  } catch (error) {
    console.warn(TAG, `${route.key}: not cached`, error);
    return;
  }
  const entry = (st.bundles[route.bundle] ??= { bytes: 0, lastUsed: 0 });
  if (!existed) entry.bytes += bytes;
  entry.lastUsed = Date.now();
  await enforceBudget(route.bundle);
  await persist();
}

async function enforceBudget(keep?: string): Promise<void> {
  const st = await state();
  const list = Object.entries(st.bundles).map(([id, b]) => ({ id, ...b }));
  const now = Date.now();
  if ((others === null || now - estimatedAt > ESTIMATE_EVERY_MS) && navigator.storage?.estimate) {
    estimatedAt = now;
    const estimate = await navigator.storage.estimate().catch(() => null);
    quota = estimate?.quota;
    others = othersFrom(estimate?.usage, totalBytes(list));
  }
  const limit = mediaLimit(mediaCap(st.tier), quota, others ?? 0);
  for (const id of planEviction(list, limit, keep)) {
    const mb = ((st.bundles[id]?.bytes ?? 0) / 1e6).toFixed(1);
    console.info(TAG, `evicting bundle ${id} (${mb} MB) to stay under ${(limit / 1e6).toFixed(0)} MB`);
    await dropBundle(id);
  }
}

async function dropBundle(id: string): Promise<void> {
  await caches.delete(MEDIA_CACHE_PREFIX + id);
  const st = await state();
  delete st.bundles[id];
  bundles.delete(id);
  for (const key of sidecars.keys()) if (key.startsWith(`${id}/`)) sidecars.delete(key);
}
