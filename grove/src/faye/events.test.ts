import { describe, expect, it } from "vitest";
import {
  ANNOUNCE_BUDGET, EMPTY_CURSOR, SPOKEN_MAX, accumulate, announce, eventNumber,
  fitToRoom, peerIsSilent, readFeed, treeLabel, type ComputeEvent,
} from "./events";

function event(over: Partial<ComputeEvent> = {}): ComputeEvent {
  return {
    id: "ev_1", ts: 1789524730, type: "completed", priority: 3,
    title: "Completed: a-run", detail: "ran 0m 20s", repo: "spectre", host: "SirBase",
    exp: "",
    ...over,
  };
}

// A trimmed sample of the shape expdash actually serves.
const feed = {
  time: 1789528493.9,
  hostname: "SirBase",
  experiments: [
    { id: "2026_1", host: "SirBase", peer_id: null, status: "completed" },
    { id: "2026_2", host: "Legion", peer_id: "legion-7", status: "running" },
  ],
  health: {
    warnings: [],
    mirror: { state: "ok", age_s: 3, peer: "Legion", records: 105, interval: 10 },
  },
  events: [
    { id: "ev_14448", ts: 1, type: "crashed", priority: 1, title: "Crashed: a", detail: "exit code 1", repo: "spectre" },
    { id: "ev_14450", ts: 2, type: "completed", priority: 3, title: "Completed: b", detail: "ran 0m 20s", repo: "spectre" },
  ],
};

// A trimmed sample of `logswarm/announce/1`: the same `events[]`, no
// `experiments[]`, and its hosts stated outright
// (logswarm/docs/specs/ANNOUNCE-FEED.md).
const announceFeed = {
  schema: "logswarm/announce/1",
  provider: "logswarm",
  project: "proj_1", graph: "graph_1", feed: "planet",
  time: 1789650100,
  events: [
    {
      id: "ev_43", ts: 1789650000.1, type: "hit-cap-unbalanced", priority: 2,
      title: "s=0.96: hit the 60-year cap unbalanced at -3.26 W/m²",
      detail: "", repo: "spectre", host: "SirBase", exp: "m06-fold-s0.96",
    },
  ],
  hosts: ["SirBase"],
  running: [],
};

describe("readFeed", () => {
  it("reads the events, the mirror and both boxes", () => {
    const reading = readFeed(feed);
    expect(reading.events.map((e) => e.id)).toEqual(["ev_14448", "ev_14450"]);
    expect(reading.mirror).toEqual({ state: "ok", ageSeconds: 3, peer: "Legion", records: 105 });
    // This box from `hostname`, the peer from the experiments and the mirror.
    expect(reading.hosts).toEqual(["Legion", "SirBase"]);
  });

  it("places each running run on its box, and only running ones", () => {
    const reading = readFeed({
      ...feed,
      experiments: [
        ...feed.experiments,
        { id: "2026_3", host: "SirBase", status: "running", repo: "spectre" },
        { id: "2026_4", status: "running", repo: "arcedit" },
        { id: "2026_5", host: "SirBase", status: "queued", repo: "spectre" },
        { id: "2026_6", host: "SirBase", status: "running" },
      ],
    });
    // 2026_2 has no repo, so it cannot be named; 2026_4 has no host and takes
    // the feed's own hostname; 2026_5 is waiting, not running.
    expect(reading.running).toEqual([
      { host: "SirBase", tree: "spectre" },
      { host: "SirBase", tree: "arcedit" },
    ]);
  });

  it("drops an event with no id rather than inventing one", () => {
    const reading = readFeed({ ...feed, events: [{ ts: 1, type: "crashed" }, { id: "ev_9" }] });
    expect(reading.events.map((e) => e.id)).toEqual(["ev_9"]);
  });

  it("survives a feed that is not a feed", () => {
    for (const junk of [null, 42, "no", [], {}, { events: "nope", health: 7 }]) {
      const reading = readFeed(junk);
      expect(reading.events).toEqual([]);
      expect(reading.mirror).toBeNull();
    }
  });

  it("defaults a missing priority to routine, never to urgent", () => {
    expect(readFeed({ events: [{ id: "ev_1" }] }).events[0]!.priority).toBe(3);
  });

  it("reads a run's own announcement feed with no new parsing", () => {
    const reading = readFeed(announceFeed);
    expect(reading.events).toEqual([{
      id: "ev_43", ts: 1789650000.1, type: "hit-cap-unbalanced", priority: 2,
      title: "s=0.96: hit the 60-year cap unbalanced at -3.26 W/m²",
      detail: "", repo: "spectre", host: "SirBase", exp: "m06-fold-s0.96",
    }]);
    // It states its hosts; there are no experiments to derive them from, and
    // nothing about the lanes is invented from an event's host.
    expect(reading.hosts).toEqual(["SirBase"]);
    expect(reading.running).toEqual([]);
    expect(reading.mirror).toBeNull();
  });

  it("does not call a mirror that names no peer a peer", () => {
    // expdash reports `{"state": "never"}` on a box where the mirror has never
    // run: a legitimate single-box setup, not a fault. Calling it a peer would
    // have her say " has stopped reporting" about nobody.
    expect(readFeed({ health: { mirror: { state: "never" } } }).mirror).toBeNull();
    expect(readFeed({ health: { mirror: { state: "ok", peer: "", age_s: 3 } } }).mirror).toBeNull();
  });

  it("ignores a hosts field that is not a list of names", () => {
    expect(readFeed({ hosts: "SirBase" }).hosts).toEqual([]);
    expect(readFeed({ hosts: [1, "", null, "Legion"] }).hosts).toEqual(["Legion"]);
  });
});

