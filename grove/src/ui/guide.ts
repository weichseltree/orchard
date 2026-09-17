import "./guide.css";
import type { DeviceProfile } from "../device";
import { demoEnabled } from "../demo";
import { roomById, type GameSurface, type Mansion, type Room } from "../world/schema";
import { evidenceUrl, exhibitContent, RESEARCH_ORDER, researchRooms, roomHref } from "./exhibit-content";

const SEEN_KEY = "orchard.grove.guide-seen";

/** Only offer doors that can actually be walked through. */
export function destinations(mansion: Mansion, room: Room): Room[] {
  const ids = new Set(room.doorways.filter((door) => !door.closed).map((door) => door.to));
  // A portal leads somewhere too, and its far end leads back.
  for (const portal of room.portals) ids.add(portal.to);
  for (const other of mansion.rooms) if (other.portals.some((portal) => portal.to === room.id)) ids.add(other.id);
  return mansion.rooms.filter((candidate) => ids.has(candidate.id));
}

/**
 * The room's guide, as a panel in the HUD's column (hud.ts): non-modal, so
 * the world stays live beside it. The column's header carries its kicker and
 * question; `heading` supplies them.
 */
export class VisitorGuide {
  /** The panel's content; main.ts hands it to the HUD. */
  readonly element = document.createElement("section");
  #location = document.createElement("button");
  #locationKicker = document.createElement("span");
  #locationQuestion = document.createElement("span");
  #heading: readonly [string, string] = ["Guide", ""];
  #intro = document.createElement("p");
  #look = document.createElement("section");
  #observations = document.createElement("ul");
  #limitation = document.createElement("p");
  #evidence = document.createElement("details");
  #evidenceSummary = document.createElement("summary");
  #species = document.createElement("p");
  #source = document.createElement("a");
  #rooms = document.createElement("details");
  #roomLinks = document.createElement("div");
  #doors = document.createElement("nav");
  #doorSection = document.createElement("section");
  #games = document.createElement("section");
  #gameActions = document.createElement("div");
  #mansion: Mansion;
  #search: string;
  #demo: boolean;
  #device: DeviceProfile;
  #onGameSurface: (surface: GameSurface) => void;
  #onExplore: () => void;
  #onGo: (roomId: string) => boolean;
  /** Opens and closes the guide's panel; main.ts points these at the HUD. */
  onShow: () => void = () => undefined;
  onHide: () => void = () => undefined;

