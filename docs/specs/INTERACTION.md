# Interaction and UI

How a visitor learns to act in the grove, and how we measure that they did.
Written 2026-09-12 against `grove/src` as it stands (M0: hall, four tree
rooms, tapes, walls, presence; no voice, no hands). Companion to
[M0-hall.md](M0-hall.md), [PLATFORM.md](../PLATFORM.md) and
[EXHIBIT-PLAN.md](../EXHIBIT-PLAN.md). Numbers marked *target* are goals we
will measure against; numbers marked *estimate* are priors and become
measurements only when the recorder of §4 has run.

The one design rule, from arcedit's lesson (its SPEC §1.3 deviations): an
action space whose effects are invisible at the scale the actor sees is not
learned. Every action here must show its effect within 300 ms, at the place
the visitor is looking, or it does not exist.

## 1. The action space

### 1.1 What exists today, per platform

Read from `control/desktop.ts`, `control/touch.ts`, `control/xr.ts`,
`ui/hud.ts` and `main.ts`.

| intent | desktop | phone | Quest 3 (controllers) | Quest 3 (hands) |
|---|---|---|---|---|
| look | click for pointer lock, then mouse | drag anywhere right of the stick | neck | neck |
| walk | WASD / arrows, Shift runs (2.4 / 4.2 m/s) | on-screen stick bottom-left, 52 px radius | left stick, walks where you look | none |
| teleport | none | none | squeeze either grip, aim a straight ray at the floor, release; ring marker; 0.3 to 20 m | none |
| turn | mouse | drag | neck only (snap turn refused as a nausea trap) | neck |
| play / pause | Space, HUD button | HUD button | either trigger | none |
| scrub | `[` `]` one frame, held repeats; HUD slider | HUD slider | right stick x, 4 s of tape per second at full deflection | none |
| speed | X cycles 0.5 / 1 / 2 / 4, HUD select | HUD select | none | none |
| read provenance | P, HUD button; DOM panel | HUD button | menu button; canvas panel 0.85 m ahead | none |
| who is here, report | "N here" opens the people panel | same | none (DOM is invisible in XR) | none |
| unmute the wall | M, HUD button | HUD button | none | none |
| frame budget | F | none | none | none |
| enter / leave VR | "Enter VR" button | button when supported | system gesture ends the session | same |
| leave | "Leave" link to `/` | same | none | none |
| talk | none (M1) | none | none | none |

Counts: desktop 11 distinct actions on 9 keys plus 6 buttons; phone 7; Quest
controllers 6 with 3 of the desktop actions unreachable; Quest hands 0, and
`xr.ts` says so in a notice. Nothing tells a visitor what the buttons do
except one hint line on desktop (`HINT` in `main.ts`), shown until pointer
lock and never again.

Problems this creates, in the order a first visitor meets them:

