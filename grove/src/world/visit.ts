import { roomById, type Mansion, type Room } from "./schema";
import { venueEntrance } from "./venue";

/**
 * Bad shared links must still open a room with a finite camera position. A
 * link into a room that asks for something (the club) lands in the nearest
 * room that asks nothing, so the visitor meets its door instead of standing
 * inside with the door's rule unmet; `gated: false` (the demo) walks in.
 */
export function visitRoom(mansion: Mansion, search: URLSearchParams, { gated = true } = {}): Room {
  const asked = roomById(mansion, search.get("room") || mansion.start) ?? roomById(mansion, mansion.start)!;
  return gated ? venueEntrance(mansion, asked.id) : asked;
}

export function finiteParameter(search: URLSearchParams, key: string): number | null {
  const raw = search.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
