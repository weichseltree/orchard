import { describe, expect, it } from "vitest";
import mansionDocument from "../world/mansion.json";
import { parseMansion } from "../world/schema";
import { areaOf, areaRooms, clampView, floorConnectors, floorOfRoom, floorsOf, planPointOf, planProjection, planRooms, zoomView } from "./map";

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

  it("answers undefined for a room it does not hold, rather than the ground floor", () => {
    // `?? 0` here let floorConnectors read "not on this plan" as a storey
    // change and hang a stair glyph on rooms that join nothing.
    expect(floorOfRoom(floors, "nowhere")).toBeUndefined();
    expect(floorOfRoom(floors, mansion.start)).toBe(0);
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
    const club = floorOfRoom(floors, "club")!;
    const orangery = floorOfRoom(floors, "orangery")!;
    expect(club).toBeLessThan(orangery);
    // The orangery, the hall and the grounds are all one storey despite
    // standing at 1.5, 0 and -1.6 metres.
    expect(floorOfRoom(floors, "hall")).toBe(orangery);
    expect(floorOfRoom(floors, "orchard-west")).toBe(orangery);
  });

  it("marks exactly the rooms with a doorway to another storey", () => {
    const connectors = floorConnectors(mansion, floors);
    // Derived rather than named: which rooms join two storeys changes as the
    // building does, and the rule is what this test is for.
    const expected = rooms
      .filter((room) => room.doorways.some((door) => {
        if (door.closed) return false;
        const other = mansion.rooms.find((candidate) => candidate.id === door.to);
        return !!other && other.scale === room.scale
          && floorOfRoom(floors, other.id) !== undefined
          && floorOfRoom(floors, other.id) !== floorOfRoom(floors, room.id);
      }))
      .map((room) => room.id)
      .sort();
    expect([...connectors.keys()].sort()).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
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

describe("the viewport", () => {
  const full = { x: 0, y: 0, w: 320, h: 320 };

  it("keeps the window inside the plan, and never larger than it", () => {
    expect(clampView({ x: -50, y: -50, w: 320, h: 320 })).toEqual(full);
    expect(clampView({ x: 900, y: 900, w: 160, h: 160 })).toEqual({ x: 160, y: 160, w: 160, h: 160 });
    // A window taller than the plan is the plan, not a view off the top of it.
    expect(clampView({ x: 0, y: -128, w: 160, h: 448 })).toEqual({ x: 0, y: 0, w: 160, h: 320 });
  });

  it("holds the point it zooms about still under the cursor", () => {
    const zoomed = zoomView(full, 0.5, 80, 240);
    expect(zoomed.w).toBeCloseTo(160);
    // The plan point under the cursor before is the plan point under it after.
    expect(80 - zoomed.x).toBeCloseTo((80 - full.x) * (zoomed.w / full.w));
    expect(240 - zoomed.y).toBeCloseTo((240 - full.y) * (zoomed.h / full.h));
  });

  it("stops at four times in and at the whole plan out", () => {
    let view = full;
    for (let i = 0; i < 20; i += 1) view = zoomView(view, 0.5, 160, 160);
    expect(view.w).toBeCloseTo(80);
    for (let i = 0; i < 20; i += 1) view = zoomView(view, 2, 160, 160);
    expect(view).toEqual(full);
  });

  it("reads a screen point through the letterbox, not straight across the box", () => {
    // 382 x 322 is what `width:100%; max-height:52dvh` gives at 1280 x 620:
    // the square viewBox is centred with bars either side, so only the exact
    // middle maps the same either way.
    const box = { width: 382, height: 322 };
    const scale = Math.min(box.width / 320, box.height / 320);
    const bar = (box.width - 320 * scale) / 2;
    expect(planPointOf(box, full, box.width / 2, box.height / 2)!.x).toBeCloseTo(160);
    expect(planPointOf(box, full, bar, box.height / 2)!.x).toBeCloseTo(0);
    expect(planPointOf(box, full, box.width - bar, box.height / 2)!.x).toBeCloseTo(320);
    // Mapping straight across would have called the left edge 0 and the tenth
    // point 32; through the letterbox it is 8.3.
    const tenth = planPointOf(box, full, box.width * 0.1, box.height / 2)!;
    expect(tenth.x).toBeGreaterThan(0);
    expect(tenth.x).toBeLessThan(12);
  });

  it("gives no point at all for a box that has not been laid out", () => {
    // Guessing one would make the first move of a drag jump a whole window.
    expect(planPointOf({ width: 0, height: 0 }, full, 10, 10)).toBeNull();
  });
});
