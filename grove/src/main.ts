import "./ui/grove.css";
import { MathUtils, Vector3 } from "three";
import { detectDevice } from "./device";
import { demoEnabled, demoMansion } from "./demo";
import { attachDesktopControls, type DesktopControls } from "./control/desktop";
import { consumeDeltas, createInput, type Commands } from "./control/input";
import { clampHead, createBody, step, teleport } from "./control/locomotion";
import { attachTouchControls } from "./control/touch";
import { XrControls, requestXrSession, watchXrSupport } from "./control/xr";
import { deploymentTokenSource } from "./net/auth";
import { Avatars } from "./net/avatars";
import { Presence } from "./net/presence";
import { ChatPanel } from "./ui/chat";
import { installAssetMap } from "./render/asset-map";
import { showOverdraw } from "./render/overdraw";
import { EYE_HEIGHT, createView } from "./render/view";
import { ChunkScheduler, RESIDENT_BUDGET_BYTES } from "./render/chunk-stream";
import { Hud } from "./ui/hud";
import { PerfMeter } from "./ui/perf";
import { VisitMetrics } from "./ui/diagnostics";
import { Provenance } from "./ui/provenance";
import { startGroveUpdates } from "./ui/update";
import { WorldNotices } from "./ui/worldnotice";
import { VisitorGuide } from "./ui/guide";
import { GameSurface } from "./ui/game-surface";
import { startupFailed, startupReady } from "./ui/startup";
import { finiteParameter, visitRoom } from "./world/visit";
import { frameAt } from "./tape/time";
import mansionDocument from "./world/mansion.json";
import { parseMansion, roomById } from "./world/schema";
import { buildWorld, exhibitRoom, neighbourhood, type BuiltWorld } from "./world/world";
import { PortalSystem } from "./world/portal";
import { ATLAS_LABELS, type Screen } from "./media/screen";
import type { TapeExhibit } from "./world/tape-exhibit";

// The grove. Boot order matters: the canvas renders within a frame of the
// module loading, the world streams in behind it room by room, and the network
// is the last thing to arrive and the only thing allowed to fail silently.

const canvas = document.querySelector<HTMLCanvasElement>("#stage");
const hudRoot = document.querySelector<HTMLElement>("#hud");
if (!canvas || !hudRoot) throw new Error("grove/index.html is missing #stage or #hud");

// Before any loader runs: room assets are fetched by their hashed names.
installAssetMap();

const demo = demoEnabled(import.meta.env.DEV, location.search);
const mansion = parseMansion(demo ? demoMansion(mansionDocument) : mansionDocument);
if (import.meta.env.VITE_FTL_CHESS_ENABLED !== "1") {
  for (const room of mansion.rooms) {
    room.gameSurfaces = room.gameSurfaces.filter((surface) => surface.provider !== "ftlchess");
  }
}
const device = detectDevice();
hudRoot.classList.toggle("touch", device.touch);
const input = createInput();
const perf = new PerfMeter();
const visitMetrics = new VisitMetrics();
const avatars = new Avatars();
const worldNotices = new WorldNotices();
const chunks = new ChunkScheduler({
  maxResidentBytes: RESIDENT_BUDGET_BYTES[device.tier],
  onError: (error) => console.info(`[stream] ${error.message}`),
});

const view = await createView(canvas, device, {
  onContextLost: (restored) =>
    notice(
      restored
        ? "the graphics context came back"
        : "the browser took the graphics context away; it will come back on its own",
    ),
});
view.scene.add(avatars.group, worldNotices.panel);

// `?room=<id>&yaw=<deg>` starts a visit in another room: for looking at a
// room while it is built, and for a link straight to a tree's room.
const query = new URLSearchParams(location.search);
const startRoom = visitRoom(mansion, query);
const requestedYaw = finiteParameter(query, "yaw");
const requestedPitch = finiteParameter(query, "pitch");
const requestedX = finiteParameter(query, "x");
const requestedZ = finiteParameter(query, "z");
const startYaw = requestedYaw ?? startRoom.spawn.yawDeg;
view.renderer.toneMappingExposure = startRoom.exposure;
const body = createBody(
  startRoom.spawn.position[0],
  startRoom.spawn.position[2],
  MathUtils.degToRad(startYaw),
  startRoom.id,
  startRoom.scale,
);
// `&pitch=<deg>` looks up or down from the start, for a link to something high;
// `&x=&z=` stand somewhere else in the room, and then the marker leaves them be.
if (requestedPitch !== null) body.pitch = MathUtils.degToRad(requestedPitch);
if (requestedX !== null) body.x = MathUtils.clamp(requestedX, startRoom.bounds.min[0], startRoom.bounds.max[0]);
if (requestedZ !== null) body.z = MathUtils.clamp(requestedZ, startRoom.bounds.min[2], startRoom.bounds.max[2]);
// `&debug=overdraw` draws the room shells as faint additive white, so a
// doubled or hidden face shows as a brighter patch (render/overdraw.ts).
const debugView = query.get("debug");
/** Until the visitor moves, the asset's own spawn marker may still move them. */
let bodyPlaced = false;

