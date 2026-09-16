import { ClampToEdgeWrapping, Data3DTexture, LinearFilter, RGBAFormat, UnsignedByteType, Vector3 } from "three";
import type { Mansion, Room } from "./schema";

// The palace's light, baked at build time into a small 3D texture the stone
// shader samples once per fragment. Every luminous element of the
// architecture (sconce, chandelier, lantern, door inlay, obelisk crown) is an
// emitter, and so is a portal, so the same brass strip that reads as a lamp
// is the lamp that lights the wall beside it, and the garden's portal glows
// onto the gravel and the hedges around it. Light stays in the room that
// holds its source, except what spills through an open doorway. Nothing here
// is a claim about physics: the falloff is a design token, and the exhibits
// keep their own unlit colours.
//
// Cost: one trilinear fetch per fragment; a 2 m by 1 m grid over the palace
// is a few hundred kilobytes. The old Blender bake (grove/tools/palace) lit
// glb rooms the runtime architecture replaced; this is what took its place.

export interface Emitter {
  /** World position, metres. */
  x: number;
  y: number;
  z: number;
  /** Linear colour, 0..1. */
  r: number;
  g: number;
  b: number;
  /** Strength at the source. */
  power: number;
  /** How far the light reaches, metres; nothing beyond. */
  reach: number;
  /** The room holding the source: light stays inside it, spilling only through open doorways. */
  room: string;
}

/** The grid: coarse across the floor, finer up the walls. */
export const FIELD_CELL_XZ_M = 2;
export const FIELD_CELL_Y_M = 1;
/** Emitters this far outside a doorway still send light through it. */
const SPILL_FRACTION = 0.6;
/** Stored as half the summed light so a pool can go past 1 before it clips. */
const ENCODE = 0.5;

export interface LightField {
  texture: Data3DTexture;
  min: Vector3;
  size: Vector3;
  cells: [number, number, number];
  emitters: number;
  dispose(): void;
}

/** Uniforms every architectural material shares; `applyLightField` points them at a bake. */
export const lightFieldUniforms = {
  uLightField: { value: null as Data3DTexture | null },
  uFieldMin: { value: new Vector3() },
  uFieldInvSize: { value: new Vector3(1, 1, 1) },
  uFieldGain: { value: 0 },
};

/**
 * The stone shader's sampling of the field. A surface samples a little way
 * off itself along its normal, into the room it faces: a wall stands on the
 * bound between two rooms' texels, and the trilinear filter would otherwise
 * blend the neighbour's light through it.
 */
export const FIELD_SURFACE_OFFSET_M = 0.9;
export const LIGHT_FIELD_GLSL = /* glsl */ `
  vec3 fieldAt = observatoryWorld + observatoryNormal * ${FIELD_SURFACE_OFFSET_M.toFixed(2)};
  vec3 fieldUvw = (fieldAt - uFieldMin) * uFieldInvSize;
  vec3 fieldLight = texture(uLightField, fieldUvw).rgb * ${(1 / ENCODE).toFixed(1)} * uFieldGain;
`;

/** Rooms the field covers: the palace's own scale, built by the runtime architecture. */
export function litRooms(mansion: Mansion): Room[] {
  return mansion.rooms.filter((room) => room.architecture === "observatory" && (room.scale ?? 1) === 1);
}

/** Rooms that share light freely: the open grounds are one region, each chamber its own. */
function regionOf(room: Room): string {
  return room.fallback.kind === "ground" ? "grounds" : room.id;
}

/**
 * Bakes the field for `mansion` out of `emitters` (from observatory.ts's
 * builders, plus the portals). Pure apart from the texture it returns.
 */
