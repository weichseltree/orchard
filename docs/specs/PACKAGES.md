# Packages: code, bundles and the client cache

How dependencies, versions and artefact packages are managed across the
weichseltree repos, and how the grove caches what it downloads. Written
2026-09-13 after a survey of all 30 repos, orchard's bundle pipeline and the
grove's loading path; Manuel ruled on §6 the same night ("I approve all the
proposed changes and deployments"). §7 records what has landed.

The one idea underneath all of it: **a name that carries its content hash is
kept forever; a fixed name is always re-checked.** Every problem the survey
found at a seam — a rebake stuck in a year-long cache, a re-encode that kept
its id, a tape reader that is whatever spectre has checked out — was a fixed
name treated as if it were a hash, or the reverse.

## 1. Code inside one repo

Each repo keeps its own environment, and different torch or numpy versions
across repos are fine: nothing shares an interpreter. What each LIVE repo must
have:

- **Python**: a uv project with a committed `uv.lock`, and `requires-python`
  matching the interpreter actually used. A repo that cannot become a uv
  project yet (event-atoms: its kaggle and bridge flows depend on the layout)
  commits a pinned freeze of the venv that runs, with the index it came from.
- **GPU wheels** come from an explicit index in `[tool.uv.sources]`, as
  `someotherlife-spikec/tools/capture/pyproject.toml` does for torch cu124 and
  gsplat. A GPU dependency in a non-default group needs its exact
  `uv sync --group …` written where lanepush users see it: a bare `uv sync`
  syncs default groups only, and exits 0 having installed no torch.
