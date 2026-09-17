import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import earcut from "earcut";
import type { Doorway, Mansion, Room } from "./schema";
import type { Labels } from "./labels/index";
import { OBSERVATORY_PALETTE, finishColour } from "./observatory";

// The name over every door, standing off the lintel's stone band: the
// room the door leads to, as the visitor reads it in their language, or its
// repository's name when it has no wall text yet (the sealed doors). The
// letters are extruded here from Cinzel's outlines (fonts/cinzel.json, SIL
// Open Font License, made by grove/tools/typeface.py) and merged into one
// mesh per room, so a room's signs cost one draw. A title the font cannot
// set (Japanese) falls back to the room's identifier, which is Latin.
//
// The extrusion is this module's own rather than three's TextGeometry: three
// ships as one module, so its shape, curve and extrusion classes would be
// tree-shaken into the startup chunk for a feature that loads lazily. The
// triangulator is earcut, the same one three carries, as its own small
// dependency of this chunk.

/**
 * The letters: cap height, depth, how far off the wall the lintel's face
 * stands (observatory.ts's surrounds), and the gap over the door, as a share
 * of the cap height. 0.4 m reads from across a chamber (raised from 0.2 on
 * 2026-09-16); a low room scales them to its headroom (`signSize`).
 */
export const SIGN = { size: 0.38, depth: 0.05, lintelFace: 0.4, band: 0.24, standoff: 0.004 } as const;

/**
 * The cap height a door's sign gets: the full size where the ceiling allows,
 * less over a door close under it (arcedit's chambers). The letters sit on
 * the lintel's own stone band, which is 0.44 m deep and centred 0.28 m over
 * the opening (observatory.ts's `surrounds`); they are set 0.24 m over the
 * opening, nearly filling that band. Letters over the band floated against
 * the dark wall above it, and a smaller cap read as timid (ruled
 * 2026-09-17).
 */
export function signSize(headroom: number): number {
  return Math.min(SIGN.size, headroom * 0.4);
}

/** One glyph of a typeface file: its advance and outline in a 1000-unit em, as FontLoader reads them. */
export interface Glyph {
  ha: number;
  o?: string;
}
export interface Typeface {
  glyphs: Record<string, Glyph>;
  resolution: number;
  familyName?: string;
}

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
  /** Cap height, metres. */
  size: number;
  to: string;
}

const OUT = new Vector3(0, 0, 1);

/**
 * Whether a doorway carries a sign: the ones with surrounds, not the
 * grounds' broad gates, and not one whose head stands at the room's own
 * ceiling, where there is no lintel to letter (the sunken court's doors up
 * to the terrace open at the level of its rim).
 */
export function signed(room: Room, door: Doorway, mansion?: Mansion): boolean {
  if (door.width > 8 || door.height >= room.bounds.max[1] - room.bounds.min[1]) return false;
  const base = mansion ? doorBase(room, door, mansion) : room.bounds.min[1];
  return base + door.height + SIGN.band + SIGN.size / 2 <= room.bounds.max[1];
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
    if (!signed(room, door, mansion)) continue;
    const inward = door.axis === "x" ? (Math.abs(door.at - x0) < 0.001 ? 1 : Math.abs(door.at - x1) < 0.001 ? -1 : 0)
      : (Math.abs(door.at - z0) < 0.001 ? 1 : Math.abs(door.at - z1) < 0.001 ? -1 : 0);
    if (inward === 0) continue;
    const top = doorBase(room, door, mansion) + door.height;
    const size = signSize(room.bounds.max[1] - top);
    // On the lintel's band, not floating over it.
    const y = top + SIGN.band;
    const across = door.at + inward * (SIGN.lintelFace + SIGN.standoff);
    const position = door.axis === "x" ? new Vector3(across, y, door.center) : new Vector3(door.center, y, across);
    const normal = door.axis === "x" ? new Vector3(inward, 0, 0) : new Vector3(0, 0, inward);
    const quaternion = new Quaternion().setFromUnitVectors(OUT, normal);
    // A door may name what lies beyond the room it opens on: the stairs down
    // are signed for the club, since no one walks down for the stair's own
    // sake (Manuel, 2026-09-17).
    const names = door.signRoom || door.to;
    const title = labels?.rooms[names]?.title?.trim();
    out.push({ text: title || names, fallback: names, position, quaternion, maxWidth: door.width + 0.8, size, to: door.to });
  }
  return out;
}

let fontPromise: Promise<Typeface> | null = null;
/** The typeface, loaded once and only when a room's signs are first built. */
export function fontOnce(): Promise<Typeface> {
  return (fontPromise ??= import("./fonts/cinzel.json").then((module) => module.default as unknown as Typeface));
}

