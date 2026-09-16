# Naming: spectre, orchard, and the grove

> **Superseded for the public world on 2026-09-16:** the world is now
> **Weichselmind** at `https://weichseltree.com/mind/`. The references to
> “the grove” below record the earlier name and its rename analysis; internal
> implementation identifiers and archival records remain unchanged.

Written 2026-09-16, after Manuel said the two repos might not be named well.
Nothing was renamed to write this. No code was touched.

This document does three things. It says where each name is load-bearing, so
the cost of a change is a number and not a feeling. It states the one hard
constraint, which is that the bundles already made cannot be renamed. And it
ends in rulings, because every real decision here is Manuel's.

**Short version.** The two names have very different costs. `spectre` is a
tree name, and a tree name is cheap to display differently and moderately
expensive to actually move. `orchard` is the identity of a CLI, two published
packages, a live database, two systemd units, a public GitHub URL printed on
the live landing page, and the whole vocabulary of trees, harvest, grove and
greenhouse. My recommendation is: give spectre a better name, keep orchard,
and fix the one naming problem a visitor actually hits, which is that the word
"grove" currently means two different things one click apart.

---

## 1. What each name is, in one line each

- **spectre** is a *tree*: one research repository registered with the
  platform. Its name is the primary key that ties its manifest, its bundles,
  its exhibit rows and its room together.
- **orchard** is the *platform*: the Python package, the `orchard` CLI, the
  SpacetimeDB database, the GitHub repo, and the word the whole vocabulary
  hangs off.
- **the grove** is the *public world* at weichseltree.com/grove.
- **the Observatory** is the *current theme* of that world (`docs/specs/
  OBSERVATORY.md`, which replaced the palace on 2026-09-14).
- **weichseltree** is the *channel and the GitHub organisation*.

Five words, four of which a visitor meets on the landing page. Section 8 is
about that.

---

## 2. Audit: where "spectre" is load-bearing

319 lines in this repo contain the word (excluding `.git`, `.venv`,
`node_modules` and `results/`). Most are prose. The table separates the ones
that are not.

"Identity" means a machine matches on the exact string and something breaks or
silently changes behaviour if it moves. "Prose" means only a reader sees it.

