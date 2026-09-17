import { describe, expect, it } from "vitest";
import { CLIP_POSTURE, type ClipName, type Posture } from "../contract";
import { buildClipDefs, type BodyClipName } from "./clipdefs";
import { POSTURE_POSE, type Pose } from "./pose";
import { BONE_NAMES } from "./skeleton";

function expectSamePose(a: Pose, b: Pose, what: string): void {
  for (const name of BONE_NAMES) {
    for (const i of [0, 1, 2] as const) {
      expect(Math.abs(a.rot[name][i] - b.rot[name][i]), `${what}: ${name}[${i}]`).toBeLessThan(
        1e-6,
      );
    }
  }
  for (const i of [0, 1, 2] as const)
    expect(Math.abs(a.pos[i] - b.pos[i]), `${what}: pos[${i}]`).toBeLessThan(1e-9);
  expect(a.puff, `${what}: puff`).toBeCloseTo(b.puff, 9);
}

const defs = buildClipDefs();

describe("clip endpoints", () => {
  const names = Object.keys(defs) as BodyClipName[];

  it("covers every clip in the contract", () => {
    for (const clip of Object.keys(CLIP_POSTURE) as ClipName[]) expect(defs[clip]).toBeDefined();
  });

  for (const name of names) {
    const def = defs[name];
    const contractName: ClipName = name === "look-around-sit" ? "look-around" : name;
    const spec = CLIP_POSTURE[contractName];
    const from: Posture | "any" =
      name === "look-around-sit" ? "sit" : name === "look-around" ? "stand" : spec.from;
    const to: Posture = name === "look-around-sit" ? "sit" : spec.to;
    const isGait = name === "walk" || name === "trot";

    it(`${name} ends in the ${to} pose`, () => {
      if (isGait) return;
      expectSamePose(def.at(def.duration), POSTURE_POSE[to](), `${name} end`);
    });

    it(`${name} starts in its posture's pose`, () => {
      if (isGait || from === "any") return;
      expectSamePose(def.at(0), POSTURE_POSE[from](), `${name} start`);
    });

    it(`${name} ${def.loop ? "loops seamlessly" : "is a one-shot"}`, () => {
      expect(def.loop).toBe(spec.loop);
      if (def.loop) expectSamePose(def.at(0), def.at(def.duration), `${name} loop`);
    });

    it(`${name} yields finite poses throughout`, () => {
      for (let t = 0; t <= def.duration; t += def.duration / 17) {
        const p = def.at(t);
        for (const b of BONE_NAMES) for (const v of p.rot[b]) expect(Number.isFinite(v)).toBe(true);
        for (const v of p.pos) expect(Number.isFinite(v)).toBe(true);
      }
    });
  }
});

describe("idle", () => {
  it("stays calm: no bone turns more than a few degrees from the stand pose", () => {
    const def = defs.idle;
    const stand = POSTURE_POSE.stand();
    for (let t = 0; t <= def.duration; t += 0.1) {
      const p = def.at(t);
      for (const name of BONE_NAMES)
        for (const i of [0, 1, 2] as const)
          expect(
            Math.abs(p.rot[name][i] - stand.rot[name][i]),
            `${name}[${i}] at ${t}`,
          ).toBeLessThan(8.5);
    }
  });
});
