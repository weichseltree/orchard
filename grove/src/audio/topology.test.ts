import { describe, expect, it } from "vitest";
import { placeNode, placeTopology, parseTopology, type TopologyPlacement } from "./topology";

const doc = {
  schema: "orchard/topology/1",
  provider: "logswarm",
  nodes: [
    { id: "api", position: [0, 0.5, 0.5], label: "The front door" },
    { id: "worker", position: [1, 0.5, 0.5] },
  ],
  edges: [{ from: "api", to: "worker" }],
};

const placement: TopologyPlacement = { center: [10, 1.6, -4], sizeMeters: 8, yawDeg: 0 };

describe("parseTopology", () => {
  it("reads a published document and defaults the label to nothing", () => {
    const topology = parseTopology(doc);
    expect(topology.nodes.map((n) => n.id)).toEqual(["api", "worker"]);
    // An id is internal (LAWS 5); an unlabelled node is not narrated by its id.
    expect(topology.nodes[1]!.label).toBe("");
  });

  it("refuses a position outside the unit cube", () => {
    expect(() => parseTopology({ ...doc, nodes: [{ id: "a", position: [0, 0, 1.5] }] })).toThrow();
    expect(() => parseTopology({ ...doc, nodes: [{ id: "a", position: [-0.1, 0, 0] }] })).toThrow();
  });

  it("refuses duplicate node ids and an edge to a node it does not publish", () => {
    expect(() => parseTopology({
      ...doc,
      nodes: [{ id: "a", position: [0, 0, 0] }, { id: "a", position: [1, 1, 1] }],
    })).toThrow(/duplicate node id/);
    expect(() => parseTopology({
      ...doc,
      nodes: [{ id: "a", position: [0, 0, 0] }],
      edges: [{ from: "a", to: "ghost" }],
    })).toThrow(/unknown node/);
  });

  it("refuses another schema", () => {
    expect(() => parseTopology({ ...doc, schema: "orchard/topology/2" })).toThrow();
  });
});

describe("placeNode", () => {
  it("puts the cube's centre at the placement's centre", () => {
    expect(placeNode([0.5, 0.5, 0.5], placement)).toEqual([10, 1.6, -4]);
  });

  it("spans sizeMeters across the unit cube, uniformly on every axis", () => {
    expect(placeNode([0, 0.5, 0.5], placement)).toEqual([6, 1.6, -4]);
    expect(placeNode([1, 0.5, 0.5], placement)).toEqual([14, 1.6, -4]);
    expect(placeNode([0.5, 1, 0.5], placement)).toEqual([10, 5.6, -4]);
    expect(placeNode([0.5, 0.5, 0], placement)).toEqual([10, 1.6, -8]);
  });

  it("turns about the room's y and leaves height alone", () => {
    const turned = placeNode([1, 0.5, 0.5], { ...placement, yawDeg: 90 });
    // +x of the cube swings to -z after a quarter turn.
    expect(turned[0]).toBeCloseTo(10, 10);
    expect(turned[1]).toBeCloseTo(1.6, 10);
    expect(turned[2]).toBeCloseTo(-8, 10);
  });

  it("is stable: the same node and placement always land in the same metre", () => {
    const once = placeNode([0.25, 0.75, 0.125], placement);
    const again = placeNode([0.25, 0.75, 0.125], placement);
    expect(again).toEqual(once);
  });
});

describe("placeTopology", () => {
  it("places every published node, in the document's order", () => {
    const placed = placeTopology(parseTopology(doc), placement);
    expect(placed.map((n) => n.id)).toEqual(["api", "worker"]);
    expect(placed[0]!.position).toEqual([6, 1.6, -4]);
    expect(placed[0]!.label).toBe("The front door");
  });
});
