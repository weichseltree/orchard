import { Group } from "three";
import { describe, expect, it, vi } from "vitest";
import type { AskEvent } from "../ui/ask-menu";
import { XrControls } from "./xr";

/** A gamepad with the xr-standard layout: 0 trigger, 1 squeeze, 4 A/X, 5 B/Y; axes 2,3 the stick. */
function pad() {
  return { buttons: Array.from({ length: 6 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] };
}

function harness(menuOpen: { value: boolean } | null) {
  const left = { handedness: "left", gamepad: pad() };
  const right = { handedness: "right", gamepad: pad() };
  const renderer = {
    xr: {
      isPresenting: true,
      getController: () => new Group(),
      addEventListener: () => undefined,
      getSession: () => ({ inputSources: [left, right] }),
    },
  };
  const commands = { togglePlay: vi.fn(), toggleProvenance: vi.fn() };
  const events: AskEvent[] = [];
  const controls = new XrControls({
    renderer: renderer as never,
    rig: new Group(),
    input: { forward: 0, strafe: 0, scrub: 0, yawDelta: 0, pitchDelta: 0 } as never,
    commands: commands as never,
    onTeleport: () => undefined,
    askMenu: menuOpen
      ? { isOpen: () => menuOpen.value, onEvent: (event) => events.push(event) }
      : undefined,
  });
  /** One frame with these buttons held; everything else released. */
  const frame = (held: { leftAsk?: boolean; trigger?: boolean; stickY?: number } = {}) => {
    left.gamepad.buttons[5]!.pressed = held.leftAsk ?? false;
    right.gamepad.buttons[0]!.pressed = held.trigger ?? false;
    right.gamepad.axes[3] = held.stickY ?? 0;
    controls.update();
  };
  return { controls, commands, events, frame };
}

describe("the ask menu on the controllers", () => {
  it("opens on B/Y, once per press", () => {
    const h = harness({ value: false });
    h.frame({ leftAsk: true });
    h.frame({ leftAsk: true });
    h.frame();
    expect(h.events).toEqual(["toggle"]);
  });

  it("chooses with the trigger while open, and does NOT pause the tape", () => {
    // Otherwise asking a question would also stop the tape behind the menu.
    const h = harness({ value: true });
    h.frame({ trigger: true });
    expect(h.events).toEqual(["choose"]);
    expect(h.commands.togglePlay).not.toHaveBeenCalled();
  });

  it("leaves the trigger as play/pause while closed", () => {
    const h = harness({ value: false });
    h.frame({ trigger: true });
    expect(h.commands.togglePlay).toHaveBeenCalledOnce();
    expect(h.events).toEqual([]);
  });

  it("steps with the right stick only while open, once per push", () => {
    const h = harness({ value: true });
    h.frame({ stickY: 0.9 });
    h.frame({ stickY: 0.9 });
    h.frame();
    h.frame({ stickY: -0.9 });
    expect(h.events).toEqual(["down", "up"]);
  });

  it("does not step a closed menu from the stick", () => {
    const h = harness({ value: false });
    h.frame({ stickY: 0.9 });
    expect(h.events).toEqual([]);
  });

  it("closes the menu when the session is reset", () => {
    const h = harness({ value: true });
    h.controls.reset();
    expect(h.events).toEqual(["close"]);
  });

  it("changes nothing for a page without a menu", () => {
    const h = harness(null);
    h.frame({ leftAsk: true, trigger: true });
    expect(h.commands.togglePlay).toHaveBeenCalledOnce();
  });
});
