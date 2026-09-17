// What Faye knows about the compute, and what of it is worth saying.
//
// The source is expdash's `/api/status` on the home box, which already fuses
// BOTH sides: `experiments[].host` / `peer_id` place a run on this box or the
// peer, and `health.mirror` says whether the peer is still reporting. Reading
// `~/.exp_status/*.json` directly would see only this box -- measured: 1373
// records there, every one of them host SirBase, while the mirror was holding
// 105 of the peer's.
//
// A second feed says what a RUN declares about itself -- balanced at year N,
// hit the cap unbalanced, stalled -- which the lane's own vocabulary cannot
// express. LogSwarm publishes it as `logswarm/announce/1` in exactly this
// shape (its docs/specs/ANNOUNCE-FEED.md), so everything here reads it
// unchanged; `feeds.ts` holds the little that is new, and the vocabulary of
// those declared states is in `announce` below.
//
// Nothing here talks to SpacetimeDB or to a visitor. It turns a feed into a
// short list of things worth broadcasting, and that decision is the whole
// point: 173 events were pending in one sample, and a spirit that announces
// 173 things has told you nothing.

/** One event as a feed publishes it. Unknown fields are ignored, never invented. */
export interface ComputeEvent {
  id: string;
  ts: number;
  /**
   * "crashed", "completed", "started" from expdash; "balanced",
   * "hit-cap-unbalanced", "stalled", "plateau" from a run's own feed. Always
   * the producer's vocabulary, never ours.
   */
  type: string;
  /** 1 is most urgent (a crash); 3 is routine (a run finished). */
  priority: number;
  title: string;
  detail: string;
  repo: string;
  host: string;
  /**
   * The run this is about (`m06-fold-s0.96`), when the feed names one. Only
   * the announce feed does; it is what lets the same event arriving on two
   * feeds be recognised as one (`feeds.ts`). Empty when unknown.
   */
  exp: string;
}

export interface MirrorHealth {
  /** "ok" while the peer is reporting. */
  state: string;
  /** Seconds since the last mirror pass. */
  ageSeconds: number;
  peer: string;
  records: number;
}

/** One run on a lane right now: which box it is on, and which tree it belongs to. */
export interface RunningRun {
  host: string;
  /** The tree IDENTITY (`spectre`), as the feed has it; `treeLabel` makes it readable. */
  tree: string;
}

export interface FeedReading {
  events: ComputeEvent[];
  mirror: MirrorHealth | null;
  /** Every host the feed mentions: this box and, through the mirror, the peer. */
  hosts: string[];
  /**
   * What is running, on either lane of either box. Not "on the card": a
   * cpu-lane run holds no GPU, and the feed cannot tell a visitor otherwise.
   */
  running: RunningRun[];
}

