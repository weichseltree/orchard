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
  /**
   * Where its table stands in the room, when it has one (the orangery's
   * chess table, observatory.ts): the visitor walks up to it to play, and
   * the Guide still opens it from anywhere in the room. `yawDeg` turns the
   * table; the players' stools sit along its x axis.
   */
  position: Vec3.optional(),
  yawDeg: z.number().default(0),
});

/**
 * A repository as a tabletop model (repo-model.ts, ruled 2026-09-17): an
 * area's directories stop being rooms and stand instead as districts of a
 * small city on a table, so the tree's shape stays visible while the rooms
 * are kept for what there is to see. The visitor reads a district by looking
 * at it; one with `room` set glows, because that directory has a room.
 */
export const RepoModelSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().default(""),
  /** The table's centre on the floor, room metres. */
  position: Vec3,
  yawDeg: z.number().default(0),
  /** The model's footprint on the table top: across, then along. */
  size: z.tuple([z.number().positive(), z.number().positive()]).default([2.4, 1.6]),
  tableHeight: z.number().positive().default(0.85),
  /**
   * Whose folders stand on the table: repos/<repo>.json beside this file, a
   * list of {path, bytes, sentence, room}. Kept out of mansion.json because
   * this document loads at startup and the table's sentences need not.
   */
  repo: z.string().min(1),
});

export const RepoEntrySchema = z.looseObject({
  /** Relative to the repository root, "/"-separated; parents the list does not name are implied. */
  path: z.string().min(1),
  bytes: z.number().nonnegative().default(0),
  sentence: z.string().default(""),
  /** The room that shows this directory's content, when it has one. */
  room: z.string().default(""),
});

/**
 * A short record on a wall: one line of what an experiment asked and what
 * came back (arcedit's record room). Where it hangs lives here; its words
 * live in the labels, `rooms[<room>].lines[<key>]`, in every language.
 */
export const WallLineSchema = z.looseObject({
  id: z.string().min(1),
  key: z.string().min(1),
  /** The plate's centre, room metres, on the wall's face. */
  position: Vec3,
  rotationDeg: Vec3.default([0, 0, 0]),
  /** The stretch of wall the line owns; the plate is centred in it. */
  widthMeters: z.number().positive().default(3.6),
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
  /**
   * The room this door's sign names, when that is not the room it opens on:
   * the stairs down to the cellar are signed "club", because the room beyond
   * them is what a visitor is walking towards (ruled 2026-09-17).
   */
  signRoom: z.string().default(""),
  /**
   * The going of the flight this door builds in the lower room, metres per
   * step, where the default (terrain.ts's STAIR_TREAD) is too steep for the
   * descent: a longer tread makes a gentler stair of the same rise.
   */
  treadMeters: z.number().positive().optional(),
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
  kind: z.enum(["tape", "video", "still", "planet", "model"]),
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
  /**
   * Another tape hanging's id whose clock this one follows frame for frame,
   * so two runs from one checkpoint (phototroph's lit and dark floors)
   * advance together whatever each waited on while loading. Empty: its own clock.
   */
  clockWith: z.string().default(""),
  pedestal: z
    .looseObject({ position: Vec3, rotationDeg: Vec3.default([0, 0, 0]) })
    .optional(),
});

