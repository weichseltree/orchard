import { BEHAVIOURS } from "./behaviours";
import type { BrainParams } from "./params";
import { logNormalDurationS, softmaxPick, type Rng } from "./rng";
import { BEHAVIOUR_IDS } from "./types";
import type { ActiveEpisode, BehaviourId, Context, Drives } from "./types";

export interface Scored {
  id: BehaviourId;
  utility: number;
  score: number;
}

/**
 * Score every behaviour: raw utility, times the transition-bias prior keyed by the behaviour
 * that just ended (only when the utility is positive — biasing a negative number multiplicatively
 * flips its meaning), plus the commitment bonus for whichever id is still actively running when
 * this decision was provoked by an interrupting event rather than a natural end.
 */
export function scoreAll(
  drives: Drives,
  ctx: Context,
  params: BrainParams,
  prevId: BehaviourId | null,
  protectCurrent: BehaviourId | null,
  repeatBlocked: BehaviourId | null,
): Scored[] {
  const biasRow = prevId ? params.transitionBias[prevId] : undefined;
  return BEHAVIOUR_IDS.map((id) => {
    const utility = id === repeatBlocked ? -Infinity : BEHAVIOURS[id].utility(drives, ctx, params);
    let score = utility;
    if (Number.isFinite(score) && score > 0 && biasRow?.[id] !== undefined) {
      score *= biasRow[id]!;
    }
    if (Number.isFinite(score) && id === protectCurrent) {
      score += params.commitmentBonus;
    }
    return { id, utility, score };
  });
}

/** Picks the next behaviour by softmax over `scored`, falling back to any finite option if the
 * repeat cap left nothing but -Infinity candidates (should not happen with 13 behaviours, but a
 * deadlock is worse than one extra repeat). */
export function pickNext(rng: Rng, scored: Scored[], temperature: number): BehaviourId {
  const finite = scored.filter((s) => Number.isFinite(s.score));
  const pool = finite.length > 0 ? finite : scored;
  return softmaxPick(
    rng,
    pool.map((s) => ({ item: s.id, score: s.score })),
    temperature,
  );
}

export function startEpisode(
  id: BehaviourId,
  ctx: Context,
  params: BrainParams,
  rng: Rng,
  now: number,
): ActiveEpisode {
  const def = BEHAVIOURS[id];
  const dwellS = logNormalDurationS(
    rng,
    params.behaviours[id].dwell.medianS,
    params.behaviours[id].dwell.spread,
  );
  return {
    id,
    startedAt: now,
    dwellEndAt: now + dwellS,
    phase: def.initialPhase ?? id,
    target: def.pickTarget(ctx, params, rng),
    clipCycles: 0,
    lastClip: null,
    // The caller (brain.ts's beginEpisode) overwrites this with the real reason.
    startedByInterrupt: false,
  };
}
