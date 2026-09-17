import { describe, expect, it } from "vitest";
import mansionDocument from "../world/mansion.json";
import { parseMansion } from "../world/schema";
import { createInput } from "./input";
import { createBody, step, teleport } from "./locomotion";
import { reachableRooms } from "../world/navigation";

const mansion = parseMansion(mansionDocument);
const [first, second] = mansion.rooms;

function middle(room: NonNullable<typeof first>): [number, number] {
  return [(room.bounds.min[0] + room.bounds.max[0]) / 2, (room.bounds.min[2] + room.bounds.max[2]) / 2];
}

describe("a crossing survives until the frame loop acts on it", () => {
  it("keeps a teleport into another room through the step that follows it", () => {
    // In the frame loop the XR controls run BEFORE `step`. When `step` cleared
    // `crossedInto`, every teleport into another room was erased before
    // anything saw it: the body arrived, presence never joined, and the room
    // was never announced -- #19's phantom by another road.
    const body = createBody(...middle(first!), 0, first!.id);
    expect(teleport(body, mansion, ...middle(second!))).toBe(true);
    expect(body.crossedInto).toBe(second!.id);
    step(body, createInput(), 1 / 60, mansion);
    expect(body.crossedInto).toBe(second!.id);
  });

  it("does not invent a crossing for a teleport within the same room", () => {
    const body = createBody(...middle(first!), 0, first!.id);
    const [x, z] = middle(first!);
    teleport(body, mansion, x + 0.1, z);
    step(body, createInput(), 1 / 60, mansion);
    expect(body.crossedInto).toBeNull();
  });

  it("refuses a teleport into a locked room and reports no crossing", () => {
    const body = createBody(...middle(first!), 0, first!.id);
    expect(teleport(body, mansion, ...middle(second!), () => true)).toBe(false);
    expect(body.room).toBe(first!.id);
    expect(body.crossedInto).toBeNull();
  });
});

describe("a teleport under another room", () => {
  const mansion = parseMansion(mansionDocument);
  it("stays on its own storey, and goes to the room it names", () => {
    const body = createBody(0, -20, 0, "club", 1, -5);
    expect(teleport(body, mansion, 0, -40)).toBe(true);
    expect(body.room).toBe("club");
    expect(body.y).toBe(-5);
    const above = createBody(0, -36, 0, "orangery", 1, 1.5);
    expect(teleport(above, mansion, 0, -40)).toBe(true);
    expect(above.room).toBe("orangery");
    expect(above.y).toBe(1.5);
    expect(teleport(above, mansion, 0, -40, undefined, { walls: false, into: "club" })).toBe(true);
    expect(above.room).toBe("club");
    expect(above.crossedInto).toBe("club");
    expect(teleport(above, mansion, 0, -40, undefined, { walls: false, into: "hall" })).toBe(false);
  });
});

describe("a teleport goes only where a walk could", () => {
  const room = (id: string) => mansion.rooms.find((r) => r.id === id)!;
  const sealed = mansion.rooms.find((r) => r.doorways.length > 0 && r.doorways.every((d) => d.closed))!;
  const beside = room(sealed.doorways[0]!.to);

  it("has a room behind closed doors only, next to one a visitor stands in", () => {
    // The premise: without it the refusals below would pass for no reason.
    expect(sealed).toBeDefined();
    expect(reachableRooms(mansion, beside.id).has(sealed.id)).toBe(false);
  });

  it("refuses a teleport through a closed doorway", () => {
    const body = createBody(...middle(beside), 0, beside.id);
    expect(teleport(body, mansion, ...middle(sealed))).toBe(false);
    expect(body.room).toBe(beside.id);
    expect(body.crossedInto).toBeNull();
  });

  it("still lets the quality tour jump there, but never past a lock", () => {
    const body = createBody(...middle(beside), 0, beside.id);
    expect(teleport(body, mansion, ...middle(sealed), () => true, { walls: false })).toBe(false);
    expect(teleport(body, mansion, ...middle(sealed), undefined, { walls: false })).toBe(true);
    expect(body.room).toBe(sealed.id);
  });

  it("refuses a room reachable only through a locked one", () => {
    const hall = room("hall");
    const far = [...reachableRooms(mansion, hall.id)].find(
      (id) => id !== hall.id && !hall.doorways.some((d) => d.to === id),
    )!;
    const body = createBody(...middle(hall), 0, hall.id);
    const lockedRooms = new Set(hall.doorways.map((d) => d.to));
    expect(teleport(body, mansion, ...middle(room(far)), (id) => lockedRooms.has(id))).toBe(false);
    expect(teleport(body, mansion, ...middle(room(far)))).toBe(true);
  });
});

describe("a teleport named into a room", () => {
  const mansion = parseMansion(mansionDocument);
  it("lands in that room even where another room's floor lies over the same spot", () => {
    const body = createBody(0, -14, 0, "world-engine", 1, 1.5);
    const club = mansion.rooms.find((r) => r.id === "club")!;
    const moved = teleport(body, mansion, club.spawn.position[0], club.spawn.position[2], undefined, { into: "club", walls: false });
    expect(moved).toBe(true);
    expect(body.room).toBe("club");
    expect(body.y).toBeCloseTo(club.bounds.min[1]);
  });
});

