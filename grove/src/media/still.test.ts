import { describe, expect, it } from "vitest";
import { StillBundleSchema, pickStillTier } from "../tape/bundle";
import { fitPanel } from "./still";

// The still bundle as `orchard bundle still` writes it (c59c7baa6fd15489),
// and the two pure decisions the panel makes: which tier, and how big.

const doc = {
  schema: "orchard/bundle/1",
  kind: "still",
  id: "c59c7baa6fd15489",
  tree: "einstruct",
  title: "ab_d2 segregation, styleframe",
  width: 1920,
  height: 1080,
  tiers: [
    { name: "full", width: 1920, height: 1080, jpg: "full.jpg", avif: "full.avif" },
    { name: "phone", width: 1600, height: 900, jpg: "phone.jpg", avif: "phone.avif" },
    { name: "thumb", width: 640, height: 360, jpg: "thumb.jpg" },
  ],
  poster: "thumb.jpg",
  media: "media.json",
};

describe("StillBundleSchema", () => {
  it("parses a harvested still and refuses one with no tiers", () => {
    const bundle = StillBundleSchema.parse(doc);
    expect(bundle.tiers).toHaveLength(3);
    expect(bundle.tiers[2]!.avif).toBeUndefined();
    expect(() => StillBundleSchema.parse({ ...doc, tiers: [] })).toThrow();
    expect(() => StillBundleSchema.parse({ ...doc, kind: "video" })).toThrow();
  });
});

describe("pickStillTier", () => {
  it("gives the phone and the Quest the 1600 px tier, the desktop and PC VR the full one", () => {
    // DEVICE-TIERS.md: a 4096 px still is ~38 MB of texture on a Quest.
    const bundle = StillBundleSchema.parse(doc);
    expect(pickStillTier(bundle, "phone").name).toBe("phone");
    expect(pickStillTier(bundle, "vr-quest").name).toBe("phone");
    expect(pickStillTier(bundle, "desktop").name).toBe("full");
    expect(pickStillTier(bundle, "vr-high").name).toBe("full");
  });

  it("falls back to whatever tier exists", () => {
    const bundle = StillBundleSchema.parse({ ...doc, tiers: [doc.tiers[2]] });
    expect(pickStillTier(bundle, "desktop").name).toBe("thumb");
  });
});

describe("fitPanel", () => {
  it("keeps the aspect inside the wall's panel", () => {
    // A 16:9 still on the hall's 6 x 3.4 m panel is width-bound, just: 3.4 * 16/9 = 6.04.
    const fit = fitPanel(16 / 9, 6, 3.4);
    expect(fit.width).toBe(6);
    expect(fit.height).toBeCloseTo(3.375);
    // A square still on the same panel is also height-bound; a wide one is width-bound.
    expect(fitPanel(1, 6, 3.4)).toEqual({ width: 3.4, height: 3.4 });
    expect(fitPanel(4, 6, 3.4)).toEqual({ width: 6, height: 1.5 });
  });
});
