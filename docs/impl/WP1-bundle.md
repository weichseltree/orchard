# WP1 · bundle and push

`orchard/bundle.py`, `orchard/push.py`, CLI verbs `bundle tape`, `bundle
video`, `push`, `r2 ensure`, `r2 benchmark`, tests in `tests/test_bundle.py`.
Implements the tape bundle and video bundle of
[docs/specs/M0-hall.md](../specs/M0-hall.md). 2026-09-12.

---

## What changed after review (2026-09-12)

[The review](../reviews/WP1-bundle-review.md) accepted with fixes. Every HIGH
and MEDIUM finding is applied; the ids moved.

| # | finding | what was done |
|---|---|---|
| F1 | HIGH — `name=` in `var_stream_map`; **every clip with audio failed, exit 234** | `name:`. ab_d2 is silent so nothing caught it. Pinned by `test_a_clip_with_an_audio_track_bundles`, which builds a `sine` track with lavfi and ffprobes AAC out of the first segment. |
| F2 | HIGH — uniform sampling **empties the room**: 4,000 slots held 56 live points at the last frame | Ruling applied: **survivors first**. Every slot alive in the tape's final frame, then a hash-ranked fill. ab_d2's `vr-high` now holds **2,634 live points at the last frame instead of 56** (47x), and the poster is drawn from the bundled slots, not the tape. Per-variant `alive` counts are in `bundle.json`. |
| F3 | MEDIUM — `slot_selection` false for `phone` | Each variant states its own rule: `vr-high` the object with real counts, the others `{"rule": "every 2th slot of vr-high", "from": "vr-high", "take_every": 2}`. Pinned by a test that shows re-running the base rule at phone's stride names a *different* set. |
| F4 | MEDIUM — membership rode on NumPy's `Generator` stream (NEP 19) | Replaced by `hash_rank_take`: `blake2b(seed\|slot, 8)` per candidate, the k smallest digests, sorted by slot. Golden literals pinned. |
| F5 | MEDIUM — push never checked the digests it already had | `verify_local()` runs first and **refuses** a bundle whose bytes do not match `bundle.json`/`media.json`; `_verify_uploaded()` re-GETs objects under 1 MB and HEADs the rest (Content-Length, and ETag when R2 gives a plain MD5). Both on by default, `--no-check` to skip. |
| F6 | MEDIUM — no 429/5xx retry; POST retried | Status retries on 429 and 5xx honouring `Retry-After`, 3 attempts; **POST is never retried**, neither on status nor on socket error. |
| F7 | MEDIUM — CORS fallback caught everything | Falls back only on an origin/wildcard/cors message; 10042 re-raises as `R2NotEnabled`; anything else propagates. |
| F8 | MEDIUM — localhost port list; `status` is an object | Ports stay 5173/4173 (ruling) and the spec amendment now says so instead of `localhost:*`; `_domain_state()` renders the object. |
| F10 | LOW, taken — `Lz = 1` is einstruct's habit | A non-positive axis is coerced to 1.0 and the original recorded as `source.box_raw`. |
| F9 | LOW, taken in part | The note's "23 files / 39.2 MB" was wrong (28 / 39.45, LAWS 24) and is corrected below; `cli` now exits **2** on `R2NotEnabled`, as `push.py` claims; `_finalize` says out loud when it replaces an existing id. |

