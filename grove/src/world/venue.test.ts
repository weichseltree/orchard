import { describe, expect, it } from "vitest";
import { parseMansion } from "./schema";
import {
  NOTHING_ON,
  anyRoomAsks,
  barredRooms,
  doorFacingOpacity,
  nearbyGatedDoor,
  nearbyNeeds,
  retreat,
  unmetNeeds,
  venueBarred,
  venueBox,
  venueEntrance,
  venueReason,
} from "./venue";

const room = (id: string, z0: number, requires: string[] = [], doors: Array<[string, number]> = []) => ({
  id, presence: "club", bounds: { min: [-5, -5, z0], max: [5, 1, z0 + 10] }, spawn: { position: [0, -5, z0 + 5] },
  requires,
  doorways: doors.map(([to, at]) => ({ to, axis: "z", at, center: 0, width: 3, height: 3 })),
});
const mansion = parseMansion({
  schema: "orchard/mansion/1", start: "hall",
  rooms: [
    room("hall", 0, [], [["foyer", 10]]),
    room("foyer", 10, [], [["hall", 10], ["club", 20]]),
    room("club", 20, ["microphone", "sound"], [["foyer", 20], ["stage", 30]]),
    room("stage", 30, ["microphone", "sound", "immersive"], [["club", 30]]),
  ],
});
const on = { microphone: true, sound: true, immersive: false };

