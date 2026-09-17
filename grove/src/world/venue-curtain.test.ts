import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { parseMansion } from "./schema";
import { VenueCurtains } from "./venue-curtain";

describe("VenueCurtains", () => {
  const mansion = parseMansion(mansionDocument);
  const curtains = new VenueCurtains(mansion);

  it("hangs one curtain per door into a room that asks more than the room before it", () => {
    expect(curtains.doors).toEqual(["curtain-foyer-club", "curtain-stair-court-club", "curtain-club-stage"]);
  });

  it("shows a curtain only over a barred door, and animates only what shows", () => {
    curtains.update(1, new Set(["club", "stage"]));
    expect(curtains.group.children.map((c) => c.visible)).toEqual([true, true, true]);
    curtains.update(2, new Set(["stage"]));
    expect(curtains.group.children.map((c) => c.visible)).toEqual([false, false, true]);
    curtains.update(3, new Set());
    expect(curtains.group.children.every((c) => !c.visible)).toBe(true);
  });

  it("stands in the doorway at the door's own floor", () => {
    const club = curtains.group.children[0]!;
    expect([club.position.x, club.position.y, club.position.z]).toEqual([-10, -3.4, -55]);
    const stage = curtains.group.children[2]!;
    expect([stage.position.x, stage.position.y, stage.position.z]).toEqual([0, -2, -70]);
  });
});