| Where | What it is | Kind | Cost of a change |
|---|---|---|---|
| `results/bundles/*/bundle.json`, 13 of 45 bundles | `"tree": "spectre"` **inside the bytes the bundle id is a hash of** | identity, frozen | Cannot be changed. See section 3. |
| The same 13 bundles | `produced_by` contains `--tree spectre`; the three tape bundles also carry `tape_reader: "spectre core.video.tape (69c8078)"` and `source.tape_dir: results/m04_planet/...` | identity, frozen | Same. It is provenance, and provenance is meant to be frozen. |
| Live SpacetimeDB `tree` table | one row, `name` is the primary key (`spacetime/spacetimedb/src/index.ts:136`) | identity | One insert, one delete, in that order. See section 5 for why the order matters. |
| Live SpacetimeDB `exhibit` table | `tree` is an indexed string column (`index.ts:149`); `hang_exhibit` refuses a tree the `tree` table does not know (`index.ts:781`); `remove_tree` **deletes every exhibit row of that tree** (`index.ts:772`) | identity | Re-hang each affected bundle under the new name. Row ids move. The row count is unverified from here, because this audit read local files only; `docs/EXHIBIT-PLAN.md:426` says exhibits 9 to 12 are spectre's. |
| Live SpacetimeDB `room` table | a row named `spectre` seeded in `init` (`index.ts:525`), looked up on join (`index.ts:344`) | identity | One `set_room` call for the new name. Only needed if the room's `presence` id changes. |
| `trees/spectre.yaml` | the fund's mirror; **the filename stem must equal the manifest's `name`** (`orchard/portfolio.py:118`, status `canonical names itself ...` when they differ) | identity | Rename the file and the `name:` field together, then `orchard trees refresh`. |
| `/home/manuel/weichseltree/spectre/orchard.yaml` | the canonical manifest: `name: spectre`, `path: /home/manuel/weichseltree/spectre` | identity | `name` and `path` are **independent fields**. The directory can move without the tree name moving, and the reverse. This is the cheap middle path. |
| `grove/src/world/mansion.json` | six occurrences: a doorway `"to": "spectre"` (line 167), the room `"id": "spectre"` (668), `"presence": "spectre"` (670), hanging ids `spectre-worlds` (707) and `spectre-wall` (763), and `bundle.exhibit.tree: "spectre"` (768) | identity | Only line 768 must move with the tree name. Room id, presence id and hanging ids are free strings that happen to share the word. |
| `grove/src/world/mansion.json`, the room's `title` | `"The Gravity Chamber"` | prose | Already a display name. The visitor never reads "spectre" as a room title. |
| `grove/src/ui/exhibit-content.ts` | `RESEARCH_ORDER` (line 15), `source: "spectre"` twice (38, 79), `evidenceAnchor: "spectre"` twice (48, 89), and the word inside one introduction (81) | mixed | `source` is a **hand-written literal**, not read from any manifest. `evidenceAnchor` must match a heading anchor in `docs/EXHIBIT-PLAN.md` (`### spectre`, line 118). `RESEARCH_ORDER` must match room ids. |
| `grove/src/ui/guide.ts:193` | renders `` `${title} / ${exhibit.source}` ``, so a visitor reads **"The Gravity Chamber / spectre"** | visitor-facing | One line. This is the single most visible place the raw name reaches a person. |
| `grove/src/world/world.ts:481` and `:560`, `grove/src/world/planet-exhibit.ts:711`, `grove/src/world/tape-exhibit.ts:290` | the "About this view" provenance panel prints `tree: <bundle.tree>`, straight from `bundle.json` | visitor-facing, frozen | Cannot be changed honestly. The bundle says `spectre`; the panel reports what it read. |
| `grove/index.html:249` | `href="/grove/?room=spectre"` on the live landing page | identity (a public URL) | Changing the room id breaks any shared link. Keeping the room id costs nothing. |
| `grove/public/assets/palace/spectre/` | `spectre.glb`, `spectre.json`, lightmaps, `ao.png`, `preview.png` | identity, build-time | The bake writes fixed names and `grove/build/fingerprint.ts` ships them hashed. Renaming means a re-bake or a careful file move plus `mansion.json` edits. Room-geometry work, not naming work. |
| `grove/tools/palace/palace.py`, `bake_all.sh`, `stations.mjs`, `scripts/quality-world.mjs` | the room name in the bake and screenshot tooling | identity, build-time | Follows the asset directory. |
| `grove/src/**/*.test.ts` (7 files), `tests/*.py` (6 files), `packages/tape/tests/` | fixtures and expected strings | identity, local | Mechanical. 26 lines in `tests/`, ~50 in `grove/src`. |
| `/home/manuel/weichseltree/einstruct/film/assemble.py:33` | `SPECTRE = Path.home() / "weichseltree" / "spectre"` | identity, **outside this repo** | Breaks on a directory rename, at runtime, with no audit warning. `audit.yaml` waives this as a known sibling-import. This is the one cross-repo executable dependency on the path. |
| `docs/` (19 files, 138 lines), `brand/`, `studio/README.md` | prose and history | prose | Free to leave alone. An append-only record (`docs/DECISIONS.md`) must **not** be rewritten. |

### Inside the spectre repo itself

49 files contain the word. Its git remote is **empty** (`git remote -v` returns
nothing), and `docs/specs/PACKAGES.md:2` confirms it: "spectre has no remote".
So there is no public URL, no clone anywhere else, and no GitHub rename to do.

| Where | Kind | Cost |
|---|---|---|
| `pyproject.toml:2` `name = "spectre"`, and `uv.lock:986` | identity, local | Edit plus `uv lock`. Never published anywhere. |
| `spectre.py` (the launcher every lane command starts with) | identity, local | Rename the file, update `README.md` and `AGENTS.md`. |
| `SPECTRE_GPU_TESTS` in `tests/conftest.py:50` and six test files | identity, local | AGENTS.md rule 13 says a convention like this is enforced by a scanning test. Change the scanner and the scanned string in one commit or the suite lies. |
| `core/`, `lanes/`, `tools/` module paths | not affected | Nothing imports a module called `spectre`. The code lives under `core`, `lanes` and `tools`. |
| `logs/`, past `EXP_NAME` values, expdash history | frozen | Past run names and their expdash links keep the old prefix forever. Not rewritable, and not worth trying. |

