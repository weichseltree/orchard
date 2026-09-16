import { describe, expect, it } from "vitest";
import {
  CHAT_LOG_MAX, CHAT_MIN_GAP_MS, CHAT_TEXT_MAX,
  appendLine, isSendable, maySend, outgoing, speakerOf, waitFor,
  type ChatEntry,
} from "./chat-log";

function entry(over: Partial<ChatEntry> = {}): ChatEntry {
  return { id: "1", name: "ann", text: "hello", mine: false, at: 1_700_000_000_000, ...over };
}

describe("appendLine", () => {
  it("keeps lines in the order they arrived", () => {
    const one = appendLine([], entry({ id: "1", text: "first" }));
    const two = appendLine(one, entry({ id: "2", text: "second" }));
    expect(two.map((l) => l.text)).toEqual(["first", "second"]);
  });

  it("drops a line it already holds — a reconnect re-delivers the subscription", () => {
    const one = appendLine([], entry({ id: "7" }));
    expect(appendLine(one, entry({ id: "7", text: "same line again" }))).toHaveLength(1);
    expect(appendLine(one, entry({ id: "7" }))[0]!.text).toBe("hello");
  });

  it("never grows past the cap, keeping the newest", () => {
    let lines: ChatEntry[] = [];
    for (let i = 0; i < CHAT_LOG_MAX + 10; i++) {
      lines = appendLine(lines, entry({ id: String(i), text: `line ${i}` }));
    }
    expect(lines).toHaveLength(CHAT_LOG_MAX);
    expect(lines[0]!.text).toBe("line 10");
    expect(lines[lines.length - 1]!.text).toBe(`line ${CHAT_LOG_MAX + 9}`);
  });

  it("does not mutate what it was given", () => {
    const before: ChatEntry[] = [entry({ id: "1" })];
    appendLine(before, entry({ id: "2" }));
    expect(before).toHaveLength(1);
  });

  it("takes a smaller cap when asked", () => {
    let lines: ChatEntry[] = [];
    for (const id of ["1", "2", "3"]) lines = appendLine(lines, entry({ id }), 2);
    expect(lines.map((l) => l.id)).toEqual(["2", "3"]);
  });
});

describe("outgoing and isSendable", () => {
  it("trims", () => {
    expect(outgoing("  hello there  ")).toBe("hello there");
  });

  it("treats whitespace alone as nothing to say", () => {
    for (const raw of ["", "   ", "\t\n "]) {
      expect(isSendable(raw)).toBe(false);
      expect(outgoing(raw)).toBe("");
    }
  });

  it("clips to what the module accepts, rather than letting it refuse", () => {
    const long = "x".repeat(CHAT_TEXT_MAX + 50);
    expect(outgoing(long)).toHaveLength(CHAT_TEXT_MAX);
    expect(isSendable(long)).toBe(true);
  });

  it("mirrors the module's limit", () => {
    expect(CHAT_TEXT_MAX).toBe(280);
  });
});

describe("maySend", () => {
  it("lets the first line through", () => {
    expect(maySend(null, 1000)).toBe(true);
    expect(waitFor(null, 1000)).toBe(0);
  });

  it("holds the visitor to the module's gap rather than letting the reducer refuse", () => {
    expect(maySend(1000, 1000 + CHAT_MIN_GAP_MS - 1)).toBe(false);
    expect(maySend(1000, 1000 + CHAT_MIN_GAP_MS)).toBe(true);
  });

  it("says how long is left", () => {
    expect(waitFor(1000, 1300)).toBe(400);
    expect(waitFor(1000, 1700)).toBe(0);
    // Never negative, however long ago the last line was.
    expect(waitFor(1000, 99_000)).toBe(0);
  });

  it("covers the join trap: joining stamps the same clock", () => {
    // The caller passes the JOIN time as lastSentAt, because the module does.
    const joinedAt = 5_000;
    expect(maySend(joinedAt, joinedAt + 100)).toBe(false);
    expect(maySend(joinedAt, joinedAt + CHAT_MIN_GAP_MS)).toBe(true);
  });

  it("mirrors the module's gap", () => {
    expect(CHAT_MIN_GAP_MS).toBe(700);
  });
});

describe("speakerOf", () => {
  it("is the name", () => {
    expect(speakerOf(entry({ name: "ann" }))).toBe("ann");
  });

  it("never shows an empty speaker", () => {
    expect(speakerOf(entry({ name: "" }))).toBe("visitor");
    expect(speakerOf(entry({ name: "   " }))).toBe("visitor");
  });
});
