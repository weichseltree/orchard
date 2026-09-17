// The face: the parts that are not skinned to the skeleton but ride the head bone — big oval
// eyes with lids and catchlights, the nose leather, the mouth and the whiskers. Generated like
// everything else, and a few hundred triangles in total.
//
// The eyes are discs, not spheres: a fan of rings (pupil, iris, iris rim, eye rim) domed forward,
// which gives a clean oval outline and a light-catching curve for a fraction of a sphere's
// triangles. Each eye sits in its own socket group, tilted outward and slanted; the eyeball
// turns inside it for the gaze, while the catchlights stay with the socket so they read as
// reflections of the room rather than paint on the eyeball.

import * as THREE from "three";

export interface FaceColours {
  /** Iris. */
  eye: THREE.Color;
  /** Eye rim, the liner around the lids. */
  rim: THREE.Color;
  /** Eyelid: the mask colour where the lid sits. */
  lid: THREE.Color;
  nose: THREE.Color;
  /** Mouth line and nostrils. */
  deep: THREE.Color;
}

export interface FaceLayout {
  /** Eye centre, head-bone local. The right eye mirrors it. */
  eye: [number, number, number];
  eyeRadius: number;
  /** How far the eyes turn outward with the skull, radians. */
  eyeSplay: number;
  /** Nose leather centre and half-width, head-bone local. */
  nose: [number, number, number];
  noseWidth: number;
  /** Whisker pad centre (the left one), head-bone local. */
  pad: [number, number, number];
  whiskerLength: number;
}

/** How far the eyeballs turn inside their sockets. A cat's eyes move much less than a human's. */
export const GAZE_YAW_LIMIT = (22 * Math.PI) / 180;
export const GAZE_PITCH_LIMIT = (13 * Math.PI) / 180;

export interface CatFace {
  /** Turns the eyeballs toward a look, radians, clamped. Absolute: setting the same angles twice
   * leaves the eyes exactly where they were, so it can run every frame without compounding. */
  setGaze(yaw: number, pitch: number): void;
  /** Closes the lids: 0 wide open, 1 shut. Absolute, like setGaze. */
  setBlink(closed: number): void;
  readonly gaze: { yaw: number; pitch: number };
  readonly blink: number;
  readonly triangles: number;
  /** How many draw calls the face costs (the body's own mesh is one more). */
  readonly drawCalls: number;
  /** The eyeball meshes, for tests. */
  readonly eyeballs: THREE.Mesh[];
}

function clamp(x: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, x));
}

interface Ring {
  /** Fraction of the eye's radius. */
  r: number;
  /** Forward offset, fraction of the radius: the eye is domed. */
  z: number;
  colour: THREE.Color;
}