/**
 * Reads one feed document: expdash's `/api/status`, or `logswarm/announce/1`,
 * which carries the same `events[]` and states its `hosts` outright instead of
 * having them derived from `experiments[]`. Anything malformed is dropped
 * rather than guessed -- a spirit that announces a run it misread is worse
 * than a quiet one -- and a document with no events at all is a valid reading,
 * not an error.
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
      exp: typeof e?.["exp"] === "string" ? e["exp"] : "",
    });
  }
  const health = asRecord(root?.["health"]);
  const m = asRecord(health?.["mirror"]);
  // A mirror with no peer named is not a peer. expdash reports
  // `{"state": "never"}` on a box where the mirror has never run -- a legitimate
  // single-box setup, not a fault -- and calling that a peer would have her say
  // " has stopped reporting" about nobody, with no name and a leading space.
  const mirror: MirrorHealth | null = m && typeof m["peer"] === "string" && m["peer"]
    ? {
        state: typeof m["state"] === "string" ? m["state"] : "",
        ageSeconds: numberOr(m["age_s"], 0),
        peer: typeof m["peer"] === "string" ? m["peer"] : "",
        records: numberOr(m["records"], 0),
      }
    : null;
  const hosts = new Set<string>();
  const running: RunningRun[] = [];
  const own = typeof root?.["hostname"] === "string" ? root["hostname"] : "";
  if (own) hosts.add(own);
  // A feed with no `experiments[]` -- the announce feed -- says which boxes its
  // events are about. Taken as given; it is the only place that knows.
  for (const raw of asArray(root?.["hosts"])) {
    if (typeof raw === "string" && raw) hosts.add(raw);
  }
  for (const raw of asArray(root?.["experiments"])) {
    const e = asRecord(raw);
    const host = typeof e?.["host"] === "string" ? e["host"] : "";
    if (host) hosts.add(host);
    if (e?.["status"] !== "running") continue;
    const tree = typeof e["repo"] === "string" ? e["repo"] : "";
    // A run with no tree cannot be named, and one with no box and no hostname
    // to fall back on cannot be placed; both are left out, not guessed.
    const on = host || own;
    if (tree && on) running.push({ host: on, tree });
  }
  if (mirror?.peer) hosts.add(mirror.peer);
  return { events, mirror, hosts: [...hosts].sort(), running };
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

/**
 * The longest thing she says in one line.
 *
 * Not the module's limit, which is 280 and is applied silently and mid-word
 * (`CHAT_MAX` and `clip` in spacetime/spacetimedb/src/index.ts), but what a
 * person can take in from a room. Read off the live emulator feed on
 * 2026-09-17: a run's own feed writes much longer titles than expdash ever
 * did -- the planet watcher's plateau alert is 178 characters, 83 of them the
 * thresholds it fired on, and its slowdown alert 174 -- while its cap, finish
 * and "no longer watched" lines are 68, 66 and 127. So 140 leaves every
 * sentence that says something untouched and takes the arithmetic off the two
 * that carry it.
 */
export const SPOKEN_MAX = 140;

/**
 * One line, short enough to be heard in a room and to survive the module
 * uncut.
 *
 * The evidence goes before the sentence does. A producer puts the thresholds
 * an alert fired on in a parenthesis -- and not always at the end: the
 * slowdown alert reads "…so far (load 25.1 on 16 cores; top: chrome 310%, node
 * 180%). Box load, not the code", where the clause after the bracket is the
 * one ANNOUNCE-FEED.md §3 requires it to keep. So every parenthetical goes,
 * wherever it sits, and only then is the sentence cut.
 *
 * Counted in code points, the way the module counts them, so a cut can never
 * split a surrogate pair; a bracket she would not have closed is dropped, and
 * a line that was nothing but evidence is cut instead of emptied.
 */
export function fitToRoom(text: string): string {
  if (Array.from(text).length <= SPOKEN_MAX) return text;
  const withoutEvidence = text
    .replace(/\.{3,}/g, "…")
    .replace(/\s*\([^()]*\)/g, "")
    // What the evidence leaves behind: a space before punctuation, a separator
    // that now introduces nothing, and two terminators where the sentence
    // ended before the bracket did.
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s*([:;,])\s*([.!?…])/g, "$2")
    .replace(/([.!?…])\s*[.,;:!?…]+/g, "$1")
    .trim();
  // Unless the evidence WAS the message: a line of punctuation says nothing,
  // and saying nothing is not the same as saying it shortly.
  const shortened = says(withoutEvidence) ? withoutEvidence : text;
  if (Array.from(shortened).length <= SPOKEN_MAX) return shortened;

  let cut = Array.from(shortened).slice(0, SPOKEN_MAX - 1).join("");
  // A clause boundary if there is one past the halfway mark -- her own answers
  // are lists of clauses, and ending on one reads as shortened rather than as
  // interrupted -- and a word boundary otherwise.
  //
  // "; " only, never ". ": a producer's sentence boundary is not a list
  // boundary, and preferring it dropped the whole second sentence of the
  // slowdown alert -- the "Box load, not the code" clause ANNOUNCE-FEED.md §3
  // requires -- leaving the numbers that invite the reading it forbids.
  const clause = cut.lastIndexOf("; ");
  const space = cut.lastIndexOf(" ");
  if (clause > SPOKEN_MAX / 2) cut = cut.slice(0, clause);
  else if (space > SPOKEN_MAX / 2) cut = cut.slice(0, space);
  const open = cut.lastIndexOf("(");
  if (open >= 0 && !cut.slice(open).includes(")")) {
    const before = cut.slice(0, open).trimEnd();
    // Cut back to before the bracket -- unless that is everything she had, in
    // which case the bracket itself goes and the words stay.
    cut = says(before) ? before : `${cut.slice(0, open)}${cut.slice(open + 1)}`;
  }
  // Never an ellipsis hanging off a separator that now introduces nothing.
  return `${cut.replace(/[\s:;,—–-]+$/u, "")}…`;
}

