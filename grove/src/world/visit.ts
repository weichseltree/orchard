import { roomById, type Mansion, type Room } from "./schema";

/** Bad shared links must still open a room with a finite camera position. */
export function visitRoom(mansion: Mansion, search: URLSearchParams): Room {
  return roomById(mansion, search.get("room") || mansion.start)
    ?? roomById(mansion, mansion.start)!;
}

export function finiteParameter(search: URLSearchParams, key: string): number | null {
  const raw = search.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