const hud = new Hud(hudRoot, {
  onEnterVr: () => void enterVr(),
  onTogglePlay: () => commands.togglePlay(),
  onScrub: (fraction) => {
    for (const tape of world?.tapes ?? []) tape?.scrubToFraction(fraction);
    scrubbingUntil = performance.now() + 400;
  },
  onScrubEnd: () => {
    scrubbingUntil = 0;
  },
  onSpeed: (speed) => {
    for (const tape of world?.tapes ?? []) tape?.setSpeed(speed);
    hud.setSpeed(speed);
  },
  onUnmute: () => void toggleAudio(),
  onAtlas: (mode) => void chooseAtlas(mode),
  onProvenance: () => provenance.toggle(view.camera),
  onReport: (identity, reason) =>
    presence.report(identity, reason).then(
      () => notice("Report sent to the host. Thank you."),
      (error: unknown) => {
        notice(`Report not sent: ${message(error)}`);
        throw error;
      },
    ),
  onRename: (name) =>
    presence.rename(name).then(
      () => notice(presence.online ? "Name changed" : "Name kept for when you are connected"),
      (error: unknown) => {
        notice(`Name not changed: ${message(error)}`);
        throw error;
      },
    ),
  onModerate: (identity, action) => {
    const who = presence.peers.get(identity)?.name ?? "them";
    const done =
      action.kind === "mute"
        ? `${who} ${action.muted ? "muted" : "unmuted"}`
        : action.kind === "kick"
          ? `${who} kicked for ten minutes`
          : `${who} banned${action.minutes === 0 ? " for good" : ""}${action.network ? ", with their network" : ""}`;
    return presence.moderate(identity, action).then(
      () => notice(done),
      (error: unknown) => {
        notice(`Not done: ${message(error)}`);
        throw error;
      },
    );
  },
});
const provenance = new Provenance(hud.provenancePanel);
view.scene.add(provenance.panel);
let desktopControls: DesktopControls | null = null;
const gameSurface = new GameSurface(hudRoot, {
  onLifecycle: (event) => console.info(`[grove] game surface ${event.event}`),
  onClose: () => {
    activeScreen = null;
    canvas.focus();
    handOverVideo(true);
  },
});
const guide = new VisitorGuide(hudRoot, mansion, device, () => {
  canvas.focus();
  if (!device.headset) desktopControls?.requestLock();
}, (surface) => {
  if (view.renderer.xr.isPresenting) {
    notice("Leave immersive VR before opening this browser game.");
    return;
  }
  if (document.pointerLockElement) document.exitPointerLock();
  activeScreen?.release();
  gameSurface.open(surface, canvas);
});
guide.setRoom(startRoom.id);
if (query.has("room") && query.get("room") !== startRoom.id) {
  hud.notice(`That room is not here. You have arrived in ${startRoom.title.replace(/^The /, "the ") || startRoom.id} instead.`);
}

/** Every failure surface at once: the HUD, and the board that exists in VR. */
function notice(text: string, sticky = false): void {
  hud.notice(text, sticky);
  worldNotices.push(text);
  // Mirrored to the console so a headless run can be read after the fact.
  console.info(`[grove] ${text}`);
}

// Room chat, flat mode only (VR-PRESENCE.md §3). Hidden until the link is up:
// there is nothing to say to a room you are visiting on your own.
const chat = new ChatPanel(hudRoot, {
  onSend: (text) => presence.say(text),
  // A locked pointer cannot be typed past, so the line takes it and the next
  // click in the view gives it back (control/desktop.ts re-locks on click).
  onFocusChange: (open) => {
    if (open && document.pointerLockElement) document.exitPointerLock();
  },
});

