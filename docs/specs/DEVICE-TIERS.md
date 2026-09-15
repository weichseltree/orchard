# Device tiers and the exhibit lifecycle

What each device gets, what plays, what loads, what is a sprite and what
unloads, in the grove client (`grove/`). Written 2026-09-12 against the client
as it stands (WP2 plus the same-day changes: several tapes on one transport,
walls by room, `exhibitRoom()` in `grove/src/world/world.ts`). Numbers marked
**measured** come from `docs/impl/WP2-grove.md` or the repo; numbers marked
**prior** are from the trees' answers or vendor pages; the rest are budgets,
which are rulings, and the measurement plan in §5 is what turns them into
facts. Nothing here has run on a headset or a phone yet (BACKLOG 3).

The client's tiers today are four (`grove/src/tape/bundle.ts`): `vr-high`,
`vr-quest`, `phone`, `desktop`, chosen by `detectDevice()` in
`grove/src/device.ts` from the user agent alone, and used for three things:
the bundle variant, the `devicePixelRatio` cap (1 / 1.5 / 2) and which
controls to wire. This document keeps those four as the *bundle* tiers and
adds a per-device budget on top, because a Quest 2 and a Quest 3 want the
same variant and different everything else.

The renderer now carries an asynchronous **experimental** WebGPU path:
setting `VITE_ENABLE_WEBGPU=1` lets it probe for an adapter and initialize
Three.js's `WebGPURenderer`; missing adapters or init failures explicitly fall
back to the existing WebGL2 renderer. WebGL2 stays the default until the
remaining `ShaderMaterial` sky and tape shaders are ported, because Three's
current WebGPU backend logs them as incompatible. Both paths share the
scene-facing view contract, AgX tone mapping, XR setup, and resize lifecycle.
All binary room, lightmap, and tape payloads pass through the shared chunk
scheduler in `grove/src/render/chunk-stream.ts`: payloads are capped at 2 MiB,
requests are priority ordered and deduplicated, and resident bytes are evicted
against the tier budget without using `SharedArrayBuffer`.

## 1. The tier table

Hardware, from the pages fetched (sources at the end):

| device | per eye / screen | Hz | chip, GPU, RAM |
|---|---|---|---|
| Quest 3 | 2064×2208 | 72 default, 90, 120 | XR2 Gen 2, Adreno 740, 8 GB |
| Quest 2 | 1832×1920 | 90 default in the browser, 72, 120 | XR2 Gen 1, Adreno 650, 6 GB |
| Pico 4 | 2160×2160 | 72 default, 90 | XR2 Gen 1, Adreno 650, 8 GB (Pico 4 Ultra: XR2 Gen 2, 12 GB) |
| Apple Vision Pro | ~3660×3200 | 90, auto 96/100 (M5 model: 120) | M2 (M5), 16 GB |
| iPhone 13 / 14 | 2532×1170, dpr 3 | 60 | A15, 4-core GPU, 4 / 6 GB |
| iPhone 15 / 16 | 2556×1179, dpr 3 | 60 | A16 5-core / A18 5-core, 6 / 8 GB |
| mid Android (Galaxy A54 as the stand-in) | 2340×1080, dpr ~2.6 | 60 (panel 120) | Exynos 1380, Mali-G68 MP5, 6–8 GB |
| desktop Chrome | whatever, dpr 1–2 | 60–144 | anything with a discrete GPU |

The budgets. "Pixel budget" is the framebuffer the client asks for, not the
panel: in XR it is `framebufferScaleFactor` on the layer, flat it is the
`devicePixelRatio` cap. Draw calls and triangles are for one frame, both
eyes; three.js r186 renders each eye as a pass, so a headset pays twice per
object. Texture memory is what may be resident at once, decoded and on the
GPU, including the lightmaps.

