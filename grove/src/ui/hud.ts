import { SPEEDS, type Speed } from "../tape/time";

// The HUD: dark, small, and out of the way. Everything it shows is either a
// number the visitor asked for or a failure they need to know about. No
// counters on the world itself (LAWS 7): this is chrome, not scenery.

export interface HudCallbacks {
  onEnterVr(): void;
  onTogglePlay(): void;
  onScrub(fraction: number): void;
  onScrubEnd(): void;
  onSpeed(speed: Speed): void;
  onUnmute(): void;
  onProvenance(): void;
}

export class Hud {
  readonly root: HTMLElement;
  readonly provenancePanel: HTMLElement;

  #status: HTMLElement;
  #here: HTMLElement;
  #link: HTMLElement;
  #notices: HTMLElement;
  #hint: HTMLElement;
  #vrButton: HTMLButtonElement;
  #unmuteButton: HTMLButtonElement;
  #scrubber: HTMLElement;
  #playButton: HTMLButtonElement;
  #slider: HTMLInputElement;
  #time: HTMLElement;
  #speed: HTMLSelectElement;
  #perf: HTMLElement;
  #scrubbing = false;

  constructor(root: HTMLElement, callbacks: HudCallbacks) {
    this.root = root;
    root.innerHTML = "";

    const topLeft = div("top-left");
    this.#status = div("status panel");
    this.#here = span("here");
    this.#link = span("link");
    this.#status.append(this.#here, document.createTextNode(" "), this.#link);
    topLeft.append(this.#status);
    root.append(topLeft);

    const topRight = div("top-right");
    this.#vrButton = button("Enter VR", "btn accent", callbacks.onEnterVr);
    this.#vrButton.hidden = true;
    this.#unmuteButton = button("Unmute", "btn", callbacks.onUnmute);
    this.#unmuteButton.hidden = true;
    const provenanceButton = button("Provenance (P)", "btn", callbacks.onProvenance);
    const home = document.createElement("a");
    home.className = "btn";
    home.href = "/";
    home.textContent = "Leave";
    topRight.append(this.#vrButton, this.#unmuteButton, provenanceButton, home);
    root.append(topRight);

    this.#notices = div("notices");
    root.append(this.#notices);

    this.#hint = div("hint panel");
    this.#hint.hidden = true;
    root.append(this.#hint);

    this.#scrubber = div("scrubber panel");
    this.#scrubber.hidden = true;
    this.#playButton = button("Pause", "btn", callbacks.onTogglePlay);
    this.#slider = document.createElement("input");
    this.#slider.type = "range";
    this.#slider.min = "0";
    this.#slider.max = "1000";
    this.#slider.value = "0";
    this.#slider.setAttribute("aria-label", "tape time");
    this.#slider.addEventListener("input", () => {
      this.#scrubbing = true;
      callbacks.onScrub(Number(this.#slider.value) / 1000);
    });
    const endScrub = (): void => {
      if (!this.#scrubbing) return;
      this.#scrubbing = false;
      callbacks.onScrubEnd();
    };
    this.#slider.addEventListener("change", endScrub);
    this.#slider.addEventListener("pointerup", endScrub);
    this.#time = span("time");
    this.#speed = document.createElement("select");
    this.#speed.setAttribute("aria-label", "playback speed");
    for (const speed of SPEEDS) {
      const option = document.createElement("option");
      option.value = String(speed);
      option.textContent = `${speed}x`;
      if (speed === 1) option.selected = true;
      this.#speed.append(option);
    }
    this.#speed.addEventListener("change", () => {
      callbacks.onSpeed(Number(this.#speed.value) as Speed);
    });
    this.#scrubber.append(this.#playButton, this.#slider, this.#time, this.#speed);
    root.append(this.#scrubber);

    this.provenancePanel = div("provenance panel");
    this.provenancePanel.hidden = true;
    root.append(this.provenancePanel);

    this.#perf = div("perf panel");
    this.#perf.hidden = true;
    root.append(this.#perf);
  }

  setHere(count: number): void {
    this.#here.textContent = count === 1 ? "1 here" : `${count} here`;
  }

  setLink(text: string, bad = false): void {
    this.#link.textContent = text;
    this.#link.classList.toggle("bad", bad);
  }

  setXrAvailable(available: boolean): void {
    this.#vrButton.hidden = !available;
  }

  setUnmuteAvailable(available: boolean): void {
    this.#unmuteButton.hidden = !available;
  }

  setHint(text: string | null): void {
    this.#hint.textContent = text ?? "";
    this.#hint.hidden = text === null;
  }

  setScrubberVisible(visible: boolean): void {
    this.#scrubber.hidden = !visible;
  }

  setPlaying(playing: boolean): void {
    this.#playButton.textContent = playing ? "Pause" : "Play";
  }

  setSpeed(speed: Speed): void {
    this.#speed.value = String(speed);
  }

  /**
   * Called every frame; skipped while a finger is on the slider. A null label
   * leaves the readout alone, so the caller can skip building a string when
   * nothing it would say has changed.
   */
  setProgress(fraction: number, label: string | null): void {
    if (!this.#scrubbing) {
      const value = String(Math.round(fraction * 1000));
      if (value !== this.#slider.value) this.#slider.value = value;
    }
    if (label !== null) this.#time.textContent = label;
  }

  setPerf(lines: string | null): void {
    this.#perf.hidden = lines === null;
    if (lines !== null) this.#perf.textContent = lines;
  }

  /** A short-lived line. Failures stay until something replaces them. */
  notice(text: string, sticky = false): void {
    const element = div("notice panel");
    element.textContent = text;
    this.#notices.append(element);
    if (!sticky) window.setTimeout(() => element.remove(), 9000);
    while (this.#notices.childElementCount > 4) this.#notices.firstElementChild?.remove();
  }
}

function div(className: string): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  return element;
}

function span(className: string): HTMLElement {
  const element = document.createElement("span");
  element.className = className;
  return element;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.className = className;
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}
