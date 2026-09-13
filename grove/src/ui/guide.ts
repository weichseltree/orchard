import type { DeviceProfile } from "../device";
import { roomById, type Mansion, type Room } from "../world/schema";

const SEEN_KEY = "orchard.grove.guide-seen";

/** Only offer doors that can actually be walked through. */
export function destinations(mansion: Mansion, room: Room): Room[] {
  const ids = new Set(room.doorways.filter((door) => !door.closed).map((door) => door.to));
  return mansion.rooms.filter((candidate) => ids.has(candidate.id));
}

/** A native dialog supplies focus containment, Escape, and a scrollable phone guide. */
export class VisitorGuide {
  #dialog = document.createElement("dialog");
  #location = document.createElement("button");
  #roomHeading = document.createElement("h2");
  #doors = document.createElement("nav");
  #mansion: Mansion;
  #search: string;

  constructor(root: HTMLElement, mansion: Mansion, device: DeviceProfile, onExplore: () => void) {
    this.#mansion = mansion;
    this.#search = location.search;
    this.#location.className = "location btn panel";
    this.#location.type = "button";
    this.#location.addEventListener("click", () => this.show());
    this.#location.setAttribute("aria-haspopup", "dialog");
    root.querySelector(".top-left")?.prepend(this.#location);

    const help = document.createElement("button");
    help.type = "button";
    help.className = "btn";
    help.textContent = "Guide";
    help.setAttribute("aria-haspopup", "dialog");
    help.addEventListener("click", () => this.show());
    root.querySelector(".top-right")?.prepend(help);

    this.#dialog.className = "visitor-guide panel";
    this.#dialog.setAttribute("aria-labelledby", "guide-title");
    const title = document.createElement("h1");
    title.id = "guide-title";
    title.tabIndex = -1;
    title.setAttribute("autofocus", "");
    title.textContent = "Find your way in the grove";
    const intro = document.createElement("p");
    intro.textContent = "Walk into a room, find a simulation, and move through its time. You can reopen this guide whenever you need it.";
    const controls = document.createElement("dl");
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
    for (const [action, instruction] of rows) {
      const term = document.createElement("dt");
      term.textContent = action!;
      const description = document.createElement("dd");
      description.textContent = instruction!;
      controls.append(term, description);
    }
    this.#doors.setAttribute("aria-label", "Open doorways");
    const doorHint = document.createElement("p");
    doorHint.className = "guide-note";
    doorHint.textContent = "Walk through a doorway, or open a room directly below.";
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
    actions.append(explore, home);
    this.#dialog.append(title, intro, controls, this.#roomHeading, doorHint, this.#doors, actions);
    this.#dialog.addEventListener("close", () => {
      try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* Visiting does not need storage. */ }
    });
    root.append(this.#dialog);
  }

  setRoom(id: string): void {
    const room = roomById(this.#mansion, id);
    if (!room) return;
    const title = room.title || room.id;
    this.#location.textContent = `You are in ${title.replace(/^The /, "the ")} · Guide`;
    this.#roomHeading.textContent = `Open doorways from ${title.replace(/^The /, "the ")}`;
    const rooms = destinations(this.#mansion, room);
    this.#doors.replaceChildren(...rooms.map((destination) => {
      const link = document.createElement("a");
      link.className = "btn";
      // Keep mode flags such as the local demo, but leave the previous view coordinates behind.
      const search = new URLSearchParams(this.#search);
      for (const key of ["yaw", "pitch", "x", "z"]) search.delete(key);
      search.set("room", destination.id);
      link.href = `/grove/?${search}`;
      link.textContent = destination.title || destination.id;
      return link;
    }));
  }

  show(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    if (!this.#dialog.open) this.#dialog.showModal();
  }

  welcome(): void {
    try { if (localStorage.getItem(SEEN_KEY) === "1") return; } catch { /* Still show the guide. */ }
    this.show();
  }
}
