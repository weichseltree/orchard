import { describe, expect, it } from "vitest";
import mansionDocument from "../mansion.json";
import { parseMansion } from "../schema";
import en from "./en.json";
import de from "./de.json";
import fr from "./fr.json";
import es from "./es.json";
import italian from "./it.json";
import pt from "./pt.json";
import nl from "./nl.json";
import ja from "./ja.json";
import { AVAILABLE_LOCALES, labelsFor, labelsLoaded, parseLabels, roomTitle, type Labels } from "./index";

// Every language file names every room and every hanging of mansion.json, in
// a museum register whose lengths are checked: an introduction of 60 to 110
// words for a room with exhibits, an orientation of 25 to 50 for one
// without, and a caption of 25 to 50 per exhibit.

const mansion = parseMansion(mansionDocument);
const files: Array<[string, unknown]> = [["en", en], ["de", de], ["fr", fr], ["es", es], ["it", italian], ["pt", pt], ["nl", nl], ["ja", ja]];
/**
 * The bounds are English word counts. A faithful translation runs longer in
 * the Romance languages and Dutch, so a language's count is divided by how
 * much it expands; Japanese has no word spaces and is measured in characters,
 * about 3.3 of them to an English word. The plaques fit their type to the
 * text, so longer copy costs legibility, not layout.
 */
const EXPANSION: Record<string, number> = { fr: 1.35, es: 1.35, pt: 1.35, it: 1.2, nl: 1.1, ja: 3.3 };
const measure = (locale: string, s: string) =>
  (locale === "ja" ? s.trim().length : s.trim().split(/\s+/).length) / (EXPANSION[locale] ?? 1);

/** The tree rooms are titled after their repositories in every language. */
const REPOSITORY_TITLES: Record<string, string> = {
  einstruct: "einstruct",
  "world-engine": "world-engine",
  phototroph: "phototroph",
  quantumflow: "quantumflow",
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
    // Both documents are read by visitors and neither is derived from the
    // other: the relief over a door and the wall text come from here, while
    // the Guide's heading, the door list and the notices come from
    // mansion.json's own `title`. They drifted apart on 2026-09-17 when the
    // wing's rooms were renamed here alone, and nothing failed.
    // Guarded on `room.title`: the schema lets a room leave it empty and the
    // code means it to — guide.ts and world.ts fall back to `room.id` — and a
    // room that does so should not fail a test in the labels suite. Requiring
    // it in the schema instead would be the cleaner statement, but every
    // synthetic room in venue, portal and world-loading's fixtures omits it,
    // and that is a wider change than a wing is owed.
    if (locale === "en" && room.title) {
      it(`${room.id}: is titled the same here as in mansion.json`, () => {
        expect(copy.title).toBe(room.title);
      });
    }
    const exhibits = room.hangings.length > 0;
    it(`${room.id}: an introduction of ${exhibits ? "60 to 110" : "25 to 50"} words, a look-for line${exhibits ? ", a limit" : ""}`, () => {
      const n = measure(locale, copy.intro);
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
        const n = measure(locale, copy.caption);
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
    expect(roomTitle(labels, "orrery")).toBe("orrery");
    expect(roomTitle(labels, "hall")).toBe("hall");
    expect(roomTitle(await labelsFor("de"), "hall")).toBe("Halle");
    expect(roomTitle(labels, "nowhere")).toBeUndefined();
    expect(roomTitle(null, "hall")).toBeUndefined();
  });
});
