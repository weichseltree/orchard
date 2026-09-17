// The cat's mesh: lofted rings of vertices along the torso, ruff, head, tail and legs, skinned to
// the skeleton in skeleton.ts by distance to each bone. Every vertex and colour is generated here
// from a CatAppearance (appearance.ts); nothing is loaded. Low-poly and flat-shaded, and long-
// haired: rings on the furry parts push every other vertex out into a tuft and lean it the way
// the hair lies, with alternate rings turned half a step so the tufts interleave. That turns a
// smooth tube's silhouette into a ragged one from any angle for no extra triangles.

import * as THREE from "three";
import { DEFAULT_APPEARANCE, type CatAppearance } from "./appearance";
import { buildFace, type CatFace } from "./face";
import { BONES, bone, TAIL_BONES, type BoneName, type LegChain, type Vec3, LEGS } from "./skeleton";

/** Scales how strongly a section tufts at ring angle `a` (90 degrees = the ring's v axis). */
type TuftWeight = (a: number) => number;

interface Section {
  c: Vec3;
  /** Half-widths: rx across the body (x), ry in the ring's other axis (up for the torso and
   * tail, forward for a leg). */
  rx: number;
  ry: number;
  /** Tuft length, metres in rig units; 0 or absent = smooth. */
  tuft?: number;
  weight?: TuftWeight | undefined;
  /** A smooth radial swelling (or, negative, a hollow) in metres, by ring angle: whisker pads
   * and brows. Unlike a tuft it moves every vertex of the ring, so the surface stays smooth. */
  bulge?: TuftWeight | undefined;
}

/** `pos` is the vertex's rest position before tufting; `f` its fraction along the part, 0..1. */
type Colourist = (pos: Vec3, ringAngle: number, f: number) => THREE.Color;

interface Part {
  sections: Section[];
  segments: number;
  bones: BoneName[];
  colour: Colourist;
  capStart: boolean;
  capEnd: boolean;
  /** World direction the hair lies in, added to each tuft tip. */
  flow?: Vec3;
  /** How much the tuft tips also lean along the part toward its end. */
  flowAlong?: number;
  /** How far a tuft tip leans along the hair, as a multiple of its length (default 1.1). Short
   * leans keep cheek and mane tufts from fanning into flat plates. */
  lean?: number;
  /** Turn odd rings half a segment so tufts interleave. */
  stagger?: boolean;
}

