import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BodyCommand, ClipName } from "../contract";
import { buildClipDefs } from "./clipdefs";
import { CatController, FADE } from "./controller";
import { GAZE_PITCH_LIMIT, GAZE_YAW_LIMIT } from "./face";

/** Runs two identical cats for `seconds`, one looking at `lookAt`, and returns how the looking
 * cat's head is rotated relative to the other's, in world space. */
function headDelta(clip: ClipName, lookAt: { x: number; z: number }, seconds: number) {
  const plain = new CatController();
  const looking = new CatController();
  const base: BodyCommand = { clip, behaviour: "test" };
  plain.apply(base);
  looking.apply({ ...base, lookAt });
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    plain.update(dt);
    looking.update(dt);
  }
  const a = plain.cat.bones.head.getWorldQuaternion(new THREE.Quaternion());
  const b = looking.cat.bones.head.getWorldQuaternion(new THREE.Quaternion());
  return b.multiply(a.invert());
}

describe("head look-at", () => {
  for (const clip of ["idle", "sit-idle"] as ClipName[]) {
    it(`turns the head about world up without twisting it (${clip})`, () => {
      // Far to the cat's left (+x at heading 0): a near-pure turn, almost no nod.
      const delta = headDelta(clip, { x: 4, z: 0.5 }, 4);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(delta);
      expect(up.y, "the head's up stays up").toBeGreaterThan(0.97);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(delta);
      expect(fwd.x, "the turn is toward the target").toBeGreaterThan(0.5);
    });
  }

  it("holds steady on a fixed target instead of drifting or spinning", () => {
    const early = headDelta("sit-idle", { x: 4, z: 0.5 }, 3);
    const late = headDelta("sit-idle", { x: 4, z: 0.5 }, 9);
    expect(early.angleTo(late)).toBeLessThan(5 * (Math.PI / 180));
  });
});

/** Runs a controller to `seconds`, recording one sample per frame. */
function run<T>(
  c: CatController,
  seconds: number,
  sample: (state: ReturnType<CatController["update"]>, c: CatController) => T,
  dt = 1 / 60,
): T[] {
  const out: T[] = [];
  for (let t = 0; t < seconds; t += dt) out.push(sample(c.update(dt), c));
  return out;
}

/** Puts a cat into a posture by asking for its idle clip and letting the transitions play. */
function settle(c: CatController, clip: ClipName, seconds = 12): void {
  c.apply({ clip, behaviour: "test" });
  run(c, seconds, () => 0);
}

describe("eyes", () => {
  it("look toward a target, clamped, and never compound", () => {
    const c = new CatController();
    c.apply({ clip: "idle", lookAt: { x: 6, z: 0.2 }, behaviour: "test" });
    run(c, 4, () => 0);
    const gaze = c.cat.face.gaze;
    expect(gaze.yaw, "the eyes turn toward the target").toBeGreaterThan(0.05);
    expect(Math.abs(gaze.yaw), "clamped").toBeLessThanOrEqual(GAZE_YAW_LIMIT + 1e-9);
    expect(Math.abs(gaze.pitch), "clamped").toBeLessThanOrEqual(GAZE_PITCH_LIMIT + 1e-9);
    // Four more seconds of the same look must not wind the eyes any further round.
    const before = c.cat.face.eyeballs[0]!.quaternion.clone();
    run(c, 4, () => 0);
    expect(c.cat.face.eyeballs[0]!.quaternion.angleTo(before)).toBeLessThan(0.02);
  });

  it("asking for the same gaze twice changes nothing, however often it is set", () => {
    const c = new CatController();
    c.cat.face.setGaze(0.1, 0.05);
    const q = c.cat.face.eyeballs[0]!.quaternion.clone();
    for (let i = 0; i < 50; i++) c.cat.face.setGaze(0.1, 0.05);
    expect(c.cat.face.eyeballs[0]!.quaternion.angleTo(q)).toBe(0);
  });

  it("blinks, and the lids come fully open again", () => {
    const c = new CatController();
    c.apply({ clip: "idle", behaviour: "test" });
    const open = run(c, 0.5, () => c.cat.face.blink).at(-1)!;
    expect(open).toBe(0);
    const closures = run(c, 40, () => c.cat.face.blink);
    expect(Math.max(...closures), "a blink happens").toBeGreaterThan(0.9);
    // It always comes back open: standing, the eyes are wide for most of those 40 seconds.
    expect(closures.filter((b) => b === 0).length / closures.length).toBeGreaterThan(0.8);
  });

  it("sleeps with its eyes shut and rests with them half closed", () => {
    const sleeping = new CatController();
    settle(sleeping, "sleep", 20);
    expect(sleeping.currentPosture).toBe("loaf");
    expect(Math.min(...run(sleeping, 5, () => sleeping.cat.face.blink))).toBe(1);

    const sitting = new CatController();
    settle(sitting, "sit-idle", 6);
    const rest = run(sitting, 5, () => sitting.cat.face.blink);
    expect(Math.min(...rest)).toBeGreaterThan(0);
    expect(Math.min(...rest)).toBeLessThan(0.5);
  });
});

