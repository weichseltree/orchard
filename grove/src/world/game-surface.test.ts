import { describe, expect, it } from "vitest";
import { gameLifecycleEvent, gameSurfaceUrl } from "./game-surface";
import type { GameSurface } from "./schema";

const surface: GameSurface = {
  id: "ftl-chess",
  provider: "ftlchess",
  title: "FTL Chess",
  description: "",
  url: "https://ftlchess.com/play?theme=night",
  yawDeg: 0,
};

describe("gameSurfaceUrl", () => {
  it("adds Orchard-controlled embed targeting without losing provider parameters", () => {
    const url = gameSurfaceUrl(surface, "https://weichseltree.com");
    expect(url.origin).toBe("https://ftlchess.com");
    expect(url.searchParams.get("theme")).toBe("night");
    expect(url.searchParams.get("embed")).toBe("orchard");
    expect(url.searchParams.get("parentOrigin")).toBe("https://weichseltree.com");
  });

  it("rejects origins that merely resemble the trusted origin", () => {
    for (const url of [
      "https://ftlchess.com.evil.example/",
      "https://evil.example/?next=https://ftlchess.com",
      "http://ftlchess.com/",
      "https://user:secret@ftlchess.com/",
    ]) {
      expect(() => gameSurfaceUrl({ ...surface, url }, "https://weichseltree.com")).toThrow();
    }
  });
});

describe("gameLifecycleEvent", () => {
  const source = {} as MessageEventSource;
  const message = {
    origin: "https://ftlchess.com",
    source,
    data: {
      source: "ftlchess",
      event: "game-ended",
      platform: "orchard",
      payload: { status: "won", moves: 42 },
    },
  };

  it("accepts the documented event from the active frame and exact origin", () => {
    expect(gameLifecycleEvent(message, "https://ftlchess.com", source)).toEqual(message.data);
  });

  it("rejects a wrong frame, origin, event, platform, or payload shape", () => {
    expect(gameLifecycleEvent(message, "https://other.example", source)).toBeNull();
    expect(gameLifecycleEvent(message, message.origin, {} as MessageEventSource)).toBeNull();
    expect(gameLifecycleEvent({ ...message, data: { ...message.data, event: "navigate" } }, message.origin, source)).toBeNull();
    expect(gameLifecycleEvent({ ...message, data: { ...message.data, platform: "evil" } }, message.origin, source)).toBeNull();
    expect(gameLifecycleEvent({ ...message, data: { ...message.data, payload: [] } }, message.origin, source)).toBeNull();
  });
});
