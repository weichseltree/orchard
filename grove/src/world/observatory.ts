import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide,
  Float32BufferAttribute, Group, IcosahedronGeometry, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, Quaternion, TorusGeometry, Vector3,
  type Material,
} from "three";
import type { Room, Doorway } from "./schema";
import type { RoomShell } from "./rooms";

/** Architecture colours carry no scientific meaning; tapes keep their own palettes. */
export const OBSERVATORY_PALETTE = {
  floor: "#17212b", wall: "#182737", inset: "#101b27", roof: "#142435", stone: "#53616c",
  brass: "#a98551", light: "#eed3a5", blue: "#87b9db",
  joint: "#263540", path: "#243544", earth: "#0b1822", grove: "#345355",
} as const;
type Finish = keyof typeof OBSERVATORY_PALETTE;
type Primitive = "box" | "column" | "arch" | "ring" | "crown" | "halo";
const UNIT = new Vector3(0, 1, 0);
const ROOM_FINISH: Record<string, Partial<Record<Finish, string>>> = {
  spectre: { wall: "#050b13", floor: "#080f18", inset: "#040810", stone: "#1b2732", brass: "#555348", light: "#7793a8", blue: "#527389", roof: "#070e18" },
  phototroph: { wall: "#292326", floor: "#241e1b", inset: "#171418", stone: "#62564b", brass: "#b59668", light: "#ffdb9d", blue: "#d2aa73", roof: "#251f23" },
  orangery: { wall: "#263846", inset: "#172632", stone: "#667b88", brass: "#899eaa", light: "#ddf1ff", blue: "#a9d9f0", roof: "#203443" },
};
const materials = new Map<string, MeshBasicMaterial>();
const geometries = new Map<Primitive, BufferGeometry>();

function material(finish: Finish, roomId: string): MeshBasicMaterial {
  const override = ROOM_FINISH[roomId]?.[finish];
  const key = override ? `${roomId}-${finish}` : finish;
  let result = materials.get(key);
  if (!result) {
    const luminous = finish === "light" || finish === "blue";
    result = new MeshBasicMaterial({ color: override ?? OBSERVATORY_PALETTE[finish], vertexColors: !luminous, side: DoubleSide, toneMapped: !luminous });
    result.name = `observatory-${key}`;
    if (!luminous) stoneSurface(result, finish, roomId === "spectre");
    materials.set(key, result);
  }
  return result;
}

