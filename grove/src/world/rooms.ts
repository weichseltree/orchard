import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  applyLightmap,
  ktx2Loader,
  loadLightmap,
  type LightmapMeta,
  type LightmapReport,
} from "../render/lightmap";
import type { DeviceTier } from "../tape/bundle";
import type { Doorway, Room } from "./schema";

// A room's shell. The hall comes from WP3's bake when it is there and from a
// grey box when it is not, so WP2 never waits on WP3; either way the doorway
// is a real opening and the room's footprint is the one mansion.json declares.

export const WALL_THICKNESS = 0.2;

/**
 * What the asset says about itself, read off the glb's marker empties. WP3
 * exports `spawn`, `door_einstruct` and `poster_wall`; where they are is the
 * asset's business, and copying their coordinates into mansion.json by hand is
 * how the two drift apart (the review found the spawn 0.5 m out).
 */
export interface RoomMarkers {
  spawn?: { position: [number, number, number]; yawDeg: number; eyeHeight?: number };
  /** Keyed by the room the doorway leads to. */
  doors: Map<string, { at: number; center: number; width: number; height: number }>;
  /**
   * Poster panels, keyed by node name. The facing is the node's local -Z,
   * the panel's normal pointing into the room; `position` is the panel's centre.
   */
  posters: Map<string, PosterMarker>;
}

export interface PosterMarker {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  width: number;
  height: number;
}

export interface RoomShell {
  group: Group;
  /** Where the shell came from, for the provenance panel. */
  provenance: Record<string, unknown>;
  lightmap: LightmapReport | null;
  markers: RoomMarkers;
}

export interface BuildRoomOptions {
  room: Room;
  renderer: WebGLRenderer;
  /** Base URL the room's glb and lightmap siblings hang off, e.g. "/". */
  assetBase?: string;
  /** Picks the lightmap tier; the phone gets `lightmapPhone` when the room has one. */
  tier?: DeviceTier;
  onNotice?: (message: string) => void;
}

/**
 * The lightmap files to try, in order, for this device. A 2048² UASTC
 * lightmap is 2 MB; the phone tier is a quarter of that and, on a phone
 * screen, indistinguishable.
 */
export function lightmapCandidates(
  room: Pick<Room, "lightmap" | "lightmapPhone">,
  tier: DeviceTier | undefined,
): string[] {
  if (tier === "phone" && room.lightmapPhone.length > 0) return room.lightmapPhone;
  return room.lightmap;
}

export async function buildRoom(options: BuildRoomOptions): Promise<RoomShell> {
  const { room, renderer } = options;
  const base = options.assetBase ?? "/";
  if (room.glb) {
    try {
      const shell = await loadRoomGlb(room, base, renderer, lightmapCandidates(room, options.tier));
      return shell;
    } catch (error) {
      options.onNotice?.(
        `${room.id}: ${room.glb} did not load (${message(error)}); showing the grey shell`,
      );
    }
  }
  return {
    group: proceduralRoom(room),
    provenance: fallbackProvenance(room),
    lightmap: null,
    markers: { doors: new Map(), posters: new Map() },
  };
}

async function loadRoomGlb(
  room: Room,
  base: string,
  renderer: WebGLRenderer,
  lightmaps: readonly string[],
): Promise<RoomShell> {
  const loader = new GLTFLoader();
  // A KTX2-textured glb needs the transcoder wired up before parse.
  loader.setKTX2Loader(ktx2Loader(renderer));
  const gltf = await loader.loadAsync(base + room.glb);
  const group = new Group();
  group.name = `${room.id}-glb`;
  group.add(gltf.scene);
  const sibling = await loadLightmap(
    lightmaps.map((path) => base + path),
    renderer,
  );
  const asset = gltf.parser.json.asset as Record<string, unknown> | undefined;
  const extras = (asset?.extras ?? {}) as Record<string, unknown>;
  const orchard = (extras.orchard ?? {}) as Record<string, unknown>;
  const meta = (orchard.lightmap ?? null) as LightmapMeta | null;
  const lightmap = applyLightmap(gltf.scene, sibling, meta);
  // A baked room is lit; anything else is double-counting the sun.
  group.add(...roomLights(room, lightmap.applied > 0 ? 0.12 : 1));
  return {
    group,
    provenance: {
      source: room.glb,
      generator: asset?.generator ?? "(unknown)",
      ...extras,
      lightmap: `${lightmap.source}${sibling?.userData.orchardUrl ? ` ${String(sibling.userData.orchardUrl)}` : ""}, intensity ${lightmap.intensity.toFixed(3)} (${lightmap.applied} materials, ${lightmap.withUv1} meshes with UV2)`,
    },
    lightmap,
    markers: readMarkers(gltf.scene, room),
  };
}

