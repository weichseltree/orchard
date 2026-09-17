import "./ui/grove.css";
import { MathUtils, Vector3 } from "three";
import { detectDevice } from "./device";
import { demoEnabled, demoMansion } from "./demo";
import { attachDesktopControls, type DesktopControls } from "./control/desktop";
import { consumeDeltas, createInput, type Commands } from "./control/input";
import { clampHead, createBody, settle, step, teleport } from "./control/locomotion";
import { attachTouchControls } from "./control/touch";
import { XrControls, requestXrSession, watchXrSupport } from "./control/xr";
import { deploymentTokenSource } from "./net/auth";
import { Avatars } from "./net/avatars";
import { knowsCue } from "./world/broadcast";
import { Turnstile } from "./world/turnstile";
import { VOICE_URL } from "./config";
import type { WorldChat } from "./ui/world-chat";
import type { WristMenu } from "./ui/wrist-menu";
import { CLOSED, stepAsk, type AskEvent } from "./ui/ask-menu";
import { FAYE_ROOM, whereIsFaye } from "./faye/names";
import type { ChatEntry } from "./ui/chat-log";
import { voiceSupported } from "./voice/support";
import type { VoiceCapture } from "./voice/capture";
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
import { startGroveUpdates, type GroveUpdates } from "./ui/update";
import { WorldNotices } from "./ui/worldnotice";
import { VisitorGuide } from "./ui/guide";
import { GameSurface } from "./ui/game-surface";
import { startupFailed, startupReady } from "./ui/startup";
import { finiteParameter, visitRoom } from "./world/visit";
import { NOTHING_ON, barredRooms, nearbyNeeds, pulseGain, retreat, unmetNeeds, venueBarred, venueBox, venueReason, type VenueState } from "./world/venue";
import type { VenueCurtains } from "./world/venue-curtain";
import { setPulse, setPulseBox } from "./world/pulse";
import type { VenueGear } from "./audio/venue-gear";
import type { BeatFollower } from "./audio/beat";
import { frameAt } from "./tape/time";
import mansionDocument from "./world/mansion.json";
import { parseMansion, roomById, type GameSurface as GameSurfaceConfig } from "./world/schema";
import { buildWorld, exhibitRoom, neighbourhood, type BuiltWorld } from "./world/world";
import { PortalSystem } from "./world/portal";
import { pickLocale } from "./ui/locale";
import { AVAILABLE_LOCALES, labelsFor, labelsLoaded, roomTitle } from "./world/labels/index";
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
// A link into the club lands in its foyer: the door is met, not skipped (world/venue.ts).
const startRoom = visitRoom(mansion, query, { gated: !demo });
// The wall plaques speak the visitor's language: the browser's list, `?lang=` first, English last.
const locale = pickLocale(AVAILABLE_LOCALES, navigator.languages, query.get("lang"));
void labelsFor(locale).catch(() => labelsFor("en"));
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
  startRoom.bounds.min[1],
);
// `&pitch=<deg>` looks up or down from the start, for a link to something high;
// `&x=&z=` stand somewhere else in the room, and then the marker leaves them be.
if (requestedPitch !== null) body.pitch = MathUtils.degToRad(requestedPitch);
if (requestedX !== null) body.x = MathUtils.clamp(requestedX, startRoom.bounds.min[0], startRoom.bounds.max[0]);
if (requestedZ !== null) body.z = MathUtils.clamp(requestedZ, startRoom.bounds.min[2], startRoom.bounds.max[2]);
settle(body, mansion);
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
  onGuide: () => guide.show(),
  onToggleChat: () => {
    if (!chat.open) {
      notice("Chat opens once you are connected to the room.");
      return;
    }
    chat.setFolded(!chat.folded);
    hud.setDockOpen("chat", !chat.folded);
  },
  onOpenGame: () => commands.openGame(),
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
}, (surface) => openGameSurface(surface));
guide.onOpenChange = (open) => hud.setDockOpen("guide", open);

