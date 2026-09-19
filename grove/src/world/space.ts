import {
  BackSide, BoxGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide,
  Group, Mesh, MeshBasicMaterial, ShaderMaterial, SphereGeometry, TorusGeometry, Vector3,
} from "three";
import type { Room } from "./schema";
import type { RoomShell } from "./rooms";

// The Orrery's architecture: an expansive nocturnal observation deck and
// controls circle under a star field, with a grand staircase descending south
// to the portal arrival dais. The visitor arrives on the lower dais, walks up
// the stairs, and stands on the elevated upper deck to observe spectre's three
// cutaway worlds hung in the sky.

/**
 * The dome's radius, metres. It stands over the middle of the room and
 * encloses the three cutaway worlds within the eye's range.
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
  float band = exp(-abs(d.y * 0.86 + d.x * 0.5) * 3.2);
  vec3 c = mix(uDeep, uHaze, 0.55 * band);
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

// Shared materials for the Orrery architecture
const STONE_DARK = new MeshBasicMaterial({ color: "#141c28", toneMapped: false });
const STONE_TREAD = new MeshBasicMaterial({ color: "#1a2536", toneMapped: false });
const GLASS_DECK = new MeshBasicMaterial({ color: "#182636", transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false });
const BRASS_GOLD = new MeshBasicMaterial({ color: "#c49a5b", toneMapped: false });
const BRASS_ACCENT = new MeshBasicMaterial({ color: "#a98551", toneMapped: false });
const LAMP_WARM = new MeshBasicMaterial({ color: "#ffeaad", toneMapped: false });
const LAMP_CORE = new MeshBasicMaterial({ color: "#ffe082", toneMapped: false });

export function buildSpace(room: Room): RoomShell {
  const group = new Group();
  group.name = `${room.id}-shell`;
  const [, y0] = room.bounds.min;
  const centre = starDomeCentre(room);

  // 1. Star Dome
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

  const upperZ = -400;
  const upperY = y0 + 1.6;
  const upperRadius = 14;

  // 2. Upper Observation & Controls Deck (centered at (0, upperY, upperZ))
  // Main podium base
  const deckPodium = new Mesh(
    new CylinderGeometry(upperRadius + 0.2, upperRadius + 0.5, 1.6, 48),
    STONE_DARK,
  );
  deckPodium.name = "space-deck-podium";
  deckPodium.position.set(0, y0 + 0.8, upperZ);
  group.add(deckPodium);

  // Top paved glass/mineral floor
  const deckFloor = new Mesh(
    new CircleGeometry(upperRadius, 48),
    GLASS_DECK,
  );
  deckFloor.name = "space-deck-floor";
  deckFloor.rotation.x = -Math.PI / 2;
  deckFloor.position.set(0, upperY + 0.01, upperZ);
  group.add(deckFloor);

  // Concentric brass inlay rings on the upper deck
  for (const radius of [4, 7.5, 11, 13.8]) {
    const deckRing = new Mesh(
      new TorusGeometry(radius, 0.04, 6, 64),
      BRASS_ACCENT,
    );
    deckRing.rotation.x = Math.PI / 2;
    deckRing.position.set(0, upperY + 0.02, upperZ);
    group.add(deckRing);
  }

  // Perimeter Balustrade and Stanchions (omitted at south staircase exit between -20 deg and +20 deg)
  const numPosts = 16;
  for (let i = 0; i < numPosts; i++) {
    const angle = (i / numPosts) * Math.PI * 2;
    // South is +Z, angle around Math.PI/2 in Three.js (x = sin, z = cos)
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);
    if (cosA > 0.85) continue; // Leave south opening for the grand stairs

    const px = sinA * (upperRadius - 0.2);
    const pz = upperZ + cosA * (upperRadius - 0.2);

    // Stanchion post
    const post = new Mesh(
      new CylinderGeometry(0.06, 0.08, 0.95, 8),
      BRASS_ACCENT,
    );
    post.position.set(px, upperY + 0.475, pz);
    group.add(post);

    // Stanchion brass cap / lamp
    const cap = new Mesh(
      new SphereGeometry(0.09, 8, 8),
      LAMP_WARM,
    );
    cap.position.set(px, upperY + 0.95, pz);
    group.add(cap);
  }

  // 3. Central Controls Circle & Armillary Console Dais
  const controlsDais = new Mesh(
    new CylinderGeometry(3.2, 3.4, 0.12, 32),
    STONE_DARK,
  );
  controlsDais.name = "space-controls-dais";
  controlsDais.position.set(0, upperY + 0.06, upperZ);
  group.add(controlsDais);

  const controlsFloor = new Mesh(
    new CircleGeometry(3.2, 32),
    new MeshBasicMaterial({ color: "#1b2d42", side: DoubleSide }),
  );
  controlsFloor.rotation.x = -Math.PI / 2;
  controlsFloor.position.set(0, upperY + 0.125, upperZ);
  group.add(controlsFloor);

  const controlsRing = new Mesh(
    new TorusGeometry(3.2, 0.06, 6, 48),
    BRASS_GOLD,
  );
  controlsRing.rotation.x = Math.PI / 2;
  controlsRing.position.set(0, upperY + 0.13, upperZ);
  group.add(controlsRing);

  // Central Armillary Pedestal Console
  const pedestalBase = new Mesh(
    new CylinderGeometry(0.35, 0.5, 0.3, 16),
    BRASS_GOLD,
  );
  pedestalBase.position.set(0, upperY + 0.25, upperZ);
  group.add(pedestalBase);

  const pedestalColumn = new Mesh(
    new CylinderGeometry(0.18, 0.22, 0.8, 16),
    BRASS_ACCENT,
  );
  pedestalColumn.position.set(0, upperY + 0.7, upperZ);
  group.add(pedestalColumn);

  // Armillary Celestial Rings (Equatorial, Meridian, Ecliptic)
  const armillaryY = upperY + 1.25;
  const eqRing = new Mesh(new TorusGeometry(0.45, 0.025, 6, 32), BRASS_GOLD);
  eqRing.rotation.x = Math.PI / 2;
  eqRing.position.set(0, armillaryY, upperZ);
  group.add(eqRing);

  const merRing = new Mesh(new TorusGeometry(0.45, 0.025, 6, 32), BRASS_GOLD);
  merRing.position.set(0, armillaryY, upperZ);
  group.add(merRing);

  const eclipticRing = new Mesh(new TorusGeometry(0.45, 0.025, 6, 32), BRASS_ACCENT);
  eclipticRing.rotation.x = Math.PI / 3;
  eclipticRing.rotation.z = Math.PI / 6;
  eclipticRing.position.set(0, armillaryY, upperZ);
  group.add(eclipticRing);

  const armillaryCore = new Mesh(new SphereGeometry(0.12, 16, 16), LAMP_CORE);
  armillaryCore.position.set(0, armillaryY, upperZ);
  group.add(armillaryCore);

  // Sighting Lines radiating to the 3 worlds:
  // Chi 0: [-150, 48, -420] -> dx = -150, dz = -20
  // Chi 6: [0, 60, -555] -> dx = 0, dz = -155
  // Chi 12: [150, 48, -420] -> dx = 150, dz = -20
  const targets = [
    { name: "chi0", dx: -150, dz: -20 },
    { name: "chi6", dx: 0, dz: -155 },
    { name: "chi12", dx: 150, dz: -20 },
  ];

  for (const tgt of targets) {
    const angle = Math.atan2(tgt.dx, tgt.dz);
    const lineLen = upperRadius - 3.4;
    const midDist = 3.2 + lineLen / 2;
    const lineMesh = new Mesh(
      new BoxGeometry(0.08, 0.01, lineLen),
      BRASS_GOLD,
    );
    lineMesh.rotation.y = angle;
    lineMesh.position.set(
      Math.sin(angle) * midDist,
      upperY + 0.025,
      upperZ + Math.cos(angle) * midDist,
    );
    group.add(lineMesh);

    // Sighting lectern at outer end
    const lx = Math.sin(angle) * (upperRadius - 0.6);
    const lz = upperZ + Math.cos(angle) * (upperRadius - 0.6);
    const lectern = new Mesh(
      new CylinderGeometry(0.15, 0.2, 0.85, 8),
      BRASS_ACCENT,
    );
    lectern.position.set(lx, upperY + 0.425, lz);
    group.add(lectern);

    const lecternPlaque = new Mesh(
      new BoxGeometry(0.35, 0.02, 0.25),
      BRASS_GOLD,
    );
    lecternPlaque.rotation.y = angle;
    lecternPlaque.rotation.x = Math.PI / 6;
    lecternPlaque.position.set(lx, upperY + 0.86, lz);
    group.add(lecternPlaque);
  }

  // 4. Grand Staircase (running south from z = -388 to z = -378, y from upperY to y0)
  const stairWidth = 8.0;
  const numSteps = 10;
  const stairZStart = -388;
  const stairZEnd = -378;
  const stepDepth = (stairZEnd - stairZStart) / numSteps; // 1.0 m
  const stepHeight = 1.6 / numSteps; // 0.16 m

  for (let s = 0; s < numSteps; s++) {
    const stepZ = stairZStart + (s + 0.5) * stepDepth;
    const totalH = (numSteps - s) * stepHeight;

    const stepMesh = new Mesh(
      new BoxGeometry(stairWidth, totalH, stepDepth),
      STONE_TREAD,
    );
    stepMesh.position.set(0, y0 + totalH / 2, stepZ);
    group.add(stepMesh);

    // Brass nosing along leading edge of tread
    const nosing = new Mesh(
      new BoxGeometry(stairWidth, 0.02, 0.05),
      BRASS_GOLD,
    );
    nosing.position.set(0, y0 + totalH + 0.01, stepZ + stepDepth / 2 - 0.025);
    group.add(nosing);
  }

  // Flanking cheek walls with brass handrails
  for (const side of [-1, 1]) {
    const wallX = side * (stairWidth / 2 + 0.25);
    const cheekWall = new Mesh(
      new BoxGeometry(0.4, 2.2, stairZEnd - stairZStart + 0.6),
      STONE_DARK,
    );
    cheekWall.position.set(wallX, y0 + 1.1, (stairZStart + stairZEnd) / 2);
    group.add(cheekWall);

    // Sloped Handrail
    const rail = new Mesh(
      new BoxGeometry(0.1, 0.08, stairZEnd - stairZStart + 0.8),
      BRASS_ACCENT,
    );
    rail.position.set(wallX, y0 + 1.8, (stairZStart + stairZEnd) / 2);
    // Slope along Z: rise -1.6 over run +10 -> angle = atan(-1.6 / 10)
    rail.rotation.x = -Math.atan2(1.6, stairZEnd - stairZStart);
    group.add(rail);

    // Top and bottom newel posts with lanterns
    for (const nz of [stairZStart - 0.2, stairZEnd + 0.2]) {
      const ny = nz === stairZStart - 0.2 ? upperY : y0;
      const newel = new Mesh(
        new CylinderGeometry(0.18, 0.22, 1.1, 8),
        BRASS_ACCENT,
      );
      newel.position.set(wallX, ny + 0.55, nz);
      group.add(newel);

      const lamp = new Mesh(
        new SphereGeometry(0.14, 12, 12),
        LAMP_WARM,
      );
      lamp.position.set(wallX, ny + 1.2, nz);
      group.add(lamp);
    }
  }

  // 5. Lower Portal Arrival / Departure Dais (centered at (0, y0, -370))
  const portalZ = -370;
  const portalRadius = 8.0;

  const portalPodium = new Mesh(
    new CylinderGeometry(portalRadius, portalRadius + 0.3, 0.12, 48),
    STONE_DARK,
  );
  portalPodium.name = "space-portal-podium";
  portalPodium.position.set(0, y0 + 0.06, portalZ);
  group.add(portalPodium);

  const portalFloor = new Mesh(
    new CircleGeometry(portalRadius - 0.1, 48),
    GLASS_DECK,
  );
  portalFloor.name = "space-portal-floor";
  portalFloor.rotation.x = -Math.PI / 2;
  portalFloor.position.set(0, y0 + 0.125, portalZ);
  group.add(portalFloor);

  // Outer portal ring (where the portal stands)
  const portalOuterRing = new Mesh(
    new TorusGeometry(portalRadius - 0.1, 0.08, 6, 64),
    BRASS_GOLD,
  );
  portalOuterRing.name = "space-landing-ring";
  portalOuterRing.rotation.x = Math.PI / 2;
  portalOuterRing.position.set(0, y0 + 0.14, portalZ);
  group.add(portalOuterRing);

  // Concentric brass inlays on the portal dais
  for (const pr of [3.0, 5.5]) {
    const inRing = new Mesh(
      new TorusGeometry(pr, 0.04, 6, 48),
      BRASS_ACCENT,
    );
    inRing.rotation.x = Math.PI / 2;
    inRing.position.set(0, y0 + 0.13, portalZ);
    group.add(inRing);
  }

  // 4 Beacon Lanterns surrounding the lower portal dais
  for (let k = 0; k < 4; k++) {
    const angle = (k * Math.PI) / 2 + Math.PI / 4;
    const bx = Math.sin(angle) * (portalRadius - 0.8);
    const bz = portalZ + Math.cos(angle) * (portalRadius - 0.8);

    const beaconPost = new Mesh(
      new CylinderGeometry(0.12, 0.16, 1.2, 8),
      BRASS_ACCENT,
    );
    beaconPost.position.set(bx, y0 + 0.6, bz);
    group.add(beaconPost);

    const beaconGlobe = new Mesh(
      new SphereGeometry(0.16, 12, 12),
      LAMP_WARM,
    );
    beaconGlobe.position.set(bx, y0 + 1.25, bz);
    group.add(beaconGlobe);
  }

  group.userData = { architecture: "space", designed: true };

  return {
    group,
    provenance: {
      source: "Designed backdrop",
      generator: "grove/src/world/space.ts",
      design: "An observation deck, controls circle, grand stairs and portal arrival dais under a star field",
      scientific_content: false,
      note: "The stars and architectural platform are designed exhibit framing. The cutaway worlds hung here carry their own simulation records.",
      units: "metres",
      architecture_batches: group.children.length,
    },
    lightmap: null,
    markers: { doors: new Map(), posters: new Map() },
  };
}
