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
  EMPTY_CURSOR, accumulate, announce, peerIsSilent,
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
  /** Events not seen before, oldest first. Empty on the baseline reading. */
  fresh: ComputeEvent[];
  /** This reading was the feed's baseline: taken in, said nothing. */
  baseline: boolean;
  /** The feed restarted its numbering (`accumulate` says what that means). */
  rebaselined: boolean;
}

/**
 * Takes one reading of one feed. The first reading of a feed is a baseline:
 * every event in it happened before Faye could see it, and a spirit who walks
 * in reciting the last hour informs nobody.
 */
export function takeFeed(state: FeedState, events: readonly ComputeEvent[]): FeedTake {
  const taken = accumulate(state.cursor, events);
  if (!state.baselined) {
    return { state: { cursor: taken.cursor, baselined: true }, fresh: [], baseline: true, rebaselined: false };
  }
  return { state: { cursor: taken.cursor, baselined: true }, fresh: taken.fresh, baseline: false, rebaselined: taken.rebaselined };
}

/** Fresh events from one feed, with the name Faye logs it under. */
export interface FeedFresh {
  feed: string;
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
 * Feeds are given primary first and **the primary is never silenced**: its
 * events all pass, and only a later feed's events can be dropped. So adding a
 * second feed can make Faye say more, never less, which is the property that
 * makes it safe to add one at all.
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
  feeds.forEach(({ fresh }, index) => {
    for (const event of fresh) {
      const key = sameness(event);
      // The primary's news is never held back by an echo check it can only
      // lose to; every other feed is an addition and may be deduplicated.
      if (index > 0 && isEcho(seen.get(key), event.ts)) continue;
      out.push(event);
      seen.set(key, [...(seen.get(key) ?? []), event.ts]);
    }
  });
  return { fresh: out, heard: { byKey: prune(seen) } };
}

function sameness(event: ComputeEvent): string {
  return JSON.stringify([event.type, event.repo, event.exp || event.title]);
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
  for (const times of seen.values()) for (const ts of times) newest = Math.max(newest, ts);
  const rows: { key: string; times: readonly number[]; newest: number }[] = [];
  for (const [key, times] of seen) {
    // A timestamp of 0 is "unknown", and survives the window: it is the case
    // the echo check leans on hardest. The count cap is what bounds it.
    const kept = times.filter((ts) => !ts || ts >= newest - ECHO_MEMORY_S);
    if (kept.length > 0) rows.push({ key, times: kept, newest: Math.max(...kept) });
  }
  rows.sort((a, b) => (b.newest !== a.newest ? b.newest - a.newest : a.key < b.key ? -1 : 1));
  return new Map(rows.slice(0, ECHO_MEMORY_KEYS).map((row) => [row.key, row.times]));
}

/**
 * How a feed is asked for its document: never cached, and with a bearer token
 * when one is configured. The token comes from a file and is put in a header,
 * never in the URL -- a URL ends up in logs, in `ps`, and in a Referer.
 */
export function feedRequest(token: string): RequestInit {
  return { cache: "no-store", ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) };
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
}

export const NEW_WATCH: Watch = {
  feeds: new Map(),
  heard: NOTHING_HEARD,
  known: EMPTY_STATE,
  peerSilent: null,
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
 */
export function takeReadings(state: Watch, answers: readonly FeedAnswer[], titles?: TreeTitles): Polled {
  if (answers.every((answer) => answer.reading === null)) return { state, lines: [], notes: [] };

  const feeds = new Map(state.feeds);
  const notes: string[] = [];
  const takes: FeedFresh[] = [];
  for (const { feed, reading } of answers) {
    if (!reading) continue;
    const take = takeFeed(feeds.get(feed) ?? NEW_FEED, reading.events);
    feeds.set(feed, take.state);
    if (take.baseline) notes.push(`baseline from ${feed} at ${reading.events.length} event(s)`);
    if (take.rebaselined) notes.push(`${feed} restarted its numbering; re-baselined`);
    takes.push({ feed, fresh: take.fresh });
  }

  const merged = mergeFresh(takes, state.heard);
  const lanes = answers.find((answer) => answer.lanes && answer.reading)?.reading ?? null;
  const hosts = new Set<string>();
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
  };

  const lines = announce(merged.fresh, titles).map((a) => a.text);

  // The peer going quiet or coming back is worth one line each way, never one
  // per poll. This is the mirror's freshness, not any job's age.
  let peerSilent = state.peerSilent;
  if (lanes) {
    const silentNow = peerIsSilent(lanes.mirror);
    if (peerSilent !== null && silentNow !== peerSilent && lanes.mirror) {
      lines.push(silentNow
        ? `${lanes.mirror.peer} has stopped reporting.`
        : `${lanes.mirror.peer} is reporting again.`);
    }
    peerSilent = silentNow;
  }

  return { state: { feeds, heard: merged.heard, known, peerSilent }, lines, notes };
}

function countBy(values: readonly string[], into: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map(into);
  for (const value of values) out.set(value, (out.get(value) ?? 0) + 1);
  return out;
}
