import { describe, expect, it, vi } from "vitest";
import { GRANT_TTL_S, LISTEN_URL, SPEAK_TEXT_MAX, handle, listenUrl, type VoiceDeps } from "./service";

const KEY = "dg-secret-do-not-leak";
const ENV = { DEEPGRAM_API_KEY: KEY, AUTH_SIGNING_KEY: "k" };
const ORIGIN = "https://weichseltree.com";

function deps(over: Partial<VoiceDeps> = {}): VoiceDeps {
  return {
    fetch: vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "dg-temp", expires_in: 30 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch,
    verify: async () => true,
    ...over,
  };
}

function post(path: string, body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { authorization: "Bearer grove-token", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

describe("the key", () => {
  it("never appears in a grant response", async () => {
    const response = await handle(post("/voice/grant"), ENV, deps());
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).token).toBe("dg-temp");
  });

  it("never appears in an error, whatever Deepgram said", async () => {
    // Deepgram's own error bodies can name the account and the key's label.
    const upstream = deps({
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ err_msg: `invalid key ${KEY} for project acme` }), { status: 401 }),
      ) as unknown as typeof fetch,
    });
    const response = await handle(post("/voice/grant"), ENV, upstream);
    const text = await response.text();
    expect(response.status).toBe(502);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("acme");
  });

  it("is sent to Deepgram and to nobody else", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "dg-temp" }), { status: 200 }),
    );
    await handle(post("/voice/grant"), ENV, deps({ fetch: fetcher as unknown as typeof fetch }));
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("https://api.deepgram.com/")).toBe(true);
    expect((init.headers as Record<string, string>).authorization).toBe(`Token ${KEY}`);
  });
});

describe("who may call", () => {
  it("refuses a caller with no grove token", async () => {
    const request = new Request(`${ORIGIN}/voice/grant`, { method: "POST", headers: { origin: ORIGIN } });
    const response = await handle(request, ENV, deps());
    expect(response.status).toBe(401);
  });

  it("refuses a grove token that does not verify", async () => {
    const response = await handle(post("/voice/grant"), ENV, deps({ verify: async () => false }));
    expect(response.status).toBe(403);
  });

  it("refuses another origin, which would be spend on our account", async () => {
    const response = await handle(post("/voice/grant", {}, { origin: "https://elsewhere.example" }), ENV, deps());
    expect(response.status).toBe(403);
  });

  it("does not reach Deepgram at all when the caller is refused", async () => {
    const fetcher = vi.fn();
    await handle(post("/voice/grant"), ENV, deps({ verify: async () => false, fetch: fetcher as unknown as typeof fetch }));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says voice is unconfigured rather than failing, when there is no key", async () => {
    const response = await handle(post("/voice/grant"), { AUTH_SIGNING_KEY: "k" }, deps());
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("not configured");
  });

  it("refuses a GET, so a grant cannot be a link someone follows", async () => {
    const request = new Request(`${ORIGIN}/voice/grant`, { method: "GET", headers: { origin: ORIGIN } });
    expect((await handle(request, ENV, deps())).status).toBe(405);
  });
});

describe("the grant", () => {
  it("asks for a short life", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ access_token: "t" }), { status: 200 }));
    await handle(post("/voice/grant"), ENV, deps({ fetch: fetcher as unknown as typeof fetch }));
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ ttl_seconds: GRANT_TTL_S });
    expect(GRANT_TTL_S).toBeLessThanOrEqual(60);
  });

  it("hands back the socket to open, so the client hardcodes no URL", async () => {
    const response = await handle(post("/voice/grant"), ENV, deps());
    const body = (await response.json()) as { url: string };
    expect(body.url.startsWith(LISTEN_URL)).toBe(true);
  });

  it("is never cached: a grant is single use and expires in seconds", async () => {
    const response = await handle(post("/voice/grant"), ENV, deps());
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("the listen socket's query", () => {
  it("turns on the UtteranceEnd backstop alongside interim results", () => {
    // Interim results without `utterance_end_ms` is the configuration where a
    // sentence is sometimes never completed and nothing says why.
    const query = new URL(listenUrl()).searchParams;
    expect(query.get("interim_results")).toBe("true");
    expect(query.get("utterance_end_ms")).toBeTruthy();
    expect(query.get("endpointing")).toBeTruthy();
  });
});

describe("speaking", () => {
  it("caps the text, so the route is not an open account", async () => {
    const response = await handle(post("/voice/speak", { text: "a".repeat(SPEAK_TEXT_MAX + 1) }), ENV, deps());
    expect(response.status).toBe(413);
  });

  it("refuses an empty line rather than paying for silence", async () => {
    expect((await handle(post("/voice/speak", { text: "   " }), ENV, deps())).status).toBe(400);
  });

  it("returns audio a browser will decode", async () => {
    const audio = deps({
      fetch: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch,
    });
    const response = await handle(post("/voice/speak", { text: "I am here." }), ENV, audio);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
  });

  it("lets a line be held but never marks it immutable", async () => {
    // A fixed name that is immutable can never be corrected -- the rule
    // public/_headers states for the whole site.
    const audio = deps({
      fetch: vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })) as unknown as typeof fetch,
    });
    const response = await handle(post("/voice/speak", { text: "hello" }), ENV, audio);
    const cache = response.headers.get("cache-control") ?? "";
    expect(cache).toContain("max-age");
    expect(cache).not.toContain("immutable");
  });
});

describe("a refusal from Deepgram", () => {
  const refused = () =>
    vi.fn(async () =>
      new Response(
        JSON.stringify({ err_code: "FORBIDDEN", err_msg: `Insufficient permissions for key ${KEY} in project acme`, request_id: "req-1" }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

  it("is logged with its code, so a 502 can be explained without reproducing it", async () => {
    // The first live failure was a bare 502 nobody could diagnose.
    const log = vi.fn();
    const response = await handle(post("/voice/grant"), ENV, deps({ fetch: refused(), log }));
    expect(response.status).toBe(502);
    expect(log).toHaveBeenCalledWith({ voice: "grant", status: 403, err_code: "FORBIDDEN", request_id: "req-1" });
  });

  it("never logs Deepgram's message, which can name the account and the key", async () => {
    const log = vi.fn();
    await handle(post("/voice/grant"), ENV, deps({ fetch: refused(), log }));
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain("acme");
    expect(logged).not.toContain("Insufficient");
  });

  it("still tells the visitor nothing about why", async () => {
    const response = await handle(post("/voice/grant"), ENV, deps({ fetch: refused(), log: vi.fn() }));
    const text = await response.text();
    expect(text).not.toContain("FORBIDDEN");
    expect(text).not.toContain("req-1");
  });

  it("logs a speak refusal the same way", async () => {
    const log = vi.fn();
    await handle(post("/voice/speak", { text: "hello" }), ENV, deps({ fetch: refused(), log }));
    expect(log).toHaveBeenCalledWith({ voice: "speak", status: 403, err_code: "FORBIDDEN", request_id: "req-1" });
  });

  it("logs a refusal whose body is not JSON by its status alone", async () => {
    const log = vi.fn();
    const html = vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    await handle(post("/voice/grant"), ENV, deps({ fetch: html, log }));
    expect(log).toHaveBeenCalledWith({ voice: "grant", status: 502, err_code: null, request_id: null });
  });
});