| | Quest 3 | Quest 2 | Pico 4 | Vision Pro Safari | iPhone 13–16 Safari | mid Android Chrome | desktop Chrome |
|---|---|---|---|---|---|---|---|
| bundle tier | vr-quest | vr-quest | vr-quest | vr-high | phone | phone | desktop (= vr-high variants) |
| frame target | 72 Hz, 13.9 ms | 72 Hz (ask for it: the browser defaults to 90) | 72 Hz | 90 Hz, 11.1 ms, the compositor decides | 60 Hz, 16.7 ms | 60 Hz | 60 Hz; a 120 Hz screen is a bonus |
| pixel budget | scale 1.0; 0.8 in a splat room | scale 0.9 | scale 0.9 | scale 1.0 (Safari picks) | dpr cap 1.5 (today) = 0.75 Mpx | dpr cap 1.5 | dpr cap 2 |
| foveation | `fixedFoveation` 0.2 today; 0.5 in splat and orchard rooms | 0.5 | 0.5 if honoured | none exposed | – | – | – |
| draw calls / triangles | 150 / 300k | 100 / 200k | 100 / 200k | 150 / 300k | 100 / 200k | 80 / 150k | 500 / 2M |
| texture memory resident | 256 MB | 192 MB | 192 MB | 384 MB | 128 MB (iOS WebGL heap 300–500 MB total, jetsam) | 128 MB | 512 MB |
| KTX2 transcode target | ASTC 4×4 | ASTC | ASTC | ASTC (verify with `detectSupport`) | ASTC (verify) | ASTC, ETC2 on old Mali | BC7 (BPTC), DXT on old cards |
| video decoders at once | 1 (Meta: play a single video at a time) | 1 | 1 | 1 (no page says more; assume 1) | 1, native HLS, hardware | 1, hls.js over MSE | 1 by rule; 2 possible, unmeasured |
| HLS rung ceiling | 1080p | 720p | 720p | 1080p | native ABR picks; ladder serves all three | 720p (`capLevelToPlayerSize`) | 1080p |
| positioned audio sources | 16 | 16 | 16 | 32 | 8 | 8 | 32 |
| AVIF decode | yes (Chromium 146+) | yes | yes (Chromium-based) | yes (Safari 16+) | yes, iOS 16+ | yes, Chrome 85+ | yes |
| still tier to fetch | phone (1600) | phone | phone | full (4096) | phone | phone | full |
| WebXR session | immersive-vr | immersive-vr | immersive-vr | immersive-vr (no AR module) | none | none | immersive-vr only with an OpenXR runtime present (not fetched, from general knowledge) |
| hand tracking | yes, 25 joints per hand (`hand-tracking`) | yes | no in the Pico browser (Wolvic has it) | yes, plus `transient-pointer` gaze-and-pinch; no controllers | – | – | runtime-dependent |
| layers | yes: projection, cylinder, equirect, media layers for video | yes | not confirmed on a fetched page | not documented | – | – | runtime-dependent |
| WASM / SharedArrayBuffer | WASM yes; SAB **no** | no | no | no | no | no | no |
| splat ceiling (someotherlife's priors) | 300–500k, SH 0–1, 5–10 MB; 72 Hz at reduced scale; the sort is 10–20 ms on the CPU | 200k | 250k | 1M (Spark's Vision Pro demo; treat 1M as the top, 500k as the budget) | 150–250k, SH 0, 2–4 MB | 150k | 1.5–2M, SH 2–3, 25–50 MB |
| point cloud (tape slots) | 16k slots, ≤14 px | 8k | 8k | 32k | 4k (2k today) | 4k | 64k |
| audio: convolvers / panners / HRTF | 1 / 8 / 2 | 0 (parametric) / 6 / 0 | 0 / 6 / 0 | 1 / 8 / 2 | 0 / 4 / 0 | 0 / 4 / 0 | 2 / 16 / 4 |

Notes on the rows.

