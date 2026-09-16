import { describe, expect, it } from "vitest";
import mansionDocument from "../mansion.json";
import { parseMansion } from "../schema";
import en from "./en.json";
import de from "./de.json";
import { AVAILABLE_LOCALES, labelsFor, labelsLoaded, parseLabels, roomTitle, type Labels } from "./index";

// Every language file names every room and every hanging of mansion.json, in
// a museum register whose lengths are checked: an introduction of 60 to 110
// words for a room with exhibits, an orientation of 25 to 50 for one
// without, and a caption of 25 to 50 per exhibit.

const mansion = parseMansion(mansionDocument);
const files: Array<[string, unknown]> = [["en", en], ["de", de]];
const words = (s: string) => s.trim().split(/\s+/).length;

/** The tree rooms are titled after their repositories in every language. */
const REPOSITORY_TITLES: Record<string, string> = {
  einstruct: "einstruct",
  spectre: "coarsen",
  "world-engine": "world-engine",
  phototroph: "phototroph",
};

describe.each(files)("labels/%s.json", (locale, raw) => {
  const labels: Labels = parseLabels(raw);

  it("is listed as available", () => {
    expect(AVAILABLE_LOCALES).toContain(locale);
  });

  it("names every room of mansion.json, and no other", () => {
    const rooms = mansion.rooms.map((r) => r.id).sort();
    expect(Object.keys(labels.rooms).sort()).toEqual(rooms);
  });

  it("names every hanging of mansion.json, and no other", () => {
    const hangings = mansion.rooms.flatMap((r) => r.hangings.map((h) => h.id)).sort();
    expect(Object.keys(labels.exhibits).sort()).toEqual(hangings);
  });

  it("titles the tree rooms after their repositories", () => {
    for (const [id, title] of Object.entries(REPOSITORY_TITLES)) expect(labels.rooms[id]?.title, id).toBe(title);
  });

  for (const room of mansion.rooms) {
    const copy = labels.rooms[room.id];
    if (!copy) continue;
    const exhibits = room.hangings.length > 0;
    it(`${room.id}: an introduction of ${exhibits ? "60 to 110" : "25 to 50"} words, a look-for line${exhibits ? ", a limit" : ""}`, () => {
      const n = words(copy.intro);
      if (exhibits) {
        expect(n).toBeGreaterThanOrEqual(60);
        expect(n).toBeLessThanOrEqual(110);
        expect(copy.limit, "limit").toBeTruthy();
      } else {
        expect(n).toBeGreaterThanOrEqual(25);
        expect(n).toBeLessThanOrEqual(50);
      }
      expect(copy.lookFor, "lookFor").toBeTruthy();
      expect(copy.kicker).toBeTruthy();
    });
  }

  for (const room of mansion.rooms) {
    for (const hanging of room.hangings) {
      const copy = labels.exhibits[hanging.id];
      if (!copy) continue;
      it(`${hanging.id}: a caption of 25 to 50 words`, () => {
        const n = words(copy.caption);
        expect(n).toBeGreaterThanOrEqual(25);
        expect(n).toBeLessThanOrEqual(50);
        expect(copy.title).toBeTruthy();
      });
    }
  }

  it("keeps repo-speak off the walls (LAWS 5)", () => {
    const text = [
      ...Object.values(labels.rooms).flatMap((r) => [r.intro, r.lookFor ?? "", r.limit ?? ""]),
      ...Object.values(labels.exhibits).flatMap((e) => [e.caption]),
    ].join(" ");
    expect(text).not.toMatch(/\bregistered\b|\bexit 0\b|\bsigma\b|\bE\d{1,2}\b|\bP\d{1,2}[ab]?\b/);
  });
});

describe("labelsFor", () => {
  it("loads and validates a language file once, then answers synchronously", async () => {
    expect(labelsLoaded("de")).toBeNull();
    const first = await labelsFor("de");
    expect(first.common.entrance).toBe("Einführung");
    expect(labelsLoaded("de")).toBe(first);
    expect(await labelsFor("de")).toBe(first);
  });

  it("rejects a locale we do not have", async () => {
    await expect(labelsFor("xx")).rejects.toThrow(/no labels/);
  });

  it("roomTitle reads the visitor's title, and nothing for an unknown room or no labels", async () => {
    const labels = await labelsFor("en");
    expect(roomTitle(labels, "spectre")).toBe("coarsen");
    expect(roomTitle(labels, "hall")).toBe("The Observatory");
    expect(roomTitle(await labelsFor("de"), "hall")).toBe("Das Observatorium");
    expect(roomTitle(labels, "nowhere")).toBeUndefined();
    expect(roomTitle(null, "hall")).toBeUndefined();
  });
});
