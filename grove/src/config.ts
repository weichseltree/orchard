/**
 * Everything the deployment can change without a code change. Vite inlines
 * `import.meta.env` at build time; the defaults are the live orchard.
 */
const env = import.meta.env;

/** Where content-addressed bundles are served from (R2 behind Cloudflare). */
export const MEDIA_BASE: string = trimSlash(env.VITE_MEDIA_BASE ?? "https://media.weichseltree.com");

/** SpacetimeDB Maincloud, over the websocket the SDK opens. */
export const SPACETIME_URI: string = env.VITE_SPACETIME_URI ?? "wss://maincloud.spacetimedb.com";
export const SPACETIME_DB: string = env.VITE_SPACETIME_DB ?? "orchard";

/** Where a visitor lands when the room they asked for is refused. */
export const FALLBACK_ROOM = "grove";

/** localStorage keys. The token is what makes an anonymous identity persist. */
export const TOKEN_KEY = "orchard.grove.token";
export const NAME_KEY = "orchard.grove.name";

/** Presence: at most this often, and only while actually moving. */
export const MOVE_HZ = 10;
export const MOVE_MIN_INTERVAL_MS = 1000 / MOVE_HZ;
/** Below these deltas a visitor counts as standing still. */
export const MOVE_EPSILON_M = 0.02;
export const MOVE_EPSILON_YAW_RAD = 0.035;

export const PALETTE = {
  background: "#0e1310",
  text: "#d9e2da",
  dim: "#8a978c",
  accent: "#7fc97f",
} as const;

function trimSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
