// Samples the pure clip definitions into THREE.AnimationClips: a quaternion track per bone, a
// position track for the root, and a scale track per tail bone (the startle puff). Every clip
// carries every track so a crossfade never leaves a bone holding a stale value.

import * as THREE from "three";
import { buildClipDefs, type BodyClipName, type ClipDef } from "./clipdefs";
import type { Pose } from "./pose";
import { BONE_NAMES, TAIL_BONES } from "./skeleton";

const FPS = 30;
const DEG = Math.PI / 180;

export function sampleClip(name: string, def: ClipDef): THREE.AnimationClip {
  const frames = Math.max(2, Math.round(def.duration * FPS) + 1);
  const times: number[] = [];
  const poses: Pose[] = [];
  for (let i = 0; i < frames; i++) {
    const t = Math.min(def.duration, i / FPS);
    times.push(t);
    poses.push(def.at(t));
  }
  // The last frame lands exactly on the duration, whatever FPS divides into.
  times[frames - 1] = def.duration;

  const tracks: THREE.KeyframeTrack[] = [];
  const euler = new THREE.Euler();
  const q = new THREE.Quaternion();
  for (const bone of BONE_NAMES) {
    const values: number[] = [];
    for (const p of poses) {
      const [x, y, z] = p.rot[bone];
      euler.set(x * DEG, y * DEG, z * DEG, "YXZ");
      q.setFromEuler(euler);
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  }
  const pos: number[] = [];
  for (const p of poses) pos.push(p.pos[0], p.pos[1], p.pos[2]);
  tracks.push(new THREE.VectorKeyframeTrack("root.position", times, pos));
  // Bone scale compounds down the chain, so each tail bone takes the sixth root of the puff and
  // the tail thickens toward its tip, bottle-brush fashion. Uniform, because a rotated child
  // inside a non-uniformly scaled parent shears.
  for (const tail of TAIL_BONES) {
    const scale: number[] = [];
    for (const p of poses) {
      const f = Math.pow(p.puff, 1 / TAIL_BONES.length);
      scale.push(f, f, f);
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${tail}.scale`, times, scale));
  }
  return new THREE.AnimationClip(name, def.duration, tracks);
}

export function buildClips(): Record<BodyClipName, { clip: THREE.AnimationClip; def: ClipDef }> {
  const defs = buildClipDefs();
  const out = {} as Record<BodyClipName, { clip: THREE.AnimationClip; def: ClipDef }>;
  for (const name of Object.keys(defs) as BodyClipName[]) {
    const def = defs[name];
    out[name] = { clip: sampleClip(name, def), def };
  }
  return out;
}