describe("eventNumber", () => {
  it("reads the number, and refuses anything that is not one", () => {
    expect(eventNumber("ev_14448")).toBe(14448);
    expect(eventNumber("ev_x")).toBeNull();
    expect(eventNumber("14448")).toBeNull();
    expect(eventNumber("")).toBeNull();
  });
});

describe("accumulate", () => {
  const three = [event({ id: "ev_1" }), event({ id: "ev_2" }), event({ id: "ev_3" })];

  it("takes everything the first time, oldest first", () => {
    const got = accumulate(EMPTY_CURSOR, three);
    expect(got.fresh.map((e) => e.id)).toEqual(["ev_1", "ev_2", "ev_3"]);
    expect(got.cursor.seen).toBe(3);
  });

  it("announces nothing twice when polls overlap", () => {
    const first = accumulate(EMPTY_CURSOR, three);
    const second = accumulate(first.cursor, [...three, event({ id: "ev_4" })]);
    expect(second.fresh.map((e) => e.id)).toEqual(["ev_4"]);
    expect(second.cursor.seen).toBe(4);
  });

  it("is quiet when nothing new arrived", () => {
    const first = accumulate(EMPTY_CURSOR, three);
    expect(accumulate(first.cursor, three).fresh).toEqual([]);
  });

  it("sorts by number, not by the order the feed happened to use", () => {
    const got = accumulate(EMPTY_CURSOR, [event({ id: "ev_30" }), event({ id: "ev_4" })]);
    expect(got.fresh.map((e) => e.id)).toEqual(["ev_4", "ev_30"]);
  });

  it("re-baselines when the counter restarts, instead of stalling forever", () => {
    const ahead = { seen: 14_500 };
    // expdash restarted: every id is far below the mark.
    const got = accumulate(ahead, [event({ id: "ev_1" }), event({ id: "ev_2" })]);
    expect(got.rebaselined).toBe(true);
    expect(got.cursor.seen).toBe(2);
    // Silent about the restart itself: these are old events wearing new numbers.
    expect(got.fresh).toEqual([]);
    // And it carries on normally from the new baseline.
    expect(accumulate(got.cursor, [event({ id: "ev_3" })]).fresh.map((e) => e.id)).toEqual(["ev_3"]);
  });

  it("keeps its cursor when the feed has no usable ids", () => {
    const got = accumulate({ seen: 10 }, [event({ id: "not-an-event" })]);
    expect(got.cursor.seen).toBe(10);
    expect(got.fresh).toEqual([]);
  });
});

