import { registerWorker, removeWorker, workerWanted } from "../sw/register";

// Keeping an open grove current. The build writes /version.json (commit,
// build time, whether the service worker is on; build/version.ts) and bakes
// the same commit into the page. The page asks for version.json when it
// becomes visible and every ten minutes; a different commit puts one quiet
// offer on the notice list. Nothing reloads under a visitor in a headset: the
// offer waits for the immersive session to end.

export interface VersionStamp {
  commit: string;
  builtAt: string;
  sw?: boolean;
}

/** This page's own build. */
export const OWN_VERSION: VersionStamp = {
  commit: String(import.meta.env.VITE_COMMIT ?? ""),
  builtAt: String(import.meta.env.VITE_BUILT_AT ?? ""),
};

export const VERSION_POLL_MS = 10 * 60_000;
/** A second failed lazy import within this long of a reload is left to fail: no loops. */
export const PRELOAD_RELOAD_GUARD_MS = 60_000;
const PRELOAD_KEY = "orchard.grove.preload-reload";

export function parseVersion(doc: unknown): VersionStamp | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  if (typeof d["commit"] !== "string" || !d["commit"]) return null;
  return {
    commit: d["commit"],
    builtAt: typeof d["builtAt"] === "string" ? d["builtAt"] : "",
    ...(typeof d["sw"] === "boolean" ? { sw: d["sw"] } : {}),
  };
}

/**
 * Whether the server has a build this page is not. Two builds of one dirty
 * tree share a commit, so for those the build time decides.
 */
export function isNewer(own: VersionStamp, remote: VersionStamp): boolean {
  if (!own.commit || !remote.commit) return false;
  if (remote.commit !== own.commit) return true;
  return own.commit.endsWith("-dirty") && remote.builtAt !== "" && remote.builtAt !== own.builtAt;
}

/** Whether a failed lazy import may reload the page, given when it last did (sessionStorage). */
export function preloadReloadAllowed(last: string | null, now: number): boolean {
  const at = Number(last);
  return !last || !Number.isFinite(at) || now - at > PRELOAD_RELOAD_GUARD_MS;
}

interface XrLike {
  readonly isPresenting: boolean;
  addEventListener(type: "sessionend", listener: () => void): void;
}

interface HudLike {
  offer(text: string, label: string, onAction: () => void): HTMLElement;
}

export interface GroveUpdatesOptions {
  tier: string;
  hud: HudLike;
  xr: XrLike;
}

/** Registers the service worker (or removes it), watches for new builds, recovers stale lazy imports. */
export function startGroveUpdates(options: GroveUpdatesOptions): void {
  const { hud, xr } = options;
  /** Runs `then` now, or when the immersive session ends. */
  let afterXr: Array<() => void> = [];
  const whenFree = (then: () => void) => {
    if (xr.isPresenting) afterXr.push(then);
    else then();
  };
  xr.addEventListener("sessionend", () => {
    const due = afterXr;
    afterXr = [];
    for (const then of due) then();
  });

  recoverStaleImports(xr, whenFree);
  if (import.meta.env.DEV) return;

  let offered: HTMLElement | null = null;
  let waiting = false;
  const offer = () => {
    if (offered?.isConnected || waiting) return;
    waiting = true;
    whenFree(() => {
      waiting = false;
      offered = hud.offer("A new version of the grove is up —", "reload", () => location.reload());
    });
  };

  const check = async (): Promise<VersionStamp | null> => {
    const stamp = await fetchVersion();
    if (stamp?.sw === false) void removeWorker();
    if (stamp && isNewer(OWN_VERSION, stamp)) offer();
    return stamp;
  };

  // The first answer also decides the worker: an offline visit (no answer)
  // keeps whatever worker it has.
  void check().then((stamp) => {
    if (workerWanted(location.search, stamp)) return registerWorker(options.tier);
    return removeWorker().then((removed) => {
      if (!removed) return;
      console.info("[grove] service worker removed");
      // This page is still the removed worker's client, and it would go on
      // answering (and caching) for it; only a fresh load is free of it.
      // The fresh load finds nothing to remove, so this happens once.
      if (navigator.serviceWorker?.controller) whenFree(() => location.reload());
    });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void check();
  }, VERSION_POLL_MS);
}

async function fetchVersion(): Promise<VersionStamp | null> {
  try {
    const response = await fetch("/version.json", { cache: "no-store" });
    return response.ok ? parseVersion(await response.json()) : null;
  } catch {
    return null;
  }
}

/**
 * A tab left open across a deploy asks for lazy chunks the deploy removed
 * (hls.js, the first time a video wall plays); Vite reports it as
 * `vite:preloadError`. Reload once to pick up the new build; if that happens
 * again within a minute, let the error through rather than loop.
 */
function recoverStaleImports(xr: XrLike, whenFree: (then: () => void) => void): void {
  window.addEventListener("vite:preloadError", (event) => {
    let last: string | null;
    try {
      last = sessionStorage.getItem(PRELOAD_KEY);
      if (!preloadReloadAllowed(last, Date.now())) return;
      sessionStorage.setItem(PRELOAD_KEY, String(Date.now()));
    } catch {
      return; // no way to guard against a loop, so no reload
    }
    console.info("[grove] a part of the page was replaced by a newer build; reloading");
    // In a headset the error goes through as usual and the reload waits.
    if (!xr.isPresenting) event.preventDefault();
    whenFree(() => location.reload());
  });
}
