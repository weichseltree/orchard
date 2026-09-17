import { describe, expect, it } from "vitest";
import { EMPTY_STATE, describeAge, intentOf, replyTo, type FayeState } from "./reply";

const titles = new Map([["spectre", "coarsen"]]);

function state(over: Partial<FayeState> = {}): FayeState {
  return {
    ...EMPTY_STATE,
    hasFeed: true,
    // expdash answering is what makes the lanes knowable; a state built
    // without it is the second feed alone (see the tests below).
    knowsRunning: true,
    lanesFresh: true,
    hosts: ["Legion", "SirBase"],
    mirror: { state: "ok", ageSeconds: 3, peer: "Legion", records: 105 },
    ...over,
  };
}

describe("intentOf", () => {
  it("ignores a room that is not talking to her", () => {
    expect(intentOf("what is running?")).toBe("none");
    expect(intentOf("hello everyone")).toBe("none");
    // A room where every sentence might summon a spirit is unusable.
    expect(intentOf("the peer looks slow today")).toBe("none");
  });

  it("answers when named, whatever the case", () => {
    expect(intentOf("Faye, what is running?")).toBe("running");
    expect(intentOf("FAYE status")).toBe("running");
    expect(intentOf("hey faye")).toBe("greeting");
  });

  it("does not answer to a name that merely contains hers", () => {
    expect(intentOf("fayette is running")).toBe("none");
    expect(intentOf("unfaye")).toBe("none");
  });

  it("reads the peer and help asks", () => {
    expect(intentOf("faye how is legion")).toBe("peer");
    expect(intentOf("faye is the mirror ok")).toBe("peer");
    expect(intentOf("faye help")).toBe("help");
  });

  it("falls back to help when named but not understood", () => {
    expect(intentOf("faye sing me a song")).toBe("help");
  });

  it("answers to the name a transcriber writes instead of hers", () => {
    // Spoken, "Faye" comes back as an ordinary word. Ignoring those is
    // indistinguishable from a dead microphone, which reads as broken.
    expect(intentOf("fay what is running")).toBe("running");
    expect(intentOf("hey fae")).toBe("greeting");
    expect(intentOf("fey help")).toBe("help");
  });

  it("still does not answer to a longer word that starts the same way", () => {
    expect(intentOf("fayette is running")).toBe("none");
    expect(intentOf("faylight")).toBe("none");
    expect(intentOf("feyd is here")).toBe("none");
  });
});

