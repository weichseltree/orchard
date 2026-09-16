// The grove's token service, as plain functions over Request and Response so
// the Pages Function (functions/auth/[[path]].ts) is one line and the tests
// run in Node.
//
// A visitor's browser posts the answer of Cloudflare's human check (Turnstile)
// to /auth/token and gets back a signed token to connect to SpacetimeDB with.
// SpacetimeDB finds the public key through /auth/.well-known/openid-configuration
// and /auth/jwks.json, checks the signature, and derives the visitor's
// identity from the issuer and `sub`. The module then reads the claims: our
// issuer, our audience, and `ipk`.
//
// `ipk` is an HMAC of the visitor's network (the IPv4 address, or the IPv6
// /64) under a key that lives only here. The database can tell that two
// visitors share a network, which is what the per-network cap and the
// network-wide ban need, and never learns the address.
//
// Nothing here stores anything. Renewal keeps a visitor's identity: a token
// we signed, presented again within a year, keeps its `sub`.

export const AUDIENCE = "orchard-grove";
export const TOKEN_TTL_S = 30 * 24 * 3600;
/** How old a token may be and still hand its identity on to a new one. */
export const RENEW_WITHIN_S = 365 * 24 * 3600;
const MAX_BODY_BYTES = 8192;
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface AuthEnv {
  /** The private EC P-256 signing key, as a JWK in JSON. */
  AUTH_SIGNING_KEY?: string;
  /** Any long random string; the HMAC key for `ipk`. */
  AUTH_NETWORK_KEY?: string;
  /** Turnstile's secret. Without it no human check is asked for. */
  TURNSTILE_SECRET?: string;
  /** The issuer URL; defaults to `<origin>/auth`. Pin it so www and the apex agree. */
  AUTH_ISSUER?: string;
}

export interface AuthDeps {
  fetch: typeof fetch;
  now: () => number;
  randomBytes: (n: number) => Uint8Array;
}

const defaultDeps: AuthDeps = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
};

interface Keys {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey & { kid: string; alg: string; use: string };
}

let cachedKeys: { source: string; keys: Promise<Keys> } | null = null;

/** Imports the signing key once per isolate. */
function keysFrom(source: string): Promise<Keys> {
  if (cachedKeys?.source === source) return cachedKeys.keys;
  const keys = (async (): Promise<Keys> => {
    const jwk = JSON.parse(source) as JsonWebKey;
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d) {
      throw new Error("AUTH_SIGNING_KEY must be a private EC P-256 JWK");
    }
    const { kty, crv, x, y } = jwk;
    const bare = { kty, crv, x, y };
    const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const publicKey = await crypto.subtle.importKey("jwk", bare, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
    // RFC 7638 thumbprint: the members in lexicographic order, no spaces.
    const thumb = await crypto.subtle.digest("SHA-256", utf8(JSON.stringify({ crv, kty, x, y })));
    const kid = b64url(new Uint8Array(thumb)).slice(0, 16);
    return { privateKey, publicKey, publicJwk: { ...bare, kid, alg: "ES256", use: "sig" } };
  })();
  cachedKeys = { source, keys };
  return keys;
}

/**
 * A check that a caller holds a live grove token, for routes beside this one.
 *
 * `verifyOurs` deliberately does not look at `exp`: renewal accepts a token
 * long past it (`RENEW_WITHIN_S`), which is right for handing an identity on
 * and wrong for anything that spends money or grants access. Everything that
 * is not renewal should use this, which checks signature, issuer, audience
 * AND expiry, and returns the claims so a caller can read the identity.
 *
 * Returns null for every failure, with no detail: a caller that distinguishes
 * "bad signature" from "expired" tells an attacker which half to work on.
 */
export async function verifyLive(
  request: Request,
  env: AuthEnv,
  token: string,
  nowS: number = Math.floor(Date.now() / 1000),
): Promise<Record<string, unknown> | null> {
  if (!env.AUTH_SIGNING_KEY) return null;
  let claims: Record<string, unknown> | null;
  try {
    claims = await verifyOurs(await keysFrom(env.AUTH_SIGNING_KEY), token, issuerFor(request, env));
  } catch {
    return null;
  }
  if (!claims) return null;
  if (claims.aud !== AUDIENCE) return null;
  const exp = typeof claims.exp === "number" ? claims.exp : 0;
  if (exp <= nowS) return null;
  return claims;
}

export function issuerFor(request: Request, env: AuthEnv): string {
  return (env.AUTH_ISSUER || `${new URL(request.url).origin}/auth`).replace(/\/+$/, "");
}