/** A browser game over the world: from the Guide anywhere in its room, or at its table (G, or the offer). */
function openGameSurface(surface: GameSurfaceConfig): void {
  if (view.renderer.xr.isPresenting) {
    notice("Leave immersive VR before opening this browser game.");
    return;
  }
  if (document.pointerLockElement) document.exitPointerLock();
  activeScreen?.release();
  offeredSurface = null;
  hud.setGameOffer(null);
  gameSurface.open(surface, canvas);
}
guide.setRoom(startRoom.id);
if (query.has("room") && query.get("room") !== startRoom.id) {
  const asked = roomById(mansion, query.get("room") ?? "");
  const here = startRoom.title.replace(/^The /, "the ") || startRoom.id;
  hud.notice(asked
    ? `${asked.title || asked.id} asks for ${asked.requires.map((need) => need === "immersive" ? "a headset" : `your ${need} on`).join(" and ")}. You have arrived in the ${here}, where its door is.`
    : `That room is not here. You have arrived in ${here} instead.`);
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
// One token source for the whole page: presence and voice both need the
// grove token, and two managers would mean two human checks.
const tokenSource = demo ? undefined : deploymentTokenSource(hudRoot);

// Voice is offered only when this build has the route AND this browser can
// actually record (VR-PRESENCE §6). The capture object is built after the
// panel because its callbacks talk to the panel, so the panel is handed a
// thin driver rather than the object itself.
let voiceCapture: VoiceCapture | null = null;
const canSpeak = Boolean(VOICE_URL && tokenSource && voiceSupported());

const chat = new ChatPanel(hudRoot, {
  onSend: async (text) => {
    // Chat reaches only this room, and every way of asking her works in every
    // room: say where she is rather than leave the question in silence
    // (faye/names.ts). English, like the log's other system lines. The room
    // and who is in it are read BEFORE the send, from the view itself: a
    // visitor can walk through a door while it is in flight, and `peers` lags
    // a room change until the next frame's sync.
    const fayeRoom = mansion.rooms.find((room) => room.presence === FAYE_ROOM)?.title ?? "hall";
    const away = whereIsFaye(text, presence.peopleInRoom(), presence.joinedRoom, fayeRoom);
    await presence.say(text);
    if (away) chat.addSystemLine(away);
  },
  // A locked pointer cannot be typed past, so the line takes it and the next
  // click in the view gives it back (control/desktop.ts re-locks on click).
  onFocusChange: (open) => {
    if (open && document.pointerLockElement) document.exitPointerLock();
  },
  onLinesChanged: (lines) => {
    chatLines = lines;
    worldChat?.setLines(lines);
  },
  voice: canSpeak
    ? {
        begin: async () => {
          await loadVoice();
          await voiceCapture?.begin();
        },
        end: () => voiceCapture?.end(),
        prime: async () => {
          await loadVoice();
          return (await voiceCapture?.prime()) ?? false;
        },
      }
    : undefined,
});

/**
 * Loads the voice code on demand, once.
 *
 * Voice is a few dozen kB that most visitors never press, so it is not in the
 * startup bundle -- `voice/support.ts` is import-free precisely so the button
 * can be offered without it. `prime()` runs this early, so the first press is
 * not waiting on a download as well as a permission prompt.
 */
let voiceLoad: Promise<void> | null = null;
function loadVoice(): Promise<void> {
  if (!canSpeak) return Promise.resolve();
  voiceLoad ??= import("./voice/browser").then(({ browserVoice }) => {
    voiceCapture = browserVoice(
      { base: VOICE_URL, token: tokenSource },
      {
        onUtterance: (text) => chat.sayHeard(text),
        onCaption: (text) => chat.showCaption(text),
        // A failed microphone is something to read in the room, not a console
        // message: the visitor pressed a button and deserves an answer.
        onError: (message) => chat.addSystemLine(message),
      },
    );
  });
  return voiceLoad;
}

const presence = new Presence(
  {
    onStatus: (status, detail) => {
      hud.setMe(presence.me, presence.name);
      // Chat is only meaningful with a link; single-player has no room to
      // speak into, and a dead input is worse than no input.
      if (status === "online") chat.show();
      else chat.hide();
      hud.setDockOpen("chat", chat.open && !chat.folded);
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
    onChat: (line) => {
      chat.addLine(line);
      // A peer's line hangs above their capsule for a few seconds (avatars.ts),
      // which is the one part of chat a headset can see. The line carries a
      // name, not an identity; the room's peers resolve it.
      if (!line.mine) {
        for (const peer of presence.peers.values()) {
          if (peer.name === line.name) avatars.speak(peer.identity, line.text);
        }
      }
    },
    // A world event the gate has already vouched for: it arrived after we
    // subscribed, it is for this room, it has not expired and we have not
    // acted on it before (world/broadcast.ts). All that is left is to show it.
    onBroadcast: (action) => {
      if (action.kind === "notice") {
        notice(action.text);
        return;
      }
      // A cue we cannot draw is silence. Firing the words instead would turn a
      // missing animation into a notice nobody asked for, and the host who
      // sent it would have no way to tell it had not played.
      if (!knowsCue(action.cue)) return;
      if (action.text.trim() !== "") notice(action.text);
      if (action.cue === "update") updates?.checkNow();
      if (action.cue === "turnstile") turnstile.hold(action.holdMs, action.text, performance.now());
    },
  },
  // The grove's token service, when this build has one (a human check, then
  // a token that carries the visitor's identity from visit to visit).
  tokenSource ? { token: tokenSource } : {},
);
let lastLinkDetail = "";

// The chat log a headset can read. DOM is not shown in an immersive session,
// so the same lines are drawn into a canvas and hung in front of the visitor.
//
// Built on the first session rather than at startup: it is a panel only a
// headset ever sees, and the startup budget is what a visitor downloads before
// they can walk around. Voice is deferred for the same reason.
let worldChat: WorldChat | null = null;
let worldChatLoad: Promise<void> | null = null;
let chatLines: readonly ChatEntry[] = [];
// The ask menu: the only way to say anything from inside a headset, since the
// microphone button is DOM (ui/ask-menu.ts). Its state lives here and XR
// controls only report inputs, so the menu's rules stay pure and tested.
/** Bound once the update watcher starts; an `update` cue before then is a no-op. */
let updates: GroveUpdates | null = null;
const turnstile = new Turnstile();

let askState = CLOSED;
let wristMenu: WristMenu | null = null;
function onAskEvent(event: AskEvent): void {
  const step = stepAsk(askState, event);
  askState = step.state;
  wristMenu?.wear(xr.controllerFor("left"));
  wristMenu?.show(askState);
  // Through the typed path, like a spoken line: the rate limit, the clip, and
  // a refusal that lands in the log a headset can read rather than nowhere.
  if (step.say) chat.sayHeard(step.say);
}

view.renderer.xr.addEventListener("sessionstart", () => {
  worldChatLoad ??= Promise.all([import("./ui/world-chat"), import("./ui/wrist-menu")]).then(
    ([{ WorldChat: Panel }, { WristMenu: Menu }]) => {
      const panel = new Panel();
      // Whatever was already said, so entering VR mid-conversation is not a
      // blank panel until the next line.
      panel.setLines(chatLines);
      view.scene.add(panel.panel);
      worldChat = panel;
      wristMenu = new Menu();
      wristMenu.wear(xr.controllerFor("left"));
      wristMenu.show(askState);
    },
  );
});

let perfOpen = false;
let nextPerfReport = 0;
const pulseActive = venueBox(mansion) !== null;
let barredKey = -1;
let barred: ReadonlySet<string> = barredRooms(mansion, NOTHING_ON);
let nextAudioReassign = 0;
let scrubbingUntil = 0;

const commands: Commands = {
  openGame: () => {
    const surface = nearbyGameSurface();
    if (surface) openGameSurface(surface);
  },
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
  // In a headset the offers are not on any screen: the trigger takes them.
  // A microphone cannot be allowed inside the session; sound can.
  confirm: () => {
    if (view.renderer.xr.isPresenting && nearbyNeeds(mansion, body.room, venueState()).includes("sound")) {
      void switchSoundOn();
      return true;
    }
    return false;
  },
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
  askMenu: {
    isOpen: () => askState.open,
    onEvent: onAskEvent,
  },
  voice: canSpeak
    ? {
        begin: () => void talkInHeadset(),
        end: () => voiceCapture?.end(),
      }
    : undefined,
});

/**
 * A talk turn from a headset.
 *
 * A permission prompt cannot be shown inside an immersive session. If the
 * browser already remembers a grant, the microphone simply opens; if not, the
 * visitor is told how to give it, in the log a headset can read, rather than
 * pressing a stick that does nothing.
 */
async function talkInHeadset(): Promise<void> {
  await loadVoice();
  if (!voiceCapture) return;
  if (!(await voiceCapture.prime())) {
    chat.addSystemLine("To talk in the headset, allow the microphone first: outside VR, hold “Hold to talk” once.");
    return;
  }
  await voiceCapture.begin();
}
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
    // A visitor who arrives at the venue's door by link meets its offers at once.
    offerVenue();
  }

  const built = buildWorld({
    mansion,
    startRoom: body.room,
    locale,
    renderer: view.renderer,
    device,
    scheduler: chunks,
    provenance,
    onNotice: (text) => notice(text),
    // The hangings wait this long for the live exhibit table, then take the
    // pinned ids: a slow link costs seconds, a dead one costs nothing.
    exhibits: demo ? undefined : () => presence.whenExhibits(EXHIBIT_WAIT_MS),
    audioContext: () => loadGear().then((g) => g.gate.context),
    onAudio: () => syncVenueSound(),
    onRoomReady: (room, shell) => {
      // The sealed lenses over this room's closed doors may show now that their recesses stand.
      portals.roomReady(room.id);
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
      settle(body, mansion);
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
      syncVenueSound();
    })
    .catch((error: unknown) => {
      startupFailed();
      notice(`The world did not finish loading: ${message(error)}`, true);
    });
}

