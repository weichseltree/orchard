import { CACHE_PREFIX, MEDIA_CACHE_PREFIX } from "./policy";

// The page's side of the service worker (src/sw/sw.ts): register it, tell it
// the device tier, and remove it when told to. Never in `vite dev`.

/** Whether the page should run under the worker: not with `?nosw`, not when version.json says `"sw": false`. */
export function workerWanted(search: string, stamp: { sw?: boolean } | null): boolean {
  if (new URLSearchParams(search).has("nosw")) return false;
  return stamp?.sw !== false;
}

function container(): ServiceWorkerContainer | null {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : null;
}

/** True when a worker answers this page's requests and so verifies media itself. */
export function pageIsControlled(): boolean {
  return container()?.controller != null;
}

/** Registers /sw.js at scope "/" and keeps it told which tier this device is. */
export async function registerWorker(tier: string): Promise<void> {
  const sw = container();
  if (!sw) return;
  const tell = (worker: ServiceWorker | null | undefined) =>
    worker?.postMessage({ type: "grove-tier", tier });
  // A new worker takes over open tabs at once (skipWaiting); it starts out
  // not knowing the tier.
  sw.addEventListener("controllerchange", () => tell(sw.controller));
  try {
    await sw.register("/sw.js", { scope: "/" });
    tell((await sw.ready).active);
  } catch (error) {
    // No worker is a slower site, not a broken one.
    console.info(`[grove] service worker not registered: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Deletes what the worker kept of one bundle, for a hanging taken down: the
 * worker serves a kept bundle forever, even once R2 no longer has it. The
 * page and the worker share the origin's caches, so this works with or
 * without a worker running; the message keeps its size accounting right.
 */
export async function forgetBundle(id: string): Promise<void> {
  if (!/^[0-9a-f]{16}$/.test(id)) return;
  container()?.controller?.postMessage({ type: "grove-forget", bundle: id });
  if (typeof caches !== "undefined") await caches.delete(`${MEDIA_CACHE_PREFIX}${id}`);
}

/** The kill switch: unregister every worker of this origin and delete the caches it kept. */
export async function removeWorker(): Promise<boolean> {
  const sw = container();
  let removed = false;
  if (sw) {
    for (const registration of await sw.getRegistrations()) {
      removed = (await registration.unregister()) || removed;
    }
  }
  if (typeof caches !== "undefined") {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX)) removed = (await caches.delete(name)) || removed;
    }
  }
  return removed;
}
