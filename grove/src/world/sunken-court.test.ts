import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { BODY_RADIUS, resolveMove } from "./navigation";
import { flightsOf, floorAt } from "./terrain";
import { parseMansion } from "./schema";

// The sunken court is the one place in the palace where three flights come
// down into one room, and the first where a flight's cheek wall can stand
// across another flight's foot. The court shipped once with two of the three
// dead: the terrace flights' feet landed inside the garden flight's cheek
// band, so a visitor walked down, stopped 0.34 m above the paving with the
// club's door in sight, and could neither go on nor be shown why (reviewed
// 2026-09-18). The suite could not see it, because every other test asks the
// geometry a question about one flight at a time. This one walks.

const mansion = parseMansion(mansionDocument);
const room = (id: string) => mansion.rooms.find((r) => r.id === id)!;
const STEP = 0.12;

/**
 * A body walking a route, a step at a time, through whatever rooms the route
 * crosses: the same `resolveMove` main.ts uses, so a clamp that stops a
 * visitor stops this walk in the same place.
 */
function walk(startRoom: string, from: { x: number; z: number }, route: readonly { x: number; z: number }[]) {
  let at = { x: from.x, z: from.z }, id = startRoom;
  const visited = [startRoom];
  for (const target of route) {
    // Generous: 40 steps per metre of the leg, so a walk that is merely slow
    // still arrives and only a walk that is BLOCKED fails.
    const budget = Math.ceil(Math.hypot(target.x - at.x, target.z - at.z) / STEP) + 40;
    for (let i = 0; i < budget; i++) {
      const gap = Math.hypot(target.x - at.x, target.z - at.z);
      if (gap < 0.05) break;
      const stride = Math.min(STEP, gap);
      const to = { x: at.x + (target.x - at.x) / gap * stride, z: at.z + (target.z - at.z) / gap * stride };
      const out = resolveMove(mansion, id, at, to);
      at = { x: out.x, z: out.z };
      if (out.room !== id) { id = out.room; visited.push(id); }
    }
  }
  return { ...at, room: id, visited, floor: floorAt(mansion, room(id), at.x, at.z) };
}

/** Where a flight's foot lies along its axis: the point a walker must be able to reach. */
function foot(roomId: string, to: string): number {
  const flight = flightsOf(mansion, room(roomId)).find((f) => f.door.to === to)!;
  return flight.door.at + flight.direction * flight.run;
}

describe("the sunken court", () => {
  const court = room("stair-court");
  const FLOOR = court.bounds.min[1];

  it("is deep enough for both terrace flights and the garden flight between them", () => {
    const south = foot("stair-court", "terrace"), north = foot("stair-court", "terrace-north");
    const garden = court.doorways.find((d) => d.to === "parterre")!;
    // The garden flight's cheeks are a wall this far either side of its centre.
    const cheek = garden.width / 2 + 0.5 + BODY_RADIUS;
    expect(south).toBeLessThan(court.bounds.max[2]);
    expect(north).toBeGreaterThan(court.bounds.min[2]);
    // Each foot stands clear of the cheek band, with room to turn.
    expect(south).toBeGreaterThan(garden.center + cheek + 0.5);
    expect(north).toBeLessThan(garden.center - cheek - 0.5);
  });

  it("lets a visitor walk down the middle flight from the terrace to the paving", () => {
    const arrived = walk("terrace", { x: -16, z: -5 }, [{ x: -16, z: -6 }, { x: -16, z: -21 }]);
    expect(arrived.room).toBe("stair-court");
    // On the paving, not held on the steps above it.
    expect(arrived.floor).toBeCloseTo(FLOOR, 2);
    expect(arrived.z).toBeLessThan(foot("stair-court", "terrace") + 0.3);
  });

  it("lets a visitor walk down the north flight from the orangery's terrace", () => {
    const arrived = walk("terrace-north", { x: -16, z: -42 }, [{ x: -16, z: -40 }, { x: -16, z: -28 }]);
    expect(arrived.room).toBe("stair-court");
    expect(arrived.floor).toBeCloseTo(FLOOR, 2);
    expect(arrived.z).toBeGreaterThan(foot("stair-court", "terrace-north") - 0.3);
  });

  it("lets a visitor walk down the garden flight from the parterre", () => {
    const arrived = walk("parterre", { x: -24, z: -24.5 }, [{ x: -21, z: -24.5 }, { x: -12, z: -24.5 }]);
    expect(arrived.room).toBe("stair-court");
    expect(arrived.floor).toBeCloseTo(FLOOR, 2);
  });

  it("lets a visitor cross the court from the middle flight to the club's door", () => {
    // Down, east past the garden flight's foot, north to the door, in.
    const arrived = walk("terrace", { x: -16, z: -5 }, [
      { x: -16, z: -21 }, { x: -11.5, z: -20 }, { x: -11.5, z: -27 }, { x: -9, z: -27 },
    ]);
    expect(arrived.room).toBe("club");
    expect(arrived.visited).toEqual(["terrace", "stair-court", "club"]);
  });

  it("lets a visitor cross the court to the undercroft door at its north end", () => {
    const arrived = walk("terrace", { x: -16, z: -5 }, [
      { x: -16, z: -21 }, { x: -11.8, z: -20 }, { x: -11.8, z: -39 },
    ]);
    expect(arrived.room).toBe("foyer");
  });

  it("lets a visitor climb back out of the court onto both arms of the terrace", () => {
    const up = walk("stair-court", { x: -16, z: -19 }, [{ x: -16, z: -9 }]);
    expect(up.room).toBe("terrace");
    const north = walk("stair-court", { x: -16, z: -30 }, [{ x: -16, z: -40 }]);
    expect(north.room).toBe("terrace-north");
  });

  it("walks the north arm past the orangery without being pulled into a flight", () => {
    // The walk that found the cheek-wall bug in the first place (Manuel,
    // 2026-09-17): along the arm, past the orangery's two doors and their
    // flights, from the court's rim to the arm's far end.
    const along = walk("terrace-north", { x: -15, z: -40 }, [{ x: -15, z: -74 }]);
    expect(along.room).toBe("terrace-north");
    expect(along.x).toBeCloseTo(-15, 1);
    expect(along.z).toBeLessThan(-73);
  });
});
