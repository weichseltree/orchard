import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide,
  Float32BufferAttribute, Group, IcosahedronGeometry, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, TorusGeometry, Vector3,
  type Material,
} from "three";
import type { Room, Doorway, Mansion } from "./schema";
import type { RoomShell } from "./rooms";
import { STAIR_MARGIN, STAIR_TREAD, flightsOf, moundHeight, stairSteps, type Flight } from "./terrain";
import { LIGHT_FIELD_GLSL, LIGHT_FIELD_UNIFORMS_GLSL, applyLightField, bakeLightField, lightFieldUniforms, litRooms, type Emitter, type LightField } from "./lightfield";
import { onPulse } from "./pulse";
import { VENUE_TINT } from "./venue";
import { PORTAL_TINT } from "./portal-shader";
import { SEALED_TINT, sealedLens } from "./sealed";

// The palace's architecture, generated at runtime from mansion.json: a
// nocturne of mineral walls, brass and luminous inlays. Rooms may stand at
// different heights; a doorway between two floors gets a flight of steps in
// the lower room, drawn to the same rise and run the body climbs
// (terrain.ts). The grounds are a height field with the same function under
// the trees and the feet. Nothing here is a scientific claim: the exhibits
// carry their own records.

/** Architecture colours carry no scientific meaning; tapes keep their own palettes. */
export const OBSERVATORY_PALETTE = {
  floor: "#17212b", wall: "#182737", inset: "#101b27", roof: "#142435", stone: "#53616c",
  brass: "#a98551", light: "#eed3a5", blue: "#87b9db",
  joint: "#263540", path: "#243544", earth: "#0b1822", grove: "#345355",
  hedge: "#1c3a33", water: "#0c2634", gravel: "#2b3543",
  /** Self-luminous but not a lamp: it lights nothing around it (the club's floor tiles). */
  neon: VENUE_TINT,
} as const;
type Finish = keyof typeof OBSERVATORY_PALETTE;
type Primitive = "box" | "column" | "arch" | "ring" | "crown" | "halo";
const UNIT = new Vector3(0, 1, 0);
const FLAT = /* @__PURE__ */ new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
const ROOM_FINISH: Record<string, Partial<Record<Finish, string>>> = {
  spectre: { wall: "#050b13", floor: "#080f18", inset: "#040810", stone: "#1b2732", brass: "#555348", light: "#7793a8", blue: "#527389", roof: "#070e18" },
  phototroph: { wall: "#292326", floor: "#241e1b", inset: "#171418", stone: "#62564b", brass: "#b59668", light: "#ffdb9d", blue: "#d2aa73", roof: "#251f23" },
  orangery: { wall: "#263846", inset: "#172632", stone: "#667b88", brass: "#899eaa", light: "#ddf1ff", blue: "#a9d9f0", roof: "#203443" },
  belvedere: { wall: "#1b2c3c", inset: "#121f2b", stone: "#5c6b77", roof: "#172838" },
  // arcedit's area: slate walls and the editor's yellow in the lamps, one finish for all its rooms.
  arcedit: { wall: "#141b26", floor: "#0f1620", inset: "#0c121a", stone: "#4c5766", brass: "#a8905c", light: "#ffe4ad", blue: "#d1a94b", roof: "#111a26" },
  // The cellar venue (docs/specs/CLUB.md): the foyer warm, the club in its
  // own cold pair, magenta lamps and cyan lines, over near-black stone. The
  // club's luminous finishes are its own materials so the pulse can tint them.
  foyer: { wall: "#1a1424", floor: "#14101c", inset: "#0f0b16", stone: "#4a3f5e", brass: "#b8905a", light: "#ffc27a", blue: "#8f7bff", roof: "#130f1c" },
  club: { wall: "#120d1c", floor: "#0a0712", inset: "#07050e", stone: "#3b3050", brass: "#b4884d", light: "#ff62d6", blue: "#3fdcff", neon: "#ff3fb0", joint: "#1c1430", roof: "#0e0a17" },
};
/** Rooms finished as another room: the stage is part of the club and shares its materials. */
const FINISH_ALIAS: Record<string, string> = { stage: "club" };
/**
 * Which finish a room takes: its own, or its tree's for the rooms of an area
 * ("arcedit/results/grove" is finished as "arcedit"), so an area's rooms
 * share materials as well as a look (TREE-AREAS.md §7).
 */
function finishOf(roomId: string): Partial<Record<Finish, string>> | undefined {
  return ROOM_FINISH[finishKey(roomId)];
}
function finishKey(roomId: string): string {
  const id = FINISH_ALIAS[roomId] ?? roomId;
  return ROOM_FINISH[id] ? id : id.split("/")[0]!;
}
/** Rooms whose walls carry brass sconces between the panels. */
const SCONCED = ["hall", "gallery", "orangery", "belvedere", "world-engine", "foyer", "club"];
/** Rooms with a colonnade along their long walls. */
const COLONNADED = ["hall", "gallery", "orangery", "belvedere"];
const materials = new Map<string, MeshBasicMaterial>();
const geometries = new Map<Primitive, BufferGeometry>();

function material(finish: Finish, roomId: string): MeshBasicMaterial {
  const override = finishOf(roomId)?.[finish];
  const key = override ? `${finishKey(roomId)}-${finish}` : finish;
  let result = materials.get(key);
  if (!result) {
    const luminous = finish === "light" || finish === "blue" || finish === "neon";
    result = new MeshBasicMaterial({ color: override ?? OBSERVATORY_PALETTE[finish], vertexColors: !luminous, side: DoubleSide, toneMapped: !luminous });
    result.name = `observatory-${key}`;
    if (!luminous) stoneSurface(result, finish, roomId === "spectre");
    materials.set(key, result);
  }
  return result;
}

/**
 * The pulse on a room's own lamps (audio/beat.ts): its luminous finishes,
 * tinted by a gain about one. Only finishes the room overrides are touched,
 * because the others are the whole palace's materials; the baked light on
 * the walls pulses separately, through the field's uniform (lightfield.ts).
 * A room that asks something of its visitors (the club) follows the pulse
 * from the moment it is built; this file is not on the startup path, so it
 * registers itself rather than being called from the frame loop.
 */
const pulsing = new Set<string>();
function followPulse(room: Room): void {
  if (room.requires.length === 0) return;
  const key = finishKey(room.id);
  if (pulsing.has(key)) return;
  pulsing.add(key);
  // The materials once, not three map lookups a frame.
  const lamps = luminousOf(key);
  onPulse((gain) => { for (const { m, base } of lamps) m.color.copy(base).multiplyScalar(gain); });
}
function luminousOf(roomId: string): Array<{ m: MeshBasicMaterial; base: Color }> {
  const own = finishOf(roomId);
  if (!own) return [];
  const out: Array<{ m: MeshBasicMaterial; base: Color }> = [];
  for (const finish of ["light", "blue", "neon"] as const) {
    if (!own[finish]) continue;
    const m = material(finish, roomId);
    out.push({ m, base: (m.userData.base ??= m.color.clone()) as Color });
  }
  return out;
}
export function tintLuminous(roomId: string, gain: number): void {
  for (const { m, base } of luminousOf(roomId)) m.color.copy(base).multiplyScalar(gain);
}

