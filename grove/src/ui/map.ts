import "./map.css";
import type { Mansion, Room } from "../world/schema";

// The plan of the area the visitor is in, drawn from mansion.json's bounds:
// the palace, or one tree's area of rooms. Loaded the first time L or the Map
// button is pressed; a room in it is a way to go there, the same way the
// Guide's links go, and only where a walk could.

/**
 * The rooms drawn with a room: a tree's area when it is in one (the entrance
 * and every room under it), else the palace's own rooms; always of its scale,
 * because rooms of two scales share coordinates but never a floor plan.
 */
export function areaRooms(mansion: Mansion, roomId: string): Room[] {
  const here = mansion.rooms.find((room) => room.id === roomId);
  if (!here) return [];
  const areaOf = (room: Room): string =>
    room.id.includes("/") || mansion.rooms.some((other) => other.id.startsWith(`${room.id}/`)) ? room.id.split("/")[0]! : "";
  const area = areaOf(here);
  return mansion.rooms.filter((room) => room.scale === here.scale && areaOf(room) === area);
}

export interface Projection {
  /** Screen pixels per metre. */
  scale: number;
  x(worldX: number): number;
  y(worldZ: number): number;
}

/** Top-down, +x to the right and +z down the page, the rooms fitted and centred in a box with a margin. */
export function planProjection(rooms: readonly Room[], width: number, height: number, margin = 12): Projection {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const room of rooms) {
    minX = Math.min(minX, room.bounds.min[0]);
    minZ = Math.min(minZ, room.bounds.min[2]);
    maxX = Math.max(maxX, room.bounds.max[0]);
    maxZ = Math.max(maxZ, room.bounds.max[2]);
  }
  if (rooms.length === 0) return { scale: 1, x: () => width / 2, y: () => height / 2 };
  const scale = Math.min((width - 2 * margin) / (maxX - minX), (height - 2 * margin) / (maxZ - minZ));
  const left = (width - (maxX - minX) * scale) / 2;
  const top = (height - (maxZ - minZ) * scale) / 2;
  return { scale, x: (worldX) => left + (worldX - minX) * scale, y: (worldZ) => top + (worldZ - minZ) * scale };
}

export interface MapState {
  mansion: Mansion;
  room: string;
  x: number;
  z: number;
  /** The rooms a walk from here reaches (navigation.ts `reachableRooms`). */
  reachable: ReadonlySet<string>;
  title(roomId: string): string;
}

const SVG = "http://www.w3.org/2000/svg";
const SIZE = 320;

/** A native dialog, like the Guide: focus, Escape and scrolling stay the browser's. */
export class RoomMap {
  #dialog = document.createElement("dialog");
  #plan = document.createElementNS(SVG, "svg");
  #list = document.createElement("ul");
  #heading = document.createElement("h2");
  #onGo: (roomId: string) => boolean;

  constructor(root: HTMLElement, onGo: (roomId: string) => boolean) {
    this.#onGo = onGo;
    this.#dialog.className = "room-map panel";
    this.#dialog.setAttribute("aria-labelledby", "room-map-title");
    this.#heading.id = "room-map-title";
    // Focus lands on the title, as in the Guide, not on the first room to go to.
    this.#heading.tabIndex = -1;
    this.#heading.setAttribute("autofocus", "");
    this.#plan.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
    this.#plan.setAttribute("aria-hidden", "true");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn";
    close.textContent = "Close";
    close.addEventListener("click", () => this.#dialog.close());
    const note = document.createElement("p");
    note.className = "room-map-note";
    note.textContent = "Choose a room to go to its entrance. Rooms no open doorway leads to from here are dimmed.";
    this.#dialog.append(this.#heading, this.#plan, note, this.#list, close);
    this.#dialog.addEventListener("keydown", (event) => {
      if (event.code === "KeyL" && !(event.target instanceof HTMLInputElement)) this.#dialog.close();
    });
    root.append(this.#dialog);
  }

  get open(): boolean {
    return this.#dialog.open;
  }

  close(): void {
    this.#dialog.close();
  }

  show(state: MapState): void {
    const rooms = areaRooms(state.mansion, state.room);
    const project = planProjection(rooms, SIZE, SIZE);
    const here = rooms.find((room) => room.id === state.room);
    this.#heading.textContent = `Plan · ${here ? state.title(here.id) : state.room}`;
    const shapes: Element[] = [];
    const items: HTMLElement[] = [];
    for (const room of rooms) {
      const current = room.id === state.room;
      const open = current || state.reachable.has(room.id);
      const title = state.title(room.id);
      const rect = document.createElementNS(SVG, "rect");
      const x = project.x(room.bounds.min[0]);
      const y = project.y(room.bounds.min[2]);
      const w = (room.bounds.max[0] - room.bounds.min[0]) * project.scale;
      const h = (room.bounds.max[2] - room.bounds.min[2]) * project.scale;
      rect.setAttribute("x", x.toFixed(1));
      rect.setAttribute("y", y.toFixed(1));
      rect.setAttribute("width", w.toFixed(1));
      rect.setAttribute("height", h.toFixed(1));
      rect.setAttribute("class", current ? "here" : open ? "open" : "shut");
      if (open) rect.addEventListener("click", () => this.#go(room.id));
      shapes.push(rect);
      if (w > 34 && h > 12) {
        const label = document.createElementNS(SVG, "text");
        label.setAttribute("x", (x + w / 2).toFixed(1));
        label.setAttribute("y", (y + h / 2 + 3).toFixed(1));
        label.textContent = title.split("/").pop() ?? title;
        shapes.push(label);
      }
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn small";
      button.textContent = current ? `${title} (you are here)` : title;
      button.disabled = !open;
      button.addEventListener("click", () => this.#go(room.id));
      item.append(button);
      items.push(item);
    }
    const dot = document.createElementNS(SVG, "circle");
    dot.setAttribute("cx", project.x(state.x).toFixed(1));
    dot.setAttribute("cy", project.y(state.z).toFixed(1));
    dot.setAttribute("r", "4");
    dot.setAttribute("class", "you");
    this.#plan.replaceChildren(...shapes, dot);
    this.#list.replaceChildren(...items);
    if (document.pointerLockElement) document.exitPointerLock();
    if (!this.#dialog.open) this.#dialog.showModal();
  }

  #go(roomId: string): void {
    this.#dialog.close();
    this.#onGo(roomId);
  }
}
