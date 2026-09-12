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
// a capsule that is honestly a capsule beats a humanoid that is not.

const BODY_HEIGHT = 1.1;
const BODY_RADIUS = 0.22;
const EYE = 1.62;
/** Poses arrive at 10 Hz; this is how fast a capsule catches up to one. */
const SMOOTHING = 12;

interface Avatar {
  group: Group;
  sprite: Sprite;
  texture: CanvasTexture;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
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

  constructor() {
    this.group.name = "avatars";
  }

  /** Moves every capsule towards its last known pose. No allocation while stable. */
  update(peers: ReadonlyMap<string, Peer>, dt: number): void {
    for (const [id, peer] of peers) {
      let avatar = this.#avatars.get(id);
      if (!avatar) {
        avatar = this.#create(peer);
        this.#avatars.set(id, avatar);
        this.group.add(avatar.group);
      } else if (avatar.name !== peer.name) {
        avatar.texture.dispose();
        const built = nameTexture(peer.name);
        avatar.texture = built;
        (avatar.sprite.material as SpriteMaterial).map = built;
        (avatar.sprite.material as SpriteMaterial).needsUpdate = true;
        avatar.sprite.scale.set(built.image.width / 256, built.image.height / 256, 1);
        avatar.name = peer.name;
      }
      const k = 1 - Math.exp(-SMOOTHING * dt);
      avatar.x += (peer.x - avatar.x) * k;
      avatar.y += (peer.y - avatar.y) * k;
      avatar.z += (peer.z - avatar.z) * k;
      avatar.yaw += angleDelta(peer.yaw, avatar.yaw) * k;
      avatar.group.position.set(avatar.x, avatar.y + BODY_HEIGHT / 2 + 0.05, avatar.z);
      avatar.group.rotation.y = avatar.yaw;
    }
    for (const [id, avatar] of this.#avatars) {
      if (peers.has(id)) continue;
      this.group.remove(avatar.group);
      avatar.texture.dispose();
      (avatar.sprite.material as SpriteMaterial).dispose();
      this.#avatars.delete(id);
    }
  }

  dispose(): void {
    for (const avatar of this.#avatars.values()) {
      avatar.texture.dispose();
      (avatar.sprite.material as SpriteMaterial).dispose();
    }
    this.#avatars.clear();
    this.#geometry.dispose();
    this.#material.dispose();
  }

  #create(peer: Peer): Avatar {
    const group = new Group();
    group.name = `avatar-${peer.identity.slice(0, 8)}`;
    const body = new Mesh(this.#geometry, this.#material);
    group.add(body);
    const texture = nameTexture(peer.name);
    const sprite = new Sprite(
      new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    sprite.scale.set(texture.image.width / 256, texture.image.height / 256, 1);
    sprite.position.y = EYE - BODY_HEIGHT / 2 + 0.22;
    group.add(sprite);
    return { group, sprite, texture, name: peer.name, x: peer.x, y: peer.y, z: peer.z, yaw: peer.yaw };
  }
}

/** A name tag drawn once into a canvas; sprites keep it facing the visitor. */
function nameTexture(name: string): CanvasTexture {
  const text = name || "visitor";
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
    ctx.fillStyle = PALETTE.text;
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
