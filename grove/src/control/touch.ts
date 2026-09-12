import type { InputState } from "./input";

// Phone: drag anywhere on the right to look, an on-screen stick bottom-left to
// walk. The stick is a DOM element rather than a 3D widget so it stays crisp
// and costs the renderer nothing.

const LOOK_SENSITIVITY = 0.005;
const STICK_RADIUS = 52;

export interface TouchControls {
  element: HTMLElement;
  dispose(): void;
}

export function attachTouchControls(
  container: HTMLElement,
  surface: HTMLElement,
  input: InputState,
): TouchControls {
  const stick = document.createElement("div");
  stick.className = "stick";
  const knob = document.createElement("div");
  knob.className = "stick-knob";
  stick.append(knob);
  container.append(stick);

  let stickPointer: number | null = null;
  let lookPointer: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let originX = 0;
  let originY = 0;

  const onStickDown = (event: PointerEvent): void => {
    if (stickPointer !== null) return;
    stickPointer = event.pointerId;
    const rect = stick.getBoundingClientRect();
    originX = rect.left + rect.width / 2;
    originY = rect.top + rect.height / 2;
    stick.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onStickMove = (event: PointerEvent): void => {
    if (event.pointerId !== stickPointer) return;
    const dx = event.clientX - originX;
    const dy = event.clientY - originY;
    const length = Math.hypot(dx, dy);
    const clamped = Math.min(1, length / STICK_RADIUS);
    const nx = length > 0 ? (dx / length) * clamped : 0;
    const ny = length > 0 ? (dy / length) * clamped : 0;
    input.strafe = nx;
    input.forward = -ny;
    knob.style.transform = `translate(${nx * STICK_RADIUS}px, ${ny * STICK_RADIUS}px)`;
    event.preventDefault();
  };

  const releaseStick = (event: PointerEvent): void => {
    if (event.pointerId !== stickPointer) return;
    stickPointer = null;
    input.forward = 0;
    input.strafe = 0;
    knob.style.transform = "translate(0px, 0px)";
  };

  const onLookDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") return;
    if (lookPointer !== null) return;
    lookPointer = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
  };

  const onLookMove = (event: PointerEvent): void => {
    if (event.pointerId !== lookPointer) return;
    input.yawDelta += (event.clientX - lastX) * LOOK_SENSITIVITY;
    input.pitchDelta += (event.clientY - lastY) * LOOK_SENSITIVITY;
    lastX = event.clientX;
    lastY = event.clientY;
    event.preventDefault();
  };

  const releaseLook = (event: PointerEvent): void => {
    if (event.pointerId !== lookPointer) return;
    lookPointer = null;
  };

  stick.addEventListener("pointerdown", onStickDown);
  stick.addEventListener("pointermove", onStickMove);
  stick.addEventListener("pointerup", releaseStick);
  stick.addEventListener("pointercancel", releaseStick);
  surface.addEventListener("pointerdown", onLookDown);
  surface.addEventListener("pointermove", onLookMove);
  surface.addEventListener("pointerup", releaseLook);
  surface.addEventListener("pointercancel", releaseLook);

  return {
    element: stick,
    dispose() {
      stick.remove();
      surface.removeEventListener("pointerdown", onLookDown);
      surface.removeEventListener("pointermove", onLookMove);
      surface.removeEventListener("pointerup", releaseLook);
      surface.removeEventListener("pointercancel", releaseLook);
    },
  };
}
