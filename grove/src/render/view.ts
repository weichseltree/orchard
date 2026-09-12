import {
  Color,
  Group,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type Object3D,
} from "three";
import { PALETTE } from "../config";
import type { DeviceProfile } from "../device";

// The renderer, its canvas, the scene, the camera and the rig the camera
// hangs off. The rig is the body: locomotion moves the rig, the head moves the
// camera. On the desktop and on a phone the camera sits at EYE_HEIGHT inside
// the rig; in XR the runtime writes the camera's pose and `local-floor` puts
// the rig's origin on the real floor.

/** Default eye height; an asset's spawn marker overrides it (hall.json: 1.6). */
export const EYE_HEIGHT = 1.6;

export interface View {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  rig: Group;
  /** Everything the world builder owns; cleared on a room rebuild. */
  world: Group;
  setPixelRatio(ratio: number): void;
  start(onFrame: (dt: number, time: number) => void): void;
  dispose(): void;
}

export interface ViewOptions {
  /** Told when the GPU takes the context away, and when it comes back. */
  onContextLost?: (restored: boolean) => void;
}

export function createView(
  canvas: HTMLCanvasElement,
  device: DeviceProfile,
  options: ViewOptions = {},
): View {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: !device.headset, // MSAA on Quest costs more than it returns here
    powerPreference: "high-performance",
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, device.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");
  // Quest 3 has the fill rate; a sharp periphery is worth more than the frames
  // foveation buys back at this scene complexity.
  renderer.xr.setFoveation(0.2);

  const scene = new Scene();
  scene.background = new Color(PALETTE.background);

  const camera = new PerspectiveCamera(
    fovFor(window.innerWidth / window.innerHeight),
    window.innerWidth / window.innerHeight,
    0.05,
    600,
  );
  camera.position.set(0, EYE_HEIGHT, 0);

  const rig = new Group();
  rig.name = "rig";
  rig.add(camera);
  scene.add(rig);

  const world = new Group();
  world.name = "world";
  scene.add(world);

  const onResize = (): void => {
    if (renderer.xr.isPresenting) return; // the session owns the framebuffer
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener("resize", onResize);

  // Quest going to sleep, or iOS under memory pressure, takes the WebGL
  // context away. Without preventDefault the browser never offers it back and
  // the page is black until reload; with it, three rebuilds its resources on
  // the restore event and the render loop picks up where it left off.
  let lost = false;
  const onLost = (event: Event): void => {
    event.preventDefault();
    lost = true;
    options.onContextLost?.(false);
  };
  const onRestored = (): void => {
    lost = false;
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    options.onContextLost?.(true);
  };
  canvas.addEventListener("webglcontextlost", onLost, false);
  canvas.addEventListener("webglcontextrestored", onRestored, false);

  let previous = 0;
  return {
    renderer,
    scene,
    camera,
    rig,
    world,
    setPixelRatio(ratio) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, ratio));
    },
    start(onFrame) {
      renderer.setAnimationLoop((time) => {
        const dt = previous === 0 ? 0 : Math.min(0.1, (time - previous) / 1000);
        previous = time;
        onFrame(dt, time);
        // Drawing into a lost context throws on some drivers; the world keeps
        // ticking so nothing jumps when it comes back.
        if (!lost) renderer.render(scene, camera);
      });
    },
    dispose() {
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      renderer.setAnimationLoop(null);
      disposeTree(world);
      renderer.dispose();
    },
  };
}

/** Horizontal field of view, degrees: what a portrait phone has to keep. */
const HORIZONTAL_FOV = 78;
/** The widest vertical field of view a portrait screen may open up to. */
const MAX_VERTICAL_FOV = 100;

/**
 * A fixed vertical fov turns a portrait phone into a keyhole: at 412 x 915 a
 * 72-degree vertical fov leaves about 35 degrees across. Landscape keeps the
 * authored vertical fov; portrait widens it until the horizontal fov is right.
 */
export function fovFor(aspect: number): number {
  const vertical = 72;
  if (aspect >= 1) return vertical;
  const half = Math.atan(Math.tan((HORIZONTAL_FOV / 2) * (Math.PI / 180)) / aspect);
  return Math.min(MAX_VERTICAL_FOV, (half * 2 * 180) / Math.PI);
}

/** Frees every geometry and material under `root`; three never does it on remove. */
export function disposeTree(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Object3D & {
      geometry?: { dispose(): void };
      material?: { dispose(): void } | Array<{ dispose(): void }>;
    };
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material?.dispose();
  });
}
