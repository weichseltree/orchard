// Faye listening to more than one feed.
//
// expdash says what the LANE did: started, completed exit=0, crashed. What a
// run declares about ITSELF -- balanced at year 41, hit the 60-year cap
// unbalanced, stalled -- has no words in that vocabulary, and LogSwarm
// publishes it as `logswarm/announce/1` in the same document shape (its
// docs/specs/ANNOUNCE-FEED.md). So `readFeed`, `accumulate` and `announce`
// apply to the second feed unchanged, and only three things are new:
//
//  1. **A cursor per feed.** Both number their events `ev_<n>` from their own
//     counter, and the two counters have nothing to do with each other: one
//     shared cursor would either swallow the lower-numbered feed entirely or
//     re-baseline on every poll.
//  2. **A baseline per feed.** The first reading of a feed is what happened
//     before Faye arrived, and she does not recite it -- per feed, because a
//     feed that comes up an hour later has its own arrival.
//  3. **The same event on both feeds is said once.** LogSwarm can ingest
//     expdash's feed as well (COMPUTE-WATCH.md §4), so a crash can arrive
//     twice; announced together they would collapse into "2 runs crashed",
//     which is not what happened.
//
// expdash stays the primary feed (Manuel, 2026-09-17, orchard #60): it is the
// one that places a run on a box and reports the mirror, and the announce feed
// runs beside it rather than replacing it.

import {
  EMPTY_CURSOR, accumulate, announce, peerIsSilent, saidAs,
  type ComputeEvent, type Cursor, type FeedReading, type TreeTitles,
} from "./events";
import { EMPTY_STATE, type FayeState } from "./reply";

/** What Faye has taken in from one feed. Lives only as long as she stands here. */
export interface FeedState {
  cursor: Cursor;
  /** Whether a first reading has been taken as the baseline. */
  baselined: boolean;
}

/** A feed nothing has been read from yet. */
export const NEW_FEED: FeedState = { cursor: EMPTY_CURSOR, baselined: false };

export interface FeedTake {
  state: FeedState;
  /** Events not seen before, oldest first. Empty while the feed is baselining. */
  fresh: ComputeEvent[];
  /** This reading was taken as the feed's baseline: taken in, said nothing. */
  baseline: boolean;
  /** The feed restarted its numbering (`accumulate` says what that means). */
  rebaselined: boolean;
}

/**
 * Takes one reading of one feed. The first reading of a feed is a baseline:
 * every event in it happened before Faye could see it, and a spirit who walks
 * in reciting the last hour informs nobody.
 *
 * A reading with no numbered event in it -- an empty window, a proxy's error
 * object, `{"events": null}` -- moves no cursor, so it cannot BE the baseline:
 * the feed stays unbaselined and the next real reading is taken in silently.
 * Otherwise a 200 with a broken body would let the feed's whole rolling window
 * (up to 200 events) be announced as news.
 */
export function takeFeed(state: FeedState, events: readonly ComputeEvent[]): FeedTake {
  const taken = accumulate(state.cursor, events);
  const baselined = state.baselined || taken.cursor.seen >= 0;
  if (!state.baselined) {
    return { state: { cursor: taken.cursor, baselined }, fresh: [], baseline: baselined, rebaselined: false };
  }
  return { state: { cursor: taken.cursor, baselined }, fresh: taken.fresh, baseline: false, rebaselined: taken.rebaselined };
}

/** Fresh events from one feed, with the name Faye logs it under. */
export interface FeedFresh {
  feed: string;
  /**
   * Whether this is the feed whose news is never held back (expdash, when it
   * answered). Never inferred from the order of the list: a poll where the
   * primary did not answer must not promote the feed behind it, or the echo
   * check switches itself off on exactly the poll where it is needed.
   */
  primary: boolean;
  fresh: readonly ComputeEvent[];
}

/**
 * How far apart two events about the same run may be and still be the same
 * event seen twice. Wide enough for a feed that polls a log and a dashboard
 * that watches a status file to disagree about when something happened;
 * narrow enough that a run started, killed and started again inside one poll
 * is still two events.
 */