---

## 3. The constraint: a bundle cannot be renamed

A bundle's id is the first 16 hex characters of the sha256 of its own
`bundle.json`, with the `id` field blanked, keys sorted, no whitespace
(`orchard/bundle.py:175-190`). The tree name is a top-level field of that
document. So:

**The tree name is inside the hashed bytes. Change it and the id changes.**

That is not a bug to route around. It is the property the whole delivery path
rests on: R2 objects under `<id>/` are served `immutable` for a year, the
service worker keeps them by id forever and verifies each file's SHA-256
before caching, and `docs/specs/PACKAGES.md` states the rule in one line: a
name that carries its content hash is kept forever.

What follows, plainly:

1. **History keeps saying "spectre".** 13 existing bundles name it, and they
   say it in four places each: the `tree` field, the `produced_by` command
   line, and for tapes the `tape_reader` string and the source path. Those
   bundles are what is hanging in the live world right now.
2. **A visitor will keep reading it.** The "About this view" panel prints
   `tree:` straight from `bundle.json`. Hiding that would be a lie about the
   bytes the client actually loaded, so it must not be hidden. A display name
   can be added *beside* it; the recorded name stays.
3. **Editing `tree` in place is the one clearly wrong move.** It breaks
   `orchard bundle verify` immediately (`verify_id` recomputes the id and
   compares, `orchard/bundle.py:193`), and it orphans every R2 object, every
   pinned id in `mansion.json`, and every exhibit row, because those all point
   at the old id.
4. **A re-bundle is possible and is not recommended.** It would mean
   re-running `orchard bundle` for all 13, which re-chunks and re-hashes three
   tapes of 508,744 particles over 1,129 frames each, plus five videos, three
   stills and one planet bundle. It needs spectre's gitignored `results/`
   still on disk, a clean tree at a commit (`harvest` refuses a dirty repo),
   and it produces 13 new ids. Every new id then has to be pushed to R2,
   written back into two manifests, pinned again in `mansion.json` (two ids
   are pinned there today: `26f78b7516170d6d` and `0462efca96af7297`), hung
   again, and re-downloaded by every visitor whose cache holds the old ones.
   The old objects linger in R2 until `orchard bundle gc --r2 --apply`.
   All of that to change a string that is *correctly* recording what the tree
   was called on the day the bytes were made.
5. **The exhibit table is the part that does have to move**, and it is cheap,
   because `exhibit.tree` is an ordinary indexed string column, not a hash
   input. A rename there is: insert the new `tree` row, re-hang the same
   bundle ids under the new name, then remove the old row. The bundle ids do
   not change, so nothing is re-uploaded and no visitor re-downloads anything.

**The same is true of the word "orchard"**, and this seems not to have been
noticed. Every one of the 45 bundles carries `"schema": "orchard/bundle/1"`
and a `produced_by` beginning `uv run orchard bundle ...`. Both are inside the
hashed bytes. Renaming the platform would leave "orchard" written into the
identity of every artefact ever made, exactly as renaming the tree would.

---

## 4. The cheap mechanism: a display name

**The precedent already exists, twice.** A room in `grove/src/world/
mansion.json` has an `id` and a `title`, and every room uses it: the room
whose id is `spectre` is titled "The Gravity Chamber". The SpacetimeDB `room`
table has the same pair, `name` and `title` (`index.ts:520`). Only the *tree*
lacks it.

**What the tree manifest has today.** `orchard/manifest.py` defines `Tree`
with `name`, `path`, `remote`, `question`, `status`, `stage`, `gpu`,
`phenomena`, `artefacts`, `producers`, `theses`, `budget`, `kill`,
`potential`, `notes`. There is **no** `title` or display field. `Phenomenon`
and `Thesis` both have a `title`; the tree itself does not.

**What would have to be added.**

