import { describe, expect, it } from "vitest";
import type { ComputeEvent, FeedReading } from "./events";
import {
  DUPLICATE_WINDOW_S, ECHO_MEMORY_KEYS, ECHO_MEMORY_TIMES, NEW_FEED, NEW_WATCH, NOTHING_HEARD,
  FEED_TIMEOUT_MS, feedNameFor, feedRequest, feedTimeoutMs, mergeFresh, planFeeds,
  takeFeed, takeReadings,
} from "./feeds";

function event(over: Partial<ComputeEvent> = {}): ComputeEvent {
  return {
    id: "ev_1", ts: 1789650000, type: "crashed", priority: 1,
    title: "Crashed: m06-fold-s0.96", detail: "exit code 1",
    repo: "spectre", host: "SirBase", exp: "m06-fold-s0.96",
    ...over,
  };
}

/** How many timestamps the echo memory is holding in total. */
function entries(heard: { byKey: ReadonlyMap<string, readonly number[]> }): number {
  return [...heard.byKey.values()].reduce((n, times) => n + times.length, 0);
}

describe("takeFeed", () => {
  it("takes the first reading as a baseline and says nothing about it", () => {
    const first = takeFeed(NEW_FEED, [event({ id: "ev_40" }), event({ id: "ev_41" })]);
    expect(first.baseline).toBe(true);
    expect(first.fresh).toEqual([]);
    expect(first.state.cursor.seen).toBe(41);
  });

  it("announces what arrives after that baseline", () => {
    const first = takeFeed(NEW_FEED, [event({ id: "ev_40" })]);
    const second = takeFeed(first.state, [event({ id: "ev_40" }), event({ id: "ev_41" })]);
    expect(second.baseline).toBe(false);
    expect(second.fresh.map((e) => e.id)).toEqual(["ev_41"]);
  });

  it("baselines a feed that only answers later, on ITS first reading", () => {
    // A feed that was down for the first hour must not recite that hour when
    // it comes up: its own arrival is the first reading Faye gets from it.
    const late = takeFeed(NEW_FEED, [event({ id: "ev_900" })]);
    expect(late.fresh).toEqual([]);
    expect(takeFeed(late.state, [event({ id: "ev_901" })]).fresh.map((e) => e.id)).toEqual(["ev_901"]);
  });

  it("does not call a reading with no usable event a baseline", () => {
    // A 200 with a broken body -- a proxy error object, `{"events": null}` --
    // moves no cursor, so the feed is still waiting for its baseline. Taking
    // it would let the feed's whole rolling window be announced as news.
    const empty = takeFeed(NEW_FEED, []);
    expect(empty.state.baselined).toBe(false);
    expect(empty.baseline).toBe(false);
    const real = takeFeed(empty.state, [event({ id: "ev_1" }), event({ id: "ev_2" })]);
    expect(real.baseline).toBe(true);
    expect(real.fresh).toEqual([]);
    expect(takeFeed(real.state, [event({ id: "ev_3" })]).fresh.map((e) => e.id)).toEqual(["ev_3"]);
  });

  it("passes on a restarted numbering rather than stalling", () => {
    const first = takeFeed(NEW_FEED, [event({ id: "ev_900" })]);
    const restarted = takeFeed(first.state, [event({ id: "ev_1" })]);
    expect(restarted.rebaselined).toBe(true);
    expect(restarted.fresh).toEqual([]);
    expect(restarted.state.cursor.seen).toBe(1);
  });

  it("keeps each feed's counter to itself", () => {
    // Both feeds number from their own counter. One cursor for both would
    // swallow the lower-numbered feed entirely.
    const expdash = takeFeed(NEW_FEED, [event({ id: "ev_14448" })]);
    const announceFeed = takeFeed(NEW_FEED, [event({ id: "ev_43" })]);
    expect(takeFeed(announceFeed.state, [event({ id: "ev_44" })]).fresh.map((e) => e.id)).toEqual(["ev_44"]);
    expect(takeFeed(expdash.state, [event({ id: "ev_14449" })]).fresh.map((e) => e.id)).toEqual(["ev_14449"]);
  });
});

