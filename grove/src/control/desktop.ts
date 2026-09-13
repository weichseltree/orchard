import type { Commands, InputState } from "./input";

// Desktop: click to take the pointer, WASD to walk, mouse to look, and the
// scrubber on the keyboard so a hand never has to leave the keys.

const LOOK_SENSITIVITY = 0.0022;

export interface DesktopControls {
  readonly locked: boolean;
  requestLock(): void;
  dispose(): void;
}

export function attachDesktopControls(
  canvas: HTMLCanvasElement,
  input: InputState,
  commands: Commands,
  onLockChange: (locked: boolean) => void,
  onLockError: () => void = () => undefined,
): DesktopControls {
  const held = new Set<string>();
  let locked = false;

  const applyMotion = (): void => {
    const forward = (held.has("KeyW") || held.has("ArrowUp") ? 1 : 0) -
      (held.has("KeyS") || held.has("ArrowDown") ? 1 : 0);
    const strafe = (held.has("KeyD") || held.has("ArrowRight") ? 1 : 0) -
      (held.has("KeyA") || held.has("ArrowLeft") ? 1 : 0);
    input.forward = forward;
    input.strafe = strafe;
    input.run = held.has("ShiftLeft") || held.has("ShiftRight");
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    // Typing into the HUD (a report, say) is typing, not walking.
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || ownsKeyboard(event.target)) return;
    if (event.repeat) {
      // Held brackets keep scrubbing; everything else fires once.
      if (event.code === "BracketLeft") commands.nudgeFrames(-1);
      if (event.code === "BracketRight") commands.nudgeFrames(1);
      return;
    }
    switch (event.code) {
      case "Space":
        event.preventDefault();
        commands.togglePlay();
        return;
      case "BracketLeft":
        commands.nudgeFrames(-1);
        return;
      case "BracketRight":
        commands.nudgeFrames(1);
        return;
      case "KeyP":
        commands.toggleProvenance();
        return;
      case "KeyF":
        commands.togglePerf();
        return;
      case "KeyM":
        commands.toggleUnmute();
        return;
      case "KeyX":
        commands.cycleSpeed();
        return;
      default:
        held.add(event.code);
        applyMotion();
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    held.delete(event.code);
    applyMotion();
  };

  const onMouseMove = (event: MouseEvent): void => {
    if (!locked) return;
    input.yawDelta += event.movementX * LOOK_SENSITIVITY;
    input.pitchDelta += event.movementY * LOOK_SENSITIVITY;
  };

  const onPointerLockChange = (): void => {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      held.clear();
      applyMotion();
    }
    onLockChange(locked);
  };

  const requestLock = (): void => {
    try {
      const request = canvas.requestPointerLock();
      if (request) void request.catch(onLockError);
    } catch { onLockError(); }
  };

  const onClick = (): void => {
    if (!locked) requestLock();
  };

  const clearMotion = (): void => {
    held.clear();
    applyMotion();
  };
  const onFocus = (event: FocusEvent): void => {
    if (ownsKeyboard(event.target)) clearMotion();
  };

  canvas.addEventListener("click", onClick);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  document.addEventListener("pointerlockerror", onLockError);
  document.addEventListener("focusin", onFocus);
  document.addEventListener("mousemove", onMouseMove);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clearMotion);

  return {
    get locked() {
      return locked;
    },
    requestLock() {
      requestLock();
    },
    dispose() {
      canvas.removeEventListener("click", onClick);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("pointerlockerror", onLockError);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearMotion);
      clearMotion();
    },
  };
}

export function ownsKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, button, a, dialog, .perf, [contenteditable]") !== null;
}
