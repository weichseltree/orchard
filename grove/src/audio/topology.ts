import { z } from "zod";

// The topology behind a live audio exhibit (AUDIO-STREAM.md §5). A stream has
// no geometry, so it cannot be exhibited the way a tape is; what it has is the
// DAG of the observed system. The provider publishes node positions in a unit
// space alongside the score, and the room maps that space onto its own, so
// each node can become a positioned source and a listener can turn their head
// and place a service.
//
// The document is published beside the score, under the exhibit's own name
// (`audio/live/<provider>/<stream-id>/topology.json`): it is part of the live
// exhibit, so it is never cached and never hashed (§1). An `audio` bundle
// archives its topology the same way it archives its score.

/** Each coordinate of the unit space, closed at both ends. */
const Unit = z.number().min(0).max(1);
const UnitVec3 = z.tuple([Unit, Unit, Unit]);
const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

/**
 * One observed node and where it stands in the unit cube. `y` is up, as in the
 * room, so a provider that lays its DAG out flat publishes a constant `y` and
 * gets a floor plan rather than a wall.
 *
 * `label` is what a visitor is told this is. The score's field names are
 * internal (AUDIO-STREAM.md §4, LAWS 5) and so are node ids: a label is
 * written for a listener, and an empty one means the room says nothing rather
 * than reading an id aloud.
 */
export const TopologyNodeSchema = z.looseObject({
  id: z.string().min(1),
  position: UnitVec3,
  label: z.string().default(""),
});

/** An edge of the observed DAG. Carried because the topology is the DAG, not used by the field yet. */
export const TopologyEdgeSchema = z.looseObject({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const TopologySchema = z
  .looseObject({
    schema: z.literal("orchard/topology/1"),
    provider: z.string().default(""),
    /** The stream this describes; empty when the topology is archived beside a score. */
    streamId: z.string().default(""),
    nodes: z.array(TopologyNodeSchema).min(1),
    edges: z.array(TopologyEdgeSchema).default([]),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    for (const node of doc.nodes) {
      if (ids.has(node.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate node id "${node.id}"` });
      }
      ids.add(node.id);
    }
    for (const edge of doc.edges) {
      // An edge to a node that is not published is a topology that does not
      // describe itself; the field would place one end of it nowhere.
      if (!ids.has(edge.from)) {
        ctx.addIssue({ code: "custom", message: `edge from unknown node "${edge.from}"` });
      }
      if (!ids.has(edge.to)) {
        ctx.addIssue({ code: "custom", message: `edge to unknown node "${edge.to}"` });
      }
    }
  });

export type TopologyNode = z.infer<typeof TopologyNodeSchema>;
export type TopologyEdge = z.infer<typeof TopologyEdgeSchema>;
export type Topology = z.infer<typeof TopologySchema>;

export function parseTopology(input: unknown): Topology {
  return TopologySchema.parse(input);
}

/**
 * Where a room puts the unit cube. The hanging owns this, the way a `planet`
 * hanging owns `radiusMeters`: the same topology stands small in a study and
 * large in a hall without the provider knowing which room it is in.
 */
export interface TopologyPlacement {
  /** The cube's centre, in room metres. */
  center: [number, number, number];
  /**
   * What one side of the unit cube measures here. One number for all three
   * axes, never a box: a non-uniform map would make a node's apparent
   * direction depend on which way the room is long, and the whole promise of
   * §5 is that a direction means something. A room with a low ceiling wants a
   * smaller cube, not a squashed one.
   */
  sizeMeters: number;
  /** Turn about the room's y, so the DAG faces the visitor's landing. */
  yawDeg: number;
}

/**
 * A node's position in room metres. Pure, and stable: the only inputs are the
 * published unit position and the hanging's placement, so a node stays where
 * it was across frames, across reconnects and across a stream that dropped to
 * silence and came back. That stability is what lets a listener learn where a
 * service is.
 */
export function placeNode(
  position: readonly [number, number, number],
  placement: TopologyPlacement,
): [number, number, number] {
  // The unit cube is centred before it is turned: [0,1] -> [-half, +half].
  const x = (position[0] - 0.5) * placement.sizeMeters;
  const y = (position[1] - 0.5) * placement.sizeMeters;
  const z = (position[2] - 0.5) * placement.sizeMeters;
  const yaw = (placement.yawDeg * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [
    placement.center[0] + x * cos + z * sin,
    placement.center[1] + y,
    placement.center[2] + z * cos - x * sin,
  ];
}

/** A node placed in the room: what the field needs and nothing more. */
export interface PlacedNode {
  id: string;
  label: string;
  position: [number, number, number];
}

/** Every published node, placed. Order follows the document, so it is deterministic. */
export function placeTopology(topology: Topology, placement: TopologyPlacement): PlacedNode[] {
  return topology.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    position: placeNode(node.position, placement),
  }));
}

export const PlacementSchema = z.looseObject({
  center: Vec3,
  sizeMeters: z.number().positive().default(6),
  yawDeg: z.number().default(0),
});
