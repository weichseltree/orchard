import { afterEach, describe, expect, it, vi } from "vitest";
import { BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
import type { Renderer } from "../render/types";
import { ModelExhibit } from "./model-exhibit";
import { ModelHangingSchema } from "./schema";

// The exhibit itself, on a real glb parsed by three's GLTFLoader: a unit
// triangle built here byte by byte, the same shape tests/test_model.py builds.

function triangleGlb({ scenes = 1, metallic = true } = {}): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    // No material is glTF's default, metalness 1; a matte one says metallicFactor 0.
    ...(metallic ? {} : { materials: [{ pbrMetallicRoughness: { metallicFactor: 0 } }] }),
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, ...(metallic ? {} : { material: 0 }) }] }],
    nodes: [{ mesh: 0 }],
    ...(scenes ? { scenes: Array.from({ length: scenes }, () => ({ nodes: [0] })), scene: 0 } : {}),
  };
  let text = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
  padded.set(text);
  text = padded;
  const total = 12 + 8 + text.length + 8 + positions.byteLength;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, text.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out, 20, text.length).set(text);
  const bin = 20 + text.length;
  view.setUint32(bin, positions.byteLength, true);
  view.setUint32(bin + 4, 0x004e4942, true);
  new Uint8Array(out, bin + 8).set(new Uint8Array(positions.buffer));
  return out;
}

const bundle = {
  schema: "orchard/bundle/1", kind: "model", id: "0123456789abcdef", tree: "arcedit", title: "a triangle",
  model: "model.glb", poster: "", bytes: 100, triangles: 1, draws: 1,
  bbox: { min: [0, 0, 0], max: [1, 1, 0] }, extensions_used: [], extensions_required: [],
};

function stubBundle(doc: Record<string, unknown> = bundle): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(doc), { status: 200 })));
}

const hanging = ModelHangingSchema.parse({
  id: "tri", kind: "model", bundle: { id: "0123456789abcdef" },
  position: [10, 2, -4], sizeMeters: 2, plinth: { heightMeters: 1 }, yawSpinDegPerSec: 90,
});
const renderer = {} as Renderer;
const base = "https://media.weichseltree.com/0123456789abcdef/";

afterEach(() => vi.unstubAllGlobals());

describe("ModelExhibit", () => {
  it("stands the glb scaled on its plinth, turns it, and says what it is", async () => {
    stubBundle();
    const bytes = vi.fn(async () => triangleGlb());
    const model = await ModelExhibit.load({ hanging, baseUrl: base, renderer, tier: "desktop", bytes });
    expect(bytes).toHaveBeenCalledWith(`${base}model.glb`);
    expect(model.placement.scale).toBeCloseTo(2);
    expect(model.group.position.toArray()).toEqual([10, 2, -4]);
    // Plinth top at y 3, the 2 m triangle over it; the turning model's box holds its circle.
    expect(model.bounds.min.y).toBeCloseTo(2);
    expect(model.bounds.max.y).toBeCloseTo(5);
    const r = Math.hypot(2, 0) / 2;
    expect(model.bounds.max.x).toBeGreaterThanOrEqual(10 + r - 1e-6);
    const pivot = model.group.children.find((c) => c.name !== "plinth")!;
    model.update(1);
    expect(pivot.rotation.y).toBeCloseTo(Math.PI / 2);
    const record = model.provenance();
    expect(record).toMatchObject({ kind: "model", bundle_id: "0123456789abcdef", triangles: 1, draw_calls: 1, turntable: "90.0 deg/s" });
  });

  it("stands still on a phone", async () => {
    stubBundle();
    const model = await ModelExhibit.load({ hanging, baseUrl: base, renderer, tier: "phone", bytes: async () => triangleGlb() });
    const pivot = model.group.children.find((c) => c.name !== "plinth")!;
    model.update(1);
    expect(pivot.rotation.y).toBe(0);
    expect(model.provenance().turntable).toBe("still");
  });

  it("disposes every geometry and material it made, once", async () => {
    stubBundle();
    const model = await ModelExhibit.load({ hanging, baseUrl: base, renderer, tier: "desktop", bytes: async () => triangleGlb() });
    const geometries: BufferGeometry[] = [];
    model.group.traverse((node) => { if (node instanceof Mesh) geometries.push(node.geometry); });
    expect(geometries).toHaveLength(2);
    const disposed = vi.fn();
    for (const g of geometries) g.addEventListener("dispose", disposed);
    model.dispose();
    model.dispose();
    expect(disposed).toHaveBeenCalledTimes(2);
  });

  it("refuses a Draco glb before downloading it", async () => {
    stubBundle({ ...bundle, extensions_required: ["KHR_draco_mesh_compression"] });
    const bytes = vi.fn(async () => triangleGlb());
    await expect(ModelExhibit.load({ hanging, baseUrl: base, renderer, tier: "desktop", bytes })).rejects.toThrow(/cannot decode/);
    expect(bytes).not.toHaveBeenCalled();
  });
});

