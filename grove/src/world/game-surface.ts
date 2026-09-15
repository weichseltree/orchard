import type { GameSurface } from "./schema";

export const GAME_EVENTS = ["ready", "screen", "game-started", "game-ended"] as const;
export type GameEventName = (typeof GAME_EVENTS)[number];

export interface GameLifecycleEvent {
  source: "ftlchess";
  event: GameEventName;
  platform: "orchard" | "embed";
  payload: Record<string, unknown>;
}

const TRUSTED_ORIGINS: Readonly<Record<GameSurface["provider"], readonly string[]>> = {
  ftlchess: ["https://ftlchess.com"],
};

export function gameSurfaceUrl(surface: GameSurface, parentOrigin: string): URL {
  const url = new URL(surface.url);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${surface.id}: game surface URL must be credential-free HTTPS`);
  }
  if (!TRUSTED_ORIGINS[surface.provider].includes(url.origin)) {
    throw new Error(`${surface.id}: ${url.origin} is not trusted for ${surface.provider}`);
  }
  const parent = new URL(parentOrigin);
  if (!["http:", "https:"].includes(parent.protocol) || parent.origin !== parentOrigin) {
    throw new Error(`${surface.id}: parent origin is invalid`);
  }
  url.searchParams.set("embed", "orchard");
  url.searchParams.set("parentOrigin", parent.origin);
  return url;
}

export function gameLifecycleEvent(
  event: Pick<MessageEvent, "data" | "origin" | "source">,
  expectedOrigin: string,
  expectedSource: MessageEventSource | null,
): GameLifecycleEvent | null {
  if (event.origin !== expectedOrigin || event.source !== expectedSource) return null;
  const data = event.data;
  if (!isRecord(data) || data.source !== "ftlchess") return null;
  if (!GAME_EVENTS.includes(data.event as GameEventName)) return null;
  if (data.platform !== "orchard" && data.platform !== "embed") return null;
  if (!isRecord(data.payload)) return null;
  return data as unknown as GameLifecycleEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
