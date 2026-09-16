import { describe, expect, it, vi } from "vitest";
import { requestGrant, type VoiceConfig } from "./browser";

const CONFIG: VoiceConfig = { base: "/voice", token: async () => "grove-token" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("requestGrant", () => {
  it("asks our own origin, carrying the grove token", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ token: "dg-temp", url: "wss://x", expires_in: 30 }));
    const grant = await requestGrant(CONFIG, fetcher as unknown as typeof fetch);
    expect(grant.token).toBe("dg-temp");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/voice/grant");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer grove-token");
  });

  it("does not force a token refresh while a button is held down", async () => {
    // A forced refresh can raise a human check, which is a terrible thing to
    // do in the middle of someone speaking.
    const token = vi.fn(async () => "grove-token");
    const fetcher = vi.fn(async () => jsonResponse({ token: "t", url: "wss://x", expires_in: 30 }));
    await requestGrant({ base: "/voice", token }, fetcher as unknown as typeof fetch);
    expect(token).toHaveBeenCalledWith(false);
  });

  it("refuses when this build has no voice route", async () => {
    await expect(requestGrant({ base: "", token: CONFIG.token })).rejects.toThrow(/not configured/);
  });

  it("refuses when there is no grove token to offer", async () => {
    const fetcher = vi.fn();
    await expect(
      requestGrant({ base: "/voice", token: async () => null }, fetcher as unknown as typeof fetch),
    ).rejects.toThrow(/enter the Mind Palace/);
    // And never reaches the route, so an unauthenticated call is not made.
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("passes the route's sentence through, because a visitor reads it", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: "voice is not configured here" }, 503));
    await expect(requestGrant(CONFIG, fetcher as unknown as typeof fetch)).rejects.toThrow(
      "voice is not configured here",
    );
  });

  it("says something readable when the route answers with nothing", async () => {
    const fetcher = vi.fn(async () => new Response("<html>502</html>", { status: 502 }));
    await expect(requestGrant(CONFIG, fetcher as unknown as typeof fetch)).rejects.toThrow(
      "voice is not available right now",
    );
  });
});