1. `orchard/manifest.py`: one field on `Tree`, `title: str = ""`, empty
   meaning "use `name`". Defaulted, so every existing manifest keeps
   validating. Set it in `/home/manuel/weichseltree/spectre/orchard.yaml`,
   then `orchard trees refresh` regenerates `trees/spectre.yaml`.
2. `spacetime/spacetimedb/src/index.ts`: a `title` column on the `tree` table,
   and a parameter on the `upsert_tree` reducer (line 759), fed by
   `orchard/sync.py:106`. This is a module republish. Whether SpacetimeDB 2.10
   can add a column to a table holding rows without `--delete-data` is
   **unverified**; check before relying on it. If it cannot, skip this step:
   nothing in the client reads the `tree` table's title today, so it can wait.
3. `grove/src/ui/exhibit-content.ts`: set `source` to the display name. This
   needs no schema at all, because `source` is already a hand-written literal
   per room and is not read from any manifest. **This one line is the whole
   visitor-facing win.** The guide kicker changes from "The Gravity Chamber /
   spectre" to "The Gravity Chamber / <new name>".
4. `grove/src/world/world.ts` and the other provenance registrations: **leave
   `tree: bundle.tree` exactly as it is**, and if a display name is wanted in
   that panel, add it as a second key beside the recorded one. The provenance
   panel's job is to report what the bytes say.
5. Room titles: nothing to do. They are already display names.

**Is this the right recommendation?** Partly, and I want to be honest about
where it is not.

A display name is the right answer for *the label a visitor reads*, and it is
close to free: one literal in `exhibit-content.ts`, or one optional manifest
field if you want it to travel with the tree. It is the right answer for
*today* whatever else is decided, because it is reversible and needs no
deploy beyond the ordinary grove deploy.

It is **not** a full answer to "the repo is badly named", because the name a
person types every day is the directory, the launcher and the run names, and
a display name does not touch any of those. If the objection is "I am
embarrassed to link this repo", a display name fixes it. If the objection is
"I type this word fifty times a day and it means nothing", it does not.

So my recommendation is a **split**, and it is the key finding of this
document:

> `orchard.yaml` has `name` and `path` as independent fields, and
> `orchard/portfolio.py:118` only checks `name` against the mirror's filename,
> never against the directory. **The repository directory and the tree
> identity can be renamed separately.**

That gives three options, in rising cost:

- **A. Display name only.** The visitor reads a better word. One line. No
  database, no bundles, no deploy risk. Reversible in a minute.
- **B. Display name, plus rename the repo directory and its own internals,
  keeping `name: spectre` in the manifest.** The word Manuel types changes.
  The data plane never moves: no exhibit rows, no re-hang, no `mansion.json`
  edit beyond nothing. Cost is the 49 files inside spectre plus the one real
  outside dependency (`einstruct/film/assemble.py:33`) plus `path:` in two
  manifests.
- **C. All of B, plus move the tree identity.** Everything in section 5.
  Buys consistency; costs a careful sequence against a live database, and the
  bundles still say spectre forever regardless.

I recommend **B**, with A done first and on its own.

---

## 5. Safe path, if a rename is ruled

### Step zero, before touching any manifest

```
systemctl --user stop orchard-sync.timer
```

**This is the step that prevents the only serious accident available here.**
`orchard/sync.py:99` upserts planted trees and then *removes anything the
database shows that is not planted here*. `remove_tree` in the module deletes
every exhibit row of that tree (`index.ts:772`). The timer is **active right
now** and fires every 15 minutes. So: rename `trees/spectre.yaml`, walk away,
and within 15 minutes the live `spectre` tree row and its exhibit rows are
gone. Since 2026-09-13 an empty exhibit answer no longer falls back to the
pinned id in `mansion.json` (`docs/specs/PACKAGES.md` §5), so the Gravity
Chamber's video wall goes blank for live visitors. The planet hanging survives,
because it is pinned by id with no exhibit reference.

### Renaming the spectre repo (option B)

1. Stop the sync timer, as above.
2. Move the directory. There is no remote, so nothing public breaks and no
   redirect is needed.
