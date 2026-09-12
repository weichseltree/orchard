import { describe, expect, it } from "vitest";
import { AUDIENCE, TOKEN_TTL_S, handle, networkKey, networkOf, unb64url, type AuthDeps, type AuthEnv } from "./issuer";

async function makeEnv(extra: Partial<AuthEnv> = {}): Promise<AuthEnv> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { AUTH_SIGNING_KEY: JSON.stringify(jwk), AUTH_NETWORK_KEY: "test-network-key", ...extra };
}

const ORIGIN = "https://www.weichseltree.com";

let n = 0;
function deps(over: Partial<AuthDeps> = {}): AuthDeps {
  return {
    fetch: () => Promise.reject(new Error("no network in tests")),
    now: () => 1_800_000_000_000,
    randomBytes: (k) => new Uint8Array(k).fill(++n),
    ...over,
  };
}

function tokenRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.7", ...headers },
    body: JSON.stringify(body),
  });
}

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(unb64url(token.split(".")[1] ?? ""))) as Record<string, unknown>;
}

async function verifyWithJwks(env: AuthEnv, token: string): Promise<boolean> {
  const jwks = (await (await handle(new Request(`${ORIGIN}/auth/jwks.json`), env, deps())).json()) as {
    keys: JsonWebKey[];
  };
  const key = await crypto.subtle.importKey("jwk", jwks.keys[0]!, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "verify",
  ]);
  const [h, p, s] = token.split(".");
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    unb64url(s ?? ""),
    new TextEncoder().encode(`${h}.${p}`),
  );
}

