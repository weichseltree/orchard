// The body side of the contract: takes BodyCommands, plans posture transitions (planner.ts),
// crossfades clips through an AnimationMixer, steers the cat over the floor (steer.ts), and
// layers procedural motion on top of whatever clip is playing — head look-at, breathing, ear
// flicks, and a tail that lags behind turns.

import * as THREE from "three";
import {
  CLIP_POSTURE,
  type BodyCommand,
  type BodyState,
  type ClipName,
  type Posture,
  type Vec2,
} from "../contract";
import { OPEN_ARENA, type Arena } from "../arena";
import { RIG_SCALE, type CatAppearance } from "./appearance";
import { buildCat, type Cat, type CatDetail } from "./cat";
import type { BodyClipName } from "./clipdefs";
import { buildClips } from "./clips";
import { GAITS, type GaitName } from "./gait";
import { planTransitions, postureAfter } from "./planner";
import { DEFAULT_STEER, headingTo, steer, wrapAngle } from "./steer";
import { TAIL_BONES } from "./skeleton";

/** Crossfade between clips, seconds. A queued chain hands over this long before a clip ends. */
export const FADE = 0.25;
/** How long one blink takes, closed and open again. */
const BLINK_S = 0.16;
const STARTLE_FADE = 0.1;
const DEG = Math.PI / 180;

const IDLE_FOR: Record<Posture, ClipName> = {
  stand: "idle",
  sit: "sit-idle",
  lie: "lie-idle",
  loaf: "sleep",
};

function isGait(name: ClipName): name is GaitName {
  return name === "walk" || name === "trot";
}

function sameVec(a: Vec2 | undefined, b: Vec2 | undefined): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.z === b.z;
}

function clampAngle(x: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, x));
}

const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0); // the cat's sideways axis at heading 0 (+z forward)

export class CatController {
  readonly cat: Cat;
  readonly group: THREE.Group;
  readonly clipNames: readonly ClipName[] = Object.keys(CLIP_POSTURE) as ClipName[];

  private readonly mixer: THREE.AnimationMixer;
  private readonly clips = buildClips();
  private readonly actions = {} as Record<BodyClipName, THREE.AnimationAction>;

  private posture: Posture = "stand";
  private playing: BodyClipName = "idle";
  private action: THREE.AnimationAction;
  private queue: ClipName[] = [];
  private lastCmd: BodyCommand | null = null;
  private clipDone = false;
  private oneShotRunning = false;

  private position: Vec2 = { x: 0, z: 0 };
  private heading = 0;
  private moveTo: Vec2 | null = null;
  private gait: GaitName = "walk";
  private arrived = true;
  private turnRate = 0;

  private lookTarget: Vec2 | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  private lookWeight = 0;
  private clock = 0;
  private nextFlick = 3;
  private nextBlink = 2;
  private blinkAt = -1;
  private flickEar: "earL" | "earR" = "earL";
  private flickAt = -1;
  private hop = -1;
  private tailLag = 0;
  private bellyRollLag = 0;
  private bellyY: number | null = null;
  private procedural = true;
  /** The room the body walks in. Every step it integrates is offered to this and the answer is
   * where the cat actually ends up, so steering cannot cut a corner a visitor could not. */
  private arena: Arena = OPEN_ARENA;

  constructor(appearance?: CatAppearance, detail?: CatDetail) {
    this.cat = buildCat(appearance, detail);
    this.group = this.cat.group;
    this.mixer = new THREE.AnimationMixer(this.cat.mesh);
    for (const name of Object.keys(this.clips) as BodyClipName[]) {
      const { clip, def } = this.clips[name];
      const action = this.mixer.clipAction(clip);
      if (!def.loop) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[name] = action;
    }
    this.mixer.addEventListener("finished", (e: { action: THREE.AnimationAction }) =>
      this.onFinished(e.action),
    );
    this.mixer.addEventListener("loop", () => {
      this.clipDone = true;
    });
    this.action = this.actions.idle;
    this.action.play();
  }

  /** The clip vocabulary and its posture spec, for the page's buttons. */
  get currentClip(): ClipName {
    return this.playing === "look-around-sit" ? "look-around" : this.playing;
  }

  get currentPosture(): Posture {
    return this.posture;
  }

  get pendingQueue(): readonly ClipName[] {
    return this.queue;
  }

