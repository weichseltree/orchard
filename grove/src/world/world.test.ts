import { describe, expect, it } from "vitest";
import { MEDIA_BASE } from "../config";
import { BundleRefSchema } from "./schema";
import { Quaternion, Vector3 } from "three";
import { bundleUrl, placeStill } from "./world";
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

describe("placeStill", () => {
  const hanging = { position: [6.98, 3.1, 0] as [number, number, number], rotationDeg: [0, -90, 0] as [number, number, number], widthMeters: 6, heightMeters: 3.4 };

  it("sits a centimetre in front of the asset's poster panel, facing into the room", () => {
    // WP3's poster_wall: centre (7.04, 3.1, 0), local -Z = (-1, 0, 0), 6 x 3.4 m.
    const place = placeStill(hanging, {
      position: [7.04, 3.1, 0],
      quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      width: 6,
      height: 3.4,
    });
    const normal = new Vector3(0, 0, 1).applyQuaternion(place.quaternion);
    expect(normal.x).toBeCloseTo(-1);
    expect(place.position.x).toBeCloseTo(7.03);
    expect(place.position.y).toBeCloseTo(3.1);
    expect(place.maxWidth).toBe(6);
  });

  it("falls back to mansion.json's metres for the grey shell", () => {
    const place = placeStill(hanging, null);
    const normal = new Vector3(0, 0, 1).applyQuaternion(place.quaternion);
    expect(normal.x).toBeCloseTo(-1);
    expect(place.position).toEqual(new Vector3(6.98, 3.1, 0));
    expect(place.quaternion).toBeInstanceOf(Quaternion);
    expect(place.maxHeight).toBe(3.4);
  });
});
