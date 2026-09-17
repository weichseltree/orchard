// What the eye rests on at a repository model (world/repo-model.ts): a
// folder's path, its sentence, and the room it has, under the crosshair.
// Loaded with the model's layout, only in a room that has a model.

export interface ModelReading {
  set(state: { path: string; sentence: string; room: string } | null): void;
}

export function attachModelReading(root: HTMLElement): ModelReading {
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
  return {
    set(state) {
      panel.hidden = state === null;
      if (!state) return;
      panel.replaceChildren(
        line("model-path", `${state.path}/`),
        ...(state.sentence ? [line("model-sentence", state.sentence)] : []),
        ...(state.room ? [line("model-room", `has a room: ${state.room}`)] : []),
      );
    },
  };
}