/** Whether a line has anything in it a person would read. */
function says(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * A line finished with a full stop -- unless it is already finished. None of
 * the planet watcher's titles end in one (checked against the live feed,
 * 2026-09-17: they end in ")", "60", "W/m²", "code"), so this is a guard
 * rather than a fix; the "…ice spreads.." seen in development came from the
 * trim above synthesising a stop of its own, which it no longer does.
 */
function asSentence(body: string): string {
  return /[.!?…]$/.test(body) ? body : `${body}.`;
}

/** At most this many announcements from one poll, however much happened. */
export const ANNOUNCE_BUDGET = 3;

/** A run of this many of one kind in one repo is summarised, not listed. */
export const COLLAPSE_AT = 2;

/**
 * A tree's identity to the label a person reads: `spectre` -> `coarsen`.
 * Built from `trees/*.yaml` (`name` and the optional `title`) by whoever calls
 * `announce`, so this module stays pure and reads no files.
 */
export type TreeTitles = ReadonlyMap<string, string>;

/**
 * The label for a tree identity, falling back to the identity itself. A tree
 * with no title has always been shown by its name, and that stays true.
 */
export function treeLabel(identity: string, titles?: TreeTitles): string {
  return titles?.get(identity) || identity;
}

/**
 * What a visitor is told. Expdash's own vocabulary does not survive this step.
 *
 * "completed" is the trap and the reason this is a function rather than a
 * template: `gpurun` records `completed exit=0` for a kill, an OOM and a
 * time-budget stop as well as for a success (the home box's operating notes
 * say so, and `exp wait --done-when` exists because of it). So nothing here
 * ever says a run SUCCEEDED or WORKED. It says it finished, which is the only
 * thing the feed actually knows.
 *
 * `titles` is the second half of the same discipline. The feed's `repo` is a
 * tree IDENTITY -- the live feed says `spectre` for 113 events -- and the
 * rename ruling of 2026-09-16 keeps that identity precisely because it is
 * inside the bytes every bundle id hashes. The label a person reads moved to
 * `coarsen`. A visitor is told the label; the identity never reaches them.
 */