export const VideoHangingSchema = z.looseObject({
  ...HangingCommon,
  kind: z.literal("video"),
  widthMeters: z.number().positive().default(6),
  /**
   * Slower or faster than the clip's own clock; 1 is as recorded. The hall's
   * film runs at a quarter speed as a moving picture rather than an excerpt.
   * Browsers clamp: Firefox goes no slower than 0.25, so that is the floor
   * a document should use. Every wall loops.
   */
  playbackRate: z.number().positive().max(16).default(1),
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

/**
 * spectre's cutaway worlds (a `planet` bundle, orchard/planet.py) placed in
 * a room. One hanging draws every world the bundle carries: `worlds` says
 * where each goes, keyed by the bundle's world name, and `radiusMeters` is
 * what one reference radius (the bundle's R_REF) measures here, so the same
 * bundle stands at walking scale in a chamber and at solar scale in the
 * Orrery. `cutToward` turns a world's removed quarter to face a point (the
 * visitor's landing); `rotationDeg` is the alternative for an explicit turn.
 * The bundle names its own atlas videos by id, so the hanging pins one id;
 * `atlas` chooses the display mode.
 */
export const PlanetWorldSchema = z.looseObject({
  world: z.string().min(1),
  position: Vec3,
  rotationDeg: Vec3.default([0, 0, 0]),
  cutToward: Vec3.optional(),
});

export const PlanetHangingSchema = z.looseObject({
  ...HangingCommon,
  kind: z.literal("planet"),
  radiusMeters: z.number().positive().default(1),
  atlas: z.enum(["beauty", "species", "temperature", "pressure"]).default("beauty"),
  worlds: z.array(PlanetWorldSchema).min(1),
});

/**
 * A glTF model (a `model` bundle, `orchard bundle model`) standing in a room.
 * `position` is the point on the floor it stands over; the model is scaled
 * uniformly so the longest side of its bundle's bbox measures `sizeMeters`,
 * centred over `position` with its lowest point on the plinth's top (or on
 * the floor, with no plinth). `rotationDeg[1]` turns it, and
 * `yawSpinDegPerSec` keeps turning it, a slow turntable (0 stands still;
 * phones always stand still).
 */
export const ModelHangingSchema = z.looseObject({
  ...HangingCommon,
  kind: z.literal("model"),
  sizeMeters: z.number().positive().default(1),
  plinth: z.looseObject({ heightMeters: z.number().nonnegative().default(0.9) }).optional(),
  yawSpinDegPerSec: z.number().default(0),
});

/**
 * A live audio exhibit's name: `audio/live/<provider>/<stream-id>`
 * (AUDIO-STREAM.md §1). It is a name with no bytes behind it -- never cached,
 * never immutable, never hashed -- which is why it is NOT a `BundleRef`. The
 * service worker recognises the same shape on the path alone
 * (`grove/src/sw/policy.ts`).
 */
export const LiveAudioRefSchema = z.looseObject({
  provider: z.string().min(1),
  streamId: z.string().min(1),
});

/**
 * A stream a visitor stands inside (AUDIO-STREAM.md §5). A stream has no
 * geometry, so a hanging of this kind places the observed system's TOPOLOGY
 * instead: the provider publishes node positions in a unit space and this
 * says where that unit cube stands in the room and how large it is, the way a
 * `planet` hanging owns `radiusMeters`.
 *
 * `live` names an exhibit; `bundle` an archived `audio` bundle. Exactly one,
 * because they obey opposite caching rules.
 */
export const AudioHangingSchema = z
  .looseObject({
    id: z.string().min(1),
    title: z.string().default(""),
    kind: z.literal("audio"),
    live: LiveAudioRefSchema.optional(),
    bundle: BundleRefSchema.optional(),
    /** The unit cube's centre, in room metres. */
    position: Vec3,
    /** What one side of the unit cube measures here; uniform on every axis (audio/topology.ts). */
    sizeMeters: z.number().positive().default(8),
    /** Turn the topology about the room's y, so the DAG faces the visitor's landing. */
    rotationDeg: Vec3.default([0, 0, 0]),
    /**
     * Where the topology document is, when it is not the exhibit's own
     * `topology.json` sibling. A stream with no topology plays as the bed
     * alone -- the §5 fallback, not an error.
     */
    topology: z.string().default(""),
  })
  .refine((h) => (h.live !== undefined) !== (h.bundle !== undefined), {
    message: "an audio hanging takes either a live exhibit or an archived bundle, not both and not neither",
  });

export const HangingSchema = z.discriminatedUnion("kind", [
  TapeHangingSchema,
  VideoHangingSchema,
  StillHangingSchema,
  PlanetHangingSchema,
  ModelHangingSchema,
  AudioHangingSchema,
]);

/**
 * A portal: not an opening in a wall but a blending of two spacetimes at
 * different scales. It is a soft sphere in this room; walking into it fades
 * the destination in and steps the visitor through, scaled. The other end
 * is a sphere of the same kind in the destination room, at `exit`, and
 * brings the visitor back. A portal can only be entered from the room and
 * the scale it was built for: `to` must be a room of a different scale,
 * both ends must lie inside their rooms, and the client refuses a crossing
 * from a body at the wrong scale (portal.ts).
 */
export const PortalSchema = z.looseObject({
  id: z.string().min(1),
  to: z.string().min(1),
  /** The centre of the blend, metres; put it at eye height so the eye passes its middle. */
  position: Vec3,
  radius: z.number().positive().default(3),
  exit: z.looseObject({
    position: Vec3,
    radius: z.number().positive().default(3),
  }),
});

export const VenueNeedSchema = z.enum(["microphone", "sound", "immersive"]);

export const RoomSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().default(""),
  /** Designed runtime geometry ("observatory" rooms, "space" for the Orrery) or the original asset/fallback loader. */
  architecture: z.enum(["legacy", "observatory", "space"]).default("legacy"),
  /**
   * A room with no lid: a court sunk between the rooms around it, open to the
   * sky instead of vaulted. Its rim is the floor of its neighbours above, so
   * each of them draws the parapet along the wall it shares with the court
   * (observatory.ts's `grounds`) — without that a walker meets the drop with
   * nothing to see and nothing to lean on. The club's sunken court between
   * the terrace's two arms is the first (2026-09-17).
   */
  openToSky: z.boolean().default(false),
  /**
   * How large this room's metre is, seen from the palace, whose rooms are 1.
   * The Orrery is 0.02: through the portal its eighty-metre worlds are globes
   * a metre and a half across, hanging inside the armillary, and a visitor
   * who steps in shrinks fifty times to match. Rooms of one scale are drawn
   * together; a portal is the only way between scales.
   */
  scale: z.number().positive().default(1),
  /** Portals out of this room; each implies its return end in the destination. */
  portals: z.array(PortalSchema).default([]),
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
  /**
   * The room's box. `min[1]` is the floor: rooms may stand at different
   * heights, and a doorway between two floors gets a flight of steps in the
   * lower room (terrain.ts, observatory.ts), so a raised wing is a change
   * of one number here and nothing else.
   */
  bounds: BoundsSchema,
  /** The body's feet on the room's floor; `position[1]` should equal `bounds.min[1]`. */
  spawn: SpawnSchema,
  doorways: z.array(DoorwaySchema).default([]),
  hangings: z.array(HangingSchema).default([]),
  gameSurfaces: z.array(GameSurfaceSchema).default([]),
  repoModels: z.array(RepoModelSchema).default([]),
  wallLines: z.array(WallLineSchema).default([]),
  /**
   * Tone-mapping exposure while the visitor is in this room; the eye adapts
   * over about a second on crossing. The bakes are one sun for the whole
   * palace, so the grounds carry about six times the interiors' light and
   * would clip to white at the hall's exposure.
   */
  exposure: z.number().positive().default(1),
  /**
   * What a visitor must have switched on to be let in (world/venue.ts): the
   * club's door opens only to a microphone and sound that are on, its stage
   * only to an immersive session. Checked at the doorway, like a lock; a
   * shared link into such a room lands in the nearest room that asks nothing.
   */
  requires: z.array(VenueNeedSchema).default([]),
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

/**
 * A mound of the grounds: a smooth, compactly supported bump (terrain.ts).
 * The height field is one function shared by the ground mesh, the trees and
 * the body's feet, so a hill you see is a hill you climb. Mounds shape only
 * the cells of the grounds; a room's floor is flat at its own base.
 */
export const MoundSchema = z.looseObject({
  x: z.number(),
  z: z.number(),
  radius: z.number().positive(),
  height: z.number(),
});

export const TerrainSchema = z.looseObject({
  mounds: z.array(MoundSchema).default([]),
});

export const MansionSchema = z
  .looseObject({
    schema: z.literal("orchard/mansion/1"),
    title: z.string().default(""),
    start: z.string().min(1),
    sky: SkySchema.optional(),
    /** The lie of the land outside; absent means flat grounds. */
    terrain: TerrainSchema.default({ mounds: [] }),
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
        if (hanging.kind === "tape" && hanging.clockWith) {
          const leader = room.hangings.find((other) => other.id === hanging.clockWith);
          if (!leader || leader.kind !== "tape" || leader.clockWith) {
            ctx.addIssue({
              code: "custom",
              message: `tape "${hanging.id}" follows the clock of "${hanging.clockWith}", which is not a leading tape in room "${room.id}"`,
            });
          }
        }
      }
      for (const surface of room.gameSurfaces) {
        if (gameSurfaceIds.has(surface.id)) {
          ctx.addIssue({ code: "custom", message: `duplicate game surface id "${surface.id}"` });
        }
        gameSurfaceIds.add(surface.id);
        if (surface.position && !withinFootprint(room, surface.position)) {
          ctx.addIssue({ code: "custom", message: `game surface "${surface.id}" stands outside "${room.id}"` });
        }
      }
      for (const model of room.repoModels) {
        const [w, d] = model.size;
        const reach = Math.hypot(w, d) / 2 + 0.2;
        // The whole table, turned any way, must stand inside the room's walls.
        const corners = [[-reach, -reach], [reach, reach]].map(([dx, dz]) => [model.position[0] + dx!, model.position[1], model.position[2] + dz!] as [number, number, number]);
        if (!corners.every((corner) => withinFootprint(room, corner))) {
          ctx.addIssue({ code: "custom", message: `repo model "${model.id}" stands outside "${room.id}"` });
        }
      }
      for (const door of room.doorways) {
        if (door.closed) continue;
        const other = doc.rooms.find((r) => r.id === door.to);
        if (!other) continue;
        // Both rooms must know the opening, or one side walks through a wall.
        const twin = other.doorways.find((d) => d.to === room.id && d.axis === door.axis && Math.abs(d.at - door.at) < 1e-6 && Math.abs(d.center - door.center) < 1e-6);
        if (!twin) {
          ctx.addIssue({ code: "custom", message: `doorway ${room.id} -> ${door.to} at ${door.axis}=${door.at}, ${door.center} is not listed by "${door.to}"` });
        }
      }
      // A gated room is entered from a doorway, so there must be one leading
      // in from a room that asks less; otherwise nobody could ever get in.
      if (room.requires.length > 0) {
        const approach = room.doorways.some((door) => {
          const other = doc.rooms.find((r) => r.id === door.to);
          return !!other && !door.closed && other.requires.every((need) => room.requires.includes(need)) && other.requires.length < room.requires.length;
        });
        if (!approach) ctx.addIssue({ code: "custom", message: `room "${room.id}" requires ${room.requires.join(", ")} but no doorway reaches it from a room that asks less` });
      }
      for (const portal of room.portals) {
        const target = doc.rooms.find((r) => r.id === portal.to);
        if (!target) {
          ctx.addIssue({ code: "custom", message: `room "${room.id}" has a portal to unknown room "${portal.to}"` });
          continue;
        }
        if (target.scale === room.scale) {
          ctx.addIssue({
            code: "custom",
            message: `portal "${portal.id}" joins "${room.id}" and "${portal.to}" at the same scale; a same-scale link is a doorway`,
          });
        }
        if (!withinFootprint(room, portal.position)) {
          ctx.addIssue({ code: "custom", message: `portal "${portal.id}" is outside "${room.id}"` });
        }
        if (!withinFootprint(target, portal.exit.position)) {
          ctx.addIssue({ code: "custom", message: `portal "${portal.id}" exits outside "${portal.to}"` });
        }
      }
    }
  });

