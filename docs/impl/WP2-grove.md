# WP2 · the grove client

## What changed after the review (2026-09-12)

`docs/reviews/WP2-grove-review.md` accepted the client with fixes. Every high
and medium finding is applied, plus the coordinator's rulings.

1. **Presence, the one untested module, is now tested and fixed.** A refused
   `join` ("room full", "room closed", "admin only") used to re-ask in
   `.finally` at network speed; it now records the refusal, says why in the
   HUD, falls back to `grove` exactly once, and stops. A dropped socket used to
   be permanent; there is now reconnection on jittered backoff (1 s doubling to
   30 s), the room is re-joined on reconnect, and "single-player" stays up
   while it retries. Everything the class touches on the connection is behind
   `PresenceConnection`, so 12 tests drive both paths against a stub.
2. **The tape lies flat.** `rotationDeg` was parsed and silently ignored; it is
   honoured, and the provenance picker aims at the *rotated* AABB. Per the
   ruling a 2D tape is horizontal — the tape's thin axis maps to world up — and
   the sheet is centred 1.0 m up: `[0, 1.0, -15.4]`, `[-90, 0, 0]`, a 6 × 6 m
   table over x −3..3, z −18.4..−12.4, with the pedestal at its near edge
   (z −12.4). 3D tapes keep `[0,0,0]` and 1.2 m. Verified in the browser.
3. **The `<video>` element is in the document** (1 px, `opacity: 0`, fixed, not
   `display: none`), with `playsinline` and `muted` as attributes: a detached
   element does not decode into a `VideoTexture` on iOS Safari.
4. **The lightmap intensity comes from the bake.** three r155+ dropped the 1/π
   from the lightmap path, so the client binds
   `asset.extras.orchard.lightmap.three_light_map_intensity` (10.715413 for
   this bake), falling back to `scale * Math.PI`. The hardcoded 1 is gone, and
   the fallback room lights drop to 0.12 when a bake is doing the work.
5. **The asset's markers are the authority.** `spawn`, `door_einstruct` and
   `poster_wall` are read out of the glb; the spawn's position and yaw and the
   doorway's `at`/`center`/`width`/`height` override `mansion.json`, which
   keeps only the room graph. That closes the 0.5 m spawn disagreement without
   copying numbers. `extras.eye_height_m` is read but not obeyed — WP3 says it
   is the height its preview was rendered from, not an instruction — and
   `EYE_HEIGHT` is now 1.6 to match anyway.
6. **Nothing but real assets is deployed.** The dev fixtures moved out of
   `public/` to `grove/dev/`, served in `pnpm dev` by a `apply: "serve"`
   middleware, and WP3's `preview.png` is dropped from `dist` at build time
   (the file stays where WP3 writes it). `dist` went from **23 MB to 4.9 MB**
   and no longer depends on who last ran `pnpm dev:bundle`. `public/_headers`
   adds a CSP, immutable caching for `/assets/*` and `/basis/*`, and
   `xr-spatial-tracking` in the permissions policy.
7. **The real bundles are wired in.** `mansion.json` names tape
   `84b67b5a0d22eeab` and video `2dc8ca525724aefd`, resolved against
   `https://media.weichseltree.com/<id>/`. `pnpm dev` overrides that one
   constant to `/local-bundles`, served straight out of `results/bundles/`.
8. **Medium and low findings.** `hand-tracking` is no longer requested (a hand
   source has no gamepad and would kill every input); controllers are tracked
   by the `connected` event's handedness, not by index; `webglcontextlost` is
   caught and the page survives a Quest sleep; notices are drawn into an
   in-world board while presenting, because in VR there is no DOM; the world
   group goes into the scene empty and fills as each shell lands, so the first
   frame is a room; XR input is zeroed on `sessionend`; `detectDevice` catches
   an iPad in desktop mode via `maxTouchPoints`; `variantSlots` reads
   `variants[*].n`; a slot-count mismatch is a notice, not a `RangeError` in
   the frame loop; the shader clamps the species index to the palette;
   `t0_tau` is honoured; and the per-frame allocations in `resolveMove`, the
   HUD readout and `sendPose` are gone.