- **JS**: a committed lockfile, `packageManager`, `engines.node` and `.nvmrc`.
  Tools the repo runs (wrangler, the spacetime bindings generator's output) are
  devDependencies or checked in, not global installs.
- **A standalone script** (no project around it) declares its dependencies in
  a PEP 723 header and locks them beside itself: `uv lock --script x.py`
  writes `x.py.lock`, and it runs as `uv run --locked x.py`. Unlocked, it
  resolves afresh on every run. (phototroph's `ptvf_to_tape.py`, 2026-09-13.)
- **Never re-sync under a running job.** A lock is written to describe what
  runs; compare `uv pip freeze` against it before the first `uv sync`.

Archived repos (quantumflow, units, package, ccc, points, HNL, faye, agivity,
lumina-consensus, sudo-community) stay as they are. stai-app and stai-admin
belong to the stai-social organisation and are out of scope.

## 2. Code shared between repos

No repo declares a dependency on another today; instead three put spectre's
working tree on `sys.path` and import `core.video.tape` from whatever it has
checked out (`orchard/bundle.py`, `einstruct/src/einstruct/tape_export.py`,
`phototroph/experiments/video/ptvf_to_tape.py`). spectre has no remote, so that
code cannot be pinned or reproduced anywhere else.

The rule: **shared code is a versioned package, depended on by git tag.**

- The tape format moves to `orchard/packages/tape/` — distribution
  `orchard-tape`, import `orchard_tape` — in the public orchard repo, so
  every box (Legion included) can fetch it without credentials. Consumers:

  ```toml
  [project]
  dependencies = ["orchard-tape"]

  [tool.uv.sources]
  orchard-tape = { git = "https://github.com/weichseltree/orchard", subdirectory = "packages/tape", tag = "tape-v1.0.0" }
  ```

  orchard itself uses it as a uv workspace member. spectre keeps
  `core/video/tape.py` as a re-export shim so its ~20 lanes do not change.
- Releases are tags `tape-vX.Y.Z`. The format's schema string
  (`video/tape/1`) changes only on a breaking format change, and readers keep
  reading every schema they ever wrote.
- The studio code to be extracted from spectre's `film-final` tag (BACKLOG 31)
  follows the same path: a package under `orchard/packages/`, pinned by tag.
- `expmetrics.py` stays a copy (CLAUDE.md says why: guarded import, no-op
  outside gpurun); the seven copies were byte-identical on 2026-09-13.

## 3. Artefacts: bundles

A bundle's id is the first 16 hex of the sha256 of its `bundle.json`
(`orchard/bundle.py`). That is already the right shape; what changes:

- **Every id covers the bytes it ships.** Tape ids always did (chunk digests
  are in bundle.json). Video and still ids hashed only the recipe, so a
  re-encode (x264 and libaom are not bit-reproducible) kept the id with new
  bytes. Their per-file digests move into bundle.json, so a re-encode is a new
  id; the recipe stays as provenance. Old bundles still verify.
- **R2 objects are immutable and say so**: `Cache-Control: public,
  max-age=31536000, immutable` on everything under `<id>/`, `no-cache` on the
  push index.
- **A harvest refuses a dirty tree** (uncommitted changes to tracked files,
  the tree's own `orchard.yaml` excepted) unless `--allow-dirty`, which is
  recorded. A `-dirty` commit cannot be rebuilt from its sha. In a checkout
  shared with another session that keeps uncommitted work (phototroph's
  engine session does), the honest options are waiting for that commit or
  `--allow-dirty`, which records the dirt; never commit someone else's work
  to get past the check.
- **Tool versions are recorded and checked.** `orchard/toolchain.py` names the
  expected ffmpeg, toktx (KTX-Software 4.4.2), Blender (4.2.1 LTS), spacetime
  CLI (2.10.0), wrangler (4.131.1) and Node (22); `orchard doctor` reports
  found against expected, and each bundle records the tools that made it.
- **One manifest, one mirror.** `<repo>/orchard.yaml` is canonical;
  `trees/<name>.yaml` becomes a generated read-only copy, rewritten whenever
  orchard writes the canonical one and by `orchard trees refresh`. It is
  written directly only when the repo is absent from the box.
- **Cleanup by reference.** `orchard bundle gc [--r2] [--apply]` deletes only
  bundles that no manifest (either copy, any tree), no pinned id in
  `grove/src/world/mansion.json` and no row of the live `exhibit` table
  names; it refuses when the database cannot be read, and is a dry run unless
  `--apply`.

## 4. The grove's own assets

- **Room assets ship under content-hashed names.** The bakes keep writing
  fixed names into `grove/public/assets/palace/<room>/`; the build
  (`grove/build/fingerprint.ts`) ships each file `mansion.json` names as
  `<stem>.<hash10>.<ext>` and nothing else from `public/assets/` (bake
  previews, provenance json, embedded source textures and the retired WP3 hall
  stay out). The client maps fixed name to hashed name with one URL modifier
  on three's default loading manager (`grove/src/render/asset-map.ts`).
- The Basis transcoder lives under three's version, `/basis/0.186.0/`.
- `grove/public/_headers` states the rule: `/assets/*` and `/basis/*`
  immutable; `/sw.js` no-cache; `/version.json` no-store; HTML revalidates
  (the Pages default).
- The planned move of scenery to R2 as `orchard bundle scenery`
  (PALACE-ASSETS) is compatible: a room then names a bundle id, which is
  already a hash.

## 5. The client cache

- **What hangs is the database's call.** When the `exhibit` table answered,
  a hanging shows what hangs there or nothing; the pinned id in `mansion.json`
  stands in only when the database did not answer. (Before 2026-09-13 an empty
  answer fell back to the pinned id, so a take-down never reached visitors.)
- **A service worker** (`/sw.js`, source `grove/src/sw/`) keeps bundles by id:
  - Cache-first forever, since an id never changes content.
  - It verifies each file's SHA-256 against the bundle's digests before caching
    it. That also makes mirrored nodes (PLATFORM M3) safe to fetch from.
  - Range requests pass through uncached.
  - Media caches are capped per tier (Quest 1 GB, phone 300 MB, desktop 2 GB,
    and under half the storage quota), evicting whole bundles least recently
    used.
  - Hashed app files are cache-first. Navigations are network-first with a
    cached fallback, so the hall opens offline with what was loaded before.
  - Kill switch: `"sw": false` in `version.json`, or `?nosw`, unregisters it
    and clears its caches.
- **Integrity without a service worker**: tape chunks are hashed in the page
  when no service worker controls it.
- **Updates reach open tabs.** The build writes `/version.json` (commit,
  build time). The page checks it when it becomes visible and every 10
  minutes, and offers a reload when it differs, never during an XR session. A
  stale tab whose lazy chunk vanished reloads once.
- **`404.html`** makes unknown paths real 404s instead of the index page.
- **Retries back off**: a failed tape chunk is asked for again after 1 s,
  doubling to 30 s, not every frame.

## 6. Rulings (2026-09-13, all as recommended)

1. The tape package lives inside orchard (`packages/tape`), not in its own
   repo or in spectre, since spectre has no remote.
2. Video and still ids hash the output files; a re-encode is a new id.
3. `trees/*.yaml` is a generated read-only mirror of `<repo>/orchard.yaml`.
4. The grove gets a service worker with an offline hall.
5. The lockfile rule applies to live repos only; archived repos stay as they
   are.

## 7. Status

Filled in as the pieces land; see the git log for the commits. The grove went
live with all of it at `9931579` on 2026-09-13 (orchard-66's palace deploy of
the same commit, then `8582be1`).

In production `/sw.js` comes back `max-age=14400`, not `no-cache`: the zone's
Browser Cache TTL overrides `_headers` for `.js`. Harmless, since browsers fetch
the worker script past the HTTP cache for update checks; setting the zone to
respect existing headers would make it match.

| piece | where | state |
|---|---|---|
| take-down reaches visitors | grove `cefca89` | landed |
| hashed room assets, cache rules, grove tool pins | grove `0f07d88` | landed |
| service worker, integrity, version stamp, 404 | grove `b2bd1e3` `54fe366` `bcb4abc` | landed; checked in headless Chromium (tampered files refused, the einstruct room played offline, the kill switch unregisters). Roll back with `GROVE_SW=off pnpm run deploy` |
| bundle ids, R2 headers, dirty refusal, toolchain, trees mirror, gc | orchard `551751b`…`6f55ca9`; notes in `docs/impl/bundle-hygiene.md` | landed; gc dry runs found nothing to delete (39 local, 12 on R2, all live); the 12 R2 bundles re-put with the immutable header on 2026-09-13 (309 objects, same bytes) |
| orchard-tape 1.0.0 | orchard `4ea2fd5`, tag `tape-v1.0.0` | landed and pushed; installs from the GitHub tag |
| consumers of orchard-tape | spectre (module alias shim), einstruct (`tape_export.py`), phototroph (`ptvf_to_tape.py`, PEP 723 header) | asked of their sessions on 2026-09-13, with the exact changes |
| lockfiles | arcedit `d5b7caa`, premosaic `a9490f8`, phototroph `8676bae` + CI on the locks `60659cb` | landed locally, unpushed |
| lockfiles / Node pins | event-atoms `83f8c1a` (a pinned freeze), autora `5ca39d0`, ftlchess `f0cf39f` | landed locally, unpushed |

Found on the way, left as they are:

- event-atoms' venv fails `pip check` (python-dotenv and charset-normalizer
  missing), and its `requirements.txt` omits arc-agi and arcengine; the freeze
  rebuilds with `--no-deps` so it reproduces that venv exactly.
- premosaic and mosaic both import as `mosaic`; the distribution rename
  clears the metadata clash, but the two still cannot share one venv. Both
  are archived.
- ftlchess's `production` branch deploys on push through Firebase App
  Hosting, which reads `engines.node`: check its current Node before pushing
  the pin.
- lanepush's sync hint counts `[tool.uv] default-groups` as omitted (reported
  to the expdash session).
