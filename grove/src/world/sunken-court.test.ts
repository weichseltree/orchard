import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { resolveMove } from "./navigation";
import { STAIR_MARGIN, floorAt } from "./terrain";
import { parseMansion } from "./schema";

// The sunken court is the grand semi-octagonal (Halb-Achteck) staircase where
// the terrace's two arms, the garden, and the club meet. It replaces straight
// flights with concentric faceted stone tiers forming a half-octagon, descending
// from the terrace (y=0) and garden (y=-1.6) to the paved court floor (y=-5.0)
// in front of the club's entrance, stretching into the garden and free of
// chamber walls and obstructive doors. This suite walks all routes.

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

describe("the sunken court", () => {
  const court = room("stair-court");
  const FLOOR = court.bounds.min[1];

  it("lets a visitor walk down the semi-octagonal staircase from the south terrace to the court paving", () => {
    const arrived = walk("terrace", { x: -16, z: -5 }, [{ x: -16, z: -6 }, { x: -16, z: -21 }, { x: -12, z: -24.5 }]);
    expect(arrived.room).toBe("stair-court");
    // On the paving at the bottom of the semi-octagonal steps
    expect(arrived.floor).toBeCloseTo(FLOOR, 2);
  });

  it("lets a visitor walk down the semi-octagonal staircase from the orangery's north terrace", () => {
    const arrived = walk("terrace-north", { x: -16, z: -42 }, [{ x: -16, z: -40 }, { x: -16, z: -28 }, { x: -12, z: -24.5 }]);
    expect(arrived.room).toBe("stair-court");
    expect(arrived.floor).toBeCloseTo(FLOOR, 2);
  });

  it("lets a visitor walk down the semi-octagonal tiers from the garden parterre", () => {
    const arrived = walk("parterre", { x: -28, z: -24.5 }, [{ x: -25, z: -24.5 }, { x: -12, z: -24.5 }]);
    expect(arrived.room).toBe("stair-court");
    expect(arrived.floor).toBeCloseTo(FLOOR, 2);
  });

  it("lets a visitor cross the court from the terrace to the club's door", () => {
    // Down from terrace, into the court, in through the club door
    const arrived = walk("terrace", { x: -16, z: -5 }, [
      { x: -16, z: -21 }, { x: -11.5, z: -24.5 }, { x: -9, z: -24.5 },
    ]);
    expect(arrived.room).toBe("club");
    expect(arrived.visited).toEqual(["terrace", "stair-court", "club"]);
  });

  it("lets a visitor cross the court to the undercroft door at its north end", () => {
    const arrived = walk("terrace", { x: -16, z: -5 }, [
      { x: -16, z: -21 }, { x: -11.8, z: -24.5 }, { x: -11.8, z: -39 },
    ]);
    expect(arrived.room).toBe("foyer");
  });

  it("lets a visitor climb back out of the court onto both arms of the terrace", () => {
    const up = walk("stair-court", { x: -11.5, z: -24.5 }, [{ x: -16, z: -20.8 }, { x: -16, z: -9 }]);
    expect(up.room).toBe("terrace");
    const north = walk("stair-court", { x: -11.5, z: -24.5 }, [{ x: -16, z: -28 }, { x: -16, z: -40 }]);
    expect(north.room).toBe("terrace-north");
  });

  it("lets a visitor walk between terrace-north and terrace across the amphitheatre tiers", () => {
    const across = walk("terrace-north", { x: -16, z: -40 }, [{ x: -16, z: -24.5 }, { x: -16, z: -8 }]);
    expect(across.room).toBe("terrace");
  });

  it("walks the north arm past the orangery's flights without being pulled sideways", () => {
    const along = walk("terrace-north", { x: -15, z: -40 }, [{ x: -15, z: -74 }]);
    expect(along.room).toBe("terrace-north");
    expect(along.x).toBeCloseTo(-15, 1);
    expect(along.z).toBeLessThan(-73);
    const door = room("terrace-north").doorways
      .filter((d) => d.to === "orangery").sort((a, b) => b.center - a.center)[0]!;
    const close = walk("terrace-north", { x: -12.5, z: door.center + 3 }, [{ x: -12.5, z: -74 }]);
    const cheek = door.center + door.width / 2 + STAIR_MARGIN;
    expect(close.x).toBeCloseTo(-12.5, 1);
    expect(close.z).toBeGreaterThan(cheek);
    expect(close.z).toBeLessThan(cheek + 0.6);
  });
});
