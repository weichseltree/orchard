import {
  BackSide,
  Color,
  DataTexture,
  FrontSide,
  Frustum,
  Group,
  HalfFloatType,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Quaternion,
  RGBAFormat,
  ShaderMaterial,
  Sphere,
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
import {
  STRICT_CORE,
  afterglowAlpha,
  coreFor,
  createIntentState,
  insideWithHysteresis,
  liveWithHysteresis,
  resetIntent,
  screenCoverage,
  shapedBlend,
  updateIntent,
  viewScaleFor,
  type IntentState,
} from "./portal-intent";
import { PORTAL_FRAGMENT, PORTAL_MELD, PORTAL_TINT, PORTAL_VERTEX } from "./portal-shader";

// A portal is a blending of two spacetimes, not a plane with a frame. Each
// end is a soft sphere: from outside it is a lens with no edge onto the
// other room, rendered live from a camera that stands where the visitor's
// eye would stand over there. Walking in, the other room dissolves over this
// one from the direction of travel while that camera's scale slides from the
// destination's to the visitor's, and at the core the body steps through.
//
// How far in, and whether to step, depend on intent (portal-intent.ts): a
// head-on walk with the gaze on the centre opens the blend before the sphere
// is touched and crosses at a wider core; a body brushing past, standing
// still or backing in gets a thin fade and crosses only at the strict core,
// so walking into the middle always works and nothing else yanks. The blend
// reaches one exactly where the crossing happens, so the scale slide never
// jumps; near the core the two rooms interpenetrate a little, and after the
// step the end the visitor now stands in keeps showing the room they left
// for a moment, fading, so the change of scale is a dissolve. That end is
// armed again only once the visitor has walked clear of it, so nobody
// bounces back. A portal is entered from the room and scale it was built
// for, and from nowhere else.
//
// Cost: one far view per frame at most, for the nearest armed end within
// reach and inside the frustum, into one full-size target reused across
// frames whose used viewport grows with the blend and the sphere's size on
// screen. Recursion stops at depth one: the far view hides the portals, so
// no portal ever appears inside another.

/** Inside this fraction of the radius the blend is complete and the crossing happens whatever the intent. */
export const PORTAL_CORE = STRICT_CORE;
export { PORTAL_MELD } from "./portal-shader";
/** How long the room the visitor left lingers after a crossing, seconds. */
export const AFTERGLOW_SECONDS = 0.7;
/** The far view is rendered only within this many radii of an end. */
const LIVE_WITHIN_RADII = 12;
/** The far view's least resolution, as a fraction of the drawing buffer. */
const VIEW_SCALE_MIN = 0.5;
/** An end the visitor arrived through, or stands in by any other road, arms once they are this far out. */
const CLEAR_RADII = 1.1;

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

/** How far into the blend a point is: 0 outside the sphere, 1 within its core. Linear; `shapedBlend` is the eased, intent-aware form. */
export function blendAt(end: Pick<PortalEnd, "center" | "radius">, point: Vector3): number {
  const d = point.distanceTo(end.center);
  if (d >= end.radius - 1e-9) return 0;
  const t = (end.radius - d) / (end.radius * (1 - PORTAL_CORE));
  return t >= 1 - 1e-9 ? 1 : t <= 0 ? 0 : t;
}

/**
 * Where the body lands stepping through `end`, or null when it may not: a
 * portal is crossed only from its own room at its own scale, and only from
 * its core. `core` is the fraction of the radius that counts as the core:
 * the strict one by default, wider with intent (`coreFor`).
 */
export function crossPortal(
  end: PortalEnd,
  body: { room: string; scale: number; x: number; z: number },
  eye: Vector3,
  core: number = PORTAL_CORE,
): Crossing | null {
  if (body.room !== end.room || body.scale !== end.scale) return null;
  if (eye.distanceTo(end.center) > end.radius * core + 1e-9) return null;
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

const _eye = new Vector3();
const _far = new Vector3();
const _forward = new Vector3();
const _travel = new Vector3();
const _landing = new Vector3();
const _quat = new Quaternion();
const _quatInverse = new Quaternion();
const _size = new Vector2();
const _frustum = new Frustum();
const _viewProjection = new Matrix4();
const _sphere = new Sphere();

export interface PortalFrame {
  body: { room: string; scale: number; x: number; z: number };
  /** Seconds since the previous frame; what the intent estimate integrates over. */
  dt: number;
  camera: Camera;
  scene: Scene;
  /** The group that holds the world; everything else in the scene is hidden from the far view. */
  worldRoot: Object3D;
  /** Whether a far view may be rendered this frame (never while an XR session presents). */
  live: boolean;
  /** Shows the rooms of one scale and hides the rest. */
  setScaleVisible: (scale: number) => void;
}

interface Afterglow {
  end: PortalEnd;
  elapsed: number;
}

export class PortalSystem {
  readonly group = new Group();
  readonly ends: PortalEnd[];
  #meshes = new Map<PortalEnd, Mesh>();
  #armed = new Map<PortalEnd, boolean>();
  #inside = new Map<PortalEnd, boolean>();
  #intents = new Map<PortalEnd, IntentState>();
  #liveEnd: PortalEnd | null = null;
  #afterglow: Afterglow | null = null;
  #target: WebGLRenderTarget | null = null;
  #blank = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat);
  #farCamera = new PerspectiveCamera();
  /** The WebGL renderer, or null on a backend without render targets: the blend then fades without a far view. */
  #renderer: WebGLRenderer | null;
  #lastRoom: string | null = null;
  #time = 0;
  #viewScale = VIEW_SCALE_MIN;
  #farRenders = 0;

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
        vertexShader: PORTAL_VERTEX,
        fragmentShader: PORTAL_FRAGMENT,
        uniforms: {
          uView: { value: this.#blank },
          uResolution: { value: new Vector2(1, 1) },
          uViewScale: { value: new Vector2(1, 1) },
          uBlend: { value: 0 },
          uLive: { value: 0 },
          uInside: { value: 0 },
          uIntent: { value: 0 },
          uFade: { value: 1 },
          uTime: { value: 0 },
          uTravel: { value: new Vector2(0, 0) },
          uTint: { value: new Color(PORTAL_TINT) },
        },
        transparent: true,
        depthWrite: false,
        side: FrontSide,
      });
      const mesh = new Mesh(new SphereGeometry(end.radius, 48, 32), material);
      mesh.name = `portal-${end.portal.id}-${end.room}`;
      mesh.position.copy(end.center);
      mesh.renderOrder = 900;
      mesh.userData = { scale: end.scale };
      this.group.add(mesh);
      this.#meshes.set(end, mesh);
      this.#armed.set(end, true);
      this.#inside.set(end, false);
      this.#intents.set(end, createIntentState());
    }
  }

  /** Show the ends that belong to rooms of this scale. */
  setScale(scale: number): void {
    for (const [end, mesh] of this.#meshes) mesh.visible = end.scale === scale;
  }

  /** This system's own end matching `end` (the same portal and room), so callers may hold ends from another `portalEnds`. */
  #own(end: PortalEnd): PortalEnd {
    return this.ends.find((e) => e === end || (e.room === end.room && e.portal.id === end.portal.id)) ?? end;
  }

  /** The intent estimate for an end, 0..1. */
  intentOf(end: PortalEnd): number {
    return this.#intents.get(this.#own(end))?.intent ?? 0;
  }

  /** Whether an end would take the visitor through; false while they stand in one they arrived by. */
  isArmed(end: PortalEnd): boolean {
    return this.#armed.get(this.#own(end)) === true;
  }

  /** The end still showing the room the visitor left, and how far into its fade, or null. */
  get afterglow(): { end: PortalEnd; elapsed: number } | null {
    return this.#afterglow ? { end: this.#afterglow.end, elapsed: this.#afterglow.elapsed } : null;
  }

  /** The far view's resolution last used, as a fraction of the drawing buffer. */
  get viewScale(): number {
    return this.#viewScale;
  }

  /** How many far views have been rendered so far. */
  get farRenders(): number {
    return this.#farRenders;
  }

  /** The mesh for an end (tests read its material's state). */
  meshOf(end: PortalEnd): Mesh {
    return this.#meshes.get(this.#own(end))!;
  }

  /** Per frame, after the camera pose is set: render a far view, blend, and report a crossing. */
  update(frame: PortalFrame): Crossing | null {
    const { body, camera, dt } = frame;
    this.#time += dt;
    camera.getWorldPosition(_eye);
    camera.getWorldQuaternion(_quat);
    _forward.set(0, 0, -1).applyQuaternion(_quat);
    _quatInverse.copy(_quat).invert();
    // Arriving inside an end by any road but the portal (a link straight to
    // the Orrery, the spawn, a doorway): it stays quiet until walked clear of.
    if (body.room !== this.#lastRoom) {
      this.#lastRoom = body.room;
      for (const end of this.ends) {
        if (end.room === body.room && blendAt(end, _eye) > 0) this.#armed.set(end, false);
        resetIntent(this.#intents.get(end)!);
      }
    }

    let crossing: Crossing | null = null;
    let through: PortalEnd | null = null;
    let nearest: PortalEnd | null = null;
    let nearestDistance = Infinity;
    let nearestBlend = 0;
    for (const end of this.ends) {
      const mesh = this.#meshes.get(end)!;
      const material = mesh.material as ShaderMaterial;
      const u = material.uniforms;
      if (end.room !== body.room) {
        u.uBlend!.value = 0;
        u.uLive!.value = 0;
        u.uFade!.value = 1;
        continue;
      }
      const d = _eye.distanceTo(end.center);
      // An end the visitor arrived through arms itself once they have walked clear.
      if (!this.#armed.get(end) && d > end.radius * CLEAR_RADII) this.#armed.set(end, true);
      const armed = this.#armed.get(end) === true;
      const state = this.#intents.get(end)!;
      if (armed) updateIntent(state, { eye: _eye, forward: _forward, center: end.center, radius: end.radius }, dt);
      else resetIntent(state);
      const t = armed ? shapedBlend(d, end.radius, state.intent) : 0;
      const inside = insideWithHysteresis(this.#inside.get(end) === true, d, end.radius);
      this.#inside.set(end, inside);
      // Inside, the blend is a screen-space dissolve: nothing in the near room may cut into it.
      material.side = inside ? BackSide : FrontSide;
      material.depthTest = !inside;
      const glowing = this.#afterglow?.end === end;
      if (!glowing) {
        u.uBlend!.value = t;
        u.uInside!.value = inside ? 1 : 0;
        u.uIntent!.value = state.intent;
        u.uLive!.value = 0;
        u.uFade!.value = 1;
        u.uTime!.value = this.#time;
        this.#setTravel(u.uTravel!.value as Vector2, state);
      }
      mesh.visible = armed || glowing || d > end.radius * CLEAR_RADII;
      if (armed && d < nearestDistance) {
        nearest = end;
        nearestDistance = d;
        nearestBlend = t;
      }
      if (!crossing && armed) {
        crossing = crossPortal(end, body, _eye, coreFor(state.intent));
        if (crossing) through = end;
      }
    }

    // The room the visitor left lingers on the end they arrived in, fading.
    const glow = this.#afterglow;
    if (glow) {
      glow.elapsed += dt;
      const peak = frame.live && this.#renderer ? PORTAL_MELD / (1 - PORTAL_MELD) : 1;
      const fade = afterglowAlpha(glow.elapsed, AFTERGLOW_SECONDS, peak);
      if (fade <= 0 || glow.end.room !== body.room) {
        this.#afterglow = null;
        this.#setUniforms(glow.end, { blend: 0, fade: 1, live: false });
        this.#meshes.get(glow.end)!.visible = this.#armed.get(glow.end) === true || glow.end.room !== body.room;
      } else {
        this.#setUniforms(glow.end, { blend: 1, fade, live: false });
        // The ghost is not frozen: its camera drifts a little toward the far
        // centre as it fades, the scale slide carrying on past one.
        const slide = 1 - 0.15 * (glow.elapsed / AFTERGLOW_SECONDS);
        if (frame.live) this.#renderFar(glow.end, frame, _eye, slide, 1);
      }
    }

    // The one live end: the nearest armed one in reach and in view, with hysteresis at the reach.
    let live: PortalEnd | null = null;
    if (!this.#afterglow && frame.live && this.#renderer && nearest) {
      const inReach = liveWithHysteresis(this.#liveEnd === nearest, nearestDistance, nearest.radius, LIVE_WITHIN_RADII);
      if (inReach && this.#inView(nearest, camera)) live = nearest;
    }
    this.#liveEnd = live;
    if (live) {
      const fov = ((camera as PerspectiveCamera).fov ?? 60) * (Math.PI / 180);
      const coverage = screenCoverage(nearestDistance, live.radius, fov);
      this.#renderFar(live, frame, _eye, nearestBlend, viewScaleFor(nearestBlend, coverage, VIEW_SCALE_MIN));
    }

    if (crossing && through) {
      // The far end is where the visitor now stands: it stays quiet until
      // they walk off it, and meanwhile shows the room they left from the
      // very pose they left it at, so this frame and the next are one.
      const twin = through.twin;
      this.#armed.set(twin, false);
      this.#inside.set(twin, true);
      this.#afterglow = { end: twin, elapsed: 0 };
      const twinMesh = this.#meshes.get(twin)!;
      const twinMaterial = twinMesh.material as ShaderMaterial;
      twinMaterial.side = BackSide;
      twinMaterial.depthTest = false;
      twinMesh.visible = true;
      const peak = frame.live && this.#renderer ? PORTAL_MELD / (1 - PORTAL_MELD) : 1;
      this.#setUniforms(twin, { blend: 1, fade: peak, live: false });
      const fromMaterial = this.#meshes.get(through)!.material as ShaderMaterial;
      (twinMaterial.uniforms.uTravel!.value as Vector2).copy(fromMaterial.uniforms.uTravel!.value as Vector2);
      if (frame.live) {
        _landing.copy(_eye).sub(through.center).add(twin.center);
        this.#renderFar(twin, frame, _landing, 1, 1);
      }
      this.#liveEnd = null;
      this.#lastRoom = crossing.room;
    }
    return crossing;
  }

  #setUniforms(end: PortalEnd, values: { blend: number; fade: number; live: boolean }): void {
    const u = (this.#meshes.get(end)!.material as ShaderMaterial).uniforms;
    u.uBlend!.value = values.blend;
    u.uInside!.value = 1;
    u.uIntent!.value = 0;
    u.uLive!.value = values.live ? 1 : 0;
    u.uFade!.value = values.fade;
    u.uTime!.value = this.#time;
  }

  /** The direction of travel on the screen, for the dissolve's origin: the filtered velocity in view space. */
  #setTravel(out: Vector2, state: IntentState): void {
    const speed = Math.hypot(state.vx, state.vy, state.vz);
    if (speed < 1e-3) {
      out.set(0, 0);
      return;
    }
    _travel.set(state.vx, state.vy, state.vz).applyQuaternion(_quatInverse);
    const k = (0.3 * Math.min(1, speed / 1.5)) / speed;
    out.set(_travel.x * k, _travel.y * k);
  }

  /** Whether the end's sphere meets the camera's frustum; the eye inside it always does. */
  #inView(end: PortalEnd, camera: Camera): boolean {
    _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProjection);
    _sphere.set(end.center, end.radius);
    return _frustum.intersectsSphere(_sphere);
  }

  /**
   * Render the room `end` leads to, as seen from where an eye at `eye`
   * would stand over there at blend `t`, into `scale` of the drawing buffer.
   * The target is the drawing buffer's size and is reallocated only when
   * that changes; the resolution is the viewport used within it.
   */
  #renderFar(end: PortalEnd, frame: PortalFrame, eye: Vector3, t: number, scale: number): void {
    const renderer = this.#renderer;
    if (!renderer) return;
    const { camera, scene, worldRoot, setScaleVisible } = frame;
    renderer.getDrawingBufferSize(_size);
    const W = Math.max(1, Math.round(_size.x));
    const H = Math.max(1, Math.round(_size.y));
    if (!this.#target || this.#target.width !== W || this.#target.height !== H) {
      this.#target?.dispose();
      this.#target = new WebGLRenderTarget(W, H, { type: HalfFloatType, depthBuffer: true });
      this.#target.texture.name = "portal-view";
    }
    const target = this.#target;
    const w = Math.max(1, Math.round(W * scale));
    const h = Math.max(1, Math.round(H * scale));
    target.viewport.set(0, 0, w, h);
    target.scissor.set(0, 0, w, h);
    target.scissorTest = true;
    this.#viewScale = scale;

    const far = this.#farCamera;
    farEye(end, eye, t, _far);
    far.position.copy(_far);
    camera.getWorldQuaternion(far.quaternion);
    far.projectionMatrix.copy((camera as PerspectiveCamera).projectionMatrix);
    far.projectionMatrixInverse.copy((camera as PerspectiveCamera).projectionMatrixInverse);
    far.updateMatrixWorld(true);

    // Only the world, and only the far room's scale; never the portals
    // themselves, which is what keeps the recursion at depth one.
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
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, far);
    renderer.setRenderTarget(previous);
    setScaleVisible(end.scale);
    this.group.visible = portalsWereVisible;
    for (const child of hidden) child.visible = true;
    this.#farRenders += 1;

    const u = (this.#meshes.get(end)!.material as ShaderMaterial).uniforms;
    u.uView!.value = target.texture;
    (u.uResolution!.value as Vector2).set(W, H);
    (u.uViewScale!.value as Vector2).set(w / W, h / H);
    u.uLive!.value = 1;
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
