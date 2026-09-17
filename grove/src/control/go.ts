import { Mesh, MeshBasicMaterial, RingGeometry, Vector3, type Object3D, type PerspectiveCamera } from "three";
import { PALETTE } from "../config";
import { exhibitContent } from "../ui/exhibit-content";
import type { Provenance, ProvenanceTarget } from "../ui/provenance";
import { framingPose, hangingFace, lookFrom, nextHangingIndex } from "../world/framing";
import { BODY_RADIUS } from "../world/navigation";
import { roomById, type Mansion, type Room } from "../world/schema";
import { floorAt } from "../world/terrain";
import { floorHit, planGlide, roomUnder, stepGlide, type Glide, type GlideRefusal } from "./glide";
import type { InputState } from "./input";
import type { Body } from "./locomotion";

// Go and point, off the startup path: the glide to a floor point, the framed
// exhibit and the N key's walk through a room's hangings. Loaded on the
// first click, tap or key, and ahead of that when the page is idle.

export interface GoOptions {
  mansion: Mansion;
  body: Body;
  camera: PerspectiveCamera;
  scene: Object3D;
  provenance: Provenance;
  hud: HTMLElement;
  eyeHeight: number;
  /** Whether to name the keys in the exhibit readout. */
  keys: boolean;
  locked(roomId: string): boolean;
  notice(text: string): void;
}

const REFUSED: Record<GlideRefusal, string> = {
  "no floor": "nothing to stand on there",
  locked: "that room is not open just now",
  "out of reach": "no open way leads there from here",
  "in the way": "something is in the way; walk a little closer",
};

export class Go {
  readonly marker: Mesh;
  #options: GoOptions;
  #glide: Glide | null = null;
  #framed: { room: string; index: number | null } | null = null;
  #readout = document.createElement("div");
  #origin = new Vector3();
  #direction = new Vector3();

