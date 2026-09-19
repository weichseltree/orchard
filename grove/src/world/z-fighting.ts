import { InstancedMesh, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from "three";
import type { Mansion, Room } from "./schema";

/** A detected coplanar or near-coplanar face overlap that causes visual Z-fighting. */
export interface ZFightingWarning {
  id: string;
  room: string;
  plane: "horizontal" | "vertical-x" | "vertical-z" | "angled";
  normal: [number, number, number];
  coordinate: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  overlapArea: number;
  materials: [string, string];
  nodes: [string, string];
  suggestedFix: string;
}

/** A group of related Z-fighting warnings sharing a plane, room, or material pair. */
export interface ZFightingGroup {
  groupKey: string;
  room: string;
  plane: string;
  coordinate: number;
  count: number;
  totalOverlapArea: number;
  materials: [string, string];
  warnings: ZFightingWarning[];
  recommendation: string;
}

interface FaceSpec {
  nodeName: string;
  materialName: string;
  instanceIndex: number;
  normal: Vector3;
  planeDistance: number;
  planeType: "horizontal" | "vertical-x" | "vertical-z" | "angled";
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

const EPSILON_PLANE_DIST = 0.003; // Within 3mm of each other
const MIN_OVERLAP_AREA = 0.002; // At least 20 cm^2 overlap to avoid edge-touching false positives

/**
 * Extracts planar exterior box faces from all meshes and instanced meshes in an Object3D hierarchy.
 */
export function extractFaces(root: Object3D): FaceSpec[] {
  const faces: FaceSpec[] = [];
  const matrix = new Matrix4();
  const pos = new Vector3();
  const scale = new Vector3();
  const quat = new Quaternion();

  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const isInstanced = node instanceof InstancedMesh;
    const count = isInstanced ? node.count : 1;
    const nodeName = node.name || "mesh";
    const matName = Array.isArray(node.material)
      ? node.material[0]?.name || "default"
      : node.material?.name || nodeName.replace("observatory-box-", "");

    for (let i = 0; i < count; i++) {
      if (isInstanced) {
        node.getMatrixAt(i, matrix);
      } else {
        matrix.copy(node.matrixWorld);
      }
      matrix.decompose(pos, quat, scale);

      // We inspect axis-aligned faces (top +Y, bottom -Y, east +X, west -X, north -Z, south +Z):
      // 1. Top face (+Y)
      faces.push({
        nodeName,
        materialName: matName,
        instanceIndex: i,
        normal: new Vector3(0, 1, 0),
        planeDistance: pos.y + scale.y / 2,
        planeType: "horizontal",
        minU: pos.x - scale.x / 2,
        maxU: pos.x + scale.x / 2,
        minV: pos.z - scale.z / 2,
        maxV: pos.z + scale.z / 2,
        bounds: {
          min: [pos.x - scale.x / 2, pos.y + scale.y / 2, pos.z - scale.z / 2],
          max: [pos.x + scale.x / 2, pos.y + scale.y / 2, pos.z + scale.z / 2],
        },
      });

      // 2. Bottom face (-Y)
      faces.push({
        nodeName,
        materialName: matName,
        instanceIndex: i,
        normal: new Vector3(0, -1, 0),
        planeDistance: -(pos.y - scale.y / 2),
        planeType: "horizontal",
        minU: pos.x - scale.x / 2,
        maxU: pos.x + scale.x / 2,
        minV: pos.z - scale.z / 2,
        maxV: pos.z + scale.z / 2,
        bounds: {
          min: [pos.x - scale.x / 2, pos.y - scale.y / 2, pos.z - scale.z / 2],
          max: [pos.x + scale.x / 2, pos.y - scale.y / 2, pos.z + scale.z / 2],
        },
      });

      // 3. West face (-X)
      faces.push({
        nodeName,
        materialName: matName,
        instanceIndex: i,
        normal: new Vector3(-1, 0, 0),
        planeDistance: -(pos.x - scale.x / 2),
        planeType: "vertical-x",
        minU: pos.z - scale.z / 2,
        maxU: pos.z + scale.z / 2,
        minV: pos.y - scale.y / 2,
        maxV: pos.y + scale.y / 2,
        bounds: {
          min: [pos.x - scale.x / 2, pos.y - scale.y / 2, pos.z - scale.z / 2],
          max: [pos.x - scale.x / 2, pos.y + scale.y / 2, pos.z + scale.z / 2],
        },
      });

      // 4. East face (+X)
      faces.push({
        nodeName,
        materialName: matName,
        instanceIndex: i,
        normal: new Vector3(1, 0, 0),
        planeDistance: pos.x + scale.x / 2,
        planeType: "vertical-x",
        minU: pos.z - scale.z / 2,
        maxU: pos.z + scale.z / 2,
        minV: pos.y - scale.y / 2,
        maxV: pos.y + scale.y / 2,
        bounds: {
          min: [pos.x + scale.x / 2, pos.y - scale.y / 2, pos.z - scale.z / 2],
          max: [pos.x + scale.x / 2, pos.y + scale.y / 2, pos.z + scale.z / 2],
        },
      });

      // 5. North face (-Z)
      faces.push({
        nodeName,
        materialName: matName,
        instanceIndex: i,
        normal: new Vector3(0, 0, -1),
        planeDistance: -(pos.z - scale.z / 2),
        planeType: "vertical-z",
        minU: pos.x - scale.x / 2,
        maxU: pos.x + scale.x / 2,
        minV: pos.y - scale.y / 2,
        maxV: pos.y + scale.y / 2,
        bounds: {
          min: [pos.x - scale.x / 2, pos.y - scale.y / 2, pos.z - scale.z / 2],
          max: [pos.x + scale.x / 2, pos.y + scale.y / 2, pos.z - scale.z / 2],
        },
      });

      // 6. South face (+Z)
      faces.push({
        nodeName,
        materialName: matName,
        instanceIndex: i,
        normal: new Vector3(0, 0, 1),
        planeDistance: pos.z + scale.z / 2,
        planeType: "vertical-z",
        minU: pos.x - scale.x / 2,
        maxU: pos.x + scale.x / 2,
        minV: pos.y - scale.y / 2,
        maxV: pos.y + scale.y / 2,
        bounds: {
          min: [pos.x - scale.x / 2, pos.y - scale.y / 2, pos.z + scale.z / 2],
          max: [pos.x + scale.x / 2, pos.y + scale.y / 2, pos.z + scale.z / 2],
        },
      });
    }
  });

  return faces;
}

