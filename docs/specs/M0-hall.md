# M0 · the hall

The smallest mansion that proves the platform: one hall, one tree room, one
video wall, one particle tape you can stand inside, on desktop, Quest browser
and phone, at https://weichseltree.com/mind, connected to the live
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

**Amendments 2026-09-12 (from WP1, measured; revised after review):**
`slot_stride` is the decimation RATE only. Membership is chosen **survivors
first**: every slot alive in the tape's FINAL frame, then the remainder taken
as the smallest `blake2b(seed|slot, digest_size=8)` digests over the slots not
already kept, sorted by slot index, with
seed `orchard/bundle/1|slots|{n_slots}|{n}`. An index stride aliases against
einstruct's even/odd species layout and silently deleted species B; a uniform
draw of any kind spends the budget on particles that have annihilated (4,000
uniform slots of ab_d2 hold 4,000 live points at frame 0 and **56** at the
last). The digest rank replaces a NumPy `Generator` draw, whose stream NumPy
does not guarantee across versions (NEP 19) — a `uv sync` must not move a
tape's address. `slot_stride == 1` is the identity.

**Each variant states its own rule.** `vr-quest` and `phone` are `vr-high`'s
slot list strided, not the base rule re-run at a larger stride — the two name
different particles — so their `slot_selection` reads
`{"rule": "every 2th slot of vr-high", "from": "vr-high", "take_every": 2}`
while `vr-high` carries
`{"rule": "alive-last-then-blake2b", "alive_last": N, "filled": M, "seed": …}`.

New fields: `slot_budget` (default 4000), `slot_selection` (an object, above),
`variants[*].alive` (`first`/`last`/`min` live slots — the number a uniform
sampler got wrong), `species_counts` (over the BUNDLED slots; `n_slots` is the
tape's count), `poster_sha256`, `variants[*].n` and `payload_bytes` (`bytes` is
the bytes on disk, headers included). A non-positive box axis is coerced to
1.0 and the original recorded as `source.box_raw`. The poster is drawn from
the bundled slots, not from the whole tape.

Video bundles keep per-file digests in a sibling `media.json` that the id does
NOT cover, because x264 under VBV is not bit-reproducible (the same command
gave 22.10/22.08/22.07 MB of 1080p on three runs); the id covers the recipe,
and `push` must verify `media.json` before uploading and verify what landed
after. CORS is `GET`/`HEAD` from the two production origins, the Pages preview
wildcard and `http://localhost:5173` and `:4173` only — R2 takes a list, not
`localhost:*`.

Positions quantize `[0, L)` per axis onto `[0, 65535]`; a 2D tape has z = 0
for every slot and `Lz` = 1. `alive` is 1 or 0; a dead slot keeps its last
position (that is how einstruct tapes already behave). Species is the tape's
`species` channel; absent, all zero. Frame stride is `n × 8` bytes; the client
computes offsets, never parses per frame. Each chunk is independently
fetchable and decodable; the client keeps at most 3 chunks resident.

### Compatible source-clock extension (2026-09-13)

New tape bundles keep exact recorded frame times in the manifest. `OTC1`,
its 32-byte header, its reserved zero bytes and its particle payload stay
unchanged. The legacy `*_tau` field names remain for compatibility; their
numeric values use the producer's stated time unit, which is not always tau.

| Field | Meaning |
| --- | --- |
| `variants[*].times_tau` | Optional array with one finite source timestamp per retained frame, copied from `frames.jsonl` after that variant's frame stride. Values must increase strictly; the first equals `t0_tau`. |
| `variants[*].source_dt_tau` | Optional mean cadence of the original tape before frame thinning. New bundles give every variant the same value. |
| `variants[*].timing.source` | `frames.jsonl per-frame t` for the current writer. |
| `variants[*].timing.max_uniform_error_tau` | Maximum absolute difference between retained source timestamps and `t0_tau + frame_index * dt_tau`. This measures the error an older nominal clock would introduce, in the source time unit. |
| `variants[*].timing.retained_frames` / `source_frames` | Retained and original frame counts, so time sampling remains visible. |
| `time_unit` | Optional explicit time-unit label. The writer uses a nonempty header `time_unit`, otherwise recognizes the established `reduced (sigma, tau)` and `reduced (sigma, t0)` spellings. Unfamiliar units are labelled **source time**, not guessed. |
| `source.t0_origin` / `t0_offset_tau` | The producer's time-origin description and offset, preserved from the tape header. Missing values remain unspecified/null. |
| `source.channels` / `omitted_channels` | The source channel declarations and the names omitted from the fixed `pos`, `species`, `alive` payload. This discloses loss of channels such as heat or bond count; it does not transport their values. |
| `poster_info.time_unit` | The unit used by the poster caption, or null for a caption labelled source time. |

The exact array is authoritative for frame selection, stepping and the time
shown for a selected frame. Lookup chooses the nearest recorded sample;
ties choose the later one. The viewer does not interpolate particle data.
Recorded times remain on the tape's own clock: the origin offset explains
that clock and is not silently added to every timestamp.

The HUD uses a compact time label with rounding error at most one-thousandth
of the nearest adjacent frame interval. Precision increases when necessary
to distinguish large-origin or tiny-cadence samples; provenance keeps the
numeric source timestamp. This display formatting does not change the clock.

At 1×, playback advances `30 * source_dt_tau` source-time units per real
second. Thinning frames therefore reduces temporal resolution without
making the same simulation run faster on a phone. For a legacy bundle with
neither new field, the viewer uses its nominal `t0_tau`/`dt_tau` clock and
uses `dt_tau / frame_stride` as the original cadence. It labels the clock
as nominal in About this view; exact irregular times cannot be recovered
from an old bundle. Striding can omit the final original frame, so variants
can still end one source frame apart.

The writer refuses nonfinite, duplicate or backwards source times. The
client rejects malformed exact arrays and checks a loaded chunk's declared
frame/slot counts. When exact times exist, its chunk origin must equal the
first corresponding manifest timestamp rounded to f32. This preserves the
old header's precision while keeping the displayed clock in f64. All added
manifest fields participate in the content hash; rebundling produces a new
address, and existing published bundles remain unchanged.

The regression fixture `[10, 10.1, 11.9, 12, 14]` previously displayed
`[10, 11, 12, 13, 14]`, with a maximum error of 1 source-time unit. The new
writer/client pair round-trips all five timestamps exactly. The fixture's
Quest/desktop playback-rate ratio changes from 2 to 1 while its combined
particle payload stays at 704 bytes. These are format/clock checks on
synthetic data, not scientific or hardware acceptance.

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
