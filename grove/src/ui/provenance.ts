import {
  Box3,
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Ray,
  SRGBColorSpace,
  Vector3,
  type PerspectiveCamera,
} from "three";
import { PALETTE } from "../config";

// "Every asset the app loads carries provenance" (M0 §7). P, or the VR menu
// button, answers the question "what am I looking at, and where did it come
// from?" for whatever the visitor is aimed at — the tape's bundle.json, the
// video bundle, the hall's glb extras.
//
// Outside XR the answer is a DOM panel. Inside XR the DOM is invisible, so the
// same text is drawn into a canvas and hung in front of the visitor.

export interface ProvenanceTarget {
  id: string;
  title: string;
  /** World-space box the ray has to hit. */
  bounds: Box3;
  /**
   * Lower wins when two boxes are both in the way. An exhibit is what you
   * meant; the room it hangs in is the answer only when nothing is in view.
   */
  rank?: number;
  read(): Record<string, unknown>;
}

export class Provenance {
  readonly panel: Mesh;
  open = false;

  #targets: ProvenanceTarget[] = [];
  #dom: HTMLElement;
  #canvas: HTMLCanvasElement;
  #texture: CanvasTexture;
  #ray = new Ray();
  #direction = new Vector3();
  #origin = new Vector3();
  #hit = new Vector3();
  #current: ProvenanceTarget | null = null;

  constructor(dom: HTMLElement) {
    this.#dom = dom;
    this.#canvas = document.createElement("canvas");
    this.#canvas.width = 1024;
    this.#canvas.height = 640;
    this.#texture = new CanvasTexture(this.#canvas);
    this.#texture.colorSpace = SRGBColorSpace;
    this.panel = new Mesh(
      new PlaneGeometry(0.72, 0.45),
      new MeshBasicMaterial({ map: this.#texture, transparent: true, side: DoubleSide }),
    );
    this.panel.name = "provenance-panel";
    this.panel.visible = false;
    this.panel.renderOrder = 10;
  }

  register(target: ProvenanceTarget): void {
    this.#targets = this.#targets.filter((t) => t.id !== target.id);
    this.#targets.push(target);
  }

  unregister(id: string): void {
    this.#targets = this.#targets.filter((t) => t.id !== id);
    if (this.#current?.id === id) this.close();
  }

  clear(): void {
    this.#targets = [];
    this.close();
  }

  /** What the camera is aimed at: the nearest box the view ray enters. */
  pick(camera: PerspectiveCamera): ProvenanceTarget | null {
    camera.getWorldPosition(this.#origin);
    camera.getWorldDirection(this.#direction);
    this.#ray.set(this.#origin, this.#direction);
    let best: ProvenanceTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestRank = Number.POSITIVE_INFINITY;
    let containing: ProvenanceTarget | null = null;
    for (const target of this.#targets) {
      if (target.bounds.containsPoint(this.#origin)) {
        // Standing inside the hall does not mean the hall is what you look at,
        // but it is the honest answer when nothing else is in the way.
        containing = containing ?? target;
        continue;
      }
      const point = this.#ray.intersectBox(target.bounds, this.#hit);
      if (!point) continue;
      const rank = target.rank ?? 0;
      const distance = point.distanceTo(this.#origin);
      if (rank < bestRank || (rank === bestRank && distance < bestDistance)) {
        bestRank = rank;
        bestDistance = distance;
        best = target;
      }
    }
    return best ?? containing;
  }

  toggle(camera: PerspectiveCamera): void {
    if (this.open) this.close();
    else this.show(camera);
  }

  show(camera: PerspectiveCamera): void {
    const target = this.pick(camera);
    this.#current = target;
    this.open = true;
    const entries = target ? flatten(target.read()) : [["", "nothing in view"] as const];
    const title = target?.title ?? "Provenance";
    this.#renderDom(title, entries);
    this.#renderCanvas(title, entries);
    this.#dom.hidden = false;
  }

  close(): void {
    this.open = false;
    this.#current = null;
    this.#dom.hidden = true;
    this.panel.visible = false;
  }

  /** Keeps the XR panel in front of the head; a no-op outside XR. */
  update(camera: PerspectiveCamera, presenting: boolean): void {
    this.#dom.hidden = !this.open || presenting;
    this.panel.visible = this.open && presenting;
    if (!this.panel.visible) return;
    camera.getWorldPosition(this.#origin);
    camera.getWorldDirection(this.#direction);
    this.panel.position.copy(this.#origin).addScaledVector(this.#direction, 0.85);
    this.panel.quaternion.copy(camera.getWorldQuaternion(this.panel.quaternion));
  }

  dispose(): void {
    this.#texture.dispose();
    this.panel.geometry.dispose();
    (this.panel.material as MeshBasicMaterial).dispose();
  }

  #renderDom(title: string, entries: ReadonlyArray<readonly [string, string]>): void {
    this.#dom.innerHTML = "";
    const heading = document.createElement("h2");
    heading.textContent = title;
    const list = document.createElement("dl");
    for (const [key, value] of entries) {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = value;
      list.append(dt, dd);
    }
    this.#dom.append(heading, list);
  }

  #renderCanvas(title: string, entries: ReadonlyArray<readonly [string, string]>): void {
    const ctx = this.#canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = this.#canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(14,19,16,0.94)";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(217,226,218,0.22)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, width - 3, height - 3);
    ctx.font = "600 34px system-ui, sans-serif";
    ctx.fillStyle = PALETTE.accent;
    ctx.fillText(title.slice(0, 42), 28, 56);
    let y = 112;
    ctx.font = "24px system-ui, sans-serif";
    for (const [key, value] of entries) {
      if (y > height - 28) break;
      ctx.fillStyle = PALETTE.dim;
      ctx.fillText(`${key}`.slice(0, 26), 28, y);
      ctx.fillStyle = PALETTE.text;
      for (const line of wrap(value, 44).slice(0, 2)) {
        ctx.fillText(line, 320, y);
        y += 30;
      }
      y += 4;
    }
    this.#texture.needsUpdate = true;
  }
}

/** Nested provenance flattens to "source.tree_commit" style keys. */
function flatten(
  value: Record<string, unknown>,
  prefix = "",
  out: Array<readonly [string, string]> = [],
): Array<readonly [string, string]> {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      flatten(entry as Record<string, unknown>, path, out);
    } else {
      out.push([path, Array.isArray(entry) ? entry.join(", ") : String(entry)]);
    }
  }
  return out;
}

function wrap(text: string, columns: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length + word.length + 1 > columns) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
