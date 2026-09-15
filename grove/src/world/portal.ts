import {
  BackSide,
  Color,
  DataTexture,
  FrontSide,
  Group,
  HalfFloatType,
  Mesh,
  PerspectiveCamera,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";
import type { Renderer } from "../render/types";
import type { Mansion, Portal } from "./schema";

// A portal is a blending of two spacetimes, not a plane with a frame. Each
// end is a soft sphere: from outside it is a window with no edge onto the
// other room, rendered live from a camera that stands where the visitor's
// eye would stand over there; walking in, the other room fades over this one
// while that camera's scale slides from the destination's to the visitor's,
// and at the centre the body steps through. The other end is armed only once
// the visitor has walked clear of it, so nobody bounces back. A portal is
// entered from the room and scale it was built for, and from nowhere else.

/** Inside this fraction of the radius the blend is complete and the crossing happens. */
export const PORTAL_CORE = 0.3;
/** The far view is rendered only within this many radii of an end. */
const LIVE_WITHIN_RADII = 12;
/** The far view's resolution, as a fraction of the drawing buffer. */
const VIEW_SCALE = 0.5;

export interface PortalEnd {
  readonly portal: Portal;
  /** The room this end sits in, and its scale. */
  readonly room: string;
  readonly scale: number;
  readonly center: Vector3;
  readonly radius: number;
  /** Where this end leads, its scale, and where the visitor lands. */
  readonly to: string;
  readonly toScale: number;
  readonly exit: Vector3;
  /** Destination metres per metre here: what the far camera's offset is multiplied by. */
  readonly ratio: number;
  /** The other end of the same portal. */
  twin: PortalEnd;
}

export interface Crossing {
  room: string;
  scale: number;
  x: number;
  z: number;
}

/** Both ends of every portal in the document, twins linked. */
export function portalEnds(mansion: Mansion): PortalEnd[] {
  const ends: PortalEnd[] = [];
  for (const room of mansion.rooms) {
    for (const portal of room.portals) {
      const target = mansion.rooms.find((r) => r.id === portal.to);
      if (!target) continue;
      const here = {
        portal, room: room.id, scale: room.scale,
        center: new Vector3(...portal.position), radius: portal.radius,
        to: target.id, toScale: target.scale, exit: new Vector3(...portal.exit.position),
        ratio: room.scale / target.scale,
      } as PortalEnd;
      const there = {
        portal, room: target.id, scale: target.scale,
        center: new Vector3(...portal.exit.position), radius: portal.exit.radius,
        to: room.id, toScale: room.scale, exit: new Vector3(...portal.position),
        ratio: target.scale / room.scale,
      } as PortalEnd;
      here.twin = there;
      there.twin = here;
      ends.push(here, there);
    }
  }
  return ends;
}

/** How far into the blend a point is: 0 outside the sphere, 1 within its core. */
export function blendAt(end: Pick<PortalEnd, "center" | "radius">, point: Vector3): number {
  const d = point.distanceTo(end.center);
  if (d >= end.radius - 1e-9) return 0;
  const t = (end.radius - d) / (end.radius * (1 - PORTAL_CORE));
  return t >= 1 - 1e-9 ? 1 : t <= 0 ? 0 : t;
}

/**
 * Where the body lands stepping through `end`, or null when it may not: a
 * portal is crossed only from its own room at its own scale, and only from
 * its core.
 */
export function crossPortal(
  end: PortalEnd,
  body: { room: string; scale: number; x: number; z: number },
  eye: Vector3,
): Crossing | null {
  if (body.room !== end.room || body.scale !== end.scale) return null;
  if (blendAt(end, eye) < 1) return null;
  return {
    room: end.to,
    scale: end.toScale,
    x: end.exit.x + (body.x - end.center.x),
    z: end.exit.z + (body.z - end.center.z),
  };
}

/** The camera pose in the far room for an eye at `eye` and blend `t`: the offset scaled by ratio^(1-t). */
export function farEye(end: PortalEnd, eye: Vector3, t: number, out = new Vector3()): Vector3 {
  const k = Math.pow(end.ratio, 1 - t);
  return out.copy(eye).sub(end.center).multiplyScalar(k).add(end.exit);
}

const VERTEX = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vToEye;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vToEye = cameraPosition - world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uView;
uniform vec2 uResolution;
uniform float uBlend;
uniform float uLive;
uniform vec3 uTint;
varying vec3 vNormalW;
varying vec3 vToEye;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 far = texture2D(uView, uv).rgb;
  float facing = abs(dot(normalize(vNormalW), normalize(vToEye)));
  // The window: the other room, opaque at the centre, gone at the rim.
  float window = smoothstep(0.06, 0.7, facing) * 0.97;
  // A soft rim so the blend has a presence when it holds no view.
  float rim = pow(1.0 - facing, 3.0);
  vec3 c = mix(uTint * (0.35 + 0.65 * rim), far, uLive * window);
  float alpha = max(uBlend, max(window * uLive, rim * 0.45 * (1.0 - uBlend)));
  if (uBlend > 0.0) c = mix(c, far, uBlend);
  gl_FragColor = vec4(c, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _eye = new Vector3();
const _far = new Vector3();
const _size = new Vector2();

export interface PortalFrame {
  body: { room: string; scale: number; x: number; z: number };
  camera: Camera;
  scene: Scene;
  /** The group that holds the world; everything else in the scene is hidden from the far view. */
  worldRoot: Object3D;
  /** Whether a far view may be rendered this frame (never while an XR session presents). */
  live: boolean;
  /** Shows the rooms of one scale and hides the rest. */
  setScaleVisible: (scale: number) => void;
}

export class PortalSystem {
  readonly group = new Group();
  readonly ends: PortalEnd[];
  #meshes = new Map<PortalEnd, Mesh>();
  #armed = new Map<PortalEnd, boolean>();
  #target: WebGLRenderTarget | null = null;
  #blank = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat);
  #farCamera = new PerspectiveCamera();
  /** The WebGL renderer, or null on a backend without render targets: the blend then fades without a far view. */
  #renderer: WebGLRenderer | null;
  #lastRoom: string | null = null;

  constructor(mansion: Mansion, renderer: Renderer) {
    const gl = renderer as Partial<WebGLRenderer>;
    this.#renderer = typeof gl.setRenderTarget === "function" && typeof gl.getDrawingBufferSize === "function"
      ? (renderer as unknown as WebGLRenderer)
      : null;
    this.#blank.needsUpdate = true;
    this.group.name = "portals";
    this.ends = portalEnds(mansion);
    for (const end of this.ends) {
      const material = new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          uView: { value: this.#blank },
          uResolution: { value: new Vector2(1, 1) },
          uBlend: { value: 0 },
          uLive: { value: 0 },
          uTint: { value: new Color("#7f9fbd") },
        },
        transparent: true,
        depthWrite: false,
        side: FrontSide,
      });
      const mesh = new Mesh(new SphereGeometry(end.radius, 40, 24), material);
      mesh.name = `portal-${end.portal.id}-${end.room}`;
      mesh.position.copy(end.center);
      mesh.renderOrder = 900;
      mesh.userData = { scale: end.scale };
      this.group.add(mesh);
      this.#meshes.set(end, mesh);
      this.#armed.set(end, true);
    }
  }

  /** Show the ends that belong to rooms of this scale. */
  setScale(scale: number): void {
    for (const [end, mesh] of this.#meshes) mesh.visible = end.scale === scale;
  }

  /** Per frame, after the camera pose is set: render a far view, blend, and report a crossing. */
  update(frame: PortalFrame): Crossing | null {
    const { body, camera } = frame;
    camera.getWorldPosition(_eye);
    // Arriving inside an end by any road but the portal (a link straight to
    // the Orrery, the spawn, a doorway): it stays quiet until walked clear of.
    if (body.room !== this.#lastRoom) {
      this.#lastRoom = body.room;
      for (const end of this.ends) if (end.room === body.room && blendAt(end, _eye) > 0) this.#armed.set(end, false);
    }
    let crossing: Crossing | null = null;
    let live: PortalEnd | null = null;
    let liveDistance = Infinity;
    for (const end of this.ends) {
      const mesh = this.#meshes.get(end)!;
      const material = mesh.material as ShaderMaterial;
      if (end.room !== body.room) {
        material.uniforms.uBlend!.value = 0;
        material.uniforms.uLive!.value = 0;
        continue;
      }
      const d = _eye.distanceTo(end.center);
      // An end the visitor arrived through arms itself once they have walked clear.
      if (!this.#armed.get(end) && d > end.radius * 1.1) this.#armed.set(end, true);
      const t = this.#armed.get(end) ? blendAt(end, _eye) : 0;
      material.uniforms.uBlend!.value = t;
      material.uniforms.uLive!.value = 0;
      material.side = d < end.radius ? BackSide : FrontSide;
      mesh.visible = this.#armed.get(end) === true || d > end.radius * 1.1;
      if (frame.live && this.#renderer && d < end.radius * LIVE_WITHIN_RADII && d < liveDistance && this.#armed.get(end)) {
        live = end;
        liveDistance = d;
      }
      if (!crossing && this.#armed.get(end)) crossing = crossPortal(end, body, _eye);
    }
    if (live) this.#renderFar(live, frame, blendAt(live, _eye));
    if (crossing) {
      // The far end is where the visitor now stands: it stays quiet until they walk off it.
      const through = this.ends.find((end) => end.room === body.room && crossPortal(end, body, _eye));
      if (through) this.#armed.set(through.twin, false);
      this.#lastRoom = crossing.room;
    }
    return crossing;
  }

  #renderFar(end: PortalEnd, frame: PortalFrame, t: number): void {
    const renderer = this.#renderer;
    if (!renderer) return;
    const { camera, scene, worldRoot, setScaleVisible } = frame;
    renderer.getDrawingBufferSize(_size);
    const w = Math.max(1, Math.round(_size.x * VIEW_SCALE));
    const h = Math.max(1, Math.round(_size.y * VIEW_SCALE));
    if (!this.#target || this.#target.width !== w || this.#target.height !== h) {
      this.#target?.dispose();
      this.#target = new WebGLRenderTarget(w, h, { type: HalfFloatType, depthBuffer: true });
      this.#target.texture.name = "portal-view";
    }
    const far = this.#farCamera;
    camera.getWorldPosition(_eye);
    farEye(end, _eye, t, _far);
    far.position.copy(_far);
    camera.getWorldQuaternion(far.quaternion);
    far.projectionMatrix.copy((camera as PerspectiveCamera).projectionMatrix);
    far.projectionMatrixInverse.copy((camera as PerspectiveCamera).projectionMatrixInverse);
    far.updateMatrixWorld(true);

    // Only the world, and only the far room's scale; never the portals themselves.
    const hidden: Object3D[] = [];
    for (const child of scene.children) {
      if (child !== worldRoot && child.visible) {
        child.visible = false;
        hidden.push(child);
      }
    }
    const portalsWereVisible = this.group.visible;
    this.group.visible = false;
    setScaleVisible(end.toScale);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.#target);
    renderer.clear();
    renderer.render(scene, far);
    renderer.setRenderTarget(previous);
    setScaleVisible(end.scale);
    this.group.visible = portalsWereVisible;
    for (const child of hidden) child.visible = true;

    const material = this.#meshes.get(end)!.material as ShaderMaterial;
    material.uniforms.uView!.value = this.#target.texture;
    (material.uniforms.uResolution!.value as Vector2).set(_size.x, _size.y);
    material.uniforms.uLive!.value = 1;
  }

  dispose(): void {
    this.#target?.dispose();
    this.#blank.dispose();
    for (const mesh of this.#meshes.values()) {
      mesh.geometry.dispose();
      (mesh.material as ShaderMaterial).dispose();
    }
  }
}
