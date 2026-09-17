import { describe, expect, it } from "vitest";
import { parseMansion } from "./schema";
import { NOTHING_ON, anyRoomAsks, barredRooms, nearbyNeeds, retreat, unmetNeeds, venueBarred, venueBox, venueEntrance, venueReason } from "./venue";

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
