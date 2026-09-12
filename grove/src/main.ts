import "./ui/grove.css";
import { MathUtils, Vector3 } from "three";
import { detectDevice } from "./device";
import { attachDesktopControls } from "./control/desktop";
import { consumeDeltas, createInput, type Commands } from "./control/input";
import { clampHead, createBody, step, teleport } from "./control/locomotion";
import { attachTouchControls } from "./control/touch";
import { XrControls, requestXrSession, watchXrSupport } from "./control/xr";
import { Avatars } from "./net/avatars";
import { Presence } from "./net/presence";
import { EYE_HEIGHT, createView } from "./render/view";
import { Hud } from "./ui/hud";
import { PerfMeter } from "./ui/perf";
import { Provenance } from "./ui/provenance";
import { WorldNotices } from "./ui/worldnotice";
import { frameAt } from "./tape/time";
import mansionDocument from "./world/mansion.json";
import { parseMansion, roomById } from "./world/schema";
import { buildWorld, type BuiltWorld } from "./world/world";

// The grove. Boot order matters: the canvas renders within a frame of the
// module loading, the world streams in behind it room by room, and the network
// is the last thing to arrive and the only thing allowed to fail silently.

const canvas = document.querySelector<HTMLCanvasElement>("#stage");
const hudRoot = document.querySelector<HTMLElement>("#hud");
if (!canvas || !hudRoot) throw new Error("grove/index.html is missing #stage or #hud");

const mansion = parseMansion(mansionDocument);
const device = detectDevice();
const input = createInput();
const perf = new PerfMeter();
const avatars = new Avatars();
const worldNotices = new WorldNotices();

const view = createView(canvas, device, {
  onContextLost: (restored) =>
    notice(
      restored
        ? "the graphics context came back"
        : "the browser took the graphics context away; it will come back on its own",
    ),
});
view.scene.add(avatars.group, worldNotices.panel);

const startRoom = roomById(mansion, mansion.start);
if (!startRoom) throw new Error(`mansion.json start room "${mansion.start}" is missing`);
const body = createBody(
  startRoom.spawn.position[0],
  startRoom.spawn.position[2],
  MathUtils.degToRad(startRoom.spawn.yawDeg),
  startRoom.id,
);
/** Until the visitor moves, the asset's own spawn marker may still move them. */
let bodyPlaced = false;

const hud = new Hud(hudRoot, {
  onEnterVr: () => void enterVr(),
  onTogglePlay: () => commands.togglePlay(),
  onScrub: (fraction) => {
    for (const tape of world?.tapes ?? []) tape.scrubToFraction(fraction);
    scrubbingUntil = performance.now() + 400;
  },
  onScrubEnd: () => {
    scrubbingUntil = 0;
  },
  onSpeed: (speed) => {
    for (const tape of world?.tapes ?? []) tape.setSpeed(speed);
    hud.setSpeed(speed);
  },
  onUnmute: () => void toggleAudio(),
  onProvenance: () => provenance.toggle(view.camera),
});
const provenance = new Provenance(hud.provenancePanel);
view.scene.add(provenance.panel);

/** Every failure surface at once: the HUD, and the board that exists in VR. */
function notice(text: string, sticky = false): void {
  hud.notice(text, sticky);
  worldNotices.push(text);
}

const presence = new Presence({
  onStatus: (status, detail) => {
    if (status === "online") hud.setLink("connected");
    else if (status === "connecting") hud.setLink("connecting...");
    else {
      hud.setLink("single-player", true);
      if (detail && detail !== lastLinkDetail) {
        lastLinkDetail = detail;
        notice(`Presence is off: ${detail}. Everything else works; retrying.`);
      }
    }
  },
  onNotice: (text) => notice(text),
});
let lastLinkDetail = "";

let perfOpen = false;
let scrubbingUntil = 0;

const commands: Commands = {
  togglePlay: () => {
    const tape = world?.tape;
    if (!tape) return;
    const playing = tape.togglePlay();
    for (const other of world?.tapes.slice(1) ?? []) other.setPlaying(playing);
    hud.setPlaying(playing);
  },
  nudgeFrames: (delta) => {
    for (const tape of world?.tapes ?? []) tape.nudgeFrames(delta);
  },
  cycleSpeed: () => {
    const tape = world?.tape;
    if (!tape) return;
    const speed = tape.cycleSpeed();
    for (const other of world?.tapes.slice(1) ?? []) other.setSpeed(speed);
    hud.setSpeed(speed);
    notice(`${speed}x`);
  },
  toggleProvenance: () => provenance.toggle(view.camera),
  togglePerf: () => {
    perfOpen = !perfOpen;
    if (!perfOpen) hud.setPerf(null);
  },
  toggleUnmute: () => void toggleAudio(),
};

const xr = new XrControls({
  renderer: view.renderer,
  rig: view.rig,
  input,
  commands,
  onTeleport: (x, z) => {
    if (!teleport(body, mansion, x, z)) notice("nothing to stand on there");
  },
  onNotice: (text) => notice(text),
});
view.scene.add(xr.marker);

const HINT = "Click to look around  ·  WASD to walk  ·  P provenance  ·  F frame budget";
if (device.touch) {
  attachTouchControls(hudRoot, canvas, input);
} else {
  attachDesktopControls(canvas, input, commands, (locked) => hud.setHint(locked ? null : HINT));
  hud.setHint(HINT);
}
watchXrSupport((supported) => hud.setXrAvailable(supported));

let world: BuiltWorld | null = null;
const EXHIBIT_WAIT_MS = 8000;
const headWorld = new Vector3();

