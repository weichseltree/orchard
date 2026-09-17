import {
  Box3,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  MathUtils,
  Quaternion,
  Vector3,
} from "three";
import type { Renderer } from "../render/types";
import { MEDIA_BASE, PALETTE } from "../config";
import type { DeviceProfile } from "../device";
import type { ChunkScheduler } from "../render/chunk-stream";
import type { DeviceTier } from "../tape/bundle";
import type { StillPanel } from "../media/still";
import type { VideoWall } from "../media/videowall";
import type { PlanetExhibit } from "./planet-exhibit";
import type { AudioExhibit } from "./audio-exhibit";
import { StillBundleSchema, VideoBundleSchema } from "../tape/bundle";
import type { Provenance } from "../ui/provenance";
import { bundleBaseOf, pickExhibit, type ExhibitRow } from "./exhibits";
import type { PosterMarker, RoomShell } from "./rooms";
import { buildSky, sunFromAsset, type SkyDome } from "./sky";
import type { TapeExhibit } from "./tape-exhibit";
import type { Labels } from "./labels/index";
import type { BundleRef, Mansion, Room, StillHanging } from "./schema";

// Builds the whole mansion out of mansion.json. Rooms first, because they are
// the thing that must exist; hangings after, each allowed to fail on its own —
// a video bundle that is not on R2 yet must not cost the visitor the tape.

export interface BuildWorldOptions {
  mansion: Mansion;
  renderer: Renderer;
  device: DeviceProfile;
  provenance: Provenance;
  onNotice: (message: string) => void;
  /**
   * Called as each room's shell lands, with whatever the asset said about
   * itself. The caller uses it to put the body on the asset's own spawn.
   */
  onRoomReady?: (room: Room, shell: RoomShell) => void;
  /**
   * The live exhibit table, when a hanging asks for one. Awaited once, after
   * the rooms are up; a resolver that never answers holds up only the
   * hangings, never the rooms. `null` means the database did not answer,
   * which is different from answering with nothing hung.
   */
  exhibits?: () => Promise<ExhibitRow[] | null>;
  /** The AudioContext a live audio exhibit joins (audio/gate.ts); each makes its own when absent. */
  audioContext?: () => Promise<AudioContext>;
  /** The room the visitor starts in; `mansion.start` when absent. */
  startRoom?: string;
  scheduler?: ChunkScheduler;
  /**
   * The language of the wall text (labels/<locale>.json), "en" when absent.
   * A language file that fails to load falls back to English; only when
   * English fails too do the rooms go without plaques, with a notice.
   */
  locale?: string;
}

export interface BuiltWorld {
  group: Group;
  /**
   * Every tape volume, in hanging order; the HUD's transport drives them all in
   * step. A slot is null while its tape is still loading (and until every
   * hanging has settled), so every loop over this skips nulls.
   */
  tapes: Array<TapeExhibit | null>;
  /** The first tape, for the HUD's readouts. */
  readonly tape: TapeExhibit | null;
  videos: VideoWall[];
  /** The first video wall, for the audio toggle. */
  readonly video: VideoWall | null;
  stills: StillPanel[];
  /** spectre's cutaway worlds, wherever they stand. */
  planets: PlanetExhibit[];
  /**
   * Live audio exhibits. The frame loop hands each one the visitor's head
   * (`setListener`) and re-ranks its sources a few times a second
   * (`reassign`); nothing else drives them.
   */
  audios: AudioExhibit[];
  /** Streams the start room's neighbourhood in. Resolves when everything that can load has. */
  load(): Promise<void>;
  /** Loads more rooms (a doorway crossing widens the neighbourhood); rooms already loaded are skipped. */
  ensureRooms(ids: readonly string[]): Promise<void>;
  /**
   * Resolves once every load in flight, and every load those started (a
   * room's shell, its hangings, its wall text, door names and reading
   * stands), has landed or failed. The quality suite's room tour waits on
   * it, so what one lap built is drawn before the next lap counts (issue #6).
   */
  settled(): Promise<void>;
  /**
   * Draw the rooms of one scale and hide the rest. Rooms of different scales
   * share one coordinate space but never one view: a portal's far view shows
   * the other scale, and stepping through it switches this.
   */
  setScaleVisible(scale: number): void;
  dispose(): void;
}

/**
 * The rooms worth having loaded when the visitor stands in `roomId`: the
 * room, every room within `depth` open doorways of it, and, as soon as one
 * of those is a cell of the grounds, every cell, because the grounds are one
 * view seen through the windows and across the parterre. A palace of
 * thirteen rooms and their lightmaps is not resident at once; it grows as
 * you walk (DEVICE-TIERS.md, "rooms by adjacency").
 */
