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

/**
 * The grove's token service (functions/auth, on the same Pages project). A
 * visitor connects with the token it issues; see src/net/auth.ts. Empty turns
 * it off and presence uses anonymous identities: `pnpm dev` has no Pages
 * Functions, so it is off there unless VITE_AUTH_URL says otherwise.
 */
export const AUTH_URL: string = trimSlash(env.VITE_AUTH_URL ?? "/auth");

/**
 * The voice route, a Pages Function beside /auth, and off for the same reason
 * in `vite` (which runs no Functions). Off also means the microphone is not
 * offered at all: the route holds the Deepgram key, so without it there is
 * nothing a client could do with a microphone but fail.
 */
export const VOICE_URL: string = trimSlash(env.VITE_VOICE_URL ?? "/voice");

/**
 * Cloudflare Turnstile's site key (public by design). Empty: no human check is
 * run in the browser, which matches a token service without TURNSTILE_SECRET.
 */
export const TURNSTILE_SITEKEY: string = env.VITE_TURNSTILE_SITEKEY ?? "";

/** Where a visitor lands when the room they asked for is refused. */
export const FALLBACK_ROOM = "grove";

/** localStorage keys. The token is what makes an anonymous identity persist. */
export const TOKEN_KEY = "orchard.grove.token";
/** The token service's token: a separate key, so an old anonymous token is never sent to it. */
export const PASS_KEY = "orchard.grove.pass";
export const NAME_KEY = "orchard.grove.name";

/** Presence: at most this often, and only while actually moving. */
export const MOVE_HZ = 10;
export const MOVE_MIN_INTERVAL_MS = 1000 / MOVE_HZ;
/** Below these deltas a visitor counts as standing still. */
export const MOVE_EPSILON_M = 0.02;
export const MOVE_EPSILON_YAW_RAD = 0.035;

export const PALETTE = {
  background: "#09111c",
  text: "#eee9df",
  dim: "#a1afbd",
  accent: "#e1bd82",
} as const;

function trimSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