9. **Tests: 89, from 58.** New: presence (refusal, no-loop, missing room,
   subscription strings, backoff schedule, reconnect and re-join, `move` at
   10 Hz and once on stopping, dispose), the rotated-tape transform,
   `detectDevice` across four devices, and **WP1's real bundle** — chunk
   tiling, header `dt` against `bundle.json`'s f64, species and alive counts,
   quantization round-trip, and a 20,000-step property test that playback at
   4× never leaves the tape on any variant. The real-bundle file skips with a
   message when `results/bundles/` is not present rather than committing a
   0.96 MB blob.

Still true, and still the gap: **nothing has run on a real headset or a real
phone.**

The WebXR client for M0, in `grove/`. One hall, one room, one video wall, one
particle tape you can walk into and scrub, presence over the live SpacetimeDB
database, on desktop, Quest browser and phone. Written against
[docs/specs/M0-hall.md](../specs/M0-hall.md); WP1 (bundles) and WP3 (the bake)
run in parallel, so the client degrades to a synthetic bundle and a grey shell
rather than waiting on either.

Status: `pnpm build`, `pnpm typecheck` and `pnpm test` (89 tests) all pass.
Verified in desktop Chromium against WP1's real bundles and WP3's final bake,
in an emulated phone context, and against a stubbed WebXR runtime. Not yet run
on real Quest hardware or a real phone.

## What is there

```
grove/
  index.html                 the site home: the holding page plus "Enter the grove"
  grove/index.html           the app
  vite.config.ts             two pages, one build, base "/"
  scripts/copy-basis.mjs     Basis transcoder out of three into public/basis/
  scripts/make-dev-bundle.ts writes a synthetic bundle into grove/dev/ (never public/)
  public/_headers            CSP and cache policy for Cloudflare Pages
  src/
    main.ts                  boot, the frame loop, the wiring
    config.ts                media host, SpacetimeDB URI, presence rates, palette
    device.ts                desktop | phone | headset, and the pixel-ratio cap
    world/
      mansion.json           THE scene document: rooms, glb, spawn, doorways, hangings
      schema.ts              its zod schema; a bad edit fails at boot
      world.ts               builds the mansion out of it
      rooms.ts               glb + lightmap, or the procedural grey shell
      sky.ts                 the dome outside the windows, sun from the bake record
      navigation.ts          the per-room AABB clamp and the doorway crossing
      tape-exhibit.ts        the tape volume, its clock and its pedestal
    tape/
      format.ts              the chunk layout, one place, from the spec table
      decode.ts              TapeChunk: header + zero-copy frame views
      encode.ts              the same layout, writing
      devtape.ts             the synthetic A+B tape (used by the generator AND the tests)
      stream.ts              chunk fetching, at most 3 resident, LRU
      volume.ts              one THREE.Points, custom shader, u16 straight to the GPU
      time.ts                scrubber maths, pure
      bundle.ts              bundle.json schemas and variant selection
    media/videowall.ts       hls.js / native HLS, exactly one decoder
    net/presence.ts          SpacetimeDB: anonymous identity, join, move at 10 Hz
    net/avatars.ts           other visitors as capsules with name sprites
    control/                 desktop (pointer lock + WASD), touch, XR, locomotion
    render/view.ts           renderer, scene, camera, rig, portrait fov
    render/lightmap.ts       UV2 binding, KTX2 then PNG
    ui/                      HUD, provenance panel, in-world notices, perf overlay, CSS
    module_bindings/         generated, do not edit
```

About 5,500 lines of TypeScript, no React, no framework.

## Running it

```bash
cd grove
pnpm install
pnpm dev            # http://localhost:5173/  and  http://localhost:5173/mind/
pnpm test           # vitest, 89 tests
pnpm typecheck
pnpm build          # -> grove/dist/index.html and grove/dist/mind/index.html
pnpm dev:bundle     # optional: a synthetic bundle in grove/dev/ (ffmpeg for the video)
```