  apply(cmd: BodyCommand): void {
    if (cmd.lookAt !== undefined) this.lookTarget = cmd.lookAt;
    const last = this.lastCmd;
    this.lastCmd = cmd;
    const repeat = last && last.clip === cmd.clip && sameVec(last.moveTo, cmd.moveTo);
    if (repeat) return;

    if (isGait(cmd.clip)) {
      this.gait = cmd.clip;
      this.moveTo = cmd.moveTo ?? null;
      this.arrived = false;
    } else {
      this.moveTo = null;
      this.arrived = true; // nothing pending: a stale false read as "moving" to the brain and page
    }

    if (cmd.clip === "startle") {
      // Fear does not wait for the current move to finish.
      this.queue = [];
      this.hop = 0;
      this.start("startle", STARTLE_FADE);
      return;
    }
    if (this.oneShotRunning) {
      // Let the transition land in its posture, then continue from there.
      const landing = postureAfter(
        this.playing === "look-around-sit" ? "look-around" : this.playing,
        this.posture,
      );
      this.queue = planTransitions(landing, cmd.clip);
      return;
    }
    if (this.currentClip === cmd.clip && CLIP_POSTURE[cmd.clip].loop) return;
    this.queue = planTransitions(this.posture, cmd.clip);
    this.next();
  }

  update(dt: number): BodyState {
    this.clock += dt;
    this.clipDone = false;
    // A queued chain flows: the next clip starts while the current one-shot is still easing out,
    // so the crossfade overlaps the tail of one with the head of the next instead of the cat
    // coming to a full stop at every step (loaf -> untuck -> get-up -> stand-up -> walk). The
    // last clip of a chain has nothing queued behind it and still lands exactly in its posture.
    if (this.oneShotRunning && this.queue.length > 0) {
      const def = this.clips[this.playing].def;
      if (this.action.time >= def.duration - FADE) this.landOneShot();
    }
    this.locomote(dt);
    // three's PropertyMixer only writes a bone whose animated value CHANGED since its last write,
    // so a bone the clip holds still keeps whatever the procedural layers left on it, and every
    // layer that composes onto it compounds frame after frame: a look-at spun the head round.
    // Put back last frame's clip values first; the mixer overwrites whatever did change.
    this.restoreClipPose();
    this.mixer.update(dt);
    this.saveClipPose();
    if (this.procedural) this.layerProcedural(dt);
    return {
      position: { ...this.position },
      heading: this.heading,
      posture: this.posture,
      clip: this.currentClip,
      clipDone: this.clipDone,
      arrived: this.arrived,
    };
  }

  /** Turns the procedural layers (look-at, breathing, ear flicks, tail lag, eyes) off, so what
   * is left is the clips alone: the page's debug snaps, and the tests that measure clip motion. */
  useProceduralLayers(on: boolean): void {
    this.procedural = on;
  }

  /** Debug: hold `clip` at time `t` with no procedural layers, for screenshots. */
  snap(clip: ClipName, t: number): void {
    this.queue = [];
    this.moveTo = null;
    this.hop = -1;
    this.procedural = false;
    const name = this.variant(clip);
    this.action.stop();
    this.action = this.actions[name];
    this.action.reset().play();
    this.action.time = Math.min(t, this.clips[name].clip.duration - 1e-4);
    this.action.paused = true;
    this.playing = name;
    this.oneShotRunning = false;
    this.mixer.update(0);
    // update() restores the saved clip pose before the mixer runs, and a paused action writes
    // nothing new, so without this the pose from before the snap would come back.
    this.saveClipPose();
  }

  /** Gives the body the room it walks in (CatWorld does this for you). Without one it walks on
   * an open plane, which is what the viewer's grid is. */
  useArena(arena: Arena): void {
    this.arena = arena;
  }

  /** Where the cat is; the viewer places it with this rather than touching the group. */
  place(position: Vec2, heading: number): void {
    this.position = { ...position };
    this.heading = heading;
    this.group.position.set(position.x, 0, position.z);
    this.group.rotation.y = heading;
  }

  // ------------------------------------------------------------------------------------------

  private variant(clip: ClipName): BodyClipName {
    if (clip === "look-around" && this.posture === "sit") return "look-around-sit";
    return clip;
  }

  private start(clip: ClipName, fade: number): void {
    const name = this.variant(clip);
    const next = this.actions[name];
    const prev = this.action;
    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();
    if (prev !== next) {
      prev.crossFadeTo(next, fade, false);
    }
    this.action = next;
    this.playing = name;
    this.oneShotRunning = !this.clips[name].def.loop;
  }

  /** Plays the next queued clip, or the posture's idle when the queue is empty. */
  private next(): void {
    const clip = this.queue.shift();
    if (clip) {
      this.start(clip, FADE);
      return;
    }
    this.start(IDLE_FOR[this.posture], FADE);
  }

  /** A one-shot finished on its own. A chain hands over early (update), so by the time this
   * arrives the action may already have been faded out and replaced: then it has nothing to do. */
  private onFinished(action: THREE.AnimationAction): void {
    if (!this.oneShotRunning || action !== this.action) return;
    this.landOneShot();
  }

