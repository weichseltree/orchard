import { describe, expect, it } from "vitest";
import { demoEnabled, demoMansion } from "./demo";
import mansionDocument from "./world/mansion.json";
import { parseMansion } from "./world/schema";
import { bundleUrl } from "./world/world";

describe("local demo", () => {
  it("requires an explicit demo link and a development server", () => {
    expect(demoEnabled(true, "?demo")).toBe(true);
    expect(demoEnabled(true, "?room=einstruct&demo=1")).toBe(true);
    expect(demoEnabled(true, "?room=einstruct")).toBe(false);
    expect(demoEnabled(false, "?demo")).toBe(false);
  });

  it("resolves every hanging to a local fixture even when a live table is available", () => {
    const demo = demoMansion(mansionDocument, true);
    expect(demo.start).toBe("einstruct");
    const hangings = demo.rooms.flatMap((room) => room.hangings);
    expect(new Set(hangings.map((h) => h.kind))).toEqual(new Set(["tape", "video"]));
    for (const hanging of hangings) {
      expect(hanging.title).toContain("Synthetic");
      expect(hanging.bundle.exhibit).toBeUndefined();
      expect(hanging.bundle.id).toBe("");
      const localPath = hanging.kind === "tape" ? "/dev-bundle/" : "/dev-video/";
      expect(bundleUrl(hanging.bundle, [])).toBe(localPath);
      expect(bundleUrl(hanging.bundle, null)).toBe(localPath);
    }
    expect(() => parseMansion(demo)).not.toThrow();
  });

  it("works without ffmpeg by leaving out video walls", () => {
    const hangings = demoMansion(mansionDocument, false).rooms.flatMap((room) => room.hangings);
    expect(hangings.length).toBeGreaterThan(0);
    expect(hangings.every((h) => h.kind === "tape")).toBe(true);
  });

  it("preserves the source scene and the palace geometry", () => {
    const original = structuredClone(mansionDocument);
    const demo = demoMansion(mansionDocument, true);
    expect(mansionDocument).toEqual(original);
    const production = parseMansion(original);
    for (let i = 0; i < production.rooms.length; i++) {
      expect(demo.rooms[i]?.glb).toBe(production.rooms[i]?.glb);
      expect(demo.rooms[i]?.doorways).toEqual(production.rooms[i]?.doorways);
      expect(demo.rooms[i]?.bounds).toEqual(production.rooms[i]?.bounds);
    }
    expect(production.rooms.some((room) => room.hangings.some((h) => h.bundle.exhibit))).toBe(true);
  });
});