- **SharedArrayBuffer is off everywhere and stays off.** `grove/public/_headers`
  sends `Cross-Origin-Opener-Policy: same-origin` and no
  `Cross-Origin-Embedder-Policy`; both are required for `crossOriginIsolated`
  (web.dev). Sending COEP `require-corp` would demand CORP headers on every
  media byte from `media.weichseltree.com` and would break the Turnstile frame
  from `challenges.cloudflare.com`; `credentialless` exists in Chromium only.
  So every worker path (KTX2 transcode, hls.js, a splat sort) must move data
  by transfer, not by shared memory. Spark's default sort worker uses a
  SharedArrayBuffer (World Labs' Spark 2.0 post); the splat kind needs the
  non-shared path proven before it is a kind (BACKLOG 22).
- **Positioned audio sources are a budget, not a measurement.** The row is
  `AUDIO-STREAM.md` §5's proposed cap on simultaneous positioned per-node
  sources for a live stream exhibit, with the rest folded into one
  non-positioned bed; §7 item 2 is what turns it into a fact.
- **Draw calls, not triangles, are the Quest ceiling.** Meta's own example:
  1000 triangles as 1000 draw calls falls under 72 Hz on CPU cost alone. The
  scene today is 7 draw calls in the einstruct room, 21 with the hall in view,
  244 triangles (measured). The palace and its orchard will spend this budget;
  instanced trees and one mesh per room are how (BACKLOG 13).
- **Texture memory is the row that bites first, and stills are why.** A `full`
  still is 4096 px wide; decoded at 16:9 it is 4096×2304×4 = 38 MB of VRAM,
  uncompressed, before mips. `STILL_TIER_PREFERENCE` in
  `grove/src/tape/bundle.ts` gives `vr-quest` the `full` tier first, so a Quest
  in the world-engine room holds three of them: 113 MB, plus the hall's
  lightmap. The `phone` tier (1600 px) is 5.8 MB each. The table above moves
  every headset but the Vision Pro to `phone`; a `quest` tier at 2048 px
  (9.4 MB) in `orchard/bundle.py`'s `STILL_TIERS` is the better fix when a
  wall is 6 m and 1600 px reads soft.
- **The lightmap.** `lightmap.ktx2` is 2.0 MB on disk (UASTC, zstd, mips) and
  about 5.6 MB on the GPU at 2048² ASTC 4×4 with mips; `lightmap-1024.ktx2` is
  0.6 MB on disk, 1.4 MB resident; the PNG fallback decodes to 16 MB. Every
  baked room of the palace costs this much again, which is why rooms two
  doorways away unload (§2).
- **Tape points are cheap to draw and expensive to upload.** A frame is
  8 bytes per slot (`orchard/bundle.py`, `BYTES_PER_SLOT_FRAME`); 4,000 slots
  cost 3.6 µs per frame on the CPU (measured) and one `Points` draw. The
  ceiling is the per-frame upload: 16k slots is 128 kB per frame, at 36 Hz
  (vr-quest, every 2nd frame at 72 Hz) 4.6 MB/s into the GPU, still fine;
  spectre's full 508,744 particles would be 4 MB per frame and are out of the
  question on any tier. BACKLOG 16's 16k slots at every 4th frame (~36 MB a
  tape) is the Quest number. With 16k slots a 60-frame chunk is 7.7 MB, so
  `CHUNK_FRAMES` must scale with slots to keep a chunk at or under 2 MB
  (16k slots: 15 frames a chunk); three resident chunks are then still ~6 MB.
- **Video.** The ladder is 360p at 800 kbit/s, 720p at 2.8 Mbit/s, 1080p at
  5 Mbit/s, 6 s segments (`orchard/bundle.py`, `RUNGS`). One 1080p decode on
  a Quest 3 is inside Meta's "one video" rule; one wall at a time is already
  mechanical in `grove/src/media/videowall.ts`. The Quest browser hardware-
  decodes H.264, H.265 and AV1 (AV1 not on Quest 2); the ladder is H.264 and
  stays so until every tier has an AV1 decoder. iPhone plays HLS natively
  with hardware decode; since iOS 17.1 Managed Media Source lets hls.js 1.5+
  run there too, but the native path stays first because it is the one that
  is hardware-decoded and battery-cheap (WebKit blog). Chromium answers
  `"maybe"` to native HLS, so `Hls.isSupported()` is tested first (WP2).