/** Quiet architectural surface shading, independent of all exhibit materials. */
function stoneSurface(material: MeshBasicMaterial, finish: Finish, quiet: boolean): void {
  const floor = finish === "floor" || finish === "path";
  // The grounds lie under the sky: no wash up a wall, and a moonlit floor of ambient.
  const outdoors = finish === "earth" || finish === "hedge" || finish === "gravel" || finish === "water" || finish === "grove";
  // Colour variants are uniforms; they share these few surface programs.
  material.customProgramCacheKey = () => `observatory-surface-${floor ? "floor" : outdoors ? "ground" : "wall"}-${quiet}`;
  material.onBeforeCompile = shader => {
    // The baked light field, shared by every architectural material (lightfield.ts).
    Object.assign(shader.uniforms, lightFieldUniforms);
    shader.vertexShader = `varying vec3 observatoryWorld; varying vec3 observatoryCenter; varying vec3 observatoryNormal;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      vec4 architecturePosition = vec4(transformed, 1.0);
      vec4 architectureCenter = vec4(0.0, 0.0, 0.0, 1.0);
      vec3 architectureNormal = normal;
      #ifdef USE_INSTANCING
        architecturePosition = instanceMatrix * architecturePosition;
        architectureCenter = instanceMatrix * architectureCenter;
        architectureNormal = mat3(instanceMatrix) * architectureNormal;
      #endif
      observatoryWorld = (modelMatrix * architecturePosition).xyz;
      observatoryCenter = (modelMatrix * architectureCenter).xyz;
      observatoryNormal = normalize(mat3(modelMatrix) * architectureNormal);
    `);
    shader.fragmentShader = `varying vec3 observatoryWorld; varying vec3 observatoryCenter; varying vec3 observatoryNormal;
      ${LIGHT_FIELD_UNIFORMS_GLSL}
      float stoneHash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * .1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }\n${shader.fragmentShader}`;
    // The light: a floor of ambient so nothing goes black, and over it the
    // baked field, which is where the lamps, the chandeliers, the lanterns
    // and the portals actually are. The quiet room keeps its lamps low.
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `
      #include <color_fragment>
      float grain = stoneHash(floor(observatoryWorld.xz * 31.0 + observatoryWorld.y * 13.0));
      diffuseColor.rgb *= .95 + .1 * grain;
      ${floor ? `
        vec2 tile = floor(observatoryWorld.xz / 2.0);
        diffuseColor.rgb *= .78 + .36 * stoneHash(tile);
      ` : outdoors ? "" : `
        float wash = .72 + .28 * smoothstep(.1, 5.5, observatoryWorld.y - observatoryCenter.y + 2.5);
        diffuseColor.rgb *= wash;
      `}
      ${LIGHT_FIELD_GLSL}
      diffuseColor.rgb *= ${(outdoors ? AMBIENT_OUTDOORS : AMBIENT).toFixed(2)} + fieldLight * ${quiet ? "0.55" : "1.0"};
      float architectureHaze = 1.0 - exp(-max(0.0, length(cameraPosition - observatoryWorld) - 18.0) * .006);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.012, .026, .046), architectureHaze);
    `);
  };
}
/** The light where no lamp reaches, as a factor on the surface colour. */
const AMBIENT = 0.7;
/** The grounds under the night sky: moonlight, a little more than a chamber's dark corner. */
const AMBIENT_OUTDOORS = 0.86;
/** Every lamp at once; the bake's own powers are per element. */
const FIELD_GAIN = 1.6;

let lightField: { mansion: Mansion; field: LightField } | null = null;
/** Bakes the field for this mansion once, from every room's emitters and the portals, and points the materials at it. */
export function ensureLightField(mansion: Mansion): LightField {
  if (lightField?.mansion === mansion) return lightField.field;
  lightField?.field.dispose();
  const field = bakeLightField(mansion, emittersOf(mansion));
  applyLightField(field, FIELD_GAIN);
  lightField = { mansion, field };
  return field;
}