describe("networkOf", () => {
  it("keeps a whole IPv4 address", () => {
    expect(networkOf("203.0.113.7")).toBe("203.0.113.7");
  });

  it("cuts IPv6 to the /64 a household or a phone owns", () => {
    expect(networkOf("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(networkOf("2001:0db8:0001:0002::1")).toBe("2001:db8:1:2::/64");
    expect(networkOf("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });

  it("treats an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(networkOf("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });
});

describe("networkKey", () => {
  it("is the same for one /64 and different across networks, and never the address", async () => {
    const a = await networkKey("k", "2001:db8:1:2::1");
    const b = await networkKey("k", "2001:db8:1:2::ffff");
    const c = await networkKey("k", "2001:db8:1:3::1");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain("2001");
    expect(await networkKey("other", "2001:db8:1:2::1")).not.toBe(a);
  });
});

describe("the token service", () => {
  it("publishes an OIDC discovery document that points at its keys", async () => {
    const env = await makeEnv();
    const r = await handle(new Request(`${ORIGIN}/auth/.well-known/openid-configuration`), env, deps());
    const doc = (await r.json()) as { issuer: string; jwks_uri: string };
    expect(doc.issuer).toBe(`${ORIGIN}/auth`);
    expect(doc.jwks_uri).toBe(`${ORIGIN}/auth/jwks.json`);
    const jwks = (await (await handle(new Request(doc.jwks_uri), env, deps())).json()) as {
      keys: Array<Record<string, string>>;
    };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).not.toHaveProperty("d"); // the private half never leaves
    expect(jwks.keys[0]?.alg).toBe("ES256");
  });

  it("issues a token SpacetimeDB can verify, with our audience and a network key", async () => {
    const env = await makeEnv();
    const r = await handle(tokenRequest({}), env, deps());
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const { token } = (await r.json()) as { token: string };
    const claims = claimsOf(token);
    expect(claims.iss).toBe(`${ORIGIN}/auth`);
    expect(claims.aud).toBe(AUDIENCE);
    expect(claims.exp).toBe((claims.iat as number) + TOKEN_TTL_S);
    expect(claims.ipk).toBe(await networkKey("test-network-key", "203.0.113.7"));
    expect(await verifyWithJwks(env, token)).toBe(true);
  });

  it("keeps a visitor's identity when they renew with a token it signed", async () => {
    const env = await makeEnv();
    const first = claimsOf(((await (await handle(tokenRequest({}), env, deps())).json()) as { token: string }).token);
    const firstToken = ((await (await handle(tokenRequest({}), env, deps())).json()) as { token: string }).token;
    const renewed = claimsOf(
      ((await (await handle(tokenRequest({ previous: firstToken }), env, deps())).json()) as { token: string }).token,
    );
    expect(renewed.sub).toBe(claimsOf(firstToken).sub);
    expect(renewed.sub).not.toBe(first.sub); // two fresh requests are two people
  });

  it("does not let a forged or foreign token hand on its identity", async () => {
    const env = await makeEnv();
    const other = await makeEnv();
    const foreign = ((await (await handle(tokenRequest({}), other, deps())).json()) as { token: string }).token;
    const r = claimsOf(
      ((await (await handle(tokenRequest({ previous: foreign }), env, deps())).json()) as { token: string }).token,
    );
    expect(r.sub).not.toBe(claimsOf(foreign).sub);
    const tampered = foreign.replace(/\.[^.]+\./, `.${btoa(JSON.stringify({ sub: "v1.admin", iss: `${ORIGIN}/auth` })).replace(/=+$/, "")}.`);
    const t = claimsOf(
      ((await (await handle(tokenRequest({ previous: tampered }), env, deps())).json()) as { token: string }).token,
    );
    expect(t.sub).not.toBe("v1.admin");
  });

  it("asks Turnstile when it has a secret, and refuses a failed check", async () => {
    const env = await makeEnv({ TURNSTILE_SECRET: "s" });
    const seen: string[] = [];
    const answer = (success: boolean): AuthDeps["fetch"] => async (_url, init) => {
      const form = init?.body as FormData;
      seen.push(String(form.get("response")));
      return new Response(JSON.stringify({ success }));
    };
    expect((await handle(tokenRequest({}), env, deps({ fetch: answer(true) }))).status).toBe(403); // no answer at all
    expect((await handle(tokenRequest({ turnstile: "bad" }), env, deps({ fetch: answer(false) }))).status).toBe(403);
    expect((await handle(tokenRequest({ turnstile: "good" }), env, deps({ fetch: answer(true) }))).status).toBe(200);
    expect(seen).toEqual(["bad", "good"]);
    const down: AuthDeps["fetch"] = () => Promise.reject(new Error("down"));
    expect((await handle(tokenRequest({ turnstile: "x" }), env, deps({ fetch: down }))).status).toBe(403);
  });

  it("refuses other origins, non-JSON and oversized bodies", async () => {
    const env = await makeEnv();
    expect((await handle(tokenRequest({}, { Origin: "https://evil.example" }), env, deps())).status).toBe(403);
    expect((await handle(tokenRequest({}, { "Content-Type": "text/plain" }), env, deps())).status).toBe(415);
    expect((await handle(tokenRequest({ previous: "x".repeat(9000) }), env, deps())).status).toBe(413);
    expect((await handle(new Request(`${ORIGIN}/auth/token`), env, deps())).status).toBe(405);
  });

  it("says so when it has no keys, rather than issuing anything", async () => {
    const r = await handle(tokenRequest({}), {}, deps());
    expect(r.status).toBe(503);
  });

  it("uses the pinned issuer so www and the apex mint the same identities", async () => {
    const env = await makeEnv({ AUTH_ISSUER: `${ORIGIN}/auth/` });
    const req = new Request("https://weichseltree.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://weichseltree.com" },
      body: "{}",
    });
    const { token } = (await (await handle(req, env, deps())).json()) as { token: string };
    expect(claimsOf(token).iss).toBe(`${ORIGIN}/auth`);
  });
});

describe("a misconfigured token service", () => {
  it("answers 503 for an unreadable signing key instead of throwing", async () => {
    const r = await handle(tokenRequest({}), { AUTH_SIGNING_KEY: "{not json", AUTH_NETWORK_KEY: "k" }, deps());
    expect(r.status).toBe(503);
  });
});
