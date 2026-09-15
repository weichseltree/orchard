import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { parseMansion } from "./schema";
import { PORTAL_CORE, blendAt, crossPortal, farEye, portalEnds } from "./portal";
import { neighbourhood } from "./world";

// A portal is a blend between two scales, entered only from the room and the
// scale it was built for. The Meridian Garden's armillary leads to the
// Orrery, whose metre is a fiftieth of the garden's.

const mansion = parseMansion(mansionDocument);
const ends = portalEnds(mansion);
const garden = ends.find((end) => end.room === "parterre")!;
const orrery = ends.find((end) => end.room === "orrery")!;

describe("portalEnds", () => {
  it("makes two ends of the armillary, twins of each other, with inverse ratios", () => {
    expect(ends).toHaveLength(2);
    expect(garden.twin).toBe(orrery);
    expect(orrery.twin).toBe(garden);
    expect(garden.to).toBe("orrery");
    expect(garden.ratio).toBeCloseTo(50);
    expect(orrery.ratio).toBeCloseTo(0.02);
    expect(garden.exit).toEqual(orrery.center);
    expect(orrery.exit).toEqual(garden.center);
  });

  it("sits under the garden's armillary at eye height and lands on the Orrery's ring", () => {
    expect(garden.center.toArray()).toEqual([-35, 1.6, 0]);
    const landing = mansion.rooms.find((r) => r.id === "orrery")!.spawn.position;
    expect(orrery.center.x).toBe(landing[0]);
    expect(orrery.center.z).toBe(landing[2]);
  });
});

describe("blendAt", () => {
  it("is 0 outside the sphere, 1 inside its core, and climbs between", () => {
    expect(garden.radius).toBe(4.5);
    expect(blendAt(garden, new Vector3(-35 + 4.5, 1.6, 0))).toBe(0);
    expect(blendAt(garden, new Vector3(-35 + 6, 1.6, 0))).toBe(0);
    expect(blendAt(garden, new Vector3(-35 + 4.5 * PORTAL_CORE, 1.6, 0))).toBe(1);
    expect(blendAt(garden, new Vector3(-35, 1.6, 0))).toBe(1);
    const half = blendAt(garden, new Vector3(-35 + 4.5 * (1 + PORTAL_CORE) / 2, 1.6, 0));
    expect(half).toBeCloseTo(0.5);
  });
});

describe("crossPortal", () => {
  const eyeAtCentre = new Vector3(-35, 1.6, 0);

  it("steps a garden body at the core through to the Orrery, keeping its offset from the centre", () => {
    const crossing = crossPortal(garden, { room: "parterre", scale: 1, x: -34.6, z: 0.2 }, eyeAtCentre)!;
    expect(crossing.room).toBe("orrery");
    expect(crossing.scale).toBe(0.02);
    expect(crossing.x).toBeCloseTo(0.4);
    expect(crossing.z).toBeCloseTo(-399.8);
  });

  it("refuses a body in another room, or at the wrong scale, even at the centre", () => {
    expect(crossPortal(garden, { room: "terrace", scale: 1, x: -35, z: 0 }, eyeAtCentre)).toBeNull();
    expect(crossPortal(garden, { room: "parterre", scale: 0.02, x: -35, z: 0 }, eyeAtCentre)).toBeNull();
  });

  it("refuses an eye that is only in the blend, not the core", () => {
    expect(crossPortal(garden, { room: "parterre", scale: 1, x: -32, z: 0 }, new Vector3(-32, 1.6, 0))).toBeNull();
  });

  it("brings an Orrery body back to the garden", () => {
    const back = crossPortal(orrery, { room: "orrery", scale: 0.02, x: 0, z: -400 }, new Vector3(0, 1.6, -400));
    expect(back).not.toBeNull();
    expect(back!.room).toBe("parterre");
    expect(back!.scale).toBe(1);
    expect(back!.x).toBeCloseTo(-35);
    expect(back!.z).toBeCloseTo(0);
  });
});

describe("farEye", () => {
  it("stands the far camera fifty Orrery metres out per garden metre from the centre, and one at the core", () => {
    const eye = new Vector3(-35 + 2, 1.6, 0);
    expect(farEye(garden, eye, 0).toArray()).toEqual([100, 1.6, -400]);
    expect(farEye(garden, eye, 1).toArray()).toEqual([2, 1.6, -400]);
    // Halfway in, the scale is the geometric mean.
    expect(farEye(garden, eye, 0.5).x).toBeCloseTo(2 * Math.sqrt(50));
  });

  it("from the Orrery the garden is seen from the armillary's centre, a fiftieth of the walk away", () => {
    const eye = new Vector3(2, 1.6, -400);
    expect(farEye(orrery, eye, 0).x).toBeCloseTo(-35 + 0.04);
    expect(farEye(orrery, eye, 0).z).toBeCloseTo(0);
  });
});

