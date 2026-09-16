import { describe, expect, it } from "vitest";
import { SPEAKER_QUEUE_MAX, Speaker, isNewLine, onDisconnectAction } from "./listen";

describe("isNewLine", () => {
  const joined = 1_000_000n;

  it("hears a line said after she joined", () => {
    expect(isNewLine({ sender: "visitor", atMicros: joined + 1n }, "faye", joined)).toBe(true);
  });

  it("skips the room's history that arrives with the join", () => {
    expect(isNewLine({ sender: "visitor", atMicros: joined - 1n }, "faye", joined)).toBe(false);
    expect(isNewLine({ sender: "visitor", atMicros: joined }, "faye", joined)).toBe(false);
  });

  it("hears nothing before her own row is in the view", () => {
    expect(isNewLine({ sender: "visitor", atMicros: joined + 1n }, "faye", null)).toBe(false);
  });

  it("never answers herself", () => {
    expect(isNewLine({ sender: "faye", atMicros: joined + 1n }, "faye", joined)).toBe(false);
  });
});

describe("onDisconnectAction", () => {
  it("rejects while the connection is still coming up", () => {
    expect(onDisconnectAction({ connected: false, leaving: false })).toBe("reject");
  });

  it("exits nonzero on a drop, so systemd restarts her", () => {
    expect(onDisconnectAction({ connected: true, leaving: false })).toBe("exit-failed");
  });

  it("exits cleanly when she is leaving on purpose", () => {
    expect(onDisconnectAction({ connected: true, leaving: true })).toBe("exit-ok");
  });
});

describe("Speaker", () => {
  function harness() {
    let clock = 0;
    const sent: Array<[number, string]> = [];
    const refused: string[] = [];
    const dropped: string[] = [];
    const speaker = new Speaker(
      async (text) => {
        if (text === "refuse me") throw new Error("slow down");
        sent.push([clock, text]);
      },
      {
        gapMs: 900,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
        onRefused: (text) => refused.push(text),
        onDropped: (text) => dropped.push(text),
      },
    );
    return { speaker, sent, refused, dropped, advance: (ms: number) => (clock += ms) };
  }

  it("spaces lines queued together, in the order they were queued", async () => {
    const { speaker, sent } = harness();
    speaker.heldUntilGap(0);
    // The greeting and a reply to a question asked 100 ms later.
    const greeting = speaker.say("I am here.");
    const reply = speaker.say("I cannot see a peer from here.");
    await Promise.all([greeting, reply]);
    expect(sent).toEqual([[900, "I am here."], [1800, "I cannot see a peer from here."]]);
  });

  it("measures the gap from when a send completed, not when it began", async () => {
    let clock = 0;
    const sent: Array<[number, string]> = [];
    const speaker = new Speaker(
      async (text) => {
        sent.push([clock, text]);
        clock += 500; // a slow round trip
      },
      { gapMs: 900, now: () => clock, sleep: async (ms) => void (clock += ms), onRefused: () => undefined, onDropped: () => undefined },
    );
    await Promise.all([speaker.say("one"), speaker.say("two")]);
    expect(sent).toEqual([[0, "one"], [1400, "two"]]);
  });

  it("does not wait when the gap has already passed", async () => {
    const { speaker, sent, advance } = harness();
    speaker.heldUntilGap(0);
    advance(5000);
    await speaker.say("now");
    expect(sent).toEqual([[5000, "now"]]);
  });

  it("sends nothing until the join settles, then times the gap from its hold", async () => {
    const { speaker, sent, advance } = harness();
    let acknowledge!: () => void;
    const join = new Promise<void>((resolve) => (acknowledge = resolve));
    speaker.holdUntil(join.then(() => speaker.heldUntilGap(2000)));
    const reply = speaker.say("a reply queued while the join was in flight");
    await Promise.resolve();
    expect(sent).toEqual([]);
    advance(2000);
    acknowledge();
    await reply;
    expect(sent).toEqual([[2900, "a reply queued while the join was in flight"]]);
  });

  it("turns replies away when the queue is full, never announcements", async () => {
    const { speaker, sent, dropped } = harness();
    const queued: Promise<void>[] = [];
    for (let i = 0; i < SPEAKER_QUEUE_MAX + 2; i++) queued.push(speaker.say(`reply ${i}`, { droppable: true }));
    queued.push(speaker.say("announcement"));
    await Promise.all(queued);
    expect(dropped).toEqual([`reply ${SPEAKER_QUEUE_MAX}`, `reply ${SPEAKER_QUEUE_MAX + 1}`]);
    expect(sent.map(([, text]) => text)).toEqual([
      ...Array.from({ length: SPEAKER_QUEUE_MAX }, (_, i) => `reply ${i}`),
      "announcement",
    ]);
  });

  it("reports a refusal and goes on speaking", async () => {
    const { speaker, sent, refused } = harness();
    await speaker.say("refuse me");
    await speaker.say("after");
    expect(refused).toEqual(["refuse me"]);
    expect(sent.map(([, text]) => text)).toEqual(["after"]);
  });
});
