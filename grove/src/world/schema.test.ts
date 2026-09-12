import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { BundleRefSchema, MansionSchema, parseMansion, roomById } from "./schema";

// mansion.json is the one scene document; a bad edit has to fail here, at
// boot, rather than as a missing wall three rooms later.

function doc(): Record<string, unknown> {
  return structuredClone(mansionDocument) as Record<string, unknown>;
}

describe("mansion.json", () => {
  it("parses", () => {
    const mansion = parseMansion(mansionDocument);
    expect(mansion.schema).toBe("orchard/mansion/1");
    expect(mansion.rooms.map((room) => room.id)).toEqual(["hall", "einstruct"]);
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
    expect(hall!.doorways).toHaveLength(1);
    expect(hall!.doorways[0]).toMatchObject({ to: "einstruct", width: 2.4, height: 3.2 });
  });

  it("describes einstruct as 10 x 10 x 5 m with a tape and a video wall", () => {
    const room = roomById(parseMansion(mansionDocument), "einstruct");
    const { min, max } = room!.bounds;
    expect([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).toEqual([10, 5, 10]);
    expect(room!.presence).toBe("einstruct");
    const kinds = room!.hangings.map((h) => h.kind).sort();
    expect(kinds).toEqual(["tape", "video"]);
    const tape = room!.hangings.find((h) => h.kind === "tape");
    expect(tape).toMatchObject({ longSideMeters: 6 });
    // Ruling 2026-09-12: a 2D tape lies flat, waist height on a 1.6 m eye.
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
    broken.start = "greenhouse";
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

describe("the einstruct hangings point at WP1's bundles", () => {
  it("names the content hashes, not the dev fixtures", () => {
    const room = roomById(parseMansion(mansionDocument), "einstruct")!;
    const tape = room.hangings.find((h) => h.kind === "tape")!;
    const video = room.hangings.find((h) => h.kind === "video")!;
    expect(tape.bundle.id).toBe("84b67b5a0d22eeab");
    expect(video.bundle.id).toBe("2dc8ca525724aefd");
  });
});

describe("BundleRefSchema", () => {
  it("takes a content hash or a dev path, but not neither", () => {
    expect(BundleRefSchema.parse({ id: "9d2330991b40106e" }).id).toBe("9d2330991b40106e");
    expect(BundleRefSchema.parse({ path: "/dev-bundle/" }).path).toBe("/dev-bundle/");
    expect(() => BundleRefSchema.parse({})).toThrow(/id or a path/);
    expect(() => BundleRefSchema.parse({ id: "", path: "" })).toThrow();
  });
});