function presenceRoomFor(roomId: string): string {
  return roomById(mansion, roomId)?.presence ?? "grove";
}

// The venue's doors (world/venue.ts, docs/specs/CLUB.md). What the visitor
// has on is read live from the sound gate, the microphone grant and the XR
// session, so a door that was open closes again when the browser suspends
// the audio or a track ends; the demo has no doors to ask.
let gear: VenueGear | null = null;
let gearLoad: Promise<VenueGear> | null = null;
/** The two switches, made on first need; their answers are kept here so the door can be asked every frame. */
function loadGear(): Promise<VenueGear> {
  gearLoad ??= import("./audio/venue-gear").then(({ createVenueGear }) => {
    gear = createVenueGear();
    gear.gate.onChange(venueChanged);
    gear.microphone.onChange(venueChanged);
    return gear;
  });
  return gearLoad;
}
function venueState(): VenueState {
  if (demo) return { microphone: true, sound: true, immersive: true };
  return { microphone: gear?.microphone.live ?? false, sound: gear?.gate.enabled ?? false, immersive: view.renderer.xr.isPresenting };
}
// The curtains over the venue's doors and the beat follower are loaded off
// the startup path: a palace with no venue never pays for them.
let curtains: VenueCurtains | null = null;
if (venueBox(mansion) && !demo) {
  void import("./world/venue-curtain").then(({ VenueCurtains }) => {
    curtains = new VenueCurtains(mansion);
    view.world.add(curtains.group);
  });
}
setPulseBox(venueBox(mansion));
/** The offers standing in the HUD, one per need, until the need is met. */
const venueOffers = new Map<"microphone" | "sound", HTMLElement>();
function offerVenue(): void {
  const state = venueState();
  const needs = nearbyNeeds(mansion, body.room, state);
  for (const [need, element] of venueOffers) {
    if (!needs.includes(need)) {
      element.remove();
      venueOffers.delete(need);
    }
  }
  if (needs.includes("microphone") && !venueOffers.has("microphone")) {
    venueOffers.set("microphone", hud.offer("The club asks for your microphone.", "Allow the microphone", () => void allowMicrophone()));
  }
  if (needs.includes("sound") && !venueOffers.has("sound")) {
    venueOffers.set("sound", hud.offer("The club asks for your sound.", "Sound on", () => void switchSoundOn()));
  }
}
async function allowMicrophone(): Promise<void> {
  const ok = await (await loadGear()).microphone.open();
  notice(ok ? "Microphone on." : "The microphone was not allowed; the club's door stays shut.");
}
async function switchSoundOn(): Promise<void> {
  const ok = await (await loadGear()).gate.enable();
  notice(ok ? "Sound on." : "Sound could not start; try the button once more.");
}
/** The venue's live exhibits follow the gate: heard the moment sound is on, and the beat read off the first of them. */
let beat: BeatFollower | null = null;
function venueAudios() {
  return (world?.audios ?? []).filter((audio) => (roomById(mansion, exhibitRoom(audio) ?? "")?.requires.length ?? 0) > 0);
}
let beatLoad: Promise<void> | null = null;
function syncVenueSound(): void {
  if (!gear?.gate.enabled) return;
  for (const audio of venueAudios()) {
    void audio.unmute();
    beatLoad ??= import("./audio/beat").then(({ BeatFollower }) => {
      beat = new BeatFollower(audio.field.context, audio.field.bed);
    });
  }
}
function venueChanged(): void {
  offerVenue();
  syncVenueSound();
  // A door that has just opened has nothing more to say; the next refusal is a new one.
  toldAboutLock = null;
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
  // A turnstile cue holds every way out of the room at once, through this one
  // question, so it cannot disagree with the ordinary locks about where a
  // visitor may stand (world/turnstile.ts).
  if (turnstile.closed(performance.now())) return true;
  if (demo) return false;
  // The venue's door asks the visitor, not the server (world/venue.ts).
  if (venueBarred(mansion, roomId, venueState())) return true;
  return !presence.canEnter(presenceRoomFor(roomId));
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
  const held = turnstile.why(performance.now());
  if (held !== null) {
    notice(`The doors are held: ${held}.`);
    return;
  }
  const title = roomById(mansion, roomId)?.title ?? roomId;
  const unmet = unmetNeeds(roomById(mansion, roomId), venueState());
  if (unmet.length > 0) {
    notice(venueReason(title, unmet, view.renderer.xr.isPresenting));
    offerVenue();
    return;
  }
  const why = presence.whyLocked(presenceRoomFor(roomId));
  notice(why === null ? `${title} is not open just now.` : `${title}: ${why}.`);
}

