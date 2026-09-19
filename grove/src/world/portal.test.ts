import { BackSide, FrontSide, Frustum, Group, Matrix4, PerspectiveCamera, Scene, ShaderMaterial, Sphere, Vector2, Vector3, type Camera, type WebGLRenderTarget } from "three";
import { describe, expect, it } from "vitest";
import { VIEW_FAR } from "../render/view";
import type { Renderer } from "../render/types";
import mansionDocument from "./mansion.json";
import { parseMansion } from "./schema";
import {
  AFTERGLOW_SECONDS,
  LIVE_WITHIN_RADII,
  PORTAL_CORE,
  PORTAL_MELD,
  PortalSystem,
  blendAt,
  crossPortal,
  farDepthScale,
  farEye,
  portalEnds,
  type PortalEnd,
} from "./portal";
import {
  INTENT,
  RELAXED_CORE,
  STRICT_CORE,
  afterglowAlpha,
  commitment,
  coreFor,
  createIntentState,
  insideWithHysteresis,
  intentEvidence,
  liveWithHysteresis,
  resetIntent,
  screenCoverage,
  shapedBlend,
  smoothstep,
  updateIntent,
  viewScaleFor,
  type IntentState,
} from "./portal-intent";
import { PORTAL_FRAGMENT, PORTAL_VERTEX } from "./portal-shader";
import { STAR_DOME_RADIUS, starDomeCentre } from "./space";
import { neighbourhood } from "./world";

// A portal is a blend between two scales, entered only from the room and the
// scale it was built for. The Meridian Garden's armillary leads to the
// Orrery, whose metre is a fiftieth of the garden's. Every coordinate below
// is read from the document: the palace is being redrawn around this file.

const mansion = parseMansion(mansionDocument);
const ends = portalEnds(mansion);
const garden = ends.find((end) => end.room === "parterre")!;
const orrery = ends.find((end) => end.room === "orrery")!;
const gardenRoom = mansion.rooms.find((r) => r.id === "parterre")!;
const orreryRoom = mansion.rooms.find((r) => r.id === "orrery")!;
const armillary = gardenRoom.portals.find((p) => p.id === "armillary")!;

/** A point `fraction` radii from an end's centre along `dir` (unit), at the centre's height. */
function at(end: PortalEnd, fraction: number, dir = new Vector3(1, 0, 0)): Vector3 {
  return end.center.clone().addScaledVector(dir, fraction * end.radius);
}

describe("portalEnds", () => {
  it("makes two ends of the armillary, twins of each other, with inverse ratios", () => {
    // Six ends in the document: the armillary's two, arcedit's portal into its
    // canvas, and quantumflow's from the Cloud into it.
    expect(ends).toHaveLength(6);
    expect(ends.filter((end) => end.portal.id === "armillary")).toHaveLength(2);
    expect(garden.twin).toBe(orrery);
    expect(orrery.twin).toBe(garden);
    expect(garden.to).toBe("orrery");
    expect(garden.ratio).toBeCloseTo(1 / orreryRoom.scale);
    expect(orrery.ratio).toBeCloseTo(orreryRoom.scale);
    expect(garden.exit).toEqual(orrery.center);
    expect(orrery.exit).toEqual(garden.center);
  });

  it("sits under the garden's armillary as the document places it and lands on the Orrery's ring", () => {
    expect(garden.center.toArray()).toEqual(armillary.position);
    expect(garden.radius).toBe(armillary.radius);
    expect(orrery.center.toArray()).toEqual(armillary.exit.position);
    expect(orrery.radius).toBe(armillary.exit.radius);
  });
});

describe("blendAt", () => {
  it("is 0 outside the sphere, 1 inside its core, and climbs between", () => {
    expect(blendAt(garden, at(garden, 1))).toBe(0);
    expect(blendAt(garden, at(garden, 1.4))).toBe(0);
    expect(blendAt(garden, at(garden, PORTAL_CORE))).toBe(1);
    expect(blendAt(garden, at(garden, 0))).toBe(1);
    expect(blendAt(garden, at(garden, (1 + PORTAL_CORE) / 2))).toBeCloseTo(0.5);
  });
});

describe("crossPortal", () => {
  const body = (end: PortalEnd, dx: number, dz: number) => ({
    room: end.room, scale: end.scale, x: end.center.x + dx, z: end.center.z + dz,
  });

  it("steps a garden body at the core through to the Orrery, keeping its offset from the centre", () => {
    const crossing = crossPortal(garden, body(garden, 0.4, 0.2), at(garden, 0))!;
    expect(crossing.room).toBe("orrery");
    expect(crossing.scale).toBe(orreryRoom.scale);
    const target = garden.landing ?? orrery.center;
    expect(crossing.x).toBeCloseTo(target.x + 0.4);
    expect(crossing.z).toBeCloseTo(target.z + 0.2);
  });

  it("refuses a body in another room, or at the wrong scale, even at the centre", () => {
    expect(crossPortal(garden, { ...body(garden, 0, 0), room: "terrace" }, at(garden, 0))).toBeNull();
    expect(crossPortal(garden, { ...body(garden, 0, 0), scale: orreryRoom.scale }, at(garden, 0))).toBeNull();
  });

  it("refuses an eye that is only in the blend, not the core", () => {
    expect(crossPortal(garden, body(garden, 0.6 * garden.radius, 0), at(garden, 0.6))).toBeNull();
    expect(crossPortal(garden, body(garden, 0.4 * garden.radius, 0), at(garden, 0.4))).toBeNull();
  });

  it("takes a wider core when asked, and the strict one by default", () => {
    expect(crossPortal(garden, body(garden, 0.5 * garden.radius, 0), at(garden, 0.5), RELAXED_CORE)).not.toBeNull();
    expect(crossPortal(garden, body(garden, 0.5 * garden.radius, 0), at(garden, 0.5))).toBeNull();
    expect(crossPortal(garden, body(garden, 0.6 * garden.radius, 0), at(garden, 0.6), RELAXED_CORE)).toBeNull();
    expect(crossPortal(garden, body(garden, PORTAL_CORE * garden.radius, 0), at(garden, PORTAL_CORE))).not.toBeNull();
  });

  it("brings an Orrery body back to the garden", () => {
    const back = crossPortal(orrery, body(orrery, 0, 0), at(orrery, 0));
    expect(back).not.toBeNull();
    expect(back!.room).toBe("parterre");
    expect(back!.scale).toBe(gardenRoom.scale);
    expect(back!.x).toBeCloseTo(garden.center.x);
    expect(back!.z).toBeCloseTo(garden.center.z);
  });
});