export function neighbourhood(mansion: Mansion, roomId: string, depth = 2): string[] {
  const dist = new Map<string, number>([[roomId, 0]]);
  const queue = [roomId];
  while (queue.length) {
    const id = queue.shift()!;
    const d = dist.get(id)!;
    if (d >= depth) continue;
    const room = mansion.rooms.find((r) => r.id === id);
    const next: string[] = [];
    for (const door of room?.doorways ?? []) if (!door.closed) next.push(door.to);
    // A portal is a neighbour too, both ways: its far view is the other room.
    for (const portal of room?.portals ?? []) next.push(portal.to);
    for (const other of mansion.rooms) if (other.portals.some((p) => p.to === id)) next.push(other.id);
    for (const to of next) {
      if (dist.has(to)) continue;
      if (!mansion.rooms.some((r) => r.id === to)) continue;
      dist.set(to, d + 1);
      queue.push(to);
    }
  }
  const out = [...dist.keys()];
  const isCell = (id: string) => mansion.rooms.find((r) => r.id === id)?.fallback.kind === "ground";
  if (out.some(isCell)) {
    for (const room of mansion.rooms) {
      if (room.fallback.kind === "ground" && !dist.has(room.id)) out.push(room.id);
    }
  }
  return out;
}

/** The room each exhibit hangs in; the client plays what is in the visitor's room. */
const roomOf = new WeakMap<object, string>();
export function exhibitRoom(exhibit: object): string | undefined {
  return roomOf.get(exhibit);
}

/**
 * Where a bundle's directory lives. When the ref names an exhibit and the
 * database answered (`exhibits` is not null), the table decides alone: what
 * hangs there, or null when nothing does, so a take-down reaches visitors
 * instead of falling back to the pinned id of the bundle just taken down.
 * Only when the database did not answer does the pinned content hash on the
 * media host stand in, else a dev path.
 */
export function bundleUrl(
  ref: BundleRef,
  exhibits: Iterable<ExhibitRow> | null = null,
): string | null {
  if (ref.exhibit && exhibits !== null) {
    const row = pickExhibit(exhibits, ref.exhibit.tree, ref.exhibit.kind, ref.exhibit.bundle);
    return row ? bundleBaseOf(row) : null;
  }
  if (ref.id) return `${MEDIA_BASE}/${ref.id}/`;
  if (ref.path) return ref.path.endsWith("/") ? ref.path : `${ref.path}/`;
  return null;
}

/**
 * Builds the mansion out of the scene document. The group is returned empty
 * and filled as things land, so the first frame is a room rather than a black
 * page: on a phone the glb, the tape's bundle.json and the video's bundle.json
 * are seconds of network, and none of them may hold up the others.
 */
