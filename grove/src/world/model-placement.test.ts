import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import en from "./labels/en.json";
import { ModelBundleSchema } from "../tape/model-bundle";
import { pickExhibit, type ExhibitRow } from "./exhibits";
import { framingPose, hangingFace } from "./framing";
import { planRoomLabels } from "./labels";
import { parseLabels } from "./labels/index";
import { PLINTH_MARGIN_M, modelPlacement, spinRate } from "./model-placement";
import { insideRoom } from "./navigation";
import { HangingSchema, ModelHangingSchema, parseMansion, roomById, type ModelHanging, type Room } from "./schema";

// A `model` hanging: a glb from a model bundle on a plinth. Its placement is
// read from the bundle's bbox and the scene document alone, so these need no
// glb, no loader and no WebGL.

const mansion = parseMansion(mansionDocument);
const hall = roomById(mansion, "hall")!;

/** What `orchard bundle model` writes (tests/test_model.py), trimmed. */
const bundleDoc = {
  schema: "orchard/bundle/1",
  kind: "model",
  id: "0123456789abcdef",
  tree: "arcedit",
  title: "a chair",
  produced_by: "uv run orchard bundle model chair.glb --tree arcedit --title \"a chair\"",
  source: { file: "chair.glb", file_sha256: "ab", bytes: 1024, tree_commit: "abc1234" },
  model: "model.glb",
  poster: "poster.jpg",
  bytes: 1024,
  triangles: 1200,
  draws: 3,
  bbox: { min: [-0.25, 0, -0.5], max: [0.25, 2, 0.5] },
  size: [0.5, 2, 1],
  meshes: 1, nodes: 2, materials: 1, textures: 0, animations: 0,
  extensions_used: [], extensions_required: [], generator: "test",
  budget: { bytes: 8000000, triangles: 150000, draws: 256 },
  files: { "model.glb": { sha256: "cd", bytes: 1024 } },
};

function modelHanging(extra: Record<string, unknown> = {}): ModelHanging {
  return ModelHangingSchema.parse({
    id: "chair",
    kind: "model",
    bundle: { exhibit: { tree: "arcedit", kind: "model" } },
    position: [hall.spawn.position[0], hall.bounds.min[1], hall.spawn.position[2] - 6],
    ...extra,
  });
}

describe("the model hanging and its bundle", () => {
  it("parses with its defaults, through the hanging union too", () => {
    const h = modelHanging();
    expect(h.sizeMeters).toBe(1);
    expect(h.plinth).toBeUndefined();
    expect(h.yawSpinDegPerSec).toBe(0);
    expect(h.rotationDeg).toEqual([0, 0, 0]);
    const withPlinth = HangingSchema.parse({ ...h, plinth: {} });
    expect(withPlinth.kind === "model" && withPlinth.plinth?.heightMeters).toBe(0.9);
    expect(() => ModelHangingSchema.parse({ ...h, sizeMeters: 0 })).toThrow();
    expect(() => HangingSchema.parse({ ...h, bundle: { exhibit: { tree: "arcedit", kind: "mesh" } } })).toThrow();
  });

  it("reads the bundle the Python bundler writes and refuses an inside-out bbox", () => {
    const bundle = ModelBundleSchema.parse(bundleDoc);
    expect(bundle.model).toBe("model.glb");
    expect(bundle.bbox.max).toEqual([0.25, 2, 0.5]);
    expect((bundle as Record<string, unknown>).generator).toBe("test");
    expect(() => ModelBundleSchema.parse({ ...bundleDoc, bbox: { min: [1, 0, 0], max: [0, 1, 1] } })).toThrow();
    expect(() => ModelBundleSchema.parse({ ...bundleDoc, kind: "still" })).toThrow();
  });

  it("takes a model row for a model hanging, and nothing else's", () => {
    const M = "https://media.weichseltree.com";
    const row = (id: number, kind: string, bid: string): ExhibitRow =>
      ({ id: BigInt(id), tree: "arcedit", kind, title: "", url: `${M}/${bid}/bundle.json`, thumbUrl: "", tapeUrl: "" });
    const rows = [row(1, "model", "aaaaaaaaaaaaaaaa"), row(2, "planet", "bbbbbbbbbbbbbbbb"), row(3, "model", "cccccccccccccccc")];
    expect(pickExhibit(rows, "arcedit", "model")?.id).toBe(3n);
    expect(pickExhibit(rows, "arcedit", "model", "aaaaaaaaaaaaaaaa")?.id).toBe(1n);
    expect(pickExhibit(rows, "arcedit", "planet")?.id).toBe(2n);
    expect(pickExhibit([row(4, "still", "dddddddddddddddd")], "arcedit", "model")).toBeNull();
  });
});

