import { z } from "zod";

// mansion.json: the one scene document. Rooms, their glb, their spawn, their
// doorways and what hangs where. The client never hard-codes a room; adding a
// room is a change to the JSON, and this schema is what makes a bad edit fail
// loudly at boot instead of quietly at frame 900.

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const BoundsSchema = z
  .looseObject({ min: Vec3, max: Vec3 })
  .refine((b) => b.max[0] > b.min[0] && b.max[1] > b.min[1] && b.max[2] > b.min[2], {
    message: "bounds.max must be greater than bounds.min on every axis",
  });

export const SpawnSchema = z.looseObject({
  /** The body's feet, not the eye: the eye height is added in code. */
  position: Vec3,
  yawDeg: z.number().default(0),
});

export const GameSurfaceSchema = z.looseObject({
  id: z.string().min(1),
  provider: z.literal("ftlchess"),
  title: z.string().min(1),
  description: z.string().default(""),
  url: z.string().url(),
});

/**
 * A plain opening in a shared wall (M0; portals are M5). `axis` is the axis the
 * wall is perpendicular to, `at` the wall's coordinate on that axis, `center`
 * the opening's centre on the other horizontal axis.
 */
export const DoorwaySchema = z.looseObject({
  to: z.string().min(1),
  axis: z.enum(["x", "z"]),
  at: z.number(),
  center: z.number().default(0),
  width: z.number().positive(),
  height: z.number().positive(),
  /** A door leaf, not an opening: drawn solid, never crossed. A tree earns its room. */
  closed: z.boolean().default(false),
});

/**
 * Which bundle a hanging shows. `exhibit` names a tree and what kind of thing
 * hangs on it, and takes the latest row of the live `exhibit` table; with
 * `bundle` it takes the latest row FOR THAT BUNDLE instead, so a room can
 * hold two sheets of one tree (einstruct's ab_d2 beside its stirred twin)
 * and a take-down still reaches visitors. `id` is a content hash on the
 * media host, used only when the database did not answer (single-player);
 * once it has answered, an exhibit ref with nothing hung shows nothing.
 * `path` is a dev directory. Precedence: exhibit, id, path.
 */
export const ExhibitRefSchema = z.looseObject({
  tree: z.string().min(1),
  kind: z.enum(["tape", "video", "still"]),
  bundle: z.string().default(""),
});

export const BundleRefSchema = z
  .looseObject({
    id: z.string().default(""),
    path: z.string().default(""),
    exhibit: ExhibitRefSchema.optional(),
  })
  .refine((b) => b.id.length > 0 || b.path.length > 0 || b.exhibit !== undefined, {
    message: "a bundle ref needs an id, a path or an exhibit",
  });

const HangingCommon = {
  id: z.string().min(1),
  title: z.string().default(""),
  bundle: BundleRefSchema,
  position: Vec3,
  rotationDeg: Vec3.default([0, 0, 0]),
};

export const TapeHangingSchema = z.looseObject({
  ...HangingCommon,
  kind: z.literal("tape"),
  /** The tape box is scaled so its longest side measures this many metres. */
  longSideMeters: z.number().positive().default(6),
  /** Force a bundle variant (e.g. "phone" for a tape seen only from afar); empty picks by device tier. */
  variant: z.string().default(""),
  /** Colours by species index, CSS; a tape whose species mean something names them (LAWS 12). */
  palette: z.array(z.string()).default([]),
  /** Point size in pixels at 1 m; a tape of a few particles wants a larger one. */
  pointSize: z.number().positive().default(14),
  pedestal: z
    .looseObject({ position: Vec3, rotationDeg: Vec3.default([0, 0, 0]) })
    .optional(),
});

export const VideoHangingSchema = z.looseObject({
  ...HangingCommon,
  kind: z.literal("video"),
  widthMeters: z.number().positive().default(6),
});

/**
 * A still on a wall. `marker` names a poster marker in the room's glb
 * (`role: "poster"`, e.g. the hall's `poster_wall`) whose position, facing
 * and size then override `position`, `rotationDeg` and the metres here; the
 * literal values are the fallback for the grey shell.
 */
export const StillHangingSchema = z.looseObject({
  ...HangingCommon,
  kind: z.literal("still"),
  marker: z.string().default(""),
  widthMeters: z.number().positive().default(6),
  heightMeters: z.number().positive().default(3.4),
});

export const HangingSchema = z.discriminatedUnion("kind", [
  TapeHangingSchema,
  VideoHangingSchema,
  StillHangingSchema,
]);

