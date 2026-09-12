# Review · WP2 · the grove client

Independent, 2026-09-12, against [M0-hall](../specs/M0-hall.md) and
[WP2-grove](../impl/WP2-grove.md).

## Verdict

**Accept with fixes.** Decoder, scrubber, streaming budget and scene document
are correct against a *real* WP1 bundle, not just the generator, and the site is
clean. The serious fixes are in `net/presence.ts` — the one untested module —
and in the untested-on-hardware paths the note honestly flags.

## Verified

`pnpm typecheck` clean, `pnpm test` 58/58, `pnpm build` ok (`dist` 23 MB).

**Real bundle `d3c019dc494eef5e` through `src/tape/*`** (Node, 8 assertions,
pass): all 28 chunks decode; `frame0`/`frames`/`n` match `bundle.json`; chunks
tile with no gap, last partial (13×60+21 = 801; 6×60+41 = 401); f32 header `dt`
matches f64 `dt_tau` to 1e-6; `chunkIndexOf` correct everywhere, −1 outside.
Species 1966 A / 2034 B at frame 0 — exactly `species_counts`, all < 8; alive
4000 → 56, so the discard does real work. Max quantized x,y = 65507, 65532,
z = 0 everywhere, and `dequantize(65535, L) == L` exactly, so the client inverts
`bundle.py:_quantize` with **no off-by-one** (worst error half a step, 4.6e-5 m).

**Same bundle in Chromium 141** (Playwright, symlinked into `public/`, via
`TapeExhibit.load`): every tier uploads every frame, each chunk fetched once
(14/7/7), ≤3 resident (4.5/5.15/2.58 MB), no failures or console errors;
`pickVariant`/`variantSlots` agree with `variants[*].n`.

**Security**: no secret in `dist`; the only external origins are
`media.weichseltree.com` and `wss://maincloud.spacetimedb.com`; `pnpm audit`
clean; nothing user-controlled reaches `innerHTML`; per-room subscriptions; no
admin reducer called.

## Findings

1. **HIGH · `net/presence.ts:159` · `join` refusal retries forever.** `.finally`
   re-calls `join` while `#wantRoom !== joinedRoom`, and `.catch` never clears
   `#wantRoom`, so `room full`/`room closed` (module `index.ts:206`) loops at
   network speed. Reproduced: against a rejecting stub it starves the event loop
   and the test never exits. **Fix:** in `catch`, set `#wantRoom = joinedRoom`,
   as the "no such room" branch (:143) already does.
2. **HIGH · `presence.ts:114` · no reconnection.** `onDisconnect` leaves
   `#connection` set, so `connect()` (:88) early-returns forever: one dropped
   packet costs presence until reload. Null it, clear `joinedRoom` and the
   subscription, reconnect on capped backoff.
3. **HIGH · `world/tape-exhibit.ts:88` · a tape's `rotationDeg` is parsed
   (`schema.ts:47`) and silently ignored;** video honours it. See *Ruling*.
4. **HIGH · `media/videowall.ts:52` · the `<video>` is never in the document.**
   The classic iOS Safari `VideoTexture` failure: a detached element does not
   decode into WebGL, so the phone wall goes black, silently. Unverified on
   device; one line — append it 1×1, `opacity:0`, `position:fixed`.
5. **MED · `control/xr.ts:26,135` · hand tracking kills all input.** Hand sources
   carry no `gamepad`, so locomotion, teleport, scrub and play/pause go dead.
   Drop `hand-tracking` for M0, or notice it.
6. **MED · `xr.ts:105,165` · controllers indexed, not handed.** `getController(i)`
   follows `inputSources` order while handedness is read separately (:138), so
   the teleport ray can leave the wrong hand; use the `connected` event.
7. **MED · `render/view.ts` · no `webglcontextlost` handling:** Quest sleep or
   iOS memory pressure blacks the page for good.
8. **MED · `main.ts:150` · notices are invisible in immersive VR** — every
   failure surface is DOM. Route them to the in-world canvas while presenting.
9. **MED · `world/world.ts:38` · nothing renders until every hanging resolves**
   (glb, tape and video `bundle.json` awaited in series) — on a phone, seconds
   of blank with no loading state. Add each shell as it builds.
10. **MED · `xr.ts` · input is not reset on `sessionend`:** exiting VR with the
    stick pushed leaves the body drifting.
