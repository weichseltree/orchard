# M0 · the hall

The smallest mansion that proves the platform: one hall, one tree room, one
video wall, one particle tape you can stand inside, on desktop, Quest browser
and phone, at https://weichseltree.com/grove, connected to the live
SpacetimeDB database `orchard` for presence. Approved 2026-09-12 under the
standing authorisation to decide and document.

Work packages run in parallel against this spec: **WP1 bundle** (python),
**WP2 grove client** (TypeScript, three.js, WebXR), **WP3 hall bake**
(Blender 4.2, Cycles). Each ships an implementation note in `docs/impl/` and
is reviewed against this document in `docs/reviews/` before integration.

## Definition of done

1. `uv run orchard bundle tape <tape_dir> --tree einstruct --title ...` writes a
   tape bundle (format below) under `results/bundles/<id>/`, and
   `uv run orchard bundle video <mp4>` writes a video bundle (HLS ladder).
2. `uv run orchard push <bundle_dir>` uploads a bundle to R2 bucket
   `weichseltree-media`, served at `https://media.weichseltree.com/<id>/...`
   with CORS allowing `https://weichseltree.com` and `http://localhost:*`.
3. `grove/` builds with `pnpm build` to `grove/dist/` containing `index.html`
   (the site home, replacing the holding page's content but keeping its links)
   and `grove/index.html` (the app). `wrangler pages deploy grove/dist` puts
   it on weichseltree.com.
4. In the app: the hall loads with baked light; a doorway leads to the
   einstruct room; the room's video wall plays the einstruct clip via HLS; the
   room's centre holds the ab_d2 tape as points you walk into, with a time
   scrubber on a pedestal (desktop: slider + keys, VR: controller thumbstick,
   phone: touch slider).
5. Presence: the app connects anonymously to `orchard` on maincloud, calls
   `join(name, "grove")`, sends `move` at 10 Hz while moving, renders other
   online visitors in the same room as simple capsules with name tags, and
   shows a count. Failure to connect degrades to single-player with a notice.
6. Frame budget: 72 Hz on Quest 3 browser with the 4,000-particle tape and
   one video decoding; under 20 MB initial download on the phone tier.
7. Every asset the app loads carries provenance: bundle.json names the tape
   header hash, the producing command and the tree commit; the hall glb names
   the bake script and Blender version in `asset.extras`.

## Tape bundle format (`orchard/bundle/1`, kind `tape`)

Directory `results/bundles/<id>/` where `<id>` = first 16 hex of sha256 over
`bundle.json` with its `id` field empty.

`bundle.json`:
```json
{
  "schema": "orchard/bundle/1",
  "kind": "tape",
  "id": "…",
  "tree": "einstruct",
  "title": "A+B annihilation, 2D, seed 0",
  "produced_by": "uv run orchard bundle tape results/film/tapes/ab_d2 --tree einstruct",
  "source": {
    "tape_dir": "results/film/tapes/ab_d2",
    "tape_header_sha256": "…",
    "tape_schema": "video/tape/1",
    "tree_commit": "de819bf-dirty",
    "scene": {"…": "header.meta verbatim"}
  },
  "box": [Lx, Ly, Lz], "periodic": [true, true, false], "units": "reduced (sigma, tau)",
  "n_slots": 4000, "species_names": ["A", "B"],
  "variants": {
    "vr-high":  {"frames": 801, "frame_stride": 1, "slot_stride": 1, "dt_tau": 0.5, "chunk_frames": 60,
                 "bytes": 25632000, "chunks": [{"file": "vr-high/c0000.bin", "frame0": 0, "frames": 60, "sha256": "…"}]},
    "vr-quest": {"…": "same n, every 2nd frame"},
    "phone":    {"…": "every 2nd frame, every 2nd slot when n_slots > 2000"}
  },
  "poster": "poster.png"
}
```

Chunk file, little-endian:

| offset | type | meaning |
|---|---|---|
| 0 | `char[4]` | magic `OTC1` |
| 4 | `u32` | n (slots in this variant) |
| 8 | `u32` | frames in this chunk |
| 12 | `u32` | first frame index |
| 16 | `f32` | tape time of first frame (tau) |
| 20 | `f32` | dt between frames (tau) |
| 24 | `u8[8]` | reserved, zero |
| 32 | frames × (`u16[3]`×n, `u8`×n, `u8`×n) | per frame: positions, species, alive |

Positions quantize `[0, L)` per axis onto `[0, 65535]`; a 2D tape has z = 0
for every slot and `Lz` = 1. `alive` is 1 or 0; a dead slot keeps its last
position (that is how einstruct tapes already behave). Species is the tape's
`species` channel; absent, all zero. Frame stride is `n × 8` bytes; the client
computes offsets, never parses per frame. Each chunk is independently
fetchable and decodable; the client keeps at most 3 chunks resident.

## Video bundle (`kind: video`)

`master.m3u8` with an H.264 ladder 360p / 720p / 1080p (6 s segments, keyint
aligned), `poster.jpg`, and `bundle.json` with `source.file_sha256`,
`duration_s`, `width`, `height`, `produced_by`. AV1 is a later variant.

## The world (WP2)

- Vite + TypeScript strict + three.js (plain, no react), WebXR with a desktop
  fallback (pointer lock, WASD) and a phone fallback (touch look + on-screen
  stick). One scene document: `grove/src/world/mansion.json` lists rooms,
  their glb, their spawn point, their doorways and what hangs where, keyed by
  bundle id. The client never hard-codes a room.
- Hall: `assets/hall/hall.glb` from WP3 with `lightmap.ktx2` on UV2; a
  fallback unlit grey box if the asset is missing, so WP2 never blocks on WP3.
- Room `einstruct`: a wall plane with the video texture (hls.js where MSE
  exists, native HLS on Safari), the tape volume centred, scaled so the box's
  long side is 6 m, points rendered as a single `Points` with a custom
  shader (species colour, alive discards), a pedestal with the scrubber.
- Doorways are plain openings in M0; the portal rendering is M5.
- Presence via `spacetimedb` TypeScript SDK with bindings generated by
  `spacetime generate --lang typescript --out-dir grove/src/module_bindings`
  from `../spacetime/spacetimedb`. Reducer names are snake_case on the wire.
- Site home `index.html`: the holding page's content plus an "Enter the grove"
  button and a device note (headset / desktop / phone).

## The bake (WP3)

Blender 4.2 at `~/tools/blender/blender`, headless (`--background --python`).
Build the hall procedurally in the script: 14 × 20 × 7 m, a coffered
ceiling, six tall windows on one long wall with sun through them, a doorway
(2.4 × 3.2 m) centred on one short wall, a 6 × 3.4 m blank wall for future
posters, a floor with a subtle material. Bake Cycles diffuse+indirect to a
2048² lightmap on UV2, export `hall.glb` (Draco off, KTX2 lightmap via
`toktx` if available, else PNG and say so). Bake on the CPU under
`exprun` (`EXP_NAME=orchard-hall-bake`), or on the GPU only through
`exp run orchard-hall-bake --prio 10 -- …` (never a bare CUDA context). Keep
the bake under 30 min; sample count is the knob. Record samples, time, and
Blender version in `docs/impl/WP3-hall-bake.md` and in the glb `extras`.

## Decisions taken for M0

- Bundles are content-addressed directories, chunked for range-free fetch;
  no custom server, R2 serves bytes.
- Presence lands in M0 because the database is live; voice stays M1.
- Doorways, not portals, in M0.
- The einstruct room is first because the segregation tape is the one
  artefact that already works (DECISIONS 2026-09-11).

## Out of scope

Voice, the greenhouse UI, other rooms, splat rooms, node linking, jobs.