/**
 * Detects Z-fighting hazards (overlapping coplanar faces) within an Object3D hierarchy (such as a room shell).
 * Uses plane bucketing to achieve fast O(N) performance.
 */
export function detectZFighting(root: Object3D, roomId = "unknown"): ZFightingWarning[] {
  const faces = extractFaces(root);
  const warnings: ZFightingWarning[] = [];

  // Bucket faces by planeType, normal, and quantized plane distance:
  const buckets = new Map<string, FaceSpec[]>();

  for (const face of faces) {
    // Quantize distance to ~0.003m buckets:
    const qDist = Math.round(face.planeDistance / EPSILON_PLANE_DIST);
    const key = `${face.planeType}:${face.normal.x},${face.normal.y},${face.normal.z}:${qDist}`;
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    list.push(face);
  }

  for (const list of buckets.values()) {
    if (list.length < 2) continue;

    // Sort by minU to enable early-exit sweep line:
    list.sort((f1, f2) => f1.minU - f2.minU);

    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;

        // Sweep-line early exit: if b starts to the right of a's right edge,
        // no subsequent b can overlap a in U.
        if (b.minU >= a.maxU - 0.01) break;

        // Exact distance gap check:
        const distGap = Math.abs(a.planeDistance - b.planeDistance);
        if (distGap > EPSILON_PLANE_DIST) continue;

        // Check 2D overlap on the plane:
        const overlapMinV = Math.max(a.minV, b.minV);
        const overlapMaxV = Math.min(a.maxV, b.maxV);
        const spanV = overlapMaxV - overlapMinV;
        if (spanV <= 0.01) continue;

        const overlapMinU = b.minU; // since b.minU >= a.minU (sorted)
        const overlapMaxU = Math.min(a.maxU, b.maxU);
        const spanU = overlapMaxU - overlapMinU;
        if (spanU <= 0.01) continue;

        const area = spanU * spanV;
        if (area < MIN_OVERLAP_AREA) continue;

        // Generate suggested fix based on materials:
        let suggestedFix = `Add a small standoff offset (e.g. +0.006m) or trim overlapping extents.`;
        if (a.materialName === b.materialName) {
          suggestedFix = `Duplicate geometry detected with identical material "${a.materialName}". Consolidate instances or merge overlapping blocks.`;
        } else if (a.planeType === "horizontal") {
          suggestedFix = `Apply standard vertical offset (+0.006m) to decorative overlay ("${b.materialName}") above base ("${a.materialName}").`;
        }

        const coord =
          a.planeType === "horizontal"
            ? a.planeDistance
            : a.planeType === "vertical-x"
            ? Math.abs(a.planeDistance) * (a.normal.x >= 0 ? 1 : -1)
            : Math.abs(a.planeDistance) * (a.normal.z >= 0 ? 1 : -1);

        warnings.push({
          id: `${roomId}-${a.planeType}-${coord.toFixed(2)}-${a.instanceIndex}-${b.instanceIndex}`,
          room: roomId,
          plane: a.planeType,
          normal: [a.normal.x, a.normal.y, a.normal.z],
          coordinate: coord,
          bounds: {
            min: [
              Math.min(a.bounds.min[0], b.bounds.min[0]),
              Math.min(a.bounds.min[1], b.bounds.min[1]),
              Math.min(a.bounds.min[2], b.bounds.min[2]),
            ],
            max: [
              Math.max(a.bounds.max[0], b.bounds.max[0]),
              Math.max(a.bounds.max[1], b.bounds.max[1]),
              Math.max(a.bounds.max[2], b.bounds.max[2]),
            ],
          },
          overlapArea: Number(area.toFixed(4)),
          materials: [a.materialName, b.materialName],
          nodes: [a.nodeName, b.nodeName],
          suggestedFix,
        });
      }
    }
  }

  return warnings;
}