1. The hint says "Click to look around"; the click also locks the pointer,
   and a visitor who presses Escape (the browser's own habit) loses the
   controls with no explanation.
2. Play/pause on the trigger and provenance on the menu button are
   invisible mappings; both act on "the tape", which in the hall is nothing.
3. Scrub on a stick is a rate control on a clock the visitor cannot see
   until the HUD readout, which is DOM and absent in XR.
4. Leaving is a link on desktop and impossible in XR without the system menu.

### 1.2 The proposed minimal set: seven verbs, one selector

The set is the same on every platform; only the binding differs. What
changes is that four of the seven act on *what you point at*, so pointing is
the one thing to learn.

| verb | what it does | desktop | phone | controller | hand |
|---|---|---|---|---|---|
| **look** | turn the head | mouse (locked) | one-finger drag | neck | neck |
| **go** | move to a floor point or walk | WASD; click a floor point to glide there | stick; tap a floor point | left stick; grip-aim-release | pinch at a floor point, arc, release |
| **point** | choose the thing in front of you (the selector) | crosshair, always on | tap | ray from the dominant controller | ray from the index of the raised hand |
| **use** | the pointed thing's one action: a tape plays or pauses, a wall unmutes, a plaque opens, a door beckons | click / Space | tap | trigger | pinch |
| **time** | scrub the pointed tape | drag with the button held; `[` `]` | horizontal two-finger drag | thumbstick x while pointing at the tape | pinch and drag sideways |
| **read** | provenance of the pointed thing | P, or dwell 1.2 s on the crosshair | long-press 0.6 s | menu, or dwell | palm up 1.2 s |
| **leave** | the exit door, always behind the spawn point | walk through it, or Escape twice | swipe down from the top | grip-aim at the door | pinch at the door |

Talk (voice, §3) is not a verb: it is a second way to say any of the seven.

What this removes: the separate speed control (speed becomes a modifier of
time: scrub past the end at full deflection for 2 s and the tape runs at 2x,
say so in the plaque), the play/pause key that acted on an invisible tape,
the perf overlay from the visitor set (it moves to settings, §5), and the
unmute key (the wall is a pointable thing; use unmutes it).

Doors: `leave` and room changes get a physical object. Today a doorway is a
hole; the exit needs a door in the hall behind the spawn, with the
`/` landing page drawn on its far side so walking out reads as leaving.
This is a mansion.json change and a hall rebake (BACKLOG 13 decides the
plan of rooms; the door goes in that plan).

### 1.3 Progressive disclosure

Three tiers, unlocked by doing, never by time.

| tier | verbs available | unlocked when |
|---|---|---|
| 0 arrive | look, go, leave | on load |
| 1 exhibit | point, use, time | the visitor stands within 3 m of a hanging for the first time |
| 2 depth | read, talk, settings | the visitor has used a hanging once |

A verb outside the current tier still works if performed (nothing is
locked); the tier only decides which hints are shown (§2). The tier is
stored in `localStorage` under `orchard.grove.mastery` and in the recorder.

### 1.4 Learning-time targets

Measured by the recorder (§4) from the first frame to the first successful
instance of each verb, median over first-time visitors. Today's numbers are
unknown; the first two weeks of recording set the baseline, then:

| verb | target median | target 90th percentile | failure signal |
|---|---|---|---|
| look | 5 s | 15 s | 3 clicks with no pointer lock (desktop) |
| go | 15 s | 45 s | 10 s of stick with no displacement, 3 failed teleports |
| use | 60 s after tier 1 | 180 s | 5 presses with no target |
| time | 90 s after tier 1 | 240 s | scrub input while pointing at nothing |
| read | 120 s after tier 2 | 300 s | 0 opens in a 10-minute visit |
| leave | 10 s from intent | 30 s | session end by tab close with no door crossing |

"Competence" for the arcedit harness (§4.5) is the first time all seven have
succeeded once, target 4 minutes median. A verb whose 90th percentile misses
by 2x after 200 sessions is a redesign, not a hint change.

## 2. Gestures and the hints that teach them

### 2.1 Gesture inventory

Hands come back into `xr.ts` only with this section built; the M0 refusal
stands until then (a hand input source carries no gamepad).

| gesture | detection | default threshold | maps to |
|---|---|---|---|
| point (hand) | index extended, other three curled; ray from index proximal to tip | 120 ms stable | point |
| pinch | thumb tip to index tip distance | closes below 15 mm, opens above 25 mm (hysteresis) | use on press; go if aimed at the floor and held over 250 ms |
| pinch-drag | pinch held, hand moves | 40 mm dead zone, then 1 tape-second per 20 mm | time |
| palm up | palm normal within 30 deg of +Y, held | 1.2 s | read |
| grab (controller) | squeeze over 0.6 | edge | go (aim) |
| trigger | over 0.5 | edge | use |
| stick x while pointing at a tape | deadzone 0.18 | held | time |
| dwell (all platforms) | crosshair or ray on one target | 1.2 s, then 300 ms cooldown | read |

Every threshold above is a field of the configuration in §3.4, so the same
detector runs under a hand-written default and under an LLM-written one.

### 2.2 Hint objects

No text on the world (LAWS 7 as `hud.ts` applies it: chrome, not scenery).
Hints are objects that would be at home in a palace, drawn in the gallery
palette, and every one of them is anchored to the place the action happens.

| hint | what it is | teaches | shown while |
|---|---|---|---|
| ghost hands | a pair of translucent hands 60 cm in front of the visitor performing the gesture on a 2 s loop, at 30% opacity, additive | point, pinch, palm up | tier 0 to 1, hands present, verb unmastered |
| ghost controller | the same for the controller, with the button that matters lit | use, go | controllers present |
| the arc | the teleport ray as a parabola instead of the straight line in `xr.ts`, landing on a ring that pulses once when a floor point is valid | go | every aim; the pulse fades with mastery |
| floor ring | a faint ring at the spawn and outside each doorway, the size of the body radius | go | tier 0 |
| the plaque | a small brass-toned plaque beside every hanging, blank until pointed at, then showing the one verb that applies as an icon, no words | use, time | tier 1 onward |
| the halo | a 2 cm rim light on the pointed thing | point | always; it is the selection feedback |
| the clock | a thin arc around the pointed tape's plaque showing its fraction | time | while pointing a tape |
| the door | a real door with light behind it | leave | always |

Ghost hands are one skinned mesh with four clips (point, pinch, drag, palm);
about 4k triangles, one texture, 200 KB. They live in `grove/src/ui/hints/`
and are loaded lazily after the room, never before it.

### 2.3 Sound

Every gesture and every voice event has a sound; the sound is the
confirmation, not a notice. Opus, under 30 KB each, from `public/assets/ui/`.

| event | sound | length |
|---|---|---|
| point acquires a target | soft tick | 40 ms |
| use | wooden click | 80 ms |
| go (arrival) | a step on stone | 120 ms |
| go refused (no floor) | dull thud, pitched down | 100 ms |
| time (scrub) | tape whirr whose pitch follows speed | continuous, ducked |
| read opens | paper unfold | 200 ms |
| voice: listening | rising two-note chime | 250 ms |
| voice: understood, acting | the use click | 80 ms |
| voice: not understood | falling two-note | 250 ms |
| voice: confirmation needed | single held note, until answered | up to 3 s |
| tier unlock | a short bell | 400 ms |

Sound sits on the same `AudioContext` the video wall unmute creates
(`media/videowall.ts`), so the first user gesture unlocks both.

### 2.4 Fading with mastery

Each verb has a mastery counter: successful uses, decayed by one per day.
Hint opacity for a verb is `max(0, 1 - uses / 5)`. At five uses the hint is
gone; the halo and the door never fade. A verb unused for 14 days comes back
at half opacity. The counters live in `orchard.grove.mastery` and go into
the recorder as `mastery` events so the harness sees what the visitor saw.

## 3. Voice through an LLM

### 3.1 The shape

Speech becomes text; text plus the player's context becomes a *gesture
configuration*, a JSON document that reconfigures the detector of §2.1: which
gestures map to which verbs, thresholds, dwell times, and which actions need a
spoken confirmation. The LLM never moves the player. It changes how the
player's own gestures are read, and it may queue at most one immediate action
("go to the spectre room") which the client executes through the same
detector as a synthetic gesture, so the recorder sees one event stream.

Why this shape: a free-text reply would need a second parser; an action list
would make the model the actor. A configuration is idempotent, cacheable,
testable without the model, and exactly what the arcedit harness (§4.5)
searches over. The model's job is the mapping from a person's words to that
search space.

### 3.2 Speech to text

| option | where it runs | latency to final text | cost | privacy | offline |
|---|---|---|---|---|---|
| Web Speech API | the browser; Chrome sends audio to Google, Safari to Apple; Quest browser supports it | 0.5 to 1.5 s | free | audio leaves the device to a third party we do not contract with | no (Chrome), partly (Safari on-device models) |
| Deepgram (streaming websocket) | Deepgram's service, via a Worker that holds the key | 0.3 s partials, under 1 s final | about $0.0077 per minute of audio (estimate from the public sheet, check before enabling) | a processor under DPA; audio retained per their policy | no |
| Whisper on Workers AI (`@cf/openai/whisper`) | Cloudflare's edge, called from our Worker | 1 to 3 s for a 5 s clip (batch, no streaming) | included in Workers AI pricing; on the order of $0.001 per 5 s clip (estimate) | stays inside our Cloudflare account; no third processor to name in `/privacy/` | no |
| on-device (whisper.cpp wasm, tiny/base) | the client | 2 to 6 s on a phone, 1 to 3 s desktop; not viable on Quest at 72 Hz | free | never leaves the device | yes |

Decision: Whisper on Workers AI for M1, push-to-talk clips of at most 8 s,
because the privacy page then names one processor we already name
(Cloudflare) and the client needs no new `connect-src`. Web Speech API as the
zero-cost fallback where the visitor opts into it explicitly (a setting, off
by default, with the sentence "your voice is sent to your browser's maker").
Deepgram only if streaming partials prove necessary for the feel; on-device
when a phone build (§6) ships and the model can be cached.

Two header changes gate all of this: `public/_headers` currently sends
`Permissions-Policy: microphone=()`, which must become `microphone=(self)`,
and the Worker route (`/voice`, a Pages Function beside `/auth`) is
same-origin so `connect-src 'self'` already allows it.

### 3.3 What runs where

```
 browser                              Pages Function /voice           Anthropic
 push-to-talk clip (Opus, <= 8 s) --> Workers AI whisper -> text
 + context (room, targets, tier,     text + context -> Claude  ----> claude-opus-5
   permissions, stats)                  structured output           thinking adaptive
                                     validate against schema
 apply config, sound, one action <-- config JSON (or the fallback grammar's)
```

The key lives in the Function's environment (`ANTHROPIC_API_KEY`, set like
`AUTH_SIGNING_KEY` in HOSTING §Secrets); the client never sees it. The
Function requires the grove token from `/auth` on every call, so a command
is always attributed to an identity and the daily cap (§3.6) has a subject.

