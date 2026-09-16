import { describe, expect, it } from "vitest";
import { BroadcastGate, SEEN_MAX, knowsCue, type BroadcastRow } from "./broadcast";

function row(over: Partial<BroadcastRow> = {}): BroadcastRow {
  return {
    id: "1",
    kind: "notice",
    cue: "",
    text: "the orchard is updating",
    room: "",
    at: 1_000_000,
    expiresAt: 1_060_000,
    ...over,
  };
}

/** A gate past its backlog, which is the normal state. */
function open(): BroadcastGate {
  const gate = new BroadcastGate();
  gate.open();
  return gate;
}

describe("the backlog", () => {
  it("acts on nothing before the initial rows have landed", () => {
    // The table is public: a joining client receives every row in it. Acting
    // on them replays the morning at whoever walks in at noon.
    const gate = new BroadcastGate();
    expect(gate.live).toBe(false);
    expect(gate.admit(row(), "grove")).toBeNull();
  });

  it("acts once the boundary is drawn", () => {
    const gate = open();
    expect(gate.admit(row(), "grove")).not.toBeNull();
  });

  it("draws the boundary again after a reconnect", () => {
    const gate = open();
    gate.close();
    expect(gate.admit(row({ id: "9" }), "grove")).toBeNull();
  });
});

describe("each row at most once", () => {
  it("ignores a row it has already acted on", () => {
    // A reconnect re-delivers the subscription; the same cue must not fire twice.
    const gate = open();
    expect(gate.admit(row({ id: "7" }), "grove")).not.toBeNull();
    expect(gate.admit(row({ id: "7" }), "grove")).toBeNull();
  });

  it("does not confuse two rows fired in the same millisecond", () => {
    const gate = open();
    expect(gate.admit(row({ id: "7", at: 5 }), "grove")).not.toBeNull();
    expect(gate.admit(row({ id: "8", at: 5 }), "grove")).not.toBeNull();
  });

  it("bounds what it remembers", () => {
    const gate = open();
    for (let i = 0; i < SEEN_MAX + 10; i++) gate.admit(row({ id: `n${i}` }), "grove");
    // The oldest ids fall out; they cannot be re-delivered anyway, because the
    // module sweeps a row at expiry.
    expect(gate.admit(row({ id: "n0" }), "grove")).not.toBeNull();
    expect(gate.admit(row({ id: `n${SEEN_MAX + 9}` }), "grove")).toBeNull();
  });
});

describe("expiry", () => {
  it("reads expiry as a duration, so a wrong client clock cannot break it", () => {
    // Both stamps are the server's. Comparing expiresAt to the CLIENT's clock
    // would make a visitor whose machine is minutes fast discard everything,
    // and one minutes slow act on rows long dead -- neither of which looks
    // like a clock problem from inside the room.
    const gate = open();
    const action = gate.admit(row({ at: 1_000_000, expiresAt: 1_060_000 }), "grove");
    expect(action?.holdMs).toBe(60_000);
  });

  it("refuses a row that was already dead when it was written", () => {
    const gate = open();
    expect(gate.admit(row({ at: 500, expiresAt: 500 }), "grove")).toBeNull();
    expect(gate.admit(row({ id: "2", at: 900, expiresAt: 500 }), "grove")).toBeNull();
  });

  it("refuses a row with unreadable stamps rather than holding it forever", () => {
    const gate = open();
    expect(gate.admit(row({ at: Number.NaN }), "grove")).toBeNull();
  });
});

describe("which room", () => {
  it("delivers a row addressed to every room", () => {
    expect(open().admit(row({ room: "" }), "greenhouse")).not.toBeNull();
  });

  it("delivers a row addressed to this one", () => {
    expect(open().admit(row({ room: "grove" }), "grove")).not.toBeNull();
  });

  it("ignores a row for somewhere else", () => {
    expect(open().admit(row({ room: "greenhouse" }), "grove")).toBeNull();
  });
});

describe("order", () => {
  it("is by `at`, never by id", () => {
    // SpacetimeDB's auto-increment ids are not sequential and gaps are normal,
    // so an id identifies a row and does not place it in time. Here the ids
    // order the rows backwards from how they were fired.
    const gate = open();
    const actions = gate.admitAll(
      [row({ id: "900", at: 20, text: "second" }), row({ id: "100", at: 10, text: "first" })],
      "grove",
    );
    expect(actions.map((a) => a.kind === "notice" && a.text)).toEqual(["first", "second"]);
  });

  it("breaks a tie the same way every time", () => {
    const gate = open();
    const rows = [row({ id: "b", at: 5, text: "B" }), row({ id: "a", at: 5, text: "A" })];
    const actions = gate.admitAll(rows, "grove");
    expect(actions.map((a) => a.kind === "notice" && a.text)).toEqual(["A", "B"]);
  });

  it("does not reorder the caller's array", () => {
    const gate = open();
    const rows = [row({ id: "2", at: 20 }), row({ id: "1", at: 10 })];
    gate.admitAll(rows, "grove");
    expect(rows.map((r) => r.id)).toEqual(["2", "1"]);
  });
});

describe("kinds", () => {
  it("ignores a kind this build does not know, rather than failing", () => {
    // Forward compatibility: the module may learn a kind before the client is
    // redeployed, and an old client must stay quiet rather than break.
    expect(open().admit(row({ kind: "fireworks" }), "grove")).toBeNull();
  });

  it("carries a cue and its words", () => {
    const action = open().admit(row({ kind: "cue", cue: "turnstile", text: "hold still" }), "grove");
    expect(action).toMatchObject({ kind: "cue", cue: "turnstile", text: "hold still" });
  });

  it("is not a cue without a name", () => {
    expect(open().admit(row({ kind: "cue", cue: "  " }), "grove")).toBeNull();
  });

  it("is not a notice without words", () => {
    expect(open().admit(row({ kind: "notice", text: "  " }), "grove")).toBeNull();
  });
});

describe("knowsCue", () => {
  it("knows the built-in this stage ships", () => {
    expect(knowsCue("notice")).toBe(true);
  });

  it("knows the update cue, which has an effect behind it now", () => {
    expect(knowsCue("update")).toBe(true);
  });

  it("knows the turnstile cue, which holds the doorways", () => {
    expect(knowsCue("turnstile")).toBe(true);
  });

  it("does not claim a cue nothing is built for", () => {
    // Claiming one fires a moment nobody sees, and reports nothing wrong.
    expect(knowsCue("fireworks")).toBe(false);
  });

  it("does not know a bundle it has never fetched", () => {
    // An unknown cue is silence, not a fallback notice: a cue is a moment and
    // cannot wait for a download (VR-PRESENCE §8 ruling 4 is still open).
    expect(knowsCue("sha256-abc123")).toBe(false);
  });
});