**Left deliberately.** `species_counts` still counts the *bundled* slots while
`n_slots` is the tape's — renaming a field the spec now names would cost more
than the sentence that says so (spec + table below). `enable_dev_url` stays
dead on purpose: it is the documented fallback for a domain that will not
activate. `push` still buffers whole objects; the largest here is 3.5 MB
against a ~300 MB REST cap, and streaming is worth doing when something
approaches it. `tree_commit` still carries `-dirty`, so an unrelated edit in
einstruct moves the address — that is provenance working, and pinning it would
be worse. `slots.bin` (the review's alternative for F3/F4) was not shipped: the
ruling chose the per-variant record, and a `u32[n]` file per variant is format
surface WP2 would have to read for nothing.

The remaining review test suggestions are in: audio clip, `uint16` tape through
both readers, quantization boundaries, `slot_selection` truthfulness, golden
`hash_rank_take` literals, `push` against a fake `CF` (skip, `--force`, order,
content types, 10042), `push` refusing a bundle that does not match its
manifest, 3D tape, `Lz = 0`, and an alive-count canary. **47 tests.**

---

## READ THIS FIRST — two format changes, one blocker

### 1. `slot_stride` cannot be an index stride, and it cannot be uniform. CHANGED.

The spec decimates slots with `slot_stride`, meaning
`range(0, n_slots, slot_stride)`. That fails twice, both measured on ab_d2.

**It aliases.** einstruct lays the two species out by index parity — slot 2k is
A, slot 2k+1 is B — so `range(0, 200000, 50)` selects 4,000 particles of which
4,000 are species A and 0 are species B. The first bundle came out
`species_names: ["A"]`, one colour: the annihilation the tape exists to show,
deleted by the sampler, with every chunk hashing and verifying correctly.

    all even indices are 0: True      stride 50 bincount: [4000]
    all odd indices are 1: True       stride 49 bincount: [2041 2041]

**It empties the room** (review F2). Uniform sampling keeps particles in
proportion to how many there are, and 98.7% of ab_d2's particles annihilate: a
uniform 4,000 held 4,000 live points at frame 0 and **56** at the last. A
25 MB download buying ~200 visible points, while the survivors would have fitted
inside the budget with room to spare.

So membership is chosen **survivors first**:

* every slot **alive in the tape's final frame** (from the `alive` channel; a
  tape without one falls back to "moved into the final frame", which the
  spec's own dead-slot rule licenses), then
* the remainder by `hash_rank_take` — the smallest
  `blake2b(seed|slot, digest_size=8)` digests over the slots not already kept,
  sorted by slot index, seed `orchard/bundle/1|slots|{n_slots}|{n}`. Survivors
  that exceed the budget are hash-ranked down to it.
* **`slot_stride` stays and still means the decimation RATE**, and
  `slot_stride == 1` is the identity, so a tape at or under the budget is
  bundled exactly as the spec's worked example describes, byte for byte.
* The draw is a **digest rank, not a NumPy `Generator`** (review F4): NumPy
  guarantees nothing about that stream across versions (NEP 19), so a routine
  `uv sync` could have changed which particles a tape bundles — different
  chunk bytes, a new address for the same tape, every test still green.
  `test_hash_rank_take_is_pinned_to_literals` holds the contract.
* Each variant states **its own** rule (review F3). `vr-quest` and `phone` are
  `vr-high`'s slot list strided, not the base rule re-run at a bigger stride,
  and the two name different particles; copying `vr-high`'s record into
  `phone` told a client to map the wrong particles onto the points it had.
* Every variant's slots remain a **subset of `vr-high`'s**, so moving up a
  tier never invalidates points already held.
* `species_counts` and per-variant `alive` counts put both failures on the
  face of the artefact instead of only in the picture.

On ab_d2 that is 2,634 survivors + 1,366 filled = 4,000. (The ruling estimated
3,702 + 298; 3,702 is the count alive at the tape's MIDDLE frame — at the final
frame, which is what the rule names, 2,634 of 200,000 are left.)

`orchard.bundle.slot_indices` / `hash_rank_take` are the functions; the pins
are `test_the_sampler_does_not_alias_against_a_species_layout`,
`test_alive_at_the_last_frame_is_kept_first` and
`test_slot_selection_describes_the_slots_each_variant_holds`.

### 2. A video bundle's id must not cover the encoder's output. CHANGED.

> **Reversed 2026-09-13** ([bundle-hygiene.md](bundle-hygiene.md)). Every
> bundle's id now covers every file it ships (`bundle.json:files`), because
> one id standing for two sets of bytes is worse than a new address per
> differing re-encode, and `orchard bundle gc` removes the superseded ones.
> `media.json` is still read in bundles that already have one.

x264's VBV rate control reads the state of frames in flight on other threads,
so it is **not bit-reproducible**. Measured: the same
`orchard bundle video .../clip.mp4` on this box, twice, produced 22.08 MB and
then 22.07 MB of 1080p, and — because I had put a `sha256` on every segment in
`bundle.json` — **two different bundle ids for the same clip**. A bundle that
mints a new address every time it is built orphans everything already pushed
to R2 and invalidates whatever names it.

So for `kind: video`, `bundle.json` carries the **recipe** and nothing derived
from the encoder's bytes: source sha256, duration, resolution, fps, the ladder
(name, height, width, target bitrate, playlist, segment count, segment
seconds, keyint), skipped rungs, the ffmpeg version. That is what the spec
itself lists. The per-file digests moved to a new sibling file
**`media.json`** (`orchard/bundle-media/1`), which `bundle.json` names but does
not hash, so it can differ between two builds of the same id — which is
exactly what two encodes of one clip are. Pinned by
`test_the_video_id_survives_a_re_encode`.

A **tape** bundle has the opposite property: the transform is deterministic, so
its digests stay in `bundle.json` where the spec puts them (`chunks[*].sha256`,
plus `poster_sha256` — see the additions table).

**Proposed spec edit:** say that a video bundle is addressed by its recipe and
a tape bundle by its bytes, and name `media.json`.

### 3. R2 is not enabled on the Cloudflare account. The push could not run.

    POST /accounts/{acct}/r2/buckets  ->  10042 "Please enable R2 through the
                                                 Cloudflare Dashboard."

Same code from `wrangler r2 bucket create`, so it is the account and not the
token (the same token reads `/zones` and `/accounts/{a}/subscriptions` fine).
There is no API that turns R2 on: it needs a human at **dash.cloudflare.com >
R2 > Purchase R2** once, which is where the R2 terms are accepted. The free
tier covers M0 (10 GB stored, 1M class-A and 10M class-B operations a month);
the two bundles here are 84.4 MB.

Everything downstream of that click is written and waiting:
`uv run orchard r2 ensure` creates the bucket, sets the CORS rules and
attaches `media.weichseltree.com`, and `orchard push <dir>` uploads. Neither
has ever run against a live bucket, so **treat `push` as untested against R2
itself** — the parts that do not need a bucket (file walk, content types,
sha256 index, dry run, refusal to push a mis-named directory) are covered by
tests. `ensure_bucket` raises with exactly the sentence above when it sees
10042, rather than reporting a bucket it did not make.

---

## What was built

| file | what |
|---|---|
| `orchard/bundle.py` | `bundle_tape`, `bundle_video`, the chunk writer, the slot sampler, the poster, the content id |
| `orchard/push.py` | `push`, `ensure_bucket`, `enable_dev_url`, `benchmark`, `wait_public`, `cors_preflight` |
| `orchard/cli.py` | `bundle tape`, `bundle video`, `push`, `r2 ensure`, `r2 benchmark`; the six existing verbs unchanged |
| `tests/test_bundle.py` | 47 tests, `uv run pytest` |
| `pyproject.toml` | `+ numpy`, `+ matplotlib` |

### Reading tapes: imported, with a re-implementation behind it

`core.video.tape.TapeReader` is **imported** from `$SPECTRE_ROOT` (default
`~/weichseltree/spectre`) — it is the authority on `video/tape/1`, it already
decodes a `uint16` position channel through the same `/65535*L` that wrote it,
and it already drops a torn final frame. When spectre is not on disk (a fresh
clone, CI) `orchard.bundle._MiniTapeReader` re-implements only the read path.
Which one ran is recorded in `bundle.json:source.tape_reader`, and
`test_the_local_reader_agrees_with_spectre` bundles the same tape both ways and
compares every chunk's sha256, because the two are only as identical as that
class is correct.

### The slot budget

The spec's own example is a 4,000-slot tape at `slot_stride: 1`, with
`bytes: 25632000` = 4000 x 801 x 8. ab_d2 has **200,000** slots. Read
literally the variants would be 1.28 GB / 640 MB / 320 MB, against a definition
of done that says "the 4,000-particle tape" and "under 20 MB initial download
on the phone tier". `SLOT_BUDGET = 4000` (CLI `--slot-budget`) is the missing
number, recorded in `bundle.json` as `slot_budget`; the base stride is
`ceil(n_slots / slot_budget)`. It reproduces the spec's worked byte count
exactly for a 4,000-slot tape, which is why 4,000 and not some other number.

The phone's extra halving is read as a **ceiling on the variant**, not on the
tape: "every 2nd slot when the richest variant would carry more than 2000".
The two readings agree in every case the spec's example contemplates (base
stride 1, where the variant's `n` IS `n_slots`); they part only once the budget
binds, and there a literal reading would ship the phone 500 points while
`vr-high` ships 1000.

**Proposed spec edit:** state the slot budget and say the phone's condition is
on the variant.

### Additions to `bundle.json`

All additive — a reader that ignores unknown keys is unaffected — and none of
them is a wall clock, because a timestamp in `bundle.json` would move the id on
every run.

| field | why |
|---|---|
| `slot_budget` | the number the variant strides came from |
| `species_counts` | makes a sampler that deletes a species visible in the file |
| `poster_sha256` (tape only) | **a tape bundle's id must cover every byte it serves.** Without it, redrawing the poster left the id unchanged — two different bundles at one address. Measured, then fixed. |
| `poster_info` | which bundled frame, at what tape time, how many of the bundled slots were alive, and that it was drawn from the bundle rather than the tape |
| `variants[*].n` | so a client can size its buffers before fetching a chunk |
| `variants[*].payload_bytes` | `frames x n x 8`, which is the number the spec's example prints as `bytes` |
| `variants[*].slot_selection` | an OBJECT stating this variant's own rule and counts (`rule`, `alive_last`, `filled`, `seed` on `vr-high`; `rule`, `from`, `take_every` on the others) |
| `variants[*].alive` | `first` / `last` / `min` live slots — the number a uniform sampler got wrong |
| `source.box_raw` | present only when a non-positive box axis was coerced to 1.0 |
| `variants[*].t0_tau`, `chunks[*].bytes` | convenience, both derivable |
| `source.tape_frames`, `tape_quantize`, `tape_reader`, `alive_source`, `species_source`, `species_names_from`, `clamped_positions` | provenance: which reader, where `alive` came from, whether any position was clamped |
| video: `ladder[*]`, `fps`, `has_audio`, `skipped_rungs`, `ffmpeg`, `media` | the spec names only five fields for a video bundle; `skipped_rungs` is where "never upscale" is said out loud, and `media` points at `media.json` (see change 2) |

`bytes` per variant is the **bytes on disk**, `payload_bytes` is
`frames x n x 8`. The spec's example prints the latter as `bytes`, which
omits the 32-byte chunk headers (448 bytes across `vr-high`'s 14 chunks). A
client sizing a download wants the former. **Proposed spec edit:** say which.

### Everything else is the spec

`OTC1`, `u32 n`, `u32 frames`, `u32 frame0`, `f32 t0`, `f32 dt`, eight zero
bytes, then `frames x (u16[3] x n, u8 x n, u8 x n)`; frame stride `n x 8`;
positions `[0, L)` onto `[0, 65535]` clamped and counted; `z = 0` and `Lz = 1`
on a 2D tape; 60-frame chunks; id = first 16 hex of sha256 over `bundle.json`
with `id` emptied and `json.dumps(sort_keys=True, separators=(",", ":"))`.
`test_chunk_header_matches_the_spec_table` reads the table offset by offset.

---

## Measured

Both bundles were produced under `exprun` (cpu, no CUDA context, no GPU lane).

### `bundle tape results/film/tapes/ab_d2` — id `84b67b5a0d22eeab`

| variant | n | frames | dt (tau) | slot_stride | chunks | bytes | alive first/last |
|---|---|---|---|---|---|---|---|
| vr-high | 4000 | 801 | 0.5 | 50 | 14 | 25,632,448 | 4000 / **2634** |
| vr-quest | 4000 | 401 | 1.0 | 50 | 7 | 12,832,224 | 4000 / **2634** |
| phone | 2000 | 401 | 1.0 | 100 | 7 | 6,416,224 | 2000 / **1288** |

`slot_selection` on `vr-high`: `alive_last` 2634, `filled` 1366, seed
`orchard/bundle/1|slots|200000|4000`. `species_counts` `[1998, 2002]`.
Before the review's F2 the last frame held **56** live points in `vr-high`;
it now holds 2,634 for the same 25.6 MB.

Poster 1280×720 PNG, frame 400 of the bundle (t = 200 tau), 2,640 of the
4,000 bundled slots alive — drawn from the bundled slots, so it is a picture
of the exhibit rather than of the tape. 30 files, 45.0 MB total.

**15.5 s cold** (12.0 s of it reading 2.24 GB of `data.bin` at ~187 MB/s),
**3.6 s warm**; 0.3 s to write the 28 chunks, 0.4 s for the poster. One pass
over the tape plus one extra frame read for the final alive mask: only the
4,000 base slots are kept, so the working set is 25 MB and the two smaller
variants are strides of it.

### `bundle video .../ab_d2-ep05/clip.mp4` — id `2dc8ca525724aefd`

Source 1920x1080, 30 fps, 40.0 s, 111.9 MB, h264, **no audio track** (the clip
einstruct rendered is silent, so the ladder is video-only; `has_audio` says so
and the code maps and encodes AAC 128k per rendition when there is one).

| rung | resolution | segments | bytes |
|---|---|---|---|
| 360p | 640x360 | 7 | 4.05 MB |
| 720p | 1280x720 | 7 | 12.98 MB |
| 1080p | 1920x1080 | 7 | 22.08 MB |

**47.5 s**, 46.2 s of it ffmpeg (one pass, `split=3`, `libx264 -preset
medium`); runs of the identical command took 83.9 / 44.2 / 47.5 s depending on
what else was on the box, so treat the encode time as load-dependent, not as a
coefficient. **28 files, 39.45 MB** (`uv run orchard push
results/bundles/2dc8ca525724aefd --dry-run`; an earlier draft of this note said
23 files and 39.2 MB, which was wrong — LAWS 24. The total moves by ~10 kB
between encodes for the reason below).
Nothing was skipped: the source is 1080p, so all three rungs are at or below
it. Segments are 6 s, `-g 180 -keyint_min 180 -sc_threshold 0` plus
`-force_key_frames expr:gte(t,n_forced*6)` so all three renditions cut at the
same instants, and the playlists carry `EXT-X-INDEPENDENT-SEGMENTS`.
`poster.jpg` at 4.0 s (10% of duration), scaled to `min(1280, iw)`.

Across five runs of the identical command the renditions came out at
360p 4.05 / 4.05 / 4.05 / 4.04 / 4.05 MB, 720p 12.98 / 12.96 / 12.98 / 12.97 /
12.96 MB and 1080p 22.10 / 22.08 / 22.07 / 22.08 / 22.08 MB — the VBV
nondeterminism of change 2. Since that change the **id is `2dc8ca525724aefd`
for all of them**, including the run after the F1 fix; before it, every run
had a different one.

A source below a rung skips it and says so in `skipped_rungs`
(`test_video_ladder_skips_rungs_it_would_have_to_upscale`, 854x480 -> 360p
only). A source below **every** rung is encoded once at its own height rather
than not at all.

### Upload path: REST, not wrangler

The spec's two options could not be raced against a live bucket (R2 is off),
but the decisive term does not need one:

| | measured |
|---|---|
| `wrangler` process start-up, per invocation | **3.56 s** (`--version`, 5 calls) |
| `wrangler r2 object put`, whole path to the API error | 4.08 s |
| Cloudflare REST round trip, one keep-alive connection | **311 ms** |

`wrangler r2 object put` takes one file per invocation, so ~50 files is
**~178 s of Node start-up before a byte moves**; the REST path pays 311 ms of
latency per object on one reused TLS connection, plus the bytes. REST is the
default. `--method wrangler` is kept and works, and
`orchard r2 benchmark <dir>` runs the real race into a throwaway prefix once
R2 exists — that measurement is owed and is not in this note.

No S3 API: the Cloudflare token is not an R2 access key pair and no key pair
exists, so `PUT /accounts/{a}/r2/buckets/{b}/objects/{key}` is the only
tokened write path.

### Idempotency

Each push writes `<id>/.orchard-index.json` (relative path -> sha256, bytes,
content type) and skips any file that already matches. `bundle.json` is
uploaded **last**, because it names every other file and must never be the one
object present while its chunks are not. A directory whose name is not its own
`id` is refused.

Both ends are now checked (review F5). Before anything is sent, `verify_local`
re-hashes every file against the digest the bundle claims for it — from
`bundle.json` for a tape, `media.json` for a video — and **refuses** on a
mismatch, so a chunk truncated after bundling cannot upload under an id that
promises different bytes. After each object is sent, `_verify_uploaded`
re-fetches anything under 1 MB and compares sha256, and HEADs the rest for
`Content-Length` (and `ETag` when R2 returns a plain MD5); a file the server
gives nothing to compare is counted as `unverified` in the report rather than
passed. 429 and 5xx are retried three times honouring `Retry-After`; a POST is
never retried, because `POST /r2/buckets` creates a bucket and a lost reply is
not a lost request (review F6).

Content types: `.m3u8` `application/vnd.apple.mpegurl`, `.ts` `video/mp2t`,
`.bin` `application/octet-stream`, `.json`, `.png`, `.jpg`, plus `.m4s`,
`.mp4`, `.ktx2`, `.glb` for what comes later.

---

## Choices

**A dead slot's `alive` bit.** ab_d2 has an `alive` channel and it is used
verbatim. When a tape has none, the spec gives one fact — "a dead slot keeps
its last position" — so a slot is marked dead from the frame after the last
one it moved in. A slot that **never** moves is left alive: the tape cannot
tell "annihilated before frame 0" from "stationary", and reading it as dead
would empty a static tape. Recorded in `source.alive_source`.

**One `dt` per variant.** A fixed-stride chunk can only express a uniform
cadence, so `dt` is the mean interval. Each chunk still carries its own exact
`t0`, so a tape whose cadence wobbles loses the wobble inside a chunk and
never accumulates drift across the timeline.

**The poster is drawn from the full tape**, not from the 4,000 bundled slots:
it is one extra frame read, and a poster made of the phone tier's 2,000 points
does not look like the thing you walk into. Species colours on `#0b0d10`,
marker size from the live count, the whole periodic box letterboxed into 16:9
rather than cropped — cropping a periodic box is a picture of a different
simulation.

**`produced_by` and `source.tape_dir` are relative to the tree's repo**, as in
the spec's example, and are built from the function's arguments rather than
`sys.argv`, so the id does not depend on how the command was typed.

**Staging then rename.** The id is a hash of `bundle.json`, which names the
chunk hashes, so the directory cannot be named until its contents exist:
everything is written to `.bundle-XXXX` inside `--out` and moved into `<id>`,
which is a rename on the same filesystem. A failure removes it
(`test_no_staging_directory_is_left_behind`).

---

## Open, and owed

1. ~~**Enable R2, then run `uv run orchard r2 ensure` and push both bundles.**~~
   Done 2026-09-12 (docs/impl/M2-harvest-exhibit.md); the wildcard in 2 was
   accepted by the CORS API.
   Nothing else in WP1 is unfinished. `wait_public` polls
   `https://media.weichseltree.com/<id>/bundle.json` for 5 minutes (a fresh
   custom domain is a DNS record plus a certificate) and `cors_preflight`
   reports what a browser at `https://weichseltree.com` is actually told.
2. **`https://*.weichseltree.pages.dev` may be refused by the R2 CORS API.**
   Unverified. `ensure_bucket` retries without the wildcard and puts a loud
   `cors_warning` in its report rather than silently shipping a policy that
   blocks preview deployments.
3. **`r2.dev` is not enabled and should not be** — it is rate limited and not
   for production. `enable_dev_url()` exists, is never called automatically,
   and turning it on is a decision to record.
4. **A video bundle's id still moves when the recipe moves** — the ffmpeg
   version string is in `bundle.json`, so the same clip bundled on a box with a
   different ffmpeg lands at a different address. That is deliberate (a
   different encoder is a different rendition), but it means the grove's scene
   document should be updated from `bundle video`'s output rather than
   hand-copied. If it turns out to be a nuisance, the fix is to drop `ffmpeg`
   to a major version rather than to drop it.
5. **There is still no `orchard bundle verify <dir>` verb.** The check exists
   and runs — `push.verify_local()` re-hashes a bundle against
   `bundle.json`/`media.json` and refuses — but only inside `push`. Exposing it
   as a verb is two lines and would let a reviewer run it without a token.
6. **4,000 slots is a guess at the Quest's budget**, taken from the spec's own
   example, not from a frame-time measurement. WP2 owns DoD item 6; if 4,000
   points is the wrong number, `--slot-budget` changes it and the bundle id
   moves with it, which is correct.
7. **`n_slots` in `bundle.json` is the TAPE's slot count** (200,000), not the
   bundled count; the bundled count is `variants[*].n`. In the spec's example
   they are the same number, so the example does not disambiguate. Worth
   stating.