/** Quiet architectural surface shading, independent of all exhibit materials. */
function stoneSurface(material: MeshBasicMaterial, finish: Finish, quiet: boolean): void {
  const floor = finish === "floor" || finish === "path";
  // Colour variants are uniforms; they share these four surface programs.
  material.customProgramCacheKey = () => `observatory-surface-${floor ? "floor" : "wall"}-${quiet}`;
  material.onBeforeCompile = shader => {
    shader.vertexShader = `varying vec3 observatoryWorld; varying vec3 observatoryCenter;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      vec4 architecturePosition = vec4(transformed, 1.0);
      vec4 architectureCenter = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        architecturePosition = instanceMatrix * architecturePosition;
        architectureCenter = instanceMatrix * architectureCenter;
      #endif
      observatoryWorld = (modelMatrix * architecturePosition).xyz;
      observatoryCenter = (modelMatrix * architectureCenter).xyz;
    `);
    shader.fragmentShader = `varying vec3 observatoryWorld; varying vec3 observatoryCenter;
      float stoneHash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * .1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `
      #include <color_fragment>
      float grain = stoneHash(floor(observatoryWorld.xz * 31.0 + observatoryWorld.y * 13.0));
      diffuseColor.rgb *= .95 + .1 * grain;
      ${floor ? `
        vec2 tile = floor(observatoryWorld.xz / 2.0);
        diffuseColor.rgb *= .78 + .36 * stoneHash(tile);
        float along = mod(observatoryWorld.z + 1.85, 3.7) - 1.85;
        float across = observatoryWorld.x - observatoryCenter.x;
        float pool = exp(-across * across * .19 - along * along * .8);
        diffuseColor.rgb += vec3(.058, .036, .014) * pool * ${quiet ? "0.15" : "1.0"};
        float edge = exp(-abs(abs(across) - 5.8) * 1.8);
        diffuseColor.rgb += vec3(.012, .027, .038) * edge * ${quiet ? "0.2" : "1.0"};
      ` : `
        float wash = .58 + .42 * smoothstep(.1, 5.5, observatoryWorld.y);
        diffuseColor.rgb *= wash;
        float rhythm = pow(.5 + .5 * cos(observatoryWorld.z * 1.7), 10.0);
        diffuseColor.rgb += vec3(.012, .017, .019) * rhythm * exp(-abs(observatoryWorld.y - 2.7) * .8) * ${quiet ? "0.15" : "1.0"};
      `}
      float architectureHaze = 1.0 - exp(-max(0.0, length(cameraPosition - observatoryWorld) - 18.0) * .006);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.012, .026, .046), architectureHaze);
    `);
  };
}

/** Fixed face shading makes the design legible without lights, textures or shadows. */
function shaded(geometry: BufferGeometry): BufferGeometry {
  const normals = geometry.getAttribute("normal");
  const colors = [];
  for (let i = 0; i < normals.count; i++) {
    const shade = 0.55 + Math.max(0, normals.getY(i)) * 0.3 + Math.max(0, normals.getX(i)) * 0.09 + Math.max(0, normals.getZ(i)) * 0.06;
    colors.push(shade, shade, shade);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  // One material per batch: BoxGeometry's six face groups must not add draws.
  geometry.clearGroups();
  return geometry;
}

function geometry(kind: Primitive): BufferGeometry {
  let result = geometries.get(kind);
  if (!result) {
    result = shaded(kind === "box" ? new BoxGeometry(1, 1, 1)
      : kind === "column" ? new CylinderGeometry(1, 1, 1, 8)
      : kind === "arch" ? new TorusGeometry(1, 0.025, 4, 28, Math.PI)
      : kind === "ring" ? new TorusGeometry(1, 0.015, 5, 48)
      : kind === "halo" ? new TorusGeometry(1, 0.08, 6, 48)
      : new IcosahedronGeometry(1, 0));
    geometries.set(kind, result);
  }
  return result;
}

class Builder {
  readonly group = new Group();
  readonly batches = new Map<string, { kind: Primitive; finish: Finish; transforms: Matrix4[] }>();
  constructor(readonly room: Room) { this.group.name = `${room.id}-shell`; }
  add(kind: Primitive, finish: Finish, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotation = new Quaternion()): void {
    if (Math.min(sx, sy, sz) <= 0) return;
    const key = `${kind}-${finish}`;
    let batch = this.batches.get(key);
    if (!batch) { batch = { kind, finish, transforms: [] }; this.batches.set(key, batch); }
    batch.transforms.push(new Matrix4().compose(new Vector3(x, y, z), rotation, new Vector3(sx, sy, sz)));
  }
  box(finish: Finish, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    this.add("box", finish, x, y, z, sx, sy, sz);
  }
  bar(finish: Finish, from: Vector3, to: Vector3, radius: number): void {
    const delta = to.clone().sub(from);
    const middle = from.clone().add(to).multiplyScalar(0.5);
    this.add("column", finish, middle.x, middle.y, middle.z, radius, delta.length(), radius,
      new Quaternion().setFromUnitVectors(UNIT, delta.normalize()));
  }
  finish(): Group {
    for (const [key, batch] of this.batches) {
      const mesh = new InstancedMesh(geometry(batch.kind), material(batch.finish, this.room.id), batch.transforms.length);
      mesh.name = `observatory-${key}`;
      batch.transforms.forEach((transform, index) => mesh.setMatrixAt(index, transform));
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    this.group.userData = { architecture: "observatory", designed: true };
    return this.group;
  }
}

/** How wide a hanging is along its wall, for keeping the wall panels clear of it. */
function hangingWidth(h: Room["hangings"][number]): number {
  if (h.kind === "tape") return h.longSideMeters;
  if (h.kind === "planet") return h.radiusMeters * 2;
  // A live audio exhibit is a volume standing in the room, not a thing on a
  // wall (audio/topology.ts places its topology around the visitor), so it
  // clears no wall panel.
  if (h.kind === "audio") return 0;
  return h.widthMeters;
}

interface Wall { axis: "x" | "z"; at: number; inward: number; min: number; max: number }
function walls(room: Room): Wall[] {
  const [x0, , z0] = room.bounds.min, [x1, , z1] = room.bounds.max;
  return [
    { axis: "x", at: x0, inward: 1, min: z0, max: z1 },
    { axis: "x", at: x1, inward: -1, min: z0, max: z1 },
    { axis: "z", at: z0, inward: 1, min: x0, max: x1 },
    { axis: "z", at: z1, inward: -1, min: x0, max: x1 },
  ];
}
function doorsOn(room: Room, wall: Wall): Doorway[] {
  return room.doorways.filter(d => !d.closed && d.axis === wall.axis && Math.abs(d.at - wall.at) < 0.001)
    .sort((a, b) => a.center - b.center);
}
function wallBox(b: Builder, wall: Wall, finish: Finish, center: number, y: number, length: number, height: number, thickness: number, inset = 0): void {
  const at = wall.at + wall.inward * (thickness / 2 + inset);
  if (wall.axis === "x") b.box(finish, at, y, center, thickness, height, length);
  else b.box(finish, center, y, at, length, height, thickness);
}

function chamberWalls(b: Builder): void {
  const room = b.room, y0 = room.bounds.min[1], y1 = room.bounds.max[1];
  for (const wall of walls(room)) {
    const doors = doorsOn(room, wall);
    let cursor = wall.min;
    const pier = (left: number, right: number): void => {
      if (right <= left) return;
      wallBox(b, wall, "wall", (left + right) / 2, (y0 + y1) / 2, right - left, y1 - y0, 0.16);
      wallBox(b, wall, "brass", (left + right) / 2, y0 + 0.1, right - left, 0.025, 0.018, 0.165);
      // Recessed vertical panels add rhythm while keeping wall hangings visible.
      for (let p = left + 0.65; p < right - 0.6; p += 1.4) {
        const obstructsHanging = room.hangings.some(h => Math.abs(h.position[wall.axis === "x" ? 0 : 2] - wall.at) < 0.6
          && Math.abs(h.position[wall.axis === "x" ? 2 : 0] - p) < hangingWidth(h) / 2 + 0.3);
        if (!obstructsHanging) {
          wallBox(b, wall, "inset", p, y0 + (y1 - y0) * 0.48, 0.65, (y1 - y0) * 0.78, 0.012, 0.162);
          wallBox(b, wall, "stone", p + 0.36, y0 + (y1 - y0) * 0.48, 0.12, (y1 - y0) * 0.85, 0.18, 0.17);
          if (["hall", "gallery", "orangery"].includes(room.id)) {
            wallBox(b, wall, "brass", p - 0.02, y0 + 2.8, 0.16, 0.95, 0.09, 0.19);
            wallBox(b, wall, "light", p - 0.02, y0 + 2.8, 0.055, 0.74, 0.025, 0.285);
          }
        }
      }
    };
    for (const door of doors) {
      const left = Math.max(wall.min, door.center - door.width / 2);
      const right = Math.min(wall.max, door.center + door.width / 2);
      pier(cursor, left);
      const top = y0 + door.height;
      if (top < y1) wallBox(b, wall, "wall", (left + right) / 2, (top + y1) / 2, right - left, y1 - top, 0.16);
      cursor = Math.max(cursor, right);
    }
    pier(cursor, wall.max);
    // The luminous cornice stays above the tallest aperture on this wall.
    const corniceY = Math.max(y1 - 0.32, y0 + Math.max(0, ...doors.map(d => d.height)) + 0.07);
    if (corniceY < y1 - 0.03) wallBox(b, wall, "blue", (wall.min + wall.max) / 2, corniceY, wall.max - wall.min - 0.35, 0.027, 0.025, 0.18);
  }
  portals(b);
}

function portals(b: Builder): void {
  const room = b.room, y0 = room.bounds.min[1], height = room.bounds.max[1] - y0;
  for (const wall of walls(room)) {
    for (const door of room.doorways.filter(d => d.axis === wall.axis && Math.abs(d.at - wall.at) < 0.001)) {
      // Grounds have broad graph connections, not eighty-metre physical gates.
      if (door.width > 8 || door.height >= height) continue;
      for (const side of [-1, 1]) {
        wallBox(b, wall, "stone", door.center + side * (door.width / 2 + 0.28), y0 + door.height / 2, 0.44, door.height, 0.38, 0.02);
        wallBox(b, wall, "brass", door.center + side * (door.width / 2 + 0.09), y0 + door.height / 2, 0.12, door.height, 0.14, 0.02);
        wallBox(b, wall, door.closed ? "joint" : "light", door.center + side * (door.width / 2 + 0.019), y0 + door.height / 2, 0.025, door.height, 0.02, 0.17);
      }
      wallBox(b, wall, "stone", door.center, y0 + door.height + 0.28, door.width + 1.0, 0.44, 0.38, 0.02);
      wallBox(b, wall, "brass", door.center, y0 + door.height + 0.09, door.width + 0.3, 0.14, 0.14, 0.02);
      wallBox(b, wall, door.closed ? "joint" : "light", door.center, y0 + door.height + 0.022, door.width + 0.05, 0.025, 0.02, 0.17);
    }
  }
}

/** A faceted barrel vault with a real, open clerestory along its crown. */
function vault(b: Builder): void {
  const room = b.room, [x0, y0, z0] = room.bounds.min, [x1, y1, z1] = room.bounds.max;
  const cx = (x0 + x1) / 2, width = x1 - x0, depth = z1 - z0;
  const spring = Math.max(y0 + (y1 - y0) * 0.6, y0 + Math.max(0, ...room.doorways.map(d => d.height)) + 0.15);
  const rise = Math.max(0.25, y1 - spring - 0.12), radius = width / 2 - 0.19;
  const positions: number[] = [], colors: number[] = [];
  const roofColor = new Color(ROOM_FINISH[room.id]?.roof ?? OBSERVATORY_PALETTE.roof);
  const steps = 32;
  for (let i = 0; i < steps; i++) {
    const a = Math.PI * i / steps, c = Math.PI * (i + 1) / steps;
    if (Math.abs(Math.cos((a + c) / 2) * radius) < width * 0.075) continue;
    const xa = cx + Math.cos(a) * radius, xb = cx + Math.cos(c) * radius;
    const ya = spring + Math.sin(a) * rise, yb = spring + Math.sin(c) * rise;
    positions.push(xa, ya, z0 + 0.17, xb, yb, z0 + 0.17, xb, yb, z1 - 0.17,
      xa, ya, z0 + 0.17, xb, yb, z1 - 0.17, xa, ya, z1 - 0.17);
    const shade = 0.62 + 0.38 * Math.sin((a + c) / 2);
    for (let vertex = 0; vertex < 6; vertex++) colors.push(roofColor.r * shade, roofColor.g * shade, roofColor.b * shade);
  }
  const roof = new BufferGeometry();
  roof.setAttribute("position", new Float32BufferAttribute(positions, 3));
  roof.setAttribute("color", new Float32BufferAttribute(colors, 3));
  roof.computeVertexNormals();
  const mesh = new Mesh(roof, roofMaterial()); mesh.name = "observatory-vault"; b.group.add(mesh);
  const ribSpacing = room.id === "hall" ? 3.7 : room.id === "spectre" ? 4.3 : 4.8;
  const ribs = Math.max(3, Math.ceil(depth / ribSpacing));
  for (let i = 0; i <= ribs; i++) {
    const z = z0 + 0.3 + (depth - 0.6) * i / ribs;
    b.add("arch", "stone", cx, spring - 0.10, z, radius - 0.015, rise, 4);
    b.add("arch", "brass", cx, spring - 0.15, z, radius - 0.075, rise - 0.055, 2);
    b.add("arch", room.id === "hall" || room.id === "orangery" ? "light" : "blue", cx, spring - 0.19, z, radius - 0.1, rise - 0.075, 0.42);
  }
  for (const side of [-1, 1]) b.box("blue", cx + side * width * 0.078, y1 - 0.11, (z0 + z1) / 2, 0.04, 0.035, depth - 0.3);
  // Oculi distinguish the quieter chambers. They hang above the exhibit envelope.
  if (["hall", "phototroph", "spectre", "greenhouse"].includes(room.id)) {
    const radius = room.id === "hall" ? 2.1 : 1.65;
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    b.add("ring", "brass", cx, y1 - 0.48, (z0 + z1) / 2, radius, radius, 1.3, rotation);
    b.add("ring", "light", cx, y1 - 0.49, (z0 + z1) / 2, radius - 0.08, radius - 0.08, 0.35, rotation);
  }
  if (room.id === "hall") {
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const y = y1 - 1.5 + i * 0.32, radius = 2.4 - i * 0.34;
      b.add("halo", "brass", cx, y, (z0 + z1) / 2, radius, radius, 0.85, rotation);
      b.add("halo", "light", cx, y - 0.055, (z0 + z1) / 2, radius - 0.015, radius - 0.015, 0.22, rotation);
    }
    for (const x of [-1.75, 1.75]) b.bar("brass", new Vector3(cx + x, y1 - 1.45, (z0 + z1) / 2), new Vector3(cx + x, y1 - 0.2, (z0 + z1) / 2), 0.018);
  }
}
let roofFinish: Material | undefined;
function roofMaterial(): Material {
  return roofFinish ??= new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
}

function chamberFloor(b: Builder): void {
  const [x0, y0, z0] = b.room.bounds.min, [x1, , z1] = b.room.bounds.max;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  b.box("floor", cx, y0 - 0.1, cz, x1 - x0, 0.2, z1 - z0);
  // A continuous central route gives the enfilade a direction without arrows.
  for (const side of [-1, 1]) b.box("brass", cx + side * 1.42, y0 + 0.006, cz, 0.025, 0.012, z1 - z0);
  for (let z = z0 + 2; z < z1; z += 2) b.box("joint", cx, y0 + 0.004, z, x1 - x0 - 0.32, 0.008, 0.012);
  for (let x = x0 + 2; x < x1; x += 2) b.box("joint", x, y0 + 0.004, cz, 0.012, 0.008, z1 - z0 - 0.32);
}

/** Faceted, brass-stemmed grove sculptures, kept away from the primary paths. */
function tree(b: Builder, x: number, z: number, height: number): void {
  const y = b.room.bounds.min[1];
  b.add("column", "brass", x, y + height * 0.4, z, 0.09, height * 0.8, 0.09);
  for (const side of [-1, 1]) {
    b.bar("brass", new Vector3(x, y + height * 0.4, z), new Vector3(x + side * 0.95, y + height * 0.75, z + side * 0.3), 0.045);
    b.add("crown", "grove", x + side * 0.65, y + height * 0.79, z + side * 0.22, 1.25, height * 0.25, 1.05);
  }
  b.add("column", "joint", x, y + 0.035, z, 1.5, 0.07, 1.5);
}
function path(b: Builder, x: number, z: number, width: number, depth: number): void {
  const y = b.room.bounds.min[1];
  b.box("path", x, y + 0.006, z, width, 0.012, depth);
  const alongZ = depth > width;
  for (const side of [-1, 1]) b.box("brass", x + (alongZ ? side * (width / 2 - 0.12) : 0), y + 0.016,
    z + (alongZ ? 0 : side * (depth / 2 - 0.12)), alongZ ? 0.025 : width, 0.008, alongZ ? depth : 0.025);
}
function grounds(b: Builder): void {
  const room = b.room, [x0, y0, z0] = room.bounds.min, [x1, , z1] = room.bounds.max;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, width = x1 - x0, depth = z1 - z0;
  b.box("earth", cx, y0 - 0.1, cz, width, 0.2, depth);
  if (room.id === "terrace") {
    path(b, cx, cz, 4.8, depth);
    portals(b);
    for (let z = z0 + 5; z < z1 - 3; z += 8) {
      if (room.doorways.some(d => d.axis === "x" && Math.abs(d.center - z) < d.width / 2 + 0.5)) continue;
      for (const x of [x0 + 0.65, x1 - 0.65]) {
        b.add("column", "stone", x, y0 + 2.65, z, 0.18, 5.3, 0.18);
        b.add("column", "brass", x, y0 + 0.12, z, 0.32, 0.24, 0.32);
        b.box("light", x, y0 + 4.2, z, 0.20, 1.2, 0.20);
      }
      b.add("arch", "stone", cx, y0 + 5.2, z, width / 2 - 0.65, 1.6, 4);
      b.add("arch", "blue", cx, y0 + 5.14, z, width / 2 - 0.70, 1.6, 0.6);
    }
  } else if (room.id === "parterre") {
    path(b, cx, 0, width, 6); path(b, cx, cz, 6, depth);
    for (const x of [x0 + 9, x1 - 9]) for (const z of [-26, -14, 14, 26]) tree(b, x, z, 4.7);
    // An architectural armillary over the crossing: the walking plane stays clear.
    for (const angle of [0, Math.PI / 3, -Math.PI / 3]) {
      b.add("ring", "brass", cx, y0 + 5.2, 0, 2.3, 2.3, 1.6,
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle));
    }
    b.add("ring", "blue", cx, y0 + 5.2, 0, 2.16, 2.16, 0.45,
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
  } else {
    path(b, cx, cz, width, 5);
    path(b, cx, cz, 5, depth);
    // Deterministic architectural planting; there is no particle system here.
    let index = 0;
    for (let x = x0 + 9; x <= x1 - 8; x += 15) for (let z = z0 + 9; z <= z1 - 8; z += 15) {
      if (Math.abs(x - cx) < 5 || Math.abs(z - cz) < 5) continue;
      if (Math.hypot(x - room.spawn.position[0], z - room.spawn.position[2]) < 4) continue;
      tree(b, x, z, 4.5 + (index++ % 3) * 0.55);
    }
  }
}

export function buildObservatory(room: Room): RoomShell {
  const b = new Builder(room);
  if (room.fallback.kind === "ground") grounds(b);
  else { chamberFloor(b); chamberWalls(b); vault(b); }
  const group = b.finish();
  return {
    group,
    provenance: {
      source: "Designed procedural architecture",
      generator: "grove/src/world/observatory.ts",
      design: "Nocturne research observatory",
      materials: "Vertex-shaded mineral, brass, luminous architectural inlays",
      scientific_content: false,
      note: "The building and grove sculptures are architecture. Research exhibits retain their independent source records.",
      units: "metres",
      architecture_batches: group.children.length,
    },
    lightmap: null,
    markers: { doors: new Map(), posters: new Map() },
  };
}
