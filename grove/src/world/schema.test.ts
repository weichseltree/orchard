import { describe, expect, it } from "vitest";
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
    const palace = ["hall", "einstruct", "world-engine", "orangery", "phototroph", "gallery", "belvedere", "greenhouse", "terrace", "parterre", "orchard-west", "orchard-south", "orchard-east", "orrery"];
    // arcedit's area (results/grove/area.json in that tree): its entrance and seventeen chambers, the last at a tenth of the scale.
    const arcedit = ["arcedit", "arcedit/arcedit", "arcedit/arcedit/serve", "arcedit/docs", "arcedit/mental", "arcedit/results", "arcedit/results/grove", "arcedit/results/grove/oracle_side5", "arcedit/results/grove/policy_side3", "arcedit/results/i15_perception_under_reward", "arcedit/results/i17_full_campaign", "arcedit/results/i2_encoder", "arcedit/results/i3_action", "arcedit/results/i9_restriction", "arcedit/results/interface_v1", "arcedit/scripts", "arcedit/tests", "arcedit/inside"];
    expect(mansion.rooms.map((room) => room.id)).toEqual([...palace, ...arcedit]);
    expect(mansion.start).toBe("hall");
  });

  it("opens the 20 x 24 x 9 m hall with a grand flight up to the raised north wing", () => {
    const mansion = parseMansion(mansionDocument);
    const hall = roomById(mansion, "hall");
    expect(hall).toBeDefined();
    const { min, max } = hall!.bounds;
    expect(max[0] - min[0]).toBeCloseTo(20);
    expect(max[1] - min[1]).toBeCloseTo(9);
    expect(max[2] - min[2]).toBeCloseTo(24);
    expect(hall!.presence).toBe("grove");
    // The palace: the enfilade north (a 6 m opening onto world-engine, whose
    // floor is 1.5 m up), phototroph south, einstruct's own cabinet east, two
    // French doors west, and the greenhouse door, closed to visitors.
    expect(hall!.doorways).toHaveLength(6);
    expect(hall!.doorways[0]).toMatchObject({ to: "world-engine", width: 6, height: 4.6 });
    expect(roomById(mansion, "world-engine")!.bounds.min[1]).toBeCloseTo(1.5);
    expect(hall!.doorways.find((d) => d.to === "einstruct")).toMatchObject({ axis: "x", at: 10 });
    expect(hall!.doorways.find((d) => d.to === "greenhouse")).toMatchObject({ closed: true });
  });

  it("titles the tree rooms after their repositories and stands the grounds below the terrace", () => {
    const mansion = parseMansion(mansionDocument);
    expect(mansion.rooms.filter((r) => ["einstruct", "world-engine", "phototroph"].includes(r.id)).map((r) => r.title))
      .toEqual(["einstruct", "world-engine", "phototroph"]);
    expect(roomById(mansion, "terrace")!.bounds.min[1]).toBe(0);
    expect(roomById(mansion, "parterre")!.bounds.min[1]).toBeCloseTo(-1.6);
    expect(roomById(mansion, "belvedere")!.bounds.min[1]).toBeCloseTo(1.8);
    expect(mansion.terrain.mounds.length).toBeGreaterThan(3);
    // The portal's centre sits at eye height above the sunken garden.
    expect(roomById(mansion, "parterre")!.portals[0]!.position[1]).toBeCloseTo(-1.6 + 1.6);
  });

  it("offers FTL Chess from the Lantern Walk, and from nowhere else", () => {
    const mansion = parseMansion(mansionDocument);
    const orangery = roomById(mansion, "orangery")!;
    expect(orangery.gameSurfaces).toEqual([{
      id: "ftl-chess",
      provider: "ftlchess",
      title: "FTL Chess",
      description: "A fast chess game hosted by FTL Chess.",
      url: "https://ftlchess.com/",
      position: [0, 1.5, -73],
      yawDeg: 0,
    }]);
    // Ruled 2026-09-16: the game moved out of the Long Gallery, which keeps
    // its closed doors for trees that have no room yet.
    for (const room of mansion.rooms) {
      if (room.id !== "orangery") expect(room.gameSurfaces, room.id).toEqual([]);
    }
  });

  it("describes einstruct as a 16 x 16 x 7 m cabinet of its own with two tape sheets and two video walls", () => {
    const room = roomById(parseMansion(mansionDocument), "einstruct");
    const { min, max } = room!.bounds;
    expect([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).toEqual([16, 7, 16]);
    expect(room!.presence).toBe("einstruct");
    const kinds = room!.hangings.map((h) => h.kind).sort();
    expect(kinds).toEqual(["tape", "tape", "video", "video"]);
    // The segregation tape and its stirred twin (ruling 2026-09-12), each 6 m,
    // either side of the enfilade line, pinned to their own bundles.
    const tapes = room!.hangings.filter((h) => h.kind === "tape");
    expect(tapes.map((h) => h.bundle.exhibit?.bundle)).toEqual(["2dd0038799b2db15", "903d0c5a939b0ba1"]);
    expect(tapes.map((h) => h.position[0])).toEqual([14.5, 21.5]);
    // Its own room: one door, from the hall. coarsen's cabinet beside it is gone (2026-09-16); its worlds stand in the Orrery.
    expect(room!.doorways.map((d) => d.to).sort()).toEqual(["hall"]);
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

  it("rejects duplicate game surface ids across rooms", () => {
    const broken = doc();
    const rooms = broken.rooms as Array<Record<string, unknown>>;
    const surface = { id: "same", provider: "ftlchess", title: "Game", url: "https://ftlchess.com/" };
    rooms[0]!.gameSurfaces = [surface];
    rooms[1]!.gameSurfaces = [surface];
    expect(() => MansionSchema.parse(broken)).toThrow(/duplicate game surface id/);
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
        // A planet hangs through an exhibit row like everything else (issue
        // #20); its bundle names its own atlas videos, which need no row.
        // A live audio exhibit is a name with no bytes and no exhibit row
        // (AUDIO-STREAM.md §1); nothing below is a claim about it.
        if (hanging.kind === "audio") continue;
        // The hall's wall shows coarsen's film; the Orrery's worlds are spectre's.
        // A room of a tree's area ("arcedit/results/grove") shows its tree's.
        const guest: Record<string, string> = { hall: "spectre", orrery: "spectre" };
        expect(hanging.bundle.exhibit?.tree).toBe(guest[room.id] ?? room.id.split("/")[0]);
        expect(hanging.bundle.exhibit?.kind).toBe(hanging.kind);
        expect(hanging.bundle.id).toMatch(/^[0-9a-f]{16}$/);
        // A hanging pinned to a bundle names the same bundle as its fallback id.
        if (hanging.bundle.exhibit?.bundle) expect(hanging.bundle.exhibit.bundle).toBe(hanging.bundle.id);
      }
    }
  });

});

