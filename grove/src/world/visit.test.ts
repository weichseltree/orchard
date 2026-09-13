import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { parseMansion } from "./schema";
import { finiteParameter, visitRoom } from "./visit";
import { destinations } from "../ui/guide";

const mansion = parseMansion(mansionDocument);

describe("visitor links", () => {
  it("opens known rooms and recovers an obsolete or mistyped room link at the start", () => {
    expect(visitRoom(mansion, new URLSearchParams("room=einstruct")).id).toBe("einstruct");
    for (const search of ["room=missing", "room=", ""]) {
      expect(visitRoom(mansion, new URLSearchParams(search)).id).toBe(mansion.start);
    }
  });

  it("refuses empty, nonnumeric and nonfinite camera coordinates", () => {
    for (const search of ["", "x=", "x=%20", "x=NaN", "x=Infinity", "x=-Infinity", "x=1e999", "x=oops"]) {
      expect(finiteParameter(new URLSearchParams(search), "x")).toBeNull();
    }
    expect(finiteParameter(new URLSearchParams("x=-2.5"), "x")).toBe(-2.5);
    expect(finiteParameter(new URLSearchParams("x=0"), "x")).toBe(0);
  });

  it("does not advertise closed doors or unknown destinations as open rooms", () => {
    const hall = mansion.rooms.find((room) => room.id === mansion.start)!;
    const available = destinations(mansion, hall).map((room) => room.id);
    expect(available).toContain("einstruct");
    for (const door of hall.doorways.filter((door) => door.closed)) {
      expect(available).not.toContain(door.to);
    }
    expect(destinations(mansion, { ...hall, doorways: [{ ...hall.doorways[0]!, to: "missing" }] })).toEqual([]);
  });
});