// A room that asks for a headset is left with it: when the session ends on
// the stage, the body steps down to the nearest room it may still be in.
view.renderer.xr.addEventListener("sessionend", () => {
  const here = roomById(mansion, body.room);
  if (!here?.requires.includes("immersive")) return;
  const to = retreat(mansion, body.room, venueState());
  const [x, , z] = to.spawn.position;
  if (teleport(body, mansion, x, z, undefined, { walls: false, into: to.id })) {
    body.yaw = MathUtils.degToRad(to.spawn.yawDeg);
    view.rig.position.set(body.x, body.y, body.z);
    notice(`The ${here.title || here.id} is for headsets; you are back in the ${to.title || to.id}.`);
  }
});

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

// The chess table: a game surface with a place in its room (observatory.ts
// builds the table) offers itself while the visitor stands at it. Re-checked
// a few times a second, like the decoder above.
/** How near the table's centre counts as standing at it: a step past its stools. */
const GAME_TABLE_REACH_M = 2.6;
let offeredSurface: GameSurfaceConfig | null = null;
let nextTableCheck = 0;
function nearbyGameSurface(): GameSurfaceConfig | null {
  let nearest: GameSurfaceConfig | null = null;
  let best = GAME_TABLE_REACH_M * GAME_TABLE_REACH_M;
  for (const surface of roomById(mansion, body.room)?.gameSurfaces ?? []) {
    if (!surface.position) continue;
    const dx = surface.position[0] - body.x;
    const dz = surface.position[2] - body.z;
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      nearest = surface;
    }
  }
  return nearest;
}
function offerGameTable(): void {
  const now = performance.now();
  if (now < nextTableCheck) return;
  nextTableCheck = now + 400;
  const surface = gameSurface.snapshot().open ? null : nearbyGameSurface();
  if (surface === offeredSurface) return;
  offeredSurface = surface;
  hud.setGameOffer(surface ? { title: surface.title, key: device.touch ? null : "G" } : null);
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

  view.rig.position.set(body.x, body.y, body.z);
  adaptExposure(dt);
  handOverVideo();
  offerGameTable();
  if (presenting) {
    // Room-scale walking can take the head through a wall the rig never met.
    view.camera.getWorldPosition(headWorld);
    const push = clampHead(body, headWorld.x, headWorld.z, mansion, lockedRoom);
    if (push.dx !== 0 || push.dz !== 0) {
      body.x += push.dx;
      body.z += push.dz;
      view.rig.position.set(body.x, body.y, body.z);
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
    dt,
    camera: view.camera,
    scene: view.scene,
    worldRoot: view.world,
    live: !presenting,
    setScaleVisible: (scale) => world?.setScaleVisible(scale),
    locked: lockedRoom,
  });
  if (crossing) {
    body.x = crossing.x;
    body.z = crossing.z;
    body.room = crossing.room;
    body.scale = crossing.scale;
    body.crossedInto = crossing.room;
    settle(body, mansion);
    view.rig.position.set(body.x, body.y, body.z);
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

  tellAboutLock(body.lockedOut ?? portals.lockedOut);
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
    notice(roomTitle(labelsLoaded(locale), body.crossedInto) ?? roomById(mansion, body.crossedInto)?.title ?? body.crossedInto);
    // Arriving in the foyer is when the club's door is worth explaining.
    offerVenue();
    syncVenueSound();
    // Acted on: cleared here, once, rather than at the start of `step`, so a
    // teleport earlier in the frame is not erased before it is seen.
    body.crossedInto = null;
  }

  view.camera.getWorldPosition(headWorld);
  if (!demo) presence.sendPose(headWorld.x, body.y, headWorld.z, wrapAngle(headingFromCamera()));
  if (presence.sync()) {
    hud.setPeople(presence.peers.values());
    hud.setMe(presence.me, presence.name);
  }
  avatars.update(presence.peers, dt);
  hud.setHere(presence.here);

  provenance.update(view.camera, presenting);
  hud.setDockOpen("sources", provenance.open);
  if (turnstile.opened(performance.now())) {
    // Said once, so a visitor who stopped trying the door knows they can go.
    toldAboutLock = null;
    notice("The doors are open again.");
  }
  worldNotices.update(view.camera, presenting);
  worldChat?.update(view.camera, presenting);

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
      // Per-node voices follow the live score (#14); a no-op unless a newer frame arrived.
      audio.tick();
      if (reassign) audio.reassign();
    }
  }

  // The club's pulse: a gain on its baked light and its own lamps, from the
  // music's low end when there is music, a slow breath when there is not
  // (audio/beat.ts); and the curtains over the doors barred to this visitor.
  if (pulseActive) {
    const gain = pulseGain(beat && gear?.gate.enabled ? beat.level() : null, time / 1000);
    setPulse(gain);
    // Re-derived only when a switch changed: nothing allocated on a quiet frame.
    const key = (gear?.microphone.live ? 1 : 0) | (gear?.gate.enabled ? 2 : 0) | (view.renderer.xr.isPresenting ? 4 : 0);
    if (key !== barredKey) {
      barredKey = key;
      barred = barredRooms(mansion, venueState());
    }
    curtains?.update(time / 1000, barred);
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
    /**
     * Stands the body in the middle of a room, through the same `teleport` a
     * controller uses, locks included but closed doors not: the tour must
     * reach rooms no walk does. For the browser quality suite's room tour
     * (scripts/quality-browser.mjs); false when the room is unknown or
     * refused.
     */
    visit: (roomId: string): boolean => {
      const room = roomById(mansion, roomId);
      if (!room) return false;
      const x = (room.bounds.min[0] + room.bounds.max[0]) / 2;
      const z = (room.bounds.min[2] + room.bounds.max[2]) / 2;
      return teleport(body, mansion, x, z, lockedRoom, { walls: false, into: roomId });
    },
    /**
     * Resolves once everything the world is loading has landed (world.ts
     * `settled`); the room tour waits on it after each visit. A visit only
     * marks the crossing and the frame loop starts the loads, so this first
     * lets the loop consume the crossing (a bounded wait, should the loop
     * be stopped), and only then follows what is in flight.
     */
    settled: async (): Promise<void> => {
      const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
      for (let frames = 0; body.crossedInto && frames < 120; frames++) await frame();
      await frame();
      await world?.settled();
    },
    get world() {
      return world;
    },
  },
});

window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  gear?.microphone.close();
  presence.dispose();
  gameSurface.dispose();
  chunks.dispose();
  visitMetrics.dispose();
});

boot();
// The service worker (cache, offline hall, media integrity) and the reload
// offer after a deploy; both off in `vite dev`.
updates = startGroveUpdates({ tier: device.tier, hud, xr: view.renderer.xr });