function withinFootprint(room: { bounds: { min: [number, number, number]; max: [number, number, number] } }, p: [number, number, number]): boolean {
  return p[0] >= room.bounds.min[0] && p[0] <= room.bounds.max[0] && p[2] >= room.bounds.min[2] && p[2] <= room.bounds.max[2];
}

export type Bounds = z.infer<typeof BoundsSchema>;
export type Spawn = z.infer<typeof SpawnSchema>;
export type GameSurface = z.infer<typeof GameSurfaceSchema>;
export type RepoModel = z.infer<typeof RepoModelSchema>;
export type RepoEntry = z.infer<typeof RepoEntrySchema>;
export type WallLine = z.infer<typeof WallLineSchema>;
export type Doorway = z.infer<typeof DoorwaySchema>;
export type BundleRef = z.infer<typeof BundleRefSchema>;
export type ExhibitRef = z.infer<typeof ExhibitRefSchema>;
export type TapeHanging = z.infer<typeof TapeHangingSchema>;
export type VideoHanging = z.infer<typeof VideoHangingSchema>;
export type StillHanging = z.infer<typeof StillHangingSchema>;
export type PlanetHanging = z.infer<typeof PlanetHangingSchema>;
export type PlanetWorld = z.infer<typeof PlanetWorldSchema>;
export type ModelHanging = z.infer<typeof ModelHangingSchema>;
export type LiveAudioRef = z.infer<typeof LiveAudioRefSchema>;
export type AudioHanging = z.infer<typeof AudioHangingSchema>;
export type Portal = z.infer<typeof PortalSchema>;
export type Hanging = z.infer<typeof HangingSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type VenueNeed = z.infer<typeof VenueNeedSchema>;
export type Sky = z.infer<typeof SkySchema>;
export type Mound = z.infer<typeof MoundSchema>;
export type Terrain = z.infer<typeof TerrainSchema>;
export type Mansion = z.infer<typeof MansionSchema>;

export function parseMansion(input: unknown): Mansion {
  return MansionSchema.parse(input);
}

export function roomById(mansion: Mansion, id: string): Room | undefined {
  return mansion.rooms.find((room) => room.id === id);
}