3. **Fix `einstruct/film/assemble.py:33` in the same sitting.** It hardcodes
   `Path.home() / "weichseltree" / "spectre"`. Nothing warns if it goes stale;
   `audit.yaml` waives that finding today. (`phototroph/studio/ptstudio/render/
   exposure.py` and a few contract documents mention the path in prose only.)
4. Update `path:` in the tree's own `orchard.yaml` **and** in
   `trees/spectre.yaml`, then `uv run orchard trees refresh` and confirm
   `uv run orchard board` still loads it.
5. Inside the repo: `pyproject.toml` name, `uv lock`, the launcher filename,
   `SPECTRE_GPU_TESTS` together with the test that scans for it, README and
   AGENTS.md.
6. Restart the timer and watch one cycle: `journalctl --user -u orchard-sync`
   and `journalctl --user -u orchard-audit`.
7. Accept that `logs/`, past `EXP_NAME` values and expdash history keep the
   old word. They are records of what happened.

### Moving the tree identity as well (option C), in order

8. Timer still stopped.
9. Add the new tree, do not remove the old one yet. Keep a planted manifest
   under the old name until the re-hang is finished, so `sync trees` has no
   reason to call `remove_tree`. (Whether a stub manifest with no artefacts
   passes `sync_trees`' stage filter is **unverified**; the filter reads
   `furthest_stage()` only, so it should.)
10. Re-hang each affected bundle under the new tree name with
    `orchard exhibit hang`, using **the same bundle ids**. Nothing is
    re-uploaded.
11. Edit `grove/src/world/mansion.json` line 768,
    `bundle.exhibit.tree`. Leave the room id, the presence id and the hanging
    ids alone unless you want `?room=spectre` links to break; the landing page
    at `grove/index.html:249` links to one.
12. If the presence id does change, call `set_room` for the new name first
    (`index.ts:670`); joining a room looks it up by name (`index.ts:344`).
13. Update `grove/src/ui/exhibit-content.ts`, including `evidenceAnchor`, and
    the matching `### spectre` heading in `docs/EXHIBIT-PLAN.md`, together.
14. Run `pnpm quality` in `grove/` and the Python suite.
15. Deploy the grove.
16. Only now: delete the old tree row, and restart the timer.

### Steps that are irreversible, or need Manuel's own hands

- **The grove deploy** (`pnpm run deploy`, not `pnpm deploy`). His approval
  every time.
- **Removing the old tree row.** It cascade-deletes exhibit rows. Recoverable
  by re-hanging, but the row ids move and the world is wrong in between.
- **Any `--delete-data` republish of the database.** It wipes visitors, bans,
  rulings and the review queue. Never as part of a rename.
- **Editing an existing `bundle.json`.** Irreversible in the sense that the
  bundle stops verifying and the id no longer matches the address it is served
  from. Do not.
- **Renaming a GitHub repository**, which only applies to orchard. GitHub
  redirects the old URL, but `orchard-tape` and `orchard-score` are pinned in
  three other repos as `https://github.com/weichseltree/orchard` with a
  subdirectory and a tag. Whether `uv` follows a GitHub rename redirect for a
  git source is **unverified**; re-pin all consumers explicitly rather than
  find out.
- **Rewriting `docs/DECISIONS.md` or `docs/LAWS.md`.** Both are append-only by
  their own first paragraph. A rename is a new line, never an edit of an old
  one.

---

## 6. Candidate names for spectre

### What is wrong with the current one

1. **The collision is total in a technical context.** Spectre is the 2018
   class of speculative-execution CPU vulnerabilities. In any developer's ear,
   and in any search, that is what the word means. A repository called spectre
   that is not about CPU side channels is fighting for its own name.
2. **There are at least three more.** SPECTRE is the criminal organisation in
   the James Bond novels and the 2015 film of that name; Spectre.Console is a
   .NET terminal library; the Spectre is a DC Comics character. The word is
   thoroughly occupied. (Sources below.)
