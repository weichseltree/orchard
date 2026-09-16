import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { Font, type FontData } from "three/examples/jsm/loaders/FontLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Doorway, Mansion, Room } from "./schema";
import type { Labels } from "./labels/index";
import { OBSERVATORY_PALETTE } from "./observatory";

// The name over every door, in brass letters standing off the lintel: the
// room the door leads to, as the visitor reads it in their language, or its
// repository's name when it has no wall text yet (the sealed doors). The
// letters are extruded from Cinzel (fonts/cinzel.json, SIL Open Font
// License) and merged into one mesh per room, so a room's signs cost one
// draw. A title the font cannot set (Japanese) falls back to the room's
// identifier, which is Latin.

/** The letters: cap height, depth, and how far off the wall the lintel's face stands (observatory.ts's surrounds). */
export const SIGN = { size: 0.2, depth: 0.045, lintelFace: 0.4, lift: 0.28, standoff: 0.004 } as const;

export interface DoorSign {
  /** The title as the visitor reads it. */
  text: string;
  /** What to set when the font lacks a glyph of `text`. */
  fallback: string;
  /** The centre of the letters, on the lintel's face. */
  position: Vector3;
  /** Local +z out of the wall into the room, local +y up. */
  quaternion: Quaternion;
  /** The lintel's length: letters wider than this are scaled to fit. */
  maxWidth: number;
  to: string;
}

const UP = new Vector3(0, 1, 0);
const OUT = new Vector3(0, 0, 1);

/** Whether a doorway carries a sign: the ones with surrounds, not the grounds' broad gates. */
export function signed(room: Room, door: Doorway): boolean {
  return door.width <= 8 && door.height < room.bounds.max[1] - room.bounds.min[1];
}

/** The floor a doorway opens at: the higher of the two rooms it joins (observatory.ts's doorBase). */
function doorBase(room: Room, door: Doorway, mansion: Mansion): number {
  const base = room.bounds.min[1];
  const neighbour = mansion.rooms.find((r) => r.id === door.to);
  return neighbour && !door.closed ? Math.max(base, neighbour.bounds.min[1]) : base;
}

/** Every door sign of a room, placed. Pure: no font, no three.js scene. */
export function planDoorSigns(room: Room, labels: Labels | null, mansion: Mansion): DoorSign[] {
  const out: DoorSign[] = [];
  const [x0, , z0] = room.bounds.min, [x1, , z1] = room.bounds.max;
  for (const door of room.doorways) {
    if (!signed(room, door)) continue;
    const inward = door.axis === "x" ? (Math.abs(door.at - x0) < 0.001 ? 1 : Math.abs(door.at - x1) < 0.001 ? -1 : 0)
      : (Math.abs(door.at - z0) < 0.001 ? 1 : Math.abs(door.at - z1) < 0.001 ? -1 : 0);
    if (inward === 0) continue;
    const y = doorBase(room, door, mansion) + door.height + SIGN.lift;
    const across = door.at + inward * (SIGN.lintelFace + SIGN.standoff);
    const position = door.axis === "x" ? new Vector3(across, y, door.center) : new Vector3(door.center, y, across);
    const normal = door.axis === "x" ? new Vector3(inward, 0, 0) : new Vector3(0, 0, inward);
    const quaternion = new Quaternion().setFromUnitVectors(OUT, normal);
    const title = labels?.rooms[door.to]?.title?.trim();
    out.push({ text: title || door.to, fallback: door.to, position, quaternion, maxWidth: door.width + 0.8, to: door.to });
  }
  return out;
}

let fontPromise: Promise<Font> | null = null;
/** The typeface, loaded once and only when a room's signs are first built. */
export function fontOnce(): Promise<Font> {
  return (fontPromise ??= import("./fonts/cinzel.json").then((module) => new Font(module.default as unknown as FontData)));
}

/** Whether the font sets every character of `text`. */
export function canSet(font: Font, text: string): boolean {
  const glyphs = (font.data as { glyphs: Record<string, unknown> }).glyphs;
  return [...text].every((c) => c === " " || c in glyphs);
}

let brass: MeshBasicMaterial | null = null;
function signMaterial(): MeshBasicMaterial {
  return (brass ??= new MeshBasicMaterial({ color: OBSERVATORY_PALETTE.brass, vertexColors: true }));
}

/** Fixed face shading: the faces toward the reader bright, the returns dark, so the letters read without a light. */
function shadeLetters(geometry: BufferGeometry): void {
  const normals = geometry.getAttribute("normal");
  const colours: number[] = [];
  for (let i = 0; i < normals.count; i++) {
    const shade = 0.55 + 0.45 * Math.max(0, normals.getZ(i)) + 0.12 * Math.max(0, normals.getY(i));
    colours.push(shade, shade, shade);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
}

/** The extrusion's back cap lies against the lintel and is never seen: it goes. */
function withoutBackCap(geometry: BufferGeometry): BufferGeometry {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const keep: number[] = [];
  for (let tri = 0; tri < position.count / 3; tri++) {
    const i = tri * 3;
    if (normal.getZ(i) + normal.getZ(i + 1) + normal.getZ(i + 2) > -1.5) keep.push(i, i + 1, i + 2);
  }
  const out = new BufferGeometry();
  const pick = (attribute: typeof position, size: number) => {
    const array = new Float32Array(keep.length * size);
    keep.forEach((from, to) => { for (let c = 0; c < size; c++) array[to * size + c] = attribute.array[from * size + c]!; });
    return new Float32BufferAttribute(array, size);
  };
  out.setAttribute("position", pick(position, 3));
  out.setAttribute("normal", pick(normal, 3));
  if (uv) out.setAttribute("uv", pick(uv, 2));
  geometry.dispose();
  return out;
}

/** The letters of one sign, in the sign's frame: centred, facing +z, no wider than the lintel. */
export function letterGeometry(sign: DoorSign, font: Font): BufferGeometry {
  const text = canSet(font, sign.text) ? sign.text : sign.fallback;
  // Two segments per curve: at a cap height of 0.2 m the letters read as
  // drawn, and the whole palace's signs stay a fraction of the architecture.
  const extruded = new TextGeometry(text, { font, size: SIGN.size, depth: SIGN.depth, curveSegments: 2, bevelEnabled: false });
  const geometry = withoutBackCap(extruded);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const width = box.max.x - box.min.x;
  geometry.translate(-(box.max.x + box.min.x) / 2, -(box.max.y + box.min.y) / 2, 0);
  const fit = sign.maxWidth - 0.3;
  if (width > fit) geometry.scale(fit / width, fit / width, 1);
  shadeLetters(geometry);
  return geometry;
}

/** A room's signs as one mesh. `userData.dispose` releases it, the way labels.ts's plaques do. */
export function buildDoorSigns(room: Room, signs: readonly DoorSign[], font: Font): Group {
  const group = new Group();
  group.name = `door-signs-${room.id}`;
  const parts: BufferGeometry[] = [];
  for (const sign of signs) {
    const letters = letterGeometry(sign, font);
    letters.applyQuaternion(sign.quaternion);
    letters.translate(sign.position.x, sign.position.y, sign.position.z);
    parts.push(letters);
  }
  const merged = parts.length ? mergeGeometries(parts, false) : null;
  for (const part of parts) part.dispose();
  if (merged) {
    const mesh = new Mesh(merged, signMaterial());
    mesh.name = "door-signs";
    mesh.userData = { signs: signs.map((s) => s.to) };
    group.add(mesh);
  }
  group.userData = { signs: signs.length, dispose: () => merged?.dispose() };
  void UP;
  return group;
}