const X: Vec3 = [1, 0, 0];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function addv(a: Vec3, b: Vec3, s = 1): Vec3 {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
function smooth(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
function mix(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return a.clone().lerp(b, clamp01(t));
}

/** A repeatable pseudo-random number in [0, 1) for ring i, vertex k. */
function hash(i: number, k: number, salt: number): number {
  const x = Math.sin(i * 127.1 + k * 311.7 + salt * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Distance from a point to the segment head-tail. */
function segmentDistance(p: Vec3, head: Vec3, tail: Vec3): number {
  const d = sub(tail, head);
  const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const w = sub(p, head);
  const t =
    len2 > 0 ? Math.min(1, Math.max(0, (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / len2)) : 0;
  return Math.hypot(w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2]);
}

class MeshBuilder {
  positions: number[] = [];
  colours: number[] = [];
  skinIndex: number[] = [];
  skinWeight: number[] = [];
  index: number[] = [];
  /** Every bone some vertex was skinned against since the last reset, for Cat.parts. */
  used = new Set<BoneName>();
  constructor(private boneIndex: Map<BoneName, number>) {}

  /** A vertex at `p`, skinned as if it sat at `skinAt` (a tuft moves with the skin under it). */
  vertex(p: Vec3, colour: THREE.Color, bones: BoneName[], skinAt: Vec3 = p): number {
    const i = this.positions.length / 3;
    this.positions.push(p[0], p[1], p[2]);
    this.colours.push(colour.r, colour.g, colour.b);
    this.skin(skinAt, bones);
    for (const b of bones) this.used.add(b);
    return i;
  }

  /** Inverse-distance weights over the part's candidate bones, four at most: smooth across a
   * joint, near-rigid along a bone, and never bleeding into the other leg. */
  private skin(p: Vec3, candidates: BoneName[]): void {
    const soft = 0.012;
    const scored = candidates
      .map((name) => {
        const b = bone(name);
        const d = segmentDistance(p, b.head, b.tail);
        return { name, w: 1 / (d * d + soft * soft) ** 2 };
      })
      .sort((a, b) => b.w - a.w)
      .slice(0, 4);
    const total = scored.reduce((s, x) => s + x.w, 0);
    for (let k = 0; k < 4; k++) {
      const s = scored[k];
      this.skinIndex.push(s ? this.boneIndex.get(s.name)! : 0);
      this.skinWeight.push(s ? s.w / total : 0);
    }
  }

  tri(a: number, b: number, c: number): void {
    this.index.push(a, b, c);
  }

  loft(part: Part): void {
    const { sections, segments } = part;
    const rings: number[][] = [];
    const n = sections.length;
    for (let i = 0; i < n; i++) {
      const s = sections[i]!;
      const prev = sections[Math.max(0, i - 1)]!.c;
      const next = sections[Math.min(n - 1, i + 1)]!.c;
      const t = norm(sub(next, prev));
      const u = X;
      const v = norm(cross(t, u));
      const flow = norm(addv(part.flow ?? [0, 0, 0], t, part.flowAlong ?? 0));
      const f = n > 1 ? i / (n - 1) : 0;
      const turn = part.stagger && i % 2 === 1 ? 0.5 : 0;
      const ring: number[] = [];
      for (let k = 0; k < segments; k++) {
        const a = (2 * Math.PI * (k + turn)) / segments;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        let base = addv(addv(s.c, u, s.rx * ca), v, s.ry * sa);
        // The ellipse's outward normal in the ring plane.
        const out = norm(
          addv([u[0] * ca * s.ry, u[1] * ca * s.ry, u[2] * ca * s.ry], v, sa * s.rx),
        );
        if (s.bulge) base = addv(base, out, s.bulge(a));
        // Locks vary in length; the hash keeps the cat identical on every build.
        const len =
          (s.tuft ?? 0) * (s.weight ? s.weight(a) : 1) * (0.55 + 0.9 * hash(i, k, segments));
        let p = base;
        let shade = 1;
        if (len > 0) {
          if (k % 2 === 0) {
            // Lean the tip along the skin, never back into it.
            const along = flow[0] * out[0] + flow[1] * out[1] + flow[2] * out[2];
            const lean = addv(flow, out, -along);
            p = addv(addv(base, out, len), lean, (part.lean ?? 1.1) * len);
            shade = 1.06;
          } else {
            p = addv(base, out, -0.3 * len);
            shade = 0.93;
          }
        }
        const colour = part.colour(base, a, f).multiplyScalar(shade);
        ring.push(this.vertex(p, colour, part.bones, base));
      }
      rings.push(ring);
    }
    // Ring vertices run counter-clockwise seen from +t, so the ring's tangent is t x radial and
    // (i,k)->(i,k+1)->(i+1,k) faces outward; the reverse order renders the cat inside-out.
    for (let i = 0; i + 1 < rings.length; i++) {
      const r0 = rings[i]!;
      const r1 = rings[i + 1]!;
      for (let k = 0; k < segments; k++) {
        const k1 = (k + 1) % segments;
        this.tri(r0[k]!, r0[k1]!, r1[k]!);
        this.tri(r0[k1]!, r1[k1]!, r1[k]!);
      }
    }
    if (part.capStart) {
      const s = sections[0]!;
      const pole = this.vertex(s.c, part.colour(s.c, -Math.PI / 2, 0), part.bones);
      const r = rings[0]!;
      for (let k = 0; k < segments; k++) this.tri(pole, r[(k + 1) % segments]!, r[k]!);
    }
    if (part.capEnd) {
      const s = sections[n - 1]!;
      const pole = this.vertex(s.c, part.colour(s.c, -Math.PI / 2, 1), part.bones);
      const r = rings[n - 1]!;
      for (let k = 0; k < segments; k++) this.tri(pole, r[k]!, r[(k + 1) % segments]!);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colours, 3));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.skinIndex, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.skinWeight, 4));
    g.setIndex(this.index);
    g.computeVertexNormals();
    return g;
  }
}

function sec(
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  tuft = 0,
  weight?: TuftWeight,
): Section {
  return { c: [x, y, z], rx, ry, tuft, weight };
}

// Where tufts grow, by ring angle. For the torso and tail the ring's v axis is up; for a leg it
// is forward, so "below" on a leg means behind it.
const below: TuftWeight = (a) => 0.4 + 0.8 * Math.max(0, -Math.sin(a));
/** A mane: long at the sides where it frames the face and below in the bib, short on top. */
const mane: TuftWeight = (a) => 0.2 + 0.8 * Math.max(Math.abs(Math.cos(a)), -Math.sin(a));
const sides: TuftWeight = (a) => 0.3 + 0.7 * Math.abs(Math.cos(a));
const behind: TuftWeight = (a) => 0.15 + 0.85 * Math.max(0, -Math.sin(a));
const jowls: TuftWeight = (a) =>
  Math.max(0, Math.abs(Math.cos(a)) - 0.3) * (Math.sin(a) < 0.45 ? 1.5 : 0.35);
/** A soft brow over each eye: the ring swells where the skull carries the eye socket. */
const brow: TuftWeight = (a) =>
  0.006 *
  Math.max(0, 1 - Math.abs(Math.sin(a) - 0.5) / 0.4) *
  Math.max(0, Math.abs(Math.cos(a)) - 0.2);
/** The stop: the bridge of the nose dips between the eyes, which is most of what makes a cat's
 * profile read as a cat rather than a bear. */
const stop: TuftWeight = (a) =>
  -0.005 *
  Math.max(0, 1 - Math.abs(Math.sin(a) - 0.75) / 0.45) *
  Math.max(0, 0.6 - Math.abs(Math.cos(a)));
/** Whisker pads: two puffs on the lower sides of the muzzle. */
const pads: TuftWeight = (a) =>
  0.014 *
  Math.max(0, Math.abs(Math.cos(a)) - 0.35) *
  Math.max(0, 1 - Math.max(0, Math.sin(a)) / 0.45);

/** The colours of one cat, as functions of rest position. */
interface Palette {
  torso: Colourist;
  ruff: Colourist;
  head: Colourist;
  tail: Colourist;
  leg: (kind: LegChain["kind"]) => Colourist;
  ear: THREE.Color;
  earInner: THREE.Color;
  /** The darkest point colour: eye rims, the mouth line. */
  deep: THREE.Color;
  nose: THREE.Color;
  eye: THREE.Color;
}

/** Where the mask is centred: just behind the nose leather. */
const NOSE: Vec3 = [0, 0.2745, 0.313];

function palette(app: CatAppearance): Palette {
  const c = app.colours;
  const body = new THREE.Color(c.body);
  const back = new THREE.Color(c.back);
  const belly = new THREE.Color(c.belly);
  const point = new THREE.Color(c.point);
  const deep = new THREE.Color(c.pointDeep);

  const torso: Colourist = (pos, a) => {
    const up = Math.sin(a);
    let col = up > 0 ? mix(body, back, up ** 1.5) : mix(body, belly, -up * 1.2);
    // The chest and bib run pale into the ruff.
    col = mix(col, belly, smooth(0.08, 0.17, pos[2]) * (1 - Math.max(0, up)));
    // The shading on the back deepens toward the tail.
    return mix(col, back, smooth(-0.05, -0.18, pos[2]) * Math.max(0, up) * 0.6);
  };

  // The torso's own gradient, so the mane does not read as a separate collar; its underside is
  // the bib, paler still.
  const ruff: Colourist = (pos, a, f) =>
    mix(torso(pos, a, f), belly, Math.max(0, -Math.sin(a)) * smooth(0.1, 0.19, pos[2]) * 0.6);

  // The mask, read off the photos: darkest on the nose and muzzle, spreading up over the bridge
  // and around the eyes, then narrowing into an inverted V over the forehead and fading out into
  // pale cheeks and ruff. Seal is near-black and wider (a bigger app.mask), blue a soft grey.
  const head: Colourist = (pos, a) => {
    const x = Math.abs(pos[0]);
    const dy = pos[1] - NOSE[1];
    const dz = pos[2] - NOSE[2];
    // An ellipsoid round the muzzle, stretched up the bridge and back along the nose.
    const d = Math.hypot(x / 1.05, dy > 0 ? dy / 1.5 : dy * 1.4, dz / 1.15);
    let m = 1 - smooth(0.026 * app.mask, 0.09 * app.mask, d);
    // The inverted V: a band up the forehead that narrows toward the crown and dies below it.
    const wedge = 0.05 * app.mask - (pos[1] - 0.3) * 1.3;
    const v =
      smooth(wedge + 0.014, wedge - 0.014, x) *
      smooth(0.285, 0.305, pos[1]) *
      (1 - smooth(0.325, 0.365, pos[1])) *
      smooth(0.21, 0.25, pos[2]);
    m = Math.max(m, v * 0.9);
    let col = mix(body, point, m);
    col = mix(col, deep, (1 - smooth(0.006, 0.04 * app.mask, d)) * 0.5);
    // Cheeks: pale below and outside the mask, running into the ruff.
    const cheek = smooth(0.042, 0.072, x) * (1 - smooth(0.285, 0.305, pos[1]));
    col = mix(col, body, cheek * 0.9);
    // The whisker pads catch the light: paler puffs either side of the nose, strongest on the
    // blue point, where the photos show almost white pads under a grey mask.
    const pad =
      smooth(0.01, 0.028, x) *
      (1 - smooth(0.042, 0.066, x)) *
      smooth(0.284, 0.271, pos[1]) *
      smooth(0.288, 0.303, pos[2]);
    col = mix(col, belly, pad * Math.max(0.25, 1.25 - 0.55 * app.mask));
    // Pale under the chin and behind the cheeks.
    const under = Math.max(0, -Math.sin(a));
    return mix(col, belly, under * smooth(0.3, 0.25, pos[2]) * 0.7);
  };

  const tail: Colourist = (_pos, _a, f) => {
    const col = mix(back, point, smooth(-0.1, app.tailPoint, f));
    return mix(col, deep, smooth(0.45, 1, f) * 0.7);
  };

  const leg =
    (kind: LegChain["kind"]): Colourist =>
    (pos, a) => {
      const top = kind === "fore" ? 0.19 : 0.12;
      const dark = smooth(top, 0.07, pos[1]) * app.legPoint;
      let col = mix(body, point, dark);
      col = mix(col, deep, smooth(0.03, 0.0, pos[1]) * app.legPoint * 0.45);
      if (kind === "hind") {
        // Britches: the backs of the thighs stay pale down to the hock.
        const back = Math.max(0, -Math.sin(a));
        col = mix(col, belly, back * smooth(0.06, 0.12, pos[1]) * 0.8);
      }
      return col;
    };

  return {
    torso,
    ruff,
    head,
    tail,
    leg,
    ear: deep,
    earInner: mix(belly, body, 0.4),
    deep,
    nose: new THREE.Color(c.nose),
    eye: new THREE.Color(c.eye),
  };
}

/** Rump to the base of the skull: broad chest, deep flanks, a belly line that hangs. */
function torso(app: CatAppearance, pal: Palette, detail: number): Part {
  const g = app.proportions.girth;
  const w = app.proportions.breadth;
  const f = app.fur;
  const t = 0.02 * f;
  /** How far the underline sags at this point along the body: deepest just ahead of the thighs,
   * gone by the ribcage in front and the rump behind. */
  const sag = (z: number): number =>
    app.proportions.pouch * smooth(-0.175, -0.1, z) * (1 - smooth(-0.04, 0.09, z));
  const s = (z: number, y: number, rx: number, ry: number, tuft = t): Section => ({
    ...sec(0, y, z, rx * g * w, ry * g, tuft, below),
    bulge: (a) => sag(z) * Math.max(0, -Math.sin(a)) ** 1.5,
  });
  return {
    segments: segments(24, detail),
    bones: ["root", "spine1", "belly", "spine2", "spine3", "neck"],
    colour: pal.torso,
    capStart: true,
    capEnd: false,
    flow: [0, -0.35, -1],
    stagger: true,
    sections: [
      s(-0.2, 0.192, 0.03, 0.032, 0),
      s(-0.185, 0.19, 0.056, 0.058, t * 0.6),
      s(-0.16, 0.187, 0.071, 0.073),
      s(-0.128, 0.184, 0.079, 0.081),
      s(-0.095, 0.178, 0.082, 0.089),
      s(-0.06, 0.176, 0.083, 0.094),
      s(-0.025, 0.177, 0.082, 0.096),
      s(0.01, 0.181, 0.081, 0.094),
      s(0.045, 0.188, 0.078, 0.089),
      s(0.078, 0.198, 0.074, 0.08),
      s(0.108, 0.205, 0.068, 0.073),
      s(0.138, 0.215, 0.058, 0.063),
      s(0.165, 0.232, 0.048, 0.052, t * 0.5),
      s(0.192, 0.256, 0.036, 0.036, 0),
    ],
  };
}

/** The mane: a collar round the neck that frames the face and drops into a bib over the chest.
 * Its top stays below the crown so it never forms a hood behind the head. */
function ruff(app: CatAppearance, pal: Palette, detail: number): Part {
  const r = app.proportions.ruff;
  const w = app.proportions.breadth;
  const t = 0.03 * app.fur * r;
  const s = (z: number, top: number, bottom: number, half: number, tuft: number): Section => {
    const mid = (top + bottom) / 2;
    return sec(0, mid, z, half * r * (1 + (w - 1) * 0.5), ((top - bottom) / 2) * r, tuft, mane);
  };
  return {
    segments: segments(16, detail),
    bones: ["spine3", "neck", "head"],
    colour: pal.ruff,
    capStart: true,
    capEnd: true,
    flow: [0, -1, -0.25],
    lean: 0.3,
    stagger: true,
    // Starts well inside the chest and swells slowly, so from behind it rises out of the
    // shoulders instead of ending in a flat disc.
    sections: [
      s(0.03, 0.255, 0.15, 0.042, 0),
      s(0.075, 0.272, 0.135, 0.058, t * 0.2),
      s(0.115, 0.287, 0.125, 0.073, t * 0.5),
      s(0.157, 0.297, 0.12, 0.086, t),
      s(0.185, 0.298, 0.124, 0.089, t),
      s(0.21, 0.292, 0.138, 0.087, t),
      s(0.232, 0.284, 0.16, 0.072, t * 0.7),
      s(0.252, 0.28, 0.21, 0.04, 0),
    ],
  };
}

/** A broad, rounded wedge: wide cheeks with fluffy jowls, a flat forehead, a brow over each eye
 * and a short nose bridge with a slight stop; muzzle() carries the front of the face. */
function headSections(app: CatAppearance): Section[] {
  const h = app.proportions.head * 1.06;
  const t = 0.022 * app.fur * h;
  const s = (
    z: number,
    y: number,
    rx: number,
    ry: number,
    tuft = 0,
    bulge?: TuftWeight,
  ): Section => ({ ...sec(0, y, z, rx * h, ry * h, tuft, jowls), bulge });
  return [
    s(0.19, 0.282, 0.04, 0.04),
    s(0.205, 0.286, 0.062, 0.055, t * 0.5),
    s(0.224, 0.288, 0.075, 0.063, t * 0.9),
    s(0.244, 0.288, 0.078, 0.063, t),
    s(0.262, 0.286, 0.075, 0.059, t * 0.9, brow),
    s(0.278, 0.283, 0.068, 0.053, t * 0.5, brow),
    s(0.292, 0.279, 0.058, 0.046, t * 0.2, stop),
    s(0.302, 0.276, 0.045, 0.037, 0, stop),
    s(0.31, 0.273, 0.031, 0.026),
    s(0.315, 0.272, 0.016, 0.014),
  ];
}

/** The muzzle: whisker-pad puffs either side of the nose, a small chin, and the short bridge
 * that runs up to the stop between the eyes. */
function muzzle(app: CatAppearance, pal: Palette, detail: number): Part {
  const h = app.proportions.head * 1.06;
  const s = (z: number, y: number, rx: number, ry: number, bulge?: TuftWeight): Section => ({
    ...sec(0, y, z, rx * h, ry * h, 0),
    bulge,
  });
  return {
    segments: segments(12, detail),
    bones: ["head", "jaw"],
    colour: pal.head,
    capStart: false,
    capEnd: true,
    stagger: false,
    sections: [
      s(0.284, 0.2745, 0.042, 0.034),
      s(0.296, 0.2725, 0.047, 0.037, pads),
      s(0.307, 0.2715, 0.045, 0.035, pads),
      s(0.317, 0.2725, 0.035, 0.026),
      s(0.325, 0.2735, 0.019, 0.015),
    ],
  };
}

function head(app: CatAppearance, pal: Palette, detail: number): Part {
  return {
    segments: segments(14, detail),
    bones: ["neck", "head"],
    colour: pal.head,
    capStart: true,
    capEnd: true,
    flow: [0, -1, -0.3],
    lean: 0.35,
    stagger: true,
    sections: headSections(app),
  };
}

/** The first z (from the front) where the head's surface reaches the line through (x, y). */
function headSurfaceZ(sections: Section[], x: number, y: number): number {
  const inside = (s: Section): boolean => (x / s.rx) ** 2 + ((y - s.c[1]) / s.ry) ** 2 <= 1;
  for (let i = sections.length - 1; i > 0; i--) {
    const a = sections[i - 1]!;
    const b = sections[i]!;
    if (inside(b)) return b.c[2];
    for (let k = 1; k <= 10; k++) {
      const u = k / 10;
      const s: Section = {
        c: [0, b.c[1] + (a.c[1] - b.c[1]) * u, b.c[2] + (a.c[2] - b.c[2]) * u],
        rx: b.rx + (a.rx - b.rx) * u,
        ry: b.ry + (a.ry - b.ry) * u,
      };
      if (inside(s)) return s.c[2];
    }
  }
  return sections[0]!.c[2];
}

/** A plume: much wider than the bone, fullest two-thirds of the way out, tufting sideways. */
function tail(app: CatAppearance, pal: Palette, detail: number): Part {
  const w = app.proportions.tail;
  const names: BoneName[] = ["root", ...TAIL_BONES];
  const points: Vec3[] = [];
  for (const name of TAIL_BONES) {
    const b = bone(name);
    points.push(b.head, [
      (b.head[0] + b.tail[0]) / 2,
      (b.head[1] + b.tail[1]) / 2,
      (b.head[2] + b.tail[2]) / 2,
    ]);
  }
  points.push(bone("tail6").tail);
  const radii = [
    0.026, 0.036, 0.043, 0.048, 0.052, 0.055, 0.056, 0.056, 0.054, 0.05, 0.043, 0.032, 0.014,
  ];
  const sections = points.map((c, i): Section => {
    const r = radii[i]! * w;
    const tuft = i === 0 || i === points.length - 1 ? 0 : 0.03 * app.fur * w;
    return { c, rx: r, ry: r * 0.8, tuft, weight: sides };
  });
  return {
    segments: segments(12, detail),
    bones: names,
    colour: pal.tail,
    capStart: false,
    capEnd: true,
    flowAlong: 1.2,
    stagger: true,
    sections,
  };
}

/** One leg: heavy boning, a feathered back to the foreleg, britches on the thigh, and a big
 * round paw with toe tufts. */
function legPart(app: CatAppearance, pal: Palette, c: LegChain, detail: number): Part {
  const L = app.proportions.legs;
  // A heavy cat's upper arms and thighs are thicker, but its feet are not much bigger.
  const W = app.proportions.breadth;
  const P = app.proportions.paws;
  const B = app.proportions.britches;
  const F = app.fur;
  const g = bone(c.girdle);
  const upper = bone(c.upper);
  const lower = bone(c.lower);
  const meta = bone(c.meta);
  const paw = bone(c.paw);
  const fore = c.kind === "fore";
  const mid = (a: Vec3, b: Vec3, u = 0.5): Vec3 => [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ];
  const at = (p: Vec3, dz: number, dy = 0): Vec3 => [p[0], p[1] + dy, p[2] + dz];
  const toe = 0.008 * F * P;
  // The paw rides high enough that its fur and toe tufts rest ON the floor rather than through
  // it, whatever the coat is set to: the lift follows the tuft length.
  const sole = 0.012 * P + 0.55 * toe;
  const pawSections: Section[] = [
    { c: at(paw.head, -0.004, sole + 0.008 * P), rx: 0.024 * P, ry: 0.022 * P, tuft: toe },
    {
      c: at(mid(paw.head, paw.tail), 0.002, sole + 0.006 * P),
      rx: 0.027 * P,
      ry: 0.014 * P,
      tuft: toe,
    },
    { c: at(paw.tail, 0.007, sole + 0.002 * P), rx: 0.02 * P, ry: 0.009 * P, tuft: toe * 1.5 },
  ];
  const feather = 0.012 * F * L;
  const britch = 0.02 * F * B;
  const sections: Section[] = fore
    ? [
        { c: at(g.head, 0, -0.005), rx: 0.03 * L * W, ry: 0.04 * L },
        { c: upper.head, rx: 0.032 * L * W, ry: 0.042 * L, tuft: feather, weight: behind },
        {
          c: mid(upper.head, lower.head),
          rx: 0.028 * L * (1 + (W - 1) * 0.6),
          ry: 0.035 * L,
          tuft: feather,
          weight: behind,
        },
        // The feathering thins below the elbow: in the sphinx the forearm lies flat on the floor,
        // and long hair there would hang through it.
        { c: lower.head, rx: 0.026 * L, ry: 0.03 * L, tuft: feather * 0.5, weight: behind },
        {
          c: mid(lower.head, meta.head),
          rx: 0.023 * L,
          ry: 0.025 * L,
          tuft: feather * 0.3,
          weight: behind,
        },
        { c: meta.head, rx: 0.021 * L, ry: 0.022 * L, tuft: feather * 0.15 },
        ...pawSections,
      ]
    : [
        // The thigh is a broad wedge leaning forward from the hip, its back hung with britches.
        {
          c: at(g.head, 0.01, 0.01),
          rx: 0.034 * L * W,
          ry: 0.056 * L,
          tuft: britch * 0.5,
          weight: behind,
        },
        {
          c: at(upper.head, 0.012, -0.012),
          rx: 0.04 * L * W,
          ry: 0.062 * L,
          tuft: britch,
          weight: behind,
        },
        {
          c: at(mid(upper.head, lower.head), 0.004),
          rx: 0.035 * L * (1 + (W - 1) * 0.6),
          ry: 0.052 * L,
          tuft: britch,
          weight: behind,
        },
        { c: lower.head, rx: 0.027 * L, ry: 0.038 * L, tuft: britch * 0.9, weight: behind },
        {
          c: mid(lower.head, meta.head, 0.5),
          rx: 0.02 * L,
          ry: 0.026 * L,
          tuft: britch * 0.7,
          weight: behind,
        },
        { c: meta.head, rx: 0.02 * L, ry: 0.022 * L },
        { c: mid(meta.head, paw.head), rx: 0.02 * L, ry: 0.021 * L, tuft: britch * 0.25 },
        ...pawSections,
      ];
  return {
    segments: segments(8, detail),
    bones: [c.girdle, c.upper, c.lower, c.meta, c.paw],
    colour: pal.leg(c.kind),
    capStart: false,
    capEnd: true,
    flow: fore ? [0, -0.6, -0.8] : [0, -1, -0.45],
    stagger: true,
    sections,
  };
}

/** An ear: a loft from the base up the ear bone, wide across the head and thin front to back,
 * so it has real thickness from the side. The ring's u axis is x and its v axis is -z, which is
 * exactly an ear's cross-section. Rounded tip, pale inside, and furnishings poking forward. */
function earPart(app: CatAppearance, pal: Palette, name: "earL" | "earR", detail: number): Part {
  const def = bone(name);
  const h = app.proportions.head;
  const base = def.head;
  const up: Vec3 = [
    (def.tail[0] - base[0]) * h,
    (def.tail[1] - base[1]) * h,
    (def.tail[2] - base[2]) * h,
  ];
  // The ear leans a little forward as it rises.
  const at = (t: number): Vec3 => [
    base[0] + up[0] * t,
    base[1] + up[1] * t,
    base[2] + up[2] * t + 0.012 * t * h,
  ];
  const inner = pal.earInner;
  // The ring's u axis is x and its v axis is -z, so the ear is a scoop: wide across the head,
  // not quite as deep front to back, and its pale inside is the front, where sin(a) < 0.
  const colour: Colourist = (_pos, a) => (Math.sin(a) < -0.2 ? inner : pal.ear);
  const sections: Section[] = [
    [0, 0.03, 0.021],
    [0.3, 0.026, 0.018],
    [0.6, 0.019, 0.013],
    [0.85, 0.011, 0.008],
    [1, 0.004, 0.003],
  ].map(([t, rx, ry]) => ({ c: at(t!), rx: rx! * h, ry: ry! * h }));
  return {
    segments: segments(8, detail),
    bones: [name],
    colour,
    // The base sits inside the skull, so it needs no cap.
    capStart: false,
    capEnd: true,
    stagger: false,
    sections,
  };
}

/** Furnishings: three pale tufts standing out of the ear's opening, which faces forward. */
function earTufts(b: MeshBuilder, app: CatAppearance, pal: Palette, name: "earL" | "earR"): void {
  const def = bone(name);
  const s = name === "earL" ? 1 : -1;
  const h = app.proportions.head;
  const f = app.fur;
  const base = def.head;
  const up: Vec3 = [
    (def.tail[0] - base[0]) * h,
    (def.tail[1] - base[1]) * h,
    (def.tail[2] - base[2]) * h,
  ];
  for (const [along, len, lift] of [
    [0.12, 0.7, 0.2],
    [0.32, 0.6, 0.35],
    [0.52, 0.45, 0.45],
  ] as const) {
    const root: Vec3 = [
      base[0] + up[0] * along,
      base[1] + up[1] * along,
      base[2] + up[2] * along + 0.004,
    ];
    const r = 0.006 * h;
    const tip: Vec3 = [
      root[0] - s * 0.004,
      root[1] + 0.02 * f * lift,
      root[2] + 0.024 * f * len * h,
    ];
    const tri: Vec3[] = [
      [root[0] - s * r, root[1] - r * 0.4, root[2]],
      [root[0] + s * r, root[1] - r * 0.4, root[2]],
      [root[0], root[1] + r, root[2]],
    ];
    const ids = tri.map((p) => b.vertex(p, pal.earInner, [name]));
    const t = b.vertex(tip, pal.earInner, [name]);
    for (let i = 0; i < 3; i++) {
      const p = ids[i]!;
      const q = ids[(i + 1) % 3]!;
      if (s > 0) b.tri(p, q, t);
      else b.tri(p, t, q);
    }
  }
}

export interface CatPart {
  first: number;
  end: number;
  bones: BoneName[];
}

/** How finely the coat is built. 1 is the desktop cat; lower numbers drop ring segments and
 * shorten the tufts, for a phone or a busy scene. Below about 0.5 the fur stops reading as fur. */
export interface CatDetail {
  /** 0.4 (coarse) to 1 (full). */
  detail: number;
}

export const FULL_DETAIL: CatDetail = { detail: 1 };

/** Ring segments at this detail: even (the tufts alternate vertex by vertex) and never under 6. */
function segments(base: number, detail: number): number {
  const scaled = Math.max(6, Math.round((base * detail) / 2) * 2);
  return Math.min(base, scaled);
}

export interface Cat {
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  bones: Record<BoneName, THREE.Bone>;
  appearance: CatAppearance;
  /** Eyes, lids, nose and whiskers: unskinned, riding the head bone. */
  face: CatFace;
  /** How finely this one was built (1 = full). */
  detail: number;
  triangles: number;
  /** Draw calls this cat costs: its own skinned mesh plus the face's. Standalone VR budgets run
   * to about a hundred for a whole room, so this is the number a consumer checks. */
  drawCalls: number;
  /** Each part of the skinned mesh: its triangle range [first, end) and the bones it is skinned
   * to. For tests. */
  parts: Record<string, CatPart>;
}

export function buildCat(
  appearance: CatAppearance = DEFAULT_APPEARANCE,
  options: CatDetail | undefined = FULL_DETAIL,
): Cat {
  const app = appearance;
  const detail = Math.min(1, Math.max(0.4, options?.detail ?? 1));
  const pal = palette(app);
  const boneIndex = new Map<BoneName, number>(BONES.map((b, i) => [b.name, i]));
  const bones = {} as Record<BoneName, THREE.Bone>;
  const list: THREE.Bone[] = [];
  for (const def of BONES) {
    const b = new THREE.Bone();
    b.name = def.name;
    const parent = def.parent ? bone(def.parent).head : [0, 0, 0];
    b.position.set(def.head[0] - parent[0], def.head[1] - parent[1], def.head[2] - parent[2]);
    bones[def.name] = b;
    list.push(b);
    if (def.parent) bones[def.parent].add(b);
  }

  const builder = new MeshBuilder(boneIndex);
  const parts: Record<string, CatPart> = {};
  const mark = (name: string, build: () => void): void => {
    const first = builder.index.length / 3;
    builder.used.clear();
    build();
    parts[name] = { first, end: builder.index.length / 3, bones: [...builder.used] };
  };
  mark("torso", () => builder.loft(torso(app, pal, detail)));
  mark("ruff", () => builder.loft(ruff(app, pal, detail)));
  mark("head", () => builder.loft(head(app, pal, detail)));
  mark("muzzle", () => builder.loft(muzzle(app, pal, detail)));
  mark("tail", () => builder.loft(tail(app, pal, detail)));
  for (const c of LEGS) mark(c.upper, () => builder.loft(legPart(app, pal, c, detail)));
  mark("ears", () => {
    for (const name of ["earL", "earR"] as const) {
      builder.loft(earPart(app, pal, name, detail));
      earTufts(builder, app, pal, name);
    }
  });

  const geometry = builder.geometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    roughness: 0.95,
    metalness: 0,
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = `cat-${app.name}`;
  mesh.frustumCulled = false; // the bind-pose bounds do not follow the animation
  mesh.castShadow = true;
  mesh.add(bones.root);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  mesh.bind(skeleton);

  // The face rides the head bone, unskinned: the eyes go where the head's own surface is, so
  // they follow the proportions instead of floating at fixed coordinates.
  const headDef = bone("head").head;
  const hs = headSections(app);
  const h = app.proportions.head;
  const eyeY = 0.3;
  const eyeX = 0.042 * h;
  const eyeR = 0.021 * h;
  // In front of the bare surface: the brow bulge and the cheek tufts stand proud of it, and an
  // eye set flush with the loft disappears under them.
  const eyeZ = headSurfaceZ(hs, eyeX, eyeY) + eyeR * 0.18;
  const local = (x: number, y: number, z: number): [number, number, number] => [
    x - headDef[0],
    y - headDef[1],
    z - headDef[2],
  ];
  const face = buildFace(
    bones.head,
    {
      eye: local(eyeX, eyeY, eyeZ),
      eyeRadius: eyeR,
      eyeSplay: 0.42,
      nose: local(0, 0.2775, 0.3285),
      noseWidth: 0.0105 * h,
      pad: local(0.031 * h, 0.2695, 0.312),
      whiskerLength: 0.085 * h,
    },
    {
      eye: pal.eye,
      rim: pal.deep,
      lid: pal.head([eyeX, eyeY + 0.006, eyeZ], 0.6, 0.5),
      nose: pal.nose,
      deep: pal.deep,
    },
  );

  const group = new THREE.Group();
  group.name = `cat-${app.name}`;
  group.scale.setScalar(app.size);
  group.add(mesh);
  const triangles = geometry.index!.count / 3 + face.triangles;
  const drawCalls = 1 + face.drawCalls;
  return {
    group,
    mesh,
    skeleton,
    bones,
    appearance: app,
    face,
    detail,
    triangles,
    drawCalls,
    parts,
  };
}
