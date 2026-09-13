import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
} from "three";
import { describe, expect, it } from "vitest";
import { OVERDRAW_OPACITY, showOverdraw } from "./overdraw";

// The debug view: every face the same faint additive white, so a doubled
// face shows as a brighter patch. Only `side` survives from the original.

describe("showOverdraw", () => {
  it("replaces single materials and material arrays alike, keeping each face's side", () => {
    const group = new Group();
    const single: Mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ side: BackSide }));
    const array: Mesh = new Mesh(new BoxGeometry(), [
      new MeshStandardMaterial({ side: FrontSide }),
      new MeshStandardMaterial({ side: DoubleSide }),
    ]);
    group.add(single, new Object3D().add(array));

    expect(showOverdraw(group)).toBe(2);

    const one = single.material as MeshBasicMaterial;
    expect(one).toBeInstanceOf(MeshBasicMaterial);
    expect(one.side).toBe(BackSide);
    expect(one.color.getHex()).toBe(0xffffff);
    expect(one.opacity).toBe(OVERDRAW_OPACITY);
    expect(one.transparent).toBe(true);
    expect(one.blending).toBe(AdditiveBlending);
    expect(one.depthTest).toBe(false);
    expect(one.depthWrite).toBe(false);

    const many = array.material as MeshBasicMaterial[];
    expect(many).toHaveLength(2);
    expect(many.map((m) => m.side)).toEqual([FrontSide, DoubleSide]);
    for (const m of many) expect(m).toBeInstanceOf(MeshBasicMaterial);
  });

  it("changes nothing that is not a mesh", () => {
    expect(showOverdraw(new Group().add(new Object3D()))).toBe(0);
  });
});