const presence = new Presence(
  {
    onStatus: (status, detail) => {
      hud.setMe(presence.me, presence.name);
      // Chat is only meaningful with a link; single-player has no room to
      // speak into, and a dead input is worse than no input.
      if (status === "online") chat.show();
      else chat.hide();
      if (status === "online") hud.setLink("connected");
      else if (status === "connecting") hud.setLink("connecting…");
      else {
        hud.setLink("visiting on your own", true);
        if (detail && detail !== lastLinkDetail) {
          lastLinkDetail = detail;
          notice("The link to other visitors is unavailable. You can keep exploring; reconnecting.");
        }
      }
    },
    onNotice: (text) => notice(text),
    onChat: (line) => chat.addLine(line),
  },
  // The grove's token service, when this build has one (a human check, then
  // a token that carries the visitor's identity from visit to visit).
  demo ? {} : { token: deploymentTokenSource(hudRoot) },
);
let lastLinkDetail = "";

let perfOpen = false;
let nextPerfReport = 0;
let nextAudioReassign = 0;
let scrubbingUntil = 0;

const commands: Commands = {
  togglePlay: () => {
    const tape = nearestTape();
    if (!tape) {
      // No tape here: the room's playing screen (a planet) takes the key.
      if (activeScreen?.togglePlay && exhibitRoom(activeScreen) === body.room) hud.setPlaying(activeScreen.togglePlay());
      return;
    }
    const playing = tape.togglePlay();
    for (const other of world?.tapes ?? []) other?.setPlaying(playing);
    hud.setPlaying(playing);
  },
  nudgeFrames: (delta) => {
    for (const tape of world?.tapes ?? []) tape?.nudgeFrames(delta);
  },
  cycleSpeed: () => {
    const tape = nearestTape();
    if (!tape) return;
    const speed = tape.cycleSpeed();
    for (const other of world?.tapes ?? []) other?.setSpeed(speed);
    hud.setSpeed(speed);
    notice(`${speed}x`);
  },
  cycleAtlas: () => {
    const screen = activeScreen;
    if (!screen?.atlases || !screen.atlas) return;
    const next = screen.atlases[(screen.atlases.indexOf(screen.atlas) + 1) % screen.atlases.length]!;
    void chooseAtlas(next);
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
    if (!teleport(body, mansion, x, z, lockedRoom)) notice("nothing to stand on there");
  },
  onNotice: (text) => notice(text),
});
view.scene.add(xr.marker);

// The portals: soft spheres that show the other scale and step the body
// through. Their meshes live beside the world, not in it, so a far view can
// hide them while it renders.
const portals = new PortalSystem(mansion, view.renderer);
portals.setScale(startRoom.scale);
view.world.add(portals.group);

const HINT = "Click the view to look around · W A S D to walk · Escape releases the pointer";
if (device.touch) {
  attachTouchControls(hudRoot, canvas, input);
} else {
  desktopControls = attachDesktopControls(canvas, input, commands,
    (locked) => hud.setHint(locked ? null : HINT),
    () => hud.notice("Your browser could not capture the pointer. Click the view to try again, or open Guide to choose a room."));
  hud.setHint(HINT);
}
watchXrSupport((supported) => hud.setXrAvailable(supported));

let world: BuiltWorld | null = null;
const EXHIBIT_WAIT_MS = 8000;
const headWorld = new Vector3();

function boot(): void {
  hud.setHere(1);
  hud.setLink(demo ? "local demo" : "connecting…");
  if (demo) notice("Local demo · synthetic particles", true);
  else {
    presence.connect(presenceRoomFor(body.room));
    chat.noteJoined();
  }

  const built = buildWorld({
    mansion,
    startRoom: body.room,
    renderer: view.renderer,
    device,
    scheduler: chunks,
    provenance,
    onNotice: (text) => notice(text),
    // The hangings wait this long for the live exhibit table, then take the
    // pinned ids: a slow link costs seconds, a dead one costs nothing.
    exhibits: demo ? undefined : () => presence.whenExhibits(EXHIBIT_WAIT_MS),
    onRoomReady: (room, shell) => {
      if (room.id === startRoom.id) {
        visitMetrics.roomReady();
        startupReady();
        guide.welcome();
      }
      if (debugView === "overdraw") showOverdraw(shell.group);
      // The asset's spawn marker is the authority; if the visitor has not
      // moved yet, put them where the bake says the room starts.
      if (room.id !== body.room || bodyPlaced) return;
      if (requestedX === null && requestedZ === null) {
        body.x = room.spawn.position[0];
        body.z = room.spawn.position[2];
      }
      // ...except the heading when the link asked for one: `?yaw=` is for
      // looking at a particular wall, and the marker must not turn it away.
      if (requestedYaw === null) body.yaw = MathUtils.degToRad(room.spawn.yawDeg);
    },
  });
  world = built;
  built.setScaleVisible(body.scale);
  // The group goes into the scene empty: the first frame is a room, not a
  // black page, and each shell appears as it lands.
  view.world.add(built.group);
  built
    .load()
    .then(() => {
      handOverVideo(true);
    })
    .catch((error: unknown) => {
      startupFailed();
      notice(`The world did not finish loading: ${message(error)}`, true);
    });
}

