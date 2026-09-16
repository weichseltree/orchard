import { describe, expect, it } from "vitest";
import {
  EMPTY_TRANSCRIPT,
  advance,
  captionOf,
  parseMessage,
  type DeepgramMessage,
  type TranscriptState,
} from "./transcript";

function results(transcript: string, flags: { is_final?: boolean; speech_final?: boolean } = {}): DeepgramMessage {
  return {
    type: "Results",
    is_final: flags.is_final ?? false,
    speech_final: flags.speech_final ?? false,
    channel: { alternatives: [{ transcript }] },
  };
}

/** Feeds a whole conversation, returning every utterance it produced. */
function run(messages: readonly DeepgramMessage[]): { said: string[]; state: TranscriptState; caption: string } {
  let state = EMPTY_TRANSCRIPT;
  let caption = "";
  const said: string[] = [];
  for (const message of messages) {
    const step = advance(state, message);
    state = step.state;
    caption = step.caption;
    if (step.utterance !== null) said.push(step.utterance);
  }
  return { said, state, caption };
}

describe("advance", () => {
  it("joins the fragments of one sentence into one line", () => {
    // The bug this exists to prevent: "hello" and "faye" sent as two lines,
    // neither of which she answers.
    const { said } = run([
      results("hello", { is_final: true }),
      results("faye", { is_final: true, speech_final: true }),
    ]);
    expect(said).toEqual(["hello faye"]);
  });

  it("lets an interim replace the fragment in flight, not extend it", () => {
    const { caption, said } = run([
      results("what is"),
      results("what is run"),
      results("what is running"),
    ]);
    expect(caption).toBe("what is running");
    expect(said).toEqual([]);
  });

  it("keeps settled text while a new fragment is still moving", () => {
    const { caption } = run([
      results("faye", { is_final: true }),
      results("what is"),
    ]);
    expect(caption).toBe("faye what is");
  });

  it("says a sentence once when UtteranceEnd follows speech_final", () => {
    // Both arrive in a quiet room. The buffer is empty by the time the
    // backstop lands, so it has nothing to send.
    const { said } = run([
      results("faye status", { is_final: true, speech_final: true }),
      { type: "UtteranceEnd" },
    ]);
    expect(said).toEqual(["faye status"]);
  });

  it("uses UtteranceEnd as the backstop when endpointing never fires", () => {
    const { said } = run([
      results("faye", { is_final: true }),
      results("how is the peer", { is_final: true }),
      { type: "UtteranceEnd" },
    ]);
    expect(said).toEqual(["faye how is the peer"]);
  });

  it("keeps the last word when the backstop lands on an unconfirmed fragment", () => {
    // `pending` will never be confirmed now; dropping it loses "peer".
    const { said } = run([
      results("faye how is the", { is_final: true }),
      results("peer"),
      { type: "UtteranceEnd" },
    ]);
    expect(said).toEqual(["faye how is the peer"]);
  });

  it("stays silent on an UtteranceEnd with nothing held", () => {
    const { said } = run([{ type: "UtteranceEnd" }]);
    expect(said).toEqual([]);
  });

  it("does not push empty settled fragments into the line", () => {
    const { said } = run([
      results("faye", { is_final: true }),
      results("", { is_final: true }),
      results("runs", { is_final: true, speech_final: true }),
    ]);
    expect(said).toEqual(["faye runs"]);
  });

  it("does not send a line for silence that endpoints", () => {
    const { said } = run([results("", { is_final: true, speech_final: true })]);
    expect(said).toEqual([]);
  });

  it("ignores the messages that are not transcription", () => {
    const { said, caption } = run([
      { type: "Metadata" },
      { type: "SpeechStarted" },
      results("faye", { is_final: true }),
      { type: "Metadata" },
    ]);
    expect(said).toEqual([]);
    expect(caption).toBe("faye");
  });

  it("starts clean for the next sentence", () => {
    const { said, state } = run([
      results("faye status", { is_final: true, speech_final: true }),
      results("nothing", { is_final: true, speech_final: true }),
    ]);
    expect(said).toEqual(["faye status", "nothing"]);
    expect(state).toEqual(EMPTY_TRANSCRIPT);
  });
});

describe("captionOf", () => {
  it("reads settled text and the fragment in flight as one sentence", () => {
    expect(captionOf({ settled: ["faye", "what is"], pending: "runn" })).toBe("faye what is runn");
  });

  it("has no stray spaces when nothing is in flight", () => {
    expect(captionOf({ settled: ["faye"], pending: "" })).toBe("faye");
    expect(captionOf(EMPTY_TRANSCRIPT)).toBe("");
  });
});

describe("parseMessage", () => {
  it("reads a frame", () => {
    expect(parseMessage('{"type":"UtteranceEnd"}')).toEqual({ type: "UtteranceEnd" });
  });

  it("returns null on junk rather than throwing into the socket handler", () => {
    expect(parseMessage("not json")).toBeNull();
    expect(parseMessage("null")).toBeNull();
    expect(parseMessage("[1,2]")).not.toBeNull();
  });
});