describe("ModelExhibit, review fixes", () => {
  it("gives the glb's reflecting materials one shared environment map, freed with the last model", async () => {
    stubBundle();
    const env = new Texture();
    const disposedEnv = vi.fn();
    const build = vi.fn(() => ({ texture: env, dispose: disposedEnv }));
    // Its own renderer: the shared map is per renderer, and the tests above hold the other one's.
    const own = {} as Renderer;
    const load = () => ModelExhibit.load({ hanging, baseUrl: base, renderer: own, tier: "desktop", bytes: async () => triangleGlb(), environment: build });
    const first = await load();
    const second = await load();
    expect(build).toHaveBeenCalledOnce();
    const materials: MeshStandardMaterial[] = [];
    first.group.traverse((node) => { if (node instanceof Mesh && node.name !== "plinth") materials.push(node.material as MeshStandardMaterial); });
    expect(materials.length).toBeGreaterThan(0);
    for (const material of materials) {
      expect(material.envMap).toBe(env);
      expect(material.envMapIntensity).toBe(1);
    }
    const matte = await ModelExhibit.load({ hanging, baseUrl: base, renderer: own, tier: "desktop", bytes: async () => triangleGlb({ metallic: false }), environment: build });
    matte.group.traverse((node) => {
      if (node instanceof Mesh && node.name !== "plinth") expect((node.material as MeshStandardMaterial).envMapIntensity).toBe(0.35);
    });
    matte.dispose();
    first.dispose();
    expect(disposedEnv).not.toHaveBeenCalled();
    second.dispose();
    expect(disposedEnv).toHaveBeenCalledOnce();
  });

  it("fails with a reason when the glb has no scene, or does not download", async () => {
    stubBundle();
    await expect(ModelExhibit.load({ hanging, baseUrl: base, renderer, tier: "desktop", bytes: async () => triangleGlb({ scenes: 0 }) }))
      .rejects.toThrow("model.glb has no scene to show");
    stubBundle();
    await expect(ModelExhibit.load({ hanging, baseUrl: base, renderer, tier: "desktop", bytes: async () => { throw new Error("HTTP 404"); } }))
      .rejects.toThrow("model.glb could not load (HTTP 404)");
  });

  it("frees what the loader parsed when the exhibit cannot be built, and keeps what a shown scene shares", async () => {
    const disposed = vi.spyOn(BufferGeometry.prototype, "dispose");
    stubBundle();
    const broken = () => { throw new Error("no GL"); };
    await expect(ModelExhibit.load({ hanging, baseUrl: base, renderer: {} as Renderer, tier: "desktop", bytes: async () => triangleGlb(), environment: broken }))
      .rejects.toThrow("no GL");
    expect(disposed).toHaveBeenCalled();
    disposed.mockClear();
    stubBundle();
    const model = await ModelExhibit.load({ hanging, baseUrl: base, renderer, tier: "desktop", bytes: async () => triangleGlb({ scenes: 2 }) });
    // The second scene places the same mesh: its geometry is the shown one's and stays.
    expect(disposed).not.toHaveBeenCalled();
    disposed.mockRestore();
    model.dispose();
  });

  it("frames a loaded model by its own box, not the plinth under it", async () => {
    stubBundle();
    const model = await ModelExhibit.load({ hanging, baseUrl: base, renderer, tier: "desktop", bytes: async () => triangleGlb() });
    expect(model.modelBounds.min.y).toBeCloseTo(3);
    expect(model.bounds.min.y).toBeCloseTo(2);
    model.dispose();
  });
});