export const RoomSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().default(""),
  /** Designed runtime geometry or the original asset/fallback loader. */
  architecture: z.enum(["legacy", "observatory"]).default("legacy"),
  /** The SpacetimeDB room name this room joins ("grove" for the hall). */
  presence: z.string().min(1),
  /** Empty means "no glb, build the fallback". */
  glb: z.string().default(""),
  /** Lightmap siblings to try in order when the glb does not embed one. */
  lightmap: z.array(z.string()).default([]),
  /** The phone's list, when it has its own tier; empty means `lightmap`. */
  lightmapPhone: z.array(z.string()).default([]),
  /** "box": a grey shell with walls and a ceiling; "ground": a cell of the grounds, floor only. */
  fallback: z
    .looseObject({ kind: z.enum(["box", "ground"]).default("box"), color: z.string().default("#8e968d") })
    .default({ kind: "box", color: "#8e968d" }),
  bounds: BoundsSchema,
  spawn: SpawnSchema,
  doorways: z.array(DoorwaySchema).default([]),
  hangings: z.array(HangingSchema).default([]),
  gameSurfaces: z.array(GameSurfaceSchema).default([]),
  /**
   * Tone-mapping exposure while the visitor is in this room; the eye adapts
   * over about a second on crossing. The bakes are one sun for the whole
   * palace, so the grounds carry about six times the interiors' light and
   * would clip to white at the hall's exposure.
   */
  exposure: z.number().positive().default(1),
});

/**
 * What is outside the windows: a gradient dome with the sun where the bake put
 * it. `sunTravelBlender` is copied verbatim from the bake record
 * (hall.json `lighting.sun_direction_blender`, Blender Z-up, the direction the
 * light travels); the client converts. An asset whose extras carry the same
 * record overrides it.
 */
export const SkySchema = z.looseObject({
  sunTravelBlender: Vec3,
  sunAngleDeg: z.number().positive().default(1.6),
  zenith: z.string().default("#4a78b8"),
  horizon: z.string().default("#d6dfe8"),
  ground: z.string().default("#2f3a2c"),
  sun: z.string().default("#fff1d6"),
  /** Zero leaves only the atmospheric gradient; no invented celestial disc. */
  sunIntensity: z.number().nonnegative().default(1),
  /** Where the numbers came from, for the reader. */
  source: z.string().default(""),
});

export const MansionSchema = z
  .looseObject({
    schema: z.literal("orchard/mansion/1"),
    title: z.string().default(""),
    start: z.string().min(1),
    sky: SkySchema.optional(),
    rooms: z.array(RoomSchema).min(1),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    for (const room of doc.rooms) {
      if (ids.has(room.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate room id "${room.id}"` });
      }
      ids.add(room.id);
    }
    if (!ids.has(doc.start)) {
      ctx.addIssue({ code: "custom", message: `start room "${doc.start}" is not in rooms` });
    }
    const hangingIds = new Set<string>();
    const gameSurfaceIds = new Set<string>();
    for (const room of doc.rooms) {
      for (const door of room.doorways) {
        // A closed door may lead to a room that is not built yet: the door
        // leaf is the promise, and navigation never crosses it.
        if (!ids.has(door.to) && !door.closed) {
          ctx.addIssue({
            code: "custom",
            message: `room "${room.id}" has a doorway to unknown room "${door.to}"`,
          });
        }
      }
      for (const hanging of room.hangings) {
        if (hangingIds.has(hanging.id)) {
          ctx.addIssue({ code: "custom", message: `duplicate hanging id "${hanging.id}"` });
        }
        hangingIds.add(hanging.id);
      }
      for (const surface of room.gameSurfaces) {
        if (gameSurfaceIds.has(surface.id)) {
          ctx.addIssue({ code: "custom", message: `duplicate game surface id "${surface.id}"` });
        }
        gameSurfaceIds.add(surface.id);
      }
    }
  });

export type Bounds = z.infer<typeof BoundsSchema>;
export type Spawn = z.infer<typeof SpawnSchema>;
export type GameSurface = z.infer<typeof GameSurfaceSchema>;
export type Doorway = z.infer<typeof DoorwaySchema>;
export type BundleRef = z.infer<typeof BundleRefSchema>;
export type ExhibitRef = z.infer<typeof ExhibitRefSchema>;
export type TapeHanging = z.infer<typeof TapeHangingSchema>;
export type VideoHanging = z.infer<typeof VideoHangingSchema>;
export type StillHanging = z.infer<typeof StillHangingSchema>;
export type Hanging = z.infer<typeof HangingSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Sky = z.infer<typeof SkySchema>;
export type Mansion = z.infer<typeof MansionSchema>;

export function parseMansion(input: unknown): Mansion {
  return MansionSchema.parse(input);
}

export function roomById(mansion: Mansion, id: string): Room | undefined {
  return mansion.rooms.find((room) => room.id === id);
}