export function bakeLightField(mansion: Mansion, emitters: readonly Emitter[]): LightField {
  const rooms = litRooms(mansion);
  const byId = new Map(rooms.map((room) => [room.id, room] as const));
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const room of rooms) {
    min.min(new Vector3(...room.bounds.min));
    max.max(new Vector3(...room.bounds.max));
  }
  if (rooms.length === 0) {
    min.set(0, 0, 0);
    max.set(1, 1, 1);
  }
  min.subScalar(FIELD_CELL_XZ_M);
  max.addScalar(FIELD_CELL_XZ_M);
  const nx = Math.max(1, Math.ceil((max.x - min.x) / FIELD_CELL_XZ_M));
  const ny = Math.max(1, Math.ceil((max.y - min.y) / FIELD_CELL_Y_M));
  const nz = Math.max(1, Math.ceil((max.z - min.z) / FIELD_CELL_XZ_M));
  const size = new Vector3(nx * FIELD_CELL_XZ_M, ny * FIELD_CELL_Y_M, nz * FIELD_CELL_XZ_M);
  const sum = new Float32Array(nx * ny * nz * 3);

  // Which region each cell centre stands in, once: a chamber by its bounds, the grounds as one.
  const region = new Array<string | null>(nx * ny * nz).fill(null);
  const within = (room: Room, x: number, y: number, z: number, slack: number): boolean => {
    const [x0, y0, z0] = room.bounds.min, [x1, y1, z1] = room.bounds.max;
    return x >= x0 - slack && x <= x1 + slack && y >= y0 - slack && y <= y1 + slack && z >= z0 - slack && z <= z1 + slack;
  };
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const x = min.x + (ix + 0.5) * FIELD_CELL_XZ_M, y = min.y + (iy + 0.5) * FIELD_CELL_Y_M, z = min.z + (iz + 0.5) * FIELD_CELL_XZ_M;
    // The room that holds the cell's centre; failing that, the nearest one
    // within half a cell, so the walls themselves, which stand on the
    // bounds, are lit from inside. A cell inside one room never takes a
    // neighbour's light through the wall between them.
    const home = rooms.find((room) => within(room, x, y, z, 0)) ?? rooms.find((room) => within(room, x, y, z, 1));
    if (home) region[(iz * ny + iy) * nx + ix] = regionOf(home);
  }

  const all: Emitter[] = emitters.filter((e) => byId.has(e.room));
  // Light through the open doorways: what reaches a doorway from its room goes on into the next.
  for (const room of rooms) {
    for (const door of room.doorways) {
      if (door.closed) continue;
      const neighbour = byId.get(door.to);
      if (!neighbour || regionOf(neighbour) === regionOf(room)) continue;
      const floor = Math.max(room.bounds.min[1], neighbour.bounds.min[1]);
      const cx = door.axis === "x" ? door.at : door.center;
      const cz = door.axis === "x" ? door.center : door.at;
      const cy = floor + Math.min(door.height, 4) / 2;
      for (const e of emitters) {
        if (e.room !== room.id) continue;
        const d = Math.hypot(e.x - cx, e.y - cy, e.z - cz);
        if (d >= e.reach) continue;
        const through = (1 - d / e.reach) ** 2 * 0.9;
        all.push({ x: cx, y: cy, z: cz, r: e.r, g: e.g, b: e.b, power: e.power * through, reach: Math.max(3, e.reach * SPILL_FRACTION), room: neighbour.id });
      }
    }
  }

  for (const e of all) {
    const home = byId.get(e.room);
    if (!home) continue;
    const homeRegion = regionOf(home);
    const ix0 = Math.max(0, Math.floor((e.x - e.reach - min.x) / FIELD_CELL_XZ_M));
    const ix1 = Math.min(nx - 1, Math.ceil((e.x + e.reach - min.x) / FIELD_CELL_XZ_M));
    const iy0 = Math.max(0, Math.floor((e.y - e.reach - min.y) / FIELD_CELL_Y_M));
    const iy1 = Math.min(ny - 1, Math.ceil((e.y + e.reach - min.y) / FIELD_CELL_Y_M));
    const iz0 = Math.max(0, Math.floor((e.z - e.reach - min.z) / FIELD_CELL_XZ_M));
    const iz1 = Math.min(nz - 1, Math.ceil((e.z + e.reach - min.z) / FIELD_CELL_XZ_M));
    for (let iz = iz0; iz <= iz1; iz++) for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
      const cell = (iz * ny + iy) * nx + ix;
      if (region[cell] !== homeRegion) continue;
      const x = min.x + (ix + 0.5) * FIELD_CELL_XZ_M, y = min.y + (iy + 0.5) * FIELD_CELL_Y_M, z = min.z + (iz + 0.5) * FIELD_CELL_XZ_M;
      const d = Math.hypot(e.x - x, e.y - y, e.z - z);
      if (d >= e.reach) continue;
      const w = e.power * (1 - d / e.reach) ** 2;
      sum[cell * 3] = (sum[cell * 3] ?? 0) + e.r * w;
      sum[cell * 3 + 1] = (sum[cell * 3 + 1] ?? 0) + e.g * w;
      sum[cell * 3 + 2] = (sum[cell * 3 + 2] ?? 0) + e.b * w;
    }
  }

  const data = new Uint8Array(nx * ny * nz * 4);
  for (let cell = 0; cell < nx * ny * nz; cell++) {
    data[cell * 4] = Math.round(Math.min(1, sum[cell * 3]! * ENCODE) * 255);
    data[cell * 4 + 1] = Math.round(Math.min(1, sum[cell * 3 + 1]! * ENCODE) * 255);
    data[cell * 4 + 2] = Math.round(Math.min(1, sum[cell * 3 + 2]! * ENCODE) * 255);
    data[cell * 4 + 3] = 255;
  }
  const texture = new Data3DTexture(data, nx, ny, nz);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.name = "observatory-light-field";
  texture.needsUpdate = true;
  return {
    texture,
    min,
    size,
    cells: [nx, ny, nz],
    emitters: all.length,
    dispose: () => texture.dispose(),
  };
}

/** Points the shared uniforms at a bake; `gain` scales every lamp at once. */
export function applyLightField(field: LightField | null, gain = 1): void {
  lightFieldUniforms.uLightField.value = field?.texture ?? null;
  if (field) {
    lightFieldUniforms.uFieldMin.value.copy(field.min);
    lightFieldUniforms.uFieldInvSize.value.set(1 / field.size.x, 1 / field.size.y, 1 / field.size.z);
  }
  lightFieldUniforms.uFieldGain.value = field ? gain : 0;
}

/** The summed light at a world point, decoded from a bake: for tests and the diagnostics. */
export function lightAt(field: LightField, x: number, y: number, z: number): [number, number, number] {
  const [nx, ny, nz] = field.cells;
  const ix = Math.min(nx - 1, Math.max(0, Math.floor((x - field.min.x) / FIELD_CELL_XZ_M)));
  const iy = Math.min(ny - 1, Math.max(0, Math.floor((y - field.min.y) / FIELD_CELL_Y_M)));
  const iz = Math.min(nz - 1, Math.max(0, Math.floor((z - field.min.z) / FIELD_CELL_XZ_M)));
  const cell = ((iz * ny + iy) * nx + ix) * 4;
  const data = field.texture.image.data as Uint8Array;
  return [data[cell]! / 255 / ENCODE, data[cell + 1]! / 255 / ENCODE, data[cell + 2]! / 255 / ENCODE];
}