/** Every emitter of the palace: the luminous architecture of each room, the portals, the sealed doors' lenses. */
export function emittersOf(mansion: Mansion): Emitter[] {
  const out: Emitter[] = [];
  const tint = new Color(PORTAL_TINT), sealed = new Color(SEALED_TINT);
  for (const room of litRooms(mansion)) {
    out.push(...plan(room, mansion).emitters);
    for (const portal of room.portals) {
      out.push({ x: portal.position[0], y: portal.position[1], z: portal.position[2], r: tint.r, g: tint.g, b: tint.b, power: 1.8, reach: portal.radius * 4, room: room.id });
    }
    for (const door of room.doorways) {
      const lens = sealedLens(room, door);
      if (lens) out.push({ x: lens.center.x, y: lens.center.y, z: lens.center.z, r: sealed.r, g: sealed.g, b: sealed.b, power: 0.35, reach: 2 + lens.radius * 3, room: room.id });
    }
  }
  return out;
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

/**
 * A room of a tree's area (TREE-AREAS.md): a chamber under an entrance, or
 * the entrance itself. The palace's own rooms all run along z; an area's
 * corridors alternate, so an area's room wider than it is deep is turned:
 * its vault, its route and its lamps follow x.
 */
export function areaRoom(room: Room, mansion: Mansion | null): boolean {
  return room.id.includes("/") || (mansion?.rooms.some(r => r.id.startsWith(`${room.id}/`)) ?? false);
}
/**
 * Whether another room of the same scale stands over this one: its footprint
 * overlaps and its floor is at or above this room's ceiling. The palace's
 * chambers look up through the open crown of their vault at the sky; a
 * cellar under a wing looks up at that wing's floor, so it gets a lid.
 */
export function covered(room: Room, mansion: Mansion | null): boolean {
  return coverFloor(room, mansion) !== null;
}
/** The lowest floor standing over this room, or null when the sky is. */
export function coverFloor(room: Room, mansion: Mansion | null): number | null {
  return coverOf(room, mansion)?.bounds.min[1] ?? null;
}
/** The room standing over this one with the lowest floor, if any. */
export function coverOf(room: Room, mansion: Mansion | null): Room | null {
  if (!mansion) return null;
  const [x0, , z0] = room.bounds.min, [x1, y1, z1] = room.bounds.max;
  let cover: Room | null = null;
  for (const other of mansion.rooms) {
    if (other.id === room.id || (other.scale ?? 1) !== (room.scale ?? 1)) continue;
    if (other.bounds.min[1] < y1 - 0.001) continue;
    if (other.bounds.min[0] >= x1 || other.bounds.max[0] <= x0 || other.bounds.min[2] >= z1 || other.bounds.max[2] <= z0) continue;
    if (!cover || other.bounds.min[1] < cover.bounds.min[1]) cover = other;
  }
  return cover;
}
/** How far below a covered room's ceiling its cladding reaches: past any outside ground beside it. */
const CLADDING_DROP_M = 2.5;
/** A lid or cladding tops this far under the floor above: inside a chamber's 0.2 m slab and the grounds' skirt, off every face. */
const SLAB_INSET_M = 0.12;
/** The string course under the floor above: a dash every bay, so the plinth is lit without a hundred lamps. */
const STRING_COURSE = { dash: 1.6, bay: 4 };
/**
 * A cellar's outer faces are what the grounds see of it: from the garden,
 * the terrace's edge is the undercroft's wall and the wing's foot is the
 * club's. Those walls are the cellar's own dark finish, so a covered room
 * wears the stone of the room above it on the outside, from below the
 * outside ground up to that room's floor. The cladding stands just outside
 * the wall, so from inside the cellar it is hidden behind the wall, and
 * inside a neighbour it lies within that neighbour's own wall.
 */
function cladding(b: Builder): void {
  const cover = coverOf(b.room, b.mansion);
  if (!cover) return;
  const room = b.room, y1 = room.bounds.max[1], top = cover.bounds.min[1] - SLAB_INSET_M, bottom = y1 - CLADDING_DROP_M;
  if (top <= bottom) return;
  const grounds = b.mansion?.rooms.filter(r => r.fallback.kind === "ground" && (r.scale ?? 1) === (room.scale ?? 1)) ?? [];
  for (const wall of walls(room)) {
    const at = wall.at - wall.inward * 0.05, cy = (bottom + top) / 2, h = top - bottom;
    // In runs between the doorways, each left open a jamb's width beyond its aperture.
    let cursor = wall.min - 0.05;
    const run = (from: number, to: number): void => {
      if (to - from < 0.05) return;
      const mid = (from + to) / 2;
      if (wall.axis === "x") b.add("box", "wall", at, cy, mid, 0.1, h, to - from, undefined, cover.id);
      else b.add("box", "wall", mid, cy, at, to - from, h, 0.1, undefined, cover.id);
      // A run the grounds can see gets a string course of light under the
      // floor above, in the grounds' own light region: in this nocturne an
      // unlit wall is black, and a plinth is only a plinth once it is lit.
      const px = wall.axis === "x" ? at - wall.inward * 0.05 : mid, pz = wall.axis === "x" ? mid : at - wall.inward * 0.05, py = top - 0.18;
      const outside = grounds.find(r => px >= r.bounds.min[0] && px <= r.bounds.max[0] && py >= r.bounds.min[1] && py <= r.bounds.max[1] && pz >= r.bounds.min[2] && pz <= r.bounds.max[2]);
      if (!outside) return;
      // Dashes in the cornice's blue: each is one lamp of a cornice's power, one per bay,
      // skipping the neighbours' doorways in this wall plane, whose flights would bury them.
      const l = at - wall.inward * 0.07;
      const buried = [cover, outside].flatMap(r => r.doorways.filter(d => d.axis === wall.axis && Math.abs(d.at - wall.at) < 0.001)
        .map(d => [d.center - d.width / 2 - STAIR_MARGIN, d.center + d.width / 2 + STAIR_MARGIN] as const));
      for (let s = from + 0.6; s + STRING_COURSE.dash < to - 0.3; s += STRING_COURSE.bay) {
        const c = s + STRING_COURSE.dash / 2;
        if (buried.some(([a, z]) => s < z && s + STRING_COURSE.dash > a)) continue;
        if (wall.axis === "x") b.add("box", "blue", l, py, c, 0.04, 0.04, STRING_COURSE.dash, undefined, cover.id, outside.id);
        else b.add("box", "blue", c, py, l, STRING_COURSE.dash, 0.04, 0.04, undefined, cover.id, outside.id);
      }
    };
    for (const door of doorsOn(room, wall)) {
      run(cursor, door.center - door.width / 2 - DOOR_JAMB_M);
      cursor = Math.max(cursor, door.center + door.width / 2 + DOOR_JAMB_M);
    }
    run(cursor, wall.max + 0.05);
  }
}
/** A doorway's stone jamb reaches this far beyond its aperture (labels.ts keeps the same number). */
const DOOR_JAMB_M = 0.5;
export function runsAlongX(room: Room, mansion: Mansion | null): boolean {
  return areaRoom(room, mansion) && room.bounds.max[0] - room.bounds.min[0] > room.bounds.max[2] - room.bounds.min[2];
}

class Builder {
  readonly group = new Group();
  readonly batches = new Map<string, { kind: Primitive; finish: Finish; as: string; transforms: Matrix4[] }>();
  /** Every luminous element placed, as the light it gives (lightfield.ts). */
  readonly emitters: Emitter[] = [];
  readonly area: boolean;
  readonly turned: boolean;
  constructor(readonly room: Room, readonly mansion: Mansion | null) {
    this.group.name = `${room.id}-shell`;
    this.area = areaRoom(room, mansion);
    this.turned = runsAlongX(room, mansion);
  }
  /**
   * `as` names the room whose finish the element wears (a cellar's cladding
   * wears the room above it); `lit` the room whose light region its lamp
   * belongs to (a lamp on the outside of a cellar lights the grounds beside
   * it, not the cellar). Both default to this room.
   */
  add(kind: Primitive, finish: Finish, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotation = new Quaternion(), as = this.room.id, lit = this.room.id): void {
    if (Math.min(sx, sy, sz) <= 0) return;
    const key = as === this.room.id ? `${kind}-${finish}` : `${kind}-${finish}@${as}`;
    let batch = this.batches.get(key);
    if (!batch) { batch = { kind, finish, as, transforms: [] }; this.batches.set(key, batch); }
    batch.transforms.push(new Matrix4().compose(new Vector3(x, y, z), rotation, new Vector3(sx, sy, sz)));
    if (finish === "light" || finish === "blue") this.emit(kind, finish, x, y, z, sx, sy, sz, rotation, as, lit);
  }
  /**
   * A luminous element as an emitter: its power from its size, its reach a
   * few metres beyond, its colour the room's. A long strip is a row of
   * points, so a cornice lights the whole wall it runs along.
   */
  private emit(kind: Primitive, finish: Finish, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotation: Quaternion, as = this.room.id, lit = this.room.id): void {
    const colour = new Color(finishOf(as)?.[finish] ?? OBSERVATORY_PALETTE[finish]);
    const dim = finish === "blue" ? 0.45 : 1;
    let power: number, reach: number;
    if (kind === "box") {
      const v = sx * sy * sz;
      power = Math.min(1.6, Math.max(0.6, 3.5 * Math.sqrt(v)));
      reach = 4.5 + 14 * Math.sqrt(Math.sqrt(v));
    } else if (kind === "halo" || kind === "ring") {
      power = Math.min(2.0, Math.max(0.6, 0.7 * sx));
      reach = 5 + 5 * sx;
    } else if (kind === "arch") {
      power = 0.6;
      reach = 9;
    } else {
      power = 0.9;
      reach = 11;
    }
    power *= dim;
    const base = { r: colour.r, g: colour.g, b: colour.b, reach, room: lit };
    const long = kind === "box" ? Math.max(sx, sz) : 0;
    if (long > 3) {
      const along = sx >= sz ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
      along.applyQuaternion(rotation);
      const count = Math.ceil(long / 2.5);
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count - 0.5;
        this.emitters.push({ ...base, x: x + along.x * long * t, y: y + along.y * long * t, z: z + along.z * long * t, power: power * 0.6 });
      }
      return;
    }
    this.emitters.push({ ...base, x, y, z, power });
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
  /** The ground under a point of this room: the base, lifted by the mounds in a cell of the grounds. */
  ground(x: number, z: number): number {
    const base = this.room.bounds.min[1];
    if (this.room.fallback.kind !== "ground" || !this.mansion) return base;
    return base + moundHeight(this.mansion.terrain.mounds, x, z);
  }
  /** The floor a doorway opens at: the higher of the two rooms it joins. */
  doorBase(door: Doorway): number {
    const base = this.room.bounds.min[1];
    const neighbour = this.mansion?.rooms.find(r => r.id === door.to);
    return neighbour && !door.closed ? Math.max(base, neighbour.bounds.min[1]) : base;
  }
  finish(): Group {
    for (const [key, batch] of this.batches) {
      const mesh = new InstancedMesh(geometry(batch.kind), material(batch.finish, batch.as), batch.transforms.length);
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
/** The doorways in this wall, open and closed: a closed one is an aperture too, sealed by its lens. */
function doorsOn(room: Room, wall: Wall): Doorway[] {
  return room.doorways.filter(d => d.axis === wall.axis && Math.abs(d.at - wall.at) < 0.001)
    .sort((a, b) => a.center - b.center);
}
/** A torus lying in the wall's plane. */
function inWall(wall: Wall): Quaternion {
  return wall.axis === "x" ? new Quaternion().setFromAxisAngle(UNIT, Math.PI / 2) : new Quaternion();
}
function wallBox(b: Builder, wall: Wall, finish: Finish, center: number, y: number, length: number, height: number, thickness: number, inset = 0): void {
  const at = wall.at + wall.inward * (thickness / 2 + inset);
  if (wall.axis === "x") b.box(finish, at, y, center, thickness, height, length);
  else b.box(finish, center, y, at, length, height, thickness);
}
/** Whether a hanging sits on this wall within `reach` of a coordinate along it. */
function hangingNear(room: Room, wall: Wall, along: number, reach: number): boolean {
  return room.hangings.some(h => Math.abs(h.position[wall.axis === "x" ? 0 : 2] - wall.at) < 0.6
    && Math.abs(h.position[wall.axis === "x" ? 2 : 0] - along) < hangingWidth(h) / 2 + reach);
}
function doorNear(room: Room, wall: Wall, along: number, reach: number): boolean {
  return room.doorways.some(d => d.axis === wall.axis && Math.abs(d.at - wall.at) < 0.001 && Math.abs(d.center - along) < d.width / 2 + reach);
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
        if (!hangingNear(room, wall, p, 0.3)) {
          wallBox(b, wall, "inset", p, y0 + (y1 - y0) * 0.48, 0.65, (y1 - y0) * 0.78, 0.012, 0.162);
          wallBox(b, wall, "stone", p + 0.36, y0 + (y1 - y0) * 0.48, 0.12, (y1 - y0) * 0.85, 0.18, 0.17);
          // An area's corridors, the rooms with three or more open doors, carry sconces too.
          if (SCONCED.includes(room.id) || (b.area && room.doorways.filter(d => !d.closed).length >= 3)) {
            const sconceY = Math.min(y0 + 2.8, y1 - 0.75);
            wallBox(b, wall, "brass", p - 0.02, sconceY, 0.16, 0.95, 0.09, 0.19);
            wallBox(b, wall, "light", p - 0.02, sconceY, 0.055, 0.74, 0.025, 0.285);
          }
        }
      }
    };
    for (const door of doors) {
      const left = Math.max(wall.min, door.center - door.width / 2);
      const right = Math.min(wall.max, door.center + door.width / 2);
      pier(cursor, left);
      const bottom = b.doorBase(door);
      const top = bottom + door.height;
      // A doorway onto a higher floor opens at that floor; the wall below it is the flight's back.
      if (bottom > y0 + 0.001) wallBox(b, wall, "wall", (left + right) / 2, (y0 + bottom) / 2, right - left, bottom - y0, 0.16);
      if (top < y1) wallBox(b, wall, "wall", (left + right) / 2, (top + y1) / 2, right - left, y1 - top, 0.16);
      if (door.closed) sealedDoor(b, wall, door, bottom, right - left);
      cursor = Math.max(cursor, right);
    }
    pier(cursor, wall.max);
    // The luminous cornice stays above the tallest aperture on this wall.
    const corniceY = Math.max(y1 - 0.32, Math.max(y0, ...doors.map(d => b.doorBase(d) + d.height)) + 0.07);
    if (corniceY < y1 - 0.03) wallBox(b, wall, "blue", (wall.min + wall.max) / 2, corniceY, wall.max - wall.min - 0.35, 0.027, 0.025, 0.18);
  }
  surrounds(b);
}

/**
 * A closed doorway is a portal not yet lit: the aperture is real, so no pier
 * or sconce runs across it, and at the back of it stands a dark recess with a
 * brass halo round the lens the portal system hangs there (portal.ts). The
 * room behind it does not exist yet; nothing of the wall shows through.
 */
function sealedDoor(b: Builder, wall: Wall, door: Doorway, bottom: number, width: number): void {
  const lens = sealedLens(b.room, door);
  if (!lens) return;
  const cy = bottom + door.height / 2;
  // The recess: the full aperture, dark, deep in the wall.
  wallBox(b, wall, "inset", door.center, cy, width, door.height, 0.03, 0.135);
  // Its reveal, so the aperture reads as a depth and not as paint.
  for (const side of [-1, 1]) {
    const x = door.center + side * (width / 2 - 0.02);
    if (wall.axis === "x") b.box("joint", wall.at + wall.inward * 0.075, cy, x, 0.15, door.height, 0.04);
    else b.box("joint", x, cy, wall.at + wall.inward * 0.075, 0.04, door.height, 0.15);
  }
  if (wall.axis === "x") b.box("joint", wall.at + wall.inward * 0.075, bottom + door.height - 0.02, door.center, 0.15, 0.04, width);
  else b.box("joint", door.center, bottom + door.height - 0.02, wall.at + wall.inward * 0.075, width, 0.04, 0.15);
  // The halo round the lens, brass, with a thin luminous ring inside it.
  const q = inWall(wall);
  b.add("halo", "brass", lens.center.x, lens.center.y, lens.center.z, lens.radius + 0.12, lens.radius + 0.12, 0.9, q);
  b.add("ring", "blue", lens.center.x, lens.center.y, lens.center.z, lens.radius + 0.02, lens.radius + 0.02, 0.6, q);
}

/** Stone and brass surrounds on every doorway, closed ones dark. */
function surrounds(b: Builder): void {
  const room = b.room, y0 = room.bounds.min[1], height = room.bounds.max[1] - y0;
  for (const wall of walls(room)) {
    for (const door of room.doorways.filter(d => d.axis === wall.axis && Math.abs(d.at - wall.at) < 0.001)) {
      // Grounds have broad graph connections, not eighty-metre physical gates.
      if (door.width > 8 || door.height >= height) continue;
      const base = b.doorBase(door);
      for (const side of [-1, 1]) {
        wallBox(b, wall, "stone", door.center + side * (door.width / 2 + 0.28), base + door.height / 2, 0.44, door.height, 0.38, 0.02);
        wallBox(b, wall, "brass", door.center + side * (door.width / 2 + 0.09), base + door.height / 2, 0.12, door.height, 0.14, 0.02);
        wallBox(b, wall, door.closed ? "joint" : "light", door.center + side * (door.width / 2 + 0.019), base + door.height / 2, 0.025, door.height, 0.02, 0.17);
      }
      wallBox(b, wall, "stone", door.center, base + door.height + 0.28, door.width + 1.0, 0.44, 0.38, 0.02);
      wallBox(b, wall, "brass", door.center, base + door.height + 0.09, door.width + 0.3, 0.14, 0.14, 0.02);
      wallBox(b, wall, door.closed ? "joint" : "light", door.center, base + door.height + 0.022, door.width + 0.05, 0.025, 0.02, 0.17);
    }
  }
}

/**
 * A flight of steps up to every doorway that opens on a higher floor: stone
 * treads with a brass nosing, cheek walls with a rail, as wide as the
 * doorway plus its margin. The rise and run are terrain.ts's, so the body's
 * ramp and the drawn steps agree to within one riser.
 */
function flights(b: Builder): void {
  if (!b.mansion) return;
  const y0 = b.room.bounds.min[1];
  for (const flight of flightsOf(b.mansion, b.room)) stepsOf(b, flight, y0);
}
function stepsOf(b: Builder, flight: Flight, y0: number): void {
  const { door, rise, run, direction } = flight;
  const steps = stairSteps(rise);
  const cheek = 0.22;
  const width = door.width + 2 * STAIR_MARGIN;
  const inner = width - 2 * cheek;
  const place = (finish: Finish, along: number, y: number, depth: number, height: number, breadth: number, lateral = door.center): void => {
    if (door.axis === "x") b.box(finish, along, y, lateral, depth, height, breadth);
    else b.box(finish, lateral, y, along, breadth, height, depth);
  };
  for (let i = 0; i < steps; i++) {
    const top = y0 + rise * (i + 1) / steps;
    const near = (steps - 1 - i) * STAIR_TREAD;
    const along = door.at + direction * (near + STAIR_TREAD / 2);
    place("stone", along, (y0 + top) / 2, STAIR_TREAD, top - y0, inner);
    place("brass", door.at + direction * (near + STAIR_TREAD - 0.03), top + 0.004, 0.06, 0.012, inner);
  }
  const parapet = rise + 0.95;
  for (const side of [-1, 1]) {
    const lateral = door.center + side * (width / 2 - cheek / 2);
    place("stone", door.at + direction * run / 2, y0 + parapet / 2, run, parapet, cheek, lateral);
    place("brass", door.at + direction * run / 2, y0 + parapet + 0.03, run, 0.06, cheek + 0.06, lateral);
    // A lamp on the newel at the foot of each flight.
    const foot = door.at + direction * (run + 0.25);
    place("brass", foot, y0 + 0.7, 0.32, 1.4, 0.32, lateral);
    place("light", foot, y0 + 1.6, 0.22, 0.36, 0.22, lateral);
  }
}

/** A faceted barrel vault with a real, open clerestory along its crown. */
function vault(b: Builder): void {
  const room = b.room, [x0, y0, z0] = room.bounds.min, [x1, y1, z1] = room.bounds.max;
  // The vault spans the room's short way, u, and runs its long way, v: the
  // palace's rooms all run along z, but an area's corridors alternate, so a
  // turned room maps (u, v) onto (z, x) and its ribs stand across z.
  const turned = b.turned;
  const [u0, u1, v0, v1] = turned ? [z0, z1, x0, x1] : [x0, x1, z0, z1];
  const at = (u: number, v: number): [number, number] => (turned ? [v, u] : [u, v]);
  const turn = turned ? new Quaternion().setFromAxisAngle(UNIT, Math.PI / 2) : new Quaternion();
  const cu = (u0 + u1) / 2, width = u1 - u0, depth = v1 - v0, cx = (x0 + x1) / 2;
  // A proscenium is wider than eight metres and stands in an end wall, so it
  // does not lift the springing the way a doorway in the side does; the wall
  // above it is drawn to the vault (chamberWalls), like the grounds' gates.
  const doorTop = Math.max(y0, ...room.doorways.filter(d => d.width <= 8).map(d => b.doorBase(d) + d.height));
  const spring = Math.max(y0 + (y1 - y0) * 0.6, doorTop + 0.15);
  const rise = Math.max(0.25, y1 - spring - 0.12), radius = width / 2 - 0.19;
  const positions: number[] = [], colors: number[] = [];
  const roofColor = new Color(finishOf(room.id)?.roof ?? OBSERVATORY_PALETTE.roof);
  const steps = 32;
  for (let i = 0; i < steps; i++) {
    const a = Math.PI * i / steps, c = Math.PI * (i + 1) / steps;
    if (Math.abs(Math.cos((a + c) / 2) * radius) < width * 0.075) continue;
    const ua = cu + Math.cos(a) * radius, ub = cu + Math.cos(c) * radius;
    const ya = spring + Math.sin(a) * rise, yb = spring + Math.sin(c) * rise;
    const [xa0, za0] = at(ua, v0 + 0.17), [xb0, zb0] = at(ub, v0 + 0.17);
    const [xa1, za1] = at(ua, v1 - 0.17), [xb1, zb1] = at(ub, v1 - 0.17);
    positions.push(xa0, ya, za0, xb0, yb, zb0, xb1, yb, zb1,
      xa0, ya, za0, xb1, yb, zb1, xa1, ya, za1);
    const shade = 0.62 + 0.38 * Math.sin((a + c) / 2);
    for (let vertex = 0; vertex < 6; vertex++) colors.push(roofColor.r * shade, roofColor.g * shade, roofColor.b * shade);
  }
  const roof = new BufferGeometry();
  roof.setAttribute("position", new Float32BufferAttribute(positions, 3));
  roof.setAttribute("color", new Float32BufferAttribute(colors, 3));
  roof.computeVertexNormals();
  const mesh = new Mesh(roof, roofMaterial()); mesh.name = "observatory-vault"; b.group.add(mesh);
  // An area's chambers are many and small: ribs every six metres, two at least.
  const ribSpacing = room.id === "hall" ? 3.7 : room.id === "spectre" ? 4.3 : b.area ? 6 : 4.8;
  const ribs = Math.max(b.area ? 2 : 3, Math.ceil(depth / ribSpacing));
  for (let i = 0; i <= ribs; i++) {
    const [x, z] = at(cu, v0 + 0.3 + (depth - 0.6) * i / ribs);
    b.add("arch", "stone", x, spring - 0.10, z, radius - 0.015, rise, 4, turn);
    b.add("arch", "brass", x, spring - 0.15, z, radius - 0.075, rise - 0.055, 2, turn);
    b.add("arch", room.id === "hall" || room.id === "orangery" ? "light" : "blue", x, spring - 0.19, z, radius - 0.1, rise - 0.075, 0.42, turn);
  }
  for (const side of [-1, 1]) {
    const [x, z] = at(cu + side * width * 0.078, (v0 + v1) / 2);
    b.box("blue", x, y1 - 0.11, z, turned ? depth - 0.3 : 0.04, 0.035, turned ? 0.04 : depth - 0.3);
  }
  // A room under another room closes its crown with a lid that fills the whole
  // void up to that room's floor: what stands above it is a floor, not the
  // sky, and a void between the two would show from outside as a slot into the
  // underground. Inset a little, so its faces stand inside the walls and never
  // on the face of the slab above.
  // The room above lays its slab (or the grounds their skirt) BELOW its floor
  // level, so the lid tops inside that slab, never at or above the floor.
  const cover = coverFloor(room, b.mansion);
  if (cover !== null && cover - SLAB_INSET_M > y1) b.box("wall", cx, (y1 + cover - SLAB_INSET_M) / 2, (z0 + z1) / 2, x1 - x0 - 0.08, cover - SLAB_INSET_M - y1, z1 - z0 - 0.08);
  // Oculi distinguish the quieter chambers. They hang above the exhibit envelope.
  if (["hall", "phototroph", "spectre", "greenhouse", "belvedere"].includes(room.id)) {
    const radius = room.id === "hall" ? 2.6 : 1.65;
    b.add("ring", "brass", cx, y1 - 0.48, (z0 + z1) / 2, radius, radius, 1.3, FLAT);
    b.add("ring", "light", cx, y1 - 0.49, (z0 + z1) / 2, radius - 0.08, radius - 0.08, 0.35, FLAT);
  }
  colonnade(b, spring);
  chandeliers(b);
}
let roofFinish: Material | undefined;
function roofMaterial(): Material {
  return roofFinish ??= new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
}

/** Columns along the long walls of the great rooms, clear of doors and hangings. */
function colonnade(b: Builder, spring: number): void {
  const room = b.room;
  if (!COLONNADED.includes(room.id)) return;
  const [, y0, z0] = room.bounds.min, [, , z1] = room.bounds.max;
  const height = spring - 0.42 - y0;
  if (height < 3) return;
  const bays = Math.max(2, Math.round((z1 - z0) / 4.6));
  for (const wall of walls(room).filter(w => w.axis === "x")) {
    const x = wall.at + wall.inward * 1.15;
    for (let i = 0; i <= bays; i++) {
      const z = z0 + 1.6 + (z1 - z0 - 3.2) * i / bays;
      if (doorNear(room, wall, z, 1.0) || hangingNear(room, wall, z, 0.9)) continue;
      b.add("column", "stone", x, y0 + height / 2 + 0.12, z, 0.3, height, 0.3);
      b.add("column", "brass", x, y0 + 0.07, z, 0.42, 0.14, 0.42);
      b.add("column", "brass", x, y0 + height + 0.2, z, 0.44, 0.16, 0.44);
      b.box("stone", x, y0 + height + 0.36, z, 0.9, 0.16, 0.9);
    }
  }
}

/** Halo chandeliers, one per bay of the great rooms, three tiers in the hall. */
function chandeliers(b: Builder): void {
  const room = b.room, [x0, , z0] = room.bounds.min, [x1, y1, z1] = room.bounds.max;
  const cx = (x0 + x1) / 2, depth = z1 - z0;
  if (room.id === "hall") {
    chandelier(b, cx, y1, (z0 + z1) / 2, 2.4, 3);
    return;
  }
  if (["gallery", "orangery", "world-engine", "einstruct", "phototroph", "belvedere", "foyer"].includes(room.id)) {
    const count = Math.max(1, Math.round(depth / 12));
    for (let i = 0; i < count; i++) chandelier(b, cx, y1, z0 + depth * (i + 0.5) / count, Math.min(1.6, (x1 - x0) * 0.09), 2);
    return;
  }
  if (b.area) {
    // One every twelve metres of the long way, a single tier: an area has
    // many rooms, and a low chamber hangs its halo just under the ribs.
    const length = b.turned ? x1 - x0 : depth, across = b.turned ? depth : x1 - x0;
    const count = Math.max(1, Math.round(length / 12));
    const drop = Math.min(1.5, Math.max(0.7, y1 - room.bounds.min[1] - 2.55));
    for (let i = 0; i < count; i++) {
      const v = (b.turned ? x0 : z0) + length * (i + 0.5) / count;
      chandelier(b, b.turned ? v : cx, y1, b.turned ? (z0 + z1) / 2 : v, Math.min(1.2, across * 0.13), 1, drop);
    }
  }
}
function chandelier(b: Builder, x: number, y1: number, z: number, radius: number, tiers: number, drop = 1.5): void {
  for (let i = 0; i < tiers; i++) {
    const y = y1 - drop + i * 0.32, r = radius - i * 0.34;
    b.add("halo", "brass", x, y, z, r, r, 0.85, FLAT);
    b.add("halo", "light", x, y - 0.055, z, r - 0.015, r - 0.015, 0.22, FLAT);
  }
  for (const dx of [-radius * 0.73, radius * 0.73]) b.bar("brass", new Vector3(x + dx, y1 - drop + 0.05, z), new Vector3(x + dx, y1 - 0.2, z), 0.018);
}

function chamberFloor(b: Builder): void {
  const [x0, y0, z0] = b.room.bounds.min, [x1, , z1] = b.room.bounds.max;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  b.box("floor", cx, y0 - 0.1, cz, x1 - x0, 0.2, z1 - z0);
  // A continuous central route gives the enfilade a direction without arrows.
  for (const side of [-1, 1]) {
    if (b.turned) b.box("brass", cx, y0 + 0.006, cz + side * 1.42, x1 - x0, 0.012, 0.025);
    else b.box("brass", cx + side * 1.42, y0 + 0.006, cz, 0.025, 0.012, z1 - z0);
  }
  for (let z = z0 + 2; z < z1; z += 2) b.box("joint", cx, y0 + 0.004, z, x1 - x0 - 0.32, 0.008, 0.012);
  for (let x = x0 + 2; x < x1; x += 2) b.box("joint", x, y0 + 0.004, cz, 0.012, 0.008, z1 - z0 - 0.32);
}

/** Abstract figures on plinths: a museum's statuary, without a face to misread. */
function figure(b: Builder, x: number, z: number): void {
  const y = b.ground(x, z);
  b.box("stone", x, y + 0.55, z, 0.9, 1.1, 0.9);
  b.box("brass", x, y + 1.11, z, 0.96, 0.03, 0.96);
  b.add("column", "stone", x, y + 1.95, z, 0.24, 1.6, 0.24);
  b.add("crown", "stone", x, y + 2.95, z, 0.28, 0.34, 0.28);
  b.add("ring", "brass", x, y + 3.02, z, 0.42, 0.42, 1.2, FLAT);
}

/** Statues between the cabinet doors of the gallery, and in the hall's corners. */
function statuary(b: Builder): void {
  const room = b.room, [x0, , z0] = room.bounds.min, [x1, , z1] = room.bounds.max;
  if (room.id === "gallery") {
    const wall = walls(room)[1]!;
    for (let z = z0 + 2.5; z < z1 - 5; z += 1) {
      if (doorNear(room, wall, z, 2.2) || hangingNear(room, wall, z, 1.2)) continue;
      figure(b, x1 - 1.3, z);
      z += 8;
    }
  }
  if (room.id === "hall") for (const x of [x0 + 1.6, x1 - 1.6]) for (const z of [z0 + 1.8, z1 - 1.8]) {
    if (walls(room).some(w => doorNear(room, w, w.axis === "x" ? z : x, 1.5) && Math.abs(w.at - (w.axis === "x" ? x : z)) < 2)) continue;
    figure(b, x, z);
  }
}

/** Faceted, brass-stemmed grove sculptures, kept away from the primary paths. */
function tree(b: Builder, x: number, z: number, height: number): void {
  const y = b.ground(x, z);
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
/** A brass post with a luminous lantern head. */
function lantern(b: Builder, x: number, z: number): void {
  const y = b.ground(x, z);
  b.add("column", "brass", x, y + 1.3, z, 0.06, 2.6, 0.06);
  b.add("column", "brass", x, y + 0.08, z, 0.22, 0.16, 0.22);
  b.box("light", x, y + 2.75, z, 0.26, 0.34, 0.26);
  b.box("brass", x, y + 2.96, z, 0.34, 0.06, 0.34);
}
/** A stone balustrade with urns on every fourth pier, gapped at the openings. */
function balustrade(b: Builder, wall: Wall, gaps: readonly { center: number; width: number }[]): void {
  const y = b.room.bounds.min[1];
  const at = wall.at + wall.inward * 0.28;
  const put = (finish: Finish, along: number, cy: number, length: number, height: number, thickness: number): void => {
    if (wall.axis === "x") b.box(finish, at, cy, along, thickness, height, length);
    else b.box(finish, along, cy, at, length, height, thickness);
  };
  const open = (along: number): boolean => gaps.some(g => Math.abs(along - g.center) < g.width / 2 + 0.2);
  let pier = 0;
  for (let along = wall.min + 0.4; along <= wall.max - 0.4; along += 2.5) {
    if (open(along)) continue;
    put("stone", along, y + 0.62, 0.34, 1.24, 0.34);
    if (pier++ % 4 === 0) {
      put("brass", along, y + 1.34, 0.4, 0.2, 0.4);
      b.add("crown", "stone", wall.axis === "x" ? at : along, y + 1.72, wall.axis === "x" ? along : at, 0.3, 0.42, 0.3);
    }
  }
  for (let along = wall.min + 0.4; along < wall.max - 0.4; along += 0.5) {
    if (open(along) || open(along + 0.5)) continue;
    put("stone", along + 0.25, y + 0.5, 0.09, 0.85, 0.09);
  }
  // The rail runs between the openings.
  let cursor = wall.min + 0.3;
  const stops = [...gaps].sort((a, c) => a.center - c.center);
  for (const gap of stops) {
    const left = gap.center - gap.width / 2 - 0.2;
    if (left > cursor) put("stone", (cursor + left) / 2, y + 1.06, left - cursor, 0.1, 0.22);
    cursor = Math.max(cursor, gap.center + gap.width / 2 + 0.2);
  }
  if (wall.max - 0.3 > cursor) put("stone", (cursor + wall.max - 0.3) / 2, y + 1.06, wall.max - 0.3 - cursor, 0.1, 0.22);
}

/**
 * The ground of a cell as a mesh over the height field: flat where the
 * parterre is, rolling under the groves, coloured by height and slope with
 * a grain, so the lie of the land reads without light.
 */
function terrainMesh(b: Builder): void {
  const room = b.room, [x0, y0, z0] = room.bounds.min, [x1, , z1] = room.bounds.max;
  const width = x1 - x0, depth = z1 - z0;
  const mounds = b.mansion?.terrain.mounds ?? [];
  const rolling = mounds.length > 0 && b.mansion !== null;
  const cell = rolling ? 2 : 8;
  const sx = Math.max(1, Math.ceil(width / cell)), sz = Math.max(1, Math.ceil(depth / cell));
  const geometry = new PlaneGeometry(width, depth, sx, sz);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const positions = geometry.getAttribute("position");
  const colors: number[] = [];
  const earth = new Color(OBSERVATORY_PALETTE.earth), grass = new Color(OBSERVATORY_PALETTE.grove);
  const tint = new Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    const h = rolling ? moundHeight(mounds, x, z) : 0;
    positions.setY(i, y0 + h - 0.02);
    const slope = rolling ? Math.hypot(moundHeight(mounds, x + 0.5, z) - h, moundHeight(mounds, x, z + 0.5) - h) : 0;
    const grain = 0.9 + 0.2 * hash2(Math.floor(x / 3), Math.floor(z / 3));
    // Lawn over earth: a third of the way to the grove green on the flat, greener up a slope and on a crown.
    tint.copy(earth).lerp(grass, Math.min(1, 0.38 + h * 0.14 + slope * 0.6)).multiplyScalar(grain);
    // The material multiplies its own earth colour in as well, which made the
    // lawn nearly black (the tint darkened twice); divide it out so what is
    // drawn is the tint that was designed.
    const base = material("earth", room.id).color;
    colors.push(tint.r / base.r, tint.g / base.g, tint.b / base.b);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material("earth", room.id));
  mesh.name = "observatory-ground";
  b.group.add(mesh);
  // The skirt: a slab below the field, so the cell has an edge from outside.
  b.box("earth", (x0 + x1) / 2, y0 - 0.6, (z0 + z1) / 2, width, 1.0, depth);
}
function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function grounds(b: Builder): void {
  const room = b.room, [x0, y0, z0] = room.bounds.min, [x1, , z1] = room.bounds.max;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, width = x1 - x0, depth = z1 - z0;
  terrainMesh(b);
  if (room.id === "terrace") {
    path(b, cx, cz, 4.8, depth);
    surrounds(b);
    for (let z = z0 + 5; z < z1 - 3; z += 8) {
      if (room.doorways.some(d => d.axis === "x" && Math.abs(d.center - z) < d.width / 2 + 0.5)) continue;
      for (const x of [x0 + 1.1, x1 - 0.65]) {
        b.add("column", "stone", x, y0 + 2.65, z, 0.18, 5.3, 0.18);
        b.add("column", "brass", x, y0 + 0.12, z, 0.32, 0.24, 0.32);
        b.box("light", x, y0 + 4.2, z, 0.20, 1.2, 0.20);
      }
      b.add("arch", "stone", cx + 0.22, y0 + 5.2, z, width / 2 - 0.88, 1.6, 4);
      b.add("arch", "blue", cx + 0.22, y0 + 5.14, z, width / 2 - 0.93, 1.6, 0.6);
    }
    // The balustrade along the garden edge, open where the garden stairs descend.
    const edge = walls(room)[0]!;
    balustrade(b, edge, room.doorways.filter(d => d.axis === "x" && Math.abs(d.at - edge.at) < 0.001).map(d => ({ center: d.center, width: d.width + 2 * STAIR_MARGIN })));
  } else if (room.id === "parterre") {
    // The portal court lies on the axis west of the crossing, on the far
    // side from the palace: a round of gravel ringed by water, the axis
    // walk crossing the water on two bridges, the armillary at its centre.
    const [px, , pz] = room.portals[0]?.position ?? [cx - 12, 0, 0];
    const court = 7;
    // The axis walk, from the terrace steps to the court and from the court on to the far grove; the cross walk.
    path(b, (px + court + x1) / 2, pz, x1 - (px + court), 6);
    path(b, (x0 + px - court) / 2, pz, px - court - x0, 6);
    path(b, cx, cz, 6, depth);
    // Walks from the terrace's two side stairs in to the cross walk.
    const sideWalks = room.doorways.filter(d => d.axis === "x" && Math.abs(d.at - x1) < 0.001 && Math.abs(d.center) > 8).map(d => d.center);
    for (const z of sideWalks) path(b, (cx + x1) / 2, z, x1 - cx, 4);
    // Four quarters edged in box hedge, each holding its grove of sculptures, ending short of the side walks.
    const quarterEnd = sideWalks.length ? Math.min(...sideWalks.map(Math.abs)) - 4.5 : Math.min(z1, -z0) - 3.5;
    for (const qx of [-1, 1]) for (const qz of [-1, 1]) {
      const hx0 = cx + qx * 4.5, hx1 = qx > 0 ? x1 - 3.5 : x0 + 3.5;
      // The quarters beyond the crossing stand back from the court; those before it edge the axis walk.
      const courtSide = Math.sign(px - cx) === qx;
      const hz0 = qz * (courtSide ? court + 2.5 : 4.5), hz1 = qz * quarterEnd;
      const hcx = (hx0 + hx1) / 2, hcz = (hz0 + hz1) / 2;
      const hw = Math.abs(hx1 - hx0), hd = Math.abs(hz1 - hz0);
      b.box("hedge", hcx, y0 + 0.32, hz0, hw, 0.64, 0.5);
      b.box("hedge", hcx, y0 + 0.32, hz1, hw, 0.64, 0.5);
      b.box("hedge", hx0, y0 + 0.32, hcz, 0.5, 0.64, hd);
      b.box("hedge", hx1, y0 + 0.32, hcz, 0.5, 0.64, hd);
      b.box("gravel", hcx, y0 + 0.004, hcz, hw - 0.6, 0.008, hd - 0.6);
      for (const tx of [hcx - hw * 0.25, hcx + hw * 0.25]) for (const tz of [hcz - hd * 0.25, hcz + hd * 0.25]) tree(b, tx, tz, 4.7);
    }
    // The crossing: a gravel round with a brass rose set flat in it, nothing to walk into.
    b.add("column", "gravel", cx, y0 + 0.004, cz, 6.5, 0.008, 6.5);
    b.add("ring", "brass", cx, y0 + 0.014, cz, 2.4, 2.4, 0.8, FLAT);
    b.add("ring", "brass", cx, y0 + 0.014, cz, 1.0, 1.0, 0.8, FLAT);
    // The court: water, a stone dais with a brass rim, and the bridges the axis walk crosses on.
    b.add("column", "gravel", px, y0 + 0.004, pz, court + 1.5, 0.008, court + 1.5);
    b.add("column", "water", px, y0 + 0.008, pz, court - 0.1, 0.012, court - 0.1);
    b.add("column", "stone", px, y0 + 0.06, pz, 5.4, 0.12, 5.4);
    b.add("ring", "brass", px, y0 + 0.125, pz, 5.32, 5.32, 1.0, FLAT);
    for (const side of [-1, 1]) {
      b.box("stone", px + side * (court - 0.9), y0 + 0.06, pz, 2.2, 0.12, 3.4);
      for (const edge of [-1, 1]) b.box("brass", px + side * (court - 0.9), y0 + 0.125, pz + edge * 1.68, 2.2, 0.012, 0.03);
    }
    // The armillary that holds the portal: three brass rings and a luminous one.
    for (const angle of [0, Math.PI / 3, -Math.PI / 3]) {
      b.add("ring", "brass", px, y0 + 5.2, pz, 2.3, 2.3, 1.6,
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle));
    }
    b.add("ring", "blue", px, y0 + 5.2, pz, 2.16, 2.16, 0.45, FLAT);
    // Lanterns round the court, and along the cross walk clear of the crossing.
    for (const ax of [-1, 1]) for (const az of [-1, 1]) lantern(b, px + ax * (court + 0.9) * 0.71, pz + az * (court + 0.9) * 0.71);
    for (let z = z0 + 6; z < z1 - 5; z += 12) for (const x of [cx - 3.6, cx + 3.6]) if (Math.abs(z) > 8 && !sideWalks.some(s => Math.abs(z - s) < 3)) lantern(b, x, z);
    for (const x of [x0 + 1.6, x1 - 1.6]) for (const z of [z0 + 1.6, z1 - 1.6]) obelisk(b, x, z);
  } else {
    // Rows of grove sculptures over the rolling ground, the rows running toward the palace.
    let index = 0;
    for (let x = x0 + 7; x <= x1 - 6; x += 9) for (let z = z0 + 7; z <= z1 - 6; z += 9) {
      if (Math.hypot(x - room.spawn.position[0], z - room.spawn.position[2]) < 5) continue;
      if (room.doorways.some(d => d.axis === "x" ? Math.abs(x - d.at) < 4 && Math.abs(z - d.center) < d.width / 2 : Math.abs(z - d.at) < 4 && Math.abs(x - d.center) < d.width / 2)) continue;
      tree(b, x + ((index * 7) % 5) * 0.3 - 0.6, z + ((index * 3) % 5) * 0.3 - 0.6, 4.3 + (index++ % 3) * 0.55);
    }
    for (const z of [cz - depth * 0.3, cz, cz + depth * 0.3]) lantern(b, cx, z);
  }
}
function obelisk(b: Builder, x: number, z: number): void {
  const y = b.ground(x, z);
  b.box("stone", x, y + 0.5, z, 1.4, 1.0, 1.4);
  b.add("column", "stone", x, y + 4.0, z, 0.36, 6.0, 0.36);
  b.add("crown", "light", x, y + 7.15, z, 0.3, 0.42, 0.3);
}