describe("farEye", () => {
  it("stands the far camera fifty Orrery metres out per garden metre from the centre, and one at the core", () => {
    const eye = garden.center.clone().add(new Vector3(2, 0, 0));
    const ratio = garden.ratio;
    expect(farEye(garden, eye, 0).toArray()).toEqual([orrery.center.x + 2 * ratio, orrery.center.y, orrery.center.z]);
    expect(farEye(garden, eye, 1).toArray()).toEqual([orrery.center.x + 2, orrery.center.y, orrery.center.z]);
    // Halfway in, the scale is the geometric mean.
    expect(farEye(garden, eye, 0.5).x - orrery.center.x).toBeCloseTo(2 * Math.sqrt(ratio));
  });

  it("from the Orrery the garden is seen from the armillary's centre, a fiftieth of the walk away", () => {
    const eye = orrery.center.clone().add(new Vector3(2, 0, 0));
    expect(farEye(orrery, eye, 0).x).toBeCloseTo(garden.center.x + 2 * orrery.ratio);
    expect(farEye(orrery, eye, 0).z).toBeCloseTo(garden.center.z);
  });
});

describe("farDepthScale", () => {
  it("stretches the frustum by the same fifty the far camera's offset is stretched by, and slides to one at the core", () => {
    expect(farDepthScale(garden, 0)).toBeCloseTo(garden.ratio);
    expect(farDepthScale(garden, 0.5)).toBeCloseTo(Math.sqrt(garden.ratio));
    expect(farDepthScale(garden, 1)).toBe(1);
  });

  it("never shortens it: from the Orrery the garden is the larger room and keeps this room's range", () => {
    expect(farDepthScale(orrery, 0)).toBe(1);
    expect(farDepthScale(orrery, 1)).toBe(1);
  });
});

// The intent estimator, driven at 60 frames a second along straight walks.
const FPS = 60;
const WALK = 2.4;

interface Walk {
  from: Vector3;
  /** Unit direction of travel. */
  along: Vector3;
  /** Unit direction of the gaze; the direction of travel when omitted. */
  gaze?: Vector3;
  speed: number;
  seconds: number;
}

/** Walk the eye and return the intent after every frame. */
function walk(state: IntentState, end: PortalEnd, w: Walk): number[] {
  const out: number[] = [];
  const eye = w.from.clone();
  const forward = (w.gaze ?? w.along).clone().normalize();
  const dt = 1 / FPS;
  for (let i = 0; i < Math.round(w.seconds * FPS); i++) {
    eye.addScaledVector(w.along, w.speed * dt);
    out.push(updateIntent(state, { eye, forward, center: end.center, radius: end.radius }, dt));
  }
  return out;
}

const toward = (end: PortalEnd, from: Vector3) => end.center.clone().sub(from).normalize();

describe("updateIntent", () => {
  it("ramps up within half a second of a head-on approach with the gaze on the centre", () => {
    const state = createIntentState();
    const from = at(garden, 1.5);
    const intents = walk(state, garden, { from, along: toward(garden, from), speed: WALK, seconds: 0.5 });
    expect(intents.at(-1)!).toBeGreaterThan(0.5);
    // Monotone on the way: no flicker.
    for (let i = 1; i < intents.length; i++) expect(intents[i]!).toBeGreaterThanOrEqual(intents[i - 1]! - 1e-9);
    // Reaching the rim it is nearly certain.
    const more = walk(state, garden, { from: from.clone().addScaledVector(toward(garden, from), WALK * 0.5), along: toward(garden, from), speed: WALK, seconds: 0.45 });
    expect(more.at(-1)!).toBeGreaterThan(0.85);
  });

  it("stays low on a sideways pass that brushes the sphere", () => {
    const state = createIntentState();
    // Along x, offset one radius in z: the eye grazes the rim and looks where it walks.
    const from = garden.center.clone().add(new Vector3(-2 * garden.radius, 0, garden.radius));
    const intents = walk(state, garden, { from, along: new Vector3(1, 0, 0), speed: WALK, seconds: (4 * garden.radius) / WALK });
    expect(Math.max(...intents)).toBeLessThan(0.15);
  });

  it("stays low walking backwards into the sphere, even head-on", () => {
    const state = createIntentState();
    const from = at(garden, 1.5);
    const along = toward(garden, from);
    const intents = walk(state, garden, { from, along, gaze: along.clone().negate(), speed: WALK, seconds: 1.2 });
    expect(Math.max(...intents)).toBeLessThan(0.25);
    // And commitment, which is what relaxes the core, stays at nothing.
    expect(commitment(Math.max(...intents))).toBe(0);
  });

  it("decays when the visitor stops, slower than it rose", () => {
    const state = createIntentState();
    const from = at(garden, 1.5);
    const along = toward(garden, from);
    const rise = walk(state, garden, { from, along, speed: WALK, seconds: 0.9 });
    const high = rise.at(-1)!;
    expect(high).toBeGreaterThan(0.8);
    const stood = from.clone().addScaledVector(along, WALK * 0.9);
    const still = walk(state, garden, { from: stood, along, gaze: along, speed: 0, seconds: 0.3 });
    // Three tenths of a second standing: still mostly there (it forgets slowly).
    expect(still.at(-1)!).toBeGreaterThan(high * 0.5);
    const longer = walk(state, garden, { from: stood, along, gaze: along, speed: 0, seconds: 1.5 });
    expect(longer.at(-1)!).toBeLessThan(0.15);
  });

  it("gathers nothing beyond reach, and treats a jump in time as standing still", () => {
    const state = createIntentState();
    const from = at(garden, INTENT.reach + 1);
    const intents = walk(state, garden, { from, along: toward(garden, from), speed: WALK, seconds: 0.5 });
    expect(Math.max(...intents)).toBe(0);
    resetIntent(state);
    expect(state.seen).toBe(false);
    const eye = at(garden, 1.2);
    const forward = toward(garden, eye);
    const sample = { eye, forward, center: garden.center, radius: garden.radius };
    // The first sample after a reset only starts the clock.
    expect(updateIntent(state, sample, 1 / FPS)).toBe(0);
    // A whole second between frames: whatever moved, the velocity is not trusted.
    eye.addScaledVector(forward, 2);
    expect(updateIntent(state, sample, 1)).toBe(0);
    // Nor is a teleport: two metres in a frame is nobody's walk.
    eye.addScaledVector(forward, 2);
    expect(updateIntent(state, sample, 1 / FPS)).toBe(0);
    expect(updateIntent(state, sample, 0)).toBe(0);
  });

  it("weighs the evidence: closing, aimed through the core, looking at it", () => {
    const eye = at(garden, 1.2);
    const dir = toward(garden, eye);
    const v = { vx: dir.x * WALK, vy: dir.y * WALK, vz: dir.z * WALK };
    const full = intentEvidence(v, dir, garden.center, eye, garden.radius);
    expect(full).toBeCloseTo(0.9, 1);
    // Looking away, the motion alone counts for little.
    const away = intentEvidence(v, dir.clone().negate(), garden.center, eye, garden.radius);
    expect(away).toBeLessThan(full * 0.2);
    // Moving away counts for nothing at all, however hard the stare.
    const receding = intentEvidence({ vx: -v.vx, vy: -v.vy, vz: -v.vz }, dir, garden.center, eye, garden.radius);
    expect(receding).toBe(0);
    // A tangential walk aimed at the rim counts for nothing either.
    const side = new Vector3(0, 0, 1);
    expect(intentEvidence({ vx: side.x * WALK, vy: 0, vz: side.z * WALK }, dir, garden.center, eye, garden.radius)).toBe(0);
  });
});