function presenceRoomFor(roomId: string): string {
  return roomById(mansion, roomId)?.presence ?? "grove";
}

/**
 * A doorway into a room the server will not let this visitor into is a wall.
 *
 * Walking in and being refused afterwards is what made a phantom: the body is
 * in one room while presence is in another, and the avatar stands at this
 * room's coordinates in that room's space. Locking the door keeps the two
 * halves of a visitor in the same place. In the demo there is no server, so
 * there are no locks.
 */
function lockedRoom(roomId: string): boolean {
  return !demo && !presence.canEnter(presenceRoomFor(roomId));
}

/** Said once per locked room, not once per frame the visitor leans on it. */
let toldAboutLock: string | null = null;
function tellAboutLock(roomId: string | null): void {
  if (roomId === null) {
    toldAboutLock = null;
    return;
  }
  if (roomId === toldAboutLock) return;
  toldAboutLock = roomId;
  const title = roomById(mansion, roomId)?.title ?? roomId;
  const why = presence.whyLocked(presenceRoomFor(roomId));
  notice(why === null ? `${title} is not open just now.` : `${title}: ${why}.`);
}

async function enterVr(): Promise<void> {
  try {
    const session = await requestXrSession();
    await view.renderer.xr.setSession(session);
  } catch (error) {
    notice(`VR did not start: ${message(error)}`);
  }
}

// One screen plays at a time (media/screen.ts): the wall or planet nearest
// the visitor holds the decoder, and walking to another hands it over.
// Re-checked a few times a second, not every frame; a hand-over restarts the
// stream.
let activeScreen: Screen | null = null;
let nextWallCheck = 0;
function handOverVideo(force = false): void {
  const now = performance.now();
  if (!force && now < nextWallCheck) return;
  nextWallCheck = now + 400;
  // Only the screens of the room the visitor is in are candidates: a wall seen
  // through a doorway stays a poster, and leaving a room releases its decoder.
  const screens: Screen[] = [...(world?.videos ?? []), ...(world?.planets ?? [])].filter(
    (s) => exhibitRoom(s) === body.room,
  );
  let nearest: Screen | null = null;
  let best = Infinity;
  for (const screen of screens) {
    const dx = screen.position.x - body.x;
    const dz = screen.position.z - body.z;
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      nearest = screen;
    }
  }
  if (nearest === activeScreen) return;
  activeScreen?.release();
  activeScreen = nearest;
  hud.setUnmuteAvailable(false);
  hud.setMuted(nearest?.muted ?? true);
  syncAtlasHud();
  if (!nearest) return;
  void nearest.attach().then((playing) => {
    if (playing && activeScreen === nearest) {
      hud.setUnmuteAvailable(nearest.hasAudio);
      if (nearest.togglePlay) hud.setPlaying(true);
    }
  });
}

/** The mode buttons follow the screen that holds the decoder: a planet's modes, or nothing. */
function syncAtlasHud(): void {
  const screen = activeScreen;
  if (!screen?.atlases || !screen.atlas) {
    hud.setAtlas(null);
    return;
  }
  hud.setAtlas({
    modes: screen.atlases.map((id) => ({ id, label: ATLAS_LABELS[id] ?? id })),
    current: screen.atlas,
    legend: screen.legendUrl?.(screen.atlas) ?? null,
  });
}

async function chooseAtlas(mode: string): Promise<void> {
  const screen = activeScreen;
  if (!screen?.setAtlas || !screen.atlases?.includes(mode)) return;
  try {
    await screen.setAtlas(mode);
    if (activeScreen === screen) {
      syncAtlasHud();
      notice(ATLAS_LABELS[mode] ?? mode);
    }
  } catch (error) {
    notice(`That view could not load: ${message(error)}`);
  }
}

