import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type PerspectiveCamera,
} from "three";
import { PALETTE } from "../config";

// Every failure surface in this client is DOM, and in an immersive session
// there is no DOM. A visitor in a headset would watch the tape silently not
// load. This is the same notice list, drawn into a canvas and parked below eye
// level where it does not sit in the way of the room.

const WIDTH = 1024;
const HEIGHT = 256;
const HOLD_MS = 9000;

interface Line {
  text: string;
  until: number;
}

export class WorldNotices {
  readonly panel: Mesh;

  #canvas: HTMLCanvasElement;
  #texture: CanvasTexture;
  #lines: Line[] = [];
  #dirty = false;
  #origin = new Vector3();
  #forward = new Vector3();

  constructor() {
    this.#canvas = document.createElement("canvas");
    this.#canvas.width = WIDTH;
    this.#canvas.height = HEIGHT;
    this.#texture = new CanvasTexture(this.#canvas);
    this.#texture.colorSpace = SRGBColorSpace;
    this.panel = new Mesh(
      new PlaneGeometry(0.6, 0.15),
      new MeshBasicMaterial({ map: this.#texture, transparent: true, side: DoubleSide }),
    );
    this.panel.name = "world-notices";
    this.panel.visible = false;
    this.panel.renderOrder = 10;
  }

  push(text: string, now: number = performance.now()): void {
    this.#lines.push({ text, until: now + HOLD_MS });
    while (this.#lines.length > 3) this.#lines.shift();
    this.#dirty = true;
  }

  /** Parks the board below the line of sight while presenting; hides it otherwise. */
  update(camera: PerspectiveCamera, presenting: boolean, now: number = performance.now()): void {
    const before = this.#lines.length;
    this.#lines = this.#lines.filter((line) => line.until > now);
    if (this.#lines.length !== before) this.#dirty = true;
    const show = presenting && this.#lines.length > 0;
    this.panel.visible = show;
    if (!show) return;
    if (this.#dirty) this.#draw();
    camera.getWorldPosition(this.#origin);
    camera.getWorldDirection(this.#forward);
    this.panel.position.copy(this.#origin).addScaledVector(this.#forward, 1.1);
    this.panel.position.y -= 0.42;
    this.panel.quaternion.copy(camera.getWorldQuaternion(this.panel.quaternion));
  }

  dispose(): void {
    this.#texture.dispose();
    this.panel.geometry.dispose();
    (this.panel.material as MeshBasicMaterial).dispose();
  }

  #draw(): void {
    const ctx = this.#canvas.getContext("2d");
    if (!ctx) return;
    this.#dirty = false;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "rgba(14,19,16,0.9)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = "rgba(217,226,218,0.2)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, WIDTH - 3, HEIGHT - 3);
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillStyle = PALETTE.dim;
    let y = 52;
    for (const line of this.#lines) {
      for (const part of wrap(ctx, line.text, WIDTH - 48).slice(0, 2)) {
        ctx.fillText(part, 24, y);
        y += 32;
      }
      y += 6;
    }
    this.#texture.needsUpdate = true;
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
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
  return lines;
}
