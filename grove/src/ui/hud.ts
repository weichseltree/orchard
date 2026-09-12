import { SPEEDS, type Speed } from "../tape/time";

// The HUD: dark, small, and out of the way. Everything it shows is either a
// number the visitor asked for or a failure they need to know about. No
// counters on the world itself (LAWS 7): this is chrome, not scenery.

/** Someone in the room, as the people panel lists them. */
export interface HudPerson {
  identity: string;
  name: string;
  host: boolean;
  muted: boolean;
}

/** What a host can do to someone from the people panel (presence.Moderation). */
export type HudModeration =
  | { kind: "mute"; muted: boolean }
  | { kind: "kick" }
  | { kind: "ban"; minutes: number; network: boolean; reason: string };

/** How long a ban from the panel lasts; 0 is for good, as the server has it. */
const BAN_CHOICES: Array<[string, number]> = [
  ["1 hour", 60],
  ["1 day", 1440],
  ["30 days", 43200],
  ["for good", 0],
];

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
  /** Resolves when the server took the new name. */
  onRename(name: string): Promise<void>;
  /** A host's mute, kick or ban; the server refuses it from anyone else. */
  onModerate(identity: string, action: HudModeration): Promise<void>;
}

export class Hud {
  readonly root: HTMLElement;
  readonly provenancePanel: HTMLElement;

