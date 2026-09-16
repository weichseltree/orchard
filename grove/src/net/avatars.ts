import {
  CanvasTexture,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from "three";
import { PALETTE } from "../config";
import type { Peer } from "./presence";

// Other visitors: a capsule and a name. M0 has no avatars worth the name, and
// a capsule that is honestly a capsule beats a humanoid that is not. A name
// can be anything, "Manuel" included; the orchard's admins carry a green tag
// with "host" on it, which only the server can grant.
//
// When a peer says something, their last line hangs above the name for a few
// seconds: a canvas drawn once and uploaded as a sprite, the same path
// ui/worldnotice.ts takes, so it works flat and in an immersive session alike
// (VR-PRESENCE §4). Text is drawn, never parsed: a line is data.

const BODY_HEIGHT = 1.1;
const BODY_RADIUS = 0.22;
const EYE = 1.62;
/** Poses arrive at 10 Hz; this is how fast a capsule catches up to one. */
const SMOOTHING = 12;
/** How long a said line stays above a capsule, or until the next one replaces it. */
export const SPEECH_HOLD_MS = 8000;
const SPEECH_WIDTH = 512;
const SPEECH_LINES = 3;
/** Canvas pixels per metre for both sprites. */
const PX_PER_M = 256;
const NAME_Y = EYE - BODY_HEIGHT / 2 + 0.22;

interface Avatar {
  group: Group;
  sprite: Sprite;
  texture: CanvasTexture;
  name: string;
  host: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** The speech sprite, made on the first line and kept (hidden) after it. */
  speech: Sprite | null;
  /** Which line the speech sprite shows, so a re-report never redraws it. */
  speechKey: string;
}

interface Speech {
  text: string;
  until: number;
}

export class Avatars {
  readonly group = new Group();

  #geometry = new CapsuleGeometry(BODY_RADIUS, BODY_HEIGHT - BODY_RADIUS * 2, 6, 12);
  #material = new MeshStandardMaterial({
    color: 0x9fb3a4,
    roughness: 0.7,
    metalness: 0,
    transparent: true,
    opacity: 0.92,
  });
  #avatars = new Map<string, Avatar>();
  /** What each peer last said, by identity; kept apart from the avatar so a line said before the capsule exists is not lost. */
  #speech = new Map<string, Speech>();

  constructor() {
    this.group.name = "avatars";
  }

  /**
   * A peer said something: it hangs above their capsule for SPEECH_HOLD_MS,
   * or until their next line. Unknown identities are kept too, in case the
   * capsule is a frame behind the line.
   */
  speak(identity: string, text: string, now: number = performance.now()): void {
    this.#speech.set(identity, { text, until: now + SPEECH_HOLD_MS });
  }

  /** Moves every capsule towards its last known pose. No allocation while stable. */
  update(peers: ReadonlyMap<string, Peer>, dt: number, now: number = performance.now()): void {
    for (const [id, peer] of peers) {
      let avatar = this.#avatars.get(id);
      if (!avatar) {
        avatar = this.#create(peer);
        this.#avatars.set(id, avatar);
        this.group.add(avatar.group);
      } else if (avatar.name !== peer.name || avatar.host !== peer.host) {
        avatar.texture.dispose();
        const built = nameTexture(peer.name, peer.host);
        avatar.texture = built;
        (avatar.sprite.material as SpriteMaterial).map = built;
        (avatar.sprite.material as SpriteMaterial).needsUpdate = true;
        avatar.sprite.scale.set(built.image.width / 256, built.image.height / 256, 1);
        avatar.name = peer.name;
        avatar.host = peer.host;
      }
      const k = 1 - Math.exp(-SMOOTHING * dt);
      avatar.x += (peer.x - avatar.x) * k;
      avatar.y += (peer.y - avatar.y) * k;
      avatar.z += (peer.z - avatar.z) * k;
      avatar.yaw += angleDelta(peer.yaw, avatar.yaw) * k;
      avatar.group.position.set(avatar.x, avatar.y + BODY_HEIGHT / 2 + 0.05, avatar.z);
      avatar.group.rotation.y = avatar.yaw;
      this.#updateSpeech(id, avatar, now);
    }
    for (const [id, avatar] of this.#avatars) {
      if (peers.has(id)) continue;
      this.group.remove(avatar.group);
      avatar.texture.dispose();
      (avatar.sprite.material as SpriteMaterial).dispose();
      disposeSpeech(avatar);
      this.#avatars.delete(id);
      this.#speech.delete(id);
    }
    // A line for someone who never turned up (left before their capsule was
    // made) must not be kept for good.
    for (const [id, speech] of this.#speech) {
      if (speech.until <= now && !this.#avatars.has(id)) this.#speech.delete(id);
    }
  }

  dispose(): void {
    for (const avatar of this.#avatars.values()) {
      avatar.texture.dispose();
      (avatar.sprite.material as SpriteMaterial).dispose();
      disposeSpeech(avatar);
    }
    this.#avatars.clear();
    this.#speech.clear();
    this.#geometry.dispose();
    this.#material.dispose();
  }

  #create(peer: Peer): Avatar {
    const group = new Group();
    group.name = `avatar-${peer.identity.slice(0, 8)}`;
    const body = new Mesh(this.#geometry, this.#material);
    group.add(body);
    const texture = nameTexture(peer.name, peer.host);
    const sprite = new Sprite(
      new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    sprite.scale.set(texture.image.width / 256, texture.image.height / 256, 1);
    sprite.position.y = NAME_Y;
    group.add(sprite);
    return {
      group, sprite, texture, name: peer.name, host: peer.host,
      x: peer.x, y: peer.y, z: peer.z, yaw: peer.yaw, speech: null, speechKey: "",
    };
  }

  /** Shows, replaces or hides the speech sprite; redraws only when the line changed. */
  #updateSpeech(id: string, avatar: Avatar, now: number): void {
    const speech = this.#speech.get(id);
    if (!speech || speech.until <= now) {
      if (speech) this.#speech.delete(id);
      if (avatar.speech) avatar.speech.visible = false;
      return;
    }
    const key = `${speech.until}:${speech.text}`;
    if (avatar.speech && avatar.speechKey === key) return;
    const texture = speechTexture(speech.text);
    if (!avatar.speech) {
      avatar.speech = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
      avatar.speech.name = "speech";
      avatar.group.add(avatar.speech);
    } else {
      const material = avatar.speech.material as SpriteMaterial;
      material.map?.dispose();
      material.map = texture;
      material.needsUpdate = true;
    }
    const height = texture.image.height / PX_PER_M;
    avatar.speech.scale.set(texture.image.width / PX_PER_M, height, 1);
    avatar.speech.position.y = NAME_Y + 0.16 + height / 2;
    avatar.speech.visible = true;
    avatar.speechKey = key;
  }
}

