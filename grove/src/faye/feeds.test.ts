import { describe, expect, it } from "vitest";
import type { ComputeEvent, FeedReading } from "./events";
import {
  DUPLICATE_WINDOW_S, ECHO_MEMORY_KEYS, NEW_FEED, NEW_WATCH, NOTHING_HEARD,
  feedNameFor, feedRequest, mergeFresh, takeFeed, takeReadings,
} from "./feeds";

function event(over: Partial<ComputeEvent> = {}): ComputeEvent {
  return {
    id: "ev_1", ts: 1789650000, type: "crashed", priority: 1,
    title: "Crashed: m06-fold-s0.96", detail: "exit code 1",
    repo: "spectre", host: "SirBase", exp: "m06-fold-s0.96",
    ...over,
  };
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
      { feed: "expdash", fresh: [event({ id: "ev_1", type: "crashed" })] },
      { feed: "planet", fresh: [event({ id: "ev_43", type: "hit-cap-unbalanced" })] },
    ]);
    expect(merged.fresh.map((e) => e.id)).toEqual(["ev_1", "ev_43"]);
  });

  it("says one crash once when both feeds report it", () => {
    // LogSwarm can ingest expdash's feed too, so the same crash arrives twice;
    // announced together it would collapse into "2 runs crashed", which is not
    // what happened.
    const merged = mergeFresh([
      { feed: "expdash", fresh: [event({ id: "ev_1", ts: 1789650000 })] },
      { feed: "planet", fresh: [event({ id: "ev_43", ts: 1789650012 })] },
    ]);
    expect(merged.fresh.map((e) => e.id)).toEqual(["ev_1"]);
  });

  it("still says it once when the echo lands on the NEXT poll", () => {
    const first = mergeFresh([
      { feed: "expdash", fresh: [event({ id: "ev_1", ts: 1789650000 })] },
      { feed: "planet", fresh: [] },
    ]);
    const second = mergeFresh([
      { feed: "expdash", fresh: [] },
      { feed: "planet", fresh: [event({ id: "ev_43", ts: 1789650020 })] },
    ], first.heard);
    expect(second.fresh).toEqual([]);
  });

  it("does not silence the same run's state hours later", () => {
    const first = mergeFresh([{ feed: "expdash", fresh: [event({ id: "ev_1", ts: 1789650000 })] }]);
    const later = event({ id: "ev_44", ts: 1789650000 + DUPLICATE_WINDOW_S + 60 });
    const second = mergeFresh([
      { feed: "expdash", fresh: [] },
      { feed: "planet", fresh: [later] },
    ], first.heard);
    expect(second.fresh.map((e) => e.id)).toEqual(["ev_44"]);
  });

  it("never holds back the primary feed, even against itself", () => {
    // Adding a second feed may make her say more; it may never make her say
    // less than expdash alone would have.
    const first = mergeFresh([{ feed: "expdash", fresh: [event({ id: "ev_1" })] }]);
    const again = mergeFresh([{ feed: "expdash", fresh: [event({ id: "ev_2" })] }], first.heard);
    expect(again.fresh.map((e) => e.id)).toEqual(["ev_2"]);
  });

  it("tells two runs apart even when they crash in the same second", () => {
    const merged = mergeFresh([
      { feed: "expdash", fresh: [event({ id: "ev_1", exp: "m06-fold-s0.95" })] },
      { feed: "planet", fresh: [event({ id: "ev_43", exp: "m06-fold-s0.96" })] },
    ]);
    expect(merged.fresh).toHaveLength(2);
  });

  it("falls back to the title when a feed names no run", () => {
    const merged = mergeFresh([
      { feed: "expdash", fresh: [event({ id: "ev_1", exp: "", title: "Crashed: tests" })] },
      { feed: "planet", fresh: [
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
      { feed: "expdash", fresh: [event({ id: "ev_1", ts: 1789650000 })] },
      { feed: "planet", fresh: [event({ id: "ev_43", ts: 0 })] },
    ]);
    expect(merged.fresh.map((e) => e.id)).toEqual(["ev_1"]);
  });

  it("groups by repo: the same job name in two trees is two events", () => {
    const merged = mergeFresh([
      { feed: "expdash", fresh: [event({ id: "ev_1", repo: "spectre", exp: "tests" })] },
      { feed: "planet", fresh: [event({ id: "ev_43", repo: "einstruct", exp: "tests" })] },
    ]);
    expect(merged.fresh).toHaveLength(2);
  });

  it("does not grow without bound while she stands for a week", () => {
    let heard = NOTHING_HEARD;
    for (let poll = 0; poll < 40; poll++) {
      const fresh = Array.from({ length: 50 }, (_, i) =>
        event({ id: `ev_${poll * 50 + i}`, ts: 0, exp: `run-${poll}-${i}` }));
      heard = mergeFresh([{ feed: "expdash", fresh }], heard).heard;
    }
    // 2000 distinct untimed events; the window cannot age any of them out.
    expect(heard.byKey.size).toBe(ECHO_MEMORY_KEYS);
  });

  it("is deterministic: the same poll merges the same way", () => {
    const feeds = [
      { feed: "expdash", fresh: [event({ id: "ev_1" }), event({ id: "ev_2", exp: "other" })] },
      { feed: "planet", fresh: [event({ id: "ev_43" })] },
    ];
    expect(mergeFresh(feeds).fresh).toEqual(mergeFresh(feeds).fresh);
  });
});

