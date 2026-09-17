import { describe, expect, it } from "vitest";
import { advance, frameAt, timeline } from "../tape/time";
import { followClocks, type ClockedTape } from "./tape-clock";

function tape(id: string, clockWith = "", frames = 800) {
  const tl = timeline(frames, 0.075, 500);
  return {
    hanging: { id, clockWith },
    timeline: tl,
    tau: tl.t0Tau,
    updates: [] as number[],
    update(dt: number) {
      this.updates.push(dt);
      this.tau = advance(this.timeline, this.tau, dt, 1, true);
    },
  } satisfies ClockedTape & { updates: number[] };
}

const rooms = new Map<object, string>();
const roomOf = (t: object) => rooms.get(t);

describe("followClocks", () => {
  it("lands the follower on its leader's frame without advancing it again", () => {
    const lit = tape("lit"), dark = tape("dark", "lit");
    rooms.set(lit, "phototroph").set(dark, "phototroph");
    lit.update(3.3);
    followClocks([lit, dark], "phototroph", roomOf);
    expect(frameAt(dark.timeline, dark.tau)).toBe(frameAt(lit.timeline, lit.tau));
    expect(dark.updates).toEqual([0]);
  });

  it("holds a follower whose leader has not loaded", () => {
    const dark = tape("dark", "lit");
    rooms.set(dark, "phototroph");
    const before = dark.tau;
    followClocks([null, dark], "phototroph", roomOf);
    expect(dark.tau).toBe(before);
    expect(dark.updates).toEqual([0]);
  });

  it("leaves followers outside the visitor's room alone", () => {
    const lit = tape("lit"), dark = tape("dark", "lit");
    rooms.set(lit, "phototroph").set(dark, "phototroph");
    lit.update(2);
    followClocks([lit, dark], "hall", roomOf);
    expect(dark.updates).toEqual([]);
  });

  it("follows by share of the run when the frame counts differ", () => {
    const lit = tape("lit", "", 801), dark = tape("dark", "lit", 401);
    rooms.set(lit, "phototroph").set(dark, "phototroph");
    lit.tau = lit.timeline.t0Tau + 400 * 0.075;
    followClocks([lit, dark], "phototroph", roomOf);
    expect(frameAt(dark.timeline, dark.tau)).toBe(200);
  });
});