export const DUPLICATE_WINDOW_S = 180;

/** What has been announced lately, so a second feed's echo of it can be recognised. */
export interface Heard {
  /** Timestamps of announced events by what they were about; pruned to the window. */
  byKey: ReadonlyMap<string, readonly number[]>;
}

export const NOTHING_HEARD: Heard = { byKey: new Map() };

/** How long an announced event is remembered for the echo check. */
export const ECHO_MEMORY_S = DUPLICATE_WINDOW_S * 4;

/**
 * A ceiling on that memory. The window alone is enough for feeds that
 * timestamp their events, but one that does not cannot be aged out at all, and
 * a spirit standing for a week must not grow a week of keys. The newest are
 * kept; an event with no timestamp cannot be placed in time and goes first.
 */
export const ECHO_MEMORY_KEYS = 500;

/**
 * And a ceiling per key, for the same reason: one run's state reported over
 * and over would otherwise grow one list without bound. `isEcho` only ever
 * needs the recent few, and one "unknown time" is all it needs of those.
 */
export const ECHO_MEMORY_TIMES = 8;

/** Above this a `ts` is not seconds (it is year 5138), so it cannot be "now". */
const PLAUSIBLE_SECONDS = 1e11;

export interface MergedFresh {
  fresh: ComputeEvent[];
  heard: Heard;
}

/**
 * One poll's news from every feed, with a later feed's copy of what an earlier
 * one already reported dropped -- in this poll, and in the last few minutes of
 * polls, because a feed that polls a log lags a dashboard that watches a
 * status file and the echo arrives on the NEXT poll.
 *
 * **The primary feed is never silenced**: every event of the feed marked
 * `primary` passes, and only another feed's events can be dropped. So adding a
 * second feed can make Faye say more, never less, which is the property that
 * makes it safe to add one at all. When the primary did not answer, no feed
 * carries that immunity -- the whole point of the check is the poll where the
 * second feed is the only one talking.
 *
 * Sameness is the run, the repo and what happened: an event names its run
 * (`exp`) when its feed knows one, and falls back to the title when it does
 * not, which is as far as two feeds can be compared without guessing. The cost
 * is that a second feed reporting the same state of the same run twice inside
 * the window says it once; the alternative is saying one crash twice, and
 * "2 runs crashed" for one crash is the mistake a visitor would notice.
 */
export function mergeFresh(feeds: readonly FeedFresh[], heard: Heard = NOTHING_HEARD): MergedFresh {
  const out: ComputeEvent[] = [];
  const seen = new Map<string, number[]>(
    [...heard.byKey].map(([key, times]) => [key, [...times]]),
  );
  for (const { fresh, primary } of feeds) {
    for (const event of fresh) {
      const key = sameness(event);
      // The primary's news is never held back by an echo check it can only
      // lose to; every other feed is an addition and may be deduplicated.
      if (!primary && isEcho(seen.get(key), event.ts)) continue;
      out.push(event);
      seen.set(key, remember(seen.get(key), event.ts));
    }
  }
  return { fresh: out, heard: { byKey: prune(seen) } };
}

/**
 * One key's timestamps with this event's added: the newest few, and at most
 * one "unknown", which is all `isEcho` reads of it.
 */
function remember(times: readonly number[] | undefined, ts: number): number[] {
  const had = times ?? [];
  const unknown = !ts || had.some((seen) => !seen);
  const known = [...had.filter((seen) => seen), ...(ts ? [ts] : [])]
    .slice(-Math.max(0, ECHO_MEMORY_TIMES - 1));
  return unknown ? [0, ...known] : known;
}

/**
 * What makes two events the same event: the run, the tree and what happened.
 *
 * What happened is the PHRASE, not the producer's spelling of it (`saidAs`).
 * Two watchers of one `~/.exp_status` record disagree about the word --
 * expdash calls a start `started`, the planet watcher declares `running` --
 * and keying on the raw type would let one set of starts be announced twice,
 * in the same sentence both times.
 *
 * That the run matches on the ingest path is worth stating, because it is not
 * promised by a contract. expdash sets `exp` to the status record's id
 * (`20260913_021243_1515015`), and when LogSwarm ingests expdash's feed it
 * carries that string through as `data.exp`, which is the last rung of
 * ANNOUNCE-FEED's `exp` fallback chain -- so both feeds end up naming the run
 * the same way. If a producer ever named it differently the key falls back to
 * the title, which the two feeds also share on that path.
 */