/** Everything of a room, placed but not yet meshed: the batches and the emitters. */
function plan(room: Room, mansion: Mansion | null): Builder {
  const b = new Builder(room, mansion);
  if (room.fallback.kind === "ground") grounds(b);
  else { chamberFloor(b); chamberWalls(b); cladding(b); vault(b); statuary(b); gameTables(b); venue(b); }
  flights(b);
  return b;
}

/** The cellar venue's fittings, by room (docs/specs/CLUB.md). */
function venue(b: Builder): void {
  if (b.room.id === "club") clubFittings(b);
  else if (b.room.id === "stage") stageFittings(b);
  else if (b.room.id === "foyer") foyerFittings(b);
}

/** A rotation about y: a box turned to run along z instead of x, a ring turned to face along x. */
const ALONG_Z = /* @__PURE__ */ new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);

/**
 * The club under the north wing (its lid is the vault's, `covered`): a dance floor of neon tiles
 * before the stage under a mirror ball, two trusses of colour along the
 * vault, a bar down the east wall by the foyer door, booths along the west,
 * the DJ's desk and stacks beside the stage, and the proscenium's frame. The
 * lamps are the room's own light and blue, so the bake lights the walls
 * from them and the pulse tints them (tintLuminous).
 */
function clubFittings(b: Builder): void {
  const room = b.room, [x0, y0, z0] = room.bounds.min, [x1, y1, z1] = room.bounds.max;
  const cx = (x0 + x1) / 2;
  // The dance floor, eight metres before the stage: a dark deck, a brass edge, a checker of neon tiles.
  const fz0 = z0 + 8, fz1 = fz0 + 16, fcz = (fz0 + fz1) / 2;
  b.box("inset", cx, y0 + 0.02, fcz, 12.4, 0.04, 16.4);
  for (const side of [-1, 1]) {
    b.box("brass", cx + side * 6.2, y0 + 0.045, fcz, 0.06, 0.01, 16.4);
    b.box("brass", cx, y0 + 0.045, fcz + side * 8.2, 12.4, 0.01, 0.06);
  }
  for (let i = 0; i < 6; i++) for (let j = 0; j < 8; j++) {
    b.box((i + j) % 2 === 0 ? "neon" : "joint", cx - 5 + i * 2, y0 + 0.046, fz0 + 1 + j * 2, 1.7, 0.012, 1.7);
  }
  // The mirror ball over its centre, hung from the lid, ringed with light.
  const ballY = y1 - 1.7;
  b.add("crown", "stone", cx, ballY, fcz, 0.75, 0.75, 0.75);
  b.add("ring", "light", cx, ballY, fcz, 1.0, 1.0, 0.8, FLAT);
  b.bar("brass", new Vector3(cx, ballY + 0.7, fcz), new Vector3(cx, y1, fcz), 0.02);
  // Two trusses along the vault, each carrying four lines of colour that alternate with the other's.
  const tz0 = z0 + 4, tz1 = z1 - 4, segments = 4, length = (tz1 - tz0) / segments;
  for (const side of [-1, 1]) {
    const x = cx + side * 4.5, y = y1 - 0.9;
    b.bar("brass", new Vector3(x, y, tz0), new Vector3(x, y, tz1), 0.05);
    for (let i = 0; i < segments; i++) {
      b.box((i + (side > 0 ? 0 : 1)) % 2 === 0 ? "light" : "blue", x, y - 0.06, tz0 + length * (i + 0.5), 0.07, 0.05, length - 0.6);
    }
    for (let z = tz0; z <= tz1 + 0.01; z += 10) b.bar("brass", new Vector3(x, y, z), new Vector3(x, y1, z), 0.015);
  }
  // The bar down the east wall: counter, foot rail, stools, and a lit back-bar case.
  const bz0 = z1 - 22, bz1 = z1 - 13, bcz = (bz0 + bz1) / 2, blen = bz1 - bz0, bx = x1 - 1.9;
  b.box("stone", bx, y0 + 0.55, bcz, 0.7, 1.1, blen);
  b.box("brass", bx, y0 + 1.12, bcz, 0.85, 0.04, blen + 0.1);
  b.box("inset", bx - 0.36, y0 + 0.5, bcz, 0.02, 0.9, blen - 0.2);
  b.bar("brass", new Vector3(bx - 0.5, y0 + 0.22, bz0), new Vector3(bx - 0.5, y0 + 0.22, bz1), 0.02);
  for (let z = bz0 + 0.9; z < bz1 - 0.5; z += 1.5) {
    b.add("column", "stone", bx - 1.1, y0 + 0.36, z, 0.17, 0.72, 0.17);
    b.add("column", "brass", bx - 1.1, y0 + 0.73, z, 0.19, 0.02, 0.19);
  }
  b.box("inset", x1 - 0.45, y0 + 1.9, bcz, 0.4, 2.6, blen);
  for (const y of [y0 + 1.3, y0 + 2.2, y0 + 3.0]) b.box("light", x1 - 0.5, y, bcz, 0.25, 0.03, blen - 0.4);
  // Booths along the west wall, clear of the foyer's doors: a bench, a table on a brass stem, a lamp hung over it.
  for (let z = z1 - 14; z > fz1 + 3; z -= 6) {
    if (doorNear(room, walls(room)[0]!, z, 1.7)) continue;
    const x = x0 + 1.0;
    b.box("stone", x, y0 + 0.25, z, 0.6, 0.5, 3.0);
    b.box("inset", x + 0.05, y0 + 0.6, z, 0.5, 0.2, 3.0);
    b.add("column", "brass", x + 1.3, y0 + 0.4, z, 0.06, 0.8, 0.06);
    b.add("column", "stone", x + 1.3, y0 + 0.81, z, 0.55, 0.03, 0.55);
    b.box("light", x + 1.3, y0 + 1.5, z, 0.16, 0.22, 0.16);
    b.bar("brass", new Vector3(x + 1.3, y0 + 1.62, z), new Vector3(x + 1.3, y1, z), 0.012);
  }
  // The DJ's desk beside the stage on the west, facing the floor across the apron, and a wall of sound behind it.
  const dx = x0 + 2.2, dz = z0 + 4.5;
  b.add("box", "stone", dx, y0 + 0.5, dz, 3.2, 1.0, 0.9, ALONG_Z);
  b.add("box", "brass", dx, y0 + 1.02, dz, 3.3, 0.04, 1.0, ALONG_Z);
  b.add("box", "light", dx + 0.47, y0 + 0.5, dz, 3.0, 0.05, 0.02, ALONG_Z);
  for (const z of [dz - 2.2, dz + 2.2]) {
    b.box("inset", x0 + 0.75, y0 + 1.2, z, 1.1, 2.4, 1.4);
    for (const y of [y0 + 0.5, y0 + 1.2, y0 + 1.9]) b.add("ring", "blue", x0 + 1.32, y, z, 0.42, 0.42, 0.6, ALONG_Z);
  }
  // Speaker stacks at the stage's mouth, and the proscenium's frame, which the plain surrounds skip for so wide an opening.
  const stage = room.doorways.find(d => d.width > 8);
  if (stage) {
    const top = b.doorBase(stage) + stage.height, half = stage.width / 2;
    // The apron's flight stands in front of the frame: its strips start above the parapet.
    const apron = b.doorBase(stage) - y0 + 0.95 + 0.1;
    for (const side of [-1, 1]) {
      const x = cx + side * (half + 2.2), z = z0 + 1.2;
      b.box("inset", x, y0 + 1.5, z, 1.6, 3.0, 1.6);
      b.box("brass", x, y0 + 3.02, z, 1.7, 0.04, 1.7);
      for (const y of [y0 + 0.6, y0 + 1.5, y0 + 2.4]) b.add("ring", "blue", x, y, z + 0.81, 0.5, 0.5, 0.6);
      b.box("stone", cx + side * (half + 0.85), (y0 + top) / 2, z0 + 0.3, 0.7, top - y0, 0.5);
      b.box("light", cx + side * (half + 0.47), (y0 + apron + top) / 2, z0 + 0.3, 0.05, top - y0 - apron, 0.05);
    }
    b.box("stone", cx, top + 0.35, z0 + 0.3, stage.width + 2.4, 0.7, 0.5);
    b.box("neon", cx, top + 0.02, z0 + 0.32, stage.width + 0.2, 0.05, 0.05);
  }
}

