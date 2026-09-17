import {
  BoxGeometry,
  CanvasTexture,
  Euler,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import { wrap } from "../ui/worldnotice";
import { OBSERVATORY_PALETTE } from "./observatory";
import { STAND, standFoot, standFrame } from "./stand";
import type { Labels } from "./labels/index";
import type { Doorway, Hanging, Mansion, Room } from "./schema";

// Museum wall text, in the room. One introduction panel by the doorway a
// visitor most likely enters through, and one label beside every exhibit,
// drawn from the copy in the visitor's language (labels/<locale>.json). The
// placement is pure and tested (`planRoomLabels`); the canvases are drawn
// only where there is a document to draw on.
//
// Heights are relative to the room's FLOOR (`bounds.min[1]`): rooms stand at
// different heights, and a plaque at y = 1.45 in the world-engine chamber
// would be under its floor.

/**
 * How far in from a room's bounds the readable wall plane lies. The
 * Observatory's walls stand 0.16 m inside the bounds and their stone
 * pilasters 0.35 m (observatory.ts, chamberWalls); a panel mounted here
 * clears both, and the door jambs (0.40 m) stand just proud of it.
 */
export const WALL_FACE_M = 0.36;
/** A plaque's slab: it stands this far proud of the wall plane. */
export const PLAQUE_THICKNESS_M = 0.03;
/** The door jamb's stone reaches this far beyond the opening on either side (observatory.ts, portals). */
export const DOOR_JAMB_M = 0.5;
/** Clear space between a door's jamb and the entrance panel. */
const DOOR_GAP_M = 0.6;
/** Clear space between a wall hanging's edge and its label. */
const HANGING_GAP_M = 0.25;
/** A plaque keeps this far from a wall's end. */
const CORNER_MARGIN_M = 0.3;

export const PANEL = { width: 1.8, height: 1.35, top: 2.25, texture: [1024, 768] as const };
export const LABEL = { width: 0.7, height: 0.525, centre: 1.45, texture: [768, 576] as const };
/** A record line on a wall: a label's proportions, a little larger, at reading height. */
export const LINE = { width: 1.2, height: 0.9, centre: 1.55, texture: [1024, 768] as const };
/** An exhibit's reading stand: a plate tilted 30° from horizontal, its top edge a metre up. */
export const LECTERN = { width: 0.85, height: 0.6375, top: 1.05, tiltDeg: 30, texture: [1024, 768] as const };
/** A room's reading stand, for the grounds and the Orrery, which have no wall to hang a panel on. */
export const ENTRANCE_LECTERN = { width: 1.1, height: 0.825, top: 1.1, tiltDeg: 30, texture: [1024, 768] as const };
/** A lectern stands this far in front of a floor exhibit's footprint. */
const LECTERN_STANDOFF_M = 1.2;

/** What the visitor reads for a tree: the room and tree stay `spectre`, the repository is coarsen (docs/specs/NAMING.md). */
const REPOSITORY_NAME: Readonly<Record<string, string>> = { spectre: "coarsen" };
/**
 * Every hanging carries its tree in `bundle.exhibit` (since #20 the planets
 * too); this is the fallback for a hanging that pins a bundle id alone, as
 * the Orrery's cutaway worlds did before, so a credit line never goes
 * missing. (coarsen's chamber, which also hung them, is gone: ruled
 * 2026-09-16.)
 */
const TREE_OF_ROOM: Readonly<Record<string, string>> = { orrery: "spectre" };

/** An entrance panel, an exhibit's label, or a record line on a wall. */
export type PlaqueKind = "entrance" | "label" | "line";
export type PlaqueMount = "wall" | "lectern" | "stand";
/** What a plaque faces: the room's centre from its wall, the spawn, or the way its tape's stand faces. */
export type PlaqueFacing = "room" | "spawn" | "stand";

export interface PlaqueText {
  heading: string;
  title: string;
  kicker?: string;
  body: string;
  lookForHeading?: string;
  lookFor?: string;
  limitHeading?: string;
  limit?: string;
  creditHeading?: string;
  credit?: string;
}

export interface PlaquePlan {
  kind: PlaqueKind;
  mount: PlaqueMount;
  facing: PlaqueFacing;
  hangingId?: string;
  /** The plate's centre, room metres. */
  position: Vector3;
  /** The plate's +Z is its normal, +Y its up. */
  quaternion: Quaternion;
  width: number;
  height: number;
  texture: readonly [number, number];
  /** A lectern's or a stand's foot on the floor. */
  foot?: Vector3;
  text: PlaqueText;
}

interface Wall {
  axis: "x" | "z";
  at: number;
  /** +1 when the room lies toward +axis from this wall. */
  inward: number;
  /** The wall's extent along the other horizontal axis. */
  min: number;
  max: number;
}

type Span = readonly [number, number];

function walls(room: Room): Wall[] {
  const [x0, , z0] = room.bounds.min;
  const [x1, , z1] = room.bounds.max;
  return [
    { axis: "x", at: x0, inward: 1, min: z0, max: z1 },
    { axis: "x", at: x1, inward: -1, min: z0, max: z1 },
    { axis: "z", at: z0, inward: 1, min: x0, max: x1 },
    { axis: "z", at: z1, inward: -1, min: x0, max: x1 },
  ];
}

function wallOfDoor(room: Room, door: Doorway): Wall {
  const found = walls(room).find((w) => w.axis === door.axis && Math.abs(w.at - door.at) < 0.01);
  if (found) return found;
  // A door not on the bounds (an asset marker moved it): still a wall there.
  const centre = roomCentre(room);
  const [x0, , z0] = room.bounds.min;
  const [x1, , z1] = room.bounds.max;
  return door.axis === "x"
    ? { axis: "x", at: door.at, inward: Math.sign(centre.x - door.at) || 1, min: z0, max: z1 }
    : { axis: "z", at: door.at, inward: Math.sign(centre.z - door.at) || 1, min: x0, max: x1 };
}

function inwardNormal(wall: Wall): Vector3 {
  return wall.axis === "x" ? new Vector3(wall.inward, 0, 0) : new Vector3(0, 0, wall.inward);
}

/**
 * Standing inside, facing the wall, the direction of your right hand along
 * it, as a sign on the wall's along-axis. Facing f = -inward, right = f x up
 * = (-f.z, 0, f.x): on an x-wall the along-axis is z and right is -inward;
 * on a z-wall the along-axis is x and right is +inward.
 */
function rightAlong(wall: Wall): number {
  return wall.axis === "x" ? -wall.inward : wall.inward;
}

function along(wall: Wall, p: { x: number; z: number }): number {
  return wall.axis === "x" ? p.z : p.x;
}

/** Yaw that turns a plate's +Z onto the wall's inward normal. */
function wallQuaternion(wall: Wall): Quaternion {
  const n = inwardNormal(wall);
  return new Quaternion().setFromEuler(new Euler(0, Math.atan2(n.x, n.z), 0));
}

export function roomCentre(room: Room): Vector3 {
  return new Vector3(
    (room.bounds.min[0] + room.bounds.max[0]) / 2,
    (room.bounds.min[1] + room.bounds.max[1]) / 2,
    (room.bounds.min[2] + room.bounds.max[2]) / 2,
  );
}

/** The body's forward for a spawn yaw: yaw 0 looks down -Z (the rig's rotation.y is the yaw). */
export function forwardOf(yawDeg: number): Vector3 {
  const yaw = MathUtils.degToRad(yawDeg);
  return new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

function hangingQuaternion(h: { rotationDeg: readonly [number, number, number] }): Quaternion {
  return new Quaternion().setFromEuler(
    new Euler(MathUtils.degToRad(h.rotationDeg[0]), MathUtils.degToRad(h.rotationDeg[1]), MathUtils.degToRad(h.rotationDeg[2])),
  );
}

/** Open-doorway distance from the start room to every room; a room off the graph is absent. */
export function hallDistances(mansion: Mansion): Map<string, number> {
  const dist = new Map<string, number>([[mansion.start, 0]]);
  const queue = [mansion.start];
  while (queue.length) {
    const id = queue.shift()!;
    const d = dist.get(id)!;
    const room = mansion.rooms.find((r) => r.id === id);
    for (const door of room?.doorways ?? []) {
      if (door.closed || dist.has(door.to)) continue;
      if (!mansion.rooms.some((r) => r.id === door.to)) continue;
      dist.set(door.to, d + 1);
      queue.push(door.to);
    }
  }
  return dist;
}

function overlaps(a: Span, b: Span, tolerance = 0.001): boolean {
  return a[0] < b[1] - tolerance && b[0] < a[1] - tolerance;
}

/**
 * Slide a plaque of `halfWidth` along a wall from `start` (its near edge) in
 * direction `dir` until it overlaps no obstacle, then keep it off the wall's
 * ends. If the wall runs out that way, try the other way from the same
 * anchor. Returns the plaque's centre along the wall.
 */
function placeAlongWall(wall: Wall, start: number, halfWidth: number, dir: number, obstacles: readonly Span[]): number {
  const lo = wall.min + CORNER_MARGIN_M;
  const hi = wall.max - CORNER_MARGIN_M;
  const attempt = (d: number): number | null => {
    let c = start + d * halfWidth;
    for (let guard = 0; guard < 32; guard++) {
      const span: Span = [c - halfWidth, c + halfWidth];
      const hit = obstacles.find((o) => overlaps(span, o));
      if (!hit) break;
      c = (d > 0 ? hit[1] : hit[0]) + d * (halfWidth + 0.1);
    }
    return c - halfWidth >= lo - 1e-6 && c + halfWidth <= hi + 1e-6 ? c : null;
  };
  const forward = attempt(dir);
  if (forward !== null) return forward;
  const backward = attempt(-dir);
  if (backward !== null) return backward;
  return MathUtils.clamp(start + dir * halfWidth, lo + halfWidth, hi - halfWidth);
}

/** Every span a plaque on this wall must keep clear of: doorways with their jambs, and the wall's hangings. */
function wallObstacles(room: Room, wall: Wall, except?: string): Span[] {
  const spans: Span[] = [];
  for (const door of room.doorways) {
    if (door.axis !== wall.axis || Math.abs(door.at - wall.at) > 0.5) continue;
    spans.push([door.center - door.width / 2 - DOOR_JAMB_M, door.center + door.width / 2 + DOOR_JAMB_M]);
  }
  for (const h of room.hangings) {
    if (h.id === except) continue;
    if (h.kind !== "still" && h.kind !== "video") continue;
    const across = wall.axis === "x" ? h.position[0] : h.position[2];
    if (Math.abs(across - wall.at) > 0.6) continue;
    const c = wall.axis === "x" ? h.position[2] : h.position[0];
    spans.push([c - h.widthMeters / 2 - 0.1, c + h.widthMeters / 2 + 0.1]);
  }
  return spans;
}

/** The middle of a doorway's opening, on the floor. */
function doorPointOf(d: Doorway): Vector3 {
  return d.axis === "x" ? new Vector3(d.at, 0, d.center) : new Vector3(d.center, 0, d.at);
}

/**
 * The wall the introduction panel hangs on, and the door it stands beside.
 * A chamber's is the open doorway nearest the hall by graph distance (ties
 * broken by nearness to the spawn); the hall's is the wall behind its
 * spawn; a room whose only doors are closed (the Workshop) takes one of
 * those, since that is still how its host comes in. Null means no wall:
 * the grounds and the Orrery get a lectern instead.
 */
export function entranceWall(room: Room, mansion: Mansion): { wall: Wall; door: Doorway | null } | null {
  if (room.fallback.kind === "ground" || room.architecture === "space") return null;
  const spawn = new Vector3(...room.spawn.position);
  if (room.id === mansion.start) {
    const forward = forwardOf(room.spawn.yawDeg);
    const behind = walls(room).reduce((best, w) => (inwardNormal(w).dot(forward) > inwardNormal(best).dot(forward) ? w : best));
    const doors = room.doorways
      .filter((d) => d.axis === behind.axis && Math.abs(d.at - behind.at) < 0.5)
      .sort((a, b) => Math.abs(a.center - along(behind, spawn)) - Math.abs(b.center - along(behind, spawn)));
    return { wall: behind, door: doors[0] ?? null };
  }
  const distances = hallDistances(mansion);
  const open = room.doorways.filter((d) => !d.closed);
  const pool = open.length ? open : room.doorways;
  if (!pool.length) return null;
  const rank = (d: Doorway): number => distances.get(d.to) ?? Number.POSITIVE_INFINITY;
  const nearest = Math.min(...pool.map(rank));
  const door = pool
    .filter((d) => rank(d) === nearest)
    .sort((a, b) => doorPointOf(a).distanceTo(spawn) - doorPointOf(b).distanceTo(spawn))[0]!;
  return { wall: wallOfDoor(room, door), door };
}

function wallPlaque(
  wall: Wall,
  room: Room,
  centreAlong: number,
  centreY: number,
  size: { width: number; height: number; texture: readonly [number, number] },
  rest: Pick<PlaquePlan, "kind" | "text"> & { hangingId?: string },
): PlaquePlan {
  const across = wall.at + wall.inward * (WALL_FACE_M + PLAQUE_THICKNESS_M / 2);
  const position = wall.axis === "x" ? new Vector3(across, centreY, centreAlong) : new Vector3(centreAlong, centreY, across);
  void room;
  return {
    kind: rest.kind,
    mount: "wall",
    facing: "room",
    ...(rest.hangingId ? { hangingId: rest.hangingId } : {}),
    position,
    quaternion: wallQuaternion(wall),
    width: size.width,
    height: size.height,
    texture: size.texture,
    text: rest.text,
  };
}

/**
 * A tilted reading plate over a stem at `foot`, its front toward `facing`
 * (horizontal). Plate up-vector u = (0, sin t, -cos t), normal (0, cos t,
 * sin t) in the stand's frame with the reader at +Z: a rotation of -(90°-t)
 * about X, then the yaw that turns +Z onto `facing`.
 */
function lecternPlaque(
  foot: Vector3,
  facing: Vector3,
  size: { width: number; height: number; top: number; tiltDeg: number; texture: readonly [number, number] },
  rest: Pick<PlaquePlan, "kind" | "text" | "facing"> & { hangingId?: string },
): PlaquePlan {
  const tilt = MathUtils.degToRad(size.tiltDeg);
  const yaw = Math.atan2(facing.x, facing.z);
  const quaternion = new Quaternion().setFromEuler(new Euler(0, yaw, 0)).multiply(new Quaternion().setFromEuler(new Euler(-(Math.PI / 2 - tilt), 0, 0)));
  const centreY = foot.y + size.top - (size.height / 2) * Math.sin(tilt);
  return {
    kind: rest.kind,
    mount: "lectern",
    facing: rest.facing,
    ...(rest.hangingId ? { hangingId: rest.hangingId } : {}),
    position: new Vector3(foot.x, centreY, foot.z),
    quaternion,
    width: size.width,
    height: size.height,
    texture: size.texture,
    foot: foot.clone(),
    text: rest.text,
  };
}

/** The credit line, never translated: the repository as the visitor reads it, and the bundle id. */
export function creditFor(room: Room, hanging: Hanging): string | undefined {
  const bundle = hanging.bundle;
  const tree = bundle?.exhibit?.tree ?? TREE_OF_ROOM[room.id];
  const id = bundle?.id || bundle?.exhibit?.bundle || "";
  const parts = [tree ? (REPOSITORY_NAME[tree] ?? tree) : "", id].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/** A floor exhibit's footprint on the floor plane, room metres. */
function footprint(h: Hanging): { min: Vector3; max: Vector3 } {
  const p = new Vector3(...h.position);
  if (h.kind === "planet") {
    const min = new Vector3(Infinity, 0, Infinity);
    const max = new Vector3(-Infinity, 0, -Infinity);
    for (const world of h.worlds) {
      min.x = Math.min(min.x, world.position[0] - h.radiusMeters);
      min.z = Math.min(min.z, world.position[2] - h.radiusMeters);
      max.x = Math.max(max.x, world.position[0] + h.radiusMeters);
      max.z = Math.max(max.z, world.position[2] + h.radiusMeters);
    }
    return { min, max };
  }
  const half = h.kind === "tape" ? h.longSideMeters / 2 : h.kind === "audio" ? h.sizeMeters / 2 : 0.5;
  return { min: new Vector3(p.x - half, 0, p.z - half), max: new Vector3(p.x + half, 0, p.z + half) };
}

function textForRoom(room: Room, labels: Labels): PlaqueText | null {
  const copy = labels.rooms[room.id];
  if (!copy) return null;
  return {
    heading: labels.common.entrance,
    title: copy.title,
    kicker: copy.kicker,
    body: copy.intro,
    ...(copy.lookFor ? { lookForHeading: labels.common.lookFor, lookFor: copy.lookFor } : {}),
    ...(copy.limit ? { limitHeading: labels.common.limit, limit: copy.limit } : {}),
  };
}

function textForHanging(room: Room, hanging: Hanging, labels: Labels): PlaqueText | null {
  const copy = labels.exhibits[hanging.id];
  if (!copy) return null;
  const credit = [creditFor(room, hanging), copy.credit].filter(Boolean).join("\n");
  return {
    heading: labels.common.exhibit,
    title: copy.title,
    body: copy.caption,
    ...(credit ? { creditHeading: labels.common.source, credit } : {}),
  };
}

/**
 * Where every plaque of a room goes. Pure: no canvas, no three.js scene, so
 * the placement is tested against the whole of mansion.json.
 */
export function planRoomLabels(room: Room, labels: Labels, mansion: Mansion): PlaquePlan[] {
  const plans: PlaquePlan[] = [];
  const floor = room.bounds.min[1];
  const spawn = new Vector3(...room.spawn.position);
  const spawnForward = forwardOf(room.spawn.yawDeg);
  const spawnRight = new Vector3(-spawnForward.z, 0, spawnForward.x);
  /** Plaques already on each wall, so two never overlap. */
  const placed = new Map<Wall, Span[]>();
  const spansOn = (wall: Wall): Span[] => {
    let spans = [...placed.entries()].find(([w]) => w.axis === wall.axis && Math.abs(w.at - wall.at) < 0.01)?.[1];
    if (!spans) {
      spans = [];
      placed.set(wall, spans);
    }
    return spans;
  };

  const roomText = textForRoom(room, labels);
  if (roomText) {
    const entrance = entranceWall(room, mansion);
    if (entrance) {
      const { wall, door } = entrance;
      const half = PANEL.width / 2;
      const fits = (w: Wall, c: number, obstacles: readonly Span[]): boolean =>
        c - half >= w.min + CORNER_MARGIN_M - 1e-6 && c + half <= w.max - CORNER_MARGIN_M + 1e-6
        && !obstacles.some((o) => overlaps([c - half, c + half], o));
      const dir = rightAlong(wall);
      const start = door
        ? door.center + dir * (door.width / 2 + DOOR_JAMB_M + DOOR_GAP_M)
        : along(wall, spawn) + dir * DOOR_GAP_M;
      let on = wall;
      let obstacles = [...wallObstacles(room, wall), ...spansOn(wall)];
      let c = placeAlongWall(wall, start, half, dir, obstacles);
      if (door && !fits(wall, c, obstacles)) {
        // A short end wall with its door in the middle (a chamber of a tree's
        // area) has no room beside the door: the panel goes round the corner
        // onto the side wall, the nearer corner first, as a museum would.
        const doorAlong = along(wall, doorPointOf(door));
        const sides = walls(room).filter((w) => w.axis !== wall.axis)
          .sort((p, q) => Math.abs(p.at - doorAlong) - Math.abs(q.at - doorAlong));
        for (const side of sides) {
          const inward = Math.abs(wall.at - side.min) < 1e-6 ? 1 : -1;
          const sideObstacles = [...wallObstacles(room, side), ...spansOn(side)];
          const candidate = placeAlongWall(side, wall.at + inward * DOOR_GAP_M, half, inward, sideObstacles);
          if (!fits(side, candidate, sideObstacles)) continue;
          on = side; c = candidate; obstacles = sideObstacles;
          break;
        }
      }
      spansOn(on).push([c - half, c + half]);
      plans.push(wallPlaque(on, room, c, floor + PANEL.top - PANEL.height / 2, PANEL, { kind: "entrance", text: roomText }));
    } else {
      // A cell of the grounds, or the Orrery: a reading stand ahead and to
      // the left of where the visitor lands, turned back to face them.
      const foot = spawn.clone().addScaledVector(spawnForward, 1.6).addScaledVector(spawnRight, -1.0);
      foot.y = floor;
      plans.push(lecternPlaque(foot, spawnForward.clone().negate(), ENTRANCE_LECTERN, { kind: "entrance", facing: "spawn", text: roomText }));
    }
  }

  for (const hanging of room.hangings) {
    const text = textForHanging(room, hanging, labels);
    if (!text) continue;
    if (hanging.kind === "still" || hanging.kind === "video") {
      const q = hangingQuaternion(hanging);
      const normal = new Vector3(0, 0, 1).applyQuaternion(q);
      const right = new Vector3(1, 0, 0).applyQuaternion(q);
      const wall = walls(room).reduce((best, w) => (inwardNormal(w).dot(normal) > inwardNormal(best).dot(normal) ? w : best));
      const p = new Vector3(...hanging.position);
      const onWall = inwardNormal(wall).dot(normal) > 0.7
        && Math.abs((wall.axis === "x" ? p.x : p.z) - wall.at) < WALL_FACE_M + 0.6;
      if (onWall) {
        const dir = Math.sign(along(wall, right)) || rightAlong(wall);
        const start = along(wall, p) + dir * (hanging.widthMeters / 2 + HANGING_GAP_M);
        const obstacles = [...wallObstacles(room, wall, hanging.id), ...spansOn(wall)];
        const c = placeAlongWall(wall, start, LABEL.width / 2, dir, obstacles);
        spansOn(wall).push([c - LABEL.width / 2, c + LABEL.width / 2]);
        plans.push(wallPlaque(wall, room, c, floor + LABEL.centre, LABEL, { kind: "label", hangingId: hanging.id, text }));
      } else {
        // Free-standing: beside its right edge, facing the way it faces.
        const position = p.clone().addScaledVector(right, hanging.widthMeters / 2 + HANGING_GAP_M + LABEL.width / 2);
        position.y = floor + LABEL.centre;
        plans.push({ kind: "label", mount: "wall", facing: "room", hangingId: hanging.id, position, quaternion: q, width: LABEL.width, height: LABEL.height, texture: LABEL.texture, text });
      }
      continue;
    }
    // A tape: its text is the face of the reading stand the tape builds at
    // its near edge (tape-exhibit.ts), placed from the same frame (stand.ts).
    // Any other floor exhibit gets a lectern in front of its footprint on the
    // spawn's side.
    if (hanging.kind === "tape") {
      const foot = standFoot(hanging, floor);
      const frame = standFrame(foot.position, foot.rotationDeg);
      plans.push({
        kind: "label", mount: "stand", facing: "stand", hangingId: hanging.id,
        position: frame.faceCentre, quaternion: frame.quaternion,
        width: STAND.width, height: STAND.faceHeight, texture: STAND.texture,
        foot: frame.foot.clone(), text,
      });
      continue;
    }
    const box = footprint(hanging);
    const centre = box.min.clone().add(box.max).multiplyScalar(0.5);
    const toSpawn = spawn.clone().sub(centre).setY(0);
    const landsInside = spawn.x >= box.min.x && spawn.x <= box.max.x && spawn.z >= box.min.z && spawn.z <= box.max.z;
    let foot: Vector3;
    let facing: Vector3;
    if (landsInside || toSpawn.length() < 0.5) {
      // The visitor lands among the exhibit itself (the Orrery, whose worlds
      // surround the landing): the stand goes a step ahead and to the right,
      // facing back.
      foot = spawn.clone().addScaledVector(spawnForward, LECTERN_STANDOFF_M).addScaledVector(spawnRight, 0.6);
      facing = spawnForward.clone().negate();
    } else {
      const d = toSpawn.normalize();
      const half = box.max.clone().sub(box.min).multiplyScalar(0.5);
      const t = Math.min(
        Math.abs(d.x) > 1e-6 ? half.x / Math.abs(d.x) : Infinity,
        Math.abs(d.z) > 1e-6 ? half.z / Math.abs(d.z) : Infinity,
      );
      foot = centre.clone().addScaledVector(d, t + LECTERN_STANDOFF_M);
      facing = d;
    }
    foot.y = floor;
    plans.push(lecternPlaque(foot, facing, LECTERN, { kind: "label", facing: "spawn", hangingId: hanging.id, text }));
  }

  // The room's record lines: each on the wall its plan faces, brought out to
  // the wall's reading face so the pilasters never cut through it, and moved
  // along the wall only as far as a doorway or a hanging requires.
  const lines = labels.rooms[room.id]?.lines ?? {};
  for (const line of room.wallLines) {
    const copy = lines[line.key];
    if (!copy) continue;
    const normal = new Vector3(0, 0, 1).applyQuaternion(hangingQuaternion(line));
    const wall = walls(room).reduce((best, w) => (inwardNormal(w).dot(normal) > inwardNormal(best).dot(normal) ? w : best));
    const width = Math.min(LINE.width, line.widthMeters);
    const p = new Vector3(...line.position);
    const obstacles = [...wallObstacles(room, wall), ...spansOn(wall)];
    // placeAlongWall starts a plate at its near edge: half a width back puts the plan's point at its centre.
    const c = placeAlongWall(wall, along(wall, p) - rightAlong(wall) * width / 2, width / 2, rightAlong(wall), obstacles);
    spansOn(wall).push([c - width / 2, c + width / 2]);
    const plan = wallPlaque(wall, room, c, floor + LINE.centre, { ...LINE, width }, {
      kind: "line", hangingId: line.id,
      text: { heading: labels.rooms[room.id]!.title, title: copy.title, body: copy.text },
    });
    plans.push(plan);
  }
  return plans;
}

// ---------------------------------------------------------------------------
// Drawing

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';
const INK = {
  slab: OBSERVATORY_PALETTE.inset,
  edge: OBSERVATORY_PALETTE.brass,
  title: OBSERVATORY_PALETTE.light,
  kicker: OBSERVATORY_PALETTE.blue,
  body: "#d9e2da",
  dim: "#9fb0b8",
  rule: "rgba(169,133,81,0.55)",
} as const;

interface Block {
  text: string;
  px: number;
  weight?: string;
  style?: string;
  colour: string;
  /** Extra space above, in em of this block. */
  before?: number;
  letterSpacing?: number;
  lineHeight?: number;
}

function blocksFor(text: PlaqueText, kind: PlaqueKind): Block[] {
  const big = kind === "entrance";
  const blocks: Block[] = [
    { text: text.heading.toUpperCase(), px: big ? 11 : 8, colour: INK.edge, letterSpacing: 2 },
    { text: text.title, px: big ? 30 : 15, weight: "700", colour: INK.title, before: 0.3, lineHeight: 1.12 },
  ];
  if (text.kicker) blocks.push({ text: text.kicker, px: big ? 15 : 10, style: "italic", colour: INK.kicker, before: 0.5 });
  blocks.push({ text: text.body, px: big ? 13 : 10.5, colour: INK.body, before: 1.1 });
  if (text.lookFor && text.lookForHeading) {
    blocks.push({ text: text.lookForHeading.toUpperCase(), px: big ? 9.5 : 7.5, colour: INK.edge, before: 1.6, letterSpacing: 1.5 });
    blocks.push({ text: text.lookFor, px: big ? 12 : 9.5, colour: INK.body, before: 0.35 });
  }
  if (text.limit && text.limitHeading) {
    blocks.push({ text: text.limitHeading.toUpperCase(), px: big ? 9 : 7.5, colour: INK.edge, before: 1.5, letterSpacing: 1.5 });
    blocks.push({ text: text.limit, px: big ? 11 : 9, colour: INK.dim, before: 0.35 });
  }
  if (text.credit && text.creditHeading) {
    blocks.push({ text: text.creditHeading.toUpperCase(), px: big ? 9 : 7, colour: INK.edge, before: 1.5, letterSpacing: 1.5 });
    blocks.push({ text: text.credit, px: big ? 10.5 : 8.5, colour: INK.dim, before: 0.35 });
  }
  return blocks;
}

function fontOf(block: Block, scale: number): string {
  return `${block.style ?? ""} ${block.weight ?? "400"} ${(block.px * scale).toFixed(1)}px ${FONT_STACK}`.trim();
}

interface Laid {
  block: Block;
  lines: string[];
  y: number;
  lineHeight: number;
}

/** Lay the blocks out at a font scale; returns the lines and the total height. */
function layout(ctx: CanvasRenderingContext2D, blocks: Block[], width: number, scale: number): { laid: Laid[]; height: number } {
  const laid: Laid[] = [];
  let y = 0;
  for (const block of blocks) {
    ctx.font = fontOf(block, scale);
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${(block.letterSpacing ?? 0) * scale}px`;
    const px = block.px * scale;
    const lineHeight = px * (block.lineHeight ?? 1.32);
    y += px * (block.before ?? 0);
    const lines = block.text.split("\n").flatMap((paragraph) => wrap(ctx, paragraph, width));
    laid.push({ block, lines, y, lineHeight });
    y += lines.length * lineHeight;
  }
  return { laid, height: y };
}

/**
 * Draw a plaque into a fresh canvas. Laid out at half the texture size and
 * drawn at 2x, so the text is crisp at the DPI a visitor reads it at. Copy
 * that will not fit is scaled down, never clipped: a German limit is not
 * lost off the bottom of the slab.
 */
export function paintPlaque(text: PlaqueText, kind: PlaqueKind, texture: readonly [number, number]): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = texture[0];
  canvas.height = texture[1];
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const W = texture[0] / 2;
  const H = texture[1] / 2;
  ctx.scale(2, 2);
  // The slab and its brass edge.
  ctx.fillStyle = INK.slab;
  ctx.fillRect(0, 0, W, H);
  const edge = kind === "entrance" ? 3 : 2;
  ctx.strokeStyle = INK.edge;
  ctx.lineWidth = edge;
  ctx.strokeRect(edge / 2, edge / 2, W - edge, H - edge);
  ctx.strokeStyle = "rgba(238,211,165,0.25)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(edge + 2, edge + 2, W - 2 * edge - 4, H - 2 * edge - 4);

  const margin = kind === "entrance" ? 30 : 16;
  const width = W - 2 * margin;
  const available = H - 2 * margin;
  const blocks = blocksFor(text, kind);
  // Fill the slab: the largest type at which the copy fits, found by
  // bisection because a larger font re-wraps onto more lines. Short copy
  // (an orientation panel) grows up to a cap that keeps it from reading as
  // a headline; long copy shrinks, never clips.
  let lo = 0.6;
  let hi = kind === "entrance" ? 1.35 : 1.3;
  let scale = lo;
  let result = layout(ctx, blocks, width, lo);
  if (layout(ctx, blocks, width, hi).height <= available) {
    scale = hi;
    result = layout(ctx, blocks, width, hi);
  } else {
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      const trial = layout(ctx, blocks, width, mid);
      if (trial.height <= available) {
        lo = mid;
        scale = mid;
        result = trial;
      } else {
        hi = mid;
      }
    }
  }
  ctx.textBaseline = "top";
  for (const { block, lines, y, lineHeight } of result.laid) {
    ctx.font = fontOf(block, scale);
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${(block.letterSpacing ?? 0) * scale}px`;
    ctx.fillStyle = block.colour;
    lines.forEach((line, i) => ctx.fillText(line, margin, margin + y + i * lineHeight));
    // A brass rule under the kicker (or the title, when there is none) marks where the reading begins.
    if (block.colour === INK.kicker || (block.weight === "700" && !text.kicker)) {
      const ruleY = margin + y + lines.length * lineHeight + 5 * scale;
      ctx.strokeStyle = INK.rule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin, ruleY);
      ctx.lineTo(margin + Math.min(width, 90 * scale), ruleY);
      ctx.stroke();
    }
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// Meshes

let brass: MeshBasicMaterial | null = null;
let slab: MeshBasicMaterial | null = null;
/** Turns a plate's back toward the far side. */
const ABOUT_FACE = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
function brassMaterial(): MeshBasicMaterial {
  return (brass ??= new MeshBasicMaterial({ color: OBSERVATORY_PALETTE.brass }));
}
function slabMaterial(): MeshBasicMaterial {
  return (slab ??= new MeshBasicMaterial({ color: OBSERVATORY_PALETTE.inset }));
}

function buildPlaque(plan: PlaquePlan, locale: string): Group {
  const group = new Group();
  group.name = `plaque-${plan.kind}${plan.hangingId ? `-${plan.hangingId}` : ""}`;
  group.userData = {
    plaque: plan.kind, mount: plan.mount, facing: plan.facing, hangingId: plan.hangingId ?? null, locale,
    // A record line is its own content: what it says travels with the plaque.
    ...(plan.kind === "line" ? { line: { title: plan.text.title, text: plan.text.body } } : {}),
  };
  const disposables: Array<{ dispose(): void }> = [];

  const normal = new Vector3(0, 0, 1).applyQuaternion(plan.quaternion);
  // A stand's body is the tape's (tape-exhibit.ts); the text is only its face.
  const thickness = plan.mount === "stand" ? STAND.thickness : PLAQUE_THICKNESS_M;
  if (plan.mount !== "stand") {
    // The body: a brass box a hair larger than the face, its edge the frame,
    // and the dark back a hair off it, so no two faces share a plane.
    const rim = new Mesh(new BoxGeometry(plan.width + 0.03, plan.height + 0.03, PLAQUE_THICKNESS_M), brassMaterial());
    rim.name = "plaque-rim";
    rim.position.copy(plan.position);
    rim.quaternion.copy(plan.quaternion);
    disposables.push(rim.geometry);
    group.add(rim);
    const back = new Mesh(new PlaneGeometry(plan.width, plan.height), slabMaterial());
    back.name = "plaque-slab";
    back.position.copy(plan.position).addScaledVector(normal, -(PLAQUE_THICKNESS_M / 2 + 0.002));
    back.quaternion.copy(plan.quaternion).multiply(ABOUT_FACE);
    disposables.push(back.geometry);
    group.add(back);
  }

  const canvas = paintPlaque(plan.text, plan.kind, plan.texture);
  const face = new Mesh(
    new PlaneGeometry(plan.width, plan.height),
    canvas
      ? (() => {
          const texture = new CanvasTexture(canvas);
          texture.colorSpace = SRGBColorSpace;
          texture.anisotropy = 4;
          disposables.push(texture);
          return new MeshBasicMaterial({ map: texture, toneMapped: false });
        })()
      : new MeshBasicMaterial({ color: OBSERVATORY_PALETTE.inset, toneMapped: false }),
  );
  face.name = "plaque-face";
  face.position.copy(plan.position).addScaledVector(normal, thickness / 2 + 0.002);
  face.quaternion.copy(plan.quaternion);
  disposables.push(face.geometry, face.material);
  group.add(face);

  if (plan.mount === "lectern" && plan.foot) {
    const stemHeight = Math.max(0.1, plan.position.y - plan.foot.y - 0.05);
    const stem = new Mesh(new BoxGeometry(0.06, stemHeight, 0.06), brassMaterial());
    stem.name = "plaque-stem";
    stem.position.set(plan.foot.x, plan.foot.y + stemHeight / 2, plan.foot.z);
    disposables.push(stem.geometry);
    group.add(stem);
    const base = new Mesh(new BoxGeometry(0.42, 0.03, 0.32), slabMaterial());
    base.name = "plaque-base";
    base.position.set(plan.foot.x, plan.foot.y + 0.015, plan.foot.z);
    base.rotation.y = Math.atan2(normal.x, normal.z);
    disposables.push(base.geometry);
    group.add(base);
  }

  group.userData.dispose = () => {
    for (const d of disposables) d.dispose();
  };
  return group;
}

/**
 * The room's plaques as meshes, to add under the room's group. The shared
 * brass and slab materials live for the page; everything else is released
 * by `disposeRoomLabels`.
 */
export function buildRoomLabels(room: Room, labels: Labels, locale: string, options: { mansion: Mansion }): Group {
  const group = new Group();
  group.name = `labels-${room.id}`;
  for (const plan of planRoomLabels(room, labels, options.mansion)) group.add(buildPlaque(plan, locale));
  return group;
}

export function disposeRoomLabels(group: Group): void {
  for (const child of group.children) {
    const dispose = (child.userData as { dispose?: () => void }).dispose;
    dispose?.();
  }
  group.clear();
}
