// Puts a cat's mesh into a Pose without a mixer and reads back where its skinned vertices land:
// the tests use it to check that fur rests on the floor rather than sinking into it or hovering.

import * as THREE from "three";
import type { Cat } from "./cat";
import type { Pose } from "./pose";
import { BONE_NAMES } from "./skeleton";

const DEG = Math.PI / 180;

export function applyPose(cat: Cat, pose: Pose): void {
  const e = new THREE.Euler();
  for (const name of BONE_NAMES) {
    const [x, y, z] = pose.rot[name];
    cat.bones[name].quaternion.setFromEuler(e.set(x * DEG, y * DEG, z * DEG, "YXZ"));
  }
  cat.bones.root.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
  cat.group.updateMatrixWorld(true);
}

/** Lowest world y of each part's skinned vertices, keyed like Cat.parts. */
export function lowestByPart(cat: Cat): Record<string, number> {
  const geom = cat.mesh.geometry;
  const index = geom.index!;
  const out: Record<string, number> = {};
  const v = new THREE.Vector3();
  for (const [name, { first, end }] of Object.entries(cat.parts)) {
    let low = Infinity;
    for (let f = first; f < end; f++) {
      for (let c = 0; c < 3; c++) {
        cat.mesh.getVertexPosition(index.getX(3 * f + c), v);
        v.applyMatrix4(cat.mesh.matrixWorld);
        low = Math.min(low, v.y);
      }
    }
    out[name] = low;
  }
  return out;
}