describe("mergeFresh", () => {
  it("keeps everything when the feeds say different things", () => {
    const merged = mergeFresh([
      { feed: "expdash", primary: true, fresh: [event({ id: "ev_1", type: "crashed" })] },
      { feed: "planet", primary: false, fresh: [event({ id: "ev_43", type: "hit-cap-unbalanced" })] },
    ]);
    expect(merged.fresh.map((e) => e.id)).toEqual(["ev_1", "ev_43"]);
  });

  it("says one crash once when both feeds report it", () => {
    // LogSwarm can ingest expdash's feed too, so the same crash arrives twice;
    // announced together it would collapse into "2 runs crashed", which is not
    // what happened.
    const merged = mergeFresh([
      { feed: "expdash", primary: true, fresh: [event({ id: "ev_1", ts: 1789650000 })] },
      { feed: "planet", primary: false, fresh: [event({ id: "ev_43", ts: 1789650012 })] },
    ]);
    expect(merged.fresh.map((e) => e.id)).toEqual(["ev_1"]);
  });

  it("still says it once when the echo lands on the NEXT poll", () => {
    const first = mergeFresh([
      { feed: "expdash", primary: true, fresh: [event({ id: "ev_1", ts: 1789650000 })] },
      { feed: "planet", primary: false, fresh: [] },
    ]);
    const second = mergeFresh([
      { feed: "expdash", primary: true, fresh: [] },
      { feed: "planet", primary: false, fresh: [event({ id: "ev_43", ts: 1789650020 })] },
    ], first.heard);
    expect(second.fresh).toEqual([]);
  });

  it("does not silence the same run's state hours later", () => {
    const first = mergeFresh([{ feed: "expdash", primary: true, fresh: [event({ id: "ev_1", ts: 1789650000 })] }]);
    const later = event({ id: "ev_44", ts: 1789650000 + DUPLICATE_WINDOW_S + 60 });
    const second = mergeFresh([
      { feed: "expdash", primary: true, fresh: [] },
      { feed: "planet", primary: false, fresh: [later] },
    ], first.heard);
    expect(second.fresh.map((e) => e.id)).toEqual(["ev_44"]);
  });

  it("never holds back the primary feed, even against itself", () => {
    // Adding a second feed may make her say more; it may never make her say
    // less than expdash alone would have.
    const first = mergeFresh([{ feed: "expdash", primary: true, fresh: [event({ id: "ev_1" })] }]);
    const again = mergeFresh([{ feed: "expdash", primary: true, fresh: [event({ id: "ev_2" })] }], first.heard);
    expect(again.fresh.map((e) => e.id)).toEqual(["ev_2"]);
  });

  it("checks the echo even when the primary feed did not answer", () => {
    // The poll where the second feed is the ONLY one talking is the poll the
    // echo check exists for; deciding "primary" by position would switch it
    // off exactly there and say the same crash twice.
    const first = mergeFresh([
      { feed: "expdash", primary: true, fresh: [event({ id: "ev_1", ts: 1789650000 })] },
      { feed: "planet", primary: false, fresh: [] },
    ]);
    const expdashDown = mergeFresh([
      { feed: "planet", primary: false, fresh: [event({ id: "ev_43", ts: 1789650020 })] },
    ], first.heard);
    expect(expdashDown.fresh).toEqual([]);
  });

  it("tells two runs apart even when they crash in the same second", () => {
    const merged = mergeFresh([
      { feed: "expdash", primary: true, fresh: [event({ id: "ev_1", exp: "m06-fold-s0.95" })] },
      { feed: "planet", primary: false, fresh: [event({ id: "ev_43", exp: "m06-fold-s0.96" })] },
    ]);
    expect(merged.fresh).toHaveLength(2);
  });

  it("falls back to the title when a feed names no run", () => {
    const merged = mergeFresh([
      { feed: "expdash", primary: true, fresh: [event({ id: "ev_1", exp: "", title: "Crashed: tests" })] },
      { feed: "planet", primary: false, fresh: [
        event({ id: "ev_43", exp: "", title: "Crashed: tests" }),
        event({ id: "ev_44", exp: "", title: "Crashed: assemble" }),
      ] },
    ]);
    expect(merged.fresh.map((e) => e.id)).toEqual(["ev_1", "ev_44"]);
  });

  it("treats a second feed's untimed copy as the same event", () => {
    // With no timestamp there is nothing to place it in time by, and saying it
    // twice is the louder mistake.
    const merged = mergeFresh([
      { feed: "expdash", primary: true, fresh: [event({ id: "ev_1", ts: 1789650000 })] },
      { feed: "planet", primary: false, fresh: [event({ id: "ev_43", ts: 0 })] },
    ]);
    expect(merged.fresh.map((e) => e.id)).toEqual(["ev_1"]);
  });

  it("groups by repo: the same job name in two trees is two events", () => {
    const merged = mergeFresh([
      { feed: "expdash", primary: true, fresh: [event({ id: "ev_1", repo: "spectre", exp: "tests" })] },
      { feed: "planet", primary: false, fresh: [event({ id: "ev_43", repo: "einstruct", exp: "tests" })] },
    ]);
    expect(merged.fresh).toHaveLength(2);
  });

  it("does not grow without bound while she stands for a week", () => {
    let heard = NOTHING_HEARD;
    for (let poll = 0; poll < 40; poll++) {
      const fresh = Array.from({ length: 50 }, (_, i) =>
        event({ id: `ev_${poll * 50 + i}`, ts: 0, exp: `run-${poll}-${i}` }));
      heard = mergeFresh([{ feed: "expdash", primary: true, fresh }], heard).heard;
    }
    // 2000 distinct untimed events; the window cannot age any of them out, so
    // the count cap is the only thing holding this down.
    expect(heard.byKey.size).toBe(ECHO_MEMORY_KEYS);
    expect(entries(heard)).toBeLessThanOrEqual(ECHO_MEMORY_KEYS * ECHO_MEMORY_TIMES);
  });

  it("does not grow one key without bound either", () => {
    // The same run's state over and over -- a stuck watcher re-declaring it --
    // is one key, so the key cap can never fire on it.
    let heard = NOTHING_HEARD;
    for (let poll = 0; poll < 200; poll++) {
      heard = mergeFresh([{ feed: "expdash", primary: true, fresh: [event({ id: `ev_${poll}`, ts: 0 })] }], heard).heard;
    }
    expect(heard.byKey.size).toBe(1);
    // One "unknown time" is all the echo check reads of them.
    expect(entries(heard)).toBe(1);

    let timed = NOTHING_HEARD;
    for (let poll = 0; poll < 200; poll++) {
      timed = mergeFresh([{ feed: "expdash", primary: true, fresh: [event({ id: `ev_${poll}`, ts: 1789650000 + poll * 600 })] }], timed).heard;
    }
    expect(entries(timed)).toBeLessThanOrEqual(ECHO_MEMORY_TIMES);
  });

  it("is not blinded by a producer that sends milliseconds", () => {
    // A `ts` in milliseconds is year 58 000 as seconds, and measuring the
    // window against it would age every real key out and turn the check off.
    const first = mergeFresh([{ feed: "expdash", primary: true, fresh: [event({ id: "ev_1", ts: 1789650000 })] }]);
    const wrongUnit = mergeFresh([
      { feed: "expdash", primary: true, fresh: [event({ id: "ev_2", ts: 1789650000000, exp: "other" })] },
    ], first.heard);
    // The stamp itself is not kept -- it can never match anything in seconds
    // and would sit at the head of the eviction order for ever -- and the real
    // key it would have evicted is still there.
    expect(wrongUnit.heard.byKey.size).toBe(1);
    const echo = mergeFresh([
      { feed: "planet", primary: false, fresh: [event({ id: "ev_43", ts: 1789650030 })] },
    ], wrongUnit.heard);
    expect(echo.fresh).toEqual([]);
  });

  it("is deterministic: the same poll merges the same way", () => {
    const feeds = [
      { feed: "expdash", primary: true, fresh: [event({ id: "ev_1" }), event({ id: "ev_2", exp: "other" })] },
      { feed: "planet", primary: false, fresh: [event({ id: "ev_43" })] },
    ];
    expect(mergeFresh(feeds).fresh).toEqual(mergeFresh(feeds).fresh);
  });
});

