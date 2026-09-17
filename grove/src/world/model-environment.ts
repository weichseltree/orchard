import {
  BackSide,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  type Texture,
  type WebGLRenderer,
} from "three";
import type { Renderer } from "../render/types";

// The light a glTF model's PBR materials reflect. GLTFLoader gives a material
// without `metallicFactor` a metalness of 1, and a fully metallic surface
// with nothing to reflect renders black under the rooms' hemisphere light. A
// PMREM of a small lit room is that something: built once, shared by every
// model on the page, and disposed when the last one goes.
//
// The room is three's RoomEnvironment (examples/jsm/environments) without its
// PointLight and its instanced boxes: its six area-light panels, the part a
// reflection mostly shows, in a softly bright shell. Those two classes are
// nowhere else in the grove, so importing RoomEnvironment drew them into the
// three chunk every visitor loads at startup (+123 B gzip, with 85 B left
// under the cap); everything used here is already in that chunk.

export type BuildEnvironment = (renderer: Renderer) => Environment | null;

/** RoomEnvironment's area lights: position, scale, radiance. */
const PANELS: ReadonlyArray<readonly [[number, number, number], [number, number, number], number]> = [
  [[-16.116, 14.37, 8.208], [0.1, 2.428, 2.739], 50],
  [[-16.109, 18.021, -8.207], [0.1, 2.425, 2.751], 50],
  [[14.904, 12.198, -1.832], [0.15, 4.265, 6.331], 17],
  [[-0.462, 8.89, 14.52], [4.38, 5.441, 0.088], 43],
  [[3.235, 11.486, -12.541], [2.5, 2.0, 0.1], 20],
  [[0.0, 20.0, 0.0], [1.0, 0.1, 1.0], 100],
];

/** The room the map is taken in; exported for the test that counts what it frees. */
export function environmentScene(): Scene {
  const scene = new Scene();
  scene.position.y = -3.5;
  const geometry = new BoxGeometry();
  const room = new Mesh(geometry, new MeshBasicMaterial({ side: BackSide, color: 0x5a5a5a }));
  room.position.set(-0.757, 13.219, 0.717);
  room.scale.set(31.713, 28.305, 28.591);
  scene.add(room);
  for (const [position, scale, radiance] of PANELS) {
    const panel = new Mesh(geometry, new MeshBasicMaterial());
    panel.material.color.setScalar(radiance);
    panel.position.set(...position);
    panel.scale.set(...scale);
    scene.add(panel);
  }
  return scene;
}

/**
 * An environment map and what owns its memory. `fromScene` hands back a
 * render target; in three r186 disposing only its `.texture` frees nothing on
 * the GPU, so the target is kept and disposed.
 */
export interface Environment {
  texture: Texture;
  dispose(): void;
}

/** A prefiltered room for a WebGL renderer; null for any other backend (WebGPU wants its own generator). */
export const buildRoomEnvironment: BuildEnvironment = (renderer) => {
  if (!(renderer as { isWebGLRenderer?: boolean }).isWebGLRenderer) return null;
  const pmrem = new PMREMGenerator(renderer as unknown as WebGLRenderer);
  const scene = environmentScene();
  try {
    const target = pmrem.fromScene(scene, 0.04);
    return { texture: target.texture, dispose: () => target.dispose() };
  } finally {
    const meshes = scene.children as Mesh<BoxGeometry, MeshBasicMaterial>[];
    meshes[0]?.geometry.dispose();
    for (const mesh of meshes) mesh.material.dispose();
    pmrem.dispose();
  }
};

let shared: { renderer: Renderer; environment: Environment | null; holders: number } | null = null;

/** Take a hold on the shared environment map; every call is matched by one `releaseEnvironment`. */
export function acquireEnvironment(renderer: Renderer, build: BuildEnvironment = buildRoomEnvironment): Texture | null {
  if (!shared || shared.renderer !== renderer) {
    // A new renderer (the page rebuilt its view): the old one's map is of no
    // use to anyone. The new entry is in place before the old map goes, so a
    // dispose that throws cannot leave the stale entry shared.
    const old = shared;
    shared = { renderer, environment: build(renderer), holders: 0 };
    old?.environment?.dispose();
  }
  shared.holders += 1;
  return shared.environment?.texture ?? null;
}

/** Let go of a hold; the map's render target is disposed with the last. */
export function releaseEnvironment(texture: Texture | null): void {
  if (!shared || (shared.environment?.texture ?? null) !== texture) return;
  shared.holders -= 1;
  if (shared.holders > 0) return;
  const last = shared;
  shared = null;
  last.environment?.dispose();
}