/** An eye: a domed oval fan, pupil at the centre, iris, then a dark rim. */
function eyeballGeometry(r: number, colours: FaceColours, segments = 16): THREE.BufferGeometry {
  const pupil = new THREE.Color(0x07070b);
  const iris = colours.eye;
  const inner = iris.clone().lerp(new THREE.Color(0xffffff), 0.5);
  const outer = iris.clone().lerp(colours.rim, 0.45);
  const rings: Ring[] = [
    // A slightly dilated pupil: cats' eyes indoors, and it reads friendlier than a slit.
    { r: 0.0, z: 0.3, colour: pupil },
    { r: 0.32, z: 0.28, colour: pupil },
    { r: 0.4, z: 0.26, colour: inner },
    { r: 0.78, z: 0.15, colour: iris },
    { r: 0.94, z: 0.03, colour: outer },
    { r: 1.0, z: -0.06, colour: colours.rim },
  ];
  const position: number[] = [];
  const colour: number[] = [];
  const index: number[] = [];
  // The eye is a little wider than it is tall.
  const squash = 0.82;
  const vertex = (ring: Ring, k: number): number => {
    const a = (2 * Math.PI * k) / segments;
    const i = position.length / 3;
    position.push(r * ring.r * Math.cos(a), r * ring.r * squash * Math.sin(a), r * ring.z);
    colour.push(ring.colour.r, ring.colour.g, ring.colour.b);
    return i;
  };
  const centre = vertex(rings[0]!, 0);
  let prev: number[] = [];
  for (let n = 1; n < rings.length; n++) {
    const ring: number[] = [];
    for (let k = 0; k < segments; k++) ring.push(vertex(rings[n]!, k));
    if (n === 1) {
      for (let k = 0; k < segments; k++) index.push(centre, ring[k]!, ring[(k + 1) % segments]!);
    } else {
      for (let k = 0; k < segments; k++) {
        const k1 = (k + 1) % segments;
        index.push(prev[k]!, ring[k]!, ring[k1]!);
        index.push(prev[k]!, ring[k1]!, prev[k1]!);
      }
    }
    prev = ring;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colour, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** One lid: a half-disc, domed forward, that pivots about the eye's horizontal axis. Edge on at
 * a rotation of -90 degrees, so an open lid is a sliver tucked inside the head. */
function lidGeometry(r: number, sign: 1 | -1, segments = 10): THREE.BufferGeometry {
  const position: number[] = [0, 0, 0.16 * r];
  const index: number[] = [];
  for (let k = 0; k <= segments; k++) {
    const a = (Math.PI * k) / segments;
    position.push(r * Math.cos(a), sign * r * 0.86 * Math.sin(a), 0.05 * r);
    // The lower lid's arc runs the other way round, so its faces need the other winding.
    if (k > 0) index.push(...(sign > 0 ? [0, k, k + 1] : [0, k + 1, k]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** The nose leather: an inverted triangle with a little depth. */
function noseGeometry(w: number): THREE.BufferGeometry {
  const h = w * 0.85;
  const position = [-w, h, 0, w, h, 0, 0, -h, 0.2 * w, 0, h * 0.2, -w];
  const index = [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** The mouth: two short strokes from under the nose, the cat's shallow "w". */
function mouthGeometry(w: number): THREE.BufferGeometry {
  const t = w * 0.13;
  const position: number[] = [];
  const index: number[] = [];
  for (const s of [1, -1]) {
    const i = position.length / 3;
    position.push(0, 0, 0, s * w, -w * 0.5, -w * 0.25, s * w, -w * 0.5 - t, -w * 0.25, 0, -t, 0);
    index.push(i, i + 1, i + 2, i, i + 2, i + 3);
    if (s < 0) index.reverse();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function whiskers(pad: [number, number, number], length: number): THREE.LineSegments {
  const points: number[] = [];
  for (const s of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const spread = (i / 3 - 0.5) * 0.9; // radians, fanned up and down
      const droop = -0.25 + spread;
      points.push(pad[0] * s, pad[1] + i * 0.002, pad[2]);
      points.push(
        pad[0] * s + s * length * Math.cos(spread * 0.8),
        pad[1] + length * Math.sin(droop) * 0.55,
        pad[2] + length * 0.25,
      );
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const lines = new THREE.LineSegments(
    g,
    new THREE.LineBasicMaterial({ color: 0xf6f2ea, toneMapped: false }),
  );
  lines.name = "whiskers";
  return lines;
}

/** Merges geometries that share a transform into one, so the face costs draw calls in single
 * figures. Only position/colour/index are carried; that is all the face needs. */
function merge(parts: { geometry: THREE.BufferGeometry; offset: [number, number, number] }[]): {
  geometry: THREE.BufferGeometry;
  triangles: number;
} {
  const position: number[] = [];
  const colour: number[] = [];
  const index: number[] = [];
  for (const part of parts) {
    const base = position.length / 3;
    const pos = part.geometry.getAttribute("position");
    const col = part.geometry.getAttribute("color");
    for (let i = 0; i < pos.count; i++) {
      position.push(
        pos.getX(i) + part.offset[0],
        pos.getY(i) + part.offset[1],
        pos.getZ(i) + part.offset[2],
      );
      if (col) colour.push(col.getX(i), col.getY(i), col.getZ(i));
      else colour.push(1, 1, 1);
    }
    const idx = part.geometry.index!;
    for (let i = 0; i < idx.count; i++) index.push(base + idx.getX(i));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colour, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return { geometry: g, triangles: index.length / 3 };
}

/** Paints a geometry a flat colour, so merged parts can share one vertex-coloured material. */
function painted(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.getAttribute("position").count;
  const colour: number[] = [];
  for (let i = 0; i < n; i++) colour.push(c.r, c.g, c.b);
  g.setAttribute("color", new THREE.Float32BufferAttribute(colour, 3));
  return g;
}

/**
 * Builds the face onto `head` (the head bone), in its local frame, in EIGHT draw calls a cat
 * counting the body: two eyeballs (each turns on its own pivot for the gaze), one mesh for both
 * upper lids and one for both lowers (both eyes sit on the same x axis, so one rotation about it
 * blinks both), one for the catchlights, one for the nose and mouth together, and the whiskers.
 * The eye rim is a ring of the eyeball's own geometry rather than a mesh of its own.
 */
export function buildFace(head: THREE.Object3D, layout: FaceLayout, colours: FaceColours): CatFace {
  const r = layout.eyeRadius;
  const eyeGeom = eyeballGeometry(r, colours);
  const eyeMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.18,
    metalness: 0,
  });
  const lidMat = new THREE.MeshStandardMaterial({ color: colours.lid, roughness: 0.9 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const faceMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    flatShading: true,
  });

  const eyeballs: THREE.Mesh[] = [];
  let triangles = 0;
  let drawCalls = 0;

  for (const s of [1, -1]) {
    const socket = new THREE.Group();
    socket.name = `eye-socket-${s > 0 ? "L" : "R"}`;
    socket.position.set(s * layout.eye[0], layout.eye[1], layout.eye[2]);
    // The eyes sit on the curve of the skull and slant a little, outer corner up.
    socket.rotation.set(0, s * layout.eyeSplay, s * 0.13, "YXZ");
    head.add(socket);

    const ball = new THREE.Mesh(eyeGeom, eyeMat);
    ball.name = `eye-${s > 0 ? "L" : "R"}`;
    socket.add(ball);
    eyeballs.push(ball);
    triangles += eyeGeom.index!.count / 3;
    drawCalls++;
  }

  // Both eyes share one horizontal axis through their centres, so a single mesh holding both
  // lids, pivoting on that axis, blinks them together. (It gives up the sockets' splay and slant
  // for the lids; at this size that is invisible and it halves the face's draw calls.)
  const lids: THREE.Object3D[] = [];
  for (const sign of [1, -1] as const) {
    const pair = merge(
      [1, -1].map((s) => ({
        geometry: painted(lidGeometry(r * 1.12, sign), colours.lid),
        offset: [s * layout.eye[0], 0, r * 0.12] as [number, number, number],
      })),
    );
    const lid = new THREE.Mesh(pair.geometry, lidMat);
    lid.name = sign > 0 ? "lids-upper" : "lids-lower";
    lid.position.set(0, layout.eye[1], layout.eye[2]);
    head.add(lid);
    lids.push(lid);
    triangles += pair.triangles;
    drawCalls++;
  }
  const uppers = [lids[0]!];
  const lowers = [lids[1]!];

  // Four catchlights in one mesh: they belong to the sockets, not the eyeballs, so they stay put
  // when the cat looks around and can share a transform.
  const glintParts: { geometry: THREE.BufferGeometry; offset: [number, number, number] }[] = [];
  for (const s of [1, -1]) {
    for (const [gx, gy, scale] of [
      [-0.3, 0.36, 1],
      [0.26, -0.3, 0.5],
    ] as const) {
      const g = new THREE.PlaneGeometry(r * 0.24 * scale, r * 0.24 * scale);
      glintParts.push({
        offset: [s * (layout.eye[0] + gx * r), layout.eye[1] + gy * r, layout.eye[2] + r * 0.34],
        geometry: painted(g, new THREE.Color(0xffffff)),
      });
    }
  }
  const glintMerged = merge(glintParts);
  const glintMesh = new THREE.Mesh(glintMerged.geometry, glintMat);
  glintMesh.name = "catchlights";
  head.add(glintMesh);
  const glints: THREE.Object3D[] = [glintMesh];
  triangles += glintMerged.triangles;
  drawCalls++;

  // Nose and mouth share a transform and a vertex-coloured material.
  const noseGeom = painted(noseGeometry(layout.noseWidth), colours.nose);
  const mouthGeom = painted(mouthGeometry(layout.noseWidth * 1.1), colours.deep);
  const muzzle = merge([
    { geometry: noseGeom, offset: layout.nose },
    {
      geometry: mouthGeom,
      offset: [0, layout.nose[1] - layout.noseWidth * 1.1, layout.nose[2] - 0.002],
    },
  ]);
  const muzzleMesh = new THREE.Mesh(muzzle.geometry, faceMat);
  muzzleMesh.name = "nose-and-mouth";
  head.add(muzzleMesh);
  triangles += muzzle.triangles;
  drawCalls++;

  const whiskerLines = whiskers(layout.pad, layout.whiskerLength);
  head.add(whiskerLines);
  drawCalls++;

  const state = { yaw: 0, pitch: 0, blink: 0 };

  const face: CatFace = {
    setGaze(yaw, pitch) {
      state.yaw = clamp(yaw, GAZE_YAW_LIMIT);
      state.pitch = clamp(pitch, GAZE_PITCH_LIMIT);
      for (const ball of eyeballs) ball.rotation.set(state.pitch, state.yaw, 0, "YXZ");
    },
    setBlink(closed) {
      const b = Math.min(1, Math.max(0, closed));
      state.blink = b;
      // Coverage is the cosine of the lid's angle, so this closes the eye at an even rate; the
      // last few degrees overlap the lids so a shut eye has no seam.
      const angle = Math.acos(b) - 0.16 * b;
      for (const lid of uppers) lid.rotation.x = -angle;
      for (const lid of lowers) lid.rotation.x = angle;
      // A catchlight is a reflection off the wet eye: it goes out when the lids cover it.
      for (const glint of glints) glint.visible = b < 0.6;
    },
    get gaze() {
      return { yaw: state.yaw, pitch: state.pitch };
    },
    get blink() {
      return state.blink;
    },
    triangles,
    drawCalls,
    eyeballs,
  };
  face.setGaze(0, 0);
  face.setBlink(0);
  return face;
}