/**
 * Reads the asset's own spawn and doorway markers. Facing comes from the
 * node's local -Z, the camera convention WP3 documents. Only what the marker
 * actually carries is taken: the doorway's axis and its destination stay
 * mansion.json's business, because they are the room graph, not the geometry.
 */
export function readMarkers(scene: Object3D, room: Room): RoomMarkers {
  const markers: RoomMarkers = { doors: new Map(), posters: new Map() };
  scene.traverse((node) => {
    const role = (node.userData as { role?: string }).role;
    if (!role) return;
    node.updateWorldMatrix(true, false);
    node.getWorldPosition(_position);
    if (role === "poster") {
      node.getWorldQuaternion(_quaternion);
      const data = node.userData as { width_m?: number; height_m?: number };
      markers.posters.set(node.name, {
        position: [_position.x, _position.y, _position.z],
        quaternion: [_quaternion.x, _quaternion.y, _quaternion.z, _quaternion.w],
        width: data.width_m ?? 1,
        height: data.height_m ?? 1,
      });
      return;
    }
    if (role === "spawn") {
      node.getWorldQuaternion(_quaternion);
      _forward.set(0, 0, -1).applyQuaternion(_quaternion);
      const eyeHeight = (node.userData as { eye_height_m?: number }).eye_height_m;
      markers.spawn = {
        position: [_position.x, _position.y, _position.z],
        // atan2(-x, -z): yaw 0 is looking down -Z, as everything else here uses.
        yawDeg: (Math.atan2(-_forward.x, -_forward.z) * 180) / Math.PI,
        ...(typeof eyeHeight === "number" ? { eyeHeight } : {}),
      };
      return;
    }
    if (role !== "doorway") return;
    const data = node.userData as { to?: string; width_m?: number; height_m?: number };
    const door = room.doorways.find((d) => d.to === data.to) ?? room.doorways[0];
    if (!door) return;
    markers.doors.set(door.to, {
      at: door.axis === "x" ? _position.x : _position.z,
      center: door.axis === "x" ? _position.z : _position.x,
      width: data.width_m ?? door.width,
      height: data.height_m ?? door.height,
    });
  });
  return markers;
}

const _position = /* @__PURE__ */ new Vector3();
const _forward = /* @__PURE__ */ new Vector3();
const _quaternion = /* @__PURE__ */ new Quaternion();

function fallbackProvenance(room: Room): Record<string, unknown> {
  return {
    source: "procedural fallback (grove/src/world/rooms.ts)",
    note: room.glb
      ? `${room.glb} was not available; WP3 writes it into grove/public/assets/hall/`
      : "this room is procedural in M0",
    size_m: [
      room.bounds.max[0] - room.bounds.min[0],
      room.bounds.max[1] - room.bounds.min[1],
      room.bounds.max[2] - room.bounds.min[2],
    ],
  };
}

/** Hemisphere plus one soft key. Turned right down when a bake is doing the work. */
export function roomLights(room: Room, intensity: number): Group[] {
  const group = new Group();
  group.name = `${room.id}-lights`;
  const hemi = new HemisphereLight(0xd6dfd7, 0x4a544b, 1.15 * intensity);
  hemi.position.set(0, room.bounds.max[1], 0);
  const key = new DirectionalLight(0xfff2dd, 0.75 * intensity);
  key.position.set(
    room.bounds.max[0],
    room.bounds.max[1] * 0.9,
    (room.bounds.min[2] + room.bounds.max[2]) / 2,
  );
  group.add(hemi, key);
  return [group];
}

/**
 * The grey shell: floor, ceiling and four walls built inside the room's own
 * bounds, with a real hole where each doorway is. Walls sit inside the bounds
 * so two rooms sharing a plane do not z-fight.
 */
