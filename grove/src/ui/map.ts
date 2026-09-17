import "./map.css";
import type { Mansion, Room } from "../world/schema";

// The plan of the world the visitor is standing in, drawn from mansion.json's
// bounds. Loaded the first time L or the Map button is pressed; a room in it is
// a way to go there, the same way the Guide's links go, and only where a walk
// could.
//
// It draws the WHOLE world at the visitor's scale, not just the area they are
// in. Drawing one area was the bug Manuel hit on 2026-09-17: from inside
// arcedit's five rooms the plan showed arcedit and nothing else, so there was
// no way back to the palace on it even though a walk reaches the palace fine.
//
// Rooms stand at different heights and stack — the club and the stage sit under
// the orangery, the foyer under the terrace — so a single top-down plan drew
// them on top of each other. The plan is therefore per floor, with a floor
// picker, and the floors below and above show through as ghosts.

/** The rooms of one area: a tree's entrance and every room under it, or "" for the palace's own. */
export function areaOf(mansion: Mansion, room: Room): string {
  const nested = room.id.includes("/") || mansion.rooms.some((other) => other.id.startsWith(`${room.id}/`));
  return nested ? room.id.split("/")[0]! : "";
}

/**
 * The rooms drawn with a room: a tree's area when it is in one (the entrance
 * and every room under it), else the palace's own rooms; always of its scale,
 * because rooms of two scales share coordinates but never a floor plan.
 *
 * Kept for the menu, which groups by area. The plan itself draws `planRooms`.
 */
export function areaRooms(mansion: Mansion, roomId: string): Room[] {
  const here = mansion.rooms.find((room) => room.id === roomId);
  if (!here) return [];
  const area = areaOf(mansion, here);
  return mansion.rooms.filter((room) => room.scale === here.scale && areaOf(mansion, room) === area);
}

/**
 * Every room a plan may draw beside this one: all of them at its scale, areas
 * included. A portal is the only way between scales and the two never share a
 * floor plan, so the visitor's scale is the one filter that stays.
 */
export function planRooms(mansion: Mansion, roomId: string): Room[] {
  const here = mansion.rooms.find((room) => room.id === roomId);
  if (!here) return [];
  return mansion.rooms.filter((room) => room.scale === here.scale);
}

/**
 * A storey: the rooms whose floors sit at about one height, lowest first.
 * `level` counts from the floor the world starts on, so the palace's own
 * ground floor is 0 and the cellar is -1 however the heights are written.
 */
export interface Floor {
  level: number;
  label: string;
  /** The lowest floor height in the band, metres. */
  y: number;
  rooms: Room[];
}

/**
 * Floors are separated by a gap of at least this many metres between one room's
 * floor and the next above it. Rooms of one storey vary by up to 1.6m here (the
 * grounds lie at -1.6, the hall at 0, the orangery at 1.5, the belvedere at
 * 1.8) while the cellar sits 2.4m under the lowest of them, so two metres
 * separates the storeys the building actually has.
 */
const FLOOR_GAP_M = 2;

/** The floors of a set of rooms, lowest first, each sorted as the document had it. */
export function floorsOf(mansion: Mansion, rooms: readonly Room[]): Floor[] {
  if (rooms.length === 0) return [];
  const bands: Room[][] = [];
  // Sorted by floor height, then split wherever the step up is a storey.
  for (const room of [...rooms].sort((a, b) => a.bounds.min[1] - b.bounds.min[1])) {
    const band = bands[bands.length - 1];
    const last = band?.[band.length - 1];
    if (!band || !last || room.bounds.min[1] - last.bounds.min[1] >= FLOOR_GAP_M) bands.push([room]);
    else band.push(room);
  }
  const order = new Map(mansion.rooms.map((room, index) => [room.id, index]));
  const start = mansion.rooms.find((room) => room.id === mansion.start);
  // The band holding the room the world starts in is the ground floor; when the
  // start room is of another scale entirely, the lowest band is.
  const ground = Math.max(
    0,
    bands.findIndex((band) => band.some((room) => room.id === start?.id)),
  );
  return bands.map((band, index) => {
    const level = index - ground;
    return {
      level,
      label: floorLabel(level),
      y: band[0]!.bounds.min[1],
      rooms: [...band].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    };
  });
}

function floorLabel(level: number): string {
  if (level === 0) return "Ground";
  if (level === -1) return "Cellar";
  if (level === 1) return "Upper";
  return level < 0 ? `Cellar ${-level}` : `Upper ${level}`;
}

/** The level a room stands on, or 0 when it is not drawn at all. */
export function floorOfRoom(floors: readonly Floor[], roomId: string): number {
  return floors.find((floor) => floor.rooms.some((room) => room.id === roomId))?.level ?? 0;
}

