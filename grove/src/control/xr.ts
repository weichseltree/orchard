import {
  AdditiveBlending,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  RingGeometry,
  Vector3,
} from "three";
import type { Renderer } from "../render/types";
import { PALETTE } from "../config";
import { deadzone, type Commands, type InputState } from "./input";

// WebXR: smooth locomotion on the left stick, teleport on squeeze, the tape's
// clock on the right stick, play/pause on the trigger and the provenance panel
// on the menu button. `local-floor` is required rather than optional — a
// runtime that declines it would put the visitor in a session and then fail,
// and failing at requestSession is the honest failure (someotherlife's rule).

// `hand-tracking` is deliberately NOT requested for M0. A hand input source
// carries no `gamepad`, so a runtime that hands us hands instead of
// controllers would leave locomotion, teleport, scrub and play/pause all dead
// with nothing on screen to say why. Hands come back when there is a hand UI.
const SESSION_INIT: XRSessionInit = {
  requiredFeatures: ["local-floor"],
  optionalFeatures: ["bounded-floor", "layers"],
};

/** xr-standard gamepad layout. */
const BUTTON_TRIGGER = 0;
const BUTTON_SQUEEZE = 1;
const BUTTON_MENU = 4;

/**
 * The parts of `navigator.xr` and `window` the probe uses, injected so the
 * watcher is testable without a DOM.
 */
export interface XrSystemLike {
  isSessionSupported(mode: XRSessionMode): Promise<boolean>;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}
export interface FocusTargetLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}
export interface XrWatchTargets {
  /** `null` when the browser has no WebXR at all. */
  xr: XrSystemLike | null;
  focus: FocusTargetLike;
}

export async function isXrSupported(
  xr: XrSystemLike | null | undefined = navigator.xr,
): Promise<boolean> {
  if (!xr) return false;
  try {
    return await xr.isSessionSupported("immersive-vr");
  } catch {
    return false;
  }
}

/**
 * Watches for a headset appearing after the page loaded — the ordinary
 * sequence is "open the page, then put the headset on".
 *
 * Probes overlap: load, `devicechange` and focus can each start one, and
 * `isSessionSupported` settles in no promised order. Each probe takes a token
 * and only the newest may report, so a slow "unsupported" started before the
 * headset appeared cannot land after the fresh "supported" and disable Enter.
 * Copied from someotherlife's apps/client/src/xr/support.ts (2026-09-07,
 * commit 26a9b1a), per orchard BACKLOG 23 and someotherlife ADR 0018 §1.2.
 */
export function watchXrSupport(
  onChange: (supported: boolean) => void,
  targets: XrWatchTargets = { xr: navigator.xr ?? null, focus: window },
): () => void {
  const { xr, focus } = targets;
  let reported: boolean | null = null;
  let newest = 0;
  let stopped = false;
  const probe = async (): Promise<void> => {
    const token = ++newest;
    const supported = await isXrSupported(xr);
    if (stopped || token !== newest || supported === reported) return;
    reported = supported;
    onChange(supported);
  };
  const reprobe = (): void => void probe();
  void probe();
  // No WebXR in this browser means no headset can ever appear.
  if (!xr) {
    return () => {
      stopped = true;
    };
  }
  xr.addEventListener?.("devicechange", reprobe);
  focus.addEventListener("focus", reprobe);
  return () => {
    stopped = true;
    xr.removeEventListener?.("devicechange", reprobe);
    focus.removeEventListener("focus", reprobe);
  };
}

/** Must be called synchronously from the click: requestSession needs the gesture. */
export function requestXrSession(): Promise<XRSession> {
  if (!navigator.xr) return Promise.reject(new Error("this browser has no WebXR"));
  return navigator.xr.requestSession("immersive-vr", SESSION_INIT);
}

export interface XrControlsOptions {
  renderer: Renderer;
  /** The body's group; controllers hang off it so they move with the visitor. */
  rig: Group;
  input: InputState;
  commands: Commands;
  /** Called on a teleport release with the world-space floor point. */
  onTeleport: (x: number, z: number) => void;
  onNotice?: (message: string) => void;
}

export class XrControls {
  readonly marker: Mesh;

  #renderer: Renderer;
  #rig: Group;
  #input: InputState;
  #commands: Commands;
  #onTeleport: (x: number, z: number) => void;
  #controllers: Group[] = [];
  #rays: Line[] = [];
  /** handedness -> the controller Group three is driving for it. */
  #byHand = new Map<string, Group>();
  #aiming = false;
  #target = new Vector3();
  #hasTarget = false;
  #pressed = new Map<string, boolean>();
  #raycaster = new Raycaster();
  #warnedNoGamepad = false;
  #onNotice: ((message: string) => void) | undefined;
  #origin = new Vector3();
  #direction = new Vector3();