function boot(): void {
  hud.setHere(1);
  hud.setLink("connecting...");
  presence.connect(presenceRoomFor(body.room));

  const built = buildWorld({
    mansion,
    renderer: view.renderer,
    device,
    provenance,
    onNotice: (text) => notice(text),
    // The hangings wait this long for the live exhibit table, then take the
    // pinned ids: a slow link costs seconds, a dead one costs nothing.
    exhibits: () => presence.whenExhibits(EXHIBIT_WAIT_MS),
    onRoomReady: (room) => {
      // The asset's spawn marker is the authority; if the visitor has not
      // moved yet, put them where the bake says the room starts.
      if (room.id !== body.room || bodyPlaced) return;
      body.x = room.spawn.position[0];
      body.z = room.spawn.position[2];
      body.yaw = MathUtils.degToRad(room.spawn.yawDeg);
    },
  });
  world = built;
  // The group goes into the scene empty: the first frame is a room, not a
  // black page, and each shell appears as it lands.
  view.world.add(built.group);
  built
    .load()
    .then(() => {
      if (built.tape) {
        hud.setScrubberVisible(true);
        hud.setPlaying(built.tape.playing);
        hud.setSpeed(built.tape.speed);
      }
      if (built.video && built.video.mode !== "poster") hud.setUnmuteAvailable(true);
    })
    .catch((error: unknown) => notice(`The world did not finish loading: ${message(error)}`, true));
}

function presenceRoomFor(roomId: string): string {
  return roomById(mansion, roomId)?.presence ?? "grove";
}

async function enterVr(): Promise<void> {
  try {
    const session = await requestXrSession();
    await view.renderer.xr.setSession(session);
  } catch (error) {
    notice(`VR did not start: ${message(error)}`);
  }
}

async function toggleAudio(): Promise<void> {
  const video = world?.video;
  if (!video || video.mode === "poster") return;
  if (video.muted) await video.unmute();
  else video.mute();
  notice(video.muted ? "muted" : "unmuted");
}

let lastLabelFrame = -1;

view.start((dt) => {
  perf.sample(dt);
  const presenting = view.renderer.xr.isPresenting;

  if (presenting) xr.update();
  // In XR you walk where you look; on a desktop the body's yaw is the heading.
  const heading = presenting ? headingFromCamera() : body.yaw;
  const movingBefore = input.forward !== 0 || input.strafe !== 0;
  step(body, input, dt, mansion, heading);
  if (movingBefore) bodyPlaced = true;
  consumeDeltas(input);

  view.rig.position.set(body.x, 0, body.z);
  if (presenting) {
    // Room-scale walking can take the head through a wall the rig never met.
    view.camera.getWorldPosition(headWorld);
    const push = clampHead(body, headWorld.x, headWorld.z, mansion);
    if (push.dx !== 0 || push.dz !== 0) {
      body.x += push.dx;
      body.z += push.dz;
      view.rig.position.set(body.x, 0, body.z);
    }
  } else {
    view.rig.rotation.y = body.yaw;
    view.camera.rotation.set(body.pitch, 0, 0);
    view.camera.position.set(0, EYE_HEIGHT, 0);
  }

  const tape = world?.tape;
  if (tape) {
    for (const each of world?.tapes ?? []) {
      if (input.scrub !== 0) each.scrubBySeconds(input.scrub * dt * 4);
      each.update(dt);
    }
    if (performance.now() > scrubbingUntil) {
      const frame = frameAt(tape.timeline, tape.tau);
      // Building the label every frame is a string per frame for nothing: the
      // readout only changes when the frame index does.
      if (frame !== lastLabelFrame) {
        lastLabelFrame = frame;
        hud.setProgress(
          tape.fraction,
          `${frame}/${tape.timeline.frames - 1}  ${tape.tau.toFixed(1)} tau${tape.waiting ? "  (loading)" : ""}`,
        );
      } else {
        hud.setProgress(tape.fraction, null);
      }
    }
  }

  if (body.crossedInto) {
    bodyPlaced = true;
    presence.join(presenceRoomFor(body.crossedInto));
    notice(roomById(mansion, body.crossedInto)?.title ?? body.crossedInto);
  }

  view.camera.getWorldPosition(headWorld);
  presence.sendPose(headWorld.x, 0, headWorld.z, wrapAngle(headingFromCamera()));
  presence.sync();
  avatars.update(presence.peers, dt);
  hud.setHere(presence.here);

  provenance.update(view.camera, presenting);
  worldNotices.update(view.camera, presenting);

  if (perfOpen) {
    hud.setPerf(
      perf.report(view.renderer, {
        room: body.room,
        chunks: tape
          ? `${tape.stream.residentCount}/${tape.stream.maxResident} (${(tape.stream.residentBytes / 1e6).toFixed(1)} MB)`
          : "-",
        peers: presence.peers.size,
      }),
    );
  }
});

function headingFromCamera(): number {
  view.camera.getWorldDirection(_forward);
  return Math.atan2(-_forward.x, -_forward.z);
}

function wrapAngle(angle: number): number {
  const wrapped = angle % (Math.PI * 2);
  return wrapped > Math.PI
    ? wrapped - Math.PI * 2
    : wrapped < -Math.PI
      ? wrapped + Math.PI * 2
      : wrapped;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const _forward = new Vector3();

// A handle for the dev overlay, the smoke script and anyone with the console
// open. Read-only in spirit: nothing in the app reads it back.
Object.defineProperty(window, "grove", {
  value: {
    view,
    mansion,
    device,
    body,
    presence,
    perf,
    provenance,
    get world() {
      return world;
    },
  },
});

window.addEventListener("pagehide", () => presence.dispose());

boot();