/**
 * The rooms with a doorway to another floor — the stairs. They are the one
 * thing a visitor on the wrong storey needs to find, so they are drawn on both
 * floors they join and marked.
 */
export function floorConnectors(mansion: Mansion, floors: readonly Floor[]): Map<string, number[]> {
  const connectors = new Map<string, number[]>();
  for (const floor of floors) {
    for (const room of floor.rooms) {
      const levels = new Set<number>();
      for (const door of room.doorways) {
        if (door.closed) continue;
        const other = mansion.rooms.find((candidate) => candidate.id === door.to);
        if (!other || other.scale !== room.scale) continue;
        const level = floorOfRoom(floors, other.id);
        if (level !== floor.level) levels.add(level);
      }
      if (levels.size > 0) connectors.set(room.id, [...levels].sort((a, b) => a - b));
    }
  }
  return connectors;
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

/** A rectangle of the plan's own space, the window the SVG shows. */
interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SVG = "http://www.w3.org/2000/svg";
const SIZE = 320;
/** Zoomed all the way in, a quarter of the plan fills the frame each way. */
const MAX_ZOOM = 4;

export class RoomMap {
  #dialog = document.createElement("dialog");
  #plan = document.createElementNS(SVG, "svg");
  #floorBar = document.createElement("div");
  #list = document.createElement("div");
  #heading = document.createElement("h2");
  #note = document.createElement("p");
  #onGo: (roomId: string) => boolean;

  #state: MapState | null = null;
  #floors: Floor[] = [];
  #connectors = new Map<string, number[]>();
  /** The floor being drawn, which the picker changes without moving the visitor. */
  #shown = 0;
  #view: Viewport = { x: 0, y: 0, w: SIZE, h: SIZE };
  #drag: { pointer: number; x: number; y: number } | null = null;

  constructor(root: HTMLElement, onGo: (roomId: string) => boolean) {
    this.#onGo = onGo;
    this.#dialog.className = "room-map panel";
    this.#dialog.setAttribute("aria-labelledby", "room-map-title");
    this.#heading.id = "room-map-title";
    // Focus lands on the title, as in the Guide, not on the first room to go to.
    this.#heading.tabIndex = -1;
    this.#heading.setAttribute("autofocus", "");
    this.#plan.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
    // The plan is decoration for a screen reader: every room on it is also a
    // button in the list below, which is the part that carries the names.
    this.#plan.setAttribute("aria-hidden", "true");
    this.#floorBar.className = "room-map-floors";
    this.#list.className = "room-map-areas";
    this.#note.className = "room-map-note";

    const frame = document.createElement("div");
    frame.className = "room-map-frame";
    frame.append(this.#plan, this.#floorBar, this.#zoomBar());

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn";
    close.textContent = "Close";
    close.addEventListener("click", () => this.#dialog.close());

    this.#dialog.append(this.#heading, frame, this.#note, this.#list, close);
    this.#dialog.addEventListener("keydown", (event) => {
      if (event.code === "KeyL" && !(event.target instanceof HTMLInputElement)) this.#dialog.close();
    });
    this.#bindPanZoom();
    root.append(this.#dialog);
  }

  get open(): boolean {
    return this.#dialog.open;
  }

  close(): void {
    this.#dialog.close();
  }

  show(state: MapState): void {
    this.#state = state;
    const rooms = planRooms(state.mansion, state.room);
    this.#floors = floorsOf(state.mansion, rooms);
    this.#connectors = floorConnectors(state.mansion, this.#floors);
    this.#shown = floorOfRoom(this.#floors, state.room);
    this.#view = { x: 0, y: 0, w: SIZE, h: SIZE };
    const here = rooms.find((room) => room.id === state.room);
    this.#heading.textContent = `Plan · ${here ? state.title(here.id) : state.room}`;
    this.#note.textContent =
      this.#floors.length > 1
        ? "Choose a room to go to its entrance. Rooms no open doorway leads to from here are dimmed; the stairs are marked. Drag to pan, scroll to zoom."
        : "Choose a room to go to its entrance. Rooms no open doorway leads to from here are dimmed. Drag to pan, scroll to zoom.";
    this.#draw();
    if (document.pointerLockElement) document.exitPointerLock();
    if (!this.#dialog.open) this.#dialog.showModal();
  }

  #zoomBar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "room-map-zoom";
    const button = (label: string, title: string, run: () => void): HTMLButtonElement => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "btn small";
      element.textContent = label;
      element.title = title;
      element.setAttribute("aria-label", title);
      element.addEventListener("click", run);
      return element;
    };
    bar.append(
      button("+", "Zoom in", () => this.#zoomBy(1 / 1.4, SIZE / 2, SIZE / 2)),
      button("−", "Zoom out", () => this.#zoomBy(1.4, SIZE / 2, SIZE / 2)),
      button("⤢", "Fit the whole plan", () => {
        this.#view = { x: 0, y: 0, w: SIZE, h: SIZE };
        this.#draw();
      }),
    );
    return bar;
  }

  #bindPanZoom(): void {
    this.#plan.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const at = this.#planPoint(event.clientX, event.clientY);
        this.#zoomBy(event.deltaY > 0 ? 1.15 : 1 / 1.15, at.x, at.y);
      },
      { passive: false },
    );
    this.#plan.addEventListener("pointerdown", (event) => {
      // Only a plain drag pans; a click on a room is that room's own.
      if (event.button !== 0) return;
      this.#drag = { pointer: event.pointerId, ...this.#planPoint(event.clientX, event.clientY) };
      this.#plan.setPointerCapture(event.pointerId);
    });
    this.#plan.addEventListener("pointermove", (event) => {
      const drag = this.#drag;
      if (!drag || drag.pointer !== event.pointerId) return;
      const at = this.#planPoint(event.clientX, event.clientY);
      // Panning moves the window the other way, so the plan follows the finger.
      this.#view.x += drag.x - at.x;
      this.#view.y += drag.y - at.y;
      this.#clampView();
      this.#applyView();
    });
    const release = (event: PointerEvent): void => {
      if (this.#drag?.pointer !== event.pointerId) return;
      this.#drag = null;
      if (this.#plan.hasPointerCapture(event.pointerId)) this.#plan.releasePointerCapture(event.pointerId);
    };
    this.#plan.addEventListener("pointerup", release);
    this.#plan.addEventListener("pointercancel", release);
  }

  /** Where a screen point falls in the plan's own coordinates. */
  #planPoint(clientX: number, clientY: number): { x: number; y: number } {
    const box = this.#plan.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return { x: this.#view.x, y: this.#view.y };
    return {
      x: this.#view.x + ((clientX - box.left) / box.width) * this.#view.w,
      y: this.#view.y + ((clientY - box.top) / box.height) * this.#view.h,
    };
  }

  #zoomBy(factor: number, atX: number, atY: number): void {
    const w = Math.min(SIZE, Math.max(SIZE / MAX_ZOOM, this.#view.w * factor));
    const ratio = w / this.#view.w;
    // The point under the cursor stays under it.
    this.#view = {
      x: atX - (atX - this.#view.x) * ratio,
      y: atY - (atY - this.#view.y) * ratio,
      w,
      h: this.#view.h * ratio,
    };
    this.#clampView();
    this.#applyView();
  }

  /** The window never leaves the plan; zoomed out it is the plan exactly. */
  #clampView(): void {
    this.#view.x = Math.min(Math.max(0, this.#view.x), SIZE - this.#view.w);
    this.#view.y = Math.min(Math.max(0, this.#view.y), SIZE - this.#view.h);
  }

  #applyView(): void {
    const { x, y, w, h } = this.#view;
    this.#plan.setAttribute("viewBox", `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
    // Lines and glyphs keep their pixel weight as the plan grows under them.
    this.#plan.style.setProperty("--plan-zoom", String(SIZE / w));
  }

  #draw(): void {
    const state = this.#state;
    if (!state) return;
    // One projection for every floor, so a room does not move when the picker
    // changes: the storeys of a building stand over each other.
    const all = this.#floors.flatMap((floor) => floor.rooms);
    const project = planProjection(all, SIZE, SIZE);
    const shapes: Element[] = [];

    // The other storeys first and faint, the way a plan shows what is under it.
    for (const floor of this.#floors) {
      if (floor.level === this.#shown) continue;
      for (const room of floor.rooms) {
        if (this.#connectors.get(room.id)?.includes(this.#shown)) continue;
        shapes.push(this.#roomRect(room, project, "ghost"));
      }
    }

    const shown = this.#floors.find((floor) => floor.level === this.#shown);
    const drawn = [
      ...(shown?.rooms ?? []),
      // The stairs from this floor to another stand on both.
      ...this.#floors
        .filter((floor) => floor.level !== this.#shown)
        .flatMap((floor) => floor.rooms.filter((room) => this.#connectors.get(room.id)?.includes(this.#shown))),
    ];
    for (const room of drawn) {
      const current = room.id === state.room;
      const open = current || state.reachable.has(room.id);
      const stair = this.#connectors.has(room.id);
      const rect = this.#roomRect(room, project, current ? "here" : open ? "open" : "shut");
      if (open) {
        rect.addEventListener("click", () => this.#go(room.id));
        rect.setAttribute("cursor", "pointer");
      }
      shapes.push(rect);
      const w = (room.bounds.max[0] - room.bounds.min[0]) * project.scale;
      const h = (room.bounds.max[2] - room.bounds.min[2]) * project.scale;
      const cx = project.x((room.bounds.min[0] + room.bounds.max[0]) / 2);
      const cy = project.y((room.bounds.min[2] + room.bounds.max[2]) / 2);
      // A label needs room at the zoom being shown, not at the plan's own size.
      const zoom = SIZE / this.#view.w;
      if (w * zoom > 34 && h * zoom > 12) {
        const label = document.createElementNS(SVG, "text");
        label.setAttribute("x", cx.toFixed(1));
        label.setAttribute("y", (cy + 3).toFixed(1));
        const title = state.title(room.id);
        label.textContent = title.split("/").pop() ?? title;
        shapes.push(label);
      }
      if (stair) {
        const glyph = document.createElementNS(SVG, "text");
        glyph.setAttribute("x", cx.toFixed(1));
        glyph.setAttribute("y", (cy - 4).toFixed(1));
        glyph.setAttribute("class", "stair");
        glyph.textContent = "⇕";
        shapes.push(glyph);
      }
    }

    const dot = document.createElementNS(SVG, "circle");
    dot.setAttribute("cx", project.x(state.x).toFixed(1));
    dot.setAttribute("cy", project.y(state.z).toFixed(1));
    dot.setAttribute("r", "4");
    dot.setAttribute("class", "you");
    // The visitor's own floor is the only one they stand on.
    if (this.#shown !== floorOfRoom(this.#floors, state.room)) dot.setAttribute("opacity", "0.35");
    shapes.push(dot);

    this.#plan.replaceChildren(...shapes);
    this.#applyView();
    this.#drawFloors();
    this.#drawAreas(state);
  }

  #roomRect(room: Room, project: Projection, cls: string): SVGRectElement {
    const rect = document.createElementNS(SVG, "rect");
    rect.setAttribute("x", project.x(room.bounds.min[0]).toFixed(1));
    rect.setAttribute("y", project.y(room.bounds.min[2]).toFixed(1));
    rect.setAttribute("width", ((room.bounds.max[0] - room.bounds.min[0]) * project.scale).toFixed(1));
    rect.setAttribute("height", ((room.bounds.max[2] - room.bounds.min[2]) * project.scale).toFixed(1));
    rect.setAttribute("class", cls);
    return rect;
  }

  /** The floor picker: highest at the top, the way the building stands. */
  #drawFloors(): void {
    if (this.#floors.length < 2) {
      this.#floorBar.replaceChildren();
      return;
    }
    const buttons = [...this.#floors].reverse().map((floor) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = floor.level === this.#shown ? "btn small on" : "btn small";
      button.textContent = floor.label;
      button.setAttribute("aria-pressed", String(floor.level === this.#shown));
      button.addEventListener("click", () => {
        this.#shown = floor.level;
        this.#draw();
      });
      return button;
    });
    this.#floorBar.replaceChildren(...buttons);
  }

  /**
   * The rooms as a menu, grouped by area with the palace first. Grouping is
   * what the flat list lacked: in a world of twenty-odd rooms it read as one
   * heap, and the way home was somewhere in the middle of it.
   */
  #drawAreas(state: MapState): void {
    const groups = new Map<string, Room[]>();
    for (const floor of this.#floors) {
      for (const room of floor.rooms) {
        const area = areaOf(state.mansion, room);
        const group = groups.get(area);
        if (group) group.push(room);
        else groups.set(area, [room]);
      }
    }
    const here = areaOf(state.mansion, state.mansion.rooms.find((room) => room.id === state.room)!);
    const order = [...groups.keys()].sort((a, b) => {
      // The palace first, then the area the visitor is in, then the rest by name.
      if (a === b) return 0;
      if (a === "") return -1;
      if (b === "") return 1;
      if (a === here) return -1;
      if (b === here) return 1;
      return a.localeCompare(b);
    });
    const sections: HTMLElement[] = [];
    for (const area of order) {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = area === "" ? "The palace" : state.title(area);
      const list = document.createElement("ul");
      for (const room of groups.get(area)!) {
        const current = room.id === state.room;
        const open = current || state.reachable.has(room.id);
        const title = state.title(room.id);
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn small";
        button.textContent = current ? `${title} (you are here)` : title;
        const level = floorOfRoom(this.#floors, room.id);
        // Which storey a room is on, when there is more than one to be on.
        if (this.#floors.length > 1) button.title = `${title} · ${floorLabel(level)}`;
        button.disabled = !open;
        button.addEventListener("click", () => this.#go(room.id));
        item.append(button);
        list.append(item);
      }
      section.append(heading, list);
      sections.push(section);
    }
    this.#list.replaceChildren(...sections);
  }

  #go(roomId: string): void {
    this.#dialog.close();
    this.#onGo(roomId);
  }
}
