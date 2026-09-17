import {
  AgXToneMapping,
  Color,
  Group,
  PerspectiveCamera,
  Scene,
  type Object3D,
} from "three";
import type { Renderer } from "./types";
import { PALETTE } from "../config";
import type { DeviceProfile } from "../device";
import { FrameClock } from "./frame-clock";

// The renderer, its canvas, the scene, the camera and the rig the camera
// hangs off. The rig is the body: locomotion moves the rig, the head moves the
// camera. On the desktop and on a phone the camera sits at EYE_HEIGHT inside
// the rig; in XR the runtime writes the camera's pose and `local-floor` puts
// the rig's origin on the real floor.

/** Default eye height; an asset's spawn marker overrides it (hall.json: 1.6). */
export const EYE_HEIGHT = 1.6;
/**
 * How far the eye sees, metres. Every backdrop a room stands inside has to
 * fit within this from anywhere in that room — the sky dome (400 m around a
 * 130 m palace) and the Orrery's star dome both do their sums against it —
 * and a portal's far view stretches it by the far room's scale (portal.ts).
 */
export const VIEW_NEAR = 0.05;
export const VIEW_FAR = 600;
// The sky dome and tape volume still rely on ShaderMaterial, which Three's
// WebGPU backend logs as incompatible during the quality run. Keep the async
// WebGPU path available for local experiments, but make WebGL2 the default
// until those materials are ported.
const EXPERIMENTAL_WEBGPU = import.meta.env.VITE_ENABLE_WEBGPU === "1";

export interface View {
  renderer: Renderer;
  backend: "webgpu" | "webgl2";
  scene: Scene;
  camera: PerspectiveCamera;
  rig: Group;
  /** Everything the world builder owns; cleared on a room rebuild. */
  world: Group;
  setPixelRatio(ratio: number): void;
  start(onFrame: (dt: number, time: number, rawDt: number) => void): void;
  dispose(): void;
}

export interface ViewOptions {
  /** Told when the GPU takes the context away, and when it comes back. */
  onContextLost?: (restored: boolean) => void;
}

export async function createView(
  canvas: HTMLCanvasElement,
  device: DeviceProfile,
  options: ViewOptions = {},
): Promise<View> {
  const { renderer, backend } = await createRenderer(canvas, device);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, device.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  // Baked radiance is linear and often above 1 in sunlit rooms; without a
  // tone curve the palace's cream walls clip to white (the charcoal hall only
  // clipped in its sun pools). AgX is what the bakes' previews are judged
  // with in Blender, so the client agrees with them. Exhibits (stills, video
  // walls, tapes) opt out with toneMapped = false and keep their own values.
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
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
    VIEW_NEAR,
    VIEW_FAR,
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

  const clock = new FrameClock();
  const onVisibility = (): void => clock.reset();
  document.addEventListener("visibilitychange", onVisibility);
  return {
    renderer,
    backend,
    scene,
    camera,
    rig,
    world,
    setPixelRatio(ratio) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, ratio));
    },
    start(onFrame) {
      renderer.setAnimationLoop((time) => {
        if (document.hidden && !renderer.xr.isPresenting) {
          clock.reset();
          return;
        }
        const { dt, rawDt } = clock.tick(time);
        onFrame(dt, time, rawDt);
        // Drawing into a lost context throws on some drivers; the world keeps
        // ticking so nothing jumps when it comes back.
        if (!lost) renderer.render(scene, camera);
      });
    },
    dispose() {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      renderer.setAnimationLoop(null);
      disposeTree(world);
      renderer.dispose();
    },
  };
}

async function createRenderer(
  canvas: HTMLCanvasElement,
  device: DeviceProfile,
): Promise<{ renderer: Renderer; backend: "webgpu" | "webgl2" }> {
  if (EXPERIMENTAL_WEBGPU && "gpu" in navigator) {
    try {
      // Dynamically imported so the ~230 KB WebGPU backend never lands in the
      // startup bundle for the WebGL2 majority; only fetched for explicit
      // experiments after the browser reports a real adapter.
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("WebGPU adapter unavailable");
      const { WebGPURenderer } = await import("three/webgpu");
      const renderer = new WebGPURenderer({
        canvas,
        antialias: !device.headset,
        alpha: false,
      });
      await renderer.init();
      return { renderer: renderer as unknown as Renderer, backend: "webgpu" };
    } catch (error) {
      console.info(`[render] WebGPU unavailable; using WebGL2 (${message(error)})`);
    }
  }
  const { WebGLRenderer } = await import("three");
  return {
    renderer: new WebGLRenderer({
      canvas,
      antialias: !device.headset,
      powerPreference: "high-performance",
      alpha: false,
    }),
    backend: "webgl2",
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
