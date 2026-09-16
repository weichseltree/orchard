// Turning Deepgram's streaming results into one thing a visitor said.
//
// The socket does not send utterances. It sends a stream of partial and
// settled fragments, and assembling them is where the bugs are, so the
// assembly lives here: pure, synchronous, and testable without a microphone
// or a key. `capture.ts` owns the socket; this owns the meaning.
//
// Three flags do all the work, and they are easy to confuse:
//
//   is_final      this FRAGMENT will not change again. The utterance is not
//                 over -- a sentence usually arrives as several of these.
//   speech_final  endpointing fired: the utterance IS over. This is the one
//                 that should send a line.
//   UtteranceEnd  a separate message, sent when `utterance_end_ms` is set and
//                 a silence gap is seen. It exists because `speech_final` is
//                 not reliable in noisy audio -- Deepgram's own guidance is to
//                 treat it as the backstop, not the primary.
//
// Treating `is_final` as the end is the classic error: "hello faye" leaves as
// "hello" and then "faye", neither of which she answers, and the visitor sees
// two lines in the log and no reply.

/** A `Results` message, in the part of its shape we rely on. */
export interface DeepgramResults {
  type: "Results";
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string; confidence?: number }> };
}

/** The `UtteranceEnd` backstop. Carries no text: the text already arrived. */
export interface DeepgramUtteranceEnd {
  type: "UtteranceEnd";
}

/** Anything else on the socket -- Metadata, SpeechStarted, errors, warnings. */
export interface DeepgramOther {
  type?: string;
}

export type DeepgramMessage = DeepgramResults | DeepgramUtteranceEnd | DeepgramOther;

/**
 * What the assembler is holding.
 *
 * `settled` is text that will not change; `pending` is the current interim
 * fragment, which the next interim replaces wholesale. Keeping them apart is
 * what makes a live caption possible without corrupting the final line.
 */
export interface TranscriptState {
  settled: readonly string[];
  pending: string;
}

export const EMPTY_TRANSCRIPT: TranscriptState = { settled: [], pending: "" };

/** What a message did: nothing, moved the caption, or completed an utterance. */
export interface TranscriptStep {
  state: TranscriptState;
  /** The full line, when this message ended an utterance. Null otherwise. */
  utterance: string | null;
  /** What to show live while speaking. Always current; never sent anywhere. */
  caption: string;
}

/** Settled text plus the fragment in flight, as a person would read it. */
export function captionOf(state: TranscriptState): string {
  return [...state.settled, state.pending].filter((part) => part.length > 0).join(" ");
}

function textOf(message: DeepgramResults): string {
  return (message.channel?.alternatives?.[0]?.transcript ?? "").trim();
}

/**
 * Advances the assembler by one socket message.
 *
 * Pure: the caller keeps the state. An utterance is returned exactly once --
 * `speech_final` clears the buffer, so the `UtteranceEnd` that often follows
 * finds nothing to send and stays silent. Without that, every sentence in a
 * quiet room is said twice.
 */
export function advance(state: TranscriptState, message: DeepgramMessage): TranscriptStep {
  if (message.type === "UtteranceEnd") {
    // The backstop. Whatever is held, settled or not, is what was said: if we
    // are here, endpointing did not fire, so `pending` is never going to be
    // confirmed and dropping it would lose the last word of the sentence.
    const utterance = captionOf(state);
    if (utterance.length === 0) return { state, utterance: null, caption: "" };
    return { state: EMPTY_TRANSCRIPT, utterance, caption: "" };
  }

  if (message.type !== "Results") return { state, utterance: null, caption: captionOf(state) };

  const results = message as DeepgramResults;
  const text = textOf(results);

  if (!results.is_final) {
    // An interim REPLACES the fragment in flight; it is a better guess at the
    // same audio, not more of it. Appending here is how captions stutter.
    const next: TranscriptState = { settled: state.settled, pending: text };
    return { state: next, utterance: null, caption: captionOf(next) };
  }

  // Settled. An empty settled fragment is normal (silence inside a sentence)
  // and must not push an empty string into the buffer.
  const settled = text.length > 0 ? [...state.settled, text] : [...state.settled];
  const next: TranscriptState = { settled, pending: "" };

  if (!results.speech_final) return { state: next, utterance: null, caption: captionOf(next) };

  const utterance = captionOf(next);
  if (utterance.length === 0) return { state: EMPTY_TRANSCRIPT, utterance: null, caption: "" };
  return { state: EMPTY_TRANSCRIPT, utterance, caption: "" };
}

/** Parses a socket frame, returning null rather than throwing on junk. */
export function parseMessage(data: string): DeepgramMessage | null {
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value !== "object" || value === null) return null;
    return value as DeepgramMessage;
  } catch {
    return null;
  }
}
