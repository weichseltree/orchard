import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { hangingBounds } from "./tape-exhibit";
import { parseMansion, roomById } from "./schema";

// Ruling, 2026-09-12: a 2D tape lies horizontal — the tape's thin axis maps to
// world up — and the sheet is centred 1.0 m above the floor. A 3D tape keeps
// its authored orientation and 1.2 m. Before the review the client parsed
// `rotationDeg` and ignored it, so this is the test that says it does not.

const AB_D2_BOX = [632.4555320336759, 632.4555320336759, 1] as const;

describe("hangingBounds", () => {
  it("lays a 2D tape flat, 6 m across, centred a metre up", () => {
    const bounds = hangingBounds(AB_D2_BOX, 6, [0, 1.0, -15.4], [-90, 0, 0]);
    const size = bounds.getSize(bounds.max.clone());
    expect(size.x).toBeCloseTo(6, 3);
    expect(size.z).toBeCloseTo(6, 3);
    // The thin axis (Lz = 1 against a 632 m box) is now up, and it is thin.
    expect(size.y).toBeLessThan(0.02);
    const centre = hangingBounds(AB_D2_BOX, 6, [0, 1.0, -15.4], [-90, 0, 0]).getCenter(
      bounds.min.clone(),
    );
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.y).toBeCloseTo(1.0, 6);
    expect(centre.z).toBeCloseTo(-15.4, 6);
  });

  it("keeps a 3D tape upright and unrotated", () => {
    const bounds = hangingBounds([10, 10, 10], 6, [0, 1.2, 0], [0, 0, 0]);
    const size = bounds.getSize(bounds.max.clone());
    expect(size.x).toBeCloseTo(6, 6);
    expect(size.y).toBeCloseTo(6, 6);
    expect(size.z).toBeCloseTo(6, 6);
  });

  it("puts the einstruct sheet inside the room, clear of the floor and the walls", () => {
    const mansion = parseMansion(mansionDocument);
    const room = roomById(mansion, "einstruct")!;
    const tape = room.hangings.find((h) => h.kind === "tape")!;
    const bounds = hangingBounds(AB_D2_BOX, tape.longSideMeters, tape.position, tape.rotationDeg);
    expect(bounds.min.x).toBeGreaterThanOrEqual(room.bounds.min[0]);
    expect(bounds.max.x).toBeLessThanOrEqual(room.bounds.max[0]);
    expect(bounds.min.z).toBeGreaterThanOrEqual(room.bounds.min[2]);
    expect(bounds.max.z).toBeLessThanOrEqual(room.bounds.max[2]);
    // Nothing below the floor any more: that was the point of the ruling.
    expect(bounds.min.y).toBeGreaterThan(0);
    expect(bounds.max.y).toBeLessThan(room.bounds.max[1]);
    // Waist height on a 1.6 m eye, and you can walk right up to it.
    expect(bounds.max.y).toBeLessThan(1.6);
  });

  it("puts the pedestal at the near edge of the sheet", () => {
    const mansion = parseMansion(mansionDocument);
    const room = roomById(mansion, "einstruct")!;
    const tape = room.hangings.find((h) => h.kind === "tape")!;
    const bounds = hangingBounds(AB_D2_BOX, tape.longSideMeters, tape.position, tape.rotationDeg);
    expect(tape.pedestal).toBeDefined();
    expect(tape.pedestal!.position[2]).toBeCloseTo(bounds.max.z, 2);
    // And in front of it, between the spawn and the sheet.
    expect(tape.pedestal!.position[2]).toBeLessThan(room.spawn.position[2]);
  });
});
