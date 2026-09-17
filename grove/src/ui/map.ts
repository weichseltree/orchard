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
 *
 * The banding is single-linkage: a chain of rooms less than this apart is one
 * floor however tall the chain grows, and today's ground floor is such a chain
 * (-1.6 to 0 to 1.5 to 1.8). One room with its floor between -3.5 and -2.1
 * would therefore bridge the cellar into the ground floor and put the club back
 * on top of the orangery. map.test.ts asserts the two stay apart, so that fails
 * loudly rather than silently; a building with real storeys should declare them
 * in mansion.json rather than let them be inferred.
 *
 * This gap and the half-metre tolerance in `#standingOn` are also what keep
 * that method's feet clause slack: change either and read it again, because it
 * can begin to bind.
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

/**
 * The level a room stands on, or undefined when these floors do not hold it.
 * Undefined rather than a level, so a caller cannot mistake "not on the plan"
 * for the ground floor and invent a storey change out of it.
 */
export function floorOfRoom(floors: readonly Floor[], roomId: string): number | undefined {
  return floors.find((floor) => floor.rooms.some((room) => room.id === roomId))?.level;
}

/**
 * The rooms with a doorway to another floor — the stairs and what they open
 * into. They are marked, because they are the one thing a visitor on the wrong
 * storey needs to find.
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
        // A room these floors do not hold says nothing about a storey change.
        if (level !== undefined && level !== floor.level) levels.add(level);
      }
      if (levels.size > 0) connectors.set(room.id, [...levels].sort((a, b) => a - b));
    }
  }
  return connectors;
}

/**
 * Whether a room is tall enough to be standing on this floor as well as its
 * own. A stairwell spanning -5 to 2.6 is on the ground floor's plan because a
 * visitor up its steps is on the ground floor; the orchard it opens into is
 * not on the cellar's, though it is just as much a way between them.
 */
function reaches(room: Room, floor: Floor): boolean {
  return room.bounds.min[1] <= floor.y && room.bounds.max[1] >= floor.y;
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
  /** The feet's height, which decides the storey when a room spans two. */
  y: number;
  z: number;
  /** The rooms a walk from here reaches (navigation.ts `reachableRooms`). */
  reachable: ReadonlySet<string>;
  title(roomId: string): string;
}

/** A rectangle of the plan's own space: the window the SVG shows. */
export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SVG = "http://www.w3.org/2000/svg";
const SIZE = 320;
/** Zoomed all the way in, a quarter of the plan fills the frame each way. */
const MAX_ZOOM = 4;
/** A press that travels this far in screen pixels is a drag, not a click. */
const DRAG_SLOP_PX = 4;
/** A finger wanders further than a mouse, so it is given more room before it pans. */
const TOUCH_SLOP_PX = 10;

/** The window never leaves the plan; zoomed out it is the plan exactly. */
export function clampView(view: Viewport): Viewport {
  const w = Math.min(SIZE, view.w);
  const h = Math.min(SIZE, view.h);
  return {
    w,
    h,
    x: Math.min(Math.max(0, view.x), SIZE - w),
    y: Math.min(Math.max(0, view.y), SIZE - h),
  };
}

/** Zoom `view` by `factor` about a point of the plan, which stays put under it. */
export function zoomView(view: Viewport, factor: number, atX: number, atY: number): Viewport {
  const w = Math.min(SIZE, Math.max(SIZE / MAX_ZOOM, view.w * factor));
  const ratio = w / view.w;
  return clampView({
    x: atX - (atX - view.x) * ratio,
    y: atY - (atY - view.y) * ratio,
    w,
    h: view.h * ratio,
  });
}

/**
 * Where a screen point falls in the plan's own coordinates, for an SVG whose
 * square viewBox is letterboxed inside a box of another shape (`xMidYMid
 * meet`, the default). Mapping straight across the box instead is right only
 * at the exact centre: at 1280x620 the element is 382x322 and a point a tenth
 * of the way across reads 32 where it should read 8.
 */