3. **It says nothing about the work, and slightly says the wrong thing.** A
   spectre is a ghost: something that appears to be matter and is not. The
   repo's entire claim is the opposite. Its README opens with "Distill
   particle physics into dynamics at larger scales in both space and time,
   then measure the accuracy and actual compute saved", and rule 3 of its
   AGENTS.md is that a ledger closes or the instrument is fiction. A name
   meaning "apparition" is a poor fit for a repo whose discipline is that
   nothing is allowed to be an apparition.
4. **Nothing records why it was chosen.** I searched `README.md`, `AGENTS.md`
   and `docs/PROJECT_HISTORY.md` and found no origin note. If the intent was
   "spectral", as in spectral methods, the repo does use a spectral half-cell
   shift in `core/flywheel/llns_solver.py`, but that is one numerical detail,
   and spectral light belongs to phototroph.
5. **It is the odd one out in the family.** einstruct, phototroph,
   world-engine, someotherlife, event-atoms, premosaic are all descriptive
   compounds. spectre is a mood.

### Candidates

| Name | Why |
|---|---|
| **coarsen** | Names the actual mechanism. The repo's thesis is coarse-graining that buys a longer stable timestep, and "coarsen" is the verb for exactly that. Plain, honest, no product collision I am aware of, and it survives M06 being replaced by something else. |
| **rung** | The repo's own unit of progress. AGENTS.md rule 4: "A rung must buy time, not just space." One syllable, distinctive, almost unoccupied as a software name. Reads slightly cryptic standing alone. |
| **ladder** | Same family, more legible: M06's plan of record is literally "a continuum ladder". More generic than **rung**, and "ladder" is a common word in other software. |
| **accretion** | Names the phenomenon the exhibits actually show, heavy things gathering at the middle, in a real physics word with almost no software collision. But it describes the current target, not the method, so it ages with M06. |
| **flywheel** | Already the repo's own word for its method (`core/flywheel/`, "the simulation flywheel"). Against it: heavy business-jargon associations, and Flywheel is an existing product name in both hosting and medical imaging. |
| **protoplanet** | Unambiguous and evocative, and it matches what a visitor sees. Against it: it commits the repo permanently to planets, when the planet is the current application of a general method. |

**Recommendation: `coarsen`.** It is true of the whole repo rather than of its
current target, it is a plain English verb so nobody has to be told what it
means, it has no collision worth worrying about, and it fits the family's
descriptive style. `rung` is the better name if Manuel wants something short
and distinctive and is willing to explain it once.

Note that the display-name mechanism in section 4 makes the public label a
separate decision. The visitor need never read the repo name at all. So the
repo name can be chosen for the person who types it, and the guide label
chosen for the person who reads it. They do not have to be the same word.

---

## 7. Candidate names for orchard, including keeping it

### The honest case for keeping it

- It is load-bearing in 169 files of this repo, including the Python package,
  the `orchard` console script, `~/.config/orchard/secrets.env`,
  `ORCHARD_SECRETS`, `ORCHARD_DB`, three systemd unit names, the
  `orchard-push/1` user agent, and `audit.py:244`, which looks up the repo
  literally named "orchard".
- Two distributions are already released under it, **`orchard-tape`** at tag
  `tape-v1.0.0` and **`orchard-score`** at `score-v1.0.0`, and three other
  repos fetch `orchard-tape` over the network from
  `https://github.com/weichseltree/orchard` (`docs/specs/PACKAGES.md` §2, §7).
  A rename means re-pinning all of them.
- The live database is called `orchard` (`orchard/sync.py:32`,
  `docs/HOSTING.md:131`, dashboard at spacetimedb.com/orchard).
- The GitHub URL is printed on the live landing page three times
  (`grove/index.html:303`, `:308`, `:311`) and in the licence link.
- `"schema": "orchard/bundle/1"` is inside the hashed bytes of all 45 bundles,
  and `orchard/score/1` likewise. Those strings are frozen forever, exactly as
  section 3 describes for the tree name.
- The whole vocabulary rests on it: a tree, its harvest, the grove, the
  greenhouse, planting, scouting, pruning. Rename orchard and either the
  vocabulary becomes a set of orphan metaphors, or you rewrite all of it.
- `docs/DECISIONS.md` records it as a ruling already taken: "2026-09-11 ·
  Name: orchard. Beat greenlight and slate; ties to the channel name."

