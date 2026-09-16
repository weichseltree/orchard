import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { BODY_RADIUS, DOOR_SHOULDER, inAperture, insideRoom, resolveMove, roomAt } from "./navigation";
import { parseMansion, type Doorway } from "./schema";
import { wallPieces } from "./rooms";

// "Never let the camera pass through walls in M0 beyond a simple AABB clamp
// per room" — so the clamp is what gets the test.

const mansion = parseMansion(mansionDocument);
const hall = mansion.rooms[0]!;
const einstruct = mansion.rooms[1]!;

describe("resolveMove", () => {
  it("keeps a step inside the room, a body radius off the wall", () => {
    const out = resolveMove(mansion, "hall", { x: 0, z: 0 }, { x: 99, z: 0 });
    expect(out.x).toBeCloseTo(hall.bounds.max[0] - BODY_RADIUS);
    expect(out.room).toBe("hall");
    expect(out.crossed).toBe(false);
    // Straight ahead in z is the phototroph doorway now; step at x = 5, off the opening.
    const back = resolveMove(mansion, "hall", { x: 5, z: 0 }, { x: 5, z: 99 });
    expect(back.z).toBeCloseTo(hall.bounds.max[2] - BODY_RADIUS);
  });

  it("does not let a step through the wall the doorway is in, away from the opening", () => {
    const out = resolveMove(mansion, "hall", { x: 5, z: -9 }, { x: 5, z: -12 });
    expect(out.z).toBeCloseTo(hall.bounds.min[2] + BODY_RADIUS);
    expect(out.room).toBe("hall");
  });

  it("lets a step through the opening and hands over the room", () => {
    const out = resolveMove(mansion, "hall", { x: 0, z: -9.5 }, { x: 0, z: -10.5 });
    expect(out.room).toBe("einstruct");
    expect(out.crossed).toBe(true);
    expect(out.z).toBeCloseTo(-10.5);
  });

  it("treats a locked doorway as the wall it is in, and says which room locked it", () => {
    // Same step as the crossing above. The door is the only difference.
    const out = resolveMove(mansion, "hall", { x: 0, z: -9.5 }, { x: 0, z: -10.5 }, BODY_RADIUS, (id) => id === "einstruct");
    expect(out.room).toBe("hall");
    expect(out.crossed).toBe(false);
    expect(out.z).toBeCloseTo(hall.bounds.min[2] + BODY_RADIUS);
    expect(out.locked).toBe("einstruct");
  });

  it("reports a lock only while the body is walking into that doorway", () => {
    // Standing at the far wall of the hall with the same room locked: the
    // visitor is not being stopped by it, so there is nothing to tell them.
    const away = resolveMove(mansion, "hall", { x: 5, z: 0 }, { x: 5, z: 1 }, BODY_RADIUS, (id) => id === "einstruct");
    expect(away.locked).toBeNull();
  });

  it("leaves every other doorway open when one room is locked", () => {
    const out = resolveMove(mansion, "hall", { x: 0, z: -9.5 }, { x: 0, z: -10.5 }, BODY_RADIUS, (id) => id === "cellar");
    expect(out.room).toBe("einstruct");
    expect(out.crossed).toBe(true);
    expect(out.locked).toBeNull();
  });

  it("crosses back the other way", () => {
    const out = resolveMove(mansion, "einstruct", { x: 0, z: -10.4 }, { x: 0, z: -9.6 });
    expect(out.room).toBe("hall");
    expect(out.crossed).toBe(true);
  });

  it("refuses a sideways slide that starts outside the opening", () => {
    // Lined up with the doorway at the destination but not at the start:
    // sliding along the wall must not pop the body through it.
    const outside = hall.doorways[0]!.width / 2 + BODY_RADIUS;
    const out = resolveMove(mansion, "hall", { x: outside, z: -9.7 }, { x: 0.2, z: -10.2 });
    expect(out.room).toBe("hall");
    expect(out.z).toBeCloseTo(hall.bounds.min[2] + BODY_RADIUS);
  });

  it("only opens across the passable part of the opening", () => {
    const limit = hall.doorways[0]!.width / 2 - BODY_RADIUS - DOOR_SHOULDER;
    const inside = resolveMove(mansion, "hall", { x: limit - 0.05, z: -9.6 }, { x: limit - 0.05, z: -10.4 });
    expect(inside.room).toBe("einstruct");
    expect(inside.x).toBeLessThanOrEqual(einstruct.bounds.max[0] - BODY_RADIUS + 1e-9);
    const edge = resolveMove(mansion, "hall", { x: limit + 0.05, z: -9.6 }, { x: limit + 0.05, z: -10.4 });
    expect(edge.room).toBe("hall");
    expect(edge.z).toBeCloseTo(hall.bounds.min[2] + BODY_RADIUS);
  });

  it("is a no-op for an unknown room rather than throwing in the frame loop", () => {
    const out = resolveMove(mansion, "cellar", { x: 0, z: 0 }, { x: 3, z: 4 });
    expect(out).toMatchObject({ x: 3, z: 4, room: "cellar", crossed: false });
  });
});

describe("apertures and rooms", () => {
  const door: Doorway = { to: "einstruct", axis: "z", at: -10, center: 0, width: 2.4, height: 3.2, closed: false };

  it("is only passable across the opening, minus shoulders", () => {
    expect(inAperture(door, 0, BODY_RADIUS)).toBe(true);
    expect(inAperture(door, 0.6, BODY_RADIUS)).toBe(true);
    expect(inAperture(door, 1.2, BODY_RADIUS)).toBe(false);
    expect(inAperture({ ...door, width: 0.4 }, 0, BODY_RADIUS)).toBe(false);
  });

  it("finds the room a point is in", () => {
    expect(roomAt(mansion, 0, 0)?.id).toBe("hall");
    expect(roomAt(mansion, 0, -15)?.id).toBe("einstruct");
    expect(roomAt(mansion, 40, 0)).toBeUndefined();
    expect(insideRoom(hall, 6.9, 0, BODY_RADIUS)).toBe(false);
  });
});

describe("wallPieces", () => {
  it("returns one piece for a blank wall", () => {
    const pieces = wallPieces(-7, 7, 0, 7, []);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ centre: 0, length: 14, height: 7 });
  });

  it("cuts two jambs and a lintel around a doorway", () => {
    const door: Doorway = { to: "x", axis: "z", at: -10, center: 0, width: 2.4, height: 3.2, closed: false };
    const pieces = wallPieces(-7, 7, 0, 7, [door]);
    expect(pieces).toHaveLength(3);
    const lintel = pieces.find((p) => p.length === 2.4)!;
    expect(lintel.height).toBeCloseTo(7 - 3.2);
    expect(lintel.centreY).toBeCloseTo(3.2 + (7 - 3.2) / 2);
    const total = pieces
      .filter((p) => p.height === 7)
      .reduce((sum, p) => sum + p.length, 0);
    expect(total).toBeCloseTo(14 - 2.4);
  });

  it("leaves no lintel when the opening is the full height", () => {
    const door: Doorway = { to: "x", axis: "z", at: 0, center: 0, width: 2, height: 5, closed: false };
    expect(wallPieces(-5, 5, 0, 5, [door])).toHaveLength(2);
  });
});
