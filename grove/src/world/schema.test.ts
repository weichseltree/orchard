import { describe, expect, it } from "vitest";
import { z } from "zod";
import mansionDocument from "./mansion.json";
import { BundleRefSchema, MansionSchema, parseMansion, roomById, type Doorway, type Room } from "./schema";

// mansion.json is the one scene document; a bad edit has to fail here, at
// boot, rather than as a missing wall three rooms later.

function doc(): Record<string, unknown> {
  return structuredClone(mansionDocument) as Record<string, unknown>;
}

describe("mansion.json", () => {
  it("parses", () => {
    const mansion = parseMansion(mansionDocument);
    expect(mansion.schema).toBe("orchard/mansion/1");
    expect(mansion.rooms.map((room) => room.id)).toEqual(["hall", "einstruct", "world-engine", "orangery", "phototroph", "gallery", "spectre", "greenhouse", "terrace", "parterre", "orchard-west", "orchard-south", "orchard-east"]);
    expect(mansion.start).toBe("hall");
  });

  it("describes the hall the spec asks for: 14 x 20 x 7 m with a 2.4 x 3.2 m doorway", () => {
    const hall = roomById(parseMansion(mansionDocument), "hall");
    expect(hall).toBeDefined();
    const { min, max } = hall!.bounds;
    expect(max[0] - min[0]).toBeCloseTo(14);
    expect(max[1] - min[1]).toBeCloseTo(7);
    expect(max[2] - min[2]).toBeCloseTo(20);
    expect(hall!.presence).toBe("grove");
    // The palace: the einstruct door, the phototroph door in the once-blank back
    // wall, and the greenhouse door, closed to visitors.
    expect(hall!.doorways).toHaveLength(5);
    expect(hall!.doorways[0]).toMatchObject({ to: "einstruct", width: 2.4, height: 3.2 });
    expect(hall!.doorways.find((d) => d.to === "greenhouse")).toMatchObject({ closed: true });
  });

  it("hangs a still on the hall's poster wall, taken from the exhibit table", () => {
    const hall = roomById(parseMansion(mansionDocument), "hall")!;
    expect(hall.hangings).toHaveLength(1);
    const still = hall.hangings[0]!;
    expect(still.kind).toBe("still");
    if (still.kind !== "still") return;
    expect(still.marker).toBe("poster_wall");
    expect(still.bundle.exhibit).toEqual({ tree: "einstruct", kind: "still", bundle: "" });
    expect([still.widthMeters, still.heightMeters]).toEqual([6, 3.4]);
  });

  it("describes einstruct as a 14 x 12 x 6 m state room with two tape sheets and two video walls", () => {
    const room = roomById(parseMansion(mansionDocument), "einstruct");
    const { min, max } = room!.bounds;
    expect([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).toEqual([14, 6, 12]);
    expect(room!.presence).toBe("einstruct");
    const kinds = room!.hangings.map((h) => h.kind).sort();
    expect(kinds).toEqual(["tape", "tape", "video", "video"]);
    // The segregation tape and its stirred twin (ruling 2026-09-12), each 6 m,
    // either side of the enfilade line, pinned to their own bundles.
    const tapes = room!.hangings.filter((h) => h.kind === "tape");
    expect(tapes.map((h) => h.bundle.exhibit?.bundle)).toEqual(["2dd0038799b2db15", "903d0c5a939b0ba1"]);
    expect(tapes.map((h) => h.position[0])).toEqual([-3.6, 3.6]);
    expect(room!.doorways.map((d) => d.to).sort()).toEqual(["hall", "spectre", "world-engine"]);
    const tape = tapes[0];
    expect(tape).toMatchObject({ longSideMeters: 6 });
    expect(tape!.position[1]).toBeCloseTo(1.0);
    expect(tape!.rotationDeg).toEqual([-90, 0, 0]);
  });

  it("puts every room's spawn inside its own bounds", () => {
    for (const room of parseMansion(mansionDocument).rooms) {
      const [x, , z] = room.spawn.position;
      expect(x).toBeGreaterThan(room.bounds.min[0]);
      expect(x).toBeLessThan(room.bounds.max[0]);
      expect(z).toBeGreaterThan(room.bounds.min[2]);
      expect(z).toBeLessThan(room.bounds.max[2]);
    }
  });
});

describe("MansionSchema", () => {
  it("rejects a doorway to a room that does not exist", () => {
    const broken = doc();
    (broken.rooms as Array<Record<string, unknown>>)[0]!.doorways = [
      { to: "cellar", axis: "z", at: -10, center: 0, width: 2, height: 2 },
    ];
    expect(() => MansionSchema.parse(broken)).toThrow(/doorway to unknown room/);
  });

  it("rejects a start room that is not in the list", () => {
    const broken = doc();
    broken.start = "nowhere";
    expect(() => MansionSchema.parse(broken)).toThrow(/start room/);
  });

  it("rejects duplicate room ids", () => {
    const broken = doc();
    const rooms = broken.rooms as Array<Record<string, unknown>>;
    rooms.push(structuredClone(rooms[0]!));
    expect(() => MansionSchema.parse(broken)).toThrow(/duplicate room id/);
  });

  it("rejects inverted bounds", () => {
    const broken = doc();
    (broken.rooms as Array<Record<string, unknown>>)[0]!.bounds = {
      min: [1, 0, 1],
      max: [-1, 7, 10],
    };
    expect(() => MansionSchema.parse(broken)).toThrow(/bounds.max/);
  });

  it("rejects an unknown hanging kind", () => {
    const broken = doc();
    (broken.rooms as Array<{ hangings: unknown[] }>)[1]!.hangings = [
      { id: "x", kind: "splat", bundle: { path: "/x/" }, position: [0, 0, 0] },
    ];
    expect(() => MansionSchema.parse(broken)).toThrow();
  });

  it("keeps fields it does not know about, so a newer document still loads", () => {
    const forward = doc();
    (forward.rooms as Array<Record<string, unknown>>)[0]!.ambience = "rain.opus";
    const parsed = MansionSchema.parse(forward);
    expect((parsed.rooms[0] as Record<string, unknown>).ambience).toBe("rain.opus");
  });
});

describe("the einstruct hangings point at harvested bundles", () => {
  it("names the content hashes `orchard harvest einstruct` wrote, not the dev fixtures", () => {
    const room = roomById(parseMansion(mansionDocument), "einstruct")!;
    const tape = room.hangings.find((h) => h.kind === "tape")!;
    const video = room.hangings.find((h) => h.kind === "video")!;
    // trees/einstruct.yaml, artefacts[*].bundle, 2026-09-12.
    expect(tape.bundle.id).toBe("2dd0038799b2db15");
    expect(video.bundle.id).toBe("216b720501856b14");
  });
});

describe("BundleRefSchema", () => {
  it("takes a content hash or a dev path, but not neither", () => {
    expect(BundleRefSchema.parse({ id: "9d2330991b40106e" }).id).toBe("9d2330991b40106e");
    expect(BundleRefSchema.parse({ path: "/dev-bundle/" }).path).toBe("/dev-bundle/");
    expect(() => BundleRefSchema.parse({})).toThrow(/id, a path or an exhibit/);
    expect(() => BundleRefSchema.parse({ id: "", path: "" })).toThrow();
  });

  it("takes an exhibit ref, a tree and a kind the hanging can show", () => {
    const ref = BundleRefSchema.parse({ exhibit: { tree: "einstruct", kind: "tape" } });
    expect(ref.exhibit).toEqual({ tree: "einstruct", kind: "tape", bundle: "" });
    expect(ref.id).toBe("");
    expect(() => BundleRefSchema.parse({ exhibit: { tree: "einstruct", kind: "splat" } })).toThrow();
    expect(() => BundleRefSchema.parse({ exhibit: { tree: "", kind: "tape" } })).toThrow();
  });

  it("every hanging in mansion.json names an exhibit on its room's tree and keeps a pinned id", () => {
    for (const room of parseMansion(mansionDocument).rooms) {
      for (const hanging of room.hangings) {
        // The hall's poster wall shows einstruct; the terrace's moon is spectre's chi12 ball.
        const guest: Record<string, string> = { hall: "einstruct", terrace: "spectre" };
        expect(hanging.bundle.exhibit?.tree).toBe(guest[room.id] ?? room.id);
        expect(hanging.bundle.exhibit?.kind).toBe(hanging.kind);
        expect(hanging.bundle.id).toMatch(/^[0-9a-f]{16}$/);
        // A hanging pinned to a bundle names the same bundle as its fallback id.
        if (hanging.bundle.exhibit?.bundle) expect(hanging.bundle.exhibit.bundle).toBe(hanging.bundle.id);
      }
    }
  });

});

// The walls, in glTF: "-x" is x = bounds.min[0], "+x" x = bounds.max[0],
// "-z" z = bounds.min[2], "+z" z = bounds.max[2]. The generator (tools/palace)
// works in Blender's Z-up and calls the z walls by Blender's y, which runs the
// other way: its "+y" is glTF "-z" and its "-y" is glTF "+z". A poster's
// `center` is a glTF z on the x walls and a glTF x on the others.
type Wall = "-x" | "+x" | "-z" | "+z";
const GENERATOR_WALL: Record<string, Wall> = { "+x": "+x", "-x": "-x", "+y": "-z", "-y": "+z" };

/** How far a door's surround reaches past the opening; a poster may not sit on it. */
const DOOR_SURROUND_M = 0.3;

const PosterSchema = z.looseObject({
  wall: z.enum(["+x", "-x", "+y", "-y"]),
  center: z.number(),
  width: z.number().positive(),
});

function wallOf(room: Room, door: Doorway): Wall {
  const axis = door.axis === "x" ? 0 : 2;
  const near = (v: number) => Math.abs(door.at - v) < 1e-6;
  if (near(room.bounds.min[axis])) return door.axis === "x" ? "-x" : "-z";
  if (near(room.bounds.max[axis])) return door.axis === "x" ? "+x" : "+z";
  throw new Error(`${room.id}: doorway to ${door.to} at ${door.at} is on no wall`);
}

function postersOf(room: Room): Array<z.infer<typeof PosterSchema>> {
  const palace = (room as { palace?: { posters?: unknown } }).palace;
  return z.array(PosterSchema).parse(palace?.posters ?? []);
}

describe("the walls", () => {
  const mansion = parseMansion(mansionDocument);

  it("every doorway into a room of the document is listed by that room too, at the same opening", () => {
    for (const room of mansion.rooms) {
      for (const door of room.doorways) {
        // A closed door to a room not built yet is a promise, checked nowhere.
        const other = roomById(mansion, door.to);
        if (!other) continue;
        // Two rooms may share several openings (the hall's French doors, the
        // orangery's arches): match the one at the same place.
        const back = other.doorways.find(
          (d) => d.to === room.id && d.axis === door.axis && d.at === door.at && d.center === door.center,
        );
        expect(back, `${room.id} -> ${door.to} at ${door.axis}=${door.at}, ${door.center}`).toBeDefined();
        expect(back).toMatchObject({
          axis: door.axis,
          at: door.at,
          center: door.center,
          width: door.width,
          height: door.height,
          closed: door.closed,
        });
        // ...and it is a wall of both rooms.
        wallOf(room, door);
        wallOf(other, back!);
      }
    }
  });

  // Fails today: the gallery's posters at 25 and 55 on "+x" (4.5 m wide) run
  // 0.45 m into the closed doors at 28 and 52, and 0.75 m into their
  // surrounds. Those two posters are being moved in mansion.json; when that
  // lands this passes, vitest reports it as such, and `.fails` comes off.
  it("no poster sits on a doorway or its surround", () => {
    const overlaps: string[] = [];
    for (const room of mansion.rooms) {
      const posters = postersOf(room);
      if (posters.length === 0) continue;
      for (const door of room.doorways) {
        const wall = wallOf(room, door);
        const d0 = door.center - door.width / 2 - DOOR_SURROUND_M;
        const d1 = door.center + door.width / 2 + DOOR_SURROUND_M;
        for (const poster of posters) {
          if (GENERATOR_WALL[poster.wall] !== wall) continue;
          const p0 = poster.center - poster.width / 2;
          const p1 = poster.center + poster.width / 2;
          if (p0 < d1 && d0 < p1) {
            overlaps.push(
              `${room.id}: poster at ${poster.center} on ${poster.wall} overlaps the door to ${door.to} at ${door.center} by ${Math.min(p1, d1) - Math.max(p0, d0)} m`,
            );
          }
        }
      }
    }
    expect(overlaps).toEqual([]);
  });
});

describe("exposure", () => {
  it("defaults to the hall's and is a fifth on the grounds", () => {
    const m = parseMansion(mansionDocument);
    expect(m.rooms.find((r) => r.id === "hall")?.exposure).toBe(1);
    for (const r of m.rooms.filter((r) => r.fallback.kind === "ground")) expect(r.exposure).toBeLessThan(0.5);
  });
});
