import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Object3D,
} from "three";
import { ASKS, type AskMenuState } from "./ask-menu";

// The ask menu, worn on the left wrist (VR-PRESENCE §6, ruling 3).
//
// Worn rather than hung in the room because it is the visitor's, not the
// room's: it has to be where they look when they decide to ask, and it has to
// come with them. Parented to the controller, so it needs no placement code
// and cannot drift away from the hand.
//
// Loaded on the first immersive session with the headset log; nobody outside
// a headset ever sees it.

const WIDTH = 512;
const HEIGHT = 384;
const ROW_PX = 72;
const TOP_PX = 64;

/** A card about the size of a phone, tilted up off the back of the wrist. */
const PANEL_W = 0.16;
const PANEL_H = 0.12;

export class WristMenu {
  readonly panel: Mesh;

  #canvas: HTMLCanvasElement;
  #texture: CanvasTexture;
  #drawn = -1;

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
    this.panel.name = "wrist-menu";
    this.panel.visible = false;
    this.panel.renderOrder = 11;
    // Above the controller and turned toward the face.
    this.panel.position.set(0, 0.07, -0.05);
    this.panel.rotation.x = -Math.PI / 4;
  }

  /** Moves the panel onto a hand. Safe to call again when handedness settles. */
  wear(hand: Object3D | undefined): void {
    if (!hand || this.panel.parent === hand) return;
    hand.add(this.panel);
  }

  /** Shows the menu as it now is. Redraws only when the highlight moved. */
  show(state: AskMenuState): void {
    this.panel.visible = state.open;
    if (!state.open || state.index === this.#drawn) return;
    this.#draw(state.index);
    this.#drawn = state.index;
    this.#texture.needsUpdate = true;
  }

  #draw(highlight: number): void {
    const context = this.#canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "rgba(12, 12, 14, 0.85)";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.textBaseline = "middle";
    context.font = "28px system-ui, sans-serif";
    context.fillStyle = "#8b8f95";
    context.fillText("Ask Faye  ·  stick to choose, trigger to ask", 24, 32);

    context.font = "36px system-ui, sans-serif";
    ASKS.forEach((ask, i) => {
      const y = TOP_PX + i * ROW_PX;
      if (i === highlight) {
        context.fillStyle = "rgba(200, 162, 74, 0.25)";
        context.fillRect(12, y, WIDTH - 24, ROW_PX - 8);
      }
      // The highlight is a mark AND a colour, never colour alone.
      context.fillStyle = i === highlight ? "#c8a24a" : "#cfd2d6";
      context.fillText(`${i === highlight ? "▸ " : "  "}${ask.label}`, 24, y + (ROW_PX - 8) / 2);
    });
  }

  dispose(): void {
    this.panel.removeFromParent();
    this.#texture.dispose();
    (this.panel.material as MeshBasicMaterial).dispose();
    this.panel.geometry.dispose();
  }
}