export function proceduralRoom(room: Room): Group {
  const group = new Group();
  group.name = `${room.id}-shell`;
  const [minX, minY, minZ] = room.bounds.min;
  const [maxX, maxY, maxZ] = room.bounds.max;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const height = maxY - minY;
  const base = new Color(room.fallback.color);

  const wallMaterial = new MeshStandardMaterial({
    color: base,
    roughness: 0.96,
    metalness: 0,
  });
  const floorMaterial = new MeshStandardMaterial({
    color: base.clone().multiplyScalar(0.55),
    roughness: 0.9,
    metalness: 0,
  });
  const ceilMaterial = new MeshStandardMaterial({
    color: base.clone().multiplyScalar(0.8),
    roughness: 1,
    metalness: 0,
  });

  const floor = new Mesh(new PlaneGeometry(width, depth), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((minX + maxX) / 2, minY + 0.001, (minZ + maxZ) / 2);
  floor.name = "floor";
  group.add(floor);

  const ceiling = new Mesh(new PlaneGeometry(width, depth), ceilMaterial);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set((minX + maxX) / 2, maxY - 0.001, (minZ + maxZ) / 2);
  group.add(ceiling);

  const walls: Array<{ axis: "x" | "z"; at: number; inward: 1 | -1 }> = [
    { axis: "x", at: minX, inward: 1 },
    { axis: "x", at: maxX, inward: -1 },
    { axis: "z", at: minZ, inward: 1 },
    { axis: "z", at: maxZ, inward: -1 },
  ];
  for (const wall of walls) {
    const doors = room.doorways.filter(
      (d) => d.axis === wall.axis && Math.abs(d.at - wall.at) < 1e-6,
    );
    const spanMin = wall.axis === "x" ? minZ : minX;
    const spanMax = wall.axis === "x" ? maxZ : maxX;
    for (const piece of wallPieces(spanMin, spanMax, minY, height, doors)) {
      const geometry =
        wall.axis === "x"
          ? new BoxGeometry(WALL_THICKNESS, piece.height, piece.length)
          : new BoxGeometry(piece.length, piece.height, WALL_THICKNESS);
      dropOutwardFace(geometry, wall.axis, wall.inward);
      const mesh = new Mesh(geometry, [wallMaterial]);
      const offset = wall.at + (wall.inward * WALL_THICKNESS) / 2;
      if (wall.axis === "x") mesh.position.set(offset, piece.centreY, piece.centre);
      else mesh.position.set(piece.centre, piece.centreY, offset);
      mesh.name = `wall-${wall.axis}-${wall.at}`;
      group.add(mesh);
    }
  }
  group.add(...roomLights(room, 1));
  return group;
}

/**
 * BoxGeometry's face groups, in its own order: +x, -x, +y, -y, +z, -z.
 * A wall's OUTWARD face lies on the room's bounds, exactly where the
 * neighbouring room's wall (or the hall's baked wall) also has a face, and
 * two coplanar faces z-fight. Nobody can see the outward face from inside
 * either room, so it is dropped: with a material array, three.js draws only
 * the groups that remain.
 */
export function dropOutwardFace(geometry: BoxGeometry, axis: "x" | "z", inward: 1 | -1): void {
  const outward = axis === "x" ? (inward === 1 ? 1 : 0) : inward === 1 ? 5 : 4;
  const groups = geometry.groups.map((g) => ({ ...g }));
  geometry.clearGroups();
  groups.forEach((g, i) => {
    if (i !== outward) geometry.addGroup(g.start, g.count, 0);
  });
}

interface WallPiece {
  /** Centre along the wall's long axis. */
  centre: number;
  length: number;
  centreY: number;
  height: number;
}

/**
 * A wall cut into the pieces that survive its doorways: the jambs either side
 * and the lintel above. Exported because the arithmetic is easy to get wrong
 * and worth a test.
 */
export function wallPieces(
  spanMin: number,
  spanMax: number,
  floorY: number,
  height: number,
  doors: readonly Doorway[],
): WallPiece[] {
  const pieces: WallPiece[] = [];
  const sorted = [...doors].sort((a, b) => a.center - b.center);
  let cursor = spanMin;
  for (const door of sorted) {
    const left = door.center - door.width / 2;
    const right = door.center + door.width / 2;
    if (left > cursor) {
      pieces.push({
        centre: (cursor + left) / 2,
        length: left - cursor,
        centreY: floorY + height / 2,
        height,
      });
    }
    const lintel = height - door.height;
    if (lintel > 0.001) {
      pieces.push({
        centre: (left + right) / 2,
        length: right - left,
        centreY: floorY + door.height + lintel / 2,
        height: lintel,
      });
    }
    cursor = Math.max(cursor, right);
  }
  if (spanMax > cursor) {
    pieces.push({
      centre: (cursor + spanMax) / 2,
      length: spanMax - cursor,
      centreY: floorY + height / 2,
      height,
    });
  }
  return pieces;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
