import { AdditiveBlending, Mesh, MeshBasicMaterial, type Material, type Object3D } from "three";

// `?debug=overdraw`: every face of a room shell drawn as a faint additive
// white, depth ignored. One layer of wall is barely there; where two faces
// lie on top of each other (a wall the generator doubled, a hidden face that
// should have been dropped) the patch is twice as bright, and a face behind
// another shows through. The exhibits and the sky are left as they are.

/** The whiteness one face adds; two faces read clearly brighter than one. */
export const OVERDRAW_OPACITY = 0.06;

/**
 * Replaces every material under `root` with the overdraw material, keeping
 * only the original's `side`, so a face culled before is culled still.
 * Returns how many meshes were changed.
 */
export function showOverdraw(root: Object3D): number {
  let changed = 0;
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => overdrawMaterial(material))
      : overdrawMaterial(object.material);
    changed++;
  });
  return changed;
}

function overdrawMaterial(original: Material): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: 0xffffff,
    opacity: OVERDRAW_OPACITY,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: original.side,
  });
}