describe("coreFor and shapedBlend", () => {
  it("keeps the strict core at no intent and opens to the relaxed one with commitment", () => {
    expect(coreFor(0)).toBe(STRICT_CORE);
    expect(coreFor(0.3)).toBe(STRICT_CORE);
    expect(coreFor(1)).toBeCloseTo(RELAXED_CORE);
    let previous = 0;
    for (let i = 0; i <= 20; i++) {
      const c = coreFor(i / 20);
      expect(c).toBeGreaterThanOrEqual(previous);
      previous = c;
    }
  });

  it("without intent is blendAt eased: 0 at the rim, 1 at the strict core, half way at the midpoint", () => {
    const r = garden.radius;
    expect(shapedBlend(r, r, 0)).toBe(0);
    expect(shapedBlend(1.3 * r, r, 0)).toBe(0);
    expect(shapedBlend(STRICT_CORE * r, r, 0)).toBe(1);
    const mid = ((1 + STRICT_CORE) / 2) * r;
    expect(shapedBlend(mid, r, 0)).toBeCloseTo(smoothstep(0, 1, blendAt(garden, at(garden, (1 + STRICT_CORE) / 2))));
    expect(shapedBlend(mid, r, 0)).toBeCloseTo(0.5);
  });

  it("with full intent starts outside the sphere and completes at the relaxed core", () => {
    const r = garden.radius;
    expect(shapedBlend(1.2 * r, r, 1)).toBeGreaterThan(0);
    expect(shapedBlend((1 + INTENT.earlyStart) * r, r, 1)).toBe(0);
    expect(shapedBlend(RELAXED_CORE * r, r, 1)).toBe(1);
    expect(shapedBlend(0.7 * r, r, 1)).toBeLessThan(1);
    // Deeper in is always more, at any intent.
    for (const intent of [0, 0.5, 1]) {
      let previous = -1;
      for (let d = 1.5 * r; d >= 0; d -= 0.05 * r) {
        const t = shapedBlend(d, r, intent);
        expect(t).toBeGreaterThanOrEqual(previous);
        previous = t;
      }
    }
  });
});

describe("the transition's helpers", () => {
  it("afterglow starts at its peak, eases to nothing at the duration, and never rises", () => {
    expect(afterglowAlpha(0, 0.7, 0.4)).toBeCloseTo(0.4);
    expect(afterglowAlpha(0.35, 0.7, 0.4)).toBeCloseTo(0.2);
    expect(afterglowAlpha(0.7, 0.7, 0.4)).toBe(0);
    expect(afterglowAlpha(5, 0.7, 0.4)).toBe(0);
    let previous = 1;
    for (let e = 0; e <= 0.7; e += 0.01) {
      const a = afterglowAlpha(e, 0.7, 1);
      expect(a).toBeLessThanOrEqual(previous);
      previous = a;
    }
  });

  it("covers the whole view from inside, and less the further off the sphere is", () => {
    const fov = Math.PI / 3;
    expect(screenCoverage(0.5, 4.5, fov)).toBe(1);
    expect(screenCoverage(4.5, 4.5, fov)).toBe(1);
    expect(screenCoverage(5, 4.5, fov)).toBe(1);
    expect(screenCoverage(20, 4.5, fov)).toBeLessThan(0.5);
    expect(screenCoverage(200, 4.5, fov)).toBeLessThan(0.05);
  });

  it("renders the far view at half resolution when small and far, and full when the blend deepens or it fills the view", () => {
    expect(viewScaleFor(0, 0)).toBe(0.5);
    expect(viewScaleFor(0, 0.2)).toBe(0.5);
    expect(viewScaleFor(1, 0)).toBe(1);
    expect(viewScaleFor(0, 1)).toBe(1);
    const half = viewScaleFor(0.5, 0);
    expect(half).toBeGreaterThan(0.5);
    expect(half).toBeLessThan(1);
    // Quantised, so the viewport changes rarely.
    expect(viewScaleFor(0.5, 0) * 8).toBeCloseTo(Math.round(viewScaleFor(0.5, 0) * 8));
    expect(viewScaleFor(0.51, 0)).toBe(viewScaleFor(0.5, 0));
    expect(viewScaleFor(0.02, 0.32)).toBe(0.5);
  });

  it("switches the material's side just outside the surface and back only further out", () => {
    const r = 4.5;
    expect(insideWithHysteresis(false, 1.3 * r, r)).toBe(false);
    expect(insideWithHysteresis(false, 1.1 * r, r)).toBe(false);
    expect(insideWithHysteresis(false, 1.05 * r, r)).toBe(true);
    expect(insideWithHysteresis(true, 1.1 * r, r)).toBe(true);
    expect(insideWithHysteresis(true, 1.2 * r, r)).toBe(false);
    expect(insideWithHysteresis(false, 0.5 * r, r)).toBe(true);
  });

  it("keeps the far view live across the reach boundary until a radius further out", () => {
    const r = 4.5;
    expect(liveWithHysteresis(false, 11 * r, r, 12)).toBe(true);
    expect(liveWithHysteresis(false, 12.5 * r, r, 12)).toBe(false);
    expect(liveWithHysteresis(true, 12.5 * r, r, 12)).toBe(true);
    expect(liveWithHysteresis(true, 13.5 * r, r, 12)).toBe(false);
  });
});

