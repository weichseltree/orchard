// What Faye knows about the compute, and what of it is worth saying.
//
// The source is expdash's `/api/status` on the home box, which already fuses
// BOTH sides: `experiments[].host` / `peer_id` place a run on this box or the
// peer, and `health.mirror` says whether the peer is still reporting. Reading
// `~/.exp_status/*.json` directly would see only this box -- measured: 1373
// records there, every one of them host SirBase, while the mirror was holding
// 105 of the peer's.
//
// Nothing here talks to SpacetimeDB or to a visitor. It turns a feed into a
// short list of things worth broadcasting, and that decision is the whole
// point: 173 events were pending in one sample, and a spirit that announces
// 173 things has told you nothing.

/** One event as expdash publishes it. Unknown fields are ignored, never invented. */
export interface ComputeEvent {
  id: string;
  ts: number;
  /** "crashed", "completed", "started", ... -- expdash's vocabulary, not ours. */
  type: string;
  /** 1 is most urgent (a crash); 3 is routine (a run finished). */
  priority: number;
  title: string;
  detail: string;
  repo: string;
  host: string;
}

export interface MirrorHealth {
  /** "ok" while the peer is reporting. */
  state: string;
  /** Seconds since the last mirror pass. */
  ageSeconds: number;
  peer: string;
  records: number;
}

export interface FeedReading {
  events: ComputeEvent[];
  mirror: MirrorHealth | null;
  /** Every host the feed mentions: this box and, through the mirror, the peer. */
  hosts: string[];
}

/**
 * Reads one `/api/status` document. Anything malformed is dropped rather than
 * guessed -- a spirit that announces a run it misread is worse than a quiet
 * one -- and a document with no events at all is a valid reading, not an error.
 */
export function readFeed(doc: unknown): FeedReading {
  const root = asRecord(doc);
  const events: ComputeEvent[] = [];
  for (const raw of asArray(root?.["events"])) {
    const e = asRecord(raw);
    const id = typeof e?.["id"] === "string" ? e["id"] : "";
    if (!id) continue;
    events.push({
      id,
      ts: numberOr(e?.["ts"], 0),
      type: typeof e?.["type"] === "string" ? e["type"] : "",
      priority: numberOr(e?.["priority"], 3),
      title: typeof e?.["title"] === "string" ? e["title"] : "",
      detail: typeof e?.["detail"] === "string" ? e["detail"] : "",
      repo: typeof e?.["repo"] === "string" ? e["repo"] : "",
      host: typeof e?.["host"] === "string" ? e["host"] : "",
    });
  }
  const health = asRecord(root?.["health"]);
  const m = asRecord(health?.["mirror"]);
  const mirror: MirrorHealth | null = m
    ? {
        state: typeof m["state"] === "string" ? m["state"] : "",
        ageSeconds: numberOr(m["age_s"], 0),
        peer: typeof m["peer"] === "string" ? m["peer"] : "",
        records: numberOr(m["records"], 0),
      }
    : null;
  const hosts = new Set<string>();
  const own = typeof root?.["hostname"] === "string" ? root["hostname"] : "";
  if (own) hosts.add(own);
  for (const raw of asArray(root?.["experiments"])) {
    const host = asRecord(raw)?.["host"];
    if (typeof host === "string" && host) hosts.add(host);
  }
  if (mirror?.peer) hosts.add(mirror.peer);
  return { events, mirror, hosts: [...hosts].sort() };
}

/**
 * The high-water mark of what Faye has already taken in. Event ids are
 * `ev_<n>` with n increasing, so one number is the whole cursor.
 */
export interface Cursor {
  /** The largest event number taken in so far; -1 before anything. */
  seen: number;
}

export const EMPTY_CURSOR: Cursor = { seen: -1 };