/**
 * Groups Z-fighting warnings by room, plane, and coordinate to allow batch inspection and fixing.
 */
export function groupZFightingWarnings(warnings: readonly ZFightingWarning[]): ZFightingGroup[] {
  const groups = new Map<string, ZFightingGroup>();

  for (const w of warnings) {
    const key = `${w.room}:${w.plane}:${w.coordinate.toFixed(2)}:${[...w.materials].sort().join("+")}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        groupKey: key,
        room: w.room,
        plane: w.plane,
        coordinate: w.coordinate,
        count: 0,
        totalOverlapArea: 0,
        materials: w.materials,
        warnings: [],
        recommendation: w.suggestedFix,
      };
      groups.set(key, group);
    }
    group.count++;
    group.totalOverlapArea = Number((group.totalOverlapArea + w.overlapArea).toFixed(4));
    group.warnings.push(w);
  }

  return Array.from(groups.values()).sort((a, b) => b.totalOverlapArea - a.totalOverlapArea);
}

/**
 * Audits an entire mansion world across all designed rooms for Z-fighting warnings and grouped reports.
 */
export function auditWorldZFighting(
  mansion: Mansion,
  buildFn: (room: Room, mansion: Mansion) => { group: Object3D },
): { totalWarnings: number; groups: ZFightingGroup[]; warnings: ZFightingWarning[] } {
  const allWarnings: ZFightingWarning[] = [];

  for (const room of mansion.rooms) {
    if (room.architecture !== "observatory") continue;
    const shell = buildFn(room, mansion);
    const roomWarnings = detectZFighting(shell.group, room.id);
    allWarnings.push(...roomWarnings);
  }

  const groups = groupZFightingWarnings(allWarnings);
  return {
    totalWarnings: allWarnings.length,
    groups,
    warnings: allWarnings,
  };
}
