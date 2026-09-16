// What Faye says back when a visitor speaks to her.
//
// Deterministic, and from data she already holds. She answers out of the
// compute feed she is watching (`events.ts`) and says plainly when she does
// not know -- she never guesses at a number, and there is no model call here.
// A spirit that invents an answer about a run is worse than one that says it
// cannot see.
//
// The same honesty rule as `announce`: "completed exit=0" is also what a kill,
// an OOM and a time-budget stop record, so nothing here reports a success.

import { peerIsSilent, treeLabel, type MirrorHealth, type TreeTitles } from "./events";

/** What Faye knows right now, as the poll loop last left it. */
export interface FayeState {
  /** Hosts the feed mentions: this box, and the peer when the mirror is passing. */
  hosts: readonly string[];
  mirror: MirrorHealth | null;
  /** Counts of the event types seen since she arrived, by type. */
  seenByType: ReadonlyMap<string, number>;
  /** How many runs are on the card right now, by tree identity. */
  runningByTree: ReadonlyMap<string, number>;
  /** Whether a feed has answered at all yet. */
  hasFeed: boolean;
}

export const EMPTY_STATE: FayeState = {
  hosts: [],
  mirror: null,
  seenByType: new Map(),
  runningByTree: new Map(),
  hasFeed: false,
};

/** The things a visitor can ask for. `none` means they were not talking to her. */
export type Intent = "greeting" | "running" | "peer" | "help" | "none";

/**
 * Whether a line is addressed to Faye, and what it asks.
 *
 * She answers only when named. A room where every sentence might summon a
 * spirit is a room nobody can talk in, and she has no way to tell a question
 * put to her from one put to another visitor.
 */
export function intentOf(text: string): Intent {
  const line = text.toLowerCase();
  if (!/\bfaye\b/.test(line)) return "none";
  if (/\b(help|what can you|commands?)\b/.test(line)) return "help";
  if (/\b(peer|legion|mirror|other box)\b/.test(line)) return "peer";
  if (/\b(running|busy|compute|jobs?|runs?|status|going on)\b/.test(line)) return "running";
  if (/\b(hello|hi|hey|greetings|there)\b/.test(line)) return "greeting";
  // Named but unrecognised: say so rather than guess at what was meant.
  return "help";
}

/**
 * Faye's answer, or null when she was not addressed. One line; the room is a
 * place to stand in, not a terminal.
 */
export function replyTo(text: string, state: FayeState, titles?: TreeTitles): string | null {
  const intent = intentOf(text);
  if (intent === "none") return null;

  if (intent === "greeting") {
    const where = state.hosts.length > 0 ? ` I am watching ${state.hosts.join(" and ")}.` : "";
    return `I am here.${where}`;
  }

  if (intent === "help") {
    return "Ask me what is running, or about the peer. I watch the compute on both boxes and say what changes.";
  }

  if (intent === "peer") {
    if (!state.mirror) return "I cannot see a peer from here.";
    const { peer, ageSeconds, records } = state.mirror;
    if (peerIsSilent(state.mirror)) {
      return `${peer} has stopped reporting; the last word from it was ${describeAge(ageSeconds)} ago.`;
    }
    return `${peer} is reporting, ${records} record${records === 1 ? "" : "s"}, last heard ${describeAge(ageSeconds)} ago.`;
  }

  // "running"
  if (!state.hasFeed) return "I have not heard from the compute yet.";
  const running = [...state.runningByTree.entries()].filter(([, n]) => n > 0);
  if (running.length === 0) {
    // Nothing on the card is a real answer, and a common one at night.
    return "Nothing is running that I can see.";
  }
  const total = running.reduce((sum, [, n]) => sum + n, 0);
  // Busiest first, then by label, so the same state always reads the same way.
  const parts = running
    .map(([tree, n]) => ({ label: treeLabel(tree, titles), n }))
    .sort((a, b) => (b.n !== a.n ? b.n - a.n : a.label < b.label ? -1 : 1))
    .slice(0, 3)
    .map(({ label, n }) => `${n} in ${label}`);
  return `${total} run${total === 1 ? "" : "s"} on the card: ${parts.join(", ")}.`;
}

/** A rough age a person can hear, rather than a number of seconds. */
export function describeAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "an unknown time";
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  return `${Math.round(minutes / 60)} hours`;
}