describe("replyTo", () => {
  it("says nothing at all when not addressed", () => {
    expect(replyTo("what is running?", state())).toBeNull();
  });

  it("greets with what she is watching", () => {
    expect(replyTo("hi faye", state())).toBe("I am here. I am watching Legion and SirBase.");
  });

  it("reports the peer's freshness in words, not seconds", () => {
    expect(replyTo("faye how is the peer", state())).toBe(
      "Legion is reporting, 105 records, last heard 3 seconds ago.");
  });

  it("says plainly when the peer has gone quiet", () => {
    const quiet = state({ mirror: { state: "ok", ageSeconds: 3600, peer: "Legion", records: 105 } });
    expect(replyTo("faye peer", quiet)).toBe(
      "Legion has stopped reporting; the last word from it was 60 minutes ago.");
  });

  it("admits when there is no peer to see", () => {
    expect(replyTo("faye peer", state({ mirror: null }))).toBe("I cannot see a peer from here.");
  });

  it("admits when the compute has not answered yet, rather than guessing", () => {
    expect(replyTo("faye what is running", state({ hasFeed: false })))
      .toBe("I have not heard from the compute yet.");
  });

  it("treats an empty card as a real answer", () => {
    expect(replyTo("faye what is running", state())).toBe("Nothing is running that I can see.");
  });

  it("says what she last saw as the past, not as the present", () => {
    // The lane facts survive an expdash outage rather than becoming an idle
    // box, but an hour-old count in the present tense is a made-up freshness.
    const stale = state({ lanesFresh: false, running: [{ host: "SirBase", tree: "spectre" }] });
    expect(replyTo("faye what is running", stale, titles))
      .toBe("When I last looked, 1 run: 1 on SirBase (coarsen) (the dashboard is not answering now).");
    expect(replyTo("faye what is running", state({ lanesFresh: false })))
      .toBe("When I last looked, nothing was running.");
    // And the mirror's age is the age of a reading she is no longer getting.
    expect(replyTo("faye how is the peer", state({ lanesFresh: false })))
      .toBe("The dashboard is not answering me; when it last did, Legion was reporting.");
  });

  it("does not call the boxes idle when she only hears what runs declare", () => {
    // With a run's own announcement feed and no expdash, an empty `running` is
    // what she cannot see, not what the boxes are doing (src/faye/feeds.ts).
    expect(replyTo("faye what is running", state({ knowsRunning: false })))
      .toBe("I hear what the runs say about themselves, but I cannot see the lanes from here.");
  });

  const run = (host: string, tree: string) => ({ host, tree });

  it("names the tree's label, never its identity", () => {
    const busy = state({ running: [run("SirBase", "spectre"), run("SirBase", "spectre")] });
    expect(replyTo("faye what is running", busy, titles)).toBe("2 runs: 2 on SirBase (2 coarsen).");
    // Without a title a tree is shown by its name, as it always has been.
    expect(replyTo("faye what is running", busy)).toBe("2 runs: 2 on SirBase (2 spectre).");
  });

  it("says which box each run is on, busiest box first", () => {
    const busy = state({
      running: [run("Legion", "arcedit"), run("SirBase", "arcedit"), run("SirBase", "spectre")],
    });
    expect(replyTo("faye what is running", busy, titles))
      .toBe("3 runs: 2 on SirBase (arcedit, coarsen), 1 on Legion (arcedit).");
  });

  it("never says the card: a cpu-lane run holds no GPU", () => {
    const busy = state({ running: [run("SirBase", "spectre")] });
    expect(replyTo("faye runs", busy, titles)).toBe("1 run: 1 on SirBase (coarsen).");
    expect(replyTo("faye runs", busy, titles)).not.toContain("card");
  });

  it("puts the busiest tree first and caps the list per box", () => {
    const busy = state({
      running: [
        run("SirBase", "a"),
        ...Array.from({ length: 5 }, () => run("SirBase", "spectre")),
        ...Array.from({ length: 3 }, () => run("SirBase", "b")),
        run("SirBase", "c"), run("SirBase", "c"),
      ],
    });
    expect(replyTo("faye runs", busy, titles))
      .toBe("11 runs: 11 on SirBase (5 coarsen, 3 b, 2 c, 1 more).");
  });

  it("is deterministic when two trees or two boxes are equally busy", () => {
    const tied = state({ running: [run("SirBase", "zulu"), run("Legion", "alpha")] });
    const reordered = state({ running: [run("Legion", "alpha"), run("SirBase", "zulu")] });
    expect(replyTo("faye runs", tied)).toBe(replyTo("faye runs", reordered));
    expect(replyTo("faye runs", tied)).toBe("2 runs: 1 on Legion (alpha), 1 on SirBase (zulu).");
  });

  it("never claims anything succeeded", () => {
    const busy = state({ running: [run("SirBase", "spectre")], seenByType: new Map([["completed", 9]]) });
    for (const ask of ["faye status", "faye peer", "hi faye", "faye help"]) {
      expect(replyTo(ask, busy, titles)).not.toMatch(/success|succeeded|worked|passed/i);
    }
  });

  it("answers in one line", () => {
    const busy = state({ running: [run("SirBase", "spectre")] });
    for (const ask of ["faye status", "faye peer", "hi faye", "faye help"]) {
      expect(replyTo(ask, busy, titles)).not.toContain("\n");
    }
  });
});

describe("describeAge", () => {
  it("speaks in the unit a person would use", () => {
    expect(describeAge(3)).toBe("3 seconds");
    expect(describeAge(89)).toBe("89 seconds");
    expect(describeAge(600)).toBe("10 minutes");
    expect(describeAge(7200)).toBe("2 hours");
  });

  it("does not invent an age it cannot read", () => {
    expect(describeAge(Number.NaN)).toBe("an unknown time");
    expect(describeAge(-5)).toBe("an unknown time");
  });
});