describe("feedRequest", () => {
  it("never takes a cached feed, and never waits forever", () => {
    expect(feedRequest("").cache).toBe("no-store");
    expect(feedRequest("").headers).toBeUndefined();
    expect(feedRequest("").signal).toBeInstanceOf(AbortSignal);
  });

  it("sends a token as a header, never in the URL", () => {
    expect(feedRequest("owner").headers).toEqual({ authorization: "Bearer owner" });
  });
});

describe("feedTimeoutMs", () => {
  it("always leaves room for the next poll", () => {
    // A stalled feed must cost one poll, not a run of them.
    expect(feedTimeoutMs(30)).toBe(FEED_TIMEOUT_MS);
    expect(feedTimeoutMs(4)).toBe(2_000);
    expect(feedTimeoutMs(1)).toBe(1_000);
    // A poll of 0 means she is not watching at all; the ceiling stands.
    expect(feedTimeoutMs(0)).toBe(FEED_TIMEOUT_MS);
  });
});

describe("planFeeds", () => {
  it("puts expdash first, and the declaration feeds after it", () => {
    expect(planFeeds("http://localhost:8686/api/status", ["http://x/feeds/p/planet/live"])).toEqual([
      { name: "expdash", url: "http://localhost:8686/api/status", lanes: true },
      { name: "planet", url: "http://x/feeds/p/planet/live", lanes: false },
    ]);
  });

  it("drops the lane feed when it is turned off, and keeps the rest", () => {
    expect(planFeeds("", ["http://x/feeds/p/planet/live"]))
      .toEqual([{ name: "planet", url: "http://x/feeds/p/planet/live", lanes: false }]);
    expect(planFeeds("", [])).toEqual([]);
    expect(planFeeds("", [""])).toEqual([]);
  });

  it("never gives two feeds one name or one URL twice", () => {
    // Each feed keys a cursor by name; two under one name would swallow each
    // other's numbering.
    const plan = planFeeds("", [
      "http://a/feeds/p1/planet/live",
      "http://b/feeds/p2/planet/live",
      "http://a/feeds/p1/planet/live",
    ]);
    expect(plan.map((source) => source.name)).toEqual(["planet", "planet-2"]);
    expect(plan).toHaveLength(2);
  });
});