function sameness(event: ComputeEvent): string {
  return JSON.stringify([saidAs(event.type), event.repo, event.exp || event.title]);
}

function isEcho(times: readonly number[] | undefined, ts: number): boolean {
  if (!times || times.length === 0) return false;
  // A feed that gave no timestamp cannot be placed in time, so the match on
  // the run and the state is all there is; treating it as a new event would
  // announce it twice, which is the louder mistake.
  if (!ts) return true;
  return times.some((seen) => !seen || Math.abs(seen - ts) <= DUPLICATE_WINDOW_S);
}

/**
 * Forgets what is too old to be echoed, so a spirit standing for a week does
 * not carry a week of keys. Measured against the newest event she has heard
 * rather than a clock: the feeds' timestamps are the only shared time here.
 */
function prune(seen: ReadonlyMap<string, readonly number[]>): Map<string, readonly number[]> {
  let newest = 0;
  for (const times of seen.values()) {
    // A producer that sent milliseconds where the contract says seconds would
    // otherwise age out everything else as 56 000 years old, turning the echo
    // check off until the memory refills. Such a stamp is not a clock here.
    for (const ts of times) if (ts <= PLAUSIBLE_SECONDS) newest = Math.max(newest, ts);
  }
  const rows: { key: string; times: readonly number[]; newest: number }[] = [];
  for (const [key, times] of seen) {
    // A timestamp of 0 is "unknown", and survives the window: it is the case
    // the echo check leans on hardest. The count cap is what bounds it.
    const kept = times.filter((ts) => !ts || (ts >= newest - ECHO_MEMORY_S && ts <= PLAUSIBLE_SECONDS));
    if (kept.length > 0) rows.push({ key, times: kept, newest: Math.max(...kept) });
  }
  rows.sort((a, b) => (b.newest !== a.newest ? b.newest - a.newest : a.key < b.key ? -1 : 1));
  return new Map(rows.slice(0, ECHO_MEMORY_KEYS).map((row) => [row.key, row.times]));
}

/** The longest a feed may take to answer before the poll gives up on it. */
export const FEED_TIMEOUT_MS = 8_000;

/**
 * A timeout that always leaves room for the next poll. undici's defaults let a
 * server that accepts the connection and then stalls hold the promise for
 * minutes; with one poll at a time, that is minutes in which she says nothing
 * and answers visitors from frozen state.
 */
export function feedTimeoutMs(pollSeconds: number): number {
  const half = Math.round(pollSeconds * 500);
  return Math.max(1_000, Math.min(FEED_TIMEOUT_MS, half || FEED_TIMEOUT_MS));
}

/**
 * How a feed is asked for its document: never cached, never for longer than
 * the timeout, and with a bearer token when one is configured. The token comes
 * from a file and is put in a header, never in the URL -- a URL ends up in
 * logs, in `ps`, and in a Referer.
 */
export function feedRequest(token: string, timeoutMs = FEED_TIMEOUT_MS): RequestInit {
  return {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  };
}

/** A feed Faye polls: expdash's, or a run's own. */
export interface FeedSource {
  /** The short name she logs it under, unique among her feeds. */
  name: string;
  url: string;
  /** Whether this is expdash's feed, the one that places runs and sees the mirror. */
  lanes: boolean;
}

/**
 * The feeds to poll, from `--status-url` and the repeatable `--feed-url`.
 * expdash first and always: it is the feed that places a run on a box and
 * reports the mirror, and an announcement feed runs beside it rather than
 * replacing it (Manuel, 2026-09-17, orchard #60). An empty `--status-url`
 * drops it, leaving her with what runs declare and nothing about the lanes,
 * which is a thing she then says rather than an idle box she cannot see.
 *
 * A repeated URL is dropped, and no two feeds may share a name: they key a
 * cursor apiece, and two feeds under one name would swallow each other's
 * numbering.
 */
