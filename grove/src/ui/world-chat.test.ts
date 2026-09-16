import { describe, expect, it } from "vitest";
import { VR_LOG_LINES, clip, logKey, visibleLines } from "./world-chat";
import type { ChatEntry } from "./chat-log";

function line(over: Partial<ChatEntry> = {}): ChatEntry {
  return { id: "1", name: "faye", text: "I am here.", mine: false, at: 0, ...over };
}

/** A measurer where every character is one unit wide; enough to test the cut. */
const monospace = { measureText: (text: string) => ({ width: text.length }) as TextMetrics };

describe("visibleLines", () => {
  it("keeps the newest lines that fit", () => {
    const many = Array.from({ length: VR_LOG_LINES + 5 }, (_, i) => line({ id: String(i) }));
    const shown = visibleLines(many);
    expect(shown).toHaveLength(VR_LOG_LINES);
    expect(shown.at(-1)?.id).toBe(String(VR_LOG_LINES + 4));
  });

  it("shows fewer than the panel holds without padding", () => {
    expect(visibleLines([line()])).toHaveLength(1);
  });

  it("fits at least a short exchange", () => {
    expect(VR_LOG_LINES).toBeGreaterThanOrEqual(6);
  });
});

describe("logKey", () => {
  it("is stable when nothing was said", () => {
    // The panel redraws when this changes and not otherwise. A key that moved
    // every frame would upload a texture at 72 Hz against a 256 MB budget.
    const lines = [line({ id: "1" }), line({ id: "2", text: "two" })];
    expect(logKey(lines)).toBe(logKey([...lines]));
  });

  it("changes when a line is added", () => {
    const before = [line({ id: "1" })];
    expect(logKey(before)).not.toBe(logKey([...before, line({ id: "2" })]));
  });

  it("changes when the same id carries different words", () => {
    expect(logKey([line({ id: "1", text: "a" })])).not.toBe(logKey([line({ id: "1", text: "b" })]));
  });

  it("distinguishes two speakers saying the same thing", () => {
    expect(logKey([line({ id: "1", name: "faye" })])).not.toBe(logKey([line({ id: "1", name: "manuel" })]));
  });

  it("is not fooled by a line containing its own separator", () => {
    const sneaky = logKey([line({ id: "1", name: "a", text: "b|c" })]);
    const other = logKey([line({ id: "1", name: "a|b", text: "c" })]);
    expect(sneaky).not.toBe(other);
  });
});

describe("clip", () => {
  it("leaves a line that fits alone", () => {
    expect(clip(monospace, "hello", 20)).toBe("hello");
  });

  it("cuts a long line rather than letting it push the others off", () => {
    // Someone who says a long thing should not silently erase the
    // conversation around it, which is what wrapping would do on a panel
    // this size.
    const cut = clip(monospace, "x".repeat(100), 10);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(10);
  });

  it("does not return more than was asked for at any width", () => {
    for (const max of [1, 2, 3, 8, 40]) {
      expect(clip(monospace, "y".repeat(200), max).length).toBeLessThanOrEqual(Math.max(max, 1));
    }
  });
});