describe("the venue's doors", () => {
  it("lists what a room asks that the visitor lacks, in the room's order", () => {
    expect(unmetNeeds(mansion.rooms[2], NOTHING_ON)).toEqual(["microphone", "sound"]);
    expect(unmetNeeds(mansion.rooms[2], { ...on, microphone: false })).toEqual(["microphone"]);
    expect(unmetNeeds(mansion.rooms[3], on)).toEqual(["immersive"]);
    expect(unmetNeeds(undefined, NOTHING_ON)).toEqual([]);
  });

  it("bars only the rooms that ask more than the visitor has", () => {
    expect(venueBarred(mansion, "club", NOTHING_ON)).toBe(true);
    expect(venueBarred(mansion, "club", on)).toBe(false);
    expect(venueBarred(mansion, "stage", on)).toBe(true);
    expect(venueBarred(mansion, "stage", { ...on, immersive: true })).toBe(false);
    expect(venueBarred(mansion, "foyer", NOTHING_ON)).toBe(false);
    expect(venueBarred(mansion, "nowhere", NOTHING_ON)).toBe(false);
    expect([...barredRooms(mansion, on)]).toEqual(["stage"]);
    expect([...barredRooms(mansion, NOTHING_ON)]).toEqual(["club", "stage"]);
  });

  it("knows which controls open a door anywhere", () => {
    expect(anyRoomAsks(mansion, "microphone")).toBe(true);
    expect(anyRoomAsks(parseMansion({ schema: "orchard/mansion/1", start: "hall", rooms: [room("hall", 0)] }), "sound")).toBe(false);
  });

  it("offers the needs of the room and its open neighbours, nowhere else", () => {
    expect(nearbyNeeds(mansion, "hall", NOTHING_ON)).toEqual([]);
    expect(nearbyNeeds(mansion, "foyer", NOTHING_ON)).toEqual(["microphone", "sound"]);
    expect(nearbyNeeds(mansion, "club", on)).toEqual(["immersive"]);
    expect(nearbyNeeds(mansion, "foyer", on)).toEqual([]);
  });

  it("says what the door asks and how to give it", () => {
    expect(venueReason("club", ["microphone", "sound"], false)).toBe("club asks for your microphone on and your sound on. The offers on screen switch it on.");
    expect(venueReason("club", ["sound"], true)).toBe("club asks for your sound on. Press the trigger to switch it on.");
    expect(venueReason("club", ["microphone"], true)).toBe("club asks for your microphone on. Allow the microphone outside VR first, then come back.");
    expect(venueReason("stage", ["immersive"], false)).toBe("stage asks for a headset: it opens to an immersive session only. Enter VR to take the stage.");
    expect(venueReason("stage", [], false)).toBe("stage is open.");
  });

  it("lands a shared link in the nearest room that asks nothing", () => {
    expect(venueEntrance(mansion, "club").id).toBe("foyer");
    expect(venueEntrance(mansion, "stage").id).toBe("foyer");
    expect(venueEntrance(mansion, "foyer").id).toBe("foyer");
    expect(venueEntrance(mansion, "nowhere").id).toBe("hall");
  });

  it("retreats to the nearest room the visitor may still be in", () => {
    expect(retreat(mansion, "stage", on).id).toBe("club");
    expect(retreat(mansion, "stage", { ...on, sound: false }).id).toBe("foyer");
    expect(retreat(mansion, "club", NOTHING_ON).id).toBe("foyer");
    expect(retreat(mansion, "nowhere", NOTHING_ON).id).toBe("hall");
  });

  it("boxes the gated rooms together for the pulse", () => {
    expect(venueBox(mansion)).toEqual({ min: [-5, -5, 20], max: [5, 1, 40] });
    expect(venueBox(parseMansion({ schema: "orchard/mansion/1", start: "hall", rooms: [room("hall", 0)] }))).toBeNull();
  });

  it("modulates door facing opacity by angle and distance", () => {
    // Directly facing at 2m (within 3m) -> full opacity
    expect(doorFacingOpacity(2, 0, 2, 0, 1)).toBe(1);

    // Facing away -> 0 opacity
    expect(doorFacingOpacity(2, 0, 2, 0, -1)).toBe(0);

    // Looking perpendicular (90 degrees, dot = 0 <= 0.20) -> 0 opacity
    expect(doorFacingOpacity(2, 0, 2, 1, 0)).toBe(0);

    // Facing at 5.75m (halfway between 3m and 8.5m) -> 0.5 opacity
    expect(doorFacingOpacity(5.75, 0, 5.75, 0, 1)).toBeCloseTo(0.5, 3);

    // Beyond max distance (e.g. 9m > 8.5m) -> 0 opacity
    expect(doorFacingOpacity(9, 0, 9, 0, 1)).toBe(0);

    // Looking straight at door from right at doorway (dist = 0) -> 1
    expect(doorFacingOpacity(0, 0, 0, 0, 1)).toBe(1);
  });

  it("finds nearby gated door when facing it with unmet needs", () => {
    // In foyer (z=10..20), door to club is at z=20. Visitor is at (0, 18), looking +z (towards door).
    const offer = nearbyGatedDoor(mansion, "foyer", 0, 18, 0, 1, NOTHING_ON);
    expect(offer).not.toBeNull();
    expect(offer?.targetRoomId).toBe("club");
    expect(offer?.targetTitle).toBe("club");
    expect(offer?.unmet).toEqual(["microphone", "sound"]);
    expect(offer?.opacity).toBe(1);
    expect(offer?.distance).toBe(2);

    // Looking away (-z) -> null
    expect(nearbyGatedDoor(mansion, "foyer", 0, 18, 0, -1, NOTHING_ON)).toBeNull();

    // When all needs are met -> null
    expect(nearbyGatedDoor(mansion, "foyer", 0, 18, 0, 1, on)).toBeNull();

    // From hall (no direct gated doors) -> null
    expect(nearbyGatedDoor(mansion, "hall", 0, 5, 0, 1, NOTHING_ON)).toBeNull();

    // From club looking at stage with microphone/sound on (lacking immersive) -> stage offer
    const stageOffer = nearbyGatedDoor(mansion, "club", 0, 28, 0, 1, on);
    expect(stageOffer).not.toBeNull();
    expect(stageOffer?.targetRoomId).toBe("stage");
    expect(stageOffer?.unmet).toEqual(["immersive"]);
    expect(stageOffer?.opacity).toBe(1);
  });
});

describe("the schema", () => {
  it("refuses a gated room no lesser room reaches", () => {
    expect(() => parseMansion({
      schema: "orchard/mansion/1", start: "hall",
      rooms: [room("hall", 0, [], [["club", 10]]), room("club", 10, ["sound"], [["stage", 20]]), room("stage", 20, ["sound", "immersive"], [["club", 20]])],
    })).toThrow(/club.*asks less/);
    expect(() => parseMansion({ schema: "orchard/mansion/1", start: "hall", rooms: [room("hall", 0, ["nonsense"])] })).toThrow();
  });
});