export function announce(fresh: readonly ComputeEvent[], titles?: TreeTitles): Announcement[] {
  if (fresh.length === 0) return [];
  // Group by what happened and where, so a sweep losing eight members is one
  // sentence rather than eight.
  const groups = new Map<string, ComputeEvent[]>();
  for (const event of fresh) {
    // By the PHRASE, not the producer's spelling: expdash's `started` and a
    // run's own `running` are one kind of thing, and grouping them apart says
    // "2 runs started in coarsen" twice where four runs started once.
    const key = JSON.stringify([saidAs(event.type), event.repo]);
    const bucket = groups.get(key);
    if (bucket) bucket.push(event);
    else groups.set(key, [event]);
  }

  const out: Announcement[] = [];
  for (const events of groups.values()) {
    const first = events[0]!;
    const priority = Math.min(...events.map((e) => e.priority));
    const where = first.repo ? ` in ${treeLabel(first.repo, titles)}` : "";
    let body: string;
    if (events.length >= COLLAPSE_AT) {
      body = `${events.length} ${plural(first.type, events.length)}${where}`;
    } else {
      // One event keeps its own title, which its producer already wrote for a
      // reader; the detail is added only when it says something short. A feed
      // that sent no title at all leaves nothing to keep, so she falls back to
      // saying what kind of thing happened rather than reading out a dash.
      const detail = first.detail && first.detail.length <= 40 ? ` - ${first.detail}` : "";
      body = says(first.title)
        ? `${first.title}${detail}`
        : first.type
          ? `1 ${plural(first.type, 1)}${where}`
          : `1 event${where}`;
    }
    const text = fitToRoom(asSentence(body));
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

/**
 * A declared state or alert as a sentence can carry it, for the collapsed form
 * only -- a lone event always keeps the producer's own title.
 *
 * "2 runs hit-cap-unbalanced" is not English, and this is the whole of the
 * translation: no state becomes a conclusion (`balanced` is not "stable",
 * `plateau` is not "stuck"), `finished` never becomes "succeeded", and a
 * `slowdown` stays the box slowing a run and is never called a regression
 * (COMPUTE-WATCH.md §3 and §5 in logswarm; box load has fooled us before).
 * A type with no phrase here is said as the producer wrote it.
 *
 * Two producers watching the same thing can spell one event differently --
 * expdash's `started` and a run's own `running` are the same fact -- so what
 * matters downstream is the PHRASE, not the spelling: `saidAs` is what
 * `feeds.ts` compares two feeds' events by, and a synonym pair added here
 * stops being announced twice by the same act.
 */
const COLLAPSED_PHRASES: Readonly<Record<string, string>> = {
  // `running` is a run declaring that it HAS started, and "2 runs running"
  // would read as two runs on the lanes right now -- which is the one claim a
  // declaration feed cannot make (see `knowsRunning` in reply.ts).
  running: "started",
  "live-stalled": "lost their live stream",
  "hit-cap-unbalanced": "hit the cap unbalanced",
  "completed-unverified": "finished unverified",
  spinup: "entered spinup",
  record: "entered the record",
  plateau: "flagged a plateau",
  cap: "flagged as unlikely to reach the cap",
  slowdown: "flagged the box slowing them",
};

/**
 * A condition ending, and a condition stopping being watched. LogSwarm's
 * metric engine builds these as `<condition>-cleared` and
 * `<condition>-expired` from whatever a person named the condition in the
 * editor (its `metric-engine.ts`), so no fixed list can keep up with them --
 * and the two mean very different things. `cleared` is the condition genuinely
 * over; `expired` is the group dropped because the samples stopped, which the
 * producer itself words as "no longer watched (no samples)". Calling that
 * "cleared" would announce a resolution to a run that merely went quiet, which
 * is the `completed`-is-not-success mistake in another coat.
 */
const CLEARED = /^(.+)-cleared$/;
const EXPIRED = /^(.+)-expired$/;

/** What a type is said as, whoever spelled it: the phrase above, or the type. */
export function saidAs(type: string): string {
  // The map first: its own names are hyphenated (`live-stalled`,
  // `hit-cap-unbalanced`), and one ending in -cleared would otherwise be
  // shadowed by the pattern below.
  const phrase = COLLAPSED_PHRASES[type];
  if (phrase) return phrase;
  const cleared = CLEARED.exec(type);
  if (cleared) return `cleared the ${cleared[1]}`;
  const expired = EXPIRED.exec(type);
  if (expired) return `no longer watched for the ${expired[1]}`;
  return type || "events";
}

function plural(type: string, n: number): string {
  const said = saidAs(type);
  return n === 1 ? `run ${said}` : `runs ${said}`;
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
