import { Group } from "three";
import { describe, expect, it, vi } from "vitest";
import type { AskEvent } from "../ui/ask-menu";
import { XrControls } from "./xr";

/** A gamepad with the xr-standard layout: 0 trigger, 1 squeeze, 4 A/X, 5 B/Y; axes 2,3 the stick. */
function pad() {
  return { buttons: Array.from({ length: 6 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] };
}

function harness(menuOpen: { value: boolean } | null, talk?: string[]) {
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
    voice: talk ? { begin: () => talk.push("begin"), end: () => talk.push("end") } : undefined,
  });
  /** One frame with these buttons held; everything else released. */
  const frame = (held: { leftAsk?: boolean; trigger?: boolean; stickY?: number; stickPress?: boolean } = {}) => {
    left.gamepad.buttons[5]!.pressed = held.leftAsk ?? false;
    right.gamepad.buttons[3]!.pressed = held.stickPress ?? false;
    right.gamepad.buttons[0]!.pressed = held.trigger ?? false;
    right.gamepad.axes[3] = held.stickY ?? 0;
    controls.update();
  };
  return { controls, commands, events, frame };
}

describe("the pointer teleport", () => {
  it("aims at the floor the rig stands on, not at world y = 0", () => {
    const left = { handedness: "left", gamepad: pad() };
    const rig = new Group();
    rig.position.set(0, -5, -40);
    const renderer = {
      xr: { isPresenting: true, getController: () => new Group(), addEventListener: () => undefined, getSession: () => ({ inputSources: [left] }) },
    };
    const landed: Array<[number, number]> = [];
    const controls = new XrControls({
      renderer: renderer as never, rig, input: { forward: 0, strafe: 0, scrub: 0, yawDelta: 0, pitchDelta: 0 } as never,
      commands: { togglePlay: () => undefined, toggleProvenance: () => undefined } as never,
      onTeleport: (x, z) => landed.push([x, z]),
    });
    // The hand a metre up, pointing forward and 45° down: the ray meets the club's floor 1.2 m ahead.
    const hand = controls.controllerFor("left")!;
    hand.position.set(0, 1.2, 0);
    hand.rotation.x = -Math.PI / 4;
    left.gamepad.buttons[1]!.pressed = true;
    controls.update();
    expect(controls.marker.visible).toBe(true);
    expect(controls.marker.position.y).toBeCloseTo(-5 + 0.02);
    left.gamepad.buttons[1]!.pressed = false;
    controls.update();
    expect(landed).toHaveLength(1);
    expect(landed[0]![0]).toBeCloseTo(0);
    expect(landed[0]![1]).toBeCloseTo(-41.2);
  });
});

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

describe("push-to-talk in a headset", () => {
  it("opens the microphone for exactly as long as the stick is held", () => {
    const talk: string[] = [];
    const h = harness(null, talk);
    h.frame({ stickPress: true });
    h.frame({ stickPress: true });
    h.frame({ stickPress: true });
    h.frame();
    expect(talk).toEqual(["begin", "end"]);
  });

  it("closes the microphone when the session ends mid-sentence", () => {
    const talk: string[] = [];
    const h = harness(null, talk);
    h.frame({ stickPress: true });
    h.controls.reset();
    expect(talk).toEqual(["begin", "end"]);
  });

  it("does not end a turn that never began", () => {
    const talk: string[] = [];
    const h = harness(null, talk);
    h.controls.reset();
    h.frame();
    expect(talk).toEqual([]);
  });
});
