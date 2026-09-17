import type { ModelBundle } from "../tape/model-bundle";
import type { ModelHanging } from "./schema";

// Where a `model` hanging's glb goes, from its bundle's bbox and the scene
// document alone: pure, so the plinth, the lectern (labels.ts) and the tests
// agree without loading a glb or a three.js scene.

/** How far the plinth reaches past the model's footprint on every side, metres. */
export const PLINTH_MARGIN_M = 0.15;

export interface ModelPlacement {
  /** Uniform scale from the file's units to room metres. */
  scale: number;
  /** Where the model's own origin goes, relative to the turntable's pivot (on the plinth's top, over `position`). */
  offset: [number, number, number];
  /** The plinth's top above the floor; 0 without one. */
  plinthHeight: number;
  /** The plinth's footprint (x, z), metres; [0, 0] without one. */
  plinthSize: [number, number];
  /** The scaled model's extent (x, y, z), metres. */
  size: [number, number, number];
}

/**
 * Longest bbox side to `sizeMeters`; the bbox centred over the pivot on x and
 * z, its lowest point on the pivot. A degenerate bbox (a point) keeps scale 1.
 */
export function modelPlacement(bbox: ModelBundle["bbox"], hanging: Pick<ModelHanging, "sizeMeters" | "plinth" | "yawSpinDegPerSec">): ModelPlacement {
  const { min, max } = bbox;
  const extent = [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as const;
  const longest = Math.max(...extent);
  const scale = longest > 1e-9 ? hanging.sizeMeters / longest : 1;
  const offset: [number, number, number] = [
    -((min[0] + max[0]) / 2) * scale,
    -min[1] * scale,
    -((min[2] + max[2]) / 2) * scale,
  ];
  const size: [number, number, number] = [extent[0] * scale, extent[1] * scale, extent[2] * scale];
  const plinthHeight = hanging.plinth?.heightMeters ?? 0;
  // A turning model sweeps the circle round its footprint, so the plinth under
  // a turntable is a square that holds that circle; a still one fits the
  // footprint. By the document, not the device: a phone's model stands still
  // on the same plinth.
  const across = hanging.yawSpinDegPerSec !== 0 ? Math.hypot(size[0], size[2]) : 0;
  const plinthSize: [number, number] = plinthHeight <= 0 ? [0, 0]
    : across > 0 ? [across + 2 * PLINTH_MARGIN_M, across + 2 * PLINTH_MARGIN_M]
    : [size[0] + 2 * PLINTH_MARGIN_M, size[2] + 2 * PLINTH_MARGIN_M];
  return { scale, offset, plinthHeight, plinthSize, size };
}

/** Radians per second the turntable turns on this device: none on a phone. */
export function spinRate(hanging: Pick<ModelHanging, "yawSpinDegPerSec">, tier: string): number {
  if (tier === "phone") return 0;
  return (hanging.yawSpinDegPerSec * Math.PI) / 180;
}