  constructor(
    root: HTMLElement,
    mansion: Mansion,
    device: DeviceProfile,
    onExplore: () => void,
    onGameSurface: (surface: GameSurface) => void = () => undefined,
    onGo: (roomId: string) => boolean = () => false,
  ) {
    this.#mansion = mansion;
    this.#search = location.search;
    this.#demo = demoEnabled(import.meta.env.DEV, this.#search);
    this.#device = device;
    this.#onGameSurface = onGameSurface;
    this.#onExplore = onExplore;
    this.#onGo = onGo;
    this.#location.className = "location btn panel";
    this.#location.type = "button";
    this.#location.addEventListener("click", () => this.show());
    this.#location.setAttribute("aria-controls", "panel-column");
    this.#location.title = "Open the guide";
    this.#location.setAttribute("aria-expanded", "false");
    // The room card: which room, over the question it asks.
    this.#locationKicker.className = "location-kicker";
    this.#locationQuestion.className = "location-question";
    const hint = document.createElement("span");
    hint.className = "sr-only";
    hint.textContent = " · Open the guide";
    this.#location.append(this.#locationKicker, this.#locationQuestion, hint);
    root.querySelector(".top-left")?.prepend(this.#location);

    this.element.className = "visitor-guide observatory-guide";
    this.#intro.id = "guide-intro";
    this.#intro.className = "guide-intro";

    const mode = document.createElement("p");
    mode.className = "guide-mode";
    mode.textContent = "Local demo · synthetic particles";
    mode.hidden = !this.#demo;

    const actions = document.createElement("div");
    actions.className = "guide-actions";
    const explore = document.createElement("button");
    explore.type = "button";
    explore.className = "btn accent";
    explore.textContent = device.headset ? "Return to the view" : "Back to the view";
    explore.addEventListener("click", () => {
      this.onHide();
      onExplore();
    });
    const home = document.createElement("a");
    home.href = "/";
    home.className = "btn";
    home.textContent = "Leave";
    const quickControl = document.createElement("p");
    quickControl.className = "guide-quick-control";
    quickControl.textContent = device.headset
      ? "Choose Enter VR in the view; use the left stick to walk."
      : device.touch ? "Drag to look around. Use the round stick to walk."
        : "Click the view to look around. Use W A S D to walk.";
    actions.append(explore, home, quickControl);

    const lookHeading = document.createElement("h3");
    lookHeading.textContent = "Look for";
    this.#look.className = "guide-looking";
    this.#look.append(lookHeading, this.#observations);
    this.#limitation.className = "guide-limitation";
    this.#evidence.className = "guide-disclosure";
    this.#source.className = "guide-source";
    this.#evidence.append(this.#evidenceSummary, this.#species, this.#source);

    const roomSummary = document.createElement("summary");
    roomSummary.textContent = "Choose a research chamber";
    const directHint = document.createElement("p");
    directHint.className = "guide-note";
    directHint.textContent = "Follow this order, or begin with the question that draws you in. Each link opens that room directly.";
    this.#rooms.className = "guide-disclosure guide-rooms";
    this.#roomLinks.className = "guide-room-links";
    this.#rooms.append(roomSummary, directHint, this.#roomLinks);

    const doorHeading = document.createElement("h3");
    doorHeading.textContent = "Open doorways from here";
    const doorHint = document.createElement("p");
    doorHint.className = "guide-note";
    doorHint.textContent = "Neighbouring rooms. Links open them directly.";
    this.#doors.setAttribute("aria-label", "Open doorways");
    this.#doors.className = "guide-doors";
    this.#doorSection.className = "guide-door-section";
    this.#doorSection.append(doorHeading, doorHint, this.#doors);

    const gameHeading = document.createElement("h3");
    gameHeading.textContent = "Play here";
    const gameHint = document.createElement("p");
    gameHint.className = "guide-note";
    gameHint.textContent = this.#device.headset
      ? "Leave immersive VR before opening a browser game surface."
      : "The game opens in a separate surface over the Mind Palace.";
    this.#games.className = "guide-games";
    this.#gameActions.className = "guide-game-actions";
    this.#games.append(gameHeading, gameHint, this.#gameActions);

    const controls = document.createElement("details");
    controls.className = "guide-disclosure guide-controls";
    const controlSummary = document.createElement("summary");
    controlSummary.textContent = "How to move and use a tape";
    const rows = device.headset
      ? [
          ["Look and walk", "Choose Enter VR in the view. Look around and use the left stick to walk."],
          ["Go to a floor point", "Hold a controller grip, aim at the floor, then release."],
          ["Follow a tape", "The trigger plays or pauses. The right stick moves through time; the menu button shows where the view came from."],
          ["Return to this page", "End VR from your headset's system menu. Controllers are needed to move in VR."],
        ]
      : device.touch
        ? [
            ["Look around", "Drag across the view."],
            ["Walk", "Move the round stick at the bottom left, or tap the floor to go there."],
            ["Exhibits", "Tap a picture, tape or plaque to see it up close. Map shows the plan of rooms."],
            ["Follow a tape", "In a room with a tape, use Play or Pause and drag the time slider above the dock."],
            ["Read or listen", "Sources shows where the view came from. Sound on lets you hear the room's video."],
          ]
        : [
            ["Look around", "Click the view, then move your mouse. Press Escape to release the pointer and use the buttons."],
            ["Walk", "Use W A S D or the arrow keys. Hold Shift to walk faster. Click the floor to go there."],
            ["Exhibits", "Click a picture, tape or plaque to see it up close. N and Shift+N step through the room; Escape walks on. L shows the plan of rooms."],
            ["Follow a tape", "Space plays or pauses; [ and ] move one frame. You can also use the time slider at the bottom."],
            ["Read or listen", "P shows where the view came from. M turns the room's video sound on or off. X changes tape speed."],
          ];
    const controlList = document.createElement("dl");
    for (const [action, instruction] of rows) {
      const term = document.createElement("dt");
      term.textContent = action!;
      const description = document.createElement("dd");
      description.textContent = instruction!;
      controlList.append(term, description);
    }
    controls.append(controlSummary, controlList);
    this.element.append(mode, this.#intro, actions, this.#look,
      this.#limitation, this.#evidence, this.#rooms, this.#doorSection, this.#games, controls);
  }

  /** The column header over the guide: "Guide · room", and the room's question. */
  get heading(): readonly [string, string] {
    return this.#heading;
  }

  /** Once seen and closed, the guide stops opening itself on arrival. */
  markSeen(): void {
    try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* Visiting does not need storage. */ }
  }

  setRoom(id: string): void {
    const room = roomById(this.#mansion, id);
    if (!room) return;
    const title = room.title || room.id;
    const exhibit = exhibitContent(room, this.#demo);
    const ordinal = RESEARCH_ORDER.findIndex((stop) => stop === id);
    this.#locationKicker.textContent = ordinal >= 0 ? `Room ${String(ordinal + 1).padStart(2, "0")} · ${title}` : title;
    this.#locationQuestion.textContent = exhibit.question;
    this.#heading = [exhibit.source && exhibit.source !== title ? `Guide · ${title} / ${exhibit.source}` : `Guide · ${title}`, exhibit.question];
    this.#intro.textContent = exhibit.introduction;
    this.#look.hidden = exhibit.lookFor.length === 0;
    this.#observations.replaceChildren(...exhibit.lookFor.map((observation) => {
      const item = document.createElement("li");
      item.textContent = observation;
      return item;
    }));
    this.#limitation.textContent = exhibit.limitation ?? "";
    this.#limitation.hidden = !exhibit.limitation;
    this.#species.textContent = exhibit.species ?? "";
    this.#species.hidden = !exhibit.species;
    const source = evidenceUrl(exhibit);
    this.#source.hidden = !source;
    if (source) this.#source.href = source;
    else this.#source.removeAttribute("href");
    this.#source.textContent = this.#demo ? "Notes for the research exhibit" : "Read the research notes";
    this.#evidenceSummary.textContent = exhibit.species ? "Particle meaning and evidence" : "Research notes";
    this.#evidence.hidden = !source && !exhibit.species;
    this.#evidence.open = false;

    const research = researchRooms(this.#mansion).filter((candidate) => candidate.id !== id);
    this.#rooms.hidden = research.length === 0;
    this.#rooms.open = id === "hall";
    this.#roomLinks.replaceChildren(...research.map((destination) => {
      const link = document.createElement("a");
      link.className = "guide-room-link";
      link.href = roomHref(this.#search, destination.id);
      this.#goInPlace(link, destination.id);
      const ordinal = document.createElement("span");
      ordinal.className = "guide-route-number";
      ordinal.textContent = String(RESEARCH_ORDER.findIndex((stop) => stop === destination.id) + 1).padStart(2, "0");
      const name = document.createElement("strong");
      name.textContent = destination.title || destination.id;
      const question = document.createElement("span");
      question.textContent = exhibitContent(destination).question;
      link.append(ordinal, name, question);
      return link;
    }));
    const rooms = destinations(this.#mansion, room);
    this.#doorSection.hidden = rooms.length === 0;
    this.#doors.replaceChildren(...rooms.map((destination) => {
      const link = document.createElement("a");
      link.className = "btn";
      link.href = roomHref(this.#search, destination.id);
      this.#goInPlace(link, destination.id);
      link.textContent = destination.title || destination.id;
      return link;
    }));
    this.#games.hidden = room.gameSurfaces.length === 0;
    this.#gameActions.replaceChildren(...room.gameSurfaces.map((surface) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn accent";
      button.textContent = `Open ${surface.title}`;
      button.title = surface.description;
      button.addEventListener("click", () => {
        this.onHide();
        queueMicrotask(() => this.#onGameSurface(surface));
      });
      return button;
    }));
  }

  /** A room a walk reaches is gone to without a reload; the link stays for the rest, and for a new tab. */
  #goInPlace(link: HTMLAnchorElement, id: string): void {
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || !this.#onGo(id)) return;
      event.preventDefault();
      this.onHide();
      this.#onExplore();
    });
  }

  show(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.onShow();
  }

  welcome(): void {
    try { if (localStorage.getItem(SEEN_KEY) === "1") return; } catch { /* Still show the guide. */ }
    this.show();
  }
}
