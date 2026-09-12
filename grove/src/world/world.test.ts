import { describe, expect, it } from "vitest";
import { MEDIA_BASE } from "../config";
import { BundleRefSchema } from "./schema";
import { bundleUrl } from "./world";
import type { ExhibitRow } from "./exhibits";

// Precedence: what is hung on the tree now, else the pinned hash, else a dev
// path. A hanging that names only an exhibit resolves to nothing until one is
// hung, and that is a notice, not a broken room.

const hung: ExhibitRow = {
  id: 7n,
  tree: "einstruct",
  kind: "clip",
  title: "",
  url: "https://media.weichseltree.com/ffffffffffffffff/master.m3u8",
  thumbUrl: "",
  tapeUrl: "",
};

describe("bundleUrl", () => {
  it("prefers the live exhibit over the pinned id over the dev path", () => {
    const ref = BundleRefSchema.parse({
      exhibit: { tree: "einstruct", kind: "video" },
      id: "2dc8ca525724aefd",
      path: "/dev-video/",
    });
    expect(bundleUrl(ref, [hung])).toBe("https://media.weichseltree.com/ffffffffffffffff/");
    expect(bundleUrl(ref, [])).toBe(`${MEDIA_BASE}/2dc8ca525724aefd/`);
    expect(bundleUrl(BundleRefSchema.parse({ path: "/dev-video" }))).toBe("/dev-video/");
  });

  it("is null when only an exhibit is named and nothing hangs there", () => {
    const ref = BundleRefSchema.parse({ exhibit: { tree: "spectre", kind: "tape" } });
    expect(bundleUrl(ref, [hung])).toBeNull();
  });
});