/**
 * The stage: footlights along its edge, the singer's
 * microphone stand, a dark word wall at the back framed in neon (the lyrics'
 * place when the karaoke link exists), and a short truss of cans.
 */
function stageFittings(b: Builder): void {
  const room = b.room, [x0, y0, z0] = room.bounds.min, [x1, y1, z1] = room.bounds.max;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, width = x1 - x0;
  b.box("brass", cx, y0 + 0.05, z1 - 0.25, width - 2.4, 0.1, 0.2);
  b.box("light", cx, y0 + 0.11, z1 - 0.25, width - 2.6, 0.03, 0.12);
  b.add("column", "brass", cx, y0 + 0.02, cz + 0.5, 0.25, 0.04, 0.25);
  b.add("column", "brass", cx, y0 + 0.8, cz + 0.5, 0.02, 1.6, 0.02);
  b.add("column", "stone", cx, y0 + 1.62, cz + 0.5, 0.05, 0.14, 0.05);
  b.box("inset", cx, y0 + 2.3, z0 + 0.42, width - 4, 3.0, 0.08);
  for (const y of [y0 + 0.75, y0 + 3.85]) b.box("neon", cx, y, z0 + 0.42, width - 3.8, 0.05, 0.05);
  for (const side of [-1, 1]) b.box("neon", cx + side * (width / 2 - 1.9), y0 + 2.3, z0 + 0.42, 0.05, 3.15, 0.05);
  const trussY = y1 - 1.0, trussZ = z1 - 1.5, reach = width / 2 - 1.8;
  b.bar("brass", new Vector3(cx - reach, trussY, trussZ), new Vector3(cx + reach, trussY, trussZ), 0.05);
  for (let i = 0; i < 5; i++) {
    const x = cx - reach + 0.4 + (2 * reach - 0.8) * i / 4;
    b.box("brass", x, trussY - 0.25, trussZ, 0.22, 0.3, 0.22);
    b.box(i % 2 === 0 ? "light" : "blue", x, trussY - 0.42, trussZ, 0.18, 0.04, 0.18);
  }
}