Good news from the audit: the parts that would be most painful are **already
not** orchard-named. The R2 bucket is `weichseltree-media`
(`orchard/push.py:68`), the media host is `media.weichseltree.com`, and the
Cloudflare Pages project is `weichseltree` (`grove/package.json:23`). None of
those move.

### The case against, which is new information

A web search today returns two collisions that did not exist when the name was
chosen on 2026-09-11:

- The PyPI name `orchard` is **already taken**, by an old Docker-app client
  (versions 1.0.8, 1.0.9). This costs nothing today, because orchard installs
  from a git tag and has never published to PyPI, but the front door is shut.
- Microsoft published **Orchard: An Open-Source Agentic Modeling Framework**
  (arXiv 2605.15040, github.com/microsoft/Orchard). That is a large, recent,
  well-promoted project in adjacent territory: open-source infrastructure for
  agents. For an open-source platform trying to be found, that is a real
  discoverability cost.

There is also **Orchard CMS**, a long-established .NET content management
system, which was already true in 2026-09-11.

### Candidates, if he changes it anyway

| Name | Why |
|---|---|
| **keep orchard** | Everything above. The collisions are in different domains, and orchard competes for no package-index name. |
| **the grove** | Promote the world's name to the platform, collapsing two names into one. Against it: "Grove" is taken by Seeed Studio's hardware ecosystem and by Grove.io, and it costs the same rename as any other option while losing the orchard/grove layering that the landing page currently uses deliberately. |
| **weichseltree** | It is already the GitHub organisation, the domain and the channel. The platform becomes "weichseltree", the world stays "the grove". Zero new collisions, and one fewer name in the stack. Against it: it welds an open-source platform others are meant to fork and run to one person's brand, which argues against the federation direction in `docs/PLATFORM.md`. |
| **espalier** | Austrian formal-garden word for fruit trees trained flat against a wall, which is almost exactly what the platform does to research: it takes trees and arranges them on walls to be looked at. Near-zero collision, and it fits the palace register. Against it: most people cannot spell it or say it. |
| **greenhouse** | Already in the vocabulary as the admin room, so it cannot be both. Listed to be dismissed. |

**Recommendation: keep orchard.** The cost is high, the collisions are in
other neighbourhoods, and the vocabulary is worth more than the search rank.
If Manuel wants distinctiveness in public, the cheaper move is the one the
landing page already makes: the wordmark is **grove**, with "by the orchard"
in small type underneath (`brand/README.md:74`). Let "the grove" be the public
name and "orchard" be the platform's name for people who read code.

---

## 8. The real naming problem: "grove" means two things

This may be the actual complaint underneath "the two repos might not be named
well", and it needs no repo rename at all.

**What a visitor meets, in order.** The landing page title is "The Observatory
· the grove" (`grove/index.html:7`), the wordmark reads "grove" with "by the
orchard" underneath (line 205), the hero eyebrow says "A research museum in
the grove", the button says "Enter the Observatory", the about section says
"The grove is Manuel Weichselbaum's research world ... The orchard is the open
source software behind it" (line 307), and the footer says "The Observatory ·
the grove by the orchard" (line 311). Four names in one line, under a fifth,
weichseltree.

That is a lot, but it is at least coherent: a museum, inside a world, made by
a platform, by a person. A reader who wants to can work it out.

**The part that is not coherent** is inside the world. Three rooms are titled
**The Western Grove**, **The Far Grove** and **The Eastern Grove**, with ids
`orchard-west`, `orchard-south` and `orchard-east` (`grove/src/world/
mansion.json`). So:

- "the grove" is the name of the entire world, and
- "a grove" is a garden room inside it, and
- those garden rooms have ids beginning `orchard-`, and they are the orchard
  grounds, the namesake made visible (`docs/DECISIONS.md`, 2026-09-12).

A visitor standing in The Western Grove, inside the grove, on the orchard's
grounds, which are run by the orchard, has been given the same two words three
times with three meanings. That is a genuine defect, and unlike everything
else in this document it is **free to fix**: a room's `title` is display text
only, and the `id` can stay exactly as it is, so no link, no presence row and
no test fixture has to move.