describe("the shader", () => {
  it("keeps the tone mapping and colour space includes and one fetch per channel", () => {
    expect(PORTAL_FRAGMENT).toContain("#include <tonemapping_fragment>");
    expect(PORTAL_FRAGMENT).toContain("#include <colorspace_fragment>");
    expect((PORTAL_FRAGMENT.match(/texture2D\(/g) ?? []).length).toBe(1);
    expect((PORTAL_FRAGMENT.match(/farAt\(uv/g) ?? []).length).toBe(3);
    expect(PORTAL_FRAGMENT).not.toMatch(/for\s*\(/);
    for (const name of ["uView", "uResolution", "uViewScale", "uBlend", "uLive", "uInside", "uIntent", "uFade", "uTime", "uTravel", "uTint"]) {
      expect(PORTAL_FRAGMENT).toMatch(new RegExp(`uniform \\w+ ${name};`));
    }
    expect(PORTAL_VERTEX).toContain("vNormalV");
  });
});

// The system, driven frame by frame with a stub renderer: it records what a
// far view would be and never touches a GPU.

interface StubRenderer {
  renders: number;
  target: WebGLRenderTarget | null;
  targets: Set<WebGLRenderTarget>;
  live: boolean;
  /** The camera of the last render, which for this system is always a far view. */
  farCamera: Camera | null;
}

function stubRenderer(live: boolean): Renderer & StubRenderer {
  const stub = {
    renders: 0,
    target: null as WebGLRenderTarget | null,
    targets: new Set<WebGLRenderTarget>(),
    live,
    farCamera: null as Camera | null,
    toneMapping: 0,
    toneMappingExposure: 1,
    xr: {} as Renderer["xr"],
    info: { render: { calls: 0, triangles: 0, points: 0 }, memory: { geometries: 0, textures: 0 } },
    setPixelRatio() {},
    setSize() {},
    setAnimationLoop() {},
    render(_scene: Scene, camera: Camera) {
      stub.renders += 1;
      stub.farCamera = camera;
    },
    getPixelRatio: () => 1,
    dispose() {},
    clear() {},
    getRenderTarget: () => stub.target,
    setRenderTarget(target: WebGLRenderTarget | null) {
      stub.target = target;
      if (target) stub.targets.add(target);
    },
    getDrawingBufferSize: (out: Vector2) => out.set(1600, 900),
  };
  if (!live) {
    delete (stub as Partial<typeof stub>).setRenderTarget;
    delete (stub as Partial<typeof stub>).getDrawingBufferSize;
  }
  return stub as unknown as Renderer & StubRenderer;
}

class Rig {
  readonly scene = new Scene();
  readonly world = new Group();
  readonly camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  readonly renderer: Renderer & StubRenderer;
  readonly portals: PortalSystem;
  readonly scaleShown: number[] = [];
  body = { room: "parterre", scale: 1, x: 0, z: 0 };
  readonly eye = new Vector3();
  /** Rooms presence would refuse; a portal into one is seen through, not crossed. */
  locked: ((roomId: string) => boolean) | undefined = undefined;

  constructor(live = true) {
    this.renderer = stubRenderer(live);
    this.scene.add(this.world);
    this.scene.add(this.camera);
    this.portals = new PortalSystem(mansion, this.renderer);
    this.portals.setScale(1);
    this.world.add(this.portals.group);
  }

  /** Put the eye somewhere, looking along `gaze`, in the room the point is in. */
  place(eye: Vector3, gaze: Vector3, room = "parterre", scale = 1): void {
    this.eye.copy(eye);
    this.camera.position.copy(eye);
    this.camera.lookAt(eye.clone().add(gaze));
    this.camera.updateMatrixWorld(true);
    this.body = { room, scale, x: eye.x, z: eye.z };
  }

  frame(dt = 1 / FPS, live = true) {
    return this.portals.update({
      body: this.body,
      dt,
      camera: this.camera,
      scene: this.scene,
      worldRoot: this.world,
      live,
      setScaleVisible: (scale) => this.scaleShown.push(scale),
      locked: this.locked,
    });
  }

  /** Walk toward `end` from `from` at `speed`, looking along `gaze` (the walk when omitted), until a crossing or `seconds`. */
  walkIn(end: PortalEnd, from: Vector3, speed: number, seconds: number, gaze?: Vector3) {
    const along = toward(end, from);
    const eye = from.clone();
    const dt = 1 / FPS;
    for (let i = 0; i < Math.round(seconds * FPS); i++) {
      eye.addScaledVector(along, speed * dt);
      this.place(eye, gaze ?? along, end.room, end.scale);
      const crossing = this.frame(dt);
      if (crossing) return { crossing, distance: eye.distanceTo(end.center), end };
    }
    return { crossing: null, distance: eye.distanceTo(end.center), end };
  }

  material(end: PortalEnd): ShaderMaterial {
    return this.portals.meshOf(end).material as ShaderMaterial;
  }

  uniform(end: PortalEnd, name: string): number {
    return this.material(end).uniforms[name]!.value as number;
  }
}

describe("PortalSystem", () => {
  it("crosses a committed head-on walk at the relaxed core, before the strict one", () => {
    const rig = new Rig();
    const result = rig.walkIn(garden, at(garden, 1.6), WALK, 5);
    expect(result.crossing).not.toBeNull();
    expect(result.crossing!.room).toBe("orrery");
    expect(rig.portals.intentOf(garden)).toBeGreaterThan(0.85);
    expect(result.distance).toBeLessThanOrEqual(RELAXED_CORE * garden.radius + 1e-6);
    expect(result.distance).toBeGreaterThan(STRICT_CORE * garden.radius * 1.3);
    // The blend was complete at the moment of the step: the scale slide had ended.
    expect(rig.uniform(garden, "uBlend")).toBe(1);
  });

  it("does not yank a visitor standing still between the two cores, but the strict core always crosses", () => {
    const rig = new Rig();
    // Seen from outside first, so the end is armed; then a teleport inside.
    rig.place(at(garden, 1.3), new Vector3(-1, 0, 0));
    rig.frame();
    rig.place(at(garden, 0.45), new Vector3(-1, 0, 0));
    for (let i = 0; i < 120; i++) expect(rig.frame()).toBeNull();
    expect(rig.portals.intentOf(garden)).toBeLessThan(0.1);
    rig.place(at(garden, STRICT_CORE - 0.02), new Vector3(-1, 0, 0));
    expect(rig.frame()).not.toBeNull();
  });

  it("crosses a backward walk only at the strict core", () => {
    const rig = new Rig();
    const from = at(garden, 1.6);
    const result = rig.walkIn(garden, from, WALK, 5, toward(garden, from).negate());
    expect(result.crossing).not.toBeNull();
    expect(result.distance).toBeLessThanOrEqual(STRICT_CORE * garden.radius + WALK / FPS);
  });

  it("after a crossing the twin is unarmed, shows the room left for the afterglow, then hides until walked clear", () => {
    const rig = new Rig();
    const result = rig.walkIn(garden, at(garden, 1.6), WALK, 5);
    const crossing = result.crossing!;
    const twinMaterial = rig.material(orrery);
    expect(rig.portals.isArmed(orrery)).toBe(false);
    expect(rig.portals.afterglow?.end.room).toBe("orrery");
    // On the crossing frame itself the twin is already dressed for the next one: inside, the room left at the meld's share.
    expect(twinMaterial.side).toBe(BackSide);
    expect(twinMaterial.depthTest).toBe(false);
    expect(rig.uniform(orrery, "uLive")).toBe(1);
    expect(rig.uniform(orrery, "uFade")).toBeCloseTo(PORTAL_MELD / (1 - PORTAL_MELD));
    expect(rig.portals.meshOf(orrery).visible).toBe(true);
    // The far view rendered for it is the garden's scale, and the Orrery's is put back.
    expect(rig.scaleShown.slice(-2)).toEqual([gardenRoom.scale, orreryRoom.scale]);

    // Step over as main.ts does, and stand still on the landing.
    rig.portals.setScale(crossing.scale);
    const eye = new Vector3(crossing.x, orrery.center.y, crossing.z);
    const fades: number[] = [];
    const renders = rig.renderer.renders;
    for (let i = 0; i < Math.ceil(AFTERGLOW_SECONDS * FPS) + 2; i++) {
      rig.place(eye, new Vector3(1, 0, 0), crossing.room, crossing.scale);
      expect(rig.frame()).toBeNull();
      if (rig.portals.afterglow) fades.push(rig.uniform(orrery, "uFade"));
    }
    // Fading, eased, monotone, then gone, with the mesh hidden and no more far views.
    expect(fades.length).toBeGreaterThan(30);
    expect(fades[0]!).toBeLessThan(PORTAL_MELD / (1 - PORTAL_MELD));
    for (let i = 1; i < fades.length; i++) expect(fades[i]!).toBeLessThanOrEqual(fades[i - 1]! + 1e-9);
    expect(fades.at(-1)!).toBeLessThan(0.05);
    expect(rig.uniform(orrery, "uFade")).toBe(1);
    expect(rig.uniform(orrery, "uBlend")).toBe(0);
    expect(rig.portals.afterglow).toBeNull();
    const standingInside = eye.distanceTo(orrery.center) <= orrery.radius * 1.1;
    expect(rig.portals.meshOf(orrery).visible).toBe(!standingInside);
    // One far view per afterglow frame (the garden, from where they stood), none after.
    expect(rig.renderer.renders - renders).toBe(fades.length);
    const afterFade = rig.renderer.renders;
    rig.frame();
    expect(rig.renderer.renders).toBe(afterFade);

    // Walking clear arms it; walking back in then blends and can cross back.
    rig.place(at(orrery, 1.2), new Vector3(1, 0, 0), "orrery", orreryRoom.scale);
    rig.frame();
    expect(rig.portals.isArmed(orrery)).toBe(true);
    const back = rig.walkIn(orrery, at(orrery, 1.2), WALK, 5);
    expect(back.crossing?.room).toBe("parterre");
  });

  it("flips the material to the inside just before the surface and back only a step further out", () => {
    const rig = new Rig();
    const look = new Vector3(-1, 0, 0);
    rig.place(at(garden, 1.3), look);
    rig.frame();
    expect(rig.material(garden).side).toBe(FrontSide);
    expect(rig.material(garden).depthTest).toBe(true);
    rig.place(at(garden, 1.1), look);
    rig.frame();
    expect(rig.material(garden).side).toBe(FrontSide);
    rig.place(at(garden, 1.04), look);
    rig.frame();
    expect(rig.material(garden).side).toBe(BackSide);
    expect(rig.material(garden).depthTest).toBe(false);
    expect(rig.uniform(garden, "uInside")).toBe(1);
    rig.place(at(garden, 1.1), look);
    rig.frame();
    expect(rig.material(garden).side).toBe(BackSide);
    rig.place(at(garden, 1.2), look);
    rig.frame();
    expect(rig.material(garden).side).toBe(FrontSide);
  });

  it("renders one far view per frame only in reach and in view, into one target whose viewport grows", () => {
    const rig = new Rig();
    // Out of reach: nothing.
    rig.place(at(garden, 14), new Vector3(-1, 0, 0));
    rig.frame();
    expect(rig.renderer.renders).toBe(0);
    // In reach, but the sphere is behind the camera: nothing.
    rig.place(at(garden, 6), new Vector3(1, 0, 0));
    rig.frame();
    expect(rig.renderer.renders).toBe(0);
    expect(rig.uniform(garden, "uLive")).toBe(0);
    // In reach and in view: one render, at half resolution, in the target's lower-left.
    rig.place(at(garden, 6), new Vector3(-1, 0, 0));
    rig.frame();
    expect(rig.renderer.renders).toBe(1);
    expect(rig.uniform(garden, "uLive")).toBe(1);
    expect(rig.portals.viewScale).toBe(0.5);
    expect(rig.renderer.targets.size).toBe(1);
    const target = [...rig.renderer.targets][0]!;
    expect([target.width, target.height]).toEqual([1600, 900]);
    expect(target.viewport.toArray()).toEqual([0, 0, 800, 450]);
    expect(target.scissorTest).toBe(true);
    expect((rig.material(garden).uniforms.uViewScale!.value as Vector2).toArray()).toEqual([0.5, 0.5]);
    expect((rig.material(garden).uniforms.uResolution!.value as Vector2).toArray()).toEqual([1600, 900]);
    // Nearer, the sphere fills the view: full resolution, the same target.
    rig.place(at(garden, 1.2), new Vector3(-1, 0, 0));
    rig.frame();
    expect(rig.portals.viewScale).toBe(1);
    expect(rig.renderer.targets.size).toBe(1);
    expect(target.viewport.toArray()).toEqual([0, 0, 1600, 900]);
    // The far view showed the Orrery's scale and put the garden's back.
    expect(rig.scaleShown.slice(-2)).toEqual([orreryRoom.scale, gardenRoom.scale]);
    // The portals hid themselves from their own far view (depth one) and are back.
    expect(rig.portals.group.visible).toBe(true);
  });

  it("gives the far view the far room's depth range, so the worlds and their stars are in it from across the garden", () => {
    const rig = new Rig();
    // Where the garden sets a visitor down, facing the armillary. The walk
    // is what this test rests on, so it says what it needs of the document:
    // far enough out that the eye's own range falls short of the furthest
    // world over there, near enough that a far view is rendered at all.
    const worlds = orreryRoom.hangings[0]!;
    if (worlds.kind !== "planet") throw new Error("the Orrery's hanging is the planet");
    const deepest = Math.max(...worlds.worlds.map((w) => new Vector3(...w.position).distanceTo(garden.exit)));
    const spawn = new Vector3(gardenRoom.spawn.position[0], gardenRoom.spawn.position[1] + 1.6, gardenRoom.spawn.position[2]);
    const walk = spawn.distanceTo(garden.center);
    expect(walk).toBeGreaterThan((rig.camera.far + deepest) / garden.ratio);
    expect(walk).toBeLessThan(garden.radius * LIVE_WITHIN_RADII);

    rig.place(spawn, new Vector3(-1, 0, 0));
    rig.frame();
    expect(rig.renderer.renders).toBe(1);
    const far = rig.renderer.farCamera as PerspectiveCamera;
    expect(far.far).toBeCloseTo(rig.camera.far * garden.ratio);
    expect(far.near).toBeCloseTo(rig.camera.near * garden.ratio);
    // The same lens: the depth range scales one term of the projection and
    // leaves every term that shapes the frustum alone, so the far view lines
    // up with the near one and the portal keeps no edge.
    const eye = rig.camera.projectionMatrix.elements;
    far.projectionMatrix.elements.forEach((value, index) => {
      if (index === 14) expect(value).toBeCloseTo(eye[14]! * garden.ratio);
      else expect(value).toBeCloseTo(eye[index]!);
    });

    far.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(far.projectionMatrix, far.matrixWorldInverse),
    );
    const planet = worlds;
    // A thousand seven hundred Orrery metres out: with the garden's own six
    // hundred the frustum stopped short of every one of them and the
    // armillary was a black dome (the Orrery empty through the portal).
    for (const world of planet.worlds) {
      const centre = new Vector3(...world.position);
      expect(far.position.distanceTo(centre)).toBeGreaterThan(rig.camera.far);
      expect(frustum.intersectsSphere(new Sphere(centre, planet.radiusMeters))).toBe(true);
    }
    // And the star field behind them, on the dome the room is drawn inside.
    expect(far.position.distanceTo(starDomeCentre(orreryRoom)) + STAR_DOME_RADIUS).toBeLessThan(far.far);
  });

  it("offers the far view's target only once one has been rendered, and never on a backend without them", () => {
    const rig = new Rig();
    expect(rig.portals.farTarget).toBeNull();
    rig.place(at(garden, 6), new Vector3(-1, 0, 0));
    rig.frame();
    expect(rig.renderer.renders).toBe(1);
    expect(rig.portals.farTarget).toBe([...rig.renderer.targets][0]);
    expect(rig.portals.viewScale).toBe(0.5);
    // A renderer without render targets renders no far view and offers none.
    const fading = new Rig(false);
    fading.place(at(garden, 6), new Vector3(-1, 0, 0));
    fading.frame();
    expect(fading.portals.farTarget).toBeNull();
  });

  it("blends by the eased, intent-shaped depth once armed", () => {
    const rig = new Rig();
    rig.place(at(garden, 1.3), new Vector3(-1, 0, 0));
    rig.frame();
    rig.place(at(garden, 0.6), new Vector3(-1, 0, 0));
    rig.frame();
    const t = rig.uniform(garden, "uBlend");
    expect(t).toBeCloseTo(shapedBlend(0.6 * garden.radius, garden.radius, 0));
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
  });

  it("fades without a far view on a renderer without render targets, or in a headset", () => {
    const rig = new Rig(false);
    rig.place(at(garden, 1.3), new Vector3(-1, 0, 0));
    rig.frame(1 / FPS, false);
    rig.place(at(garden, 0.6), new Vector3(-1, 0, 0));
    rig.frame(1 / FPS, false);
    expect(rig.uniform(garden, "uLive")).toBe(0);
    expect(rig.uniform(garden, "uBlend")).toBeGreaterThan(0);
    // A headset still steps through, with intent.
    const result = rig.walkIn(garden, at(garden, 1.6), WALK, 5);
    expect(result.crossing).not.toBeNull();
    expect(result.distance).toBeGreaterThan(STRICT_CORE * garden.radius * 1.3);
    // And the afterglow is a plain veil, fading from full.
    expect(rig.uniform(orrery, "uFade")).toBe(1);
    expect(rig.uniform(orrery, "uLive")).toBe(0);
  });

  it("arriving in an end by any other road leaves it quiet until walked clear of", () => {
    const rig = new Rig();
    rig.portals.setScale(orreryRoom.scale);
    rig.place(at(orrery, 0), new Vector3(1, 0, 0), "orrery", orreryRoom.scale);
    expect(rig.frame()).toBeNull();
    expect(rig.portals.isArmed(orrery)).toBe(false);
    expect(rig.portals.meshOf(orrery).visible).toBe(false);
    rig.place(at(orrery, 1.2), new Vector3(1, 0, 0), "orrery", orreryRoom.scale);
    rig.frame();
    expect(rig.portals.isArmed(orrery)).toBe(true);
    expect(rig.portals.meshOf(orrery).visible).toBe(true);
  });

  it("allocates nothing per frame beyond the first far view", () => {
    const rig = new Rig();
    rig.place(at(garden, 3), new Vector3(-1, 0, 0));
    rig.frame();
    const target = rig.renderer.targets.size;
    for (let i = 0; i < 30; i++) {
      rig.place(at(garden, 3 - i * 0.05), new Vector3(-1, 0, 0));
      rig.frame();
    }
    expect(rig.renderer.targets.size).toBe(target);
  });
});

describe("a locked portal is seen through, not stepped through", () => {
  // A portal crosses presence rooms exactly as a doorway does: the Meridian
  // Garden joins "parterre", the Orrery joins "orrery". Without this the
  // armillary is the one road left into a room presence would refuse, which
  // puts the body in one room and the visitor's presence in another.

  /**
   * The same committed head-on walk as the crossing tests, but stopped at
   * whichever comes first: the crossing, or the frame the lock refuses one.
   * Walking the full five seconds would carry the eye out the far side, where
   * there is no portal to be refused by and nothing to assert about.
   */
  function walkUntilStopped(rig: Rig) {
    const along = toward(garden, at(garden, 1.6));
    const eye = at(garden, 1.6);
    const dt = 1 / FPS;
    for (let i = 0; i < Math.round(5 * FPS); i++) {
      eye.addScaledVector(along, WALK * dt);
      rig.place(eye, along, garden.room, garden.scale);
      const crossing = rig.frame(dt);
      if (crossing || rig.portals.lockedOut) return { crossing, locked: rig.portals.lockedOut };
    }
    return { crossing: null, locked: rig.portals.lockedOut };
  }

  it("walks a committed approach right in when the far room is open", () => {
    const result = walkUntilStopped(new Rig());
    expect(result.crossing?.room).toBe("orrery");
    expect(result.locked).toBeNull();
  });

  it("refuses the same walk and names the room when the Orrery is locked", () => {
    const rig = new Rig();
    rig.locked = (id) => id === "orrery";
    const result = walkUntilStopped(rig);
    expect(result.crossing).toBeNull();
    expect(result.locked).toBe("orrery");
  });

  it("still blends, so the visitor sees the room they may not enter", () => {
    // A locked portal that went dark would read as a broken portal rather
    // than as a door that will not open.
    const rig = new Rig();
    rig.locked = (id) => id === "orrery";
    walkUntilStopped(rig);
    expect(rig.uniform(garden, "uBlend")).toBeGreaterThan(0);
  });

  it("locks nothing when the predicate names some other room", () => {
    const rig = new Rig();
    rig.locked = (id) => id === "terrace";
    const result = walkUntilStopped(rig);
    expect(result.crossing?.room).toBe("orrery");
    expect(result.locked).toBeNull();
  });
});

describe("the Orrery in the document", () => {
  it("is the one room at another scale, in space, with spectre's worlds cut toward the landing", () => {
    const room = orreryRoom;
    expect(room.scale).toBeLessThan(1);
    // Through the portal, every world is a globe inside the armillary's blend sphere.
    for (const world of (room.hangings[0] as { worlds: { position: number[] }[] }).worlds) {
      const [x, y, z] = world.position as [number, number, number];
      const shrunk = Math.hypot(x - armillary.exit.position[0], y - armillary.exit.position[1], z - armillary.exit.position[2]) * room.scale;
      expect(shrunk + 40 * room.scale).toBeLessThan(armillary.radius);
    }
    expect(room.architecture).toBe("space");
    expect(room.doorways).toEqual([]);
    // Not a cell of the grounds: the hall's neighbourhood must not pull it in with the gardens.
    expect(room.fallback.kind).toBe("box");
    // The other rooms at another scale are arcedit's canvas and the inside of
    // quantumflow's cloud, each a tenth of the palace's metre.
    expect(mansion.rooms.filter((r) => r.scale !== 1).map((r) => [r.id, r.scale])).toEqual([["orrery", 0.02], ["arcedit/inside", 0.1], ["quantumflow/inside", 0.1]]);
    const planet = room.hangings[0]!;
    expect(planet.kind).toBe("planet");
    if (planet.kind !== "planet") return;
    expect(planet.radiusMeters).toBe(40);
    expect(planet.worlds.map((w) => w.world)).toEqual(["adiabat-chi0", "adiabat-chi6", "adiabat-chi12"]);
    for (const world of planet.worlds) {
      expect(world.cutToward).toEqual(armillary.exit.landing ?? armillary.exit.position);
      // Each world clears the walking plane; the star dome that holds them
      // is the next test's, which measures it against the dome itself.
      expect(world.position[1] - planet.radiusMeters).toBeGreaterThan(5);
    }
  });

  it("stands inside a star dome that holds its worlds and still fits the eye's range from the furthest corner", () => {
    const centre = starDomeCentre(orreryRoom);
    const planet = orreryRoom.hangings[0]!;
    if (planet.kind !== "planet") throw new Error("the Orrery's hanging is the planet");
    // Wide enough: every world, to its far side, is inside the dome.
    for (const world of planet.worlds) {
      const out = new Vector3(...world.position).distanceTo(centre) + planet.radiusMeters;
      expect(out).toBeLessThan(STAR_DOME_RADIUS);
    }
    // Narrow enough: from the corner a visitor can walk to, the dome's far
    // wall is still within the eye's range. Beyond it the sky is cut away —
    // a starless hole opens where the stars should be.
    let corner = 0;
    for (const x of [orreryRoom.bounds.min[0]!, orreryRoom.bounds.max[0]!]) {
      for (const y of [orreryRoom.bounds.min[1]!, orreryRoom.bounds.max[1]!]) {
        for (const z of [orreryRoom.bounds.min[2]!, orreryRoom.bounds.max[2]!]) {
          corner = Math.max(corner, new Vector3(x, y, z).distanceTo(centre));
        }
      }
    }
    expect(corner + STAR_DOME_RADIUS).toBeLessThan(VIEW_FAR);
    // And wide enough for the armillary: seen from the garden the dome is
    // shrunk by the scale ratio, and below the lens's own radius it would
    // stop covering it — stars would give way to the page's background in
    // the middle of the portal.
    expect(STAR_DOME_RADIUS / garden.ratio).toBeGreaterThan(garden.radius);
  });

  it("is a neighbour of the garden through the portal, both ways, and the garden's cells come with it", () => {
    expect(neighbourhood(mansion, "parterre")).toContain("orrery");
    const fromOrrery = neighbourhood(mansion, "orrery");
    for (const id of ["parterre", "terrace", "orchard-west", "orchard-south", "orchard-east"]) expect(fromOrrery).toContain(id);
    expect(fromOrrery).not.toContain("hall");
    // Two doorways from the hall do not reach the garden's portal.
    expect(neighbourhood(mansion, "hall")).not.toContain("orrery");
  });

  it("keeps no chamber for spectre: its cutaways stand in the Orrery alone, and no point clouds on that tree (ruled 2026-09-16)", () => {
    expect(mansion.rooms.find((r) => r.id === "spectre")).toBeUndefined();
    const planets = mansion.rooms.flatMap((room) => room.hangings.filter((h) => h.kind === "planet").map((h) => `${room.id}/${h.id}`));
    expect(planets).toEqual(["orrery/orrery-worlds"]);
    for (const room of mansion.rooms) {
      for (const hanging of room.hangings) {
        if (hanging.kind === "tape") expect(hanging.bundle.exhibit?.tree, `${room.id}/${hanging.id}`).not.toBe("spectre");
      }
    }
  });

  it("has no floating world outside any more", () => {
    for (const room of mansion.rooms) {
      for (const hanging of room.hangings) {
        if (hanging.kind !== "tape") continue;
        expect(hanging.id, `${room.id}/${hanging.id}`).not.toBe("moon");
        // In the palace's metres: arcedit's canvas is 45 m at a tenth.
        expect(hanging.longSideMeters * room.scale).toBeLessThan(10);
      }
    }
  });
});

describe("MansionSchema portals", () => {
  const base = () => ({
    schema: "orchard/mansion/1", start: "a",
    rooms: [
      { id: "a", presence: "a", bounds: { min: [0, 0, 0], max: [10, 4, 10] }, spawn: { position: [5, 0, 5] } },
      { id: "b", presence: "b", scale: 0.1, bounds: { min: [100, 0, 0], max: [110, 4, 10] }, spawn: { position: [105, 0, 5] } },
    ],
  });
  const portal = (extra = {}) => ({ id: "p", to: "b", position: [5, 1.6, 5], exit: { position: [105, 1.6, 5] }, ...extra });

  it("accepts a portal between two scales with both ends inside their rooms", () => {
    const doc = base();
    (doc.rooms[0] as { portals?: unknown[] }).portals = [portal()];
    expect(() => parseMansion(doc)).not.toThrow();
  });

  it("rejects a portal between rooms of one scale: that is a doorway", () => {
    const doc = base();
    (doc.rooms[1] as { scale?: number }).scale = 1;
    (doc.rooms[0] as { portals?: unknown[] }).portals = [portal()];
    expect(() => parseMansion(doc)).toThrow(/same scale/);
  });

  it("rejects an end outside its room, and a destination that does not exist", () => {
    const doc = base();
    (doc.rooms[0] as { portals?: unknown[] }).portals = [portal({ position: [50, 1.6, 5] })];
    expect(() => parseMansion(doc)).toThrow(/is outside/);
    const doc2 = base();
    (doc2.rooms[0] as { portals?: unknown[] }).portals = [portal({ exit: { position: [5, 1.6, 5] } })];
    expect(() => parseMansion(doc2)).toThrow(/exits outside/);
    const doc3 = base();
    (doc3.rooms[0] as { portals?: unknown[] }).portals = [portal({ to: "c" })];
    expect(() => parseMansion(doc3)).toThrow(/unknown room/);
  });
});