### 3.4 The configuration schema

The one document the model returns, the client validates, the recorder logs
and the harness mutates. `grove/src/control/gestureconfig.ts` owns the type
and the default; the Function embeds the same schema.

```json
{
  "$schema": "https://weichseltree.com/schemas/gesture-config/1.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["version", "bindings", "thresholds", "confirm", "hints", "say", "act"],
  "properties": {
    "version": { "const": 1 },
    "bindings": {
      "type": "array", "minItems": 0, "maxItems": 12,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["gesture", "verb", "target"],
        "properties": {
          "gesture": { "enum": ["point", "pinch", "pinch_drag", "palm_up", "grab", "trigger", "stick_x", "dwell", "tap", "long_press", "two_finger_drag", "key"] },
          "verb":    { "enum": ["look", "go", "point", "use", "time", "read", "leave", "none"] },
          "target":  { "enum": ["any", "floor", "tape", "wall", "still", "plaque", "door", "person"] },
          "key":     { "type": "string", "maxLength": 16 }
        }
      }
    },
    "thresholds": {
      "type": "object", "additionalProperties": false,
      "required": ["pinch_close_mm", "pinch_open_mm", "point_stable_ms", "dwell_ms", "palm_ms", "long_press_ms", "drag_deadzone_mm", "tape_s_per_20mm", "teleport_max_m"],
      "properties": {
        "pinch_close_mm":   { "type": "number", "minimum": 8,   "maximum": 30 },
        "pinch_open_mm":    { "type": "number", "minimum": 12,  "maximum": 45 },
        "point_stable_ms":  { "type": "integer", "minimum": 0,  "maximum": 600 },
        "dwell_ms":         { "type": "integer", "minimum": 400, "maximum": 3000 },
        "palm_ms":          { "type": "integer", "minimum": 400, "maximum": 3000 },
        "long_press_ms":    { "type": "integer", "minimum": 250, "maximum": 1500 },
        "drag_deadzone_mm": { "type": "number", "minimum": 10,  "maximum": 80 },
        "tape_s_per_20mm":  { "type": "number", "minimum": 0.1, "maximum": 10 },
        "teleport_max_m":   { "type": "number", "minimum": 2,   "maximum": 20 }
      }
    },
    "confirm": {
      "type": "array", "maxItems": 7,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["verb", "prompt"],
        "properties": {
          "verb":   { "enum": ["go", "use", "time", "read", "leave"] },
          "prompt": { "type": "string", "maxLength": 60 }
        }
      }
    },
    "hints": {
      "type": "object", "additionalProperties": false,
      "required": ["show", "opacity"],
      "properties": {
        "show":    { "type": "array", "items": { "enum": ["ghost_hands", "ghost_controller", "arc", "floor_ring", "plaque", "clock"] } },
        "opacity": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "say": { "type": "string", "maxLength": 80 },
    "act": {
      "type": "object", "additionalProperties": false,
      "required": ["verb", "target_id", "value"],
      "properties": {
        "verb":      { "enum": ["none", "go", "use", "time", "read", "leave"] },
        "target_id": { "type": "string", "maxLength": 64 },
        "value":     { "type": "number" }
      }
    }
  }
}
```

