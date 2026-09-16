import { describe, expect, it } from "vitest";
import mansionDocument from "../world/mansion.json";
import { parseMansion } from "../world/schema";
import { createInput } from "./input";
import { createBody, step, teleport } from "./locomotion";

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
