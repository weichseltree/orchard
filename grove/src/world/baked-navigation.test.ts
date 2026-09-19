import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json" with { type: "json" };
import { parseMansion, type Mansion } from "./schema";
import { BAKED_REACHABLE_ROOMS, BAKED_ROOM_ADJACENCY, getBakedReachableRooms } from "./baked-navigation";
import { reachableRooms } from "./navigation";

const mansion: Mansion = parseMansion(mansionDocument);

function dynamicReachableRooms(mansion: Mansion, from: string): Set<string> {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const next = queue.pop();
    const room = mansion.rooms.find((r) => r.id === next);
    if (!room) continue;
    for (const door of room.doorways) {
      if (door.closed || seen.has(door.to)) continue;
      if (!mansion.rooms.some((r) => r.id === door.to)) continue;
      seen.add(door.to);
      queue.push(door.to);
    }
  }
  return seen;
}

describe("pre-baked navigation reachability graph", () => {
  it("pre-bakes reachability sets for all 36 rooms in mansion.json", () => {
    expect(Object.keys(BAKED_REACHABLE_ROOMS)).toHaveLength(mansion.rooms.length);
    for (const room of mansion.rooms) {
      expect(BAKED_REACHABLE_ROOMS[room.id], `missing reachability for ${room.id}`).toBeDefined();
      expect(BAKED_REACHABLE_ROOMS[room.id]!.length).toBeGreaterThan(0);
      expect(BAKED_REACHABLE_ROOMS[room.id]).toContain(room.id);
    }
  });

  it("matches dynamic BFS reachability exactly for every room", () => {
    for (const room of mansion.rooms) {
      const bakedSet = getBakedReachableRooms(room.id);
      const dynamicSet = dynamicReachableRooms(mansion, room.id);
      const navSet = reachableRooms(mansion, room.id);

      expect(Array.from(bakedSet ?? []).sort()).toEqual(Array.from(dynamicSet).sort());
      expect(Array.from(navSet).sort()).toEqual(Array.from(dynamicSet).sort());
    }
  });

  it("provides valid room adjacency topology", () => {
    for (const room of mansion.rooms) {
      const neighbors = BAKED_ROOM_ADJACENCY[room.id];
      expect(neighbors).toBeDefined();
      for (const neighbor of neighbors!) {
        expect(mansion.rooms.some((r) => r.id === neighbor)).toBe(true);
      }
    }
  });
});
