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

/** The phone dock's tabs, in order; Leave is a link and is added after them. */
export type DockTab = "guide" | "sources" | "people" | "chat";

// Line icons from the overlay redesign (Claude Design handoff, "weichselmind
// Overlays"). Static markup, never built from data.
const ICONS: Record<DockTab | "leave", string> = {
  guide: '<circle cx="10" cy="10" r="7.2"></circle><path d="M10 6.4v.1M10 9v4.6"></path>',
  sources: '<rect x="3.2" y="3.2" width="13.6" height="13.6"></rect><path d="M6.4 7.6h7.2M6.4 10.4h7.2M6.4 13.2h4"></path>',
  people: '<circle cx="7.6" cy="8" r="3"></circle><circle cx="13.4" cy="9.4" r="2.2"></circle><path d="M2.8 16.4c.8-2.6 2.5-3.9 4.8-3.9s4 1.3 4.8 3.9"></path>',
  chat: '<path d="M3.2 4h13.6v9.2H8.4L4.6 16.4v-3.2H3.2z"></path>',
  leave: '<path d="M8 4H4v12h4M9.6 10h7.2M14 7l3 3-3 3"></path>',
};

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
  /** A planet's display mode was chosen. */
  onAtlas(mode: string): void;
  onUnmute(): void;
  onProvenance(): void;
  /** The plan of this area's rooms. */
  onMap(): void;
  /** The dock's Guide tab (phones): the same dialog the top bar opens. */
  onGuide(): void;
  /** The dock's Chat tab: fold the room chat away or bring it back. */
  onToggleChat(): void;
  /** The game whose table the visitor stands at. */
  onOpenGame(): void;
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
  #gameOffer: HTMLElement;
  #gameButton: HTMLButtonElement;
  #gameKey: HTMLElement;
  #vrButton: HTMLButtonElement;
  #unmuteButton: HTMLButtonElement;
  #scrubber: HTMLElement;
  #playButton: HTMLButtonElement;
  #slider: HTMLInputElement;
  #time: HTMLElement;
  #speed: HTMLSelectElement;
  #atlas: HTMLElement;
  #atlasButtons: HTMLElement;
  #legend: HTMLImageElement;
  #onAtlas: (mode: string) => void;
  #perf: HTMLElement;
  #dock = new Map<DockTab, HTMLButtonElement>();
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

    const topRight = div("top-right panel");
    this.#vrButton = button("Enter VR", "btn accent", callbacks.onEnterVr);
    this.#vrButton.hidden = true;
    this.#unmuteButton = button("Sound on", "btn", callbacks.onUnmute);
    this.#unmuteButton.hidden = true;
    const provenanceButton = button("About this view", "btn hud-sources", callbacks.onProvenance);
    provenanceButton.title = "Where this view came from (P)";
    const home = document.createElement("a");
    home.className = "btn hud-leave";
    home.href = "/";
    home.textContent = "Leave";
    const mapButton = button("Map", "btn", callbacks.onMap);
    mapButton.title = "Plan of the rooms (L)";
    topRight.append(this.#vrButton, this.#unmuteButton, mapButton, provenanceButton, home);
    root.append(topRight);

    this.#notices = div("notices");
    this.#notices.setAttribute("role", "status");
    this.#notices.setAttribute("aria-live", "polite");
    this.#notices.setAttribute("aria-relevant", "additions");
    root.append(this.#notices);

    this.#hint = div("hint panel");
    this.#hint.hidden = true;
    root.append(this.#hint);

    // The game at the table the visitor stands at (main.ts offers it).
    this.#gameOffer = div("game-offer panel");
    this.#gameOffer.hidden = true;
    this.#gameButton = button("Play", "btn accent", callbacks.onOpenGame);
    this.#gameKey = span("game-key");
    this.#gameOffer.append(this.#gameButton, this.#gameKey);
    root.append(this.#gameOffer);

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

    // A planet's display modes, with the legend of the one showing; where the
    // scrubber would be, because a planet has play and pause but no slider.
    this.#onAtlas = callbacks.onAtlas;
    this.#atlas = div("atlas panel");
    this.#atlas.hidden = true;
    this.#atlasButtons = div("atlas-modes");
    this.#atlasButtons.setAttribute("role", "group");
    this.#atlasButtons.setAttribute("aria-label", "what the worlds show (C cycles)");
    this.#legend = document.createElement("img");
    this.#legend.className = "atlas-legend";
    this.#legend.alt = "";
    this.#legend.hidden = true;
    this.#atlas.append(this.#atlasButtons, this.#legend);
    root.append(this.#atlas);

    this.provenancePanel = div("provenance panel");
    this.provenancePanel.hidden = true;
    root.append(this.provenancePanel);

    this.#perf = div("perf panel");
    this.#perf.setAttribute("role", "region");
    this.#perf.setAttribute("aria-label", "Rendering performance");
    this.#perf.tabIndex = 0;
    this.#perf.hidden = true;
    root.append(this.#perf);

    // Phones: one dock along the bottom edge (a rail on the left when the
    // phone is turned), so every panel opens from the same place and nothing
    // sits on top of the walking stick. The CSS shows it on touch screens
    // only; the top bar's buttons stand in for it everywhere else.
    const dock = document.createElement("nav");
    dock.className = "dock";
    dock.setAttribute("aria-label", "Panels");
    const tabs: Array<[DockTab, string, () => void]> = [
      ["guide", "Guide", callbacks.onGuide],
      ["sources", "Sources", callbacks.onProvenance],
      ["people", "People", () => this.#togglePeople()],
      ["chat", "Chat", callbacks.onToggleChat],
    ];
    for (const [id, label, onClick] of tabs) {
      const tab = button("", `dock-tab dock-${id}`, onClick);
      tab.setAttribute("aria-label", label);
      // The guide is a modal dialog: it pops up rather than toggling.
      if (id === "guide") tab.setAttribute("aria-haspopup", "dialog");
      else tab.setAttribute("aria-pressed", "false");
      tab.innerHTML = dockFace(id, label);
      this.#dock.set(id, tab);
      dock.append(tab);
    }
    const leave = document.createElement("a");
    leave.className = "dock-tab dock-leave";
    leave.href = "/";
    leave.setAttribute("aria-label", "Leave");
    leave.innerHTML = dockFace("leave", "Leave");
    dock.append(leave);
    root.append(dock);

    // The phone layouts stack the stick and chat on whatever tape or planet
    // controls are showing, and those change height (a planet's modes wrap,
    // its legend loads), so the CSS reads the height from here.
    if (typeof ResizeObserver !== "undefined") {
      const transport = new ResizeObserver(() => {
        const height = Math.max(this.#scrubber.offsetHeight, this.#atlas.offsetHeight);
        root.style.setProperty("--tape", `${height}px`);
      });
      transport.observe(this.#scrubber);
      transport.observe(this.#atlas);
    }
  }

  /** Marks a dock tab as showing its panel. Cheap to call every frame. */
  setDockOpen(tab: DockTab, open: boolean): void {
    const element = this.#dock.get(tab);
    if (!element) return;
    if (tab === "guide") {
      if (element.hasAttribute("data-open") !== open) element.toggleAttribute("data-open", open);
      return;
    }
    const value = String(open);
    if (element.getAttribute("aria-pressed") !== value) element.setAttribute("aria-pressed", value);
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
    this.setDockOpen("people", !this.#people.hidden);
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

  setMuted(muted: boolean): void {
    this.#unmuteButton.textContent = muted ? "Sound on" : "Sound off";
    this.#unmuteButton.setAttribute("aria-pressed", String(!muted));
  }

  setHint(text: string | null): void {
    this.#hint.textContent = text ?? "";
    this.#hint.hidden = text === null;
  }

  /** Offer the game whose table the visitor stands at, or hide the offer with null. `key` names the key that also opens it. */
  setGameOffer(state: { title: string; key: string | null } | null): void {
    this.#gameOffer.hidden = state === null;
    if (!state) return;
    this.#gameButton.textContent = `Play ${state.title}`;
    this.#gameKey.textContent = state.key ? `or press ${state.key}` : "";
    this.#gameKey.hidden = state.key === null;
  }

  setScrubberVisible(visible: boolean): void {
    this.#scrubber.hidden = !visible;
  }

  setPlaying(playing: boolean): void {
    this.#playButton.textContent = playing ? "Pause" : "Play";
  }

  /**
   * Show a planet's modes, or hide the panel with null. `legend` is the image
   * of the current mode's colour scale, when the bundle has one.
   */
  setAtlas(state: { modes: ReadonlyArray<{ id: string; label: string; title?: string }>; current: string; legend: string | null } | null): void {
    this.#atlas.hidden = state === null;
    if (!state) return;
    this.#atlasButtons.replaceChildren(...state.modes.map((mode) => {
      const element = button(mode.label, "btn small", () => this.#onAtlas(mode.id));
      element.setAttribute("aria-pressed", String(mode.id === state.current));
      if (mode.title) element.title = mode.title;
      return element;
    }));
    if (state.legend) {
      if (this.#legend.src !== state.legend) this.#legend.src = state.legend;
      this.#legend.hidden = false;
    } else {
      this.#legend.hidden = true;
      this.#legend.removeAttribute("src");
    }
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

function dockFace(icon: DockTab | "leave", label: string): string {
  return `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">${ICONS[icon]}</svg><span class="dock-label" aria-hidden="true">${label}</span>`;
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
