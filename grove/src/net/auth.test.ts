import { describe, expect, it } from "vitest";
import { RENEW_BEFORE_S, groveToken, tokenExpiry, type GroveTokenDeps } from "./auth";

const NOW_S = 1_800_000_000;

function jwt(claims: Record<string, unknown>): string {
  const part = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${part({ alg: "ES256" })}.${part(claims)}.sig`;
}

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

function deps(over: Partial<GroveTokenDeps> & { answer?: () => Response; sent?: unknown[] } = {}): GroveTokenDeps {
  const sent = over.sent ?? [];
  return {
    url: "/auth",
    storage: memoryStorage(),
    now: () => NOW_S * 1000,
    humanCheck: null,
    fetch: async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return over.answer ? over.answer() : new Response(JSON.stringify({ token: jwt({ exp: NOW_S + 30 * 86400 }) }));
    },
    ...over,
  };
}

describe("tokenExpiry", () => {
  it("reads exp, and nothing from garbage", () => {
    expect(tokenExpiry(jwt({ exp: 42 }))).toBe(42);
    expect(tokenExpiry("not.a-token")).toBeNull();
    expect(tokenExpiry("")).toBeNull();
  });
});

describe("groveToken", () => {
  it("reuses a stored token that has more than three days left", async () => {
    const stored = jwt({ exp: NOW_S + RENEW_BEFORE_S + 60 });
    const sent: unknown[] = [];
    const token = await groveToken(deps({ storage: memoryStorage({ "orchard.grove.pass": stored }), sent }));
    expect(token).toBe(stored);
    expect(sent).toHaveLength(0);
  });

  it("renews a token close to expiry, handing the old one back so the identity carries on", async () => {
    const stored = jwt({ exp: NOW_S + 60 });
    const storage = memoryStorage({ "orchard.grove.pass": stored });
    const sent: unknown[] = [];
    const token = await groveToken(deps({ storage, sent }));
    expect(token).not.toBe(stored);
    expect(sent).toEqual([{ previous: stored }]);
    expect(storage.map.get("orchard.grove.pass")).toBe(token);
  });

  it("asks again when presence wants a fresh one, even if the stored token looks fine", async () => {
    const stored = jwt({ exp: NOW_S + 20 * 86400 });
    const sent: unknown[] = [];
    await groveToken(deps({ storage: memoryStorage({ "orchard.grove.pass": stored }), sent }), true);
    expect(sent).toHaveLength(1);
  });

  it("never sends the old anonymous SpacetimeDB token to the service", async () => {
    const sent: unknown[] = [];
    await groveToken(deps({ storage: memoryStorage({ "orchard.grove.token": "spacetime-anon" }), sent }));
    expect(sent).toEqual([{}]);
  });

  it("sends the human check's answer when one is configured", async () => {
    const sent: unknown[] = [];
    await groveToken(deps({ humanCheck: async () => "turnstile-answer", sent }));
    expect(sent).toEqual([{ turnstile: "turnstile-answer" }]);
  });

  it("passes the service's refusal on as the reason", async () => {
    const answer = () => new Response(JSON.stringify({ error: "the human check did not pass" }), { status: 403 });
    await expect(groveToken(deps({ answer }))).rejects.toThrow("the human check did not pass");
  });

  it("falls back to anonymous (null) while the service has no keys, instead of failing", async () => {
    const answer = () => new Response(JSON.stringify({ error: "the token service is not configured" }), { status: 503 });
    expect(await groveToken(deps({ answer }))).toBeNull();
  });

  it("says the service did not answer when the network fails", async () => {
    const d = deps();
    d.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    await expect(groveToken(d)).rejects.toThrow("did not answer");
  });
});