describe("feedRequest", () => {
  it("never takes a cached feed", () => {
    expect(feedRequest("").cache).toBe("no-store");
    expect(feedRequest("").headers).toBeUndefined();
  });

  it("sends a token as a header, never in the URL", () => {
    expect(feedRequest("owner").headers).toEqual({ authorization: "Bearer owner" });
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
    const first = takeReadings(NEW_WATCH, [lanes(), planet()]);
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
    const first = takeReadings(NEW_WATCH, [lanes(), planet()]);
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

  it("changes nothing at all when no feed answers", () => {
    const first = takeReadings(NEW_WATCH, [lanes(), planet()]);
    const nothing = takeReadings(first.state, [
      { feed: "expdash", lanes: true, reading: null },
      { feed: "planet", lanes: false, reading: null },
    ]);
    expect(nothing.state).toBe(first.state);
    expect(nothing.lines).toEqual([]);
    expect(nothing.notes).toEqual([]);
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
    let watch = takeReadings(NEW_WATCH, [lanes()]).state;
    expect(takeReadings(watch, [lanes({ mirror: MIRROR_OK })]).lines).toEqual([]);
    const quiet = takeReadings(watch, [lanes({ mirror: stale })]);
    expect(quiet.lines).toEqual(["Legion has stopped reporting."]);
    watch = quiet.state;
    expect(takeReadings(watch, [lanes({ mirror: stale })]).lines).toEqual([]);
    expect(takeReadings(watch, [lanes({ mirror: MIRROR_OK })]).lines).toEqual(["Legion is reporting again."]);
  });

  it("does not mistake a down expdash for a quiet peer", () => {
    const watch = takeReadings(NEW_WATCH, [lanes(), planet()]).state;
    const gone = takeReadings(watch, [
      { feed: "expdash", lanes: true, reading: null },
      planet(),
    ]);
    expect(gone.lines).toEqual([]);
    expect(gone.state.peerSilent).toBe(false);
  });

  it("says one crash once when both feeds carry it", () => {
    const watch = takeReadings(NEW_WATCH, [lanes(), planet()]).state;
    const both = takeReadings(watch, [
      lanes({ events: [event({ id: "ev_2", ts: 1789650000 })] }),
      planet({ events: [event({ id: "ev_44", ts: 1789650030 })] }),
    ]);
    expect(both.lines).toEqual(["Crashed: m06-fold-s0.96 - exit code 1."]);
  });
});
