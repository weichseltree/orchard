import "./game-surface.css";
import type { GameSurface as GameSurfaceConfig } from "../world/schema";
import {
  gameLifecycleEvent,
  gameSurfaceUrl,
  type GameLifecycleEvent,
} from "../world/game-surface";

export interface GameSurfaceSnapshot {
  id: string | null;
  open: boolean;
  lastEvent: GameLifecycleEvent["event"] | null;
}

export class GameSurface {
  #dialog = document.createElement("dialog");
  #title = document.createElement("h1");
  #status = document.createElement("p");
  #frame: HTMLIFrameElement | null = null;
  #origin: string | null = null;
  #id: string | null = null;
  #lastEvent: GameLifecycleEvent["event"] | null = null;
  #readyTimer: number | null = null;
  #returnFocus: HTMLElement | null = null;
  #onLifecycle: (event: GameLifecycleEvent) => void;
  #onClose: () => void;

  constructor(
    root: HTMLElement,
    options: {
      onLifecycle?: (event: GameLifecycleEvent) => void;
      onClose?: () => void;
    } = {},
  ) {
    this.#onLifecycle = options.onLifecycle ?? (() => undefined);
    this.#onClose = options.onClose ?? (() => undefined);
    this.#dialog.className = "game-surface";
    this.#dialog.setAttribute("aria-labelledby", "game-surface-title");
    this.#dialog.setAttribute("aria-describedby", "game-surface-status");
    this.#title.id = "game-surface-title";
    this.#title.className = "game-surface-title";
    this.#status.id = "game-surface-status";
    this.#status.className = "game-surface-status";
    this.#status.setAttribute("aria-live", "polite");

    const heading = document.createElement("div");
    heading.append(this.#title, this.#status);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn game-surface-close";
    close.textContent = "Close";
    close.addEventListener("click", () => this.close());
    const header = document.createElement("header");
    header.className = "game-surface-header";
    header.append(heading, close);
    this.#dialog.append(header);
    this.#dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.close();
    });
    this.#dialog.addEventListener("close", () => this.#closed());
    window.addEventListener("message", this.#message);
    root.append(this.#dialog);
  }

  open(surface: GameSurfaceConfig, returnFocus: HTMLElement | null = null): void {
    const url = gameSurfaceUrl(surface, location.origin);
    this.close();
    this.#id = surface.id;
    this.#origin = url.origin;
    this.#lastEvent = null;
    this.#returnFocus = returnFocus;
    this.#title.textContent = surface.title;
    this.#status.textContent = "Opening the game…";
    const frame = document.createElement("iframe");
    frame.className = "game-surface-frame";
    frame.title = surface.title;
    frame.src = url.href;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow = "fullscreen";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-pointer-lock");
    this.#frame = frame;
    this.#dialog.append(frame);
    this.#dialog.showModal();
    this.#readyTimer = window.setTimeout(() => {
      this.#status.textContent = "The game did not answer. Close it and try again later.";
    }, 10_000);
  }

  close(): void {
    if (this.#dialog.open) this.#dialog.close();
    else this.#teardownFrame();
  }

  snapshot(): GameSurfaceSnapshot {
    return { id: this.#id, open: this.#dialog.open, lastEvent: this.#lastEvent };
  }

  dispose(): void {
    window.removeEventListener("message", this.#message);
    this.close();
    this.#dialog.remove();
  }

  #message = (message: MessageEvent): void => {
    if (!this.#frame || !this.#origin) return;
    const event = gameLifecycleEvent(message, this.#origin, this.#frame.contentWindow);
    if (!event) return;
    if (this.#readyTimer !== null) {
      window.clearTimeout(this.#readyTimer);
      this.#readyTimer = null;
    }
    this.#lastEvent = event.event;
    this.#status.textContent = statusFor(event);
    this.#onLifecycle(event);
  };

  #closed(): void {
    this.#teardownFrame();
    this.#onClose();
    this.#returnFocus?.focus();
    this.#returnFocus = null;
  }

  #teardownFrame(): void {
    if (this.#readyTimer !== null) window.clearTimeout(this.#readyTimer);
    this.#readyTimer = null;
    this.#frame?.remove();
    this.#frame = null;
    this.#origin = null;
    this.#id = null;
  }
}

function statusFor(event: GameLifecycleEvent): string {
  switch (event.event) {
    case "ready": return "Game ready";
    case "screen": return "Game screen changed";
    case "game-started": return "Game started";
    case "game-ended": return "Game ended";
  }
}
