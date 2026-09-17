import { describe, expect, it } from "vitest";
import { RepoEntrySchema, RepoModelSchema } from "./schema";
import mansionDocument from "./mansion.json";
import { parseMansion } from "./schema";
import { blockAt, entriesOf, fromTable, gazeBlock, layoutRepoModel, squarify, toTable } from "./repo-model";

const model = RepoModelSchema.parse({
  id: "arcedit-tree",
  position: [10, 0, 20],
  size: [2.4, 1.6],
  repo: "test",
});
const entries = [
  { path: "arcedit", bytes: 400_000, sentence: "the package" },
  { path: "docs", bytes: 60_000 },
  { path: "results/grove", bytes: 3_000_000, room: "arcedit" },
  { path: "results/i15_perception_under_reward", bytes: 900_000, room: "arcedit/reward" },
  { path: "tests", bytes: 120_000 },
].map((entry) => RepoEntrySchema.parse(entry));

describe("squarify", () => {
  it("fills the rectangle exactly with areas in proportion", () => {
    const rects = squarify([6, 6, 4, 3, 2, 2, 1], { x: 0, z: 0, width: 6, depth: 4 });
    const areas = rects.map((r) => r.width * r.depth);
    expect(areas.reduce((a, b) => a + b, 0)).toBeCloseTo(24);
    expect(areas[0]! / areas[6]!).toBeCloseTo(6);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.z).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.width).toBeLessThanOrEqual(6 + 1e-9);
      expect(r.z + r.depth).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  it("keeps districts from collapsing into slivers", () => {
    const rects = squarify([5, 4, 3, 2, 1], { x: 0, z: 0, width: 2.4, depth: 1.6 });
    for (const r of rects) expect(Math.max(r.width / r.depth, r.depth / r.width)).toBeLessThan(4);
  });
});

describe("layoutRepoModel", () => {
  const blocks = layoutRepoModel(model, entries);

  it("implies the parents a list leaves out and nests children inside them", () => {
    const results = blocks.find((b) => b.path === "results")!;
    expect(results.leaf).toBe(false);
    for (const child of blocks.filter((b) => b.path.startsWith("results/"))) {
      expect(child.level).toBe(1);
      expect(Math.abs(child.x - results.x) + child.width / 2).toBeLessThanOrEqual(results.width / 2 + 1e-9);
      expect(Math.abs(child.z - results.z) + child.depth / 2).toBeLessThanOrEqual(results.depth / 2 + 1e-9);
      expect(child.height).toBeGreaterThan(results.height);
    }
  });

  it("stays on the table", () => {
    for (const b of blocks) {
      expect(Math.abs(b.x) + b.width / 2).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(Math.abs(b.z) + b.depth / 2).toBeLessThanOrEqual(0.8 + 1e-9);
    }
  });

  it("builds the same city from the same tree in any order", () => {
    expect(layoutRepoModel(model, [...entries].reverse())).toEqual(blocks);
  });

  it("carries the sentence and the room through", () => {
    expect(blocks.find((b) => b.path === "arcedit")!.sentence).toBe("the package");
    expect(blocks.find((b) => b.path === "results/grove")!.room).toBe("arcedit");
  });
});

describe("reading the model", () => {
  const blocks = layoutRepoModel(model, entries);

  it("turns room points into the table's frame and back", () => {
    const turned = { ...model, yawDeg: 37 };
    const local = toTable(turned, 10.4, 19.3);
    const back = fromTable(turned, local.x, local.z);
    expect(back.x).toBeCloseTo(10.4);
    expect(back.z).toBeCloseTo(19.3);
    // A quarter turn carries the table's +x onto the room's -z, as three.js turns a mesh.
    const quarter = fromTable({ ...model, yawDeg: 90 }, 1, 0);
    expect(quarter.x).toBeCloseTo(10);
    expect(quarter.z).toBeCloseTo(19);
  });

  it("picks the deepest district under a point", () => {
    const grove = blocks.find((b) => b.path === "results/grove")!;
    expect(blockAt(blocks, grove.x, grove.z)?.path).toBe("results/grove");
    expect(blockAt(blocks, 5, 5)).toBeNull();
  });

  it("reads the district the eye looks down at, and nothing when looking up", () => {
    const grove = blocks.find((b) => b.path === "results/grove")!;
    const target = fromTable(model, grove.x, grove.z);
    const eye = { x: target.x, y: 1.6, z: target.z + 1 };
    const to = { x: 0, y: model.tableHeight - 1.6, z: -1 };
    const length = Math.hypot(to.x, to.y, to.z);
    const direction = { x: to.x / length, y: to.y / length, z: to.z / length };
    expect(gazeBlock(model, blocks, eye, direction)?.path).toBe("results/grove");
    expect(gazeBlock(model, blocks, eye, { x: 0, y: 0.2, z: -1 })).toBeNull();
  });
});

describe("the models in mansion.json", () => {
  const models = parseMansion(mansionDocument).rooms.flatMap((room) => room.repoModels.map((m) => ({ room, model: m })));

  it("each finds its repository's folders, and every room a folder names exists", () => {
    const ids = new Set(parseMansion(mansionDocument).rooms.map((r) => r.id));
    expect(models.length).toBeGreaterThan(0);
    for (const { model } of models) {
      const found = entriesOf(model);
      expect(found.length, model.repo).toBeGreaterThan(0);
      for (const entry of found) if (entry.room) expect(ids.has(entry.room), entry.room).toBe(true);
    }
  });
});