function disposeSpeech(avatar: Avatar): void {
  if (!avatar.speech) return;
  const material = avatar.speech.material as SpriteMaterial;
  material.map?.dispose();
  material.dispose();
  avatar.speech = null;
}

/** A said line, wrapped to at most SPEECH_LINES on a dark card; drawn once. */
function speechTexture(text: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  const font = "500 28px system-ui, sans-serif";
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.width = 8;
    canvas.height = 8;
    return new CanvasTexture(canvas);
  }
  context.font = font;
  const lines = wrap(context, text, SPEECH_WIDTH - 40);
  if (lines.length > SPEECH_LINES) {
    lines.length = SPEECH_LINES;
    lines[SPEECH_LINES - 1] = `${lines[SPEECH_LINES - 1]!.replace(/\s*\S*$/, "")}…`;
  }
  const lineHeight = 36;
  const widest = Math.max(...lines.map((line) => context.measureText(line).width));
  canvas.width = Math.max(96, Math.min(SPEECH_WIDTH, Math.ceil(widest) + 40));
  canvas.height = lines.length * lineHeight + 28;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = font;
    ctx.fillStyle = "rgba(14,19,16,0.86)";
    roundRect(ctx, 0, 0, canvas.width, canvas.height, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(217,226,218,0.25)";
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, canvas.width - 2, canvas.height - 2, 11);
    ctx.stroke();
    ctx.fillStyle = PALETTE.text;
    ctx.textBaseline = "middle";
    lines.forEach((line, i) => ctx.fillText(line, 20, 14 + lineHeight * (i + 0.5)));
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/** A name tag drawn once into a canvas; sprites keep it facing the visitor. */
function nameTexture(name: string, host: boolean): CanvasTexture {
  const text = `${name || "visitor"}${host ? " · host" : ""}`;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const font = "600 36px system-ui, sans-serif";
  if (!context) {
    canvas.width = 8;
    canvas.height = 8;
    return new CanvasTexture(canvas);
  }
  context.font = font;
  const width = Math.ceil(context.measureText(text).width) + 32;
  canvas.width = Math.max(64, width);
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = font;
    ctx.fillStyle = "rgba(14,19,16,0.72)";
    roundRect(ctx, 0, 6, canvas.width, 52, 10);
    ctx.fill();
    if (host) {
      ctx.strokeStyle = PALETTE.accent;
      ctx.lineWidth = 3;
      roundRect(ctx, 1.5, 7.5, canvas.width - 3, 49, 9);
      ctx.stroke();
    }
    ctx.fillStyle = host ? PALETTE.accent : PALETTE.text;
    ctx.textBaseline = "middle";
    ctx.fillText(text, 16, 33);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