// The HUD's frame and source-time readout follows the tape nearest the visitor; the
// transport still drives every tape in step.
let nearestTapeCached: TapeExhibit | null = null;
let nextTapeCheck = 0;
function nearestTape(): TapeExhibit | null {
  const now = performance.now();
  if (now < nextTapeCheck && nearestTapeCached) return nearestTapeCached;
  nextTapeCheck = now + 400;
  let best = Infinity;
  nearestTapeCached = null;
  for (const tape of world?.tapes ?? []) {
    if (!tape || exhibitRoom(tape) !== body.room) continue;
    // The exhibit's group sits at the origin; its bounds carry the metres.
    const cx = (tape.bounds.min.x + tape.bounds.max.x) / 2;
    const cz = (tape.bounds.min.z + tape.bounds.max.z) / 2;
    const dx = cx - body.x;
    const dz = cz - body.z;
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      nearestTapeCached = tape;
    }
  }
  return nearestTapeCached;
}

async function toggleAudio(): Promise<void> {
  const video = activeScreen;
  if (!video || video.mode === "poster" || !video.hasAudio) return;
  if (video.muted) await video.unmute();
  else video.mute();
  hud.setMuted(video.muted);
  notice(video.muted ? "muted" : "unmuted");
}

let lastLabelFrame = -1;
let lastLabelWaiting = false;
let lastHudTape: TapeExhibit | null = null;

/** The eye adapts toward the room's exposure, most of the way in a second. */
function adaptExposure(dt: number): void {
  const target = roomById(mansion, body.room)?.exposure ?? 1;
  const now = view.renderer.toneMappingExposure;
  const k = Math.min(1, dt * 3);
  view.renderer.toneMappingExposure = Math.abs(target - now) < 1e-3 ? target : now + (target - now) * k;
}

