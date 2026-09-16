import { describe, expect, it } from "vitest";
import {
  ANNOUNCE_BUDGET, EMPTY_CURSOR, accumulate, announce, eventNumber,
  peerIsSilent, readFeed, treeLabel, type ComputeEvent,
} from "./events";

function event(over: Partial<ComputeEvent> = {}): ComputeEvent {
  return {
    id: "ev_1", ts: 1789524730, type: "completed", priority: 3,
    title: "Completed: a-run", detail: "ran 0m 20s", repo: "spectre", host: "SirBase",
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

  it("keeps a lone event's own title", () => {
    const [only] = announce([event({ id: "ev_1", type: "crashed", priority: 1, title: "Crashed: m06-planet-tests-a", detail: "exit code 1" })]);
    expect(only!.text).toBe("Crashed: m06-planet-tests-a - exit code 1.");
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
