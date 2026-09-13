import {
  BufferAttribute,
  BufferGeometry,
  CompressedTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
} from "three";
import { describe, expect, it } from "vitest";
import { applyLightmap, prepareLightmap } from "./lightmap";

// WP3's bake lands on UV2. These are the three ways it can arrive and what the
// loader has to do with each; the glb round trip itself waits on WP3's export.

function meshWith(uvSets: 1 | 2, material = new MeshStandardMaterial()): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(6), 2));
  if (uvSets === 2) geometry.setAttribute("uv1", new BufferAttribute(new Float32Array(6), 2));
  return new Mesh(geometry, material);
}

describe("prepareLightmap", () => {
  it("binds the texture to the second UV set, unflipped, in sRGB", () => {
    const texture = prepareLightmap(new Texture());
    expect(texture.channel).toBe(1);
    expect(texture.flipY).toBe(false);
    expect(texture.colorSpace).toBe(SRGBColorSpace);
  });

  it("keeps the mip levels a KTX2 arrives with and samples them trilinearly", () => {
    const level = (size: number) => ({ data: new Uint8Array(8), width: size, height: size });
    const texture = prepareLightmap(new CompressedTexture([level(4), level(2), level(1)], 4, 4));
    expect(texture.minFilter).toBe(LinearMipmapLinearFilter);
    expect(texture.magFilter).toBe(LinearFilter);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.channel).toBe(1);
    expect(texture.flipY).toBe(false);
  });

  it("stays bilinear on a KTX2 without mips, which three cannot generate", () => {
    const texture = prepareLightmap(
      new CompressedTexture([{ data: new Uint8Array(8), width: 4, height: 4 }], 4, 4),
    );
    expect(texture.minFilter).toBe(LinearFilter);
    expect(texture.generateMipmaps).toBe(false);
  });

  it("has three generate mips for the PNG fallback", () => {
    const texture = prepareLightmap(new Texture());
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.minFilter).toBe(LinearMipmapLinearFilter);
    expect(texture.magFilter).toBe(LinearFilter);
  });
});

describe("applyLightmap", () => {
  it("binds a sibling texture to every standard material with a second UV set", () => {
    const root = new Group();
    const lit = meshWith(2);
    const unlit = meshWith(1);
    root.add(lit, unlit);
    const texture = new Texture();
    const report = applyLightmap(root, texture);
    expect(report).toMatchObject({ applied: 1, withUv1: 1, source: "sibling" });
    expect((lit.material as MeshStandardMaterial).lightMap).toBe(texture);
    expect((lit.material as MeshStandardMaterial).lightMap!.channel).toBe(1);
    expect((unlit.material as MeshStandardMaterial).lightMap).toBeNull();
  });

  it("keeps a lightmap the glb already embedded, and does not overwrite it", () => {
    const embedded = new Texture();
    const material = new MeshStandardMaterial();
    material.lightMap = embedded;
    const root = new Group();
    root.add(meshWith(2, material));
    const report = applyLightmap(root, new Texture());
    expect(report.source).toBe("embedded");
    expect(material.lightMap).toBe(embedded);
    expect(embedded.channel).toBe(1);
  });

  it("accepts the old uv2 attribute name and aliases it to uv1", () => {
    const mesh = meshWith(1);
    mesh.geometry.setAttribute("uv2", new BufferAttribute(new Float32Array(6), 2));
    const root = new Group();
    root.add(mesh);
    const report = applyLightmap(root, new Texture());
    expect(mesh.geometry.getAttribute("uv1")).toBeDefined();
    expect(report.applied).toBe(1);
  });

  it("reports none, and changes nothing, when there is no lightmap to bind", () => {
    const root = new Group();
    const mesh = meshWith(2);
    root.add(mesh);
    const report = applyLightmap(root, null);
    expect(report).toMatchObject({ applied: 0, withUv1: 1, source: "none" });
    expect((mesh.material as MeshStandardMaterial).lightMap).toBeNull();
  });

  it("leaves materials that have no lightmap slot alone", () => {
    const root = new Group();
    root.add(meshWith(2, new MeshBasicMaterial() as unknown as MeshStandardMaterial));
    expect(applyLightmap(root, new Texture()).applied).toBe(0);
  });
});