describe("announce", () => {
  it("says nothing about nothing", () => {
    expect(announce([])).toEqual([]);
  });

  it("never claims a run succeeded — `completed exit=0` is also a kill, an OOM or a time budget", () => {
    const said = announce([event({ id: "ev_1", type: "completed" })]).map((a) => a.text).join(" ");
    expect(said).not.toMatch(/success|succeeded|worked|passed|fine/i);
  });

  it("collapses a burst into one sentence rather than listing it", () => {
    const crashes = Array.from({ length: 8 }, (_, i) =>
      event({ id: `ev_${i + 1}`, type: "crashed", priority: 1, title: `Crashed: m-${i}` }));
    const [first] = announce(crashes);
    expect(first!.text).toBe("8 runs crashed in spectre.");
    expect(first!.count).toBe(8);
    expect(first!.ids).toHaveLength(8);
  });

  it("says a declared state the way the run declared it — the acceptance line of #60", () => {
    const [only] = announce(readFeed(announceFeed).events, new Map([["spectre", "coarsen"]]));
    expect(only!.text).toBe("s=0.96: hit the 60-year cap unbalanced at -3.26 W/m².");
    expect(only!.priority).toBe(2);
  });

  it("puts a collapsed burst of declared states into English, without interpreting them", () => {
    const said = (type: string, n = 2) => announce(Array.from({ length: n }, (_, i) =>
      event({ id: `ev_${i + 1}`, type, priority: 2, repo: "spectre" })))[0]!.text;
    expect(said("hit-cap-unbalanced")).toBe("2 runs hit the cap unbalanced in spectre.");
    expect(said("balanced")).toBe("2 runs balanced in spectre.");
    expect(said("stalled")).toBe("2 runs stalled in spectre.");
    expect(said("plateau")).toBe("2 runs flagged a plateau in spectre.");
    // Seen on the live feed: the alert clearing is its own declared state.
    expect(said("plateau-expired")).toBe("2 runs cleared their plateau in spectre.");
    expect(said("cap")).toBe("2 runs flagged as unlikely to reach the cap in spectre.");
    // The box slowing a run is never a regression: box load has fooled us before.
    expect(said("slowdown")).toBe("2 runs flagged the box slowing them in spectre.");
    // `running` is a run declaring it HAS started; "2 runs running" would read
    // as two runs on the lanes now, which a declaration feed cannot know.
    expect(said("running")).toBe("2 runs started in spectre.");
    expect(said("live-stalled")).toBe("2 runs lost their live stream in spectre.");
    // A state nobody wrote a phrase for is still said as the producer wrote it.
    expect(said("spun-down")).toBe("2 runs spun-down in spectre.");
  });

  it("never turns a declared finish into a success either", () => {
    const said = announce([
      event({ id: "ev_1", type: "finished", title: "m06-fold-s0.95: finished 32/32" }),
      event({ id: "ev_2", type: "finished", repo: "einstruct" }),
      event({ id: "ev_3", type: "finished", repo: "einstruct" }),
    ]).map((a) => a.text).join(" ");
    expect(said).toMatch(/finished/);
    expect(said).not.toMatch(/success|succeeded|worked|passed|verified/i);
  });

  it("counts one kind of thing once, however the feeds spell it", () => {
    // The planet watcher follows the fold members and expdash sees every job
    // in the tree, so a partial overlap is the normal case: two starts seen
    // only by one and two only by the other are four starts, not two twice.
    const said = announce([
      event({ id: "ev_1", type: "started", priority: 3, exp: "a" }),
      event({ id: "ev_2", type: "started", priority: 3, exp: "b" }),
      event({ id: "ev_3", type: "running", priority: 3, exp: "c" }),
      event({ id: "ev_4", type: "running", priority: 3, exp: "d" }),
    ], new Map([["spectre", "coarsen"]]));
    expect(said.map((a) => a.text)).toEqual(["4 runs started in coarsen."]);
  });

  it("keeps a lone event's own title", () => {
    const [only] = announce([event({ id: "ev_1", type: "crashed", priority: 1, title: "Crashed: m06-planet-tests-a", detail: "exit code 1" })]);
    expect(only!.text).toBe("Crashed: m06-planet-tests-a - exit code 1.");
  });

  it("does not end a sentence its producer already ended", () => {
    // The planet watcher's titles carry their own full stop; expdash's do not.
    const [ended] = announce([event({ id: "ev_1", title: "s=0.95: crashed, as the record says.", detail: "" })]);
    expect(ended!.text).toBe("s=0.95: crashed, as the record says.");
    const [unended] = announce([event({ id: "ev_2", title: "Crashed: a-run", detail: "" })]);
    expect(unended!.text).toBe("Crashed: a-run.");
  });

  it("drops an alert's arithmetic before the sentence it fired on", () => {
    // Measured against the emulator feed on 2026-09-17: the planet watcher's
    // plateau alert is a 230-character title carrying its thresholds, and the
    // module clips chat at 280 silently and mid-word.
    const plateau = "m06-synthetic-c6-s0.96: spin-up plateau: |imbalance| not closing over 5 years while ice spreads (abs_imbalance 3.21 > 0.1, imbalance_trend 0.0021 > -0.02, ice_rise 0.068 > 0.005).";
    const [only] = announce([event({ id: "ev_1", type: "plateau", priority: 2, title: plateau, detail: "" })]);
    expect(only!.text).toBe("m06-synthetic-c6-s0.96: spin-up plateau: |imbalance| not closing over 5 years while ice spreads.");
    expect(only!.text.length).toBeLessThanOrEqual(SPOKEN_MAX);
  });

  it("never says more in one line than the room can carry", () => {
    const long = `${"word ".repeat(80)}end.`;
    const [only] = announce([event({ id: "ev_1", title: long, detail: "" })]);
    expect(only!.text.length).toBeLessThanOrEqual(SPOKEN_MAX);
    // Cut at a word boundary, and visibly cut.
    expect(only!.text.endsWith("…")).toBe(true);
    expect(only!.text).not.toMatch(/wor…$/);
  });

  it("leaves a line that fits exactly as the producer wrote it", () => {
    expect(fitToRoom("s=0.96: hit the 60-year cap unbalanced at -3.26 W/m²."))
      .toBe("s=0.96: hit the 60-year cap unbalanced at -3.26 W/m².");
    // A parenthetical is evidence, not decoration: it only goes when it must.
    expect(fitToRoom("s=0.94: won't make the cap (31 more years projected)."))
      .toBe("s=0.94: won't make the cap (31 more years projected).");
  });

  it("leaves out a detail too long to be heard in passing", () => {
    const [only] = announce([event({ id: "ev_1", detail: "x".repeat(200) })]);
    expect(only!.text).not.toContain("xxx");
  });

  it("groups by repo, so the same failure in two repos is two sentences", () => {
    const said = announce([
      event({ id: "ev_1", type: "crashed", priority: 1, repo: "spectre", title: "Crashed: tests", detail: "exit code 1" }),
      event({ id: "ev_2", type: "crashed", priority: 1, repo: "einstruct", title: "Crashed: assemble", detail: "exit code 2" }),
    ]);
    expect(said).toHaveLength(2);
    expect(said.map((a) => a.text).sort()).toEqual([
      "Crashed: assemble - exit code 2.",
      "Crashed: tests - exit code 1.",
    ]);
  });

  it("orders two identical sentences by their oldest event, not by feed order", () => {
    // Two repos, one job name: the text collides, and the tie-break must not.
    const events = [
      event({ id: "ev_9", type: "crashed", priority: 1, repo: "a", title: "Crashed: tests", detail: "exit code 1" }),
      event({ id: "ev_2", type: "crashed", priority: 1, repo: "b", title: "Crashed: tests", detail: "exit code 1" }),
    ];
    expect(announce(events).map((a) => a.ids[0])).toEqual(["ev_2", "ev_9"]);
    expect(announce([...events].reverse()).map((a) => a.ids[0])).toEqual(["ev_2", "ev_9"]);
  });

  it("tells a visitor the tree's label, never its identity", () => {
    // The feed says `spectre` because that identity is inside the bytes every
    // bundle id hashes (the rename ruling of 2026-09-16 keeps it). What a
    // person reads is `coarsen`.
    const titles = new Map([["spectre", "coarsen"]]);
    const crashes = [
      event({ id: "ev_1", type: "crashed", priority: 1, repo: "spectre" }),
      event({ id: "ev_2", type: "crashed", priority: 1, repo: "spectre" }),
    ];
    expect(announce(crashes, titles)[0]!.text).toBe("2 runs crashed in coarsen.");
    // Without a title the identity is still what a tree has always been shown as.
    expect(announce(crashes)[0]!.text).toBe("2 runs crashed in spectre.");
  });

  it("puts a crash before a routine finish", () => {
    const said = announce([
      event({ id: "ev_1", type: "completed", priority: 3, repo: "a" }),
      event({ id: "ev_2", type: "crashed", priority: 1, repo: "b" }),
    ]);
    expect(said[0]!.priority).toBe(1);
  });

  it("never exceeds the budget, however much happened", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      event({ id: `ev_${i + 1}`, type: `kind-${i}`, repo: `repo-${i}` }));
    expect(announce(many)).toHaveLength(ANNOUNCE_BUDGET);
  });

  it("is deterministic: the same poll says the same things in the same order", () => {
    const events = [
      event({ id: "ev_1", type: "crashed", priority: 1, repo: "zulu" }),
      event({ id: "ev_2", type: "crashed", priority: 1, repo: "alpha" }),
      event({ id: "ev_3", type: "completed", priority: 3, repo: "mike" }),
    ];
    expect(announce(events)).toEqual(announce([...events].reverse()));
  });
});

describe("treeLabel", () => {
  it("is the title when a tree has one, the identity when it does not", () => {
    const titles = new Map([["spectre", "coarsen"]]);
    expect(treeLabel("spectre", titles)).toBe("coarsen");
    expect(treeLabel("einstruct", titles)).toBe("einstruct");
    expect(treeLabel("einstruct")).toBe("einstruct");
    // An empty title is not a label; a tree is never shown as nothing.
    expect(treeLabel("x", new Map([["x", ""]]))).toBe("x");
  });
});

describe("peerIsSilent", () => {
  it("is false while the mirror is fresh, and false when there is no peer at all", () => {
    expect(peerIsSilent({ state: "ok", ageSeconds: 3, peer: "Legion", records: 105 })).toBe(false);
    expect(peerIsSilent(null)).toBe(false);
  });

  it("is true once the mirror stops passing, or says it is not ok", () => {
    expect(peerIsSilent({ state: "ok", ageSeconds: 3600, peer: "Legion", records: 105 })).toBe(true);
    expect(peerIsSilent({ state: "stale", ageSeconds: 1, peer: "Legion", records: 0 })).toBe(true);
  });
});
