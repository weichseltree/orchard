// The live score: what a positioned node's voice is made from (#14, ruled by
// Manuel on 2026-09-16 -- client-synthesised voices per node).
//
// Transport: `score.live.json`, published beside `live.m3u8` and
// `topology.json` under the exhibit's name. It is the SAME `orchard/score/1`
// document an `audio` bundle archives as `score.json` (packages/score), holding
// only a rolling window of the most recent frames. No second schema: a reader
// of one reads the other, and an exhibit name is never cached, so the window
// is fetched `no-store` like every other live exhibit file.
//
// The window has to be longer than the poll interval, or a slow poll drops
// frames it never sees: at 10 Hz and a 1 s poll, anything over 10 frames is
// enough; the provider's writer keeps 30.

export const SCORE_SCHEMA = "orchard/score/1";
export const LIVE_SCORE_FILE = "score.live.json";
/** How often the window is fetched. The voices smooth between polls. */
export const LIVE_POLL_MS = 1000;
/**
 * A feed that has published nothing new for this long is dead, and a dead
 * feed is SILENCE. Holding the last state would leave every node sounding
 * mid-note forever, which is the one thing that would read as the system
 * still running when it is not.
 */
export const STALE_MS = 3500;

/** One node's state at one frame (packages/score `NodeState`). */
export interface NodeState {
  rate: number;
  burstiness: number;
  template_entropy: number;
  fan_out: number;
  anomaly_z: number;
  health: number;
}

const FIELDS: ReadonlyArray<keyof NodeState> = ["rate", "burstiness", "template_entropy", "fan_out", "anomaly_z", "health"];

interface ParsedFrame {
  index: number;
  nodes: ReadonlyMap<string, NodeState>;
}

/**
 * Reads a score document, keeping what is readable.
 *
 * A node with an unreadable field is dropped from its frame rather than the
 * frame or the document being rejected: one malformed node going quiet is
 * right; the whole room going quiet because of it is not. A document with the
 * wrong schema is rejected whole, because every number in it would mean
 * something else.
 */
export function parseScore(doc: unknown): ParsedFrame[] | null {
  if (typeof doc !== "object" || doc === null) return null;
  const record = doc as { schema?: unknown; frames?: unknown };
  if (record.schema !== SCORE_SCHEMA || !Array.isArray(record.frames)) return null;
  const frames: ParsedFrame[] = [];
  for (const raw of record.frames) {
    const frame = raw as { index?: unknown; nodes?: unknown };
    if (!Number.isInteger(frame.index) || typeof frame.nodes !== "object" || frame.nodes === null) continue;
    const nodes = new Map<string, NodeState>();
    for (const [id, value] of Object.entries(frame.nodes as Record<string, unknown>)) {
      const state = readState(value);
      if (state) nodes.set(id, state);
    }
    frames.push({ index: frame.index as number, nodes });
  }
  return frames.sort((a, b) => a.index - b.index);
}

function readState(value: unknown): NodeState | null {
  if (typeof value !== "object" || value === null) return null;
  const out: Partial<NodeState> = {};
  for (const field of FIELDS) {
    const n = (value as Record<string, unknown>)[field];
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out[field] = n;
  }
  return out as NodeState;
}

/**
 * Follows a live score across polls: the newest frame wins, nothing older is
 * replayed, and a stopped feed goes silent.
 *
 * Frame indices only increase within one run (the package's rule). An index
 * that goes BACKWARDS by more than a window means the provider restarted, and
 * the follower starts over rather than ignoring the new run for as long as
 * the old one lasted.
 */
export class ScoreFollower {
  #lastIndex = -Infinity;
  #latest: ReadonlyMap<string, NodeState> = new Map();
  #heardAt = -Infinity;
  #version = 0;

  /** Takes one polled document. Returns true when it carried a newer frame. */
  ingest(doc: unknown, now: number): boolean {
    const frames = parseScore(doc);
    if (!frames || frames.length === 0) return false;
    const newest = frames[frames.length - 1]!;
    const restarted = Number.isFinite(this.#lastIndex) && newest.index < this.#lastIndex - frames.length;
    if (!restarted && newest.index <= this.#lastIndex) return false;
    this.#lastIndex = newest.index;
    this.#latest = newest.nodes;
    this.#heardAt = now;
    this.#version++;
    return true;
  }

  /** A node's current state, or null when it is absent from the newest frame or the feed is stale. */
  state(nodeId: string, now: number): NodeState | null {
    if (now - this.#heardAt > STALE_MS) return null;
    return this.#latest.get(nodeId) ?? null;
  }

  /** Changes whenever a newer frame arrives, so voices are updated only then. */
  get version(): number {
    return this.#version;
  }

  /** Whether the feed has gone quiet; a change here also has to reach the voices. */
  stale(now: number): boolean {
    return now - this.#heardAt > STALE_MS;
  }
}
