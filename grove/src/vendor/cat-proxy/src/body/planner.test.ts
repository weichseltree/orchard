import { describe, expect, it } from "vitest";
import { CLIP_POSTURE, type ClipName, type Posture } from "../contract";
import { pathBetween, planTransitions, postureAfter } from "./planner";

const POSTURES: Posture[] = ["stand", "sit", "lie", "loaf"];

describe("pathBetween", () => {
  it("is empty for the same posture", () => {
    for (const p of POSTURES) expect(pathBetween(p, p)).toEqual([]);
  });

  it("walks the line one step at a time in both directions", () => {
    expect(pathBetween("loaf", "stand")).toEqual(["untuck", "get-up", "stand-up"]);
    expect(pathBetween("stand", "loaf")).toEqual(["sit-down", "lie-down", "tuck"]);
    expect(pathBetween("sit", "lie")).toEqual(["lie-down"]);
  });

  it("chains clips whose postures agree end to end", () => {
    for (const a of POSTURES) {
      for (const b of POSTURES) {
        let at = a;
        for (const clip of pathBetween(a, b)) {
          expect(CLIP_POSTURE[clip].from).toBe(at);
          at = CLIP_POSTURE[clip].to;
        }
        expect(at).toBe(b);
      }
    }
  });
});

describe("planTransitions", () => {
  it("plays a walk from a loaf via untuck, get-up and stand-up", () => {
    expect(planTransitions("loaf", "walk")).toEqual(["untuck", "get-up", "stand-up", "walk"]);
  });

  it("plays a loop directly when already in its posture", () => {
    expect(planTransitions("sit", "groom")).toEqual(["groom"]);
    expect(planTransitions("stand", "idle")).toEqual(["idle"]);
  });

  it("plays a transition directly from its own start posture", () => {
    expect(planTransitions("stand", "sit-down")).toEqual(["sit-down"]);
    expect(planTransitions("lie", "sit-down")).toEqual(["get-up", "stand-up", "sit-down"]);
  });

  it("startles from anywhere without getting up first", () => {
    for (const p of POSTURES) expect(planTransitions(p, "startle")).toEqual(["startle"]);
  });

  it("looks around from stand or sit as is, and sits up first when lying or loafing", () => {
    expect(planTransitions("stand", "look-around")).toEqual(["look-around"]);
    expect(planTransitions("sit", "look-around")).toEqual(["look-around"]);
    expect(planTransitions("lie", "look-around")).toEqual(["get-up", "look-around"]);
    expect(planTransitions("loaf", "look-around")).toEqual(["untuck", "get-up", "look-around"]);
  });

  it("ends every plan in a clip that can start where the plan leaves the body", () => {
    for (const from of POSTURES) {
      for (const clip of Object.keys(CLIP_POSTURE) as ClipName[]) {
        const plan = planTransitions(from, clip);
        let at = from;
        for (const step of plan.slice(0, -1)) {
          expect(CLIP_POSTURE[step].from).toBe(at);
          at = CLIP_POSTURE[step].to;
        }
        const start = CLIP_POSTURE[clip].from;
        if (start !== "any") expect(at).toBe(start);
        expect(plan.at(-1)).toBe(clip);
      }
    }
  });
});

describe("postureAfter", () => {
  it("keeps the posture look-around was played in", () => {
    expect(postureAfter("look-around", "sit")).toBe("sit");
    expect(postureAfter("look-around", "stand")).toBe("stand");
  });

  it("uses the contract for everything else", () => {
    expect(postureAfter("sit-down", "stand")).toBe("sit");
    expect(postureAfter("startle", "loaf")).toBe("stand");
  });
});
