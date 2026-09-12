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
    expect(mansion.rooms.map((room) => room.id)).toEqual(["hall", "einstruct", "world-engine", "phototroph", "spectre"]);
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

  it("describes einstruct as 15 x 10 x 5 m with two tape sheets side by side and two video walls", () => {
    const room = roomById(parseMansion(mansionDocument), "einstruct");
    const { min, max } = room!.bounds;
    expect([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).toEqual([15, 5, 10]);
    expect(room!.presence).toBe("einstruct");
    const kinds = room!.hangings.map((h) => h.kind).sort();
    expect(kinds).toEqual(["tape", "tape", "video", "video"]);
    // The segregation tape and its stirred twin (ruling 2026-09-12), each 6 m,
    // side by side in a 15 m room, and each pinned to its own bundle so the
    // latest einstruct tape does not land on both sheets.
    const tapes = room!.hangings.filter((h) => h.kind === "tape");
    expect(tapes.map((h) => h.bundle.exhibit?.bundle)).toEqual(["2dd0038799b2db15", "903d0c5a939b0ba1"]);
    expect(tapes.map((h) => h.position[0])).toEqual([-3.7, 3.7]);
    for (const d of room!.doorways) expect(["hall", "world-engine", "phototroph", "spectre"]).toContain(d.to);
    const tape = tapes[0];
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
        expect(hanging.bundle.exhibit?.tree).toBe(room.id === "hall" ? "einstruct" : room.id);
        expect(hanging.bundle.exhibit?.kind).toBe(hanging.kind);
        expect(hanging.bundle.id).toMatch(/^[0-9a-f]{16}$/);
        // A hanging pinned to a bundle names the same bundle as its fallback id.
        if (hanging.bundle.exhibit?.bundle) expect(hanging.bundle.exhibit.bundle).toBe(hanging.bundle.id);
      }
    }
  });

  it("the rooms off einstruct sit against its walls with matching doorways", () => {
    const mansion = parseMansion(mansionDocument);
    const e = roomById(mansion, "einstruct")!;
    for (const [id, x] of [["world-engine", 7.5], ["phototroph", -7.5]] as const) {
      const room = roomById(mansion, id)!;
      const door = e.doorways.find((d) => d.to === id)!;
      const back = room.doorways.find((d) => d.to === "einstruct")!;
      expect(door).toMatchObject({ axis: "x", at: x, center: -15 });
      expect(back).toMatchObject({ axis: "x", at: x, center: -15 });
      expect(x > 0 ? room.bounds.min[0] : room.bounds.max[0]).toBe(x);
    }
  });
});
