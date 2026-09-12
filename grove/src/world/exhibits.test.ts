import { describe, expect, it } from "vitest";
import { bundleBaseOf, pickExhibit, type ExhibitRow } from "./exhibits";

// A hanging that names a tree and a kind takes the LATEST row hung there, so
// `orchard exhibit hang` of a new bundle changes what visitors see without a
// client deploy; a video wall accepts a clip or a master, never a tape.

const row = (id: number, tree: string, kind: string, url: string, tapeUrl = ""): ExhibitRow => ({
  id: BigInt(id),
  tree,
  kind,
  title: "",
  url,
  thumbUrl: "",
  tapeUrl,
});

const M = "https://media.weichseltree.com";
const rows = [
  row(1, "einstruct", "clip", `${M}/aaaaaaaaaaaaaaaa/master.m3u8`),
  row(2, "einstruct", "tape", `${M}/bbbbbbbbbbbbbbbb/bundle.json`, `${M}/bbbbbbbbbbbbbbbb/bundle.json`),
  row(3, "spectre", "master", `${M}/cccccccccccccccc/master.m3u8`),
  row(4, "einstruct", "master", `${M}/dddddddddddddddd/master.m3u8`),
  row(5, "einstruct", "still", `${M}/eeeeeeeeeeeeeeee/full.avif`),
];

describe("pickExhibit", () => {
  it("takes the latest row of a kind the hanging can show", () => {
    expect(pickExhibit(rows, "einstruct", "video")?.id).toBe(4n);
    expect(pickExhibit(rows, "einstruct", "tape")?.id).toBe(2n);
    expect(pickExhibit(rows, "spectre", "video")?.id).toBe(3n);
  });

  it("is null when nothing of that kind hangs on that tree", () => {
    expect(pickExhibit(rows, "spectre", "tape")).toBeNull();
    expect(pickExhibit([], "einstruct", "video")).toBeNull();
  });
});

describe("bundleBaseOf", () => {
  it("is the row's url with the file cut off, tape_url preferred", () => {
    expect(bundleBaseOf(rows[0]!)).toBe(`${M}/aaaaaaaaaaaaaaaa/`);
    expect(bundleBaseOf(rows[1]!)).toBe(`${M}/bbbbbbbbbbbbbbbb/`);
    expect(bundleBaseOf({ url: "noslash", tapeUrl: "" })).toBe("noslash/");
  });
});