export function planFeeds(statusUrl: string, feedUrls: readonly string[]): FeedSource[] {
  const sources: FeedSource[] = [];
  // Trimmed: a whitespace-only flag is a feed turned off, not a URL that fails
  // to parse once per poll for as long as she stands there.
  const lanes = statusUrl.trim();
  if (lanes) sources.push({ name: "expdash", url: lanes, lanes: true });
  feedUrls.map((url) => url.trim()).forEach((url, index) => {
    if (!url || sources.some((source) => source.url === url)) return;
    const wanted = feedNameFor(url, index);
    let name = wanted;
    for (let n = 2; sources.some((source) => source.name === name); n++) name = `${wanted}-${n}`;
    sources.push({ name, url, lanes: false });
  });
  return sources;
}

/**
 * A short name for a feed, for the log line that says where news came from.
 * `feeds/<project>/planet/live` is the announce feed's path, and its middle
 * segment is the name a person gave that feed in the graph editor.
 */
export function feedNameFor(url: string, index: number): string {
  const match = /\/feeds\/[^/]+\/([^/?#]+)(?:\/live)?/.exec(url);
  return match?.[1] || `feed${index + 1}`;
}

/** Everything Faye has taken in from her feeds, poll to poll. */
export interface Watch {
  /** Where each feed's counter and baseline stand, by feed name. */
  feeds: ReadonlyMap<string, FeedState>;
  heard: Heard;
  /** What she would tell a visitor who asks (`reply.ts`). */
  known: FayeState;
  /** Whether the peer was silent at the last poll; null before the first. */
  peerSilent: boolean | null;
  /** When the lane feed last answered, in ms; null while it never has. */
  lanesSeenAt: number | null;
}

export const NEW_WATCH: Watch = {
  feeds: new Map(),
  heard: NOTHING_HEARD,
  known: EMPTY_STATE,
  peerSilent: null,
  lanesSeenAt: null,
};

/** One feed's answer to one poll. `null` means it did not answer. */
export interface FeedAnswer {
  feed: string;
  /** Whether this is expdash's feed: the one that places runs and sees the mirror. */
  lanes: boolean;
  reading: FeedReading | null;
}

export interface Polled {
  state: Watch;
  /** What she says, in order. */
  lines: string[];
  /** For the log, not for the room: baselines and restarted counters. */
  notes: string[];
}

/**
 * One poll of every feed, turned into what she says and what she now knows.
 *
 * This is the whole of the multi-feed behaviour, kept out of the service
 * script so it can be tested without a world to stand in. What it will not do:
 *
 * - **Speak about the plumbing.** A feed that did not answer leaves her
 *   knowledge as it was; the room is never told a fetch failed.
 * - **Lose the lane facts to a feed that cannot have them.** The mirror and
 *   what is running come from expdash alone -- a run's own feed says what
 *   happened, not what is happening -- and a poll where expdash was down keeps
 *   the last answer it gave rather than reporting an idle box.
 * - **Announce a backlog.** Each feed's first reading is its baseline.
 * - **Report a stale fact as a fresh one.** The lane facts survive an outage,
 *   but `lanesFresh` goes false and her answer becomes the past tense with an
 *   age on it (`reply.ts`). That has to be decided on a poll where NOTHING
 *   answered too -- with expdash as her only feed, which is how the live
 *   service runs, every failed poll is such a poll.
 */
export function takeReadings(
  state: Watch,
  answers: readonly FeedAnswer[],
  titles?: TreeTitles,
  now: number = Date.now(),
): Polled {
  // Which feed's news is never held back this poll: expdash when it answered,
  // and otherwise -- only when there is no expdash among her feeds at all --
  // the FIRST feed, when that one answered. A poll where the primary is merely
  // down promotes nobody, whoever else is up; that is the poll the echo check
  // exists for.
  const lanesAnswer = answers.find((answer) => answer.lanes) ?? null;
  const lanes = lanesAnswer?.reading ?? null;
  const primaryFeed = lanesAnswer
    ? (lanes ? lanesAnswer.feed : null)
    : (answers[0]?.reading ? answers[0].feed : null);

  if (answers.every((answer) => answer.reading === null)) {
    // Nothing to take in, and nothing to say -- but a failed poll IS how she
    // learns the dashboard has stopped answering, so the lane facts age.
    if (!state.known.hasFeed) return { state, lines: [], notes: [] };
    const known: FayeState = {
      ...state.known,
      lanesFresh: false,
      lanesAgeSeconds: agedSince(state.lanesSeenAt, now),
    };
    return { state: { ...state, known }, lines: [], notes: [] };
  }

  const feeds = new Map(state.feeds);
  const notes: string[] = [];
  const takes: FeedFresh[] = [];
  for (const { feed, reading } of answers) {
    if (!reading) continue;
    const take = takeFeed(feeds.get(feed) ?? NEW_FEED, reading.events);
    feeds.set(feed, take.state);
    if (take.baseline) notes.push(`baseline from ${feed} at ${reading.events.length} event(s)`);
    // A feed answering with nothing she can number is not an outage -- the
    // fetch worked -- and would otherwise be silent in the journal forever.
    else if (!take.state.baselined) notes.push(`${feed} answered with no usable event; still waiting for its baseline`);
    if (take.rebaselined) notes.push(`${feed} restarted its numbering; re-baselined`);
    takes.push({ feed, primary: feed === primaryFeed, fresh: take.fresh });
  }

  const merged = mergeFresh(takes, state.heard);
  // Every box any feed mentions. The ones expdash named are kept through an
  // expdash outage: a second feed that knows about one box must not narrow
  // "I am watching Legion and SirBase" down to one of them.
  const hosts = new Set<string>(lanes ? [] : state.known.hosts);
  for (const { reading } of answers) for (const host of reading?.hosts ?? []) hosts.add(host);

  const known: FayeState = {
    hosts: hosts.size > 0 ? [...hosts].sort() : state.known.hosts,
    mirror: lanes ? lanes.mirror : state.known.mirror,
    seenByType: countBy(merged.fresh.map((event) => event.type), state.known.seenByType),
    running: lanes ? lanes.running : state.known.running,
    hasFeed: true,
    // Once expdash has answered she can place runs; a later poll where it is
    // down does not unlearn that, it just has nothing newer to say.
    knowsRunning: state.known.knowsRunning || lanes !== null,
    lanesFresh: lanes !== null,
    // Recomputed every poll, so the age a visitor is told is at most one poll
    // behind: no clock is read at the moment she answers.
    lanesAgeSeconds: lanes ? 0 : agedSince(state.lanesSeenAt, now),
  };

  const lines = announce(merged.fresh, titles).map((a) => a.text);

  // The peer going quiet or coming back is worth one line each way, never one
  // per poll. This is the mirror's freshness, not any job's age.
  let peerSilent = state.peerSilent;
  // Only when there IS a mirror to judge. A poll whose document carried no
  // `health.mirror` says nothing about the peer, and letting it reset the
  // memory would announce the same episode twice or swallow the recovery.
  if (lanes?.mirror) {
    const silentNow = peerIsSilent(lanes.mirror);
    if (peerSilent !== null && silentNow !== peerSilent) {
      lines.push(silentNow
        ? `${lanes.mirror.peer} has stopped reporting.`
        : `${lanes.mirror.peer} is reporting again.`);
    }
    peerSilent = silentNow;
  }

  return {
    state: { feeds, heard: merged.heard, known, peerSilent, lanesSeenAt: lanes ? now : state.lanesSeenAt },
    lines,
    notes,
  };
}

/** How long ago the lane feed last answered, in seconds; 0 when it never has. */
function agedSince(seenAt: number | null, now: number): number {
  return seenAt === null ? 0 : Math.max(0, (now - seenAt) / 1000);
}

function countBy(values: readonly string[], into: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map(into);
  for (const value of values) out.set(value, (out.get(value) ?? 0) + 1);
  return out;
}
