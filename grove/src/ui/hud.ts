import { SPEEDS, type Speed } from "../tape/time";

// The HUD: dark, small, and out of the way. Everything it shows is either a
// number the visitor asked for or a failure they need to know about. No
// counters on the world itself (LAWS 7): this is chrome, not scenery.

/** Someone in the room, as the people panel lists them. */
export interface HudPerson {
  identity: string;
  name: string;
  host: boolean;
}

export interface HudCallbacks {
  onEnterVr(): void;
  onTogglePlay(): void;
  onScrub(fraction: number): void;
  onScrubEnd(): void;
  onSpeed(speed: Speed): void;
  onUnmute(): void;
  onProvenance(): void;
  /** Resolves when the server took the report; rejects with its reason. */
  onReport(identity: string, reason: string): Promise<void>;
}

export class Hud {
  readonly root: HTMLElement;
  readonly provenancePanel: HTMLElement;

  #status: HTMLElement;
  #here: HTMLButtonElement;
  #people: HTMLElement;
  #peopleList: HTMLElement;
  #peopleKey = "";
  #reporting: string | null = null;
  #callbacks: HudCallbacks;
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
    this.#callbacks = callbacks;
    root.innerHTML = "";

    const topLeft = div("top-left");
    this.#status = div("status panel");
    this.#here = button("1 here", "here", () => this.#togglePeople());
    this.#here.setAttribute("aria-expanded", "false");
    this.#here.title = "Who is here";
    this.#link = span("link");
    this.#status.append(this.#here, document.createTextNode(" "), this.#link);
    topLeft.append(this.#status);

    // Who is here, with a way to flag someone to the host. Everything in it
    // is textContent: names come from other people.
    this.#people = div("people panel");
    this.#people.hidden = true;
    const heading = document.createElement("h2");
    heading.textContent = "Here with you";
    this.#peopleList = div("people-list");
    const footer = document.createElement("p");
    footer.className = "people-foot";
    footer.append("Reports go to the orchard's host with the person's last lines of chat. ");
    const privacy = document.createElement("a");
    privacy.href = "/privacy/";
    privacy.target = "_blank";
    privacy.rel = "noopener";
    privacy.textContent = "Privacy";
    footer.append(privacy);
    this.#people.append(heading, this.#peopleList, footer);
    topLeft.append(this.#people);
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
    const text = count === 1 ? "1 here" : `${count} here`;
    if (this.#here.textContent !== text) this.#here.textContent = text;
  }

  /** The people in the room besides the visitor. Cheap to call on every change. */
  setPeople(people: Iterable<HudPerson>): void {
    const list = [...people].sort((a, b) => a.name.localeCompare(b.name));
    const key = list.map((p) => `${p.identity}:${p.name}:${p.host ? 1 : 0}`).join("|");
    if (key === this.#peopleKey) return;
    this.#peopleKey = key;
    this.#peopleNow = list;
    // Never pull a half-typed report out from under the visitor.
    if (!this.#people.hidden && this.#reporting === null) this.#renderPeople();
  }

  #peopleNow: HudPerson[] = [];

  #togglePeople(): void {
    this.#people.hidden = !this.#people.hidden;
    this.#here.setAttribute("aria-expanded", String(!this.#people.hidden));
    if (!this.#people.hidden) {
      this.#reporting = null;
      this.#renderPeople();
    }
  }

  #renderPeople(): void {
    const rows: HTMLElement[] = [];
    if (this.#peopleNow.length === 0) {
      const empty = div("people-empty");
      empty.textContent = "Nobody else is here.";
      rows.push(empty);
    }
    for (const person of this.#peopleNow) {
      const row = div("person");
      const name = span("person-name");
      name.textContent = person.name || "visitor";
      row.append(name);
      if (person.host) {
        const tag = span("person-host");
        tag.textContent = "host";
        row.append(tag);
      } else if (this.#reporting === person.identity) {
        row.append(this.#reportForm(person));
      } else {
        row.append(button("Report", "btn small", () => {
          this.#reporting = person.identity;
          this.#renderPeople();
        }));
      }
      rows.push(row);
    }
    this.#peopleList.replaceChildren(...rows);
    this.#peopleList.querySelector<HTMLInputElement>("input")?.focus();
  }

  #reportForm(person: HudPerson): HTMLElement {
    const form = document.createElement("form");
    form.className = "report-form";
    const reason = document.createElement("input");
    reason.type = "text";
    reason.maxLength = 280;
    reason.placeholder = "What happened?";
    reason.setAttribute("aria-label", `Why report ${person.name}`);
    const send = document.createElement("button");
    send.type = "submit";
    send.className = "btn small accent";
    send.textContent = "Send";
    const cancel = button("Cancel", "btn small", () => {
      this.#reporting = null;
      this.#renderPeople();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      send.disabled = true;
      this.#callbacks
        .onReport(person.identity, reason.value.trim())
        .then(() => {
          this.#reporting = null;
          this.#renderPeople();
        })
        .catch(() => {
          send.disabled = false; // the reason is on the notice board; let them try again
        });
    });
    form.append(reason, send, cancel);
    return form;
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