**Recommendation.** Keep "the grove" for the world. Retitle the three garden
rooms so the word appears once: for example **The Cherry Walk**, **The Far
Rows** and **The Eastern Rows**, or any three names that are not "grove" and
not "orchard". Then: one platform called orchard, one world called the grove,
one museum called the Observatory, and no word doing two jobs.

Whether the four-layer stack on the landing page should also be thinned to
three is a separate question, and a matter of taste rather than of correctness.

---

## 9. What I did not verify

- The contents of the live SpacetimeDB `tree`, `exhibit` and `room` tables.
  This audit read local files only, by instruction. Row counts and exact
  values are inferred from `docs/EXHIBIT-PLAN.md` and the module source.
- Whether SpacetimeDB 2.10 can add a column to a populated table without
  `--delete-data`.
- Whether a republish re-runs `init`, which is what seeds the tree room names
  at `index.ts:525`.
- Whether `uv` follows a GitHub repository-rename redirect for a git source
  pinned by tag and subdirectory.
- Whether a stub manifest with no artefacts passes the `sync_trees` stage
  filter, which is what option C's step 9 relies on.
- How long a full re-bundle of spectre's 13 artefacts would take. No timing
  was run, and no bundler was invoked.

Sources for the collision claims:
[Spectre (security vulnerability)](https://en.wikipedia.org/wiki/Spectre_(security_vulnerability)),
[Spectre (2015 film)](https://en.wikipedia.org/wiki/Spectre_(2015_film)),
[microsoft/Orchard](https://github.com/microsoft/Orchard),
[Orchard: An Open-Source Agentic Modeling Framework](https://arxiv.org/abs/2605.15040),
[orchard on PyPI](https://pypi.org/project/orchard/1.0.9).

---

## Rulings for Manuel

1. **Do we add a display name for a tree, so the guide can read "The Gravity
   Chamber / <something better>" without touching any identity?**
   Recommendation: yes. It is one line in `grove/src/ui/exhibit-content.ts`
   today, plus an optional defaulted `title` field on `Tree` in
   `orchard/manifest.py` if you want it to travel with the manifest. Do this
   first and on its own, whatever else is decided.

2. **Does spectre get renamed at all?**
   Recommendation: yes. The collision with the 2018 CPU vulnerability is
   total in a technical context, and the word means the opposite of what the
   repo is disciplined about.

3. **If it is renamed, to what?**
   Recommendation: **coarsen**. It names the method rather than the current
   target, it needs no explanation, and it fits the family's descriptive
   style. `rung` if you want something shorter and are willing to explain it
   once.

4. **Does the rename move the tree identity too, or only the repository?**
   Recommendation: only the repository (option B). `name` and `path` are
   independent fields, so the directory and the launcher can change while the
   tree identity stays put, and no exhibit row, bundle id or live-database
   write is involved. The bundles say "spectre" forever either way.

5. **Do we re-bundle spectre's 13 artefacts so their recorded tree name
   matches?**
   Recommendation: no. It is lane time and 13 new ids to change a string that
   is correctly recording what the tree was called when the bytes were made.
   Provenance is supposed to be frozen.

6. **Does orchard get renamed?**
   Recommendation: no. Keep it. The name is in 169 files, two released
   distributions other repos already pin, a live database, three unit names, a
   public URL on the live landing page, and the hashed bytes of all 45
   bundles. The new Microsoft "Orchard" collision is real but sits in a
   different neighbourhood.

7. **Do we retitle the three garden rooms so that "grove" stops meaning both
   the world and a room inside it?**
   Recommendation: yes, and this is the naming fix a visitor actually
   benefits from. Room titles are display text; ids stay, so nothing breaks.
   Suggested: The Cherry Walk, The Far Rows, The Eastern Rows.

8. **Does the public stack stay four names deep, "The Observatory · the grove
   by the orchard", under weichseltree?**
   Recommendation: keep it, once ruling 7 removes the ambiguous repeat. It is
   long but each layer is a real, different thing, and the landing page
   already explains the relationship in one sentence.