`pnpm dev` serves WP1's real bundles straight out of `results/bundles/` at
`/local-bundles/`, so the app runs against the real bytes with no upload. A
build points the same constant at `https://media.weichseltree.com`. Neither
path is under `public/`, so nothing local is ever deployed.

Regenerating the SpacetimeDB bindings, from `grove/`:

```bash
PATH=$HOME/.local/bin:$PATH spacetime generate --lang typescript \
  --out-dir src/module_bindings -p ../spacetime/spacetimedb -y
```

(The spec writes `--project-path`; the CLI's flag is `-p` / `--module-path`.
`pnpm gen:bindings` runs exactly the line above.)

Controls:

| | desktop | phone | Quest |
|---|---|---|---|
| look | click to lock the pointer, then mouse | drag anywhere | head |
| walk | WASD / arrows, shift to run | stick, bottom left | left thumbstick |
| teleport | — | — | squeeze, aim, release |
| scrub | slider, `[` and `]` | slider | right thumbstick left/right |
| play/pause | space or the button | the button | trigger |
| speed | the 0.5x–4x select, or `X` | the select | the select before entering |
| provenance | `P` | the button | the menu button (A/X) |
| frame budget | `F` | — | — |
| unmute | the button, or `M` | the button | the button before entering |

## Decisions worth knowing

**The client never hard-codes a room.** `src/world/mansion.json` is parsed by
a zod schema at boot and everything else reads the parsed document: the shells,
the spawn, the clamp, the doorway, the exhibits, the presence room name. Adding
a room is a change to the JSON. A malformed document throws at boot with the
path of the offending field rather than half-building a world.

**Quantized positions never become floats on the CPU.** The chunk's `u16[3]`
positions go into the geometry as a *normalized* `Uint16` position attribute, so
the GPU sees [0,1] and the vertex shader multiplies by the box size in metres.
Uploading a frame is three `TypedArray.set` calls — 3.6 µs for 4,000 slots — and
nothing is converted, allocated or garbage.

**Frame views are cached per chunk.** `TapeChunk.localFrame(i)` builds the three
subarray views once and hands the same objects back afterwards, so steady
playback allocates nothing after the first pass through a chunk.

**Prefetch follows the playhead's direction.** Warming both neighbours with only
three resident slots costs a fetch at every chunk boundary in both directions;
measured at 23 chunk fetches in nine seconds of ordinary forward playback of a
four-chunk tape, against 5 once the prefetch respects direction.

**MSE is tested before native HLS.** Chromium answers `"maybe"` to
`canPlayType("application/vnd.apple.mpegurl")` on some builds while having no
HLS demuxer at all; asking it first picks a path that silently plays nothing.
`Hls.isSupported()` is the honest test, and Safari falls through to the native
player, which is also the only path with hardware decode on an iPhone. hls.js is
a dynamic import, so a page with no video wall never downloads it.

**One decoder.** `videowall.ts` keeps a module-level flag and refuses a second
wall, which is the decoder budget in `grove/README.md` made mechanical.

**Presence never blocks a frame.** The connection is built after the first
render, every reducer call is fire-and-forget with a `.catch`, a failure sets
the HUD to "single-player" with a notice, and the peer list is rebuilt from the
client cache once per frame only when a table actually changed. `move` goes out
at most every 100 ms and only when the pose moved more than 2 cm or 2 degrees,
plus one last message when the visitor stops.

**Walls.** A per-room AABB inset by a 0.35 m body radius, opened along the one
axis a doorway pierces and only across the opening minus shoulders. Crossing the
doorway plane hands over the room, which is what triggers `join(name, room)`.
Room-scale walking in XR is clamped by pushing the rig back by however far the
head went through the wall. `navigation.test.ts` covers the sideways-slide case
that a naive implementation pops through.

**Provenance targets are boxes, not meshes.** Each exhibit and each room
registers a world-space `Box3`; `P` casts the view ray against them and prefers
an exhibit over the room it hangs in. Outside XR the answer is a DOM panel;
inside XR the same text is drawn into a canvas and hung 85 cm in front of the
head, because the DOM is not there.