`say` is the only free text, spoken back by the client through its own
sound set (§2.3) as a short caption, never a paragraph. `act.target_id` must
be one of the ids in the context the client sent, or the client drops the
action and logs `act_rejected`. `confirm` prompts are spoken and answered by
the next pinch or trigger (yes) or by silence for 3 s (no).

### 3.5 The Claude call

Model `claude-opus-5`, adaptive thinking, structured output; no tools in the
first version, so `tool_choice` never appears. The system prompt is frozen
text with the schema and the rules below, and it goes first with a cache
breakpoint; the volatile context is the user turn.

```ts
// functions/voice/[[path]].ts, the shape only
const response = await client.messages.create({
  model: "claude-opus-5",
  max_tokens: 2000,
  thinking: { type: "adaptive" },
  output_config: { effort: "low", format: { type: "json_schema", schema: GESTURE_CONFIG_SCHEMA } },
  system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: JSON.stringify(context) }],
});
```

If a later version lets the model ask the world a question (which exhibits
hang in the next room), that is a `strict: true` tool with
`tool_choice: {type: "auto"}`, and the answer still ends in the same
structured output.

Context the client sends, under 600 tokens:

```json
{ "utterance": "take me to the three balls and slow it down",
  "room": "einstruct", "tier": 1, "platform": "quest-hands",
  "targets": [ {"id": "spectre:door", "kind": "door", "m": 6.2},
               {"id": "tape:2dd0038799b2db15", "kind": "tape", "m": 1.4, "playing": true, "speed": 1} ],
  "permissions": { "host": false, "can_talk": true },
  "stats": { "minutes": 3.5, "verbs_used": {"go": 4, "use": 1}, "failed": {"go": 2}, "config_changes": 1 },
  "config": { "...the current config, so the model edits, not rewrites..." } }
```

