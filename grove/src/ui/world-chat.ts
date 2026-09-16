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
import { speakerOf, type ChatEntry } from "./chat-log";

// The chat log in a headset (VR-PRESENCE §5).
//
// `ui/chat.ts` is the same log in DOM, and DOM is not shown in an immersive
// session, so a visitor in a headset can watch a conversation happen and read
// none of it. This is that log drawn into a canvas and hung in the scene,
// which is the only kind of text a headset can show.
//
// Visitor-locked, not world-locked, and that is a deliberate split: a peer's
// SPEECH hangs above their capsule, because you should turn to someone to hear
// them, but a scrolling history you are meant to read has no business being
// across the room. VR-PRESENCE §8 ruling 2 proposes exactly this pair.

const WIDTH = 1024;
const HEIGHT = 512;

/**
 * Metres, at `DISTANCE`. 40 px of a 512 px panel 0.28 m tall is a 22 mm cap
 * height at 1.5 m, which is the legibility budget DEVICE-TIERS implies for
 * `vr-quest` at 2064x2208 per eye.
 */
const PANEL_W = 0.56;
const PANEL_H = 0.28;
const DISTANCE = 1.5;
const FONT_PX = 40;
const LINE_PX = 52;
const PAD_PX = 24;

/** How many lines fit. Fewer than the DOM log keeps, on purpose: this is a panel. */
export const VR_LOG_LINES = Math.floor((HEIGHT - PAD_PX * 2) / LINE_PX);

/**
 * What the panel would draw, as one string.
 *
 * Exported so the redraw rule can be tested without a canvas: the panel
 * redraws when this changes and not otherwise, and "not otherwise" is the part
 * that matters at 72 Hz.
 */
export function logKey(lines: readonly ChatEntry[]): string {
  // JSON, not a joined separator: with a separator character, a name of "a|b"
  // and a text of "c" is indistinguishable from a name of "a" and a text of
  // "b|c", so a line that changed could read as unchanged and never redraw.
  // Chat text is arbitrary and contains whatever someone typed.
  return JSON.stringify(lines.map((line) => [line.id, line.name, line.text, line.mine]));
}

/** The newest lines that fit on the panel. */
export function visibleLines(lines: readonly ChatEntry[]): ChatEntry[] {
  return lines.slice(-VR_LOG_LINES);
}

export class WorldChat {
  readonly panel: Mesh;

  #canvas: HTMLCanvasElement;
  #texture: CanvasTexture;
  #drawn = "";
  #lines: ChatEntry[] = [];
  #origin = new Vector3();
  #forward = new Vector3();
  #right = new Vector3();

  constructor() {
    this.#canvas = document.createElement("canvas");
    this.#canvas.width = WIDTH;
    this.#canvas.height = HEIGHT;
    this.#texture = new CanvasTexture(this.#canvas);
    this.#texture.colorSpace = SRGBColorSpace;
    this.panel = new Mesh(
      new PlaneGeometry(PANEL_W, PANEL_H),
      new MeshBasicMaterial({ map: this.#texture, transparent: true, side: DoubleSide }),
    );
    this.panel.name = "world-chat";
    this.panel.visible = false;
    this.panel.renderOrder = 10;
  }

  /** The log as the panel holds it. Keeps the newest `VR_LOG_LINES`. */
  setLines(lines: readonly ChatEntry[]): void {
    this.#lines = visibleLines(lines);
  }

  /**
   * Places the panel and redraws it only if the text changed.
   *
   * The redraw is keyed on the TEXT rather than on a dirty flag the caller
   * sets, so a caller that forgets cannot cause a silent per-frame upload. A
   * panel is one more draw call and one more texture against a 150-call,
   * 256 MB budget; moving it costs nothing, re-uploading it at 72 Hz is the
   * difference between a panel and a problem.
   */
  update(camera: PerspectiveCamera, presenting: boolean): void {
    this.panel.visible = presenting && this.#lines.length > 0;
    if (!this.panel.visible) return;

    const key = logKey(this.#lines);
    if (key !== this.#drawn) {
      this.#draw();
      this.#drawn = key;
      this.#texture.needsUpdate = true;
    }

    // Left of centre and slightly down, so it sits where a person would hold a
    // notebook rather than over whatever they are looking at.
    camera.getWorldPosition(this.#origin);
    camera.getWorldDirection(this.#forward);
    this.#right.crossVectors(this.#forward, camera.up).normalize();
    this.panel.position
      .copy(this.#origin)
      .addScaledVector(this.#forward, DISTANCE)
      .addScaledVector(this.#right, -PANEL_W * 0.85)
      .addScaledVector(camera.up, -PANEL_H * 0.4);
    this.panel.quaternion.copy(camera.quaternion);
  }

  #draw(): void {
    const context = this.#canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "rgba(12, 12, 14, 0.78)";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.textBaseline = "top";
    context.font = `${FONT_PX}px system-ui, sans-serif`;

    let y = PAD_PX;
    for (const line of this.#lines) {
      // A system line has no speaker and must not borrow one.
      const who = line.name.trim() ? `${speakerOf(line)}: ` : "";
      context.fillStyle = line.mine ? "#c8a24a" : who ? "#cfd2d6" : "#8b8f95";
      context.fillText(clip(context, `${who}${line.text}`, WIDTH - PAD_PX * 2), PAD_PX, y);
      y += LINE_PX;
    }
  }

  dispose(): void {
    this.#texture.dispose();
    (this.panel.material as MeshBasicMaterial).dispose();
    this.panel.geometry.dispose();
  }
}

/**
 * One line, cut to the panel with an ellipsis.
 *
 * Cutting rather than wrapping: a 280-character line would otherwise push
 * every other line off a panel this size, so someone who says a long thing
 * would silently erase the conversation around it.
 */
export function clip(context: Pick<CanvasRenderingContext2D, "measureText">, text: string, max: number): string {
  if (context.measureText(text).width <= max) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (context.measureText(`${text.slice(0, mid)}…`).width <= max) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low)}…`;
}
