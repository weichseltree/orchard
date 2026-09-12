# M2 · harvest and exhibit

2026-09-12. The path from a repo's `results/` to a row in the grove's
`exhibit` table, built against PLATFORM.md's M2 line ("`orchard bundle`
produces variants from a tree's artefacts; `orchard exhibit` hangs a bundle;
provenance sidecars carried through") and BACKLOG 10.

## What is there

| verb | does |
|---|---|
| `orchard harvest <tree> [--only kind] [--dry-run] [--force]` | bundles every artefact whose kind has a bundler (`tape`, `clip`, `master`, `still`, `figure`); writes `bundle`, `sha256`, `commit` into the artefact; a second run is `current` until the source bytes change |
| `orchard bundle still <image>` | `full.avif`+`full.jpg` (≤ 4096 wide), `phone.*` (1600), `thumb.jpg` (640); id over the recipe, digests in `media.json` |
| `orchard bundle verify <dir>` | WP1's owed verb: `verify_id` plus `verify_local`, exit 1 on any mismatch |
| `orchard exhibit hang <dir> [--approve] [--no-push] [--dry-run]` | verify, push to R2, `hang(tree, kind, title, url, thumb_url, tape_url)` via the CLI login identity (the module's admin); refuses an unapproved artefact with exit 3 |
| `orchard exhibit list` / `take-down <id>` | the table, and `take_down` |

`orchard/harvest.py`, `orchard/exhibit.py`, `bundle_still` and
`provenance_sidecar` in `orchard/bundle.py`, `Artefact.bundle` in
`orchard/manifest.py`. `provenance_sidecar` reads spectre's `core.film.stock`
sidecar (`<file>.json`: provider, id, license, author, sha256) into
`source.provenance` of video and still bundles; the key is absent when there
is no sidecar, so existing video ids did not move.

Client (`grove/`): `BundleRefSchema` takes `exhibit: {tree, kind}`;
`Presence` subscribes `SELECT * FROM exhibit` once per connection and offers
`whenExhibits(timeoutMs)`; `bundleUrl(ref, rows)` prefers the latest hung
row of a kind the hanging can show (`video` takes `clip` or `master`), then
the pinned `id`, then the dev `path`. `main.ts` waits 8 s for the table and
then takes the ids. Both einstruct hangings in `mansion.json` now carry an
exhibit ref and the harvested ids.

## Measured (this box, 16 threads, CPU)

| artefact | bundle | time |
|---|---|---|
| einstruct ab_d2 tape (2.2 GB, 801 frames) | `2dd0038799b2db15`, 43 MB | 3.9 s |
| einstruct ab_d2 clip (112 MB, 40 s, silent) | `216b720501856b14`, 38 MB | 46 s |
| einstruct ep05 styleframe (1920×1080 PNG) | `c59c7baa6fd15489`, 1.4 MB | 2.5 s |
| einstruct ep05 master (291 MB, 4:30, voiced) | `e95baa0fa9f068fc`, 156 MB | 201 s |
| spectre first-film (314 MB, 43 s, HEVC 1080p60, no audio) | `0462efca96af7297` | 75 s |
| spectre ep03 assembly v6 (76 MB, 8:25, 360p) | `2527c24bbbde0982` | 33 s |

The master exercised the audio branch of `bundle_video` on a real narrated
file for the first time (three AAC renditions, `name:` in the stream map);
the spectre master exercised HEVC input. All six pass `bundle verify`.
`results/bundles/` is 319 MB. The two M0 bundles from WP1
(`84b67b5a0d22eeab`, `2dc8ca525724aefd`) were superseded by the harvest
because einstruct's commit moved, and deleted; nothing had been pushed.

Tests: 60 python (13 new: stills, harvest, exhibit) and 114 client (25 new:
exhibits, presence exhibit subscription and timeout, bundle precedence,
schema, the still bundle and tier, panel fit and placement, the poster
marker).

## Not done, and why

1. ~~**Nothing is hung.**~~ R2 went on later the same day; the tape and the
   clip are exhibits 1 and 2 (37 s and 31 s to push 45 MB and 40 MB,
   every object read back and hashed). The first real push found that the
   REST API refuses HEAD (405), which the post-upload check had read as
   "missing"; `push` now reads objects back whole up to 64 MB.
2. **Approval is per artefact in the manifest, by hand or `--approve`.** The
   greenhouse (M1) is where rulings should come from; until then the manifest
   is the record.
3. ~~**`kind: still` has no hanging.**~~ Done the same day: a `still`
   hanging (`grove/src/media/still.ts`, `StillHangingSchema`) sits on the
   room's poster marker (`role: "poster"`, read like the spawn and the
   doorway), AVIF first and the JPEG on a decode failure, the phone taking
   the 1600 px tier. `mansion.json` hangs einstruct's styleframe on the
   hall's `poster_wall`, from the exhibit table with the harvested id
   pinned. Verified in headless Chromium against the local bundle.
4. **`dump` rewrites the manifest with every default field.** `trees/*.yaml`
   grew `approved: false`, `commit`, `figure: ''` on every artefact. Honest,
   verbose; a `exclude_defaults` dump would lose `approved: false` as a
   visible statement, so it stays.
5. **Bundle ids follow the tree's commit**, so a harvest after any commit in
   the repo re-encodes everything (200 s for the master). `--only` limits it;
   a `sha256`-only identity would be the alternative and WP1 chose not to.
