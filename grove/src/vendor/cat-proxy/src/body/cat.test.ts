import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BLUE_POINT, BLUE_POINT_KG, RIG_SCALE, SEAL_POINT, sizeForWeight } from "./appearance";
import { buildCat, type Cat } from "./cat";
import { buildClipDefs } from "./clipdefs";
import { POSTURE_POSE, type Pose } from "./pose";
import { applyPose, lowestByPart } from "./pose-support";
import { bone, type BoneName } from "./skeleton";

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Nearest point on any of `bones`: a part's own skeleton runs inside it. (Nearest on ANY bone
 * misjudges a heavy Ragdoll: its forelegs run through the belly and its shoulders through the
 * mane, so a correctly wound face there can sit nearer another part's bone.) */
function nearestOn(p: V, bones: BoneName[]): V {
  let best: V = [0, 0, 0];
  let bestD = Infinity;
  for (const name of bones) {
    const b = bone(name);
    const ab = sub(b.tail as V, b.head as V);
    const len2 = dot(ab, ab);
    const s = len2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, b.head as V), ab) / len2)) : 0;
    const q: V = [b.head[0] + ab[0] * s, b.head[1] + ab[1] * s, b.head[2] + ab[2] * s];
    const d = dot(sub(p, q), sub(p, q));
    if (d < bestD) [bestD, best] = [d, q];
  }
  return best;
}

/** Fraction of each part's faces whose normal points away from the part's bones, and overall.
 * `flip` scores the mesh as if every triangle were wound the other way. */
function outwardFractions(
  cat: Cat,
  flip = false,
): { total: number; parts: Record<string, number> } {
  const pos = cat.mesh.geometry.getAttribute("position");
  const index = cat.mesh.geometry.index!;
  const v = (i: number): V => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  let outward = 0;
  let counted = 0;
  const parts: Record<string, number> = {};
  for (const [name, part] of Object.entries(cat.parts)) {
    let partOut = 0;
    let partCount = 0;
    for (let f = part.first; f < part.end; f++) {
      const a = v(index.getX(3 * f));
      const b = v(index.getX(3 * f + (flip ? 2 : 1)));
      const c = v(index.getX(3 * f + (flip ? 1 : 2)));
      const n = cross(sub(b, a), sub(c, a));
      if (dot(n, n) < 1e-14) continue; // a degenerate sliver says nothing either way
      const centre: V = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ];
      partCount++;
      if (dot(n, sub(centre, nearestOn(centre, part.bones))) > 0) partOut++;
    }
    parts[name] = partOut / partCount;
    outward += partOut;
    counted += partCount;
  }
  return { total: outward / counted, parts };
}