export function buildWorld(options: BuildWorldOptions): BuiltWorld {
  const { mansion, renderer, device, provenance, onNotice } = options;
  const group = new Group();
  group.name = "mansion";
  // The Observatory shades its architecture in shared vertex-coloured batches.
  // These two inexpensive lights give pedestals and avatars their form; the
  // scientific tapes and media retain their own unlit, ungraded colours.
  const observatory = mansion.rooms.some((room) => room.architecture === "observatory");
  const ambient = observatory
    ? new HemisphereLight(0xb6cee8, 0x283544, 0.6)
    : new HemisphereLight(0xd6dfd7, 0x4a544b, 0.35);
  ambient.name = "mansion-ambient";
  group.add(ambient);
  if (observatory) {
    const key = new DirectionalLight(0xffdcb0, 0.9);
    key.name = "observatory-key";
    key.position.set(-30, 50, 20);
    group.add(key);
  }
  // The outside goes in first: it costs nothing to load, so the very first
  // frame already has a horizon, and the hall's windows never show the page.
  const sky: SkyDome | null = mansion.sky ? buildSky(mansion.sky) : null;
  if (sky) group.add(sky.mesh);
  // The sky belongs to the palace's scale; the Orrery brings its own stars.
  const skyScale = mansion.rooms.find((r) => r.id === mansion.start)?.scale ?? 1;

  // Everything of a room, shell and hangings, under one group, so a scale can
  // be shown or hidden as a whole.
  const roomGroups = new Map<string, Group>();
  function groupFor(room: Room): Group {
    let roomGroup = roomGroups.get(room.id);
    if (!roomGroup) {
      roomGroup = new Group();
      roomGroup.name = `room-${room.id}`;
      roomGroup.userData = { scale: room.scale };
      roomGroup.visible = room.scale === visibleScale;
      roomGroups.set(room.id, roomGroup);
      group.add(roomGroup);
    }
    return roomGroup;
  }
  let visibleScale = mansion.rooms.find((r) => r.id === (options.startRoom ?? mansion.start))?.scale ?? 1;
  if (sky) sky.mesh.visible = visibleScale === skyScale;

  const shells = new Map<string, RoomShell>();
  const shellLoads = new Map<string, Promise<void>>();
  const hangingLoads = new Map<string, Promise<void>>();
  let exhibitsPromise: Promise<ExhibitRow[] | null> | null = null;
  const exhibitsOnce = () =>
    (exhibitsPromise ??= Promise.resolve()
      .then(() => options.exhibits?.() ?? null)
      .catch((error: unknown) => {
        onNotice(`Live exhibits could not be checked (${message(error)}); using the scene's saved references.`);
        return null;
      }));

  async function loadShell(room: Room): Promise<void> {
    // Runtime architecture needs no GLTF loaders, texture decoders or room
    // downloads. Legacy scene documents can still use their original assets.
    const shell = room.architecture === "observatory"
      ? (await import("./observatory")).buildObservatory(room, mansion)
      : room.architecture === "space"
        ? (await import("./space")).buildSpace(room)
        : await (await import("./rooms")).buildRoom({ room, renderer, tier: device.tier, onNotice, scheduler: options.scheduler });
    shells.set(room.id, shell);
    groupFor(room).add(shell.group);
    applyMarkers(room, shell);
    // A baked room knows where its sun was; the dome follows the asset.
    const assetSun = sunFromAsset(shell.provenance);
    if (sky && assetSun) sky.setSun(assetSun);
    provenance.register({
      id: `room:${room.id}`,
      title: room.title || room.id,
      bounds: roomBox(room),
      rank: 1,
      read: () => shell.provenance,
    });
    options.onRoomReady?.(room, shell);
    // A reading stand at every tape, from the document alone, so it stands
    // whether or not the tape loads and the wall text has a plate to face.
    for (const hanging of room.hangings) {
      if (hanging.kind !== "tape" || stands.has(hanging.id)) continue;
      stands.set(hanging.id, track(import("./stand").then(({ buildStand, standFoot, standFrame }) => {
        const foot = standFoot(hanging, room.bounds.min[1]);
        const stand = buildStand(standFrame(foot.position, foot.rotationDeg), PALETTE.accent);
        groupFor(room).add(stand.group);
        return stand;
      })));
    }
    // The museum's wall text: an introduction panel and one label per
    // exhibit, in the visitor's language. Text on the walls is not a room,
    // so it never holds a room up; it lands when the language file has.
    void track(labelsOnce().then((labels) => {
      if (!labels || labelGroups.has(room.id)) return;
      return import("./labels").then(({ buildRoomLabels }) => {
        const group = buildRoomLabels(room, labels, locale, { mansion });
        labelGroups.set(room.id, group);
        groupFor(room).add(group);
        // The names over the doors, in brass letters; the typeface loads once, with the first room.
        return import("./door-signs").then(async ({ planDoorSigns, fontOnce, buildDoorSigns }) => {
          const signs = planDoorSigns(room, labels, mansion);
          if (signs.length === 0) return;
          const font = await fontOnce();
          if (labelGroups.get(room.id) === group) group.add(buildDoorSigns(room, signs, font));
        });
      });
    }).catch((error: unknown) => onNotice(`labels ${room.id}: ${message(error)}`)));
  }

  /** Every load in flight; a load that starts another adds it here too, so `settled` follows the chain. */
  const inflight = new Set<Promise<unknown>>();
  function track<T>(load: Promise<T>): Promise<T> {
    inflight.add(load);
    load.finally(() => inflight.delete(load)).catch(() => undefined);
    return load;
  }
  async function settled(): Promise<void> {
    while (inflight.size > 0) await Promise.allSettled([...inflight]);
  }

  const locale = options.locale ?? "en";
  const labelGroups = new Map<string, Group>();
  const stands = new Map<string, Promise<import("./stand").Stand>>();
  let labelsPromise: Promise<Labels | null> | null = null;
  const labelsOnce = () =>
    (labelsPromise ??= import("./labels/index").then(({ labelsFor }) =>
      labelsFor(locale).catch((error: unknown) => {
        if (locale === "en") throw error;
        onNotice(`Wall text in "${locale}" could not load (${message(error)}); showing English.`);
        return labelsFor("en");
      }),
    ).catch((error: unknown) => {
      onNotice(`Wall text could not load: ${message(error)}`);
      return null;
    }));

  function ensureShell(room: Room): Promise<void> {
    const pending = shellLoads.get(room.id);
    if (pending) return pending;
    const loading = track(loadShell(room).catch((error: unknown) => {
      shellLoads.delete(room.id);
      throw error;
    }));
    shellLoads.set(room.id, loading);
    return loading;
  }

  function loadHangings(room: Room, exhibits: ExhibitRow[] | null): Promise<void>[] {
    const pending: Promise<void>[] = [];
    for (const hanging of room.hangings) {
      // A live audio exhibit is resolved before anything else, because it is
      // the one hanging that is NOT a bundle: it is a name with no bytes
      // behind it (AUDIO-STREAM.md §1), so `bundleUrl` has nothing to say
      // about it. An archived `audio` bundle still carries a bundle ref and
      // takes the ordinary path below.
      if (hanging.kind === "audio") {
        const archived = hanging.bundle ? bundleUrl(hanging.bundle, exhibits) : null;
        if (hanging.bundle && archived === null) {
          const ref = hanging.bundle.exhibit;
          onNotice(`${hanging.id}: nothing is hung on ${ref?.tree} as ${ref?.kind} yet`);
          continue;
        }
        pending.push(
          Promise.all([import("./audio-exhibit"), options.audioContext?.()]).then(([{ AudioExhibit }, context]) => AudioExhibit.load({
            hanging, archivedBase: archived, tier: device.tier, onNotice,
            ...(context ? { context } : {}),
          }))
            .then((audio) => {
              world.audios.push(audio);
              roomOf.set(audio, room.id);
              provenance.register({
                id: `audio:${hanging.id}`,
                title: hanging.title,
                bounds: audio.bounds,
                read: () => audio.provenance(),
              });
            })
            .catch((error: unknown) => onNotice(`audio ${hanging.id}: ${message(error)}`)),
        );
        continue;
      }
      const base = bundleUrl(hanging.bundle, exhibits);
      if (base === null) {
        const ref = hanging.bundle.exhibit;
        onNotice(`${hanging.id}: nothing is hung on ${ref?.tree} as ${ref?.kind} yet`);
        continue;
      }
      if (hanging.kind === "tape") {
        pending.push(
          import("./tape-exhibit").then(async ({ TapeExhibit }) => TapeExhibit.load({
            hanging,
            ...(stands.has(hanging.id) ? { stand: await stands.get(hanging.id)! } : {}),
            baseUrl: base,
            tier: device.tier,
            pixelRatio: Math.min(window.devicePixelRatio, device.maxPixelRatio),
            onNotice,
            floorY: room.bounds.min[1],
            ...(options.scheduler ? { scheduler: options.scheduler } : {}),
          }))
            .then((tape) => {
              world.tapes.push(tape);
              roomOf.set(tape, room.id);
              groupFor(room).add(tape.group);
              provenance.register({
                id: `tape:${hanging.id}`,
                title: hanging.title || tape.bundle.title,
                bounds: tape.bounds,
                read: () => tape.provenance(),
              });
            })
            .catch((error: unknown) => onNotice(`tape ${hanging.id}: ${message(error)}`)),
        );
      } else if (hanging.kind === "still") {
        pending.push(
          buildStill(
            hanging,
            base,
            device.tier,
            shells.get(room.id)?.markers.posters.get(hanging.marker) ?? null,
            provenance,
            onNotice,
          )
            .then((still) => {
              world.stills.push(still);
              roomOf.set(still, room.id);
              groupFor(room).add(still.mesh);
            })
            .catch((error: unknown) => onNotice(`still ${hanging.id}: ${message(error)}`)),
        );
      } else if (hanging.kind === "planet") {
        pending.push(
          import("./planet-exhibit").then(({ PlanetExhibit }) => PlanetExhibit.load({ hanging, baseUrl: base, onNotice }))
            .then((planet) => {
              world.planets.push(planet);
              roomOf.set(planet, room.id);
              groupFor(room).add(planet.group);
              provenance.register({
                id: `planet:${hanging.id}`,
                title: hanging.title || planet.bundle.title,
                bounds: planet.bounds,
                read: () => planet.provenance(),
              });
            })
            .catch((error: unknown) => onNotice(`planet ${hanging.id}: ${message(error)}`)),
        );
      } else {
        pending.push(
          buildVideo(hanging.id, hanging.title, base, hanging, provenance, onNotice)
            .then((video) => {
              if (!video) return;
              world.videos.push(video);
              roomOf.set(video, room.id);
              groupFor(room).add(video.mesh);
            })
            .catch((error: unknown) => onNotice(`video ${hanging.id}: ${message(error)}`)),
        );
      }
    }
    return pending;
  }

  /**
   * Keep the full neighbourhood for windows and open doorways. A room's
   * hangings start as soon as its shell lands, while the next shell loads:
   * the visitor's first tape never waits for the rest of the palace.
   * Concurrent calls share in-flight work and wait for it to settle.
   */
  async function ensureRooms(ids: readonly string[]): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const id of ids) {
      const room = mansion.rooms.find((r) => r.id === id);
      if (!room) continue;
      await ensureShell(room);
      let hangings = hangingLoads.get(id);
      if (!hangings) {
        // A live audio hanging has no bundle at all, so it never wants the
        // exhibit table; an archived one may.
        const wantsExhibits = room.hangings.some((hanging) => hanging.bundle?.exhibit !== undefined);
        hangings = track((wantsExhibits ? exhibitsOnce() : Promise.resolve(null))
          .then((exhibits) => Promise.all(loadHangings(room, exhibits)))
          .then(() => undefined));
        hangingLoads.set(id, hangings);
      }
      pending.push(hangings);
    }
    await Promise.all(pending);
  }

  const world: BuiltWorld = {
    group,
    tapes: [],
    get tape() {
      return this.tapes.find((t) => t !== null) ?? null;
    },
    videos: [],
    get video() {
      return this.videos.find((v) => v !== null) ?? null;
    },
    stills: [],
    planets: [],
    audios: [],
    load: () => ensureRooms(neighbourhood(mansion, options.startRoom ?? mansion.start)),
    ensureRooms: (ids) => ensureRooms(ids),
    settled,
    setScaleVisible(scale) {
      visibleScale = scale;
      for (const roomGroup of roomGroups.values()) roomGroup.visible = roomGroup.userData.scale === scale;
      if (sky) sky.mesh.visible = scale === skyScale;
    },
    dispose() {
      sky?.dispose();
      for (const tape of world.tapes) tape?.dispose();
      for (const video of world.videos) video.dispose();
      for (const still of world.stills) still.dispose();
      for (const planet of world.planets) planet.dispose();
      for (const audio of world.audios) audio.dispose();
      for (const stand of stands.values()) void stand.then((s) => s.dispose());
      stands.clear();
      if (labelGroups.size) {
        void import("./labels").then(({ disposeRoomLabels }) => {
          for (const group of labelGroups.values()) disposeRoomLabels(group);
          labelGroups.clear();
        });
      }
    },
  };
  return world;
}