/** Whether the typeface sets every character of `text`. */
export function canSet(font: Typeface, text: string): boolean {
  return [...text].every((c) => c === " " || c in font.glyphs);
}

const inks = new Map<string, MeshBasicMaterial>();
/**
 * Dark letters on the lit stone of a lintel indoors, in the room's OWN deep
 * inset colour, since its stone is its own too (spectre's is nearly black);
 * brass letters in the open air, where a door has no band behind it and the
 * night is the only ground. Brass indoors (2026-09-16) was pale on a pale
 * band (ruled 2026-09-17).
 */
function signMaterial(roomId: string, outdoors: boolean): MeshBasicMaterial {
  const colour = outdoors ? OBSERVATORY_PALETTE.light : finishColour(roomId, "inset");
  let material = inks.get(colour);
  if (!material) inks.set(colour, (material = new MeshBasicMaterial({ color: colour, vertexColors: true })));
  return material;
}

/** A closed outline of a glyph, flattened: x, y pairs in the sign's metres. */
type Contour = number[];

/** Segments a curve is drawn with: three at a cap height of 0.32 m read as drawn. */
const CURVE_SEGMENTS = 3;

/**
 * A glyph's outline as contours, the curves flattened. The path is the
 * typeface file's: m/l absolute moves and lines, q a quadratic and b a cubic
 * Bézier, z closing a contour.
 */
export function glyphContours(glyph: Glyph, scale: number): Contour[] {
  const contours: Contour[] = [];
  if (!glyph.o) return contours;
  const tokens = glyph.o.split(" ");
  let current: Contour | null = null;
  let x = 0, y = 0;
  const read = (i: number) => Number(tokens[i]) * scale;
  const close = () => {
    if (current && current.length >= 6) {
      // The path's closing point repeats the first; drop it.
      const n = current.length;
      if (Math.abs(current[0]! - current[n - 2]!) < 1e-9 && Math.abs(current[1]! - current[n - 1]!) < 1e-9) current.length = n - 2;
      if (current.length >= 6) contours.push(current);
    }
    current = null;
  };
  for (let i = 0; i < tokens.length;) {
    const op = tokens[i];
    if (op === "m") { close(); x = read(i + 1); y = read(i + 2); current = [x, y]; i += 3; }
    else if (op === "l") { x = read(i + 1); y = read(i + 2); current?.push(x, y); i += 3; }
    else if (op === "q") {
      const cx = read(i + 1), cy = read(i + 2), x1 = read(i + 3), y1 = read(i + 4);
      for (let s = 1; s <= CURVE_SEGMENTS; s++) {
        const t = s / CURVE_SEGMENTS, u = 1 - t;
        current?.push(u * u * x + 2 * u * t * cx + t * t * x1, u * u * y + 2 * u * t * cy + t * t * y1);
      }
      x = x1; y = y1; i += 5;
    } else if (op === "b") {
      const c1x = read(i + 1), c1y = read(i + 2), c2x = read(i + 3), c2y = read(i + 4), x1 = read(i + 5), y1 = read(i + 6);
      for (let s = 1; s <= CURVE_SEGMENTS; s++) {
        const t = s / CURVE_SEGMENTS, u = 1 - t;
        current?.push(
          u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1,
          u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1,
        );
      }
      x = x1; y = y1; i += 7;
    } else if (op === "z") { close(); i += 1; }
    else i += 1;
  }
  close();
  return contours;
}

function signedArea(c: Contour): number {
  let a = 0;
  for (let i = 0, n = c.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += c[i]! * c[j + 1]! - c[j]! * c[i + 1]!;
  }
  return a / 2;
}

