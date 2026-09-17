import { describe, expect, it } from "vitest";
import mansionDocument from "../world/mansion.json";
import { parseMansion } from "../world/schema";
import { areaOf, areaRooms, floorConnectors, floorOfRoom, floorsOf, planProjection, planRooms } from "./map";

const mansion = parseMansion(mansionDocument);

describe("which rooms the plan draws", () => {
  it("draws the whole world at the visitor's scale, so the palace is on the plan from inside a tree", () => {
    // The bug of 2026-09-17: from inside arcedit the plan drew arcedit alone,
    // and the way back to the palace was on no plan the visitor could open.
    const inner = mansion.rooms.find((room) => room.id.includes("/"))!;
    const ids = planRooms(mansion, inner.id).map((room) => room.id);
    expect(ids).toContain(mansion.start);
    expect(ids).toContain(inner.id);
    expect(ids).toContain(inner.id.split("/")[0]);
    expect(planRooms(mansion, "nowhere")).toEqual([]);
  });

  it("keeps the scales apart, because rooms of two scales share coordinates but never a floor plan", () => {
    const scales = new Set(planRooms(mansion, mansion.start).map((room) => room.scale));
    expect(scales).toEqual(new Set([mansion.rooms.find((room) => room.id === mansion.start)!.scale]));
    const other = mansion.rooms.find((room) => room.scale !== 1);
    if (other) expect(planRooms(mansion, mansion.start).map((room) => room.id)).not.toContain(other.id);
  });

  it("still groups a tree's area for the menu, entrance included", () => {
    const inner = mansion.rooms.find((room) => room.id.includes("/"))!;
    const tree = inner.id.split("/")[0]!;
    const ids = areaRooms(mansion, inner.id).map((room) => room.id);
    expect(ids).toContain(tree);
    expect(ids).not.toContain("gallery");
    expect(areaOf(mansion, mansion.rooms.find((room) => room.id === mansion.start)!)).toBe("");
    expect(areaOf(mansion, inner)).toBe(tree);
  });
});

describe("floors", () => {
  const rooms = planRooms(mansion, mansion.start);
  const floors = floorsOf(mansion, rooms);

  it("puts every room on exactly one floor", () => {
    const placed = floors.flatMap((floor) => floor.rooms.map((room) => room.id));
    expect(placed.slice().sort()).toEqual(rooms.map((room) => room.id).sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("separates the storeys the building has, and calls the start room's floor the ground", () => {
    // The cellar (the club and the stage) stacks under the orangery; drawn on
    // one plan they lay on top of each other, which is what the picker fixes.
    expect(floors.length).toBeGreaterThan(1);
    expect(floorOfRoom(floors, mansion.start)).toBe(0);
    expect(floors.find((floor) => floor.level === 0)?.label).toBe("Ground");
    // Lowest first, and no two floors within a storey of each other.
    for (let i = 1; i < floors.length; i += 1) {
      expect(floors[i]!.y).toBeGreaterThan(floors[i - 1]!.y);
      expect(floors[i]!.level).toBe(floors[i - 1]!.level + 1);
    }
  });

  it("keeps rooms of one storey together, and the stacked pair apart", () => {
    const club = floorOfRoom(floors, "club");
    const orangery = floorOfRoom(floors, "orangery");
    expect(club).toBeLessThan(orangery);
    // The orangery, the hall and the grounds are all one storey despite
    // standing at 1.5, 0 and -1.6 metres.
    expect(floorOfRoom(floors, "hall")).toBe(orangery);
    expect(floorOfRoom(floors, "orchard-west")).toBe(orangery);
  });

  it("marks the rooms that join two floors, and only those", () => {
    const connectors = floorConnectors(mansion, floors);
    // The two stair rooms are the only cross-floor doorways in the palace.
    expect([...connectors.keys()].sort()).toEqual(["orchard-east", "orchard-west", "stair-north", "stair-south"]);
    for (const [id, levels] of connectors) {
      expect(levels).not.toContain(floorOfRoom(floors, id));
      expect(levels.length).toBeGreaterThan(0);
    }
  });
});

describe("planProjection", () => {
  it("fits the rooms inside the margin, centred, with one scale on both axes", () => {
    const rooms = areaRooms(mansion, mansion.start);
    const size = 320;
    const project = planProjection(rooms, size, size, 12);
    for (const room of rooms) {
      for (const x of [room.bounds.min[0], room.bounds.max[0]]) {
        expect(project.x(x)).toBeGreaterThanOrEqual(12 - 1e-9);
        expect(project.x(x)).toBeLessThanOrEqual(size - 12 + 1e-9);
      }
      for (const z of [room.bounds.min[2], room.bounds.max[2]]) {
        expect(project.y(z)).toBeGreaterThanOrEqual(12 - 1e-9);
        expect(project.y(z)).toBeLessThanOrEqual(size - 12 + 1e-9);
      }
    }
    // Metres are metres both ways, and +z runs down the page.
    expect(project.x(10) - project.x(0)).toBeCloseTo(10 * project.scale);
    expect(project.y(10) - project.y(0)).toBeCloseTo(10 * project.scale);
    const minX = Math.min(...rooms.map((r) => r.bounds.min[0]));
    const maxX = Math.max(...rooms.map((r) => r.bounds.max[0]));
    expect(project.x(minX) + project.x(maxX)).toBeCloseTo(size);
  });

  it("projects every floor through one transform, so a room does not move when the picker changes", () => {
    const all = floorsOf(mansion, planRooms(mansion, mansion.start)).flatMap((floor) => floor.rooms);
    const project = planProjection(all, 320, 320);
    const club = mansion.rooms.find((room) => room.id === "club")!;
    const orangery = mansion.rooms.find((room) => room.id === "orangery")!;
    // They stack, so on the plan they overlap — which is why they are drawn apart.
    expect(project.x(club.bounds.min[0])).toBeCloseTo(project.x(orangery.bounds.min[0]));
  });
});