/**
 * The asset is the authority on where things physically are. mansion.json owns
 * the graph — which room, which doorway leads where — and the glb's markers
 * own the metres. Copying metres by hand is how the two drifted 0.5 m apart.
 */
function applyMarkers(room: Room, shell: RoomShell): void {
  const spawn = shell.markers.spawn;
  if (spawn) {
    room.spawn.position = spawn.position;
    room.spawn.yawDeg = spawn.yawDeg;
    // `extras.eye_height_m` is the height WP3 rendered its preview from, not
    // an instruction (WP3-hall-bake.md); the client owns the eye height.
  }
  for (const door of room.doorways) {
    const marker = shell.markers.doors.get(door.to);
    if (!marker) continue;
    door.at = marker.at;
    door.center = marker.center;
    door.width = marker.width;
    door.height = marker.height;
  }
}

async function buildVideo(
  id: string,
  title: string,
  base: string,
  hanging: { position: readonly [number, number, number]; rotationDeg: readonly [number, number, number]; widthMeters: number; playbackRate: number },
  provenance: Provenance,
  onNotice: (message: string) => void,
): Promise<VideoWall | null> {
  const { VideoWall } = await import("../media/videowall");
  const response = await fetch(`${base}bundle.json`);
  if (!response.ok) throw new Error(`bundle.json: HTTP ${response.status}`);
  const bundle = VideoBundleSchema.parse(await response.json());
  const wall = await VideoWall.create({
    master: base + bundle.master,
    poster: base + bundle.poster,
    widthMeters: hanging.widthMeters,
    aspect: bundle.width / bundle.height,
    playbackRate: hanging.playbackRate,
    onNotice,
  });
  const [x, y, z] = hanging.position;
  wall.mesh.position.set(x, y, z);
  wall.mesh.rotation.set(
    MathUtils.degToRad(hanging.rotationDeg[0]),
    MathUtils.degToRad(hanging.rotationDeg[1]),
    MathUtils.degToRad(hanging.rotationDeg[2]),
  );
  const height = hanging.widthMeters / (bundle.width / bundle.height);
  provenance.register({
    id: `video:${id}`,
    title: title || bundle.title || "Video wall",
    bounds: new Box3().setFromCenterAndSize(
      new Vector3(x, y, z),
      new Vector3(hanging.widthMeters, height, 0.3),
    ),
    read: () => ({
      title: bundle.title,
      tree: bundle.tree,
      bundle_id: bundle.id,
      playback: wall.mode,
      playback_rate: `${wall.playbackRate}x, looping`,
      resolution: `${bundle.width}x${bundle.height}`,
      duration_s: bundle.duration_s,
      produced_by: bundle.produced_by,
      source: bundle.source,
    }),
  });
  return wall;
}