  /** Books the clip that is ending: its posture is now the cat's, and the next clip starts. */
  private landOneShot(): void {
    this.oneShotRunning = false;
    this.posture = postureAfter(this.currentClip, this.posture);
    this.clipDone = true;
    this.next();
  }

  private locomote(dt: number): void {
    const gaitPlaying = isGait(this.currentClip) && !this.oneShotRunning;
    let speed = 0;
    let turn = 0;
    if (gaitPlaying) {
      const g = GAITS[this.gait];
      if (this.moveTo) {
        const r = steer({ position: this.position, heading: this.heading }, this.moveTo, dt, {
          ...DEFAULT_STEER,
          maxSpeed: g.speed,
        });
        this.position = this.step(r.position);
        this.heading = r.heading;
        speed = r.speed;
        turn = r.turnRate;
        if (r.arrived) {
          this.moveTo = null;
          this.arrived = true;
          this.queue = [];
          this.start("idle", FADE);
        }
      } else {
        // A gait with nowhere to go walks straight on.
        speed = g.speed;
        this.position = this.step({
          x: this.position.x + Math.sin(this.heading) * speed * dt,
          z: this.position.z + Math.cos(this.heading) * speed * dt,
        });
      }
      // The clip is authored for its speed at RIG_SCALE; slower ground speed, or a bigger cat,
      // means slower steps, not sliding.
      const size = this.cat.appearance.size / RIG_SCALE;
      const scale = speed > 0 ? Math.max(0.35, Math.min(1.35, speed / (g.speed * size))) : 0;
      this.action.setEffectiveTimeScale(scale);
    }
    this.turnRate += (turn - this.turnRate) * Math.min(1, dt * 6);

    if (this.hop >= 0) {
      // The startle's hop back: 8 rig cm over the airborne part of the clip.
      const t0 = this.hop;
      this.hop += dt;
      const s = (x: number): number => Math.min(1, Math.max(0, (x - 0.14) / 0.3));
      const d = 0.08 * this.cat.appearance.size * (s(this.hop) - s(t0));
      this.position = this.step({
        x: this.position.x - Math.sin(this.heading) * d,
        z: this.position.z - Math.cos(this.heading) * d,
      });
      if (this.hop > 0.5) this.hop = -1;
    }
    this.group.position.set(this.position.x, 0, this.position.z);
    this.group.rotation.y = this.heading;
  }

  /** One proposed step, as the room allows it. */
  private step(to: Vec2): Vec2 {
    return this.arena.resolveStep(
      this.position.x,
      this.position.z,
      to.x,
      to.z,
      this.cat.appearance.radius,
    );
  }

  private readonly clipQuats = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly clipRootPos = new THREE.Vector3();

  private saveClipPose(): void {
    for (const bone of this.cat.skeleton.bones) {
      const saved = this.clipQuats.get(bone);
      if (saved) saved.copy(bone.quaternion);
      else this.clipQuats.set(bone, bone.quaternion.clone());
    }
    this.clipRootPos.copy(this.cat.bones.root.position);
  }

  private restoreClipPose(): void {
    if (this.clipQuats.size === 0) return;
    for (const [bone, q] of this.clipQuats) bone.quaternion.copy(q);
    this.cat.bones.root.position.copy(this.clipRootPos);
  }

  /** Turns a bone about the WORLD up axis and nods it about the body's sideways axis. The neck
   * is pitched well up from horizontal, so a yaw about its local Y twists the head about the
   * neck like a screw — the "spinning head" — instead of turning it left or right. The world
   * rotation is carried into the bone's local frame: local' = parent^-1 * R * parent * local. */
  private aimBone(bone: THREE.Bone, yaw: number, pitch: number): void {
    if (yaw === 0 && pitch === 0) return;
    const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    const body = this.group.getWorldQuaternion(new THREE.Quaternion());
    const turn = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const side = SIDE.clone().applyQuaternion(body).applyQuaternion(turn);
    const world = new THREE.Quaternion().setFromAxisAngle(side, pitch).multiply(turn);
    const local = parent.clone().invert().multiply(world).multiply(parent);
    bone.quaternion.premultiply(local);
  }

