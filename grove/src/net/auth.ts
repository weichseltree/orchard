import { AUTH_URL, PASS_KEY, TURNSTILE_SITEKEY } from "../config";
import type { TokenSource } from "./presence";
import { humanCheck } from "./turnstile";

// The token a visitor connects to SpacetimeDB with, from the grove's token
// service (functions/auth). No login: the service runs Cloudflare's human
// check, when it has one, and signs a token that names a stable identity and
// a keyed hash of the visitor's network. The module counts and bans by that
// hash; it never sees an address.
//
// The token lives 30 days and is renewed three days before it runs out, or
// whenever presence asks for a fresh one after a failed connection. Renewal
// hands the old token back, so the identity (and a name, a mute) carries on.

/** Renew this long before the token would expire. */
export const RENEW_BEFORE_S = 3 * 24 * 3600;

export interface GroveTokenDeps {
  url: string;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  fetch: typeof fetch;
  now: () => number;
  /** Resolves with Turnstile's answer; null when no human check is configured. */
  humanCheck: (() => Promise<string>) | null;
}

/** The `exp` claim of a token, in seconds; null for anything unreadable. */
export function tokenExpiry(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

/**
 * A token to connect with, or null when this deployment's token service has
 * no keys yet (then presence uses an anonymous identity, as it always did).
 */
export async function groveToken(deps: GroveTokenDeps, fresh = false): Promise<string | null> {
  let stored: string | null = null;
  try {
    stored = deps.storage?.getItem(PASS_KEY) ?? null;
  } catch {
    // Locked-down storage: a new identity each visit, which is fine.
  }
  const exp = stored ? tokenExpiry(stored) : null;
  if (stored && !fresh && exp !== null && exp - deps.now() / 1000 > RENEW_BEFORE_S) return stored;

  const turnstile = deps.humanCheck ? await deps.humanCheck() : undefined;
  let response: Response;
  try {
    response = await deps.fetch(`${deps.url}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnstile, previous: stored ?? undefined }),
    });
  } catch {
    throw new Error("the token service did not answer");
  }
  const body = (await response.json().catch(() => ({}))) as { token?: unknown; error?: unknown };
  // 503 is a deployment without its keys yet: carry on as before, anonymously.
  if (response.status === 503) return null;
  if (!response.ok || typeof body.token !== "string") {
    throw new Error(typeof body.error === "string" ? body.error : `the token service said ${response.status}`);
  }
  try {
    deps.storage?.setItem(PASS_KEY, body.token);
  } catch {
    // Not fatal: the next visit asks again.
  }
  return body.token;
}

/**
 * Presence's token source for this deployment, or undefined when the token
 * service is off (then presence keeps the anonymous identities it always had).
 * `hudRoot` is where Turnstile may show its box if it wants an interaction.
 */
export function deploymentTokenSource(hudRoot: HTMLElement): TokenSource | undefined {
  if (!AUTH_URL) return undefined;
  const deps: GroveTokenDeps = {
    url: AUTH_URL,
    storage: safeStorage(),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    humanCheck: TURNSTILE_SITEKEY ? () => humanCheck(TURNSTILE_SITEKEY, hudRoot) : null,
  };
  return (fresh) => groveToken(deps, fresh);
}

function safeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
