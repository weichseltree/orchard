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
});

/** Which bundle a hanging shows: a content hash on the media host, or a dev path. */
export const BundleRefSchema = z
  .looseObject({ id: z.string().default(""), path: z.string().default("") })
  .refine((b) => b.id.length > 0 || b.path.length > 0, {
    message: "a bundle ref needs an id or a path",
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
  pedestal: z
    .looseObject({ position: Vec3, rotationDeg: Vec3.default([0, 0, 0]) })
    .optional(),
});

export const VideoHangingSchema = z.looseObject({
  ...HangingCommon,
  kind: z.literal("video"),
  widthMeters: z.number().positive().default(6),
});

export const HangingSchema = z.discriminatedUnion("kind", [
  TapeHangingSchema,
  VideoHangingSchema,
]);

export const RoomSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().default(""),
  /** The SpacetimeDB room name this room joins ("grove" for the hall). */
  presence: z.string().min(1),
  /** Empty means "no glb, build the fallback". */
  glb: z.string().default(""),
  /** Lightmap siblings to try in order when the glb does not embed one. */
  lightmap: z.array(z.string()).default([]),
  fallback: z
    .looseObject({ kind: z.literal("box"), color: z.string().default("#8e968d") })
    .default({ kind: "box", color: "#8e968d" }),
  bounds: BoundsSchema,
  spawn: SpawnSchema,
  doorways: z.array(DoorwaySchema).default([]),
  hangings: z.array(HangingSchema).default([]),
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
    for (const room of doc.rooms) {
      for (const door of room.doorways) {
        if (!ids.has(door.to)) {
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
    }
  });

export type Bounds = z.infer<typeof BoundsSchema>;
export type Spawn = z.infer<typeof SpawnSchema>;
export type Doorway = z.infer<typeof DoorwaySchema>;
export type BundleRef = z.infer<typeof BundleRefSchema>;
export type TapeHanging = z.infer<typeof TapeHangingSchema>;
export type VideoHanging = z.infer<typeof VideoHangingSchema>;
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