  private layerProcedural(dt: number): void {
    const b = this.cat.bones;
    const def = this.clips[this.playing].def;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();

    // Head look-at: yaw split across neck and head, pitched toward a point a hand's height off
    // the floor, clamped so the head never turns further than a cat's would.
    const wantWeight = this.lookTarget && def.headFree ? 1 : 0;
    this.lookWeight += (wantWeight - this.lookWeight) * Math.min(1, dt * 5);
    let yaw = 0;
    let pitch = 0;
    if (this.lookTarget) {
      yaw = wrapAngle(headingTo(this.position, this.lookTarget) - this.heading);
      const dist = Math.hypot(
        this.lookTarget.x - this.position.x,
        this.lookTarget.z - this.position.z,
      );
      const headY =
        (this.posture === "stand" ? 0.27 : this.posture === "sit" ? 0.25 : 0.14) *
        this.cat.appearance.size;
      pitch = Math.atan2(headY - 0.1, Math.max(0.05, dist - 0.25));
      yaw = Math.max(-75 * DEG, Math.min(75 * DEG, yaw));
      pitch = Math.max(-30 * DEG, Math.min(45 * DEG, pitch));
    }
    const k = Math.min(1, dt * 8);
    this.lookYaw += (yaw - this.lookYaw) * k;
    this.lookPitch += (pitch - this.lookPitch) * k;
    const w = this.lookWeight;
    this.aimBone(b.neck, this.lookYaw * 0.35 * w, this.lookPitch * 0.35 * w);
    this.aimBone(b.head, this.lookYaw * 0.65 * w, this.lookPitch * 0.65 * w);

    // Breathing, slower asleep.
    const rate = this.posture === "loaf" ? 0.28 : 0.45;
    const breath = Math.sin(2 * Math.PI * rate * this.clock);
    e.set(-0.8 * DEG * breath, 0, 0, "YXZ");
    b.spine2.quaternion.multiply(q.setFromEuler(e));
    b.spine3.quaternion.multiply(q);
    b.root.position.y += 0.0015 * breath;

    // An ear flick now and then.
    if (this.clock >= this.nextFlick) {
      this.flickAt = this.clock;
      this.flickEar = Math.random() < 0.5 ? "earL" : "earR";
      this.nextFlick = this.clock + 3 + Math.random() * 6;
    }
    if (this.flickAt >= 0) {
      const s = (this.clock - this.flickAt) / 0.18;
      if (s >= 1) this.flickAt = -1;
      else {
        const sign = this.flickEar === "earL" ? 1 : -1;
        e.set(0, 0, sign * 35 * DEG * Math.sin(Math.PI * s), "YXZ");
        b[this.flickEar].quaternion.multiply(q.setFromEuler(e));
      }
    }

    this.layerFace();

    // The tail trails a turn: each bone swings the other way, more toward the tip.
    this.tailLag += (this.turnRate - this.tailLag) * Math.min(1, dt * 4);
    for (let i = 0; i < TAIL_BONES.length; i++) {
      e.set(0, -this.tailLag * 4 * DEG * ((i + 1) / TAIL_BONES.length), 0, "YXZ");
      b[TAIL_BONES[i]!].quaternion.multiply(q.setFromEuler(e));
    }

    // The pouch swings: it hangs off the ribcage, so it lags the body's roll and its bob the way
    // the tail lags a turn, and hangs still again a moment after the cat stops.
    const rootRoll = new THREE.Euler().setFromQuaternion(b.root.quaternion, "YXZ").z;
    // The clip's own bob, not the breathing this layer has already added to the root.
    const bob = this.clipRootPos.y;
    const lagged = this.bellyY ?? bob;
    this.bellyRollLag += (rootRoll - this.bellyRollLag) * Math.min(1, dt * 6);
    this.bellyY = lagged + (bob - lagged) * Math.min(1, dt * 8);
    const swingZ = clampAngle((rootRoll - this.bellyRollLag) * 6, 10 * DEG);
    const swingX = clampAngle((bob - this.bellyY) * 150, 8 * DEG);
    e.set(swingX, 0, swingZ, "YXZ");
    b.belly.quaternion.multiply(q.setFromEuler(e));
  }

  /** Eyes: they lead the head toward a look target and drift back when there is none, and they
   * blink. Both are set absolutely every frame (face.ts), so nothing compounds the way a bone
   * layered onto a mixer-written quaternion would. */
  private layerFace(): void {
    const face = this.cat.face;
    // The head only turns part of the way to a target; the eyes take up the rest and a little
    // more, which is what makes a cat look like it has noticed something.
    const lead = this.lookTarget ? 1.4 : 0;
    face.setGaze(
      this.lookYaw * 0.4 * this.lookWeight * lead,
      this.lookPitch * 0.4 * this.lookWeight * lead,
    );

    // A shut-eyed loaf, half-closed eyes at rest, wide open on its feet.
    const resting = this.posture === "loaf";
    const base = resting ? 1 : this.posture === "lie" || this.posture === "sit" ? 0.22 : 0;
    const gap = resting ? 12 : this.posture === "stand" ? 4 : 6;
    if (this.clock >= this.nextBlink) {
      this.blinkAt = this.clock;
      this.nextBlink = this.clock + gap * (0.6 + Math.random());
    }
    let closed = base;
    if (this.blinkAt >= 0) {
      const s = (this.clock - this.blinkAt) / BLINK_S;
      if (s >= 1) this.blinkAt = -1;
      else closed = Math.max(base, Math.sin(Math.PI * s));
    }
    face.setBlink(closed);
  }
}