11. **LOW:**
    - `device.ts:26` — `touch` needs a Mobile UA token, so a default-mode iPad
      gets `tier: "desktop"` (25 MB) and *no* controls; add
      `|| navigator.maxTouchPoints > 1`.
    - `tape/bundle.ts:91` — `variantSlots` recomputes `n` rather than reading
      `variants[*].n`; equal here, but a mismatch makes `volume.ts:167` throw a
      `RangeError` into the frame loop. Notice, not throw.
    - `volume.ts:29` `uPalette[species]` unguarded past 8 species;
      `tape-exhibit.ts:130` hard-codes t0, ignoring `t0_tau` (0 here).
    - Per-frame allocations, contra "allocation-free": `navigation.ts:29,63`
      (~5 objects per `resolveMove`), `main.ts:212`, `presence.ts:214`.
    - The note's download table is 2× off: `vr-quest` keeps all 4000 slots, so
      its first chunk is 1.92 MB, phone's 0.96 MB. `einstruct` is already in
      `init` (module `index.ts:187`) — that open issue is closed.
    - No `public/_headers`: no CSP, no immutable caching. A CSP must allow
      `blob:` workers (hls.js, KTX2). `presence.ts:266` builds subscription SQL
      with `'`-doubling only — fine while rooms come from `mansion.json`.

Good work: strict TS throughout, the direction-aware LRU prefetch doing what
the note claims, `wallPieces`, the sideways-slide clamp, quantized u16 held on
the GPU.

## Ruling implementation (item 6)

Not expressible today (finding 3). `tape-exhibit.ts`, replacing lines 88-96:

```ts
const [px, py, pz] = options.hanging.position;
const [rx, ry, rz] = options.hanging.rotationDeg;
volume.points.position.set(px, py, pz);
volume.points.rotation.set(
  MathUtils.degToRad(rx), MathUtils.degToRad(ry), MathUtils.degToRad(rz));
volume.points.updateMatrixWorld(true);
this.group.add(volume.points);
// the picker aims at the AABB of the ROTATED box
this.bounds.copy(volume.localBounds()).applyMatrix4(volume.points.matrixWorld);
```

(`MathUtils` joins the `three` import; `localBounds()` exists.) Then in
`mansion.json`: `"position": [0, 1.0, -15.4]`, `"rotationDeg": [-90, 0, 0]`.

−90° about X maps the tape's thin local z (Lz = 1) to world up and local y to
world −z: the 6 × 6 m sheet lies flat over x −3..3, z −18.4..−12.4, inside
einstruct's bounds, centred 1.0 m up — waist height on a 1.65 m eye. 3D tapes
keep `[0,0,0]` and 1.2 m. Test the rotated hanging's world AABB.

## Deploy exclusions (item 5)

Exclude them. Measured `dist` 23 MB = 5.5 assets + 0.6 basis + **13 MB
`dev-bundle` + 3.5 MB `dev-video`**, copied out of `publicDir`; gitignored, so
deploy size depends on whether the last builder ran `pnpm dev:bundle`. In
`vite.config.ts`:

```ts
plugins: [{ name: "no-dev-fixtures", apply: "build", async closeBundle() {
  for (const d of ["dev-bundle", "dev-video"])
    await rm(new URL(`dist/${d}`, import.meta.url), { recursive: true, force: true });
} }],
```

Better long-term: write the fixtures to `grove/dev-fixtures/`, served by an
`apply: "serve"` middleware, out of `publicDir` entirely. Do not make this wait
on the real ids — those 404 until WP1's R2 is on. `.gitignore` is otherwise
right; committing generated `module_bindings/` is correct.

## Missing tests

- **A real WP1 chunk as a fixture** (`phone/c0000.bin`, 0.96 MB). Every decoder
  test runs on `devtape.ts`, which the generator also writes, so a shared bug is
  invisible. The highest-value gap; the suite run here ports directly.
- **`net/presence.ts` has no test at all**, and findings 1-2 live there: join
  rejection, reconnect, `move` at 10 Hz and once on stop, subscription strings.
- `TapeExhibit` (stream↔scrubber, `waiting`, an `n` mismatch); the rotated
  hanging's bounds; `detectDevice`; a property test that `advance` + `frameAt`
  never leave the tape (20 000 loops at 4× hold on all three variants).