  constructor(options: GoOptions) {
    this.#options = options;
    this.marker = new Mesh(
      new RingGeometry(0.2, 0.28, 32).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.marker.name = "glide-marker";
    this.marker.visible = false;
    options.scene.add(this.marker);
    this.#readout.className = "exhibit-index panel";
    this.#readout.setAttribute("role", "status");
    this.#readout.hidden = true;
    options.hud.append(this.#readout);
  }

  /** What is under a screen point (or the crosshair), acted on: framed, glided to, or nothing. */
  point(at: { x: number; y: number } | null): "exhibit" | "floor" | "nothing" {
    const { camera, provenance, mansion, body } = this.#options;
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.#origin);
    if (at) this.#direction.set(at.x, at.y, 0.5).unproject(camera).sub(this.#origin).normalize();
    else camera.getWorldDirection(this.#direction);
    const exhibit = provenance.pickRay(this.#origin, this.#direction);
    const scale = roomById(mansion, body.room)?.scale ?? 1;
    const floor = floorHit(mansion, scale, this.#origin.toArray(), this.#direction.toArray());
    if (exhibit && !exhibit.target.id.startsWith("room:") && (!floor || exhibit.distance < floor.distance)) {
      this.#frameTarget(exhibit.target);
      return "exhibit";
    }
    if (!floor) return "nothing";
    this.release();
    // A point by the skirting means the floor there: a body's width off the wall.
    const { min, max } = floor.room.bounds;
    const inset = (v: number, lo: number, hi: number) => Math.min(hi - BODY_RADIUS, Math.max(lo + BODY_RADIUS, v));
    this.#go(inset(floor.x, min[0], max[0]), inset(floor.z, min[2], max[2]), undefined, false, floor.room);
    return "floor";
  }

  /** N and Shift+N: the room's hangings in the order mansion.json hangs them. */
  next(delta: 1 | -1): void {
    const room = roomById(this.#options.mansion, this.#options.body.room);
    if (!room) return;
    const current = this.#framed?.room === room.id ? this.#framed.index : null;
    const index = nextHangingIndex(room.hangings.length, current, delta);
    if (index === null) this.#options.notice("Nothing hangs in this room.");
    else this.frame(room, index);
  }

  /** Glides to where a hanging is seen whole, turns to it and opens what it is. */
  frame(room: Room, index: number): void {
    const { body, camera, provenance, eyeHeight } = this.#options;
    const hanging = room.hangings[index];
    if (!hanging) return;
    const face = hangingFace(room, hanging);
    const pose = framingPose(face, room, camera.fov, camera.aspect, eyeHeight);
    if (!this.#go(pose.x, pose.z, pose, room.id === body.room, room)) {
      if (room.id !== body.room) return;
      // No straight way to the viewing spot (a stair's cheek, say): turn to it from here.
      this.#go(body.x, body.z, lookFrom(body.x, body.z, face.centre, body.y + eyeHeight), false, room);
    }
    const target = provenance.forHanging(hanging.id);
    const title = hanging.title || target?.title || hanging.id;
    provenance.showRecord(title, target?.read() ?? { kind: hanging.kind, hanging: hanging.id }, target);
    this.#show(room, index, title);
  }

  /** Back to free walking. */
  release(): void {
    this.#glide = null;
    this.marker.visible = false;
    if (!this.#framed) return;
    this.#framed = null;
    this.#readout.hidden = true;
    this.#options.provenance.close();
  }

  /** One frame. Walking ends it all; looking around gives the head back but keeps the glide. True while gliding. */
  update(dt: number, input: InputState): boolean {
    if (input.forward !== 0 || input.strafe !== 0) {
      if (this.#glide || this.#framed) this.release();
      return false;
    }
    const glide = this.#glide;
    if (!glide) return false;
    if (input.yawDelta !== 0 || input.pitchDelta !== 0) glide.turn = false;
    const { body, mansion, locked } = this.#options;
    if (stepGlide(body, glide, dt, mansion, (id) => locked(id)) !== "moving") {
      this.#glide = null;
      this.marker.visible = false;
    }
    return true;
  }

  dispose(): void {
    this.release();
    this.marker.removeFromParent();
    this.marker.geometry.dispose();
    (this.marker.material as MeshBasicMaterial).dispose();
    this.#readout.remove();
  }

  #frameTarget(target: ProvenanceTarget): void {
    const { mansion, body, provenance, camera, eyeHeight } = this.#options;
    if (target.hanging) {
      for (const room of mansion.rooms) {
        const index = room.hangings.findIndex((h) => h.id === target.hanging);
        if (index >= 0) return this.frame(room, index);
      }
    }
    // A room's own plaque, or one of its record lines: framed from where it
    // hangs, read as the room's introduction or as the line itself.
    const centre = target.bounds.getCenter(new Vector3());
    const size = target.bounds.getSize(new Vector3());
    // A plaque hangs at reading height over its own floor.
    const room = roomUnder(mansion, body, centre.x, centre.z, centre.y - eyeHeight, 0);
    if (!room) return;
    const normal = [body.x - centre.x, body.z - centre.z];
    const length = Math.hypot(normal[0]!, normal[1]!) || 1;
    const pose = framingPose(
      { centre: centre.toArray(), normal: [normal[0]! / length, normal[1]! / length], width: Math.max(size.x, size.z), height: size.y },
      room,
      camera.fov,
      camera.aspect,
      eyeHeight,
    );
    this.release();
    this.#go(pose.x, pose.z, pose, false, room);
    const content = exhibitContent(room);
    const record = target.id.startsWith("line:") ? target.read() : { question: content.question, introduction: content.introduction };
    provenance.showRecord(target.title, record, target);
    this.#show(room, null, target.title);
  }

  /** Starts a glide, or says why not; true when it started. */
  #go(x: number, z: number, face?: { yaw: number; pitch: number }, quiet = false, into?: Room): boolean {
    const { mansion, body, locked, notice } = this.#options;
    const plan = planGlide(mansion, body, x, z, (id) => locked(id), face, into);
    if (typeof plan === "string") {
      if (!quiet) notice(REFUSED[plan]);
      return false;
    }
    this.#glide = plan;
    const room = into ?? roomUnder(mansion, body, x, z);
    const moving = Math.hypot(x - body.x, z - body.z) > 0.3;
    this.marker.visible = moving;
    if (room && moving) this.marker.position.set(x, floorAt(mansion, room, x, z) + 0.02, z);
    return true;
  }

  #show(room: Room, index: number | null, title: string): void {
    this.#framed = { room: room.id, index };
    const count = room.hangings.length;
    const where = index === null ? "" : `${index + 1} / ${count} · `;
    const keys = this.#options.keys ? (count > 1 ? " · N next · Esc back" : " · Esc back") : "";
    this.#readout.textContent = `${where}${title}${keys}`;
    this.#readout.hidden = false;
  }
}