describe("feedNameFor", () => {
  it("names a feed after the name a person gave it in the graph", () => {
    expect(feedNameFor("http://localhost:6104/feeds/proj_1/planet/live.json?ns=demo", 0)).toBe("planet");
    expect(feedNameFor("https://feeds.example/feeds/proj_1/lanes/live", 1)).toBe("lanes");
  });

  it("falls back to its position when the path says nothing", () => {
    expect(feedNameFor("https://example.invalid/whatever", 0)).toBe("feed1");
    expect(feedNameFor("", 2)).toBe("feed3");
  });
});

// One poll of one feed, as `readFeed` would have left it.
function reading(over: Partial<FeedReading> = {}): FeedReading {
  return { events: [], mirror: null, hosts: [], running: [], ...over };
}

const MIRROR_OK = { state: "ok", ageSeconds: 3, peer: "Legion", records: 105 };

describe("takeReadings", () => {
  const lanes = (over: Partial<FeedReading> = {}) => ({
    feed: "expdash",
    lanes: true,
    reading: reading({
      mirror: MIRROR_OK,
      hosts: ["Legion", "SirBase"],
      running: [{ host: "SirBase", tree: "spectre" }],
      ...over,
    }),
  });
  const planet = (over: Partial<FeedReading> = {}) => ({
    feed: "planet",
    lanes: false,
    reading: reading({ hosts: ["SirBase"], ...over }),
  });

  it("takes a baseline from each feed and says nothing on arrival", () => {
    const first = takeReadings(NEW_WATCH, [
      lanes({ events: [event({ id: "ev_1" })] }),
      planet({ events: [event({ id: "ev_43", type: "balanced", exp: "m06-fold-s0.95" })] }),
    ]);
    expect(first.lines).toEqual([]);
    expect(first.notes).toHaveLength(2);
    expect(first.state.known.hasFeed).toBe(true);
    expect(first.state.known.knowsRunning).toBe(true);
    expect(first.state.known.hosts).toEqual(["Legion", "SirBase"]);
  });

  it("says what a run declares, once the feed has a baseline", () => {
    const first = takeReadings(NEW_WATCH, [
      lanes({ events: [event({ id: "ev_1" })] }),
      planet({ events: [event({ id: "ev_42", type: "balanced" })] }),
    ]);
    const second = takeReadings(first.state, [
      lanes(),
      planet({ events: [event({
        id: "ev_43", type: "hit-cap-unbalanced", priority: 2,
        title: "s=0.96: hit the 60-year cap unbalanced at -3.26 W/m²",
        detail: "", exp: "m06-fold-s0.96",
      })] }),
    ], new Map([["spectre", "coarsen"]]));
    expect(second.lines).toEqual(["s=0.96: hit the 60-year cap unbalanced at -3.26 W/m²."]);
    expect(second.state.known.seenByType.get("hit-cap-unbalanced")).toBe(1);
  });

  it("keeps the lane facts when expdash is the feed that went down", () => {
    const first = takeReadings(NEW_WATCH, [
      lanes({ events: [event({ id: "ev_1" })] }),
      planet({ events: [event({ id: "ev_42", type: "balanced" })] }),
    ]);
    const withoutLanes = takeReadings(first.state, [
      { feed: "expdash", lanes: true, reading: null },
      planet({ events: [event({ id: "ev_43", type: "stalled" })] }),
    ]);
    // Not "nothing is running": that would be a fact she no longer has.
    expect(withoutLanes.state.known.running).toEqual([{ host: "SirBase", tree: "spectre" }]);
    expect(withoutLanes.state.known.mirror).toEqual(MIRROR_OK);
    expect(withoutLanes.state.known.knowsRunning).toBe(true);
    // And the feed that did answer is still heard.
    expect(withoutLanes.lines).toHaveLength(1);
  });

  it("says nothing when no feed answers, but lets the lane facts age", () => {
    // With expdash as her only feed -- how the live service runs -- EVERY
    // failed poll is a poll where nothing answered, so this is the only place
    // she can learn the dashboard has stopped answering.
    const first = takeReadings(NEW_WATCH, [lanes({ events: [event({ id: "ev_1" })] })], undefined, 1_000_000);
    const nothing = takeReadings(first.state, [
      { feed: "expdash", lanes: true, reading: null },
    ], undefined, 1_600_000);
    expect(nothing.lines).toEqual([]);
    expect(nothing.notes).toEqual([]);
    expect(nothing.state.known.lanesFresh).toBe(false);
    expect(nothing.state.known.lanesAgeSeconds).toBe(600);
    // The facts themselves are kept; it is their tense that changed.
    expect(nothing.state.known.running).toEqual(first.state.known.running);
    expect(nothing.state.known.mirror).toEqual(first.state.known.mirror);
    expect(nothing.state.known.hosts).toEqual(first.state.known.hosts);
  });

  it("has nothing to age before any feed has ever answered", () => {
    const dead = takeReadings(NEW_WATCH, [{ feed: "expdash", lanes: true, reading: null }]);
    expect(dead.state).toBe(NEW_WATCH);
    expect(dead.state.known.hasFeed).toBe(false);
  });

  it("promotes nobody when the first of two declaration feeds is the one down", () => {
    // The same trap as H1 one configuration over: with no expdash at all,
    // immunity belongs to the first FEED, not to whoever happens to be up.
    const alpha = (over: Partial<FeedReading> = {}) => ({ feed: "alpha", lanes: false, reading: reading(over) });
    const beta = (over: Partial<FeedReading> = {}) => ({ feed: "beta", lanes: false, reading: reading(over) });
    const first = takeReadings(NEW_WATCH, [
      alpha({ events: [event({ id: "ev_1", exp: "earlier" })] }),
      beta({ events: [event({ id: "ev_90", exp: "earlier" })] }),
    ]);
    const crash = takeReadings(first.state, [alpha({ events: [event({ id: "ev_2", ts: 1789650000 })] }), beta()]);
    expect(crash.lines).toHaveLength(1);
    const echo = takeReadings(crash.state, [
      { feed: "alpha", lanes: false, reading: null },
      beta({ events: [event({ id: "ev_91", ts: 1789650020 })] }),
    ]);
    expect(echo.lines).toEqual([]);
  });

  it("says one set of starts once, however the two feeds spell it", () => {
    // expdash calls a start `started`; the planet watcher declares `running`.
    // One fact, two spellings, one sentence.
    const first = takeReadings(NEW_WATCH, [
      lanes({ events: [event({ id: "ev_1", exp: "earlier" })] }),
      planet({ events: [event({ id: "ev_42", exp: "earlier" })] }),
    ]);
    const starts = takeReadings(first.state, [
      lanes({ events: [
        event({ id: "ev_2", type: "started", priority: 3, ts: 1789650000, exp: "m06-fold-s0.95" }),
        event({ id: "ev_3", type: "started", priority: 3, ts: 1789650000, exp: "m06-fold-s0.96" }),
      ] }),
      planet({ events: [
        event({ id: "ev_43", type: "running", priority: 3, ts: 1789650004, exp: "m06-fold-s0.95" }),
        event({ id: "ev_44", type: "running", priority: 3, ts: 1789650004, exp: "m06-fold-s0.96" }),
      ] }),
    ], new Map([["spectre", "coarsen"]]));
    expect(starts.lines).toEqual(["2 runs started in coarsen."]);
  });

  it("cannot see the lanes with a declaration feed alone", () => {
    const only = takeReadings(NEW_WATCH, [planet({ events: [event({ id: "ev_43" })] })]);
    expect(only.state.known.hasFeed).toBe(true);
    // `reply.ts` turns this into "I cannot see the lanes from here" rather than
    // reporting an idle box.
    expect(only.state.known.knowsRunning).toBe(false);
    expect(only.state.known.running).toEqual([]);
  });

  it("says the peer went quiet once, and says it came back once", () => {
    const stale = { ...MIRROR_OK, ageSeconds: 3600 };
    let watch = takeReadings(NEW_WATCH, [lanes({ events: [event({ id: "ev_1" })] })]).state;
    expect(takeReadings(watch, [lanes({ mirror: MIRROR_OK })]).lines).toEqual([]);
    const quiet = takeReadings(watch, [lanes({ mirror: stale })]);
    expect(quiet.lines).toEqual(["Legion has stopped reporting."]);
    watch = quiet.state;
    expect(takeReadings(watch, [lanes({ mirror: stale })]).lines).toEqual([]);
    expect(takeReadings(watch, [lanes({ mirror: MIRROR_OK })]).lines).toEqual(["Legion is reporting again."]);
  });

  it("does not mistake a down expdash for a quiet peer", () => {
    const watch = takeReadings(NEW_WATCH, [
      lanes({ events: [event({ id: "ev_1" })] }),
      planet({ events: [event({ id: "ev_42" })] }),
    ]).state;
    const gone = takeReadings(watch, [
      { feed: "expdash", lanes: true, reading: null },
      planet(),
    ]);
    expect(gone.lines).toEqual([]);
    expect(gone.state.peerSilent).toBe(false);
  });

  it("keeps the echo check when expdash is the feed that is down", () => {
    // The whole-poll version of the same trap: the announce feed is the only
    // one talking, and its ingested copy of the crash expdash already
    // reported must not be announced a second time.
    const first = takeReadings(NEW_WATCH, [
      lanes({ events: [event({ id: "ev_1", exp: "earlier" })] }),
      planet({ events: [event({ id: "ev_42", exp: "earlier" })] }),
    ]);
    const crash = takeReadings(first.state, [
      lanes({ events: [event({ id: "ev_2", ts: 1789650000 })] }),
      planet(),
    ]);
    expect(crash.lines).toHaveLength(1);
    const echo = takeReadings(crash.state, [
      { feed: "expdash", lanes: true, reading: null },
      planet({ events: [event({ id: "ev_43", ts: 1789650020 })] }),
    ]);
    expect(echo.lines).toEqual([]);
  });

  it("keeps the boxes expdash named when expdash is down", () => {
    const first = takeReadings(NEW_WATCH, [
      lanes({ events: [event({ id: "ev_1" })] }),
      planet({ events: [event({ id: "ev_42" })] }),
    ]);
    expect(first.state.known.hosts).toEqual(["Legion", "SirBase"]);
    const alone = takeReadings(first.state, [
      { feed: "expdash", lanes: true, reading: null },
      planet({ events: [event({ id: "ev_43" })] }),
    ]);
    // The announce feed knows about one box; that is not news that the other
    // one is gone, and "I am watching SirBase" would be wrong.
    expect(alone.state.known.hosts).toEqual(["Legion", "SirBase"]);
    expect(alone.state.known.lanesFresh).toBe(false);
  });

  it("does not let a poll with no mirror at all reset the peer's memory", () => {
    const stale = { ...MIRROR_OK, ageSeconds: 3600 };
    const watch = takeReadings(NEW_WATCH, [lanes({ events: [event({ id: "ev_1" })] })]).state;
    const quiet = takeReadings(watch, [lanes({ mirror: stale })]);
    expect(quiet.lines).toEqual(["Legion has stopped reporting."]);
    // expdash answers, with no `health.mirror` in the document at all.
    const noMirror = takeReadings(quiet.state, [lanes({ mirror: null })]);
    expect(noMirror.state.peerSilent).toBe(true);
    // Not a second "has stopped reporting" for the same episode.
    expect(takeReadings(noMirror.state, [lanes({ mirror: stale })]).lines).toEqual([]);
    expect(takeReadings(noMirror.state, [lanes({ mirror: MIRROR_OK })]).lines)
      .toEqual(["Legion is reporting again."]);
  });

  it("says one crash once when both feeds carry it", () => {
    const watch = takeReadings(NEW_WATCH, [
      lanes({ events: [event({ id: "ev_1", exp: "earlier" })] }),
      planet({ events: [event({ id: "ev_42", exp: "earlier" })] }),
    ]).state;
    const both = takeReadings(watch, [
      lanes({ events: [event({ id: "ev_2", ts: 1789650000 })] }),
      planet({ events: [event({ id: "ev_44", ts: 1789650030 })] }),
    ]);
    expect(both.lines).toEqual(["Crashed: m06-fold-s0.96 - exit code 1."]);
  });
});