Rules in the system prompt, plain: return the current config with the fewest
changes that do what the person asked; never bind `leave` to a gesture that
fires on its own (dwell, palm up); never lower `dwell_ms` under 400; when the
person says something is hard, widen its threshold by a step and add a hint,
do not add a confirmation; when they ask for something dangerous or absent
(another visitor, an admin action), `act.verb` is `none` and `say` says why.

### 3.6 Cost and the cap

Per command, *estimate*: 2,500 system tokens read from cache at $0.50 per
million ($0.00125), 600 context tokens at $5 ($0.003), about 900 output
tokens including thinking at $25 ($0.0225). About **$0.027 per command**,
plus the Whisper clip. Cache writes once per 5 minutes of traffic add about
$0.016 each.

Cap: 40 commands per identity per day (about $1.10 at the estimate), counted
in a `voice_quota` row keyed by `ipk` in the module (the same subject the
gate already caps by), and a global breaker at $20 per day that turns the
route off and tells the client to use the grammar (LAWS 21). The Function
logs `usage` from every response so the estimate becomes a measurement in
the first week.

### 3.7 The fallback grammar

Runs in the client with no network, and always runs first; the LLM is
called only when the grammar does not match. About 30 lines in
`grove/src/control/voicegrammar.ts`:

```
command  := verb [target] [value]
verb     := "go" | "take me" | "walk" | "play" | "pause" | "stop" | "faster" | "slower"
          | "rewind" | "back" | "forward" | "what is this" | "provenance" | "leave" | "exit"
          | "louder" | "mute" | "help" | "show hints" | "hide hints"
target   := room name | tree name | "the door" | "the tape" | "the wall" | "the three balls"
value    := number ["seconds" | "frames" | "x"]
```

Room and tree names come from `mansion.json` at build time; the plaque
titles from the exhibit rows at runtime. A match becomes the same config
document (`act` filled, nothing else changed), so downstream code has one
path. Expected: the grammar answers 70% of commands (*estimate*, to be
measured from the recorder's `voice` events), which also caps the cost.

## 4. The session recorder

### 4.1 Consent

Off by default. Tier 2 of the disclosure (§1.3) shows one card once:
"Record how you move and what you use, to make the controls easier to
learn? No audio, no chat, no names. You can export or delete it on the
account page." Two buttons, yes and not now. The choice is stored under
`orchard.grove.record` and shown as a switch in settings (§5). `/privacy/`
gains a paragraph the day the recorder ships.

### 4.2 What is recorded

One JSON Lines file per session, `session_id` a random 128-bit id that is
not the identity. Fields:

```
{"t":  12.483, "k": "pose",   "x": 3.21, "z": -1.04, "yaw": 1.57, "pitch": -0.1}       10 Hz while moving
{"t":  12.520, "k": "input",  "src": "stick_l", "fx": 0.0, "fz": 0.8}                   on change, max 20 Hz
{"t":  13.100, "k": "gesture","g": "pinch", "phase": "start", "hand": "r", "target": "tape:2dd0", "m": 1.4}
{"t":  13.410, "k": "verb",   "v": "use", "ok": true, "target": "tape:2dd0", "latency_ms": 310}
{"t":  13.410, "k": "verb",   "v": "go",  "ok": false, "why": "no_floor"}
{"t":  40.000, "k": "room",   "id": "spectre"}
{"t":  41.200, "k": "hint",   "h": "arc", "opacity": 0.6, "verb": "go"}
{"t":  55.000, "k": "voice",  "path": "grammar" | "llm" | "rejected", "verb": "go", "ms": 820, "config_diff": ["thresholds.dwell_ms"]}
{"t":  55.000, "k": "config", "hash": "b1f3...", "diff": {"thresholds": {"dwell_ms": 900}}}
{"t":  60.000, "k": "frame",  "ms_p50": 11.2, "ms_p95": 16.8}                          every 10 s
{"t": 300.000, "k": "mastery","go": 5, "use": 2}
{"t":   0.000, "k": "head",   "platform": "quest-hands", "tier": "vr-quest", "ua_class": "quest3", "build": "ab99380f", "config_hash": "..."}
```

Sizes: pose 10 Hz while moving at about 45 bytes is 27 KB per minute of
walking, other events under 3 KB per minute; a 20-minute visit is about 300
KB raw, about 60 KB gzipped (*estimate*, to be measured). The client keeps
at most 5 MB in IndexedDB and drops the oldest session past that.

Never recorded: audio, the utterance text (only which path answered it and
which fields changed), chat, names, the identity, other people's positions
(only their count), the IP, anything from the DOM. Pose is rounded to 1 cm
and 0.01 rad. The `say` text is not stored.

### 4.3 Storage and transport

Local first: IndexedDB store `sessions`, one record per session, appended in
1 s batches. Upload when the session ends (`pagehide`) or every 5 minutes,
gzipped, `POST /record` with the grove token; the Function writes to R2 at
`records/<yyyy-mm>/<session_id>.jsonl.gz` and inserts one row in a
`recording` table (session id, identity, byte count, day) so a visitor's
sessions can be listed. Nothing else in the module changes. Anonymous
identities without the token service cannot upload; they record locally and
the switch says so.

### 4.4 Retention, export, delete

R2 objects are deleted 180 days after upload (a lifecycle rule; the ledger
line in HOSTING). The account page (§5) lists the visitor's sessions from
the `recording` rows and offers *Export* (a signed URL to the gzipped files,
valid 10 minutes) and *Delete* (a reducer `deleteRecordings` that removes the
rows; a Function then deletes the objects, and the row is gone before the
page reloads). The identity is the subject for GDPR purposes; a visitor who
lost their token loses access to that data, and the privacy page says so.
Training data derived from recordings (§4.5) is regenerated from what is
left after deletions, monthly.

### 4.5 The simulation harness for arcedit

arcedit learns to act through a cursor on a canvas it sees only near the
cursor. The grove is the same problem one dimension up: an actor that sees
what it points at, a small set of verbs, and a cost per step. The harness
is a Python environment in `grove/sim/` (new; CPU only, `exprun` for its
tests) that replays recorded sessions and lets an agent search over the
configuration of §3.4.

**Environment.** `GroveEnv(config, sessions, goals)`; gym style.

- Observation, one vector per 100 ms tick: the pointed target's kind (one
  hot over 8), distance to it (m), the current room (one hot), hint
  opacities (6 floats), which verbs have succeeded so far (7 bits), time
  since the last successful verb (s), the last 10 gesture phases (one hot
  over 12 by 3), and the visitor's frame-time p95. About 90 floats. No
  positions: the agent sees what the visitor sees, not the map.