describe("queued transitions", () => {
  /** The posture chain from a loaf to walking: untuck, get-up, stand-up, then the gait. */
  function chain(): {
    clips: string[];
    postures: string[];
    done: number;
    still: number;
    toWalk: number;
  } {
    const c = new CatController();
    settle(c, "sleep", 20);
    expect(c.currentPosture).toBe("loaf");
    // Clips only: breathing and the other procedural layers would hide a stalled crossfade.
    c.useProceduralLayers(false);
    const before = new Map<THREE.Bone, THREE.Quaternion>();
    let still = Infinity;
    let done = 0;
    let reachedWalk = false;
    let toWalk = Infinity;
    let elapsed = 0;
    const clips: string[] = [];
    const postures: string[] = [];
    c.apply({ clip: "walk", moveTo: { x: 0, z: 3 }, behaviour: "test" });
    const dt = 1 / 60;
    run(c, 6, (state) => {
      elapsed += dt;
      if (clips.at(-1) !== state.clip) clips.push(state.clip);
      if (postures.at(-1) !== state.posture) postures.push(state.posture);
      // Only the transitions: once the walk is looping, clipDone marks each completed cycle.
      if (state.clipDone && !reachedWalk) done++;
      if (state.clip === "walk" && !reachedWalk) toWalk = elapsed;
      if (state.clip === "walk") reachedWalk = true;
      let moved = 0;
      for (const b of c.cat.skeleton.bones) {
        const last = before.get(b);
        if (last) moved = Math.max(moved, last.angleTo(b.quaternion));
        before.set(b, (last ?? new THREE.Quaternion()).copy(b.quaternion));
      }
      if (before.size > 0 && moved > 0) still = Math.min(still, moved);
      return 0;
    });
    return { clips, postures, done, still, toWalk };
  }

  it("runs the whole chain, reaching each posture in order", () => {
    const { clips, postures } = chain();
    expect(clips).toEqual(["untuck", "get-up", "stand-up", "walk"]);
    expect(postures).toEqual(["loaf", "lie", "sit", "stand"]);
  });

  it("overlaps its clips instead of stopping at every step", () => {
    // Each transition hands over a fade before it ends, so the whole chain is three fades
    // shorter than its clips laid end to end — the cat no longer stops dead three times.
    const defs = buildClipDefs();
    const total = defs.untuck.duration + defs["get-up"].duration + defs["stand-up"].duration;
    const { toWalk, still } = chain();
    expect(toWalk).toBeLessThan(total - 2.5 * FADE);
    expect(toWalk).toBeGreaterThan(total - 3.5 * FADE);
    // And the skeleton is never frozen at a junction.
    expect(still).toBeGreaterThan(1e-5);
  });

  it("books one clipDone for each one-shot of the chain, exactly once", () => {
    const { clips, done } = chain();
    // Three transitions land, the fourth clip is the walk itself.
    expect(done).toBe(clips.length - 1);
  });

  it("a lone one-shot still lands in its posture and returns to the idle", () => {
    const c = new CatController();
    settle(c, "idle", 2);
    c.apply({ clip: "sit-down", behaviour: "test" });
    const states = run(c, 4, (s) => ({ clip: s.clip, posture: s.posture, done: s.clipDone }));
    expect(states.filter((s) => s.done).length).toBe(1);
    expect(states.at(-1)!.clip).toBe("sit-idle");
    expect(states.at(-1)!.posture).toBe("sit");
  });
});

describe("the belly", () => {
  /** How far the pouch bone swings away from where the clip left it, over `seconds`. */
  function swing(clip: ClipName, seconds: number): number {
    const c = new CatController();
    const cmd: BodyCommand = { clip, behaviour: "test" };
    if (clip === "walk") cmd.moveTo = { x: 0, z: 8 };
    c.apply(cmd);
    let most = 0;
    run(c, seconds, () => {
      most = Math.max(most, Math.abs(c.cat.bones.belly.quaternion.angleTo(new THREE.Quaternion())));
    });
    return most;
  }

  it("swings while the cat walks and hangs still while it stands", () => {
    expect(swing("walk", 4), "a walking pouch swings").toBeGreaterThan(0.02);
    expect(swing("idle", 4), "a standing one barely moves").toBeLessThan(0.01);
  });

  it("settles rather than winding up: the swing is bounded however long it walks", () => {
    expect(swing("walk", 30)).toBeLessThan(0.25);
  });
});
