import { frameAt, tauOfFrame, type Timeline } from "../tape/time";

// Tapes that share a clock (a tape hanging's `clockWith`): two runs from one
// checkpoint, lit and dark, must show the same instant whatever each waited
// on while loading. Pure, so the frame loop and the tests agree.

/** What following needs of a tape; TapeExhibit has it all. */
export interface ClockedTape {
  readonly hanging: { readonly id: string; readonly clockWith: string };
  readonly timeline: Timeline;
  tau: number;
  update(dt: number): void;
}

/**
 * Every follower in `room` lands on the frame its leader shows and uploads it;
 * a follower whose leader has not loaded yet holds where it is rather than
 * running ahead and snapping back. Leaders advance on their own beforehand.
 * Allocation-free: it runs every frame.
 */
export function followClocks<T extends ClockedTape>(
  tapes: readonly (T | null)[],
  room: string,
  roomOf: (tape: T) => string | undefined,
): void {
  for (let i = 0; i < tapes.length; i++) {
    const each = tapes[i];
    if (!each || !each.hanging.clockWith || roomOf(each) !== room) continue;
    let leader: T | null = null;
    for (let j = 0; j < tapes.length; j++) {
      if (tapes[j]?.hanging.id === each.hanging.clockWith) {
        leader = tapes[j]!;
        break;
      }
    }
    if (leader) {
      const frame = frameAt(leader.timeline, leader.tau);
      // Same frame count: the same frame. Otherwise the same share of the run.
      const own = leader.timeline.frames === each.timeline.frames
        ? frame
        : Math.round((frame / Math.max(1, leader.timeline.frames - 1)) * (each.timeline.frames - 1));
      each.tau = tauOfFrame(each.timeline, own);
    }
    each.update(0);
  }
}
