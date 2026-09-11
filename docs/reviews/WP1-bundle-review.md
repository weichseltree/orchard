# WP1 · bundle and push — independent review

2026-09-12, against [the spec](../specs/M0-hall.md) and [the implementation
note](../impl/WP1-bundle.md). No code modified.

## Verdict

**Accept with fixes.** The tape path is correct byte for byte and both format
changes are right. One blocking bug (F1), one design failure the note's own
argument should have caught (F2). All checks ran under `exprun`.

## Verified

* `uv run pytest -q` → **27 passed**, 24.5 s.
* `xxd -l 32`, `vr-high/c0000.bin`, `c0013.bin`, `phone/c0000.bin`: `OTC1`,
  n=4000/4000/2000, frames=60/21/60, frame0=0/780/0, t0=0.0/390.0/0.0,
  dt=0.5/0.5/1.0, eight zero bytes; size = 32 + frames·n·8. Decoded against
  the tape (spectre `core.video.tape` 626b6af): positions, species,
  alive **identical** at frames 0/37/59 for `slot_indices(200000,50)`; z all
  zero; `vr-quest[1]` == tape frame 2; `phone` == `vr-high[::2]`; box
  `[632.46, 632.46, 1.0]`.
* Quantization: `0→0`, `L−1e−9→65535`, `L/2→32768`, `L→65535`; `L·1.0001` and
  `−0.001` clipped and counted (2). No wraparound; spectre's mapping exactly
  (`tape.py:530-537`/`:687-690`). `slot_indices` uses `subset_indices`'
  construction (`:72-93`) with a different key (no `run_seed`/`mode`,
  `n_total`/`n_subset` reversed).
* `verify_id` True for both; every chunk and poster re-hash to `bundle.json`,
  every video file to `media.json`. Naive `[::50]` gives species `[4000]`:
  change 1 is real. `push --dry-run` runs tokenless, `bundle.json` last.
* LAWS Capital: `~/.exp_status` shows `orchard-bundle-ab_d2*`, `lane: null`,
  exit 0 — no GPU lane, no CUDA, outputs in `results/`; `ledger.py` has no
  write call, so the read-only ledger rule holds.

## Findings

1. **HIGH — `bundle.py:711`: every video with audio fails.** `name={r[0]}` must
   be `name:` (:706 is right). Reproduced on an 8 s sine-track clip:
   `[hls] Invalid keyval name=360p`, exit 234, no bundle. ab_d2 is silent so
   this never ran; every narrated episode hits it.
2. **HIGH — uniform slot sampling empties the room.** Alive slots in `vr-high`:
   4000 (f0), **218** (f50), 151 (f100), **76** (f400), 56 (f800). A 25 MB
   download buys ~200 points after t=25 τ, while the poster, drawn from the
   full tape, shows 3,702: it advertises a room that does not exist, and those
   survivors would fit inside the budget. Fix: choose kept slots among those
   alive late, stratified by species; record per-variant alive counts; draw the
   poster from the bundled slots.
3. **MEDIUM — `bundle.py:285,438`: `slot_selection` is false for `phone`.** One
   constant string with placeholders unsubstituted, copied into all three
   variants; phone == `vr-high[::2]` (True), == `slot_indices(200000,100)`
   (**False**), so a client following the stated rule maps the wrong particles.
   Fix: emit the real per-variant rule, or ship `slots.bin` (u32×n) hashed into
   the id — which also fixes F4.
4. **MEDIUM — `bundle.py:279-283`: reproducibility rests on NumPy's Generator
   stream**, not guaranteed across versions (NEP 19). An upgrade changes
   membership → new chunk bytes → a new address for one tape, tests still
   green. Fix: pin golden indices, or `argsort` blake2b keys instead.
5. **MEDIUM — `push.py:372-380`: push hashes every file and never checks the
   digest it already has**, so a truncated chunk uploads under a valid-looking
   id. Fix: compare with `chunks[*].sha256`/`poster_sha256`/`media.json` and
   refuse (closes open item 5 without a new verb).
6. **MEDIUM — `push.py:149-170`: no retry on 429/5xx**, only socket errors, so
   a rate-limited push dies mid-way; and `raw()` retries the bucket-create
   POST, so a lost response makes `r2 ensure` fail. Fix: back off per
   `Retry-After`, never retry POST.
7. **MEDIUM — `push.py:255-264`: the CORS fallback catches every
   `CloudflareError`**, so an auth failure or 10042 retries as a wildcard
   problem and surfaces as the second error. Fix: fall back only on the
   origin-validation error; re-raise 10042 as `R2NotEnabled`.
8. **MEDIUM — `push.py:69-75` vs the spec's `http://localhost:*`**: ports
   5173/4173 only; any other dev port fails preflight. Fix: `"*"` for GET/HEAD,
   or amend the spec. `/cors` and `/domains/custom` payloads match the current
   API, but `status` is now an object, so `domain_state` prints a dict.
9. **LOW —** `species_counts` (`:605`) counts bundled slots, `n_slots` the
   tape. `_finalize` `rmtree`s an existing id, so a video re-encode silently
   replaces bytes already in R2. `tree_commit` "-dirty" is hashed, so an
   unrelated edit in einstruct moves the address. `push.py:114` claims exit 2,
   `cli.py:135` exits 1. The note says 23 files/39.2 MB for the video bundle;
   it is 28/39.46 (LAWS 24). Dead: `enable_dev_url`, `_MiniTapeReader.trailer`;
   `push` buffers whole objects (REST caps near 300 MB).
10. **LOW — `box` passes through verbatim**, so `Lz = 1` holds only because
    einstruct writes it; coerce a non-positive axis to 1.0.

## Spec changes recommended

Accept both, corrected. (1) Drop "every 2nd slot": the count comes from
`slot_stride`, membership from a header-derived rule, **each variant states its
own rule** and is a subset of `vr-high`; add `slot_selection` and F4's
stability requirement. (2) A video bundle is addressed by its recipe, a tape
bundle by its bytes; name `media.json` and require push to check it. Adopt
also `slot_budget`, `poster_sha256`, `bytes` vs `payload_bytes`, `n_slots` =
the tape's count, the phone clause as a ceiling, `Lz` coercion, a CORS list R2
can take, and **new:** a budget spent on slots alive across the timeline, with
per-variant alive counts (F2).

## Missing tests

1. A video source **with an audio track** (catches F1).
2. A `uint16` tape through both readers (that branch never runs).
3. Boundaries: `L−ε → 65535`, `x ≥ L` and `x < 0` clipped, counted.
4. `slot_selection` describes the slots the variant holds (F3).
5. Golden `slot_indices(200000, 4000)[:8]` literals (F4).
6. `push` with a fake `CF`: index skip, `--force`, order, 10042, keys.
7. `push` refuses a bundle whose files no longer match `bundle.json` (F5).
8. A 3D tape (z ≠ 0), a tape with `Lz = 0`, an alive-count canary (F2).
