import { Box3, Group, MathUtils, Vector3, type WebGLRenderer } from "three";
import { MEDIA_BASE } from "../config";
import type { DeviceProfile } from "../device";
import { VideoWall } from "../media/videowall";
import { VideoBundleSchema } from "../tape/bundle";
import type { Provenance } from "../ui/provenance";
import { bundleBaseOf, pickExhibit, type ExhibitRow } from "./exhibits";
import { buildRoom, type RoomShell } from "./rooms";
import { buildSky, sunFromAsset, type SkyDome } from "./sky";
import { TapeExhibit } from "./tape-exhibit";
import type { BundleRef, Mansion, Room } from "./schema";

// Builds the whole mansion out of mansion.json. Rooms first, because they are
// the thing that must exist; hangings after, each allowed to fail on its own —
// a video bundle that is not on R2 yet must not cost the visitor the tape.

export interface BuildWorldOptions {
  mansion: Mansion;
  renderer: WebGLRenderer;
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
   * hangings, never the rooms.
   */
  exhibits?: () => Promise<ExhibitRow[]>;
}

export interface BuiltWorld {
  group: Group;
  tape: TapeExhibit | null;
  video: VideoWall | null;
  /** Streams the mansion in. Resolves when everything that can load has. */
  load(): Promise<void>;
  dispose(): void;
}

/**
 * Where a bundle's directory lives: what the exhibit table hangs on the tree,
 * else a content hash on the media host, else a dev path. Null when the ref
 * names only an exhibit and nothing is hung there yet.
 */
export function bundleUrl(ref: BundleRef, exhibits: Iterable<ExhibitRow> = []): string | null {
  if (ref.exhibit) {
    const row = pickExhibit(exhibits, ref.exhibit.tree, ref.exhibit.kind);
    if (row) return bundleBaseOf(row);
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
  // The outside goes in first: it costs nothing to load, so the very first
  // frame already has a horizon, and the hall's windows never show the page.
  const sky: SkyDome | null = mansion.sky ? buildSky(mansion.sky) : null;
  if (sky) group.add(sky.mesh);

  const world: BuiltWorld = {
    group,
    tape: null,
    video: null,
    load: async () => {
      for (const room of mansion.rooms) {
        const shell = await buildRoom({ room, renderer, onNotice });
        group.add(shell.group);
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
      }

      const wantsExhibits = mansion.rooms.some((room) =>
        room.hangings.some((hanging) => hanging.bundle.exhibit !== undefined),
      );
      const exhibits = wantsExhibits && options.exhibits ? await options.exhibits() : [];

      for (const room of mansion.rooms) {
        for (const hanging of room.hangings) {
          const base = bundleUrl(hanging.bundle, exhibits);
          if (base === null) {
            const ref = hanging.bundle.exhibit;
            onNotice(`${hanging.id}: nothing is hung on ${ref?.tree} as ${ref?.kind} yet`);
            continue;
          }
          if (hanging.kind === "tape") {
            if (world.tape) {
              onNotice(`${hanging.id}: only one tape volume in M0`);
              continue;
            }
            try {
              const tape = await TapeExhibit.load({
                hanging,
                baseUrl: base,
                tier: device.tier,
                pixelRatio: Math.min(window.devicePixelRatio, device.maxPixelRatio),
                onNotice,
              });
              world.tape = tape;
              group.add(tape.group);
              provenance.register({
                id: `tape:${hanging.id}`,
                title: hanging.title || tape.bundle.title,
                bounds: tape.bounds,
                read: () => tape.provenance(),
              });
            } catch (error) {
              onNotice(`tape ${hanging.id}: ${message(error)}`);
            }
          } else {
            try {
              const video = await buildVideo(
                hanging.id,
                hanging.title,
                base,
                hanging,
                provenance,
                onNotice,
              );
              if (video) {
                world.video = video;
                group.add(video.mesh);
              }
            } catch (error) {
              onNotice(`video ${hanging.id}: ${message(error)}`);
            }
          }
        }
      }
    },
    dispose() {
      sky?.dispose();
      world.tape?.dispose();
      world.video?.dispose();
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
  hanging: { position: readonly [number, number, number]; rotationDeg: readonly [number, number, number]; widthMeters: number },
  provenance: Provenance,
  onNotice: (message: string) => void,
): Promise<VideoWall | null> {
  const response = await fetch(`${base}bundle.json`);
  if (!response.ok) throw new Error(`bundle.json: HTTP ${response.status}`);
  const bundle = VideoBundleSchema.parse(await response.json());
  const wall = await VideoWall.create({
    master: base + bundle.master,
    poster: base + bundle.poster,
    widthMeters: hanging.widthMeters,
    aspect: bundle.width / bundle.height,
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
      resolution: `${bundle.width}x${bundle.height}`,
      duration_s: bundle.duration_s,
      produced_by: bundle.produced_by,
      source: bundle.source,
    }),
  });
  return wall;
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