/** The plane's +Z must be the marker's -Z (the panel normal): a half turn about Y. */
const FLIP_Y = /* @__PURE__ */ new Quaternion(0, 1, 0, 0);
/** How far in front of the panel surface the still sits, so it does not z-fight. */
const STILL_STANDOFF_M = 0.01;

/**
 * Where a still goes: on the room's poster marker when the hanging names one
 * the asset has, else where mansion.json says. The marker is the asset's
 * business, exactly as the spawn and the doorway are.
 */
export function placeStill(
  hanging: Pick<StillHanging, "position" | "rotationDeg" | "widthMeters" | "heightMeters">,
  marker: PosterMarker | null,
): { position: Vector3; quaternion: Quaternion; maxWidth: number; maxHeight: number } {
  if (marker) {
    const quaternion = new Quaternion(...marker.quaternion).multiply(FLIP_Y);
    const normal = new Vector3(0, 0, 1).applyQuaternion(quaternion);
    const position = new Vector3(...marker.position).addScaledVector(normal, STILL_STANDOFF_M);
    return { position, quaternion, maxWidth: marker.width, maxHeight: marker.height };
  }
  const quaternion = new Quaternion().setFromEuler(
    new Euler(
      MathUtils.degToRad(hanging.rotationDeg[0]),
      MathUtils.degToRad(hanging.rotationDeg[1]),
      MathUtils.degToRad(hanging.rotationDeg[2]),
    ),
  );
  return {
    position: new Vector3(...hanging.position),
    quaternion,
    maxWidth: hanging.widthMeters,
    maxHeight: hanging.heightMeters,
  };
}

