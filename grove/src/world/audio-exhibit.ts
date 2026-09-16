import { Box3, Vector3 } from "three";
import { MEDIA_BASE } from "../config";
import { AudioField, type VoiceFactory } from "../audio/field";
import { LIVE_POLL_MS, LIVE_SCORE_FILE, ScoreFollower, parseScore } from "../audio/score-live";
import { scoreVoices } from "../audio/voice";
import { positionedCount } from "../audio/sources";
import { ExhibitStream, type ExhibitStreamState } from "../audio/exhibit";
import { placeTopology, parseTopology, type PlacedNode, type TopologyPlacement } from "../audio/topology";
import type { DeviceTier } from "../tape/bundle";
import type { AudioHanging } from "./schema";

// A live stream hung in a room (AUDIO-STREAM.md §5). Three parts meet here and
// nowhere else:
//
//   the stream    `audio/exhibit.ts`  -- LL-HLS, and silence when it falls behind
//   the topology  `audio/topology.ts` -- where each observed node stands
//   the field     `audio/field.ts`    -- the listener, the bed, the panners
//
// The exhibit is a name with no bytes (§1), so nothing here is hashed, nothing
// is verified against a digest and nothing is cached: the service worker
// refuses to keep anything under the exhibit's path, whatever this file asks
// for.
//
// A missing or unreadable topology is NOT a failure. It means the room does
// not know where the nodes are, so every node folds into the non-positioned
// bed -- which is exactly what the room played before §5 existed. A dead
// stream is silence and the room stays enterable (§3); so is a dead topology.

/** The exhibit's two siblings under `audio/live/<provider>/<stream-id>/`. */
export const PLAYLIST_FILE = "live.m3u8";
export const TOPOLOGY_FILE = "topology.json";

/**
 * Where a hanging's audio lives. A live exhibit is the §1 name on the media
 * host; an archived `audio` bundle is an ordinary content-hashed bundle and
 * `bundleUrl` has already resolved it.
 */
export function exhibitBase(hanging: AudioHanging, archivedBase: string | null): string | null {
  if (hanging.live) {
    const { provider, streamId } = hanging.live;
    return `${MEDIA_BASE}/audio/live/${encodeURIComponent(provider)}/${encodeURIComponent(streamId)}/`;
  }
  return archivedBase;
}

/** The placement the hanging describes: the unit cube's centre, size and turn. */
export function placementOf(hanging: AudioHanging): TopologyPlacement {
  return {
    center: [hanging.position[0], hanging.position[1], hanging.position[2]],
    sizeMeters: hanging.sizeMeters,
    // Only the turn about y means anything to a cube of sound; pitch and roll
    // on a topology would tilt the floor plan of a system, which says nothing.
    yawDeg: hanging.rotationDeg[1],
  };
}

export interface AudioExhibitOptions {
  hanging: AudioHanging;
  /** The resolved bundle base for an archived hanging; ignored for a live one. */
  archivedBase?: string | null;
  tier: DeviceTier;
  /** Supplies the sound of one node. None ships (`audio/field.ts` says why). */
  voice?: VoiceFactory;
  onNotice?: (message: string) => void;
  fetch?: typeof globalThis.fetch;
}

export class AudioExhibit {
  readonly hanging: AudioHanging;
  readonly field: AudioField;
  readonly stream: ExhibitStream | null;
  readonly nodes: readonly PlacedNode[];
  readonly bounds: Box3;
  readonly base: string;

  #disposed = false;
  /** The per-node voices and their score poll, when the exhibit publishes a live score. */
  #voices: ReturnType<typeof scoreVoices> | null = null;
  #poll: ReturnType<typeof setInterval> | null = null;

  private constructor(
    hanging: AudioHanging, base: string, field: AudioField,
    stream: ExhibitStream | null, nodes: PlacedNode[], bounds: Box3,
  ) {
    this.hanging = hanging;
    this.base = base;
    this.field = field;
    this.stream = stream;
    this.nodes = nodes;
    this.bounds = bounds;
  }

  static async load(options: AudioExhibitOptions): Promise<AudioExhibit> {
    const { hanging, onNotice } = options;
    const base = exhibitBase(hanging, options.archivedBase ?? null);
    if (base === null) throw new Error(`${hanging.id}: no live exhibit and no bundle`);

    const placement = placementOf(hanging);
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const nodes = await loadNodes(hanging, base, placement, fetchImpl, onNotice);

    // #14: a live exhibit that publishes `score.live.json` gets a voice per
    // positioned node, synthesised here from the score (audio/voice.ts). One
    // that does not keeps the bed alone, exactly as before. A caller-supplied
    // factory still wins, for tests and for any provider-side voice later.
    let follower: ScoreFollower | null = null;
    let voices: ReturnType<typeof scoreVoices> | null = null;
    if (!options.voice && hanging.live && nodes.length > 0) {
      follower = new ScoreFollower();
      if (await pollScore(`${base}${LIVE_SCORE_FILE}`, follower, fetchImpl)) {
        voices = scoreVoices(follower);
      } else {
        follower = null;
      }
    }
    const voice = options.voice ?? voices?.factory;
    const field = new AudioField({ tier: options.tier, nodes, ...(voice ? { voice } : {}), ...(onNotice ? { onNotice } : {}) });

    // The stream is allowed to fail on its own: a room with a dead exhibit is
    // a quiet room, not a broken one.
    let stream: ExhibitStream | null = null;
    try {
      stream = await ExhibitStream.create({
        url: `${base}${PLAYLIST_FILE}`,
        ...(onNotice ? { onNotice } : {}),
      });
      field.connectBed(stream.audio);
    } catch (error) {
      onNotice?.(`${hanging.id}: the stream did not start (${message(error)})`);
    }

    const exhibit = new AudioExhibit(hanging, base, field, stream, nodes, boundsOf(placement));
    if (follower && voices) {
      exhibit.#voices = voices;
      const url = `${base}${LIVE_SCORE_FILE}`;
      // A failed poll changes nothing: the follower goes stale on its own and
      // the voices fall silent, which is what a dead feed should sound like.
      exhibit.#poll = setInterval(() => void pollScore(url, follower, fetchImpl), LIVE_POLL_MS);
    }
    return exhibit;
  }