## The frame budget

Measured in Chromium 141 (Playwright's build) on this box. **The renderer is
SwiftShader — a software rasteriser — so the frame rate below is not a GPU
number and says nothing about Quest.** The CPU-side numbers are the ones that
transfer, and they are the ones the budget requirement is about.

| | 4,000 slots, vr-high |
|---|---|
| `TapeExhibit.update()`, steady playback | **3.6–4.1 µs** per frame |
| of which `TapeVolume.setFrame()` (3 buffer copies) | 2.6–2.9 µs |
| of which `TapeStream.frame()` (lookup, LRU touch) | 0.4–0.7 µs |
| allocation per update | at the measurement floor (1–3 B/call against a 0.3 B/call baseline that a pure arithmetic loop also reports; `performance.memory` cannot resolve finer) |
| draw calls, in the einstruct room | **7** (21 with the hall shell in view) |
| triangles | 42 (244) |
| points | 4,000 |
| shader programs | 5 |
| resident tape bytes | 5.76 MB (3 × 1.92 MB chunks, vr-high, real bundle) |
| software-rendered frame time, 1024×640 | 64–100 ms (SwiftShader; ignore) |

Against Quest's 13.9 ms budget the tape costs about 4 µs of CPU, or 0.03 %. The
GPU side is one `Points` draw of 4,000 attenuated sprites with a discard, five
programs and under 250 triangles of room, plus one 720p decode — comfortably
inside the budget by inspection, but **unverified on hardware**.

Initial download, measured against the dev bundle:

| tier | variant | slots | frames | first chunk | whole tape |
|---|---|---|---|---|---|
| desktop / PC VR | `vr-high` | 4,000 | 801 | 1.92 MB | 25.6 MB |
| Quest | `vr-quest` | 4,000 | 401 | 1.92 MB | 12.8 MB |
| phone | `phone` | 2,000 | 401 | 0.96 MB | 6.4 MB |

(The note's first draft halved the two VR rows: `vr-quest` thins frames, not
slots, so its chunks are the same size as `vr-high`'s. Corrected in review.)

With the app shell (254 kB gzipped JS + 1.4 kB CSS), the hall (49.9 kB glb +
2.22 MB lightmap PNG) and, only where MSE exists, hls.js (179 kB gzipped), the
phone tier reaches its first tape frame in about 3.4 MB and its first ten
seconds in under 5 MB — inside the spec's 20 MB, with the lightmap PNG the
largest single item.
`devicePixelRatio` is capped at 1.5 on phones (verified: a device reporting 3
renders at 1.5), 1.0 on a headset, 2.0 on the desktop.

## What was tested, and where

**Desktop Chromium 141, for real** (Playwright, SwiftShader, 1280×800 and
1024×640), driven through the real UI:

- both pages build and serve; `/` links to `/mind/`;
- with no `assets/hall/hall.glb` the grey 14 × 20 × 7 m shell with the
  2.4 × 3.2 m opening appears and the HUD says why;
- **WP3's final bake** at `assets/hall/hall.glb`: the glb loads, all 5 hall
  meshes have a second UV set, all 5 get the 2048² PNG lightmap on
  `channel: 1`, `flipY: false`, sRGB, at `lightMapIntensity` **10.715413**
  taken from `asset.extras.orchard.lightmap.three_light_map_intensity`; the
  coffered ceiling, the six windows and the sun pools on the floor read; the
  spawn and the doorway are taken from the glb's markers (`[0, 0, 8]`, yaw 0;
  doorway z −10, 2.4 × 3.2) so `mansion.json` no longer holds copied metres;
- walking with `W` crosses the doorway, the body's room becomes `einstruct`, the
  HUD names the room;
- the tape streams from WP1's real bundle: id `84b67b5a0d22eeab`, variant
  `vr-high`, 801 frames, 4,000 slots, 3 chunks resident, 0 failed, and its
  world AABB is exactly the flat sheet the ruling asks for,
  `[-3, 1, -18.4] .. [3, 1, -12.4]`;
- the video wall plays WP1's real ladder (`2dc8ca525724aefd`, 1920×1080)
  through hls.js, `readyState` 4, `currentTime` advancing, the element in the
  document, muted, with a working unmute;
- the slider scrubs, space pauses, `[`/`]` step, the speed select works;
- `P` shows the provenance of what is in view; `F` shows `renderer.info`;
- presence connects to `wss://maincloud.spacetimedb.com` database `orchard`,
  gets an anonymous identity, persists the token, joins `grove`, and re-joins
  `einstruct` on the doorway crossing. The HUD reads "1 here connected".

**Presence, driven against a stub** (12 tests, no network): a refused join is
asked once and falls back to the grove; ten further `join` calls add no
traffic; an unknown room is refused locally; the backoff schedule is
1/2/4/8/16/30 s, jittered down but never up; a drop re-joins the room the body
was in and resets the attempt counter; `move` fires at 10 Hz and once on
stopping; a transport that throws leaves the app single-player, not crashed.

**Phone, emulated** (412 × 915, `deviceScaleFactor` 3, touch, Android UA):
tier `phone`, the `phone` variant (2,000 slots, 0.48 MB first chunk), renderer
pixel ratio 1.5, the on-screen stick present and moving the body, no HUD
overlaps, portrait fov widened so the horizontal field stays 78°. **Not tested
on real phone hardware.**

**Quest, not tested.** No headset and no working WebXR emulator here (the
Immersive Web Emulator extension is not installed and could not be fetched).
What *was* verified is the entry path, against a stubbed `navigator.xr`: the
"Enter VR" button appears only when `isSessionSupported("immersive-vr")`
resolves true, the session is requested with `requiredFeatures: ["local-floor"]`
and `optionalFeatures: ["bounded-floor", "hand-tracking", "layers"]`, and a
refused session becomes a HUD notice rather than a broken page. Everything past
`setSession` — controllers, teleport, thumbstick scrub, the in-world provenance
panel, the 72 Hz budget — is **written but unexercised**.

## Deploying

Do not deploy from this note; it is a ruling (LAWS 22). When it is approved:

```bash
cd grove
pnpm install
pnpm dev:bundle          # only while mansion.json still points at /dev-bundle/
pnpm build
set -a; . ~/.config/orchard/secrets.env; set +a     # CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
wrangler pages deploy grove/dist --project-name weichseltree --branch main
```

The two Cloudflare variables are `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in `~/.config/orchard/secrets.env`; wrangler reads them
from the environment. Run the deploy from the repo root or adjust the path.

`public/dev-bundle/` and `public/dev-video/` are gitignored, so a clean clone
must run `pnpm dev:bundle` before `pnpm build` — or, better, WP1's real bundle
ids go into `mansion.json` and the dev fixtures stop being deployed at all. A
hanging's `bundle` takes either `{"id": "<16 hex>"}`, resolved against
`https://media.weichseltree.com/<id>/`, or `{"path": "/dev-bundle/"}`; the id
wins when both are set, so filling in the id is the whole switch-over.

## The spacetime module

**No module change is needed.** The live `orchard` database already has the
room the client joins:

```
 name         | title                | open | capacity
 "grove"      | "The grove"          | true | 24
 "greenhouse" | "The greenhouse"     | true | 4
 "einstruct"  | "The einstruct room" | true | 24
```

The client checks the `room` table before calling `join`, and if the room is
missing it stays where it is and logs why, so a database without `einstruct`
costs the doorway its presence hand-over and nothing else.

One thing is worth proposing, because `einstruct` exists only as a row someone
inserted: `init` does not create it, so a `spacetime publish --delete-data`
would silently drop it. Proposed diff, **not applied** (WP2 does not touch the
module):

```diff
--- a/spacetime/spacetimedb/src/index.ts
+++ b/spacetime/spacetimedb/src/index.ts
@@
 export const init = spacetimedb.init(ctx => {
   ctx.db.room.insert({ name: 'grove', title: 'The grove', admin_only: false, open: true, capacity: 24 });
+  ctx.db.room.insert({ name: 'einstruct', title: 'The einstruct room', admin_only: false, open: true, capacity: 24 });
   ctx.db.room.insert({ name: 'greenhouse', title: 'The greenhouse', admin_only: true, open: true, capacity: 4 });
 });
```

## Open issues

1. **Nothing has run on a headset or a phone.** Everything past
   `renderer.xr.setSession` — controllers, teleport, the thumbstick scrub, the
   in-world provenance and notice panels, the 72 Hz budget — and everything
   past the touch stick is written, reviewed and unexercised on hardware. This
   is the whole remaining risk. What it needs: a Quest 3 on the deployed URL,
   and one iOS Safari device for the `<video>`/`VideoTexture` path, which is
   the fix most likely to be wrong in a way only that device shows.
2. **The lightmap is a 2.22 MB PNG, not KTX2.** `toktx` is not on this box, so
   WP3 ships PNG; it decodes to an uncompressed 2048² sRGB texture (16 MB of
   VRAM) and is the largest single download on the phone tier. The KTX2 path is
   wired and preferred when `lightmap.ktx2` appears beside the glb — one line
   back into `mansion.json`'s `lightmap` list — but has never been exercised
   against a real `.ktx2`.
3. **The CSP in `public/_headers` is unverified.** Cloudflare Pages applies it,
   the dev server does not. It allows `blob:` workers (hls.js, KTX2) and
   `wasm-unsafe-eval` (Basis); if a build ever loads something from a fourth
   origin it will fail silently in production and nowhere else.
4. **The Basis transcoder ships twice.** three r186 emits its own copy (585 kB)
   into `dist/assets/` from a `new URL(..., import.meta.url)` default, and
   `public/basis/` holds the copy the loader is pointed at. Neither is fetched
   unless a `.ktx2` is loaded. Dropping `setTranscoderPath` and the copy script
   removes it, at the cost of the explicit path the spec asks for.
5. **The main chunk is 934 kB (254 kB gzipped)**, nearly all three.js, in one
   piece. Splitting the XR and video paths out would help the phone's first
   paint.
6. **`exactOptionalPropertyTypes` is off.** Everything else is on, including
   `noUncheckedIndexedAccess`. The generated `module_bindings` do not compile
   under it and they are regenerated, so they cannot be patched.
7. **Chunk `sha256` is still not verified.** `bundle.json` carries the hash of
   every chunk and the client ignores it. It costs a `crypto.subtle` digest per
   1.9 MB chunk; worth doing when bundles come from mirrored nodes (M3) rather
   than from our own R2.
8. **The real-bundle tests skip without `results/bundles/`.** They are the only
   tests that run on bytes the client did not also write, and they are silent
   on a fresh clone. Committing one 0.96 MB `phone/c0000.bin` fixture would fix
   that and is a call for whoever owns the repo's size budget.
9. **Doorways are openings, not portals** (M0 by design; M5 changes it), and
   both rooms are in the scene at once. The einstruct fallback shell's 0.2 m
   wall at z ∈ [−10.2, −10] sits inside the hall glb's 0.45 m jamb, which is
   harmless doubled geometry today and wrong the moment einstruct gets its own
   baked asset.
10. **No chat, no voice, no greenhouse.** M1. ~~No environment behind the
    windows~~: since 2026-09-12 `src/world/sky.ts` puts a gradient dome
    (radius 80 m, drawn first, depth off) outside the mansion, with the sun
    where the bake's record says it travels — `sky.sunTravelBlender` in
    `mansion.json` is copied verbatim from hall.json and a test holds the
    two equal; an asset whose glb extras carry `lighting.sun_direction_blender`
    (the bake script now writes it) overrides the copy. Verified in headless
    Chromium: the windows show sky, the sun pools on the floor are unchanged.
11. **The dev video ladder is two rungs** (360p, 720p) against WP1's real
    three; the fixture only exists to exercise the player offline.