  #status: HTMLElement;
  #here: HTMLButtonElement;
  #people: HTMLElement;
  #peopleList: HTMLElement;
  #peopleKey = "";
  #peopleNow: HudPerson[] = [];
  /** An open form in the list (a report, a ban): re-renders wait until it closes. */
  #form: { identity: string; kind: "report" | "ban" } | null = null;
  #me: HTMLElement;
  #meHost: HTMLElement;
  #nameInput: HTMLInputElement;
  #amHost = false;
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
    this.#me = span("me");
    this.#meHost = span("host-tag");
    this.#meHost.textContent = "host";
    this.#meHost.hidden = true;
    this.#here = button("1 here", "here", () => this.#togglePeople());
    this.#here.setAttribute("aria-expanded", "false");
    this.#here.title = "Who is here";
    this.#link = span("link");
    this.#status.append(this.#me, this.#meHost, this.#here, document.createTextNode(" "), this.#link);
    topLeft.append(this.#status);

    // Who is here, with a way to flag someone to the host, and for a host the
    // means to act on it. Everything in it is textContent: names come from
    // other people.
    this.#people = div("people panel");
    this.#people.hidden = true;
    const you = document.createElement("form");
    you.className = "you-form";
    const youLabel = span("you-label");
    youLabel.textContent = "Your name";
    this.#nameInput = document.createElement("input");
    this.#nameInput.type = "text";
    this.#nameInput.maxLength = 24;
    this.#nameInput.setAttribute("aria-label", "Your name");
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn small";
    save.textContent = "Save";
    you.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = this.#nameInput.value.trim();
      if (!name) return;
      save.disabled = true;
      this.#callbacks
        .onRename(name)
        .catch(() => undefined) // the reason is on the notice board
        .finally(() => {
          save.disabled = false;
          this.#nameInput.blur();
        });
    });
    you.append(youLabel, this.#nameInput, save);
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
    const impressum = document.createElement("a");
    impressum.href = "/impressum/";
    impressum.target = "_blank";
    impressum.rel = "noopener";
    impressum.textContent = "Impressum";
    footer.append(privacy, " · ", impressum);
    this.#people.append(you, heading, this.#peopleList, footer);
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

  /** Ourselves: the name the server kept, and whether we are a host. */
  setMe(me: { name: string; host: boolean } | null, fallbackName: string): void {
    const name = me?.name || fallbackName;
    if (this.#me.textContent !== name) this.#me.textContent = name;
    this.#me.hidden = !name;
    if (document.activeElement !== this.#nameInput && this.#nameInput.value !== name) this.#nameInput.value = name;
    const host = me?.host ?? false;
    this.#meHost.hidden = !host;
    if (host !== this.#amHost) {
      this.#amHost = host;
      if (!this.#people.hidden && this.#form === null) this.#renderPeople();
    }
  }

  /** The people in the room besides the visitor. Cheap to call on every change. */
  setPeople(people: Iterable<HudPerson>): void {
    const list = [...people].sort((a, b) => a.name.localeCompare(b.name));
    const key = list.map((p) => `${p.identity}:${p.name}:${p.host ? 1 : 0}:${p.muted ? 1 : 0}`).join("|");
    if (key === this.#peopleKey) return;
    this.#peopleKey = key;
    this.#peopleNow = list;
    // Never pull a half-typed report or ban out from under the visitor.
    if (!this.#people.hidden && this.#form === null) this.#renderPeople();
  }

  #togglePeople(): void {
    this.#people.hidden = !this.#people.hidden;
    this.#here.setAttribute("aria-expanded", String(!this.#people.hidden));
    if (!this.#people.hidden) {
      this.#form = null;
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
        row.append(tag("host", "person-host"));
      } else {
        if (person.muted && this.#amHost) row.append(tag("muted", "person-muted"));
        const open = this.#form?.identity === person.identity ? this.#form.kind : null;
        if (open === "report") row.append(this.#reportForm(person));
        else if (open === "ban") row.append(this.#banForm(person));
        else row.append(...this.#actions(person));
      }
      rows.push(row);
    }
    this.#peopleList.replaceChildren(...rows);
    this.#peopleList.querySelector<HTMLInputElement>("form input[type=text]")?.focus();
  }

  #actions(person: HudPerson): HTMLElement[] {
    const openForm = (kind: "report" | "ban") => () => {
      this.#form = { identity: person.identity, kind };
      this.#renderPeople();
    };
    const buttons = [button("Report", "btn small", openForm("report"))];
    if (!this.#amHost) return buttons;
    const act = (label: string, action: HudModeration, cls = "btn small") =>
      button(label, cls, () => {
        void this.#callbacks.onModerate(person.identity, action).catch(() => undefined);
      });
    return [
      act(person.muted ? "Unmute" : "Mute", { kind: "mute", muted: !person.muted }),
      act("Kick", { kind: "kick" }, "btn small danger"),
      button("Ban…", "btn small danger", openForm("ban")),
      ...buttons,
    ];
  }

  #closeForm(): void {
    this.#form = null;
    this.#renderPeople();
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
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      send.disabled = true;
      this.#callbacks
        .onReport(person.identity, reason.value.trim())
        .then(() => this.#closeForm())
        .catch(() => {
          send.disabled = false; // the reason is on the notice board; let them try again
        });
    });
    form.append(reason, send, button("Cancel", "btn small", () => this.#closeForm()));
    return form;
  }

  /** How long, whether the whole network, and a reason only hosts will read. */
  #banForm(person: HudPerson): HTMLElement {
    const form = document.createElement("form");
    form.className = "report-form ban-form";
    const length = document.createElement("select");
    length.setAttribute("aria-label", `How long to ban ${person.name}`);
    for (const [label, minutes] of BAN_CHOICES) {
      const option = document.createElement("option");
      option.value = String(minutes);
      option.textContent = label;
      length.append(option);
    }
    length.value = "1440";
    const network = document.createElement("label");
    network.className = "ban-network";
    const box = document.createElement("input");
    box.type = "checkbox";
    network.append(box, " their whole network");
    const reason = document.createElement("input");
    reason.type = "text";
    reason.maxLength = 280;
    reason.placeholder = "Reason (hosts only)";
    reason.setAttribute("aria-label", "Reason for the ban");
    const confirm = document.createElement("button");
    confirm.type = "submit";
    confirm.className = "btn small danger";
    confirm.textContent = "Ban";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      confirm.disabled = true;
      const action: HudModeration = {
        kind: "ban",
        minutes: Number(length.value),
        network: box.checked,
        reason: reason.value.trim(),
      };
      this.#callbacks
        .onModerate(person.identity, action)
        .then(() => this.#closeForm())
        .catch(() => {
          confirm.disabled = false;
        });
    });
    form.append(reason, length, network, confirm, button("Cancel", "btn small", () => this.#closeForm()));
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
    // Offers stay put; only plain notices make room for newer ones.
    const plain = this.#notices.querySelectorAll(".notice:not(.offer)");
    for (let i = 0; i < plain.length - 4; i++) plain[i]?.remove();
  }

  /** A notice with one action, up until the action is taken. The element tells whether it still is. */
  offer(text: string, label: string, onAction: () => void): HTMLElement {
    const element = div("notice panel offer");
    element.append(`${text} `, button(label, "btn small", onAction));
    this.#notices.append(element);
    return element;
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

function tag(text: string, className: string): HTMLElement {
  const element = span(className);
  element.textContent = text;
  return element;
}