  /** Keeps the voices on the score. Cheap when nothing changed; call it from the frame loop. */
  tick(): void {
    if (!this.#disposed) this.#voices?.tick();
  }

  /** "silent" when there is no stream at all, which is what a dead one sounds like. */
  get state(): ExhibitStreamState {
    return this.stream?.state ?? "silent";
  }

  /** The visitor's head, in room metres. Cheap; call it from the frame loop. */
  setListener(
    position: readonly [number, number, number],
    forward: readonly [number, number, number],
    up?: readonly [number, number, number],
  ): void {
    if (!this.#disposed) this.field.setListener(position, forward, up);
  }

  /** Re-rank the nodes against the listener. A few times a second, not per frame. */
  reassign(): void {
    if (!this.#disposed) this.field.reassign();
  }

  /**
   * Autoplay is granted muted, so the element starts muted and the context
   * starts suspended; a room control calls this on a real interaction, the
   * same discipline the video wall keeps.
   */
  async unmute(): Promise<void> {
    if (this.#disposed) return;
    await this.field.resume();
    this.stream?.unmute();
  }

  mute(): void {
    this.stream?.mute();
  }

  /**
   * What the room says about this exhibit when the visitor asks. Two claims
   * matter and both are stated rather than implied: the sound is the
   * provider's, and the placement is the room's.
   */
  provenance(): Record<string, unknown> {
    return {
      source: this.hanging.live
        ? `Live stream from ${this.hanging.live.provider}`
        : "Archived audio bundle",
      generator: "grove/src/world/audio-exhibit.ts",
      exhibit: this.hanging.live ? `audio/live/${this.hanging.live.provider}/${this.hanging.live.streamId}` : "",
      cached: false,
      scientific_content: false,
      note: this.hanging.live
        ? "A live exhibit: a name with no bytes behind it, never cached and never hashed (PACKAGES.md, AUDIO-STREAM.md §1). The sound is the provider's; the placement of each node in this room is the Mind Palace's, from the topology the provider published."
        : "An archived audio bundle, content-hashed like every other bundle. The sound is the provider's; the placement is the Mind Palace's.",
      state: this.state,
      nodes: this.nodes.length,
      positioned: positionedCount(this.field.assignment),
      budget: this.field.budget,
      units: "metres",
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#poll !== null) clearInterval(this.#poll);
    this.#poll = null;
    this.stream?.dispose();
    this.field.dispose();
  }
}

async function loadNodes(
  hanging: AudioHanging,
  base: string,
  placement: TopologyPlacement,
  fetchImpl: typeof globalThis.fetch,
  onNotice: ((message: string) => void) | undefined,
): Promise<PlacedNode[]> {
  const url = hanging.topology || `${base}${TOPOLOGY_FILE}`;
  try {
    // `no-store` says what the exhibit rule already says: this document
    // changes as the observed system does, and keeping it is keeping a lie.
    const response = await fetchImpl(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status}`);
    return placeTopology(parseTopology(await response.json()), placement);
  } catch (error) {
    onNotice?.(`${hanging.id}: no topology, playing the bed alone (${message(error)})`);
    return [];
  }
}

/** Fetches the live score window into the follower; false when there is none to read. */
async function pollScore(url: string, follower: ScoreFollower, fetchImpl: typeof globalThis.fetch): Promise<boolean> {
  try {
    // An exhibit name, so never cached (PACKAGES.md: a fixed name is revalidated).
    const response = await fetchImpl(url, { cache: "no-store" });
    if (!response.ok) return false;
    const doc: unknown = await response.json();
    // Only a document that IS a score counts: an exhibit that answers with
    // anything else has no voices, rather than voices built over nothing.
    if (parseScore(doc) === null) return false;
    follower.ingest(doc, performance.now());
    return true;
  } catch {
    return false;
  }
}

/** The box the visitor's gaze has to hit to ask about this exhibit: the unit cube, placed. */
function boundsOf(placement: TopologyPlacement): Box3 {
  const half = placement.sizeMeters / 2;
  const center = new Vector3(placement.center[0], placement.center[1], placement.center[2]);
  return new Box3(
    center.clone().sub(new Vector3(half, half, half)),
    center.clone().add(new Vector3(half, half, half)),
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
