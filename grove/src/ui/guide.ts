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

/** A native dialog keeps focus, Escape and touch scrolling in the browser's hands. */
export class VisitorGuide {
  #dialog = document.createElement("dialog");
  #location = document.createElement("button");
  #locationLine = document.createElement("span");
  #locationKicker = document.createElement("span");
  #locationQuestion = document.createElement("span");
  #title = document.createElement("h1");
  #kicker = document.createElement("p");
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
  /** Told when the dialog opens or closes, so the phone dock can show it. */
  onOpenChange: (open: boolean) => void = () => undefined;

  constructor(
    root: HTMLElement,
    mansion: Mansion,
    device: DeviceProfile,
    onExplore: () => void,
    onGameSurface: (surface: GameSurface) => void = () => undefined,
  ) {
    this.#mansion = mansion;
    this.#search = location.search;
    this.#demo = demoEnabled(import.meta.env.DEV, this.#search);
    this.#device = device;
    this.#onGameSurface = onGameSurface;
    this.#location.className = "location btn panel";
    this.#location.type = "button";
    this.#location.addEventListener("click", () => this.show());
    this.#location.setAttribute("aria-haspopup", "dialog");
    // One sentence on a wide screen; on a phone the same button is the room
    // card, kicker over question. The CSS shows one form or the other, and a
    // hidden span is not part of the button's accessible name.
    this.#locationLine.className = "location-line";
    this.#locationKicker.className = "location-kicker";
    this.#locationQuestion.className = "location-question";
    this.#location.append(this.#locationLine, this.#locationKicker, this.#locationQuestion);
    root.querySelector(".top-left")?.prepend(this.#location);

    const help = document.createElement("button");
    help.type = "button";
    help.className = "btn guide-open";
    help.textContent = "Guide";
    help.setAttribute("aria-haspopup", "dialog");
    help.addEventListener("click", () => this.show());
    root.querySelector(".top-right")?.prepend(help);

    this.#dialog.className = "visitor-guide observatory-guide panel";
    this.#dialog.setAttribute("aria-labelledby", "guide-title");
    this.#dialog.setAttribute("aria-describedby", "guide-intro");
    this.#title.id = "guide-title";
    this.#title.tabIndex = -1;
    this.#title.setAttribute("autofocus", "");
    this.#kicker.className = "guide-kicker";
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
    explore.textContent = device.headset ? "Return to the view" : "Start exploring";
    explore.addEventListener("click", () => {
      this.#dialog.close();
      onExplore();
    });
    const home = document.createElement("a");
    home.href = "/";
    home.className = "btn";
    home.textContent = "Back to the website";
    const quickControl = document.createElement("p");
    quickControl.className = "guide-quick-control";
    quickControl.textContent = device.headset
      ? "Choose Enter VR in the view; use the left stick to walk."
      : device.touch ? "Drag to look around. Use the round stick to walk."
        : "Click the view to look around. Use W A S D to walk.";
    actions.append(explore, home, quickControl);

    const lookHeading = document.createElement("h2");
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

    const doorHeading = document.createElement("h2");
    doorHeading.textContent = "Open doorways from here";
    const doorHint = document.createElement("p");
    doorHint.className = "guide-note";
    doorHint.textContent = "Neighbouring rooms. Links open them directly.";
    this.#doors.setAttribute("aria-label", "Open doorways");
    this.#doors.className = "guide-doors";
    this.#doorSection.className = "guide-door-section";
    this.#doorSection.append(doorHeading, doorHint, this.#doors);

    const gameHeading = document.createElement("h2");
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
          ["Look and walk", "Enter VR from the top bar. Look around and use the left stick to walk."],
          ["Go to a floor point", "Hold a controller grip, aim at the floor, then release."],
          ["Follow a tape", "The trigger plays or pauses. The right stick moves through time; the menu button shows where the view came from."],
          ["Return to this page", "End VR from your headset's system menu. Controllers are needed to move in VR."],
        ]
      : device.touch
        ? [
            ["Look around", "Drag across the view."],
            ["Walk", "Move the round stick at the bottom left."],
            ["Follow a tape", "In a room with a tape, use Play or Pause and drag the time slider below."],
            ["Read or listen", "About this view shows where it came from. Sound on lets you hear the room's video."],
          ]
        : [
            ["Look around", "Click the view, then move your mouse. Press Escape to release the pointer and use the buttons."],
            ["Walk", "Use W A S D or the arrow keys. Hold Shift to walk faster."],
            ["Follow a tape", "Space plays or pauses; [ and ] move one frame. You can also use the time slider below."],
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
    this.#dialog.append(this.#kicker, this.#title, mode, this.#intro, actions, this.#look,
      this.#limitation, this.#evidence, this.#rooms, this.#doorSection, this.#games, controls);
    // A phone has no Escape key: the sheet gets a close button of its own.
    const close = document.createElement("button");
    close.type = "button";
    close.className = "guide-close";
    close.setAttribute("aria-label", "Close the guide");
    close.innerHTML = '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"></path></svg>';
    close.addEventListener("click", () => this.#dialog.close());
    this.#dialog.prepend(close);
    this.#dialog.addEventListener("close", () => {
      this.onOpenChange(false);
      try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* Visiting does not need storage. */ }
    });
    root.append(this.#dialog);
  }

  setRoom(id: string): void {
    const room = roomById(this.#mansion, id);
    if (!room) return;
    const title = room.title || room.id;
    const exhibit = exhibitContent(room, this.#demo);
    this.#locationLine.textContent = `You are in ${title.replace(/^The /, "the ")} · Guide`;
    const ordinal = RESEARCH_ORDER.findIndex((stop) => stop === id);
    this.#locationKicker.textContent = ordinal >= 0 ? `Room ${String(ordinal + 1).padStart(2, "0")} · ${title}` : title;
    this.#locationQuestion.textContent = exhibit.question;
    this.#kicker.textContent = exhibit.source ? `${title} / ${exhibit.source}` : title;
    this.#title.textContent = exhibit.question;
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
        this.#dialog.close();
        queueMicrotask(() => this.#onGameSurface(surface));
      });
      return button;
    }));
  }

  show(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.#dialog.open) return;
    this.#dialog.showModal();
    this.onOpenChange(true);
  }

  welcome(): void {
    try { if (localStorage.getItem(SEEN_KEY) === "1") return; } catch { /* Still show the guide. */ }
    this.show();
  }
}
