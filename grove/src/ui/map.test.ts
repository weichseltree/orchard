import { describe, expect, it } from "vitest";
import mansionDocument from "../world/mansion.json";
import { parseMansion } from "../world/schema";
import { areaRooms, planProjection } from "./map";

const mansion = parseMansion(mansionDocument);

describe("which rooms the plan draws", () => {
  it("draws the palace's own rooms from the hall, without a tree's area or another scale", () => {
    const ids = areaRooms(mansion, "hall").map((room) => room.id);
    expect(ids).toContain("hall");
    expect(ids).toContain("gallery");
    expect(ids).not.toContain("orrery");
    expect(ids.some((id) => id.startsWith("arcedit"))).toBe(false);
  });

  it("draws a tree's area from any room of it, entrance included, at that room's scale", () => {
    // Read from the document rather than named: an area's rooms change as its repository does.
    const inner = mansion.rooms.find((room) => room.id.includes("/"))!;
    const tree = inner.id.split("/")[0]!;
    const ids = areaRooms(mansion, inner.id).map((room) => room.id);
    const expected = mansion.rooms
      .filter((room) => (room.id === tree || room.id.startsWith(`${tree}/`)) && room.scale === inner.scale)
      .map((room) => room.id);
    expect(ids).toEqual(expected);
    expect(ids).toContain(tree);
    expect(ids).not.toContain("gallery");
    expect(ids.every((id) => mansion.rooms.find((room) => room.id === id)!.scale === inner.scale)).toBe(true);
    expect(areaRooms(mansion, "nowhere")).toEqual([]);
  });
});

describe("planProjection", () => {
  it("fits the rooms inside the margin, centred, with one scale on both axes", () => {
    const rooms = areaRooms(mansion, "hall");
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
    // The palace is taller than wide: its height fills the box, its width is centred.
    const minX = Math.min(...rooms.map((r) => r.bounds.min[0]));
    const maxX = Math.max(...rooms.map((r) => r.bounds.max[0]));
    expect(project.x(minX) + project.x(maxX)).toBeCloseTo(size);
  });
});