export function planPointOf(box: { width: number; height: number }, view: Viewport, offsetX: number, offsetY: number):
  { x: number; y: number } | null {
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const scale = Math.min(box.width / view.w, box.height / view.h);
  return {
    x: view.x + (offsetX - (box.width - view.w * scale) / 2) / scale,
    y: view.y + (offsetY - (box.height - view.h * scale) / 2) / scale,
  };
}

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
  #floorButtons = new Map<number, HTMLButtonElement>();
  #view: Viewport = { x: 0, y: 0, w: SIZE, h: SIZE };
  #drag: { pointer: number; x: number; y: number; fromX: number; fromY: number; panning: boolean } | null = null;
  /** Set while a pan is under way, and read by the click the pan will produce. */
  #panned = false;
  #redraw = 0;

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
      // Ctrl+L and Cmd+L are the browser's; only a bare L closes the plan.
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.code === "KeyL") this.#dialog.close();
    });
    this.#bindPanZoom();
    // The letterbox changes with the window, and with it the plan's scale on
    // screen: the labels and the marks are sized from it.
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => { if (this.#dialog.open) this.#drawPlan(); }).observe(this.#plan);
    }
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
    this.#shown = this.#standingOn(state);
    this.#view = { x: 0, y: 0, w: SIZE, h: SIZE };
    this.#drag = null;
    this.#panned = false;
    const here = rooms.find((room) => room.id === state.room);
    this.#heading.textContent = `Plan · ${here ? state.title(here.id) : state.room}`;
    this.#note.textContent =
      this.#floors.length > 1
        ? "Choose a room to go to its entrance. Rooms no open doorway leads to from here are dimmed; the stairs are marked. Drag to pan, scroll to zoom."
        : "Choose a room to go to its entrance. Rooms no open doorway leads to from here are dimmed. Drag to pan, scroll to zoom.";
    // The picker and the menu are built once a showing: neither the reachable
    // set nor the room the visitor is in changes while the plan is open, and
    // rebuilding them would throw away the focus of whoever is tabbing through.
    this.#buildFloors();
    this.#buildAreas(state);
    this.#drawPlan();
    if (document.pointerLockElement) document.exitPointerLock();
    if (!this.#dialog.open) this.#dialog.showModal();
    // Only now does the plan have a box, and the marks are sized from it. The
    // ResizeObserver does this too where there is one; this is for where there
    // is not.
    this.#drawPlan();
  }

  /**
   * The storey the visitor is actually standing on. A room may span two — the
   * stairwells run from the cellar to the grounds — so their feet decide, and
   * the room's own floor is the fallback.
   */
  #standingOn(state: MapState): number {
    const here = state.mansion.rooms.find((room) => room.id === state.room);
    const own = here ? floorOfRoom(this.#floors, here.id) : undefined;
    if (here) {
      let best: Floor | null = null;
      for (const floor of this.#floors) {
        if (floor.y > state.y + 0.5) continue;
        if (!best || floor.y > best.y) best = floor;
      }
      // Their feet have to be nearer the other storey's floor than their own.
      // `max[1]` is a ceiling, so a room's height decides nothing here. This
      // clause cannot currently bind: a band two metres clear of this room's
      // floor puts its left side at 1.5 or more and its right at 0.5 or less.
      // The case it is written against — someone high on a terrain mound in a
      // walled garden being told they are upstairs — needs a mound above about
      // five metres beside an upper storey, and bounds alone cannot tell that
      // hill from a balcony in an atrium. Closing it properly wants a "standing
      // on terrain" flag in MapState, or a test for a generated stair flight
      // (terrain.ts `flightsOf`), which is what a stairwell actually is.
      if (best && best.level !== own && reaches(here, best)
          && state.y - here.bounds.min[1] >= best.y - state.y) return best.level;
    }
    return floorOfRoom(this.#floors, state.room) ?? this.#floors[0]?.level ?? 0;
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
    // About the middle of what is on screen, not the middle of the plan: from a
    // panned view the latter hauls the visitor's own room out of the frame.
    const middle = (): [number, number] => [this.#view.x + this.#view.w / 2, this.#view.y + this.#view.h / 2];
    bar.append(
      button("+", "Zoom in", () => this.#zoomBy(1 / 1.4, ...middle())),
      button("−", "Zoom out", () => this.#zoomBy(1.4, ...middle())),
      button("⤢", "Fit the whole plan", () => {
        this.#view = { x: 0, y: 0, w: SIZE, h: SIZE };
        this.#drawPlan();
      }),
    );
    return bar;
  }

  #bindPanZoom(): void {
    this.#plan.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const at = this.#planPoint(event);
        if (at) this.#zoomBy(event.deltaY > 0 ? 1.15 : 1 / 1.15, at.x, at.y);
      },
      { passive: false },
    );
    // A pan ends in a click, and only some of them are swallowed for us:
    // Chromium suppresses the click of a TOUCH that moved past its own slop,
    // and pointer capture retargets the MOUSE's click to the svg, but a touch
    // that moved four to twenty pixels does neither — so the plan panned and
    // the room under the finger was entered at the same time. Stopping it here,
    // in the capture phase, is what actually closes the hole: this runs before
    // any room's own listener, whatever the pointer was.
    this.#plan.addEventListener("click", (event) => {
      if (!this.#panned) return;
      this.#panned = false;
      event.stopPropagation();
    }, true);
    this.#plan.addEventListener("pointerdown", (event) => {
      // One pointer pans; a second would steal the gesture from the first and
      // leave it dead until every finger is lifted.
      if (event.button !== 0 || this.#drag) return;
      const at = this.#planPoint(event);
      if (!at) return;
      this.#panned = false;
      this.#drag = { pointer: event.pointerId, x: at.x, y: at.y, fromX: event.clientX, fromY: event.clientY, panning: false };
    });
    this.#plan.addEventListener("pointermove", (event) => {
      const drag = this.#drag;
      if (!drag || drag.pointer !== event.pointerId) return;
      // A pointer moving with nothing held down is a hover, not a drag. Without
      // this a press released off the plan — onto the zoom button overlaid six
      // pixels away, say — leaves the drag standing, and the plan then slides
      // under an idle cursor for the rest of the session. Not named by pointer
      // type on purpose: a pen hovers exactly as a mouse does, and a finger
      // reports a button throughout a drag, so this is right for all three.
      if (event.buttons === 0) {
        this.#drag = null;
        return;
      }
      if (!drag.panning) {
        const slop = event.pointerType === "touch" ? TOUCH_SLOP_PX : DRAG_SLOP_PX;
        const travel = Math.hypot(event.clientX - drag.fromX, event.clientY - drag.fromY);
        // Whether a drag pans and whether it was a drag are two questions, and
        // asking only the first left the plan's own opening view broken: it
        // always opens fitted, where there is nothing to pan, so a visitor who
        // read "drag to pan", pressed in the west orchard and pulled across it
        // got no pan — rightly — and was walked into the orchard on release.
        // Three times the slop, so the tremor the next line forgives stays a
        // click.
        if (travel >= slop * 3) this.#panned = true;
        // Zoomed out there is nothing to pan, so a slip would cost the visitor
        // their click and buy nothing. Re-checked per move, so panning begins
        // as soon as a zoom makes it mean something.
        if (this.#view.w >= SIZE && this.#view.h >= SIZE) return;
        if (travel < slop) return;
        // Captured only once the press is a drag. Capturing on pointerdown
        // retargets the compatibility `click` to the SVG, so the room's own
        // click never fires and the plan is dead to a mouse (2026-09-17).
        drag.panning = true;
        this.#panned = true;
        this.#plan.setPointerCapture(event.pointerId);
      }
      const at = this.#planPoint(event);
      if (!at) return;
      // Panning moves the window the other way, so the plan follows the finger.
      this.#view = clampView({ ...this.#view, x: this.#view.x + drag.x - at.x, y: this.#view.y + drag.y - at.y });
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

  /** Where a pointer event falls in the plan's own coordinates. */
  #planPoint(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const box = this.#plan.getBoundingClientRect();
    return planPointOf(box, this.#view, event.clientX - box.left, event.clientY - box.top);
  }

  #zoomBy(factor: number, atX: number, atY: number): void {
    this.#view = zoomView(this.#view, factor, atX, atY);
    // Which labels fit is decided at the zoom being shown, so the plan is
    // redrawn rather than merely re-framed — once a frame, however fast a
    // wheel turns.
    this.#applyView();
    if (this.#redraw) return;
    this.#redraw = requestAnimationFrame(() => { this.#redraw = 0; this.#drawPlan(); });
  }

  /** Screen pixels per plan unit, which is what a label's size must hold against. */
  #pxPerUnit(): number {
    const box = this.#plan.getBoundingClientRect();
    if (!(box.width > 0) || !(box.height > 0)) return SIZE / this.#view.w;
    return Math.min(box.width / this.#view.w, box.height / this.#view.h);
  }

  #applyView(): void {
    const { x, y, w, h } = this.#view;
    this.#plan.setAttribute("viewBox", `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
    // Lines and glyphs keep their size on screen as the plan grows under them,
    // so this counts the element's own scale, not just the zoom.
    this.#plan.style.setProperty("--plan-zoom", String(this.#pxPerUnit()));
  }

  #drawPlan(): void {
    const state = this.#state;
    if (!state) return;
    const px = this.#pxPerUnit();
    // One projection for every floor, so a room does not move when the picker
    // changes: the storeys of a building stand over each other.
    const all = this.#floors.flatMap((floor) => floor.rooms);
    const project = planProjection(all, SIZE, SIZE);
    const shown = this.#floors.find((floor) => floor.level === this.#shown);
    const onShown = (room: Room): boolean =>
      floorOfRoom(this.#floors, room.id) === this.#shown || (!!shown && this.#connectors.has(room.id) && reaches(room, shown));
    const shapes: Element[] = [];

    // The other storeys first and faint, the way a plan shows what is under it.
    for (const floor of this.#floors) {
      if (floor.level === this.#shown) continue;
      for (const room of floor.rooms) if (!onShown(room)) shapes.push(this.#roomRect(room, project, "ghost"));
    }

    const drawn = [
      ...(shown?.rooms ?? []),
      // A stairwell tall enough to stand on this floor is drawn on it too.
      ...this.#floors
        .filter((floor) => floor.level !== this.#shown)
        .flatMap((floor) => floor.rooms.filter(onShown)),
    ];
    for (const room of drawn) {
      const current = room.id === state.room;
      const open = current || state.reachable.has(room.id);
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
      const stair = this.#connectors.has(room.id);
      // A label needs room at the size the plan is actually drawn on screen.
      if (w * px > 34 && h * px > 12) {
        const label = document.createElementNS(SVG, "text");
        label.setAttribute("x", cx.toFixed(1));
        label.setAttribute("y", (cy + 3 / px).toFixed(2));
        const title = state.title(room.id);
        label.textContent = title.split("/").pop() ?? title;
        shapes.push(label);
      }
      if (stair) {
        const glyph = document.createElementNS(SVG, "text");
        glyph.setAttribute("x", cx.toFixed(1));
        glyph.setAttribute("y", (cy - 4 / px).toFixed(2));
        glyph.setAttribute("class", "stair");
        glyph.textContent = "⇕";
        shapes.push(glyph);
      }
    }

    const dot = document.createElementNS(SVG, "circle");
    dot.setAttribute("cx", project.x(state.x).toFixed(1));
    dot.setAttribute("cy", project.y(state.z).toFixed(1));
    // Four pixels on screen, like every other mark, not four plan units.
    dot.setAttribute("r", (4 / px).toFixed(2));
    dot.setAttribute("class", "you");
    // The visitor's own floor is the only one they stand on.
    if (this.#shown !== this.#standingOn(state)) dot.setAttribute("opacity", "0.35");
    shapes.push(dot);

    this.#plan.replaceChildren(...shapes);
    this.#applyView();
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
  #buildFloors(): void {
    this.#floorButtons.clear();
    if (this.#floors.length < 2) {
      this.#floorBar.replaceChildren();
      return;
    }
    const buttons = [...this.#floors].reverse().map((floor) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = floor.label;
      button.addEventListener("click", () => this.#setFloor(floor.level));
      this.#floorButtons.set(floor.level, button);
      return button;
    });
    this.#floorBar.replaceChildren(...buttons);
    this.#markFloor();
  }

  #markFloor(): void {
    for (const [level, button] of this.#floorButtons) {
      const on = level === this.#shown;
      button.className = on ? "btn small on" : "btn small";
      button.setAttribute("aria-pressed", String(on));
    }
  }

  /**
   * Changing storey redraws the plan but never the picker: rebuilding the
   * button that was just clicked drops focus to the body, and with focus off
   * the dialog the world's own keys are live again behind the open plan —
   * pressing W would walk the visitor while they read it.
   */
  #setFloor(level: number): void {
    this.#shown = level;
    this.#markFloor();
    this.#drawPlan();
  }

  /**
   * The rooms as a menu, grouped by area with the palace first. Grouping is
   * what the flat list lacked: in a world of twenty-odd rooms it read as one
   * heap, and the way home was somewhere in the middle of it.
   */
  #buildAreas(state: MapState): void {
    const groups = new Map<string, Room[]>();
    for (const floor of this.#floors) {
      for (const room of floor.rooms) {
        const area = areaOf(state.mansion, room);
        const group = groups.get(area);
        if (group) group.push(room);
        else groups.set(area, [room]);
      }
    }
    const standing = state.mansion.rooms.find((room) => room.id === state.room);
    const here = standing ? areaOf(state.mansion, standing) : "";
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
        if (this.#floors.length > 1 && level !== undefined) button.title = `${title} · ${floorLabel(level)}`;
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