describe("cat mesh", () => {
  for (const app of [BLUE_POINT, SEAL_POINT]) {
    const cat = buildCat(app);

    it(`faces outward: triangle normals point away from the skeleton inside them (${app.name})`, () => {
      const { total, parts } = outwardFractions(cat);
      // Tufts lean along the hair, so the back of a tuft can face a little inward; the inside-out
      // bug put this near 5%, so 90% separates the two cleanly.
      expect(total).toBeGreaterThan(0.9);
      for (const [name, f] of Object.entries(parts)) expect(f, name).toBeGreaterThan(0.8);
    });

    it(`the same test fails a cat wound inside out (${app.name})`, () => {
      expect(outwardFractions(cat, true).total).toBeLessThan(0.2);
    });

    it(`stays within the Quest budget of ~4k triangles (${app.name})`, () => {
      expect(cat.triangles).toBeLessThanOrEqual(4000);
      // The face (eyes, lids, catchlights, nose, mouth) plus the muzzle and the ears it needed:
      // the whole face pass was budgeted at a thousand triangles over the round-1 cat's 2316.
      expect(cat.triangles).toBeLessThanOrEqual(3316);
    });

    it(`the eyes are in front of the head, not buried in it (${app.name})`, () => {
      cat.group.updateMatrixWorld(true);
      const raycaster = new THREE.Raycaster();
      for (const ball of cat.face.eyeballs) {
        const centre = ball.getWorldPosition(new THREE.Vector3());
        // A ray from in front of the cat, along the eye's own outward direction.
        const dir = new THREE.Vector3(0, 0, 1)
          .applyQuaternion(ball.parent!.getWorldQuaternion(new THREE.Quaternion()))
          .normalize();
        const from = centre.clone().addScaledVector(dir, 0.5);
        raycaster.set(from, dir.clone().negate());
        // Whiskers are lines and cross in front of everything; they are not what is being tested.
        const hits = raycaster
          .intersectObject(cat.group, true)
          .filter((h: THREE.Intersection) => h.object.name !== "whiskers");
        expect(hits.length, "the ray hits the cat at all").toBeGreaterThan(0);
        const first = hits[0]!.object.name;
        expect(["eye-L", "eye-R", "eye-rim", "catchlight"], `hit ${first} first`).toContain(first);
      }
    });
  }

  it("builds with no argument, as the default preset", () => {
    expect(buildCat().appearance).toBe(BLUE_POINT);
  });

  it("the two cats differ in size, colour and build", () => {
    expect(SEAL_POINT.size).not.toBe(BLUE_POINT.size);
    expect(SEAL_POINT.colours.point).not.toBe(BLUE_POINT.colours.point);
  });

  it("the blue point's size is the one its weight implies, not the one its coat suggests", () => {
    // 5.5 kg on the owner's scales; mass goes as the cube of length.
    expect(BLUE_POINT.size).toBeCloseTo(sizeForWeight(BLUE_POINT_KG), 1);
    expect(sizeForWeight(BLUE_POINT_KG)).toBeLessThan(1.15);
    // The gait is authored for that cat, so the rig scale has to follow it.
    expect(RIG_SCALE).toBe(BLUE_POINT.size);
  });

  it("the blue point is the WIDER cat, not just a longer one: chunk is cross-section", () => {
    // Measured off the built meshes, in world metres, so it cannot be undone by eye later.
    const box = (app: typeof BLUE_POINT): THREE.Box3 => {
      const cat = buildCat(app);
      cat.group.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(cat.mesh);
    };
    const blue = box(BLUE_POINT).getSize(new THREE.Vector3());
    const seal = box(SEAL_POINT).getSize(new THREE.Vector3());
    expect(blue.x / seal.x, "wider across").toBeGreaterThan(1.12);
    expect(blue.z / seal.z, "barely longer").toBeLessThan(1.08);
    expect(blue.x / seal.x).toBeGreaterThan(blue.z / seal.z + 0.1);
    // And its belly hangs lower than the slimmer cat's.
    expect(BLUE_POINT.proportions.pouch).toBeGreaterThan(SEAL_POINT.proportions.pouch * 1.5);
  });

  it("the seal point, never weighed, stays just under the blue point", () => {
    const ratio = SEAL_POINT.size / BLUE_POINT.size;
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1);
  });
});

describe("fur and the floor", () => {
  // Fur flattens where a cat rests on it, so a little sinking is right; sinking a quarter of the
  // body's depth is not, and neither is a resting cat hovering.
  const SQUASH = 0.05;
  const PAW_SINK = 0.012;
  const defs = buildClipDefs();
  const cases: [string, () => Pose, { resting: string[]; paws: string[] }][] = [
    [
      "stand",
      POSTURE_POSE.stand,
      { resting: [], paws: ["foreUpperL", "foreUpperR", "hindUpperL", "hindUpperR"] },
    ],
    ["sit", POSTURE_POSE.sit, { resting: ["torso"], paws: ["foreUpperL", "foreUpperR"] }],
    ["lie", POSTURE_POSE.lie, { resting: ["torso"], paws: ["foreUpperL", "foreUpperR"] }],
    ["loaf", POSTURE_POSE.loaf, { resting: ["torso"], paws: ["foreUpperL", "foreUpperR"] }],
    ["walk", () => defs.walk.at(0), { resting: [], paws: [] }],
    ["groom", () => defs.groom.at(1.75), { resting: ["torso"], paws: ["foreUpperR"] }],
  ];

  for (const app of [BLUE_POINT, SEAL_POINT]) {
    const cat = buildCat(app);
    for (const [name, pose, spec] of cases) {
      it(`${app.name} ${name}: nothing sinks deep, resting parts touch, planted paws stand`, () => {
        applyPose(cat, pose());
        const low = lowestByPart(cat);
        for (const [part, y] of Object.entries(low)) expect(y, part).toBeGreaterThan(-SQUASH);
        for (const part of spec.resting) expect(low[part]!, `${part} rests`).toBeLessThan(0.01);
        for (const part of spec.paws) {
          expect(low[part]!, `${part} not sunk`).toBeGreaterThan(-PAW_SINK);
          expect(low[part]!, `${part} touches`).toBeLessThan(0.01);
        }
        const lowest = Math.min(...Object.values(low));
        expect(lowest, "something touches the floor").toBeLessThan(0.01);
      });
    }
  }
});