- Action space: a change to the configuration, discretised: for each of the
  9 thresholds, {down a step, hold, up a step}; for each of 12 gestures, a
  verb from 8; toggle each of 6 hints; or `no_op`. Applied at the start of
  the next session in the batch, never mid-session, because that is when
  the real system would apply an LLM's answer.
- The visitor model: a recorded session is replayed with a *behaviour
  model* that resamples the visitor's gestures under the new config: a
  gesture that succeeded under the recorded thresholds succeeds under
  looser ones, fails under tighter ones with probability from the recorded
  hand-distance distribution; a verb rebound to a different gesture is
  attempted on the first hint exposure with the recorded per-verb latency
  distribution. This is the honest part and the weak part: it is a
  first-order model, written once and checked against held-out sessions
  by comparing predicted and recorded time-to-competence (target: within
  20% on the median).
- Reward per session: `-(time_to_competence_s / 240) - 0.2 * failed_verbs
  + 1.0 * [all seven succeeded] + 0.5 * task_success`, where the scripted
  tasks are: reach the spectre room; pause the ab_d2 tape at frame 400
  within 10 s; open provenance on a still; leave by the door. Episode is a
  batch of 32 sessions under one config; `T_max` 20 config changes.
- Dataset: the R2 recordings, converted to Parquet by `grove/sim/convert.py`
  with the schema of §4.2, one row per event, partitioned by platform.
  A synthetic generator (`grove/sim/synth.py`) makes sessions from the
  behaviour model alone so the harness runs before any real data exists,
  marked `synthetic: true` in `head`.

**Baseline heuristics**, each a config the agent must beat:

1. the hand-written default in `gestureconfig.ts`;
2. loosen-on-failure: any verb with 3 failures widens its threshold one step;
3. bandit: per-platform, thresholds chosen by a UCB over the discrete steps
   from the recorded reward, no state.

**Assignment brief for the arcedit session:**

> Build `grove/sim` against `docs/specs/INTERACTION.md` §4.5. Register the
> experiment in arcedit's MILESTONES style before collecting a number:
> question "does a learned configuration policy beat the loosen-on-failure
> heuristic on time-to-competence, on held-out synthetic sessions and then
> on real ones"; measurements: median and p90 time-to-competence, task
> success, number of config changes; decision table: a policy that beats
> heuristic 2 by under 10% on synthetic data is not run on real data.
> Start with the behaviour model and its validation, then the three
> baselines, then PPO over the discrete action space with arcedit's
> `i11_measure_rl.py` harness, `T_max` 20. CPU only, `exprun`. A number
> must name the session file and commit that produced it. Report back with
> the config that won and the diff against the default, as the JSON of
> §3.4, so it can be shipped as the new default without the LLM.

## 5. The desktop UI