function contains(outer: Contour, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, n = outer.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = outer[i]!, yi = outer[i + 1]!, xj = outer[j]!, yj = outer[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Triangles of one glyph's outlines, each outer contour with the holes it contains, as flat x, y triples. */
function capTriangles(contours: Contour[]): { vertices: number[]; indices: number[] }[] {
  // TrueType outers run clockwise (negative area with y up), holes the other way; a
  // contour inside another of the opposite sense is its hole.
  const outers = contours.filter((c) => signedArea(c) < 0);
  const holes = contours.filter((c) => signedArea(c) >= 0);
  return outers.map((outer) => {
    const mine = holes.filter((h) => contains(outer, h[0]!, h[1]!));
    const vertices = [...outer];
    const holeIndices: number[] = [];
    for (const h of mine) {
      holeIndices.push(vertices.length / 2);
      vertices.push(...h);
    }
    return { vertices, indices: earcut(vertices, holeIndices.length ? holeIndices : undefined, 2) };
  });
}

/**
 * The letters of a text extruded: front caps toward +z at `depth`, sides
 * round every contour, no back cap (it lies against the lintel). Positions
 * and normals, non-indexed, in metres, baseline at y = 0, starting at x = 0.
 */
export function extrudeText(text: string, font: Typeface, size: number, depth: number): { position: number[]; normal: number[] } {
  const scale = size / font.resolution;
  const position: number[] = [], normal: number[] = [];
  let pen = 0;
  for (const c of text) {
    const glyph = font.glyphs[c] ?? (c === " " ? { ha: font.resolution * 0.3 } : undefined);
    if (!glyph) continue;
    const contours = glyphContours(glyph, scale).map((k) => k.map((v, i) => (i % 2 === 0 ? v + pen : v)));
    for (const { vertices, indices } of capTriangles(contours)) {
      for (const i of indices) {
        position.push(vertices[i * 2]!, vertices[i * 2 + 1]!, depth);
        normal.push(0, 0, 1);
      }
    }
    for (const k of contours) {
      for (let i = 0, n = k.length; i < n; i += 2) {
        const j = (i + 2) % n;
        const ax = k[i]!, ay = k[i + 1]!, bx = k[j]!, by = k[j + 1]!;
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
        // The unfilled side is to the left of travel for both senses: a
        // clockwise outer has the letter on its right, a counter-clockwise
        // hole has the letter on its right too. The quads are wound so their
        // geometric normal is that same left, since the material culls backs.
        const nx = -dy / len, ny = dx / len;
        position.push(ax, ay, 0, bx, by, depth, bx, by, 0, ax, ay, 0, ax, ay, depth, bx, by, depth);
        for (let v = 0; v < 6; v++) normal.push(nx, ny, 0);
      }
    }
    pen += glyph.ha * scale;
  }
  return { position, normal };
}

/**
 * Fixed face shading, so the letters read without a light of their own: cut
 * letters take the band's light on their returns and stay dark on the face,
 * brass ones the other way round.
 */
function shadeLetters(geometry: BufferGeometry, outdoors: boolean): void {
  const normals = geometry.getAttribute("normal");
  const colours: number[] = [];
  for (let i = 0; i < normals.count; i++) {
    const face = Math.max(0, normals.getZ(i)), up = Math.max(0, normals.getY(i));
    const shade = outdoors ? 0.72 + 0.28 * face + 0.1 * up : 2.2 - 1.2 * face - 0.4 * up;
    colours.push(shade, shade, shade);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
}

/** The letters of one sign, in the sign's frame: centred, facing +z, no wider than the lintel. */
export function letterGeometry(sign: DoorSign, font: Typeface, outdoors = false): BufferGeometry {
  const text = canSet(font, sign.text) ? sign.text : sign.fallback;
  const { position, normal } = extrudeText(text, font, sign.size, SIGN.depth);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const width = box.max.x - box.min.x;
  geometry.translate(-(box.max.x + box.min.x) / 2, -(box.max.y + box.min.y) / 2, 0);
  const fit = sign.maxWidth - 0.3;
  if (width > fit) geometry.scale(fit / width, fit / width, 1);
  shadeLetters(geometry, outdoors);
  return geometry;
}

/** A room's signs as one mesh. `userData.dispose` releases it, the way labels.ts's plaques do. */
export function buildDoorSigns(room: Room, signs: readonly DoorSign[], font: Typeface): Group {
  const group = new Group();
  group.name = `door-signs-${room.id}`;
  // A room open to the sky has no lintel band to cut into.
  const outdoors = room.fallback.kind === "ground";
  const position: number[] = [], normal: number[] = [], color: number[] = [];
  for (const sign of signs) {
    const letters = letterGeometry(sign, font, outdoors);
    letters.applyQuaternion(sign.quaternion);
    letters.translate(sign.position.x, sign.position.y, sign.position.z);
    position.push(...(letters.getAttribute("position").array as Float32Array));
    normal.push(...(letters.getAttribute("normal").array as Float32Array));
    color.push(...(letters.getAttribute("color").array as Float32Array));
    letters.dispose();
  }
  let merged: BufferGeometry | null = null;
  if (position.length) {
    merged = new BufferGeometry();
    merged.setAttribute("position", new Float32BufferAttribute(position, 3));
    merged.setAttribute("normal", new Float32BufferAttribute(normal, 3));
    merged.setAttribute("color", new Float32BufferAttribute(color, 3));
    const mesh = new Mesh(merged, signMaterial(room.id, outdoors));
    mesh.name = "door-signs";
    mesh.userData = { signs: signs.map((s) => s.to) };
    group.add(mesh);
  }
  group.userData = { signs: signs.length, dispose: () => merged?.dispose() };
  return group;
}
