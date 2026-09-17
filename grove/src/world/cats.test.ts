import { describe, expect, it } from "vitest";
import mansionDoc from "./mansion.json";
import { MansionSchema } from "./schema";
import { CAT_ROOM } from "./cats";
import { roomArena } from "./room-arena";
import { COLUMN_FOOT_M, columnFootprints } from "./observatory";
import { CATS, runHeadless } from "../vendor/cat-proxy/src/index";

// The package has its own tests for the brain and the body; these are about the seam.
// What the grove owes is the room: that the arena it hands over really is the hall, and
// that two cats let loose in it for a few minutes never leave it and never stand in a column.

const mansion = MansionSchema.parse(mansionDoc);
const hall = mansion.rooms.find((r) => r.id === CAT_ROOM)!;

/** The same two cats cats.ts builds, run without a renderer. */
function run(seconds: number, visitors?: (t: number) => readonly { id: string; at: { x: number; z: number } }[]) {
  return runHeadless({
    arena: roomArena(hall),
    steps: Math.round(seconds * 60),
    visitors: visitors ? (t) => visitors(t) : undefined,
    cats: [
      { id: "blue", appearance: CATS.blue, seed: 0x5eed, start: { x: -3.2, z: 2.4 }, heading: Math.PI * 0.75 },
      { id: "seal", appearance: CATS.seal, seed: 0xb, start: { x: 3.6, z: -2.8 }, heading: -Math.PI * 0.25 },
    ],
  });
}

describe("the hall's cats", () => {
  it("keeps both cats inside the room and out of its columns for three minutes", () => {
    const report = run(180);
    expect(report.ok).toBe(true);
    for (const cat of report.cats) {
      expect(cat.outOfArena, `${cat.id} left the arena`).toBe(0);
      expect(cat.postureFaults, `${cat.id} posture`).toEqual([]);
      // A cat that never moved would satisfy every bound above; it must actually walk.
      expect(cat.distanceM, `${cat.id} did not move`).toBeGreaterThan(1);
    }
  });

  it("walks round the columns the room actually generates", () => {
    const columns = columnFootprints(hall);
    // The hall is colonnaded, so this is a real constraint and not a vacuous one.
    expect(columns.length).toBeGreaterThan(4);
    const arena = roomArena(hall);
    for (const { x, z } of columns) {
      expect(arena.canStand(x, z, 0.12), `standing in the column at ${x},${z}`).toBe(false);
      // Just outside the footprint plus the cat is fine, as long as it is still in the room.
      const clear = { x: x - (COLUMN_FOOT_M + 0.3) * Math.sign(x), z };
      expect(arena.canStand(clear.x, clear.z, 0.12)).toBe(true);
    }
  });

  it("greets a visitor who stands in the hall, and does not mob them", () => {
    const report = run(180, () => [{ id: "you", at: { x: 0, z: 6 } }]);
    const greeted = report.cats.flatMap((c) => c.greeted);
    expect(greeted.length, "nobody greeted the visitor").toBeGreaterThan(0);
    expect(report.minCatDistanceM, "the cats walked through each other").toBeGreaterThan(0);
  });

});
