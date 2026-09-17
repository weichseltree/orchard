import { Vector3, type PerspectiveCamera } from "three";
import type { Body } from "../control/locomotion";
import { gazeBlock, layoutRepoModel, type RepoBlock } from "../world/repo-model";
import { roomById, type Mansion, type RepoModel, type Room } from "../world/schema";

// What the eye rests on at a repository model (world/repo-model.ts): a
// folder's path, its sentence and the room it has, under the crosshair.
// Loaded, with the layout, only once a room with a model is entered.

/** How far beyond the model's own half-diagonal counts as standing at it: an arm and a step. */
const REACH_M = 1.6;
/** The gaze is re-read a few times a second, not every frame. */
const PERIOD_MS = 150;

export function attachModelReader(root: HTMLElement, mansion: Mansion, body: Body, camera: PerspectiveCamera): (room: Room | undefined) => void {
  const panel = document.createElement("div");
  panel.className = "model-reading panel";
  panel.hidden = true;
  panel.setAttribute("aria-live", "polite");
  root.append(panel);
  const line = (className: string, text: string): HTMLElement => {
    const element = document.createElement("span");
    element.className = className;
    element.textContent = text;
    return element;
  };
  const layouts = new WeakMap<RepoModel, RepoBlock[]>();
  const eye = new Vector3();
  const gaze = new Vector3();
  let shown: RepoBlock | null = null;
  let next = 0;
  return (room) => {
    const now = performance.now();
    if (now < next) return;
    next = now + PERIOD_MS;
    let found: RepoBlock | null = null;
    for (const model of room?.repoModels ?? []) {
      const reach = Math.hypot(model.size[0], model.size[1]) / 2 + REACH_M;
      if (Math.hypot(model.position[0] - body.x, model.position[2] - body.z) > reach) continue;
      let blocks = layouts.get(model);
      if (!blocks) layouts.set(model, blocks = layoutRepoModel(model));
      camera.getWorldPosition(eye);
      camera.getWorldDirection(gaze);
      found = gazeBlock(model, blocks, eye, gaze);
      if (found) break;
    }
    if (found === shown) return;
    shown = found;
    panel.hidden = found === null;
    if (!found) return;
    const roomTitle = found.room ? roomById(mansion, found.room)?.title || found.room : "";
    panel.replaceChildren(
      line("model-path", `${found.path}/`),
      ...(found.sentence ? [line("model-sentence", found.sentence)] : []),
      ...(roomTitle ? [line("model-room", `has a room: ${roomTitle}`)] : []),
    );
  };
}