  constructor(options: XrControlsOptions) {
    this.#renderer = options.renderer;
    this.#rig = options.rig;
    this.#input = options.input;
    this.#commands = options.commands;
    this.#onTeleport = options.onTeleport;
    this.#onNotice = options.onNotice;

    for (let i = 0; i < 2; i++) {
      const controller = options.renderer.xr.getController(i);
      const ray = buildRay();
      ray.visible = false;
      controller.add(ray);
      options.rig.add(controller);
      this.#controllers.push(controller);
      this.#rays.push(ray);
      // `getController(i)` follows inputSources order, which is not handedness
      // and can change between sessions; the connected event is the only place
      // the two are known together, so the ray leaves the hand that aimed it.
      controller.addEventListener("connected", (event) => {
        const source = (event as unknown as { data?: XRInputSource }).data;
        if (source?.handedness) this.#byHand.set(source.handedness, controller);
      });
      controller.addEventListener("disconnected", () => {
        for (const [hand, group] of this.#byHand) {
          if (group === controller) this.#byHand.delete(hand);
        }
      });
    }

    // Leaving the session with the stick pushed must not leave the body
    // walking into a wall on the desktop.
    options.renderer.xr.addEventListener("sessionend", () => this.reset());

    this.marker = new Mesh(
      new RingGeometry(0.22, 0.3, 32).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color: PALETTE.accent,
        transparent: true,
        opacity: 0.85,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.marker.visible = false;
    this.marker.name = "teleport-marker";
  }

  get presenting(): boolean {
    return this.#renderer.xr.isPresenting;
  }

  /**
   * Polls the controllers once per frame. Buttons are edge-detected here
   * rather than through session events so a press and its meaning stay in one
   * place.
   */
  update(): void {
    const session = this.#renderer.xr.getSession();
    if (!session) return;
    let left: XRInputSource | null = null;
    let right: XRInputSource | null = null;
    for (const source of session.inputSources) {
      if (source.handedness === "left") left = source;
      else if (source.handedness === "right") right = source;
    }

    if (!this.#warnedNoGamepad && session.inputSources.length > 0) {
      const anyGamepad = [...session.inputSources].some((source) => source.gamepad);
      if (!anyGamepad) {
        this.#warnedNoGamepad = true;
        this.#onNotice?.(
          "no controller with a thumbstick: hands and gaze-only runtimes are not driven in M0",
        );
      }
    }

    // Locomotion on the left stick; axes 2 and 3 are the thumbstick.
    const leftAxes = left?.gamepad?.axes ?? [];
    this.#input.strafe = deadzone(leftAxes[2] ?? 0);
    this.#input.forward = -deadzone(leftAxes[3] ?? 0);

    // The tape's clock on the right stick.
    const rightAxes = right?.gamepad?.axes ?? [];
    this.#input.scrub = deadzone(rightAxes[2] ?? 0);
    // Snap turn on the right stick's vertical is a nausea trap; turning is
    // done with the neck in XR, so the right stick only scrubs.

    if (this.#edge("trigger", pressed(right, BUTTON_TRIGGER) || pressed(left, BUTTON_TRIGGER))) {
      this.#commands.togglePlay();
    }
    if (this.#edge("menu", pressed(right, BUTTON_MENU) || pressed(left, BUTTON_MENU))) {
      this.#commands.toggleProvenance();
    }

    const squeezing = pressed(left, BUTTON_SQUEEZE) || pressed(right, BUTTON_SQUEEZE);
    const aimingHand = pressed(right, BUTTON_SQUEEZE) ? "right" : "left";
    if (squeezing) {
      this.#aiming = true;
      this.#aim(this.#byHand.get(aimingHand) ?? this.#controllers[0]);
    } else if (this.#aiming) {
      this.#aiming = false;
      for (const ray of this.#rays) ray.visible = false;
      this.marker.visible = false;
      if (this.#hasTarget) this.#onTeleport(this.#target.x, this.#target.z);
      this.#hasTarget = false;
    }
  }

  /** Zeroes every held input; called on sessionend and on dispose. */
  reset(): void {
    this.#input.forward = 0;
    this.#input.strafe = 0;
    this.#input.scrub = 0;
    this.#input.yawDelta = 0;
    this.#input.pitchDelta = 0;
    this.#aiming = false;
    this.#hasTarget = false;
    this.marker.visible = false;
    for (const ray of this.#rays) ray.visible = false;
    this.#pressed.clear();
  }

  dispose(): void {
    this.reset();
    for (const controller of this.#controllers) this.#rig.remove(controller);
    this.marker.geometry.dispose();
    (this.marker.material as MeshBasicMaterial).dispose();
    for (const ray of this.#rays) {
      ray.geometry.dispose();
      (ray.material as LineBasicMaterial).dispose();
    }
  }

  /** Where a straight ray out of the controller meets the floor plane. */
  #aim(controller: Group | undefined): void {
    if (!controller) return;
    for (let i = 0; i < this.#rays.length; i++) {
      const ray = this.#rays[i];
      if (ray) ray.visible = this.#controllers[i] === controller;
    }
    controller.getWorldPosition(this.#origin);
    this.#direction.set(0, 0, -1).applyQuaternion(controller.getWorldQuaternion(_q));
    this.#raycaster.set(this.#origin, this.#direction);
    if (this.#direction.y >= -0.02) {
      this.marker.visible = false;
      this.#hasTarget = false;
      return;
    }
    const distance = -this.#origin.y / this.#direction.y;
    this.#target.copy(this.#origin).addScaledVector(this.#direction, distance);
    this.#target.y = 0;
    this.#hasTarget = distance > 0.3 && distance < 20;
    this.marker.visible = this.#hasTarget;
    if (this.#hasTarget) this.marker.position.copy(this.#target).setY(0.02);
  }

  #edge(key: string, down: boolean): boolean {
    const was = this.#pressed.get(key) ?? false;
    this.#pressed.set(key, down);
    return down && !was;
  }
}

/** Scratch, reused every frame: aiming must not allocate. */
const _q = new Quaternion();

function pressed(source: XRInputSource | null, index: number): boolean {
  return source?.gamepad?.buttons[index]?.pressed ?? false;
}

function buildRay(): Line {
  const geometry = new BufferGeometry().setFromPoints([
    new Vector3(0, 0, 0),
    new Vector3(0, 0, -8),
  ]);
  const material = new LineBasicMaterial({
    color: PALETTE.accent,
    transparent: true,
    opacity: 0.6,
  });
  return new Line(geometry, material);
}