One panel, opened by the gear at top right or Escape, with four tabs; the
HUD stays as it is otherwise. All DOM (`ui/settings.ts`), never shown in
XR; XR gets the same settings through the voice route and the plaque.

```
+--------------------------------------------------------------------------+
| 3 here · connected                                     [Enter VR] [gear] |
|                                                                          |
|          +------------------------------------------------------+        |
|          | Settings   Platform   Account   Provenance        [x]|        |
|          |------------------------------------------------------|        |
|          | Graphics   ( ) phone  (o) quest  ( ) desktop  (auto) |        |
|          |            pixel ratio  [====|----] 1.5              |        |
|          | Audio      master [======|--] 70   ui sounds [x]     |        |
|          |            voice  ( ) off (o) push to talk (V)       |        |
|          |            speech via  (o) our server ( ) browser    |        |
|          | Input      look sensitivity [===|----]               |        |
|          |            hints  (o) fade with use ( ) always ( ) off|        |
|          |            record my session [ ]  (what is recorded) |        |
|          |            reset controls to default                 |        |
|          +------------------------------------------------------+        |
|                                                                          |
|  [Pause] [=====|===============] 312/800  156.0 tau   [1x v]             |
+--------------------------------------------------------------------------+
```

Platform tab, every line a number the visitor can quote in a bug report:

```
| device tier      quest  (OculusBrowser, maxPixelRatio 1)                 |
| frame budget     13.9 ms at 72 Hz; last 10 s p50 11.2  p95 16.8         |
| loaded           hall.glb 4.1 MB · lightmap 2048 KTX2 · 4 rooms         |
|                  tape 2dd00387 chunks 12/16 (9.3 MB) · wall: poster     |
| network          spacetime connected, 3 reconnects · media 41 ms        |
| voice            grammar 5 · server 2 · today 7/40                      |
| build            ab99380f · 2026-09-12                                  |
```

Account tab: the identity is a key pair SpacetimeDB holds for the token
(`orchard.grove.pass`, or the anonymous `orchard.grove.token`). Show its
short hex, the name field (`orchard.grove.name`, cleaned server-side), when
it expires (30 days from last seen, SECURITY §Kinds of people), *Export my
recordings*, *Delete my recordings*, *Forget me on this device* (clears the
three keys). A line says a passkey login is planned so the same identity
follows the visitor between devices; that is a module change (an `account`
table binding a WebAuthn credential to an identity) and waits on a ruling.

Provenance tab: the existing panel, moved in, with two additions: a
*copy as JSON* button and the bundle hash as a link to the media host.

```
| Provenance                                                               |
| ab_d2 · einstruct                                                        |
| tree_commit      1056f1f                                                 |
| produced_by      python -m einstruct.sim ab_d2 --frames 801              |
| bundle           2dd0038799b2db15  (media.weichseltree.com/…)            |
| variant          vr-quest · 2,634 particles · 801 frames                 |
| [copy as JSON]                                                           |
```

## 6. The phone client

| option | what it is | WebXR | install | store | effort | risks |
|---|---|---|---|---|---|---|
| PWA of the grove | manifest, service worker, the same bundle | Android Chrome: yes, immersive-vr with Cardboard-style viewers and immersive-ar; iOS Safari: no WebXR, the touch fallback runs | home screen on both | none, or via a TWA | 2 days | iOS evicts IndexedDB and localStorage after 7 days unused (ITP), which loses the identity token and local recordings; the CSP's `unsafe-eval` (BACKLOG 11) stays |
| Trusted Web Activity | an Android app whose only activity is Chrome showing the PWA full-screen | as Chrome | Play Store listing | yes, Play only | 1 day on top of the PWA plus the store account | Play policies for a WebView-only app; Digital Asset Links must match the domain |
| Flutter | a second client | no WebXR; a plugin for OpenXR on Android only, none on iOS | native | both stores | months; a second renderer, a second presence client, a second bundle loader | two codebases that drift; the mansion is a three.js scene document |

Recommendation: the PWA now, the TWA when a Play listing is wanted, Flutter
never for this client. Migration path: (1) `public/manifest.webmanifest`
and a service worker that caches the shell and `assets/*` only, never media
(the bundles are content-addressed and cached by the browser already);
(2) an install prompt at tier 2 on Android, a "share to home screen" hint on
iOS; (3) the recorder keeps a copy of the token in the Cache API as well as
localStorage so ITP eviction does not cost the identity; (4) the TWA from
Bubblewrap with the asset link file at `/.well-known/assetlinks.json`.

Touch controls, the seven verbs on a phone:

| verb | touch |
|---|---|
| look | one-finger drag anywhere right of the stick (as today) |
| go | the stick (as today), or tap a floor point: an arc from the bottom of the screen to the point, 0.8 s glide |
| point | the crosshair at screen centre; a tap anywhere not on the stick points there for one action |
| use | tap the pointed thing |
| time | two-finger horizontal drag over the tape, 1 tape-second per 40 px |
| read | long press 0.6 s |
| leave | swipe down from the top edge; also the door |

The 52 px stick stays; the HUD scrubber is hidden on phones once the
two-finger drag has been used twice (mastery 2), which returns the bottom of
the screen to the room.

## 7. Implementation list, smallest first

Each step is one commit and one test where a test is possible. Paths are
under `grove/src` unless said otherwise.

1. **Hint text and Escape.** `main.ts` `HINT` says what Escape does and
   comes back on pointer-lock loss with "click to continue". 10 lines.
2. **`control/gestureconfig.ts`**: the type of §3.4, the default, a
   validator (JSON schema in `schemas/gesture-config.1.json`, checked by
   `vitest` against the default and against three hand-written bad
   documents). Nothing reads it yet.
3. **The selector.** `control/pointer.ts`: one ray (camera on desktop and
   phone, dominant controller in XR) against the `Provenance` targets,
   already boxes with ranks; exposes `pointed: {id, kind, m}`. The halo in
   `render/halo.ts`. `provenance.ts` reads `pointed` instead of picking
   itself.
4. **Use and time act on the pointed thing.** `main.ts` `commands`:
   `togglePlay` and scrub take the pointed tape, falling back to the
   nearest (the current `nearestTape()`), so the hall's trigger presses
   become a "nothing here" thud instead of silence.
5. **Sounds.** `ui/sound.ts`, the table of §2.3, on the wall's
   `AudioContext`. `public/assets/ui/*.opus`.
6. **Mastery and hint fading.** `ui/mastery.ts`: counters, storage,
   opacity. The arc replaces the straight ray in `control/xr.ts` `#aim`
   and reads its opacity from here.
7. **Plaques.** `world/plaque.ts` built beside each hanging in
   `world/world.ts`; blank mesh, icon texture from `pointed.kind`.
8. **The recorder.** `record/recorder.ts` (events, IndexedDB, upload),
   `functions/record/[[path]].ts` (R2 write, `recording` row), consent card
   in `ui/consent.ts`, the switch in settings. The module gains
   `recording` and `deleteRecordings`; `scripts/module-check.ts` covers
   the reducer. `/privacy/` updated in the same commit.
9. **Settings and the tabs.** `ui/settings.ts` with the four tabs of §5;
   `PerfMeter` output moves to the Platform tab; F becomes a shortcut to it.
10. **Voice, grammar only.** `control/voicegrammar.ts`, push-to-talk on V
    and a HUD button, Whisper via `functions/voice/[[path]].ts`;
    `_headers` `microphone=(self)`. The LLM route stays off behind a
    setting so the cost line is zero until turned on.
11. **Voice, LLM.** The Claude call in the same Function, the cap rows in
    the module, the `usage` log. Turned on by Manuel.
12. **Hands.** `control/hands.ts`: `hand-tracking` as an optional feature,
    the four detectors of §2.1 reading thresholds from the config; ghost
    hands in `ui/hints/`. `xr.ts` drops its no-gamepad notice when hands
    are driven.
13. **The door.** `mansion.json` gains a door object and `leave` target;
    the hall rebake follows the palace plan.
14. **Phone: PWA.** `public/manifest.webmanifest`, `sw.ts`, the install
    hint. Then tap-to-go and the two-finger scrub in `control/touch.ts`.
15. **`grove/sim`.** The harness of §4.5, handed to an arcedit session
    with the brief above, after step 8 has produced 50 sessions or the
    synthetic generator exists.

Order of value: 1 to 4 fix what a first visitor hits today and cost about a
day together; 5 to 7 make the verbs visible; 8 makes everything after it
measurable, so it comes before voice.

### Rulings needed from Manuel

- **Recording at all**, and the consent wording of §4.1 (a privacy page
  change; LAWS 22 counts it as a publish).
- **Voice through a third party or not**: Workers AI only (recommended), or
  also the browser's speech service as an opt-in.
- **The daily cap and the breaker**: 40 commands and $20 per day, or other
  numbers; and whether the LLM route is on for everyone or hosts first.
- **The door and the exit**: a rebake of the hall, so it belongs to the
  palace plan (BACKLOG 13); until then Escape twice is the exit.
- **Hints as objects in the room**: the plaque and the floor ring are
  furniture in a palace hall; a look ruling before they are modelled, from
  stills (LAWS 14).
- **Passkeys**: whether an `account` table binding a WebAuthn credential to
  an identity is wanted before M3's portals make identity portable anyway.
- **The Play Store**: whether a listing is wanted at all; the TWA costs a
  day and a developer account.