/** The foyer, the undercroft under the terrace: a lantern either side of each of the club's doors. */
function foyerFittings(b: Builder): void {
  const room = b.room, [, , z0] = room.bounds.min, [x1, , z1] = room.bounds.max;
  for (const door of room.doorways.filter(d => d.to === "club")) {
    for (const side of [-1, 1]) {
      const z = door.center + side * (door.width / 2 + 0.6);
      if (z > z0 + 0.6 && z < z1 - 0.6) lantern(b, x1 - 0.6, z);
    }
  }
}

/**
 * A table for every game surface that has a place in the room (the
 * orangery's chess, ruled 2026-09-16): a stone pedestal under a brass-rimmed
 * top with the board inlaid, two stools facing each other across it along
 * the table's x axis, and a lamp hung over it. main.ts offers the game when
 * the visitor stands at it; the board is a place, not a position.
 */
function gameTables(b: Builder): void {
  for (const surface of b.room.gameSurfaces) {
    if (!surface.position) continue;
    const [x, , z] = surface.position;
    const y = b.ground(x, z);
    const turn = new Quaternion().setFromAxisAngle(UNIT, surface.yawDeg * Math.PI / 180);
    const along = new Vector3(1, 0, 0).applyQuaternion(turn);
    b.add("column", "stone", x, y + 0.04, z, 0.42, 0.08, 0.42);
    b.add("column", "stone", x, y + 0.4, z, 0.2, 0.72, 0.2);
    b.add("box", "brass", x, y + 0.775, z, 1.12, 0.05, 1.12, turn);
    b.add("box", "inset", x, y + 0.806, z, 1.0, 0.012, 1.0, turn);
    // The board: eight by eight, the pale squares laid over the dark inlay.
    const square = 0.11;
    for (let file = 0; file < 8; file++) for (let rank = 0; rank < 8; rank++) {
      if ((file + rank) % 2 === 1) continue;
      const local = new Vector3((file - 3.5) * square, 0, (rank - 3.5) * square).applyQuaternion(turn);
      b.add("box", "stone", x + local.x, y + 0.815, z + local.z, square - 0.006, 0.006, square - 0.006, turn);
    }
    for (const side of [-1, 1]) {
      const sx = x + along.x * 0.95 * side, sz = z + along.z * 0.95 * side;
      b.add("column", "stone", sx, y + 0.24, sz, 0.19, 0.48, 0.19);
      b.add("column", "brass", sx, y + 0.49, sz, 0.2, 0.02, 0.2);
    }
    b.add("halo", "brass", x, y + 2.3, z, 0.5, 0.5, 0.7, FLAT);
    b.add("halo", "light", x, y + 2.25, z, 0.48, 0.48, 0.25, FLAT);
    b.bar("brass", new Vector3(x, y + 2.35, z), new Vector3(x, b.room.bounds.max[1] - 0.05, z), 0.015);
  }
}

export function buildObservatory(room: Room, mansion: Mansion | null = null): RoomShell {
  if (mansion) ensureLightField(mansion);
  followPulse(room);
  const b = plan(room, mansion);
  const group = b.finish();
  return {
    group,
    provenance: {
      source: "Designed procedural architecture",
      generator: "grove/src/world/observatory.ts",
      design: "Nocturne research palace",
      materials: "Vertex-shaded mineral, brass, luminous architectural inlays",
      lighting: "A light field baked at build time from the architecture's own lamps and the portals (lightfield.ts); no lightmap, no scene lights",
      scientific_content: false,
      note: "The building, the grounds and the grove sculptures are architecture. Research exhibits retain their independent source records.",
      units: "metres",
      floor_m: room.bounds.min[1],
      architecture_batches: group.children.length,
      emitters: b.emitters.length,
    },
    lightmap: null,
    markers: { doors: new Map(), posters: new Map() },
  };
}