view.start((dt, time, rawDt) => {
  const presenting = view.renderer.xr.isPresenting;
  perf.setTargetHz(presenting ? 72 : 60);
  perf.sample(rawDt);

  if (presenting) xr.update();
  // In XR you walk where you look; on a desktop the body's yaw is the heading.
  const heading = presenting ? headingFromCamera() : body.yaw;
  const movingBefore = input.forward !== 0 || input.strafe !== 0;
  step(body, input, dt, mansion, heading, lockedRoom);
  if (movingBefore) bodyPlaced = true;
  consumeDeltas(input);

  view.rig.position.set(body.x, 0, body.z);
  adaptExposure(dt);
  handOverVideo();
  if (presenting) {
    // Room-scale walking can take the head through a wall the rig never met.
    view.camera.getWorldPosition(headWorld);
    const push = clampHead(body, headWorld.x, headWorld.z, mansion, lockedRoom);
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

  // The portals see this frame's eye: a far view for the one in reach, and
  // the step through when the eye is at a portal's core.
  view.rig.updateMatrixWorld(true);
  const crossing = portals.update({
    body,
    camera: view.camera,
    scene: view.scene,
    worldRoot: view.world,
    live: !presenting,
    setScaleVisible: (scale) => world?.setScaleVisible(scale),
  });
  if (crossing) {
    body.x = crossing.x;
    body.z = crossing.z;
    body.room = crossing.room;
    body.scale = crossing.scale;
    body.crossedInto = crossing.room;
    view.rig.position.set(body.x, 0, body.z);
    world?.setScaleVisible(body.scale);
    portals.setScale(body.scale);
    handOverVideo(true);
  }
  for (const planet of world?.planets ?? []) planet.update();

  const tape = nearestTape();
  hud.setScrubberVisible(tape !== null);
  if (tape !== lastHudTape) {
    lastHudTape = tape;
    lastLabelFrame = -1;
    if (tape) {
      hud.setPlaying(tape.playing);
      hud.setSpeed(tape.speed);
    }
  }
  if (tape) {
    for (const each of world?.tapes ?? []) {
      // A slot still loading is null; one throw here would skip presence and
      // the HUD below for every frame until it lands.
      if (!each) continue;
      if (input.scrub !== 0) each.scrubBySeconds(input.scrub * dt * 4);
      // Tapes advance only in the room the visitor is in; the others freeze
      // where they are and cost no frame time. Scrubbing moves them all, so
      // tapes that share a clock stay in step when the visitor comes back.
      if (exhibitRoom(each) === body.room) each.update(dt);
    }
    if (!tape.waiting) visitMetrics.tapeReady();
    if (performance.now() > scrubbingUntil) {
      const frame = frameAt(tape.timeline, tape.tau);
      // Building the label every frame is a string per frame for nothing: the
      // readout only changes when the frame index does.
      if (frame !== lastLabelFrame || tape.waiting !== lastLabelWaiting) {
        lastLabelFrame = frame;
        lastLabelWaiting = tape.waiting;
        hud.setProgress(
          tape.fraction,
          `${frame}/${tape.timeline.frames - 1}  ${tape.frameTimeLabel} ${tape.timeUnit}${tape.waiting ? "  (loading)" : ""}`,
        );
      } else {
        hud.setProgress(tape.fraction, null);
      }
    }
  }

  tellAboutLock(body.lockedOut);
  if (body.crossedInto) {
    void world?.ensureRooms(neighbourhood(mansion, body.crossedInto)).catch((error: unknown) =>
      notice(`This room did not finish loading: ${message(error)}. Reload to try again.`, true));
    bodyPlaced = true;
    if (!demo) {
      presence.join(presenceRoomFor(body.crossedInto));
      // The module stamps its chat clock on join, so the first line straight
      // after crossing would be refused; the panel holds the gap instead.
      chat.noteJoined();
    }
    guide.setRoom(body.crossedInto);
    notice(roomById(mansion, body.crossedInto)?.title ?? body.crossedInto);
  }

  view.camera.getWorldPosition(headWorld);
  if (!demo) presence.sendPose(headWorld.x, 0, headWorld.z, wrapAngle(headingFromCamera()));
  if (presence.sync()) {
    hud.setPeople(presence.peers.values());
    hud.setMe(presence.me, presence.name);
  }
  avatars.update(presence.peers, dt);
  hud.setHere(presence.here);

  provenance.update(view.camera, presenting);
  worldNotices.update(view.camera, presenting);

  // A live audio exhibit's field needs the visitor's head every frame -- that
  // is the whole of what makes a positioned source mean anything -- but the
  // ranking of which node gets which source only changes when the visitor has
  // MOVED, and rebuilding a panner is not free. So the listener moves at frame
  // rate and the sources are re-ranked four times a second
  // (AUDIO-STREAM.md §5, grove/src/audio/field.ts).
  if (world && world.audios.length > 0) {
    view.camera.getWorldDirection(_forward);
    const reassign = time >= nextAudioReassign;
    if (reassign) nextAudioReassign = time + 250;
    for (const audio of world.audios) {
      audio.setListener([headWorld.x, headWorld.y, headWorld.z], [_forward.x, _forward.y, _forward.z]);
      if (reassign) audio.reassign();
    }
  }

  if (perfOpen && time >= nextPerfReport) {
    nextPerfReport = time + 500;
    hud.setPerf(
      perf.report(view.renderer, {
        room: body.room,
        chunks: tape
          ? `${tape.stream.residentCount}/${tape.stream.maxResident} (${(tape.stream.residentBytes / 1e6).toFixed(1)} MB)`
          : "-",
        stream: `${chunks.residentCount} resident, ${chunks.inflightCount} fetching`,
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
    metrics: () => ({
      schema: "grove-visit-metrics/1",
      build: import.meta.env.VITE_COMMIT ?? "development",
      builtAt: import.meta.env.VITE_BUILT_AT ?? null,
      demo,
      room: body.room,
      device: { ...device },
      backend: view.backend,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: view.renderer.getPixelRatio() },
      visit: visitMetrics.snapshot(),
      frames: perf.snapshot(),
      rendering: { ...view.renderer.info.render, ...view.renderer.info.memory, programs: ("programs" in view.renderer.info ? (view.renderer.info as { programs?: unknown[] }).programs?.length : 0) ?? 0 },
      streaming: { residentBytes: chunks.residentBytes, residentCount: chunks.residentCount, inflightCount: chunks.inflightCount },
      tapes: (world?.tapes ?? []).filter((tape) => tape !== null).map((tape) => ({
        room: exhibitRoom(tape), residentChunks: tape.stream.residentCount,
        residentBytes: tape.stream.residentBytes, waiting: tape.waiting,
      })),
      gameSurface: gameSurface.snapshot(),
    }),
    provenance,
    get world() {
      return world;
    },
  },
});

window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  presence.dispose();
  gameSurface.dispose();
  chunks.dispose();
  visitMetrics.dispose();
});

boot();
// The service worker (cache, offline hall, media integrity) and the reload
// offer after a deploy; both off in `vite dev`.
startGroveUpdates({ tier: device.tier, hud, xr: view.renderer.xr });
