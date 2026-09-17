import {
  BackSide, CircleGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial,
  ShaderMaterial, SphereGeometry, TorusGeometry, Vector3,
} from "three";
import type { Room } from "./schema";
import type { RoomShell } from "./rooms";

// The Orrery's architecture: nothing but a designed star field, and a landing
// where the portal sets the visitor down. There is no floor to see; the
// visitor walks on the room's footprint as on glass, and the ring is the one
// thing that says where the way back is. The stars are a hash, not a
// catalogue: a backdrop, never an astronomical claim (provenance says so).

/**
 * The dome's radius, metres. It stands over the middle of the room and has
 * to satisfy both ends: wide enough that everything hung in the room is
 * inside it (the chi 6 world's far side reaches 206 m from the centre, the
 * furthest of the three), and narrow enough that
 * its far wall stays within the eye's own range — 600 m — from the furthest
 * corner a visitor can walk to, 228 m out. At the 560 m it was, looking back
 * across the room cut a starless hole out of the sky where the far wall
 * passed the far plane, which `portal.test.ts` now measures.
 */
export const STAR_DOME_RADIUS = 320;

/** Where that dome stands: over the middle of the room's footprint, at the height of the walk. */
export function starDomeCentre(room: Room): Vector3 {
  return new Vector3((room.bounds.min[0] + room.bounds.max[0]) / 2, 0, (room.bounds.min[2] + room.bounds.max[2]) / 2);
}

const STAR_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  // Direction from the eye, as the sky dome does, so the field never tilts with the walk.
  vDir = world.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const STAR_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uDeep;
uniform vec3 uHaze;
varying vec3 vDir;
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
void main() {
  vec3 d = normalize(vDir);
  // A faint band, tilted, so the field has a grain of direction.
  float band = exp(-abs(d.y * 0.86 + d.x * 0.5) * 3.2);
  vec3 c = mix(uDeep, uHaze, 0.55 * band);
  // Stars: three cell sizes, each cell holding at most one star near its centre.
  float light = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float cells = 90.0 + 70.0 * float(layer);
    vec3 cell = floor(d * cells);
    vec3 seed = cell + float(layer) * 17.0;
    float chance = hash13(seed);
    vec3 centre = (cell + 0.5 + (vec3(hash13(seed + 1.0), hash13(seed + 2.0), hash13(seed + 3.0)) - 0.5) * 0.8) / cells;
    float dist = length(d - normalize(centre)) * cells;
    float size = 0.06 + 0.16 * pow(hash13(seed + 4.0), 6.0);
    float star = smoothstep(size, 0.0, dist) * step(0.93 - 0.02 * float(layer), chance);
    light += star * (0.35 + 0.65 * hash13(seed + 5.0));
  }
  c += vec3(0.86, 0.9, 1.0) * light;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

export function buildSpace(room: Room): RoomShell {
  const group = new Group();
  group.name = `${room.id}-shell`;
  const [, y0] = room.bounds.min;
  const centre = starDomeCentre(room);

  const stars = new Mesh(
    new SphereGeometry(STAR_DOME_RADIUS, 32, 16),
    new ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: { uDeep: { value: new Color("#03060c") }, uHaze: { value: new Color("#101a2c") } },
      side: BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  stars.name = "space-stars";
  stars.position.copy(centre);
  stars.renderOrder = -1000;
  stars.frustumCulled = false;
  group.add(stars);

  // The landing: a dim glass disc and a brass ring around the arrival point.
  const [sx, , sz] = room.spawn.position;
  const disc = new Mesh(
    new CircleGeometry(7, 48),
    new MeshBasicMaterial({ color: "#182636", transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false }),
  );
  disc.name = "space-landing";
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(sx, y0 + 0.01, sz);
  group.add(disc);
  const ring = new Mesh(
    new TorusGeometry(7, 0.05, 6, 96),
    new MeshBasicMaterial({ color: "#a98551", toneMapped: false }),
  );
  ring.name = "space-landing-ring";
  ring.rotation.x = Math.PI / 2;
  ring.position.set(sx, y0 + 0.03, sz);
  group.add(ring);
  group.userData = { architecture: "space", designed: true };

  return {
    group,
    provenance: {
      source: "Designed backdrop",
      generator: "grove/src/world/space.ts",
      design: "A star field from a hash, and a landing ring",
      scientific_content: false,
      note: "The stars are decoration, not a catalogue or a simulation output. The worlds hung here carry their own source records.",
      units: "metres",
      architecture_batches: group.children.length,
    },
    lightmap: null,
    markers: { doors: new Map(), posters: new Map() },
  };
}
