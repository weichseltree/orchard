import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachDesktopControls } from "./desktop";
import { createInput, type Commands } from "./input";

class ElementStub extends EventTarget {
  isContentEditable = false;
  constructor(readonly tagName: string, readonly className = "") { super(); }
  closest(selector: string): ElementStub | null {
    return selector.split(", ").some((part) => part === this.tagName || part === `.${this.className}`) ? this : null;
  }
}

let win: EventTarget;
let doc: EventTarget & { pointerLockElement: ElementStub | null };
let canvas: ElementStub & { requestPointerLock: ReturnType<typeof vi.fn> };
let commands: Commands;

function key(code: string, target: EventTarget = canvas, extra: Record<string, unknown> = {}): Event {
  const event = Object.assign(new Event("keydown", { cancelable: true }), { code, repeat: false, ...extra });
  Object.defineProperty(event, "target", { value: target });
  win.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  win = new EventTarget();
  doc = Object.assign(new EventTarget(), { pointerLockElement: null });
  canvas = Object.assign(new ElementStub("canvas"), { requestPointerLock: vi.fn().mockResolvedValue(undefined) });
  commands = {
    togglePlay: vi.fn(), nudgeFrames: vi.fn(), cycleSpeed: vi.fn(),
    cycleAtlas: vi.fn(),
    toggleProvenance: vi.fn(), togglePerf: vi.fn(), toggleUnmute: vi.fn(),
  };
  vi.stubGlobal("HTMLElement", ElementStub);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
});
afterEach(() => vi.unstubAllGlobals());

describe("desktop controls and the visitor interface", () => {
  it("leaves Space and arrow keys to buttons, links, forms and the guide", () => {
    const input = createInput();
    const controls = attachDesktopControls(canvas as unknown as HTMLCanvasElement, input, commands, vi.fn());
    for (const tag of ["button", "a", "input", "textarea", "select", "dialog"]) {
      const target = new ElementStub(tag);
      expect(key("Space", target).defaultPrevented).toBe(false);
      key("ArrowUp", target);
      key("KeyP", target);
      expect(input.forward).toBe(0);
    }
    expect(commands.togglePlay).not.toHaveBeenCalled();
    expect(commands.toggleProvenance).not.toHaveBeenCalled();
    controls.dispose();
  });

  it("keeps canvas shortcuts and walking, without taking browser shortcuts", () => {
    const input = createInput();
    const controls = attachDesktopControls(canvas as unknown as HTMLCanvasElement, input, commands, vi.fn());
    expect(key("Space").defaultPrevented).toBe(true);
    expect(commands.togglePlay).toHaveBeenCalledOnce();
    key("KeyW");
    expect(input.forward).toBe(1);
    key("KeyP", canvas, { ctrlKey: true });
    expect(commands.toggleProvenance).not.toHaveBeenCalled();
    controls.dispose();
    expect(input.forward).toBe(0);
    key("KeyW");
    expect(input.forward).toBe(0);
  });

  it("lets the focused performance region scroll without moving or toggling playback", () => {
    const input = createInput();
    const controls = attachDesktopControls(canvas as unknown as HTMLCanvasElement, input, commands, vi.fn());
    key("KeyW");
    const panel = new ElementStub("div", "perf");
    const focus = new Event("focusin");
    Object.defineProperty(focus, "target", { value: panel });
    doc.dispatchEvent(focus);
    expect(input.forward).toBe(0);
    for (const code of ["ArrowDown", "ArrowRight", "Space"]) {
      expect(key(code, panel).defaultPrevented).toBe(false);
    }
    expect(input.forward).toBe(0);
    expect(input.strafe).toBe(0);
    expect(commands.togglePlay).not.toHaveBeenCalled();
    controls.dispose();
  });

  it("stops walking when a visitor opens a field or leaves the window", () => {
    const input = createInput();
    const controls = attachDesktopControls(canvas as unknown as HTMLCanvasElement, input, commands, vi.fn());
    key("KeyW");
    const focus = new Event("focusin");
    Object.defineProperty(focus, "target", { value: new ElementStub("input") });
    doc.dispatchEvent(focus);
    expect(input.forward).toBe(0);
    key("KeyD");
    expect(input.strafe).toBe(1);
    win.dispatchEvent(new Event("blur"));
    expect(input.strafe).toBe(0);
    controls.dispose();
  });

  it("reports refused pointer lock without leaving an unhandled rejection", async () => {
    const onError = vi.fn();
    canvas.requestPointerLock.mockRejectedValue(new Error("not allowed"));
    const controls = attachDesktopControls(canvas as unknown as HTMLCanvasElement, createInput(), commands, vi.fn(), onError);
    controls.requestLock();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
    controls.dispose();
    doc.dispatchEvent(new Event("pointerlockerror"));
    expect(onError).toHaveBeenCalledOnce();
  });
});