/** The part of an address that one household or one phone owns. */
export function networkOf(ip: string): string {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) return v4.slice(1).map(Number).join(".");
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return networkOf(mapped[1]);
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : left;
  return `${groups.slice(0, 4).map((g) => (Number.parseInt(g, 16) || 0).toString(16)).join(":")}::/64`;
}

export async function networkKey(secret: string, ip: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, utf8(networkOf(ip)));
  return b64url(new Uint8Array(mac)).slice(0, 22);
}

export async function signToken(keys: Keys, claims: Record<string, unknown>): Promise<string> {
  const header = { alg: "ES256", typ: "JWT", kid: keys.publicJwk.kid };
  const input = `${b64url(utf8(JSON.stringify(header)))}.${b64url(utf8(JSON.stringify(claims)))}`;
  // WebCrypto's ECDSA signature is already r || s, which is what JWS wants.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, utf8(input));
  return `${input}.${b64url(new Uint8Array(signature))}`;
}

/** The claims of a token we signed, whatever its expiry; null for anything else. */
export async function verifyOurs(keys: Keys, token: string, issuer: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h = "", p = "", s = ""] = parts;
  try {
    const header = JSON.parse(text(unb64url(h))) as { alg?: string };
    if (header.alg !== "ES256") return null;
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keys.publicKey,
      unb64url(s),
      utf8(`${h}.${p}`),
    );
    if (!ok) return null;
    const claims = JSON.parse(text(unb64url(p))) as Record<string, unknown>;
    return claims.iss === issuer ? claims : null;
  } catch {
    return null;
  }
}

async function humanCheckPasses(env: AuthEnv, deps: AuthDeps, answer: unknown, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true;
  if (typeof answer !== "string" || !answer || answer.length > 4096) return false;
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", answer);
  if (ip) form.set("remoteip", ip);
  try {
    const r = await deps.fetch(SITEVERIFY, { method: "POST", body: form });
    const outcome = (await r.json()) as { success?: boolean };
    return outcome.success === true;
  } catch {
    return false;
  }
}

export async function handle(request: Request, env: AuthEnv, deps: AuthDeps = defaultDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/auth/, "") || "/";
  const issuer = issuerFor(request, env);
  if (!env.AUTH_SIGNING_KEY || !env.AUTH_NETWORK_KEY) {
    return json({ error: "the token service is not configured" }, 503);
  }
  let keys: Keys;
  try {
    keys = await keysFrom(env.AUTH_SIGNING_KEY);
  } catch {
    return json({ error: "the token service's signing key is unreadable" }, 503);
  }

  if (request.method === "GET" && path === "/.well-known/openid-configuration") {
    return json(
      {
        issuer,
        jwks_uri: `${issuer}/jwks.json`,
        id_token_signing_alg_values_supported: ["ES256"],
        subject_types_supported: ["public"],
        response_types_supported: ["id_token"],
      },
      200,
      "public, max-age=3600",
    );
  }
  if (request.method === "GET" && path === "/jwks.json") {
    return json({ keys: [keys.publicJwk] }, 200, "public, max-age=3600");
  }
  if (path !== "/token") return json({ error: "not found" }, 404);
  if (request.method !== "POST") return json({ error: "POST only" }, 405);

  // Same-origin only: a page elsewhere must not mint tokens through a
  // visitor's browser. (A script can still call this directly; the human
  // check and the per-network cap in the module are what bind that.)
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "wrong origin" }, 403);
  if (!(request.headers.get("Content-Type") ?? "").startsWith("application/json")) {
    return json({ error: "send JSON" }, 415);
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "too large" }, 413);
  let body: { turnstile?: unknown; previous?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: "bad JSON" }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  if (!(await humanCheckPasses(env, deps, body.turnstile, ip))) {
    return json({ error: "the human check did not pass" }, 403);
  }

  const nowS = Math.floor(deps.now() / 1000);
  let sub = "";
  if (typeof body.previous === "string" && body.previous.length < 4096) {
    const old = await verifyOurs(keys, body.previous, issuer);
    const iat = typeof old?.iat === "number" ? old.iat : 0;
    if (old && typeof old.sub === "string" && nowS - iat < RENEW_WITHIN_S) sub = old.sub;
  }
  if (!sub) sub = `v1.${b64url(deps.randomBytes(16))}`;

  const token = await signToken(keys, {
    iss: issuer,
    sub,
    aud: AUDIENCE,
    iat: nowS,
    exp: nowS + TOKEN_TTL_S,
    ipk: await networkKey(env.AUTH_NETWORK_KEY, ip),
  });
  return json({ token, expires_at: nowS + TOKEN_TTL_S }, 200);
}

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cache },
  });
}

function utf8(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
