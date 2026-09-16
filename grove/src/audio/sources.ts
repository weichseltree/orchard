import type { DeviceTier } from "../tape/bundle";

// How many of an exhibit's nodes may be positioned, how they are positioned,
// and which node gets which. AUDIO-STREAM.md §5 caps the simultaneous
// positioned per-node sources per tier "with the rest folded into one
// non-positioned bed"; DEVICE-TIERS.md carries the numbers.
//
// DEVICE-TIERS carries TWO audio rows and they do not agree. "positioned
// audio sources" gives vr-quest 16; "audio: convolvers / panners / HRTF"
// gives Quest 2 and Pico 4 -- both vr-quest -- six panners and no HRTF at
// all. A tier budget has to hold on the weakest device in the tier, so
// vr-quest cannot have sixteen HRTF-panned sources.
//
// The rows are reconciled as a LADDER rather than by picking one. Being
// "positioned" and being a PannerNode are not the same cost: a StereoPanner
// driven by the listener-relative azimuth places a source left-to-right for
// almost nothing, a PannerNode costs the distance model and the panning, and
// HRTF costs an impulse response per source. So each node gets the best rung
// the budget still has room for, and everything past the last rung folds into
// the bed:
//
//     hrtf    a PannerNode, panningModel "HRTF"       -- externalised
//     panner  a PannerNode, panningModel "equalpower" -- azimuth and distance
//     stereo  a StereoPannerNode on the azimuth       -- left/right only
//     bed     not positioned at all                   -- the §5 bed
//
// Both rows are budgets, not measurements (DEVICE-TIERS says so, and
// AUDIO-STREAM §7 item 2 is what turns them into facts). Nothing here has
// been measured on a headset.

export type SourceKind = "hrtf" | "panner" | "stereo" | "bed";

/** The rungs that count as positioned, best first. `bed` is the absence of one. */
export const POSITIONED_KINDS = ["hrtf", "panner", "stereo"] as const;

export interface AudioBudget {
  /** Nodes that may carry a position at all (DEVICE-TIERS, "positioned audio sources"). */
  positioned: number;
  /** Of those, how many may be PannerNodes (DEVICE-TIERS, the panners figure). */
  panners: number;
  /** Of those panners, how many may use the HRTF model (the HRTF figure). */
  hrtf: number;
}

/**
 * Per tier, taking the weakest device in each tier's column group:
 *
 * | tier     | devices                        | positioned | panners | HRTF |
 * |----------|--------------------------------|-----------:|--------:|-----:|
 * | vr-quest | Quest 3, Quest 2, Pico 4       |         16 |       6 |    0 |
 * | vr-high  | Vision Pro Safari              |         32 |       8 |    2 |
 * | phone    | iPhone 13-16, mid Android      |          8 |       4 |    0 |
 * | desktop  | desktop Chrome                 |         32 |      16 |    4 |
 *
 * vr-quest getting no HRTF is the part worth saying out loud: on a Quest a
 * node is placed by azimuth and distance, not externalised. Quest 3 alone
 * would allow two, but a tier is only as good as its weakest member and
 * Quest 2 and Pico 4 are in it.
 */
export const AUDIO_BUDGET: Record<DeviceTier, AudioBudget> = {
  "vr-quest": { positioned: 16, panners: 6, hrtf: 0 },
  "vr-high": { positioned: 32, panners: 8, hrtf: 2 },
  phone: { positioned: 8, panners: 4, hrtf: 0 },
  desktop: { positioned: 32, panners: 16, hrtf: 4 },
};

/** One node competing for a rung: how far the listener is from it, and who it is. */
export interface SourceCandidate {
  id: string;
  /** Metres from the listener to the node's placed position. */
  distance: number;
}

/**
 * How much closer a challenger must be before it takes an incumbent's rung.
 * 1 is no hysteresis. A source appearing or vanishing as the visitor shifts
 * their weight is audible; this is what stops it.
 */
export const DEFAULT_HYSTERESIS = 1.25;

/**
 * Which node gets which rung. Ranked by distance alone, nearest first.
 *
 * Distance and not prominence, deliberately. A node's placed position never
 * moves (`topology.ts`), so a distance ranking changes only when the VISITOR
 * moves, which is slow and is what the hysteresis below is for. Ranking by
 * how active a node is would reshuffle the rungs at the score's 10 Hz and
 * click on every reshuffle -- and which activity deserves a rung is a
 * sonification judgement, which belongs to the provider (AUDIO-STREAM.md §4),
 * not to the client's source allocator.
 *
 * `previous` is the assignment now in effect. A node already positioned has
 * its distance divided by `hysteresis`, so it keeps its place against a
 * marginally nearer challenger. The boundary that matters is positioned
 * against bed -- a source appearing or vanishing -- rather than which rung a
 * positioned node is on: changing panning model is far less audible than
 * changing whether a node is there at all.
 *
 * Ties break on id, so the same inputs always give the same assignment.
 */
export function selectSources(
  candidates: readonly SourceCandidate[],
  budget: AudioBudget,
  previous: ReadonlyMap<string, SourceKind> = new Map(),
  hysteresis: number = DEFAULT_HYSTERESIS,
): Map<string, SourceKind> {
  const margin = hysteresis > 0 ? hysteresis : 1;
  const ranked = [...candidates]
    .map((candidate) => {
      const held = previous.get(candidate.id);
      const incumbent = held !== undefined && held !== "bed";
      return { id: candidate.id, key: incumbent ? candidate.distance / margin : candidate.distance };
    })
    .sort((a, b) => (a.key === b.key ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.key - b.key));

  // The rungs nest: every HRTF source is a panner, every panner is positioned.
  const hrtf = Math.max(0, Math.min(budget.hrtf, budget.panners, budget.positioned));
  const panners = Math.max(hrtf, Math.min(budget.panners, budget.positioned));
  const positioned = Math.max(panners, Math.max(0, budget.positioned));

  const assignment = new Map<string, SourceKind>();
  ranked.forEach((entry, index) => {
    if (index < hrtf) assignment.set(entry.id, "hrtf");
    else if (index < panners) assignment.set(entry.id, "panner");
    else if (index < positioned) assignment.set(entry.id, "stereo");
    else assignment.set(entry.id, "bed");
  });
  return assignment;
}

/** How many of an assignment carry a position; the rest are in the bed. */
export function positionedCount(assignment: ReadonlyMap<string, SourceKind>): number {
  let count = 0;
  for (const kind of assignment.values()) if (kind !== "bed") count += 1;
  return count;
}