/** The number in `ev_14448`, or null for an id that is not one. */
export function eventNumber(id: string): number | null {
  const match = /^ev_(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

export interface Accumulation {
  cursor: Cursor;
  /** Events not seen before, oldest first. */
  fresh: ComputeEvent[];
  /**
   * Whether the feed's numbering went backwards -- expdash restarted and began
   * counting again. Faye re-baselines instead of waiting forever for a number
   * that will never come, which is how a quiet accumulator silently stalls.
   */
  rebaselined: boolean;
}

/**
 * Takes in a reading against what Faye already knows. Events already seen are
 * dropped, so a poll that overlaps the last one announces nothing twice.
 */
export function accumulate(cursor: Cursor, events: readonly ComputeEvent[]): Accumulation {
  const numbered = events
    .map((event) => ({ event, n: eventNumber(event.id) }))
    .filter((row): row is { event: ComputeEvent; n: number } => row.n !== null);
  if (numbered.length === 0) return { cursor, fresh: [], rebaselined: false };

  const highest = Math.max(...numbered.map((row) => row.n));
  // Every id in the feed is below the mark: the counter restarted. Take this
  // reading as the new baseline and say nothing about it, because these are
  // old events wearing new numbers.
  const rebaselined = cursor.seen >= 0 && highest < cursor.seen;
  if (rebaselined) return { cursor: { seen: highest }, fresh: [], rebaselined: true };

  const fresh = numbered
    .filter((row) => row.n > cursor.seen)
    .sort((a, b) => a.n - b.n)
    .map((row) => row.event);
  return { cursor: { seen: Math.max(cursor.seen, highest) }, fresh, rebaselined: false };
}

/** One thing Faye would tell the room. */
export interface Announcement {
  /** What she says, already in a visitor's words. */
  text: string;
  /** The most urgent priority behind it; 1 is a crash. */
  priority: number;
  /** How many events it stands for. */
  count: number;
  /** The event ids it covers, for a record of what was said and why. */
  ids: string[];
}

/** At most this many announcements from one poll, however much happened. */
export const ANNOUNCE_BUDGET = 3;
/** A run of this many of one kind in one repo is summarised, not listed. */
export const COLLAPSE_AT = 2;

/**
 * What a visitor is told. Expdash's own vocabulary does not survive this step.
 *
 * "completed" is the trap and the reason this is a function rather than a
 * template: `gpurun` records `completed exit=0` for a kill, an OOM and a
 * time-budget stop as well as for a success (the home box's operating notes
 * say so, and `exp wait --done-when` exists because of it). So nothing here
 * ever says a run SUCCEEDED or WORKED. It says it finished, which is the only
 * thing the feed actually knows.
 */
export function announce(fresh: readonly ComputeEvent[]): Announcement[] {
  if (fresh.length === 0) return [];
  // Group by what happened and where, so a sweep losing eight members is one
  // sentence rather than eight.
  const groups = new Map<string, ComputeEvent[]>();
  for (const event of fresh) {
    const key = JSON.stringify([event.type, event.repo]);
    const bucket = groups.get(key);
    if (bucket) bucket.push(event);
    else groups.set(key, [event]);
  }

  const out: Announcement[] = [];
  for (const events of groups.values()) {
    const first = events[0]!;
    const priority = Math.min(...events.map((e) => e.priority));
    const where = first.repo ? ` in ${first.repo}` : "";
    let text: string;
    if (events.length >= COLLAPSE_AT) {
      text = `${events.length} ${plural(first.type, events.length)}${where}.`;
    } else {
      // One event keeps its own title, which expdash already wrote for a
      // reader; the detail is added only when it says something short.
      const detail = first.detail && first.detail.length <= 40 ? ` - ${first.detail}` : "";
      text = `${first.title}${detail}.`;
    }
    out.push({ text, priority, count: events.length, ids: events.map((e) => e.id) });
  }

  // Most urgent first, then the largest. Two groups can produce the SAME text
  // -- a lone event keeps its own title, and two repos can run a job of the
  // same name -- so text alone is not a tie-break; the oldest event id behind
  // the group is, and it is unique. Without it the order of two identical
  // sentences followed the order the feed happened to use.
  const oldest = (a: Announcement) => Math.min(...a.ids.map((id) => eventNumber(id) ?? 0));
  out.sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority
      : b.count !== a.count ? b.count - a.count
        : a.text !== b.text ? (a.text < b.text ? -1 : 1)
          : oldest(a) - oldest(b));
  return out.slice(0, ANNOUNCE_BUDGET);
}

/**
 * Whether the peer has stopped reporting. This is the mirror's freshness, not
 * any one job's age: a peer job that is merely queued never advances its
 * heartbeat, so judging the peer by a record's age calls a waiting job a dead
 * box.
 */
export function peerIsSilent(mirror: MirrorHealth | null, staleAfterSeconds = 360): boolean {
  if (!mirror) return false;
  return mirror.state !== "ok" || mirror.ageSeconds > staleAfterSeconds;
}

function plural(type: string, n: number): string {
  const word = type || "events";
  return n === 1 ? `run ${word}` : `runs ${word}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
