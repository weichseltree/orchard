import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { parseMansion } from "./schema";
import { bakeLightField, lightAt, litRooms } from "./lightfield";
import { emittersOf } from "./observatory";
import { sealedLens } from "./sealed";

// The light is baked out of the same document the rooms are built from, so
// these run over mansion.json: every room has lamps, the lamps light the
// walls beside them, a portal glows onto its garden, and nothing shines
// through a wall into a room that has no door to it.

const mansion = parseMansion(mansionDocument);
const emitters = emittersOf(mansion);
const field = bakeLightField(mansion, emitters);
const room = (id: string) => mansion.rooms.find((r) => r.id === id)!;
const brightness = (p: [number, number, number]) => Math.max(...p);

describe("emittersOf", () => {
  it("finds a lamp in every room of the palace's scale", () => {
    for (const r of litRooms(mansion)) {
      expect(emitters.some((e) => e.room === r.id), r.id).toBe(true);
    }
  });

  it("makes the garden's portal and every sealed door an emitter", () => {
    const portal = room("parterre").portals[0]!;
    expect(emitters.some((e) => e.room === "parterre" && e.x === portal.position[0] && e.z === portal.position[2] && e.power > 1)).toBe(true);
    for (const door of room("gallery").doorways.filter((d) => d.closed)) {
      const lens = sealedLens(room("gallery"), door)!;
      expect(emitters.some((e) => Math.abs(e.x - lens.center.x) < 1e-6 && Math.abs(e.z - lens.center.z) < 1e-6)).toBe(true);
    }
  });
});

describe("bakeLightField over mansion.json", () => {
  it("covers every lit room in a grid of a few hundred kilobytes", () => {
    const [nx, ny, nz] = field.cells;
    expect(nx * ny * nz * 4).toBeLessThan(1_500_000);
    for (const r of litRooms(mansion)) {
      for (const corner of [r.bounds.min, r.bounds.max]) {
        expect(corner[0]).toBeGreaterThanOrEqual(field.min.x);
        expect(corner[0]).toBeLessThanOrEqual(field.min.x + field.size.x);
        expect(corner[2]).toBeGreaterThanOrEqual(field.min.z);
        expect(corner[2]).toBeLessThanOrEqual(field.min.z + field.size.z);
      }
    }
  });

  it("lights the hall's walls at sconce height more than its floor at the centre", () => {
    const hall = room("hall");
    const wall = brightness(lightAt(field, hall.bounds.min[0] + 0.5, hall.bounds.min[1] + 2.6, 0));
    const floor = brightness(lightAt(field, 0, hall.bounds.min[1] + 0.2, 0));
    expect(wall).toBeGreaterThan(0.25);
    expect(wall).toBeGreaterThan(floor);
  });

  it("lights the hall's centre from the chandelier", () => {
    expect(brightness(lightAt(field, 0, 5, 0))).toBeGreaterThan(0.2);
  });

  it("glows round the garden's portal", () => {
    const portal = room("parterre").portals[0]!;
    const [r, g, b] = lightAt(field, portal.position[0], -1.2, portal.position[2] + 5);
    expect(Math.max(r, g, b)).toBeGreaterThan(0.2);
    // The portal's glass is cool: more blue than red on the gravel round it.
    expect(b).toBeGreaterThan(r);
  });

  // The bake is the slowest thing in the suite: quantumflow's wing took the grid
  // to 117 x 21 x 122 over 28 lit rooms, and the region pass is cells x rooms.
  // It lands near vitest's 5 s default, so it fails on a loaded runner unless
  // this says otherwise.
  it("keeps the hall's light out of the workshop, whose only door is closed", { timeout: 20_000 }, () => {
    // Bake without the workshop's own lamps: whatever remains inside would be the hall's.
    const withoutOwn = bakeLightField(mansion, emitters.filter((e) => e.room !== "greenhouse"));
    const [x0, y0, z0] = room("greenhouse").bounds.min, [x1, , z1] = room("greenhouse").bounds.max;
    for (let x = x0 + 1; x < x1; x += 2) for (let z = z0 + 1; z < z1; z += 2) {
      expect(brightness(lightAt(withoutOwn, x, y0 + 2, z)), `${x},${z}`).toBe(0);
    }
    // While the hall's side of that wall is lit.
    expect(brightness(lightAt(field, 9, 2, 7))).toBeGreaterThan(0.1);
    withoutOwn.dispose();
  });

  it("spills through an open doorway but fades", () => {
    // The hall's north door to world-engine at z = -12: light just inside world-engine, less a few metres on.
    const near = brightness(lightAt(field, 0, 3, -13));
    const far = brightness(lightAt(field, 0, 3, -20));
    expect(near).toBeGreaterThan(0);
    expect(near).toBeGreaterThanOrEqual(far);
  });

  it("reports how bright the rooms are", () => {
    const stats: Record<string, string> = {};
    for (const r of litRooms(mansion)) {
      const [x0, y0, z0] = r.bounds.min, [x1, , z1] = r.bounds.max;
      let sum = 0, n = 0, max = 0;
      for (let x = x0 + 1; x < x1; x += 2) for (let z = z0 + 1; z < z1; z += 2) {
        const v = brightness(lightAt(field, x, y0 + 1.6, z));
        sum += v; n++; max = Math.max(max, v);
      }
      stats[r.id] = `mean ${(sum / n).toFixed(2)} max ${max.toFixed(2)}`;
    }
    // Printed for tuning; the assertion is that no chamber is left dark at
    // eye height, and that every cell of the grounds has a lamp somewhere.
    console.info("light field at eye height:", JSON.stringify(stats));
    for (const [id, line] of Object.entries(stats)) {
      const [, mean, , max] = line.split(" ");
      if (room(id).fallback.kind === "ground") expect(Number(max), id).toBeGreaterThan(0.1);
      else expect(Number(mean), id).toBeGreaterThan(0.05);
    }
  });
});