// Check the actual media panels, not retired baker decoration metadata.
type Wall = "-x" | "+x" | "-z" | "+z";

/** How far a door's surround reaches past the opening; a poster may not sit on it. */
const DOOR_SURROUND_M = 0.3;

function wallOf(room: Room, door: Doorway): Wall {
  const axis = door.axis === "x" ? 0 : 2;
  const near = (v: number) => Math.abs(door.at - v) < 1e-6;
  if (near(room.bounds.min[axis])) return door.axis === "x" ? "-x" : "-z";
  if (near(room.bounds.max[axis])) return door.axis === "x" ? "+x" : "+z";
  throw new Error(`${room.id}: doorway to ${door.to} at ${door.at} is on no wall`);
}

function postersOf(room: Room): Array<{ wall: Wall; center: number; width: number }> {
  return room.hangings.flatMap((hanging) => {
    // Nothing that stands in the room's volume rather than on a wall: a tape
    // box, one of spectre's worlds, or a live audio exhibit's topology.
    if (hanging.kind === "tape" || hanging.kind === "planet" || hanging.kind === "audio") return [];
    const [x, , z] = hanging.position;
    const candidates: Array<[Wall, number, number]> = [
      ["-x", Math.abs(x - room.bounds.min[0]), z], ["+x", Math.abs(x - room.bounds.max[0]), z],
      ["-z", Math.abs(z - room.bounds.min[2]), x], ["+z", Math.abs(z - room.bounds.max[2]), x],
    ];
    const [wall, distance, center] = candidates.sort((a, b) => a[1] - b[1])[0]!;
    return distance < 0.5 ? [{ wall, center, width: hanging.widthMeters }] : [];
  });
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

  it("no poster sits on a doorway or its surround", () => {
    const overlaps: string[] = [];
    expect(mansion.rooms.flatMap(postersOf).length).toBeGreaterThan(0);
    for (const room of mansion.rooms) {
      const posters = postersOf(room);
      if (posters.length === 0) continue;
      for (const door of room.doorways) {
        const wall = wallOf(room, door);
        const d0 = door.center - door.width / 2 - DOOR_SURROUND_M;
        const d1 = door.center + door.width / 2 + DOOR_SURROUND_M;
        for (const poster of posters) {
          if (poster.wall !== wall) continue;
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
  it("keeps one exposure across the Observatory and its grounds", () => {
    const m = parseMansion(mansionDocument);
    expect(m.rooms.find((r) => r.id === "hall")?.exposure).toBe(1);
    for (const r of m.rooms) expect(r.exposure).toBe(1);
  });
});

describe("coarsen without a chamber (ruled 2026-09-16)", () => {
  const mansion = parseMansion(mansionDocument);

  it("has no spectre room: its worlds stand in the Orrery, through the garden's armillary", () => {
    expect(roomById(mansion, "spectre")).toBeUndefined();
    for (const room of mansion.rooms) expect(room.doorways.map((d) => d.to), room.id).not.toContain("spectre");
    expect(roomById(mansion, "parterre")!.portals.map((p) => p.to)).toEqual(["orrery"]);
  });

  it("hangs the chamber's film on the hall's east wall, looping at a quarter speed", () => {
    const hall = roomById(mansion, "hall")!;
    expect(hall.hangings.map((h) => h.kind)).toEqual(["video"]);
    const wall = hall.hangings[0]!;
    if (wall.kind !== "video") return;
    expect(wall.id).toBe("spectre-wall");
    expect(wall.bundle.id).toBe("0462efca96af7297");
    expect(wall.playbackRate).toBe(0.25);
    expect(wall.position).toEqual([9.74, 3.6, 1.2]);
    expect(wall.widthMeters).toBe(6);
  });

  it("plays every other wall as recorded", () => {
    for (const room of mansion.rooms) {
      for (const hanging of room.hangings) {
        if (hanging.kind === "video" && hanging.id !== "spectre-wall") expect(hanging.playbackRate, hanging.id).toBe(1);
      }
    }
  });

  it("stands the chess table at the far end of the orangery, and refuses a table outside its room", () => {
    const orangery = roomById(mansion, "orangery")!;
    expect(orangery.gameSurfaces[0]!.position).toEqual([0, 1.5, -73]);
    expect(orangery.gameSurfaces[0]!.position![2]).toBeLessThan(orangery.spawn.position[2] - 30);
    const doc = structuredClone(mansionDocument) as { rooms: Array<{ id: string; gameSurfaces?: Array<{ position?: number[] }> }> };
    doc.rooms.find((r) => r.id === "orangery")!.gameSurfaces![0]!.position = [40, 1.5, -73];
    expect(() => parseMansion(doc)).toThrow(/stands outside/);
  });
});