describe("the Orrery in the document", () => {
  it("is the one room at another scale, in space, with spectre's worlds cut toward the landing", () => {
    const room = mansion.rooms.find((r) => r.id === "orrery")!;
    expect(room.scale).toBe(0.02);
    // Through the portal, every world is a globe inside the armillary's blend sphere.
    const portal = mansion.rooms.find((r) => r.id === "parterre")!.portals[0]!;
    for (const world of (room.hangings[0] as { worlds: { position: number[] }[] }).worlds) {
      const [x, y, z] = world.position as [number, number, number];
      const shrunk = Math.hypot(x - portal.exit.position[0], y - portal.exit.position[1], z - portal.exit.position[2]) * room.scale;
      expect(shrunk + 40 * room.scale).toBeLessThan(portal.radius);
    }
    expect(room.architecture).toBe("space");
    expect(room.doorways).toEqual([]);
    // Not a cell of the grounds: the hall's neighbourhood must not pull it in with the gardens.
    expect(room.fallback.kind).toBe("box");
    expect(mansion.rooms.filter((r) => r.scale !== 1)).toEqual([room]);
    const planet = room.hangings[0]!;
    expect(planet.kind).toBe("planet");
    if (planet.kind !== "planet") return;
    expect(planet.radiusMeters).toBe(40);
    expect(planet.worlds.map((w) => w.world)).toEqual(["adiabat-chi0", "adiabat-chi6", "adiabat-chi12"]);
    for (const world of planet.worlds) {
      expect(world.cutToward).toEqual([0, 1.6, -400]);
      // Each world clears the walking plane and stays inside the star dome.
      expect(world.position[1] - planet.radiusMeters).toBeGreaterThan(5);
      expect(Math.hypot(world.position[0], world.position[2] + 400)).toBeLessThan(200);
    }
  });

  it("is a neighbour of the garden through the portal, both ways, and the garden's cells come with it", () => {
    expect(neighbourhood(mansion, "parterre")).toContain("orrery");
    const fromOrrery = neighbourhood(mansion, "orrery");
    for (const id of ["parterre", "terrace", "orchard-west", "orchard-south", "orchard-east"]) expect(fromOrrery).toContain(id);
    expect(fromOrrery).not.toContain("hall");
    // Two doorways from the hall do not reach the garden's portal.
    expect(neighbourhood(mansion, "hall")).not.toContain("orrery");
  });

  it("has no floating world outside any more", () => {
    for (const room of mansion.rooms) {
      for (const hanging of room.hangings) {
        if (hanging.kind !== "tape") continue;
        expect(hanging.id, `${room.id}/${hanging.id}`).not.toBe("moon");
        expect(hanging.longSideMeters).toBeLessThan(10);
      }
    }
  });
});

describe("MansionSchema portals", () => {
  const base = () => ({
    schema: "orchard/mansion/1", start: "a",
    rooms: [
      { id: "a", presence: "a", bounds: { min: [0, 0, 0], max: [10, 4, 10] }, spawn: { position: [5, 0, 5] } },
      { id: "b", presence: "b", scale: 0.1, bounds: { min: [100, 0, 0], max: [110, 4, 10] }, spawn: { position: [105, 0, 5] } },
    ],
  });
  const portal = (extra = {}) => ({ id: "p", to: "b", position: [5, 1.6, 5], exit: { position: [105, 1.6, 5] }, ...extra });

  it("accepts a portal between two scales with both ends inside their rooms", () => {
    const doc = base();
    (doc.rooms[0] as { portals?: unknown[] }).portals = [portal()];
    expect(() => parseMansion(doc)).not.toThrow();
  });

  it("rejects a portal between rooms of one scale: that is a doorway", () => {
    const doc = base();
    (doc.rooms[1] as { scale?: number }).scale = 1;
    (doc.rooms[0] as { portals?: unknown[] }).portals = [portal()];
    expect(() => parseMansion(doc)).toThrow(/same scale/);
  });

  it("rejects an end outside its room, and a destination that does not exist", () => {
    const doc = base();
    (doc.rooms[0] as { portals?: unknown[] }).portals = [portal({ position: [50, 1.6, 5] })];
    expect(() => parseMansion(doc)).toThrow(/is outside/);
    const doc2 = base();
    (doc2.rooms[0] as { portals?: unknown[] }).portals = [portal({ exit: { position: [5, 1.6, 5] } })];
    expect(() => parseMansion(doc2)).toThrow(/exits outside/);
    const doc3 = base();
    (doc3.rooms[0] as { portals?: unknown[] }).portals = [portal({ to: "c" })];
    expect(() => parseMansion(doc3)).toThrow(/unknown room/);
  });
});
