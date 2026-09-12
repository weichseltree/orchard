import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import type { TapeFrame } from "./decode";

// One THREE.Points for the whole tape. The quantized u16 positions go to the
// GPU as they came off the wire, normalized, and the vertex shader turns them
// into metres: no per-frame float conversion on the CPU, one memcpy per frame.
//
// Greys by default, hue only where it means something (LAWS 12): species 0 is
// bone, species 1 the orchard green, the rest walk a small muted ring.

const MAX_SPECIES = 8;

const VERTEX_SHADER = /* glsl */ `
attribute float aSpecies;
attribute float aAlive;

uniform vec3 uBoxSize;
uniform float uPointSize;
uniform float uPixelRatio;
uniform vec3 uPalette[${MAX_SPECIES}];

varying vec3 vColor;
varying float vAlive;

void main() {
  vAlive = aAlive;
  // A bundle with more species than the palette must not read off the end.
  int species = int(min(aSpecies, float(${MAX_SPECIES} - 1)) + 0.5);
  vColor = uPalette[species];
  // position arrives normalized to [0,1] over the tape's box.
  vec3 metres = position * uBoxSize - uBoxSize * 0.5;
  vec4 mv = modelViewMatrix * vec4(metres, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.05);
  gl_PointSize = aAlive > 0.5 ? clamp(uPointSize * uPixelRatio / dist, 1.0, 48.0) : 0.0;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

uniform float uOpacity;

varying vec3 vColor;
varying float vAlive;

// Sphere impostors (spectre's design at film-final): each point is a lit ball,
// so a heavy core reads as a body with a front and a back, not a flat disc.
// A warm key from the viewer's upper left, a dim cool fill from the lower
// right: a ball seen head-on is lit on its face and keeps a limb.
const vec3 KEY_DIR = vec3(-0.45, 0.55, 0.55);
const vec3 KEY = vec3(1.0, 0.84, 0.64);
const vec3 FILL_DIR = vec3(0.5, -0.3, 0.6);
const vec3 FILL = vec3(0.22, 0.26, 0.42);

void main() {
  // A dead slot keeps its last position; it must not be drawn there.
  if (vAlive < 0.5) discard;
  vec2 d = (gl_PointCoord - vec2(0.5)) * 2.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  vec3 n = vec3(d.x, -d.y, sqrt(1.0 - r2));
  float key = max(dot(n, normalize(KEY_DIR)), 0.0);
  float fill = max(dot(n, normalize(FILL_DIR)), 0.0);
  vec3 lit = vColor * (KEY * key * 1.1 + FILL * fill + vec3(0.10));
  gl_FragColor = vec4(lit, uOpacity);
}
`;

const DEFAULT_PALETTE = [
  "#d8dedb",
  "#7fc97f",
  "#c9a227",
  "#7fb2c9",
  "#c97f9c",
  "#9b8fc9",
  "#a8b0a4",
  "#e0d7c4",
];

export interface TapeVolumeOptions {
  /** Slots the chosen variant carries. */
  slots: number;
  /** The tape box in its own units, [Lx, Ly, Lz]. */
  box: readonly [number, number, number];
  /** The long side of the box measures this many metres in the room. */
  longSideMeters: number;
  speciesCount: number;
  pixelRatio: number;
  /** Screen pixels a particle covers at one metre. */
  pointSize?: number;
  /**
   * Colours by species index, CSS strings. A tape whose species mean
   * something (spectre's heavy and light) names them from the hanging;
   * absent, the greys-plus-green default.
   */
  palette?: readonly string[];
}

export class TapeVolume {
  readonly points: Points;
  /** Half-extent of the drawn volume, metres — the provenance picker's target. */
  readonly halfSize: Vector3;
  readonly slots: number;

  readonly #geometry: BufferGeometry;
  readonly #material: ShaderMaterial;
  readonly #position: BufferAttribute;
  readonly #species: BufferAttribute;
  readonly #alive: BufferAttribute;
  #lastFrame: TapeFrame | null = null;

  constructor(options: TapeVolumeOptions) {
    const n = options.slots;
    this.slots = n;
    const scale = options.longSideMeters / Math.max(...options.box);
    const size = new Vector3(
      options.box[0] * scale,
      options.box[1] * scale,
      options.box[2] * scale,
    );
    this.halfSize = size.clone().multiplyScalar(0.5);

    this.#geometry = new BufferGeometry();
    // normalized = true: the GPU sees [0,1], the CPU never touches a float.
    this.#position = new BufferAttribute(new Uint16Array(n * 3), 3, true);
    this.#position.setUsage(DynamicDrawUsage);
    this.#species = new BufferAttribute(new Uint8Array(n), 1, false);
    this.#alive = new BufferAttribute(new Uint8Array(n), 1, false);
    this.#alive.setUsage(DynamicDrawUsage);
    this.#species.setUsage(DynamicDrawUsage);
    this.#geometry.setAttribute("position", this.#position);
    this.#geometry.setAttribute("aSpecies", this.#species);
    this.#geometry.setAttribute("aAlive", this.#alive);
    // The position attribute is in box space, so three's bounding sphere would
    // be wrong; there is one volume and it is where the visitor stands.
    this.#geometry.boundingSphere = null;

    const palette: Color[] = [];
    const given = options.palette ?? [];
    for (let i = 0; i < MAX_SPECIES; i++) {
      const css = given[i] ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]!;
      palette.push(new Color(css));
    }

    this.#material = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uBoxSize: { value: size },
        uPointSize: { value: options.pointSize ?? 14 },
        uPixelRatio: { value: options.pixelRatio },
        uPalette: { value: palette },
        uOpacity: { value: 0.95 },
      },
      // Opaque lit balls with depth: a far point can no longer paint over a
      // near one, whatever its slot index.
      transparent: false,
      depthWrite: true,
      blending: NormalBlending,
    });

    this.points = new Points(this.#geometry, this.#material);
    this.points.frustumCulled = false;
    this.points.name = "tape-volume";
  }

  /** Local-space bounds of the drawn volume, for picking and for the pedestal. */
  localBounds(): Box3 {
    return new Box3(this.halfSize.clone().negate(), this.halfSize.clone());
  }

  /**
   * Uploads one frame. Three typed-array copies and two dirty flags; no
   * allocation, so this costs the same on frame 1 and frame 100000.
   *
   * Returns false when the frame does not fit the volume — a bundle whose
   * `variants[*].n` disagrees with its chunks. That is a bad bundle, not a
   * reason to throw a RangeError into the animation loop.
   */
  setFrame(frame: TapeFrame): boolean {
    if (frame === this.#lastFrame) return true;
    const positions = this.#position.array as Uint16Array;
    const alive = this.#alive.array as Uint8Array;
    const species = this.#species.array as Uint8Array;
    if (frame.positions.length !== positions.length) return false;
    positions.set(frame.positions);
    alive.set(frame.alive);
    // The format lets species change per frame, so it is uploaded per frame:
    // one 4 kB copy, cheaper than deciding whether it was needed.
    species.set(frame.species);
    this.#position.needsUpdate = true;
    this.#alive.needsUpdate = true;
    this.#species.needsUpdate = true;
    this.#lastFrame = frame;
    return true;
  }

  setPixelRatio(ratio: number): void {
    (this.#material.uniforms.uPixelRatio as { value: number }).value = ratio;
  }

  setOpacity(opacity: number): void {
    (this.#material.uniforms.uOpacity as { value: number }).value = opacity;
  }

  dispose(): void {
    this.#geometry.dispose();
    this.#material.dispose();
  }
}