- **Frame rate.** The Quest browser exposes `session.supportedFrameRates` and
  `updateTargetFrameRate()`; it defaults Quest 2 to 90 and the others to 72
  (Meta's frame-rate page). The client should ask for 72 on every Quest, and
  step down (Meta's advice) rather than drop frames: if the 1 s average frame
  time exceeds the target by 10 %, lower the pixel scale by 0.1 first, then
  the rate.
- **Audio** rows are budgets from the Web Audio cost order (convolver and HRTF
  panner are the expensive nodes; padenot's notes and the HdM article), not
  measurements; §4 says what the numbers mean.

## 2. The exhibit lifecycle

Five states for every hanging, whatever its kind:

    unloaded   nothing resident but the hanging's row in mansion.json
    poster     a picture: the bundle's poster/thumb on a plane (or a sprite)
    loaded     bytes resident (first chunk, HLS master, the still's texture,
               the splat's tier file), not advancing, not audible
    playing    advancing on the clock, audible if it has audio
    foreground the one nearest in the visitor's room: gets the decoder,
               the HUD readout, the scrubber, the unmute

Exactly one exhibit per kind may be `foreground`, and only one video wall in
the whole world may be past `poster` (the decoder rule). The transitions are
decided from six inputs, re-evaluated every 400 ms (the cadence
`handOverVideo()` already uses in `grove/src/main.ts`), never per frame:

| input | comes from |
|---|---|
| room membership | `body.room` (`grove/src/control/locomotion.ts`) |
| distance | body to the exhibit's `bounds` centre, metres |
| portal visibility | the visibility map, §3 |
| device tier and budgets | `detectDevice()`, §1 |
| the one-decoder rule | `videowall.ts` |
| memory pressure | textures and tape bytes resident against the §1 budget; `webglcontextlost` |

The rule, in order of precedence:

1. **In the room you stand in: `playing`**; the nearest of each kind is
   `foreground`. A wall further than 12 m in a big room stays `loaded` (it is
   a picture at that distance anyway and it must not steal the decoder).
2. **In an adjacent room (one doorway away): `loaded`** if the map says it is
   visible through the aperture from anywhere in your room, else `poster`.
   Adjacent rooms are the prefetch set: their shell (glb + lightmap tier),
   every hanging's `bundle.json` and poster, the first chunk of each tape, the
   HLS master playlist but no segment. Prefetch is capped: 24 MB on a Quest,
   8 MB on a phone, in hanging order, the rest stays `poster`.
3. **Two doorways away: `poster`** if visible through two apertures (rare;
   the map says), else **`unloaded`**: geometry, textures and streams
   disposed, `bundle.json` kept in memory (it is a few kB and it is the
   provenance).
4. **Memory pressure demotes farthest-first**, one step per tick, until under
   budget: `loaded` in the far room to `poster`, then `poster` to `unloaded`,
   never anything in the room you stand in.
5. **A tier caps the top state per kind**: a `phone` never holds more than one
   tape `playing` at once (the others in the room are `loaded` and drawn
   frozen); a splat is `playing` only on tiers with a splat ceiling above its
   `vr-quest` count.

Per kind:

| kind | poster | loaded | playing | foreground | unloaded |
|---|---|---|---|---|---|
| tape | the bundle's `poster` (1280×720 JPEG, the middle frame) on the sheet's plane, or a sprite of it at the pedestal for a 3D ball | `bundle.json`, the variant's chunk at the clock's `tau`, the `Points` geometry uploaded once, frozen, lamp grey | advancing on the clock, `TapeStream` at 3 resident chunks, prefetch ahead | + HUD readout, scrubber, lamp green | stream disposed, geometry disposed |
| video | the poster on the plane (built this way today) | master playlist fetched, `<video>` in the document, no `src` | `attach()`: hls.js or native, muted unless unmuted | the same wall; there is never a `playing` wall that is not foreground | `dispose()`: element removed |
| still | `thumb.jpg` (640 px) on the plane | the tier image decoded (AVIF, else JPEG) | = loaded; a still does not advance | + provenance target preferred | texture disposed, thumb kept if under 1 MB total |
| splat vantage point | the AVIF preview on the station's plane, the station marker on the floor | the tier file parsed, occluder mesh resident, not sorted | sorted each turn of the head; the headbox active when you stand on the marker | + orbit clamped to the coverage radius, locomotion off inside it | everything disposed; the marker stays |
| page (future, BACKLOG 21) | a plaque with the title | the HTML fetched into a blob | opened flat, in a DOM panel outside XR, a canvas-rendered plaque inside | the open panel | nothing |

**Tapes on one clock.** A clock group is every tape in a room whose variants
have identical `frames`, `dt_tau` and `t0_tau` (einstruct's pair, spectre's
trio; `docs/DECISIONS.md` "Several tapes, one transport"). The group owns one
`tau`, one `playing`, one `speed`; each member reads `tau` and uploads the
frame `frameAt(timeline, tau)`. A member in `loaded` does not advance and
does not upload; it holds its last uploaded frame in its geometry buffer
(the buffer is not cleared on a state change), so a sheet seen through a
doorway is frozen at the moment you left, not blank. When it returns to
`playing` it takes the group's `tau`, which kept advancing, and requests that
chunk; the lamp reads "waiting" until it lands, then it is in step again. The
client already does half of this: `main.ts` advances only the tapes of
`body.room` and scrubs all of them, so a paused tape keeps its `tau`. What it
does not yet do is release the paused tape's chunks: each paused tape keeps
3 × 1.92 MB resident (5.76 MB measured), so the six tapes in mansion.json
hold 34 MB across the mansion. `loaded` means `TapeStream.release()`: abort
inflight fetches, drop residents to zero, keep the variant and the counters,
so the next `request()` refetches from the browser cache (`cache:
"force-cache"`, content-addressed). Scrubbing while `loaded` moves `tau` and
nothing else.

**Prefetch of the adjacent room** starts on the doorway crossing
(`body.crossedInto`) and on boot for the start room's neighbours; it is
cancelled when the room stops being adjacent. Order: shell, then hangings in
mansion.json order, then tape chunks; each fetch checked against the cap
before it starts. On a phone the boot budget is the spec's 20 MB (M0 §6):
today's first tape frame at 3.4 MB and ten seconds under 5 MB (measured)
leave room for one adjacent room's shell and posters, not its tapes.

**What is a sprite.** A `poster` is one textured plane, one draw call, no
stream and one texture at most 1280×720 (the tape poster) or 640 px wide (the
still thumb). A tape hung as a 3D ball gets a billboard sprite at the
pedestal rather than a plane in the volume, because a flat picture inside a
ball reads wrong from the side. A video wall's poster is its plane already.

## 3. The visibility map

A baked structure, `grove/src/world/visibility.json`, beside `mansion.json`,
validated by a zod schema in `grove/src/world/schema.ts`; the client refuses
to boot with a map that names a room or doorway mansion.json does not have.

```json
{
  "schema": "orchard/visibility/1",
  "bakedFrom": "bounds+doorways",
  "rooms": {
    "einstruct": {
      "adjacent": ["hall", "world-engine", "phototroph", "spectre"],
      "apertures": [
        {"to": "hall", "doorway": 0, "axis": "z", "at": -10, "center": 0,
         "width": 2.4, "height": 3.2, "areaM2": 7.68},
        {"to": "spectre", "doorway": 3, "axis": "z", "at": -20, "center": 5,
         "width": 2.4, "height": 3.2, "areaM2": 7.68}
      ],
      "sees": [
        {"room": "hall", "through": [0], "hangings": ["hall-poster"],
         "maxDistanceM": 28.0},
        {"room": "spectre", "through": [3],
         "hangings": ["spectre-chi12", "spectre-wall"], "maxDistanceM": 22.0}
      ]
    }
  }
}
```

`sees` lists, for each room reachable through one or two apertures, which
hangings can be seen from *anywhere* in this room (conservative: the union
over standing points) and the largest distance from any standing point to
that hanging's bounds. The state machine reads `sees[].hangings` to decide
`loaded` against `poster` for adjacent rooms, and `maxDistanceM` to pick the
still tier and the tape poster size for what is only ever seen far off.

**Baking today, from bounds and doorways** (`grove/scripts/bake-visibility.ts`,
run by `pnpm bake:visibility`, its output committed): for every room A and
doorway d into B, the visible region of B is the union of wedges from
standing points in A (sampled on a 0.5 m grid inside A's inset bounds)
through the aperture rectangle. A hanging of B is visible if its `bounds`
intersect any wedge; a room C beyond B is reachable if any wedge through d
also passes through an aperture of B. The bake is deterministic, takes a
second, and a test holds the committed file equal to a fresh bake so the two
cannot drift.

**Baking later, from the palace geometry**: the bake script renders an id
buffer from the same standing grid through each room's glb (headless
Chromium, the existing screenshot tooling in `grove/tools/`), reading which
hanging ids and which rooms' meshes appear. Same JSON, `bakedFrom:
"geometry"`. Bounds and doorways remain the fallback for a grey box room.

**The map gates sound too.** Presence audio (M1's voice) and exhibit audio
use the same file: you hear at full what is `playing` in your room; you hear
an adjacent room only through an aperture, attenuated by `areaM2` over the
distance squared and low-passed (§4); you hear nothing from a room the map
does not list. Who you hear and what you hear are one decision, made from
one structure, so a wall that blocks sight blocks sound and a doorway that
shows a sheet lets its narration through.

## 4. Sound

Nothing in the grove has audio yet but the video wall's track (muted until
the button). M1 brings voice (BACKLOG 7); einstruct's masters bring
narration (LAWS 18). The plan:

- **Per-room reverb, pre-baked.** One impulse response per baked room,
  produced by the bake pipeline beside the lightmap: `assets/<room>/ir.wav`,
  mono, 48 kHz, 16-bit, trimmed at −60 dB, at most 1.5 s. 1.5 s is 144 kB;
  eight rooms are about 1.2 MB, no tiers needed. WAV rather than Opus because
  a `ConvolverNode` wants a decoded `AudioBuffer` and `decodeAudioData` on
  WAV is the one path every browser gets right. Grey box rooms get
  parametric reverb: a feedback delay network of `DelayNode` and
  `BiquadFilterNode` with `{rt60_s, predelay_ms, damping}` from a `sound`
  field in `mansion.json` (200 bytes, no file).
- **Occlusion through doorways.** A source in an adjacent room is routed
  through a `BiquadFilterNode` low-pass at 1.2 kHz and a gain of
  `min(1, areaM2 / (4π d²))` where `d` is the distance to the aperture
  centre, both from the visibility map; then into your room's reverb, not
  the source room's. Two apertures away: nothing.
- **Panners.** Equal-power `PannerNode`s with `distanceModel: "inverse"`,
  `refDistance` 1, `maxDistance` 30 for every voice and every exhibit source;
  HRTF only where the §1 row allows and only for the foreground exhibit's
  narration, because HRTF is convolution per source and costs what a
  convolver costs.
- **The budget per tier** is the last row of the §1 table: one convolver,
  eight panners and two HRTF on a Quest 3; none, six and none on a Quest 2, a
  Pico 4 or a phone (parametric reverb only, which is a handful of delays);
  two convolvers on a desktop so a room hand-over can crossfade. Voices
  beyond the panner count are mixed dry at their gain, nearest first.
- **One `AudioContext`**, created on the first gesture (the unmute button,
  the Enter VR button), suspended when the page hides. Video walls connect
  through `createMediaElementSource` on Chromium; on iOS Safari a native HLS
  element cannot be routed into Web Audio (Apple forum thread in the
  sources), so the wall's audio there stays direct and the reverb is skipped
  for it, and the map still gates whether it is audible.

## 5. The measurement plan

**Instrument the client.** `PerfMeter` (`grove/src/ui/perf.ts`) reports fps,
frame ms, worst ms, draw calls, triangles, points, geometries, textures,
programs, dpr and the nearest tape's chunks. Add:

- per exhibit: id, kind, room, state, bytes resident (tape: `stream.stats`;
  video: `mode`, current level height, `getVideoPlaybackQuality().droppedVideoFrames`;
  still: tier, format, texture bytes as width×height×4, or ÷4 for KTX2),
  and the state's age;
- totals: texture bytes against the §1 budget, tape bytes, prefetch bytes;
- the session: `session.frameRate`, `supportedFrameRates`, the layer's
  `framebufferWidth×Height`, `fixedFoveation`, `crossOriginIsolated`, the
  KTX2 target `detectSupport` chose, `renderer.info.memory`;
- a `?perf=1` query that opens the panel at boot and mirrors it into the
  in-world board (`grove/src/ui/worldnotice.ts`), because `F` does not exist
  in VR; and `window.grove.snapshot()` returning all of it as JSON so a
  headset run can be read back over the console or copied into the table.

**The table to fill on real hardware**, one row per device and room, 60 s
standing at the spawn then 60 s walking, exhibits in their natural states:

| device, browser build | room | fps avg | frame ms avg / worst | calls / tris / pts | textures MB | tape MB | video mode, rung, dropped/30 s | audio nodes | first frame s | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Quest 3, Browser 150.x | hall | | | | | | | | | |
| Quest 3 | einstruct (2 tapes, 2 walls) | | | | | | | | | |
| Quest 3 | spectre (3 balls, 1 wall) | | | | | | | | | |
| Quest 3 | world-engine (3 stills) | | | | | | | | | |
| iPhone (model, iOS) | hall | | | | | | | | | |
| iPhone | einstruct | | | | | | | | | |
| iPhone | spectre | | | | | | | | | |
| desktop Chrome (this box) | each | | | | | | | | | |

Pass / fail:

| device | pass |
|---|---|
| Quest 3 | 72 Hz held: frame ms avg ≤ 12.5, worst ≤ 16.0 over each 60 s window in every room; 0 dropped video frames per 30 s after the first 5 s; no `webglcontextlost` in 10 min; textures ≤ 256 MB; `supportedFrameRates` includes 72 and `frameRate` reads 72 |
| Quest 2 (if one turns up) | same at avg ≤ 12.5 ms after asking for 72; textures ≤ 192 MB |
| iPhone | fps ≥ 55 avg, worst frame ≤ 33 ms; first tape frame ≤ 5 s and first ten seconds ≤ 20 MB on 4G (M0 §6); native HLS `readyState` 4 with the wall visible (the `VideoTexture` fix, WP2 open issue 1); AVIF chosen for stills; no context loss in 10 min; textures ≤ 128 MB |
| desktop | a baseline row, not a gate: it is the box the numbers above are compared against |
| any | `crossOriginIsolated === false` recorded (expected), the KTX2 target recorded, hand tracking and layers recorded as granted or refused |

A fail on frame time is answered in this order: pixel scale down 0.1, then
foveation up, then the still tier down, then the frame rate down; never by
thinning the tape variant, which is a bundle decision.

## 6. Migration, smallest first

Each step is one commit, each keeps `pnpm test` and `pnpm typecheck` green
and each is useful on its own.

1. **Still tier for headsets.** `grove/src/tape/bundle.ts`:
   `STILL_TIER_PREFERENCE["vr-quest"]` becomes `["phone", "full", "thumb"]`.
   One line, saves ~100 MB of VRAM in the world-engine room on a Quest.
   Test in `grove/src/media/still.test.ts`.
2. **The budget table.** New `grove/src/budgets.ts` exporting `Budget` (the
   §1 columns as fields) and `budgetFor(profile)`; `grove/src/device.ts`
   tells Quest 2, Quest 3, Pico and VisionOS apart by user agent and returns
   `budget` on `DeviceProfile`. `grove/src/device.test.ts` gains the four
   user agents.
3. **Perf panel, per-exhibit lines and the snapshot.** `grove/src/ui/perf.ts`
   takes a list of `{id, kind, room, state, bytes}`; `grove/src/main.ts`
   builds it at the 400 ms cadence and adds `?perf=1` and
   `window.grove.snapshot()`. `videowall.ts` exposes `level` and
   `droppedFrames`. This is what BACKLOG 3's hardware pass fills §5 with,
   so it goes before anything that changes behaviour.
4. **Frame rate and foveation from the budget.** `grove/src/control/xr.ts`
   calls `updateTargetFrameRate(budget.frameRateHz)` on `sessionstart` when
   `supportedFrameRates` has it; `grove/src/render/view.ts` takes
   `setFoveation(budget.foveation)` and the pixel-scale step-down of §1.
5. **Tape release.** `grove/src/tape/stream.ts` gains `release()` (abort
   inflight, clear residents, keep counters); `grove/src/world/tape-exhibit.ts`
   gains `setState("loaded" | "playing")` that releases on `loaded` and
   re-requests the clock's chunk on `playing`. `stream.test.ts` covers
   release-then-frame refetching from cache.
6. **The state machine, pure.** New `grove/src/world/exhibit-state.ts`:
   `decide(inputs) -> Map<id, State>` from room, distances, the map, the
   budget and the resident bytes; `exhibit-state.test.ts` drives the rules of
   §2 (one foreground per kind, one wall past poster, farthest-first
   demotion, the phone's one playing tape). `main.ts` replaces
   `handOverVideo()` and `nearestTape()` with one `applyStates()` at the same
   cadence, calling `attach/release`, `setState` and the still's
   `load/unload`.
7. **The visibility map.** `grove/scripts/bake-visibility.ts`, the schema in
   `grove/src/world/schema.ts`, `grove/src/world/visibility.json` committed,
   a test that the file equals a fresh bake. The state machine reads it for
   `loaded` against `poster` in adjacent rooms. `navigation.ts` is untouched.
8. **Rooms by adjacency.** `grove/src/world/world.ts` loads the start room
   and its adjacent shells at boot and the rest on membership change, with
   `disposeRoom()` for two-away rooms; hangings are created in `poster`
   (plane and poster texture only) and promoted by the machine, instead of
   every tape and wall loading at boot. This is the step that changes what a
   phone downloads; measure before and after with step 3.
9. **Chunk size with slots** in `orchard/bundle.py`: `chunk_frames =
   min(CHUNK_FRAMES, floor(2 MB / (n × 8)))`, with the per-artefact slot
   budget of BACKLOG 16; the format does not change, `bundle.json` already
   carries `chunk_frames` per variant. A `quest` still tier at 2048 px in
   `STILL_TIERS` and `["quest", "phone", "full", "thumb"]` in the client.
10. **Sound**: `grove/src/audio/` (context, room reverb, occlusion routing,
    panner pool), `sound` in `mansion.json`, `ir.wav` from the bake script
    beside the lightmap, the wall routed through it where the browser
    allows. After M1's voice, so the panner pool is designed once.
11. **The splat kind**, after Spike C's numbers and a demonstrated
    non-SharedArrayBuffer sort: a `splat` hanging in the schema, `poster`
    from the AVIF preview, the headbox, the orbit clamp lifted from
    someotherlife (BACKLOG 22, 23).
12. **The page kind** (BACKLOG 21): a plaque, a blob URL, a DOM panel; last
    because it needs no budget beyond a fetch.

## Sources

Pages fetched for this document (2026-09-12):

- Meta Horizon OS browser release notes, https://developers.meta.com/horizon/release-notes/web/ — Chromium 146 (Apr 2026), 150.1 (Aug 2026), WebGPU foveation, MV-HEVC.
- Meta, WebXR Hands, https://developers.meta.com/horizon/documentation/web/webxr-hands/ — 25 joints per hand.
- Meta, WebXR fixed foveated rendering, https://developers.meta.com/horizon/documentation/web/webxr-ffr/ — `fixedFoveation` 0–1, fragment-bound benefit, quality caveat.
- Meta, WebXR frame rate control, https://developers.meta.com/horizon/documentation/web/webxr-frames/ — Quest 2 defaults 90, others 72; `supportedFrameRates`, `updateTargetFrameRate`.
- Meta, WebXR Layers, https://developers.meta.com/horizon/documentation/web/webxr-layers/ — cylinder, equirect, media layers; GPU bus busy 50.2 % to 23.9 %.
- Meta, WebXR performance best practices, https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/ — fragment-bound, KTX2/Basis, one light, overdraw order; the 1000-draw-call example is from the search summary of the same page family.
- Meta, browser video support, https://developers.meta.com/horizon/documentation/web/browser-video/ — one video at a time; H.264/H.265/VP9/AV1; AV1 not hardware on Quest 2/Pro, VP8 not on Quest 3.
- VRDB, Quest 3, https://vrdb.app/device/meta-quest-3 — 2064×2208, 72/90/120, XR2 Gen 2, Adreno 740, 8 GB.
- Wikipedia, Meta Quest 2, https://en.wikipedia.org/wiki/Meta_Quest_2 — 1832×1920, XR2, Adreno 650, 6 GB.
- Wikipedia, Pico 4, https://en.wikipedia.org/wiki/Pico_4 — 2160×2160, 72/90, XR2, 8 GB; Pico 4 Ultra XR2 Gen 2, 12 GB.
- Wikipedia, Apple Vision Pro, https://en.wikipedia.org/wiki/Apple_Vision_Pro — ~3660×3200, 90/96/100 (M5: 120), 16 GB.
- UploadVR, visionOS 2 WebXR, https://www.uploadvr.com/visionos-2-apple-vision-pro-webxr/ — on by default, transient-pointer, no AR module.
- Wikipedia, list of iPhone models, https://en.wikipedia.org/wiki/List_of_iPhone_models — A15/A16/A18, GPU cores, RAM, resolutions.
- Wikipedia, Galaxy A54, https://en.wikipedia.org/wiki/Samsung_Galaxy_A54 — Exynos 1380, Mali-G68 MP5, 6/8 GB, 1080×2340.
- web.dev, COOP and COEP, https://web.dev/articles/coop-coep — both headers required; `credentialless` Chromium 96+.
- WebKit, Safari 17.1, https://webkit.org/blog/14735/webkit-features-in-safari-17-1/ — Managed Media Source on iPhone.
- three.js `KTX2Loader.js`, https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/KTX2Loader.js — UASTC: ASTC, BC7, ETC2, …; ETC1S: ETC2, ETC1, BC7, …; worker pool.
- Spark, performance tuning, https://sparkjs.dev/docs/performance/ — ≤1M splats Quest 3, 1–2M Android, 1–3M iPhone; `maxStdDev` √5 for VR; no MSAA.

From search summaries only (not the page itself): Pico browser lacks the WebXR Hand Input API (Igalia/wolvic issue 365 and Wolvic 1.3 notes); Spark's sort worker uses a SharedArrayBuffer (World Labs, Spark 2.0 post); iOS WebGL heap 300–500 MB and jetsam (Catch Metrics, Bugnet); iOS Safari cannot route a native HLS element into Web Audio (Apple developer forum thread 694697); Web Audio node cost order (padenot's web-audio-perf notes, HdM Stuttgart blog). Desktop Chrome's need for an OpenXR runtime was not fetched.

In-repo sources: `docs/impl/WP2-grove.md` (measured budgets, download sizes), `docs/EXHIBIT-PLAN.md` (someotherlife's splat priors, spectre's 508,744 particles and 1,129 frames, phototroph's tape), `docs/BACKLOG.md` 16–23, `docs/PLATFORM.md`, `orchard/bundle.py` (`SLOT_BUDGET`, `CHUNK_FRAMES`, `RUNGS`, `STILL_TIERS`), `grove/public/assets/hall/` file sizes, `grove/public/_headers`.
