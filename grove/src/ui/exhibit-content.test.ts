import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import mansionDocument from "../world/mansion.json";
import { parseMansion } from "../world/schema";
import { demoMansion } from "../demo";
import { evidenceUrl, exhibitContent, researchRooms, roomHref } from "./exhibit-content";

const mansion = parseMansion(mansionDocument);

describe("the exhibit companion", () => {
  it("replaces scientific observations and species meaning when the tapes are synthetic", () => {
    const demo = demoMansion(mansionDocument, false);
    for (const room of demo.rooms.filter((candidate) => candidate.hangings.some((hanging) => hanging.kind === "tape"))) {
      const scientific = exhibitContent(room);
      const synthetic = exhibitContent(room, true);
      expect(synthetic.demo).toBe(true);
      expect(synthetic.species).toBeUndefined();
      expect(synthetic.lookFor).not.toEqual(scientific.lookFor);
      expect(synthetic.introduction).toContain("not loaded");
      // Research notes may remain available, but they are never replaced by
      // a test-tape source or presented as the evidence for synthetic motion.
      expect(evidenceUrl(synthetic)).toBe(evidenceUrl(scientific));
    }
  });

  it("does not invite visitors to observe research stills that the demo omits", () => {
    const room = demoMansion(mansionDocument, false).rooms.find((candidate) => candidate.id === "world-engine")!;
    expect(room.hangings).toEqual([]);
    const companion = exhibitContent(room, true);
    expect(companion.introduction).toContain("Research stills are not loaded");
    expect(companion.lookFor.join(" ")).not.toContain("chair");
  });

  it("suggests only research chambers reachable through open doors, in a stable order", () => {
    expect(researchRooms(mansion).map((room) => room.id)).toEqual(["einstruct", "orrery", "phototroph", "world-engine"]);
    const isolated = structuredClone(mansion);
    for (const room of isolated.rooms) {
      for (const doorway of room.doorways) {
        if (doorway.to === "phototroph") doorway.closed = true;
      }
    }
    expect(researchRooms(isolated).map((room) => room.id)).not.toContain("phototroph");
    // The Orrery is reached through the garden's portal, not a door.
    const noPortal = structuredClone(mansion);
    for (const room of noPortal.rooms) room.portals = [];
    expect(researchRooms(noPortal).map((room) => room.id)).not.toContain("orrery");
    expect(researchRooms({ ...mansion, rooms: [...mansion.rooms].reverse() }).map((room) => room.id))
      .toEqual(researchRooms(mansion).map((room) => room.id));
  });

  it("keeps mode flags on room links without carrying a previous camera location", () => {
    const link = new URL(roomHref("?demo&nosw&room=hall&x=1&z=2&yaw=30&pitch=-5", "orrery"), "https://example.test");
    expect(link.pathname).toBe("/mind/");
    expect(link.searchParams.has("demo")).toBe(true);
    expect(link.searchParams.has("nosw")).toBe(true);
    expect(link.searchParams.get("room")).toBe("orrery");
    for (const parameter of ["x", "z", "yaw", "pitch"]) expect(link.searchParams.has(parameter)).toBe(false);
  });

  it("links each chamber's evidence to an actual section of the exhibit record", () => {
    const record = readFileSync(new URL("../../../docs/EXHIBIT-PLAN.md", import.meta.url), "utf8").replaceAll("\r\n", "\n");
    for (const room of mansion.rooms) {
      const companion = exhibitContent(room);
      const link = evidenceUrl(companion);
      if (!link) continue;
      expect(new URL(link).origin).toBe("https://github.com");
      expect(record).toContain(`### ${companion.evidenceAnchor}\n`);
    }
  });
});