async function buildStill(
  hanging: StillHanging,
  base: string,
  tier: DeviceTier,
  marker: PosterMarker | null,
  provenance: Provenance,
  onNotice: (message: string) => void,
): Promise<StillPanel> {
  const { StillPanel } = await import("../media/still");
  const response = await fetch(`${base}bundle.json`);
  if (!response.ok) throw new Error(`bundle.json: HTTP ${response.status}`);
  const bundle = StillBundleSchema.parse(await response.json());
  const place = placeStill(hanging, marker);
  const still = await StillPanel.create({
    base,
    bundle,
    tier,
    maxWidthMeters: place.maxWidth,
    maxHeightMeters: place.maxHeight,
    onNotice,
  });
  still.mesh.position.copy(place.position);
  still.mesh.quaternion.copy(place.quaternion);
  provenance.register({
    id: `still:${hanging.id}`,
    title: hanging.title || bundle.title || "Still",
    bounds: new Box3().setFromCenterAndSize(
      place.position,
      new Vector3(still.widthMeters, still.heightMeters, 0.3),
    ),
    read: () => ({
      title: bundle.title,
      tree: bundle.tree,
      bundle_id: bundle.id,
      tier: still.tier,
      format: still.format,
      resolution: `${bundle.width}x${bundle.height}`,
      placed_by: marker ? `the asset's ${hanging.marker} marker` : "mansion.json",
      produced_by: bundle.produced_by,
      source: bundle.source,
    }),
  });
  return still;
}

export function roomBox(room: Room): Box3 {
  return new Box3(
    new Vector3(room.bounds.min[0], room.bounds.min[1], room.bounds.min[2]),
    new Vector3(room.bounds.max[0], room.bounds.max[1], room.bounds.max[2]),
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