describe("where a model stands", () => {
  const bbox = ModelBundleSchema.parse(bundleDoc).bbox;

  it("scales its longest side to sizeMeters and stands it centred on the plinth's top", () => {
    const p = modelPlacement(bbox, modelHanging({ sizeMeters: 1.5, plinth: { heightMeters: 0.8 } }));
    expect(p.scale).toBeCloseTo(0.75);
    expect(p.size).toEqual([0.375, 1.5, 0.75]);
    // Centred on x and z; its lowest point (y = 0 in the file) on the pivot.
    expect(p.offset[0]).toBeCloseTo(0);
    expect(p.offset[1]).toBeCloseTo(0);
    expect(p.offset[2]).toBeCloseTo(0);
    expect(p.plinthHeight).toBe(0.8);
    expect(p.plinthSize[0]).toBeCloseTo(0.375 + 2 * PLINTH_MARGIN_M);
    expect(p.plinthSize[1]).toBeCloseTo(0.75 + 2 * PLINTH_MARGIN_M);
  });

  it("moves an off-centre model onto the pivot and lifts one that hangs below its origin", () => {
    const p = modelPlacement({ min: [2, -1, 4], max: [4, 1, 5] }, modelHanging({ sizeMeters: 1 }));
    expect(p.scale).toBeCloseTo(0.5);
    expect(p.offset).toEqual([-1.5, 0.5, -2.25]);
    expect(p.plinthHeight).toBe(0);
    expect(p.plinthSize).toEqual([0, 0]);
    expect(modelPlacement({ min: [1, 1, 1], max: [1, 1, 1] }, modelHanging()).scale).toBe(1);
  });

  it("gives a turntable a plinth that holds the circle it sweeps, and stands still on a phone", () => {
    const spinning = modelHanging({ sizeMeters: 2, plinth: {}, yawSpinDegPerSec: 12 });
    const p = modelPlacement(bbox, spinning);
    const across = Math.hypot(p.size[0], p.size[2]);
    expect(p.plinthSize[0]).toBeCloseTo(across + 2 * PLINTH_MARGIN_M);
    expect(p.plinthSize[1]).toBeCloseTo(p.plinthSize[0]);
    expect(spinRate(spinning, "desktop")).toBeCloseTo((12 * Math.PI) / 180);
    expect(spinRate(spinning, "vr-quest")).toBeCloseTo((12 * Math.PI) / 180);
    expect(spinRate(spinning, "phone")).toBe(0);
    expect(spinRate(modelHanging(), "desktop")).toBe(0);
  });

  it("is framed over its plinth from where the visitor lands", () => {
    const h = modelHanging({ sizeMeters: 1.2, plinth: { heightMeters: 0.9 } });
    const face = hangingFace(hall, h);
    expect(face.centre[1]).toBeCloseTo(hall.bounds.min[1] + 0.9 + 0.6);
    expect(face.width).toBe(1.2);
    // The spawn is 6 m in +z of the model: the face looks that way.
    expect(face.normal[0]).toBeCloseTo(0);
    expect(face.normal[1]).toBeCloseTo(1);
    const pose = framingPose(face, hall, 72, 16 / 9, 1.6);
    expect(insideRoom(hall, pose.x, pose.z)).toBe(true);
    expect(pose.z).toBeGreaterThan(h.position[2]);
  });

  it("frames a flat model that has loaded by its real height, not at the air above it", () => {
    // arcedit's env.glb stands 0.11 of its longest side: 4 m long, 0.44 m tall, on no plinth.
    const h = modelHanging({ sizeMeters: 4 });
    const floor = hall.bounds.min[1];
    const loaded = new Box3(new Vector3(h.position[0] - 2, floor, h.position[2] - 1), new Vector3(h.position[0] + 2, floor + 0.44, h.position[2] + 1));
    const guess = hangingFace(hall, h);
    const face = hangingFace(hall, h, loaded);
    expect(guess.centre[1]).toBeCloseTo(floor + 2);
    expect(face.centre[1]).toBeCloseTo(floor + 0.22);
    expect(face.height).toBeCloseTo(0.44);
    expect(face.width).toBeCloseTo(4);
    expect(hangingFace(hall, h, new Box3()).centre[1]).toBeCloseTo(floor + 2);
  });

  it("gets its lectern clear of a still model turned 45 degrees", () => {
    const h = modelHanging({ sizeMeters: 1.2, plinth: {}, rotationDeg: [0, 45, 0] });
    const room: Room = { ...hall, hangings: [h], wallLines: [] };
    const words = parseLabels({ ...en, exhibits: { ...en.exhibits, chair: { title: "A chair", caption: "Sat in." } } });
    const [plan] = planRoomLabels(room, words, mansion).filter((p) => p.hangingId === "chair");
    // A square footprint of side 1.2 turned 45 degrees reaches 0.85 m toward
    // the visitor; the lectern's 1.2 m standoff is measured from past that.
    expect(plan!.foot!.z - h.position[2]).toBeCloseTo(1.2 * Math.SQRT1_2 + PLINTH_MARGIN_M + 1.2);
  });

  it("gets its lectern clear of the plinth, on the visitor's side", () => {
    const h = modelHanging({ sizeMeters: 1.2, plinth: {}, yawSpinDegPerSec: 6 });
    const room: Room = { ...hall, hangings: [h], wallLines: [] };
    const words = parseLabels({ ...en, exhibits: { ...en.exhibits, chair: { title: "A chair", caption: "Sat in." } } });
    const plans = planRoomLabels(room, words, mansion).filter((plan) => plan.hangingId === "chair");
    expect(plans).toHaveLength(1);
    const plan = plans[0]!;
    expect(plan.mount).toBe("lectern");
    const reach = h.sizeMeters * Math.SQRT1_2 + PLINTH_MARGIN_M;
    const dz = plan.foot!.z - h.position[2];
    expect(dz).toBeGreaterThan(reach);
  });
});
