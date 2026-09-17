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

import { SPOKEN_MAX, peerIsSilent, treeLabel, type MirrorHealth, type RunningRun, type TreeTitles } from "./events";
import { NAMES } from "./names";

/** What Faye knows right now, as the poll loop last left it. */
export interface FayeState {
  /** Hosts the feed mentions: this box, and the peer when the mirror is passing. */
  hosts: readonly string[];
  mirror: MirrorHealth | null;
  /** Counts of the event types seen since she arrived, by type. */
  seenByType: ReadonlyMap<string, number>;
  /** What is running right now, on which box (`readFeed`). */
  running: readonly RunningRun[];
  /** Whether a feed has answered at all yet. */
  hasFeed: boolean;
  /**
   * Whether any feed she reads can tell her what is on the lanes. expdash's
   * can; a run's own announcement feed cannot -- it says what happened, not
   * what is happening -- so with that one alone an empty `running` means she
   * cannot see, not that the boxes are idle (`feeds.ts`).
   */
  knowsRunning: boolean;
  /**
   * Whether the lane feed answered the LAST poll. The facts above survive an
   * outage rather than becoming an idle box, but an hour-old count said in the
   * present tense is a fabricated freshness, so she says when it is the last
   * she saw.
   */
  lanesFresh: boolean;
  /**
   * How long ago the lane feed last answered, in seconds. Only meaningful
   * while `lanesFresh` is false, and computed by the poll rather than by a
   * clock here: an hour-old count and a half-minute-old one must not read the
   * same way.
   */
  lanesAgeSeconds: number;
}

export const EMPTY_STATE: FayeState = {
  hosts: [],
  mirror: null,
  seenByType: new Map(),
  running: [],
  hasFeed: false,
  knowsRunning: false,
  lanesFresh: false,
  lanesAgeSeconds: 0,
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
  if (!NAMES.test(line)) return "none";
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
    // The mirror's age is the age of a reading she may no longer be getting;
    // once the dashboard stops answering it is history, and said as history.
    if (!state.lanesFresh) {
      return `The dashboard has not answered for ${describeAge(state.lanesAgeSeconds)}; when it last did, ${peer} ${peerIsSilent(state.mirror) ? "had stopped reporting" : "was reporting"}.`;
    }
    if (peerIsSilent(state.mirror)) {
      return `${peer} has stopped reporting; the last word from it was ${describeAge(ageSeconds)} ago.`;
    }
    return `${peer} is reporting, ${records} record${records === 1 ? "" : "s"}, last heard ${describeAge(ageSeconds)} ago.`;
  }

  // "running"
  if (!state.hasFeed) return "I have not heard from the compute yet.";
  if (!state.knowsRunning) {
    // She hears what runs declare and nothing about the lanes. Saying nothing
    // is running would be a fact she does not have.
    return "I hear what the runs say about themselves, but I cannot see the lanes from here.";
  }
  // What she last saw is not what is happening, and the difference is a whole
  // outage long. "when I last looked" is the only honest tense for it.
  const when = state.lanesFresh ? "" : `When I last looked, ${describeAge(state.lanesAgeSeconds)} ago, `;
  if (state.running.length === 0) {
    // Nothing running is a real answer, and a common one at night.
    return when ? `${when}nothing was running.` : "Nothing is running that I can see.";
  }
  const total = state.running.length;
  // Box by box, because "3 runs" on two machines is not one fact. Busiest
  // first and ties by name at both levels, so the same state always reads the
  // same way.
  const boxes = busiestFirst(groupCount(state.running.map((r) => r.host)));
  const named = (host: string): string => {
    const trees = busiestFirst(groupCount(
      state.running.filter((r) => r.host === host).map((r) => treeLabel(r.tree, titles)),
    ));
    const shown = trees.slice(0, TREES_PER_BOX).map(({ key, n: k }) => (k > 1 ? `${k} ${key}` : key));
    const rest = trees.length - shown.length;
    if (rest > 0) shown.push(`${rest} more`);
    return shown.join(", ");
  };
  // Not "9 on SirBase (4 spectre, …)": the trees are the answer, and a bracket
  // is where `fitToRoom` looks for an alert's arithmetic when a line runs long
  // (src/faye/events.ts). Putting the subject in brackets would have a third
  // box silently cost a visitor every tree name.
  const runs = `${total} run${total === 1 ? "" : "s"}`;
  if (boxes.length === 1) {
    // One box needs no tally of boxes: "2 runs on SirBase: 2 coarsen."
    const only = boxes[0]!.key;
    return `${when}${runs} on ${only}: ${named(only)}.`;
  }
  // A box she cannot fit is COUNTED, not cut: the trim at the speaker would
  // otherwise end the sentence mid-name, and "and 2 more boxes" is the honest
  // form of the same shortening. Counting boxes is not enough on its own --
  // a box reporting itself as an FQDN makes three of them too long for one
  // line -- so boxes are dropped from the tail until the sentence fits.
  const named_ = boxes.map(({ key: host, n }) => `${n} on ${host}: ${named(host)}`);
  let shown = named_.slice(0, BOXES_NAMED);
  const sentence = (): string => {
    const hidden = boxes.length - shown.length;
    const parts = hidden > 0
      ? [...shown, `and ${hidden} more box${hidden === 1 ? "" : "es"}`]
      : shown;
    return `${when}${runs} — ${parts.join("; ")}.`;
  };
  while (shown.length > 1 && [...sentence()].length > SPOKEN_MAX) shown = shown.slice(0, -1);
  return sentence();
}

/** How many trees one box's answer names before it says "and N more". One line, not a list. */
const TREES_PER_BOX = 3;

/** And how many boxes, for the same reason: a lane can be added to a room's answer. */
const BOXES_NAMED = 3;

function groupCount(keys: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const key of keys) out.set(key, (out.get(key) ?? 0) + 1);
  return out;
}

function busiestFirst(counts: ReadonlyMap<string, number>): { key: string; n: number }[] {
  return [...counts.entries()]
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => (b.n !== a.n ? b.n - a.n : a.key < b.key ? -1 : 1));
}

/** A rough age a person can hear, rather than a number of seconds. */
export function describeAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "an unknown time";
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  return `${Math.round(minutes / 60)} hours`;
}
