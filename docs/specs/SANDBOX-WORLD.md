# The sandbox world: rendering from what the repositories are

Written 2026-09-16 against the repo at `a78e6de`, from Manuel's direction:

> *"I'd also like the rendering of everything be based on the repo structures
> of everything the Admins of that area linked. This is how orchard becomes a
> playable sandbox world."*

Nothing here is built. Every number is marked **proposed** unless a file is
cited for it, following the convention in
[AUDIO-STREAM.md](AUDIO-STREAM.md). The document ends in rulings
(section 7) that are Manuel's to make before lane time is spent.

**Relation to [TREE-AREAS.md](TREE-AREAS.md).** That spec was written the
same day, from the same sentence, by a parallel session, and it goes deep on
one of the three readings below: geometry generated from a repository's
directory tree. Its section 9 reports a working prototype against spectre at
`1345f10`. This document is the wider frame around it: which reading the
sentence can mean, what the existing code already gives each one, what a
generated world must not break, what "playable" means, and the order to build
in. Where the two overlap this one defers to TREE-AREAS.md and says so.
Where they disagree, section 3 says where and why.

---

## 1. Three readings of one sentence

"Rendering based on repo structure" can mean three different things. They
share a slogan and not much else.

### (a) The contents of a room come from the linked repositories

What a room holds is read from the repository: its declared artefacts first,
and beyond that possibly its files, its directories, its commit history, its
dependency graph.

**To a visitor.** You walk into spectre's room and what is in it was not
chosen by a curator today. The tapes and clips that spectre has harvested and
had approved are on the walls and on the floor. When spectre produces another
and it is approved, it is there the next time you visit. Nobody rebuilt the
world.

**How far it already goes.** Most of the way, at the granularity of a tree.
A hanging may name an exhibit rather than a bundle
(`ExhibitRefSchema` in `grove/src/world/schema.ts`; DECISIONS 2026-09-12,
"A hanging may name an exhibit, not a bundle"), the live `exhibit` table
decides what its bytes are (`bundleUrl` in `grove/src/world/world.ts`), and
`orchard exhibit hang` is the whole publish step (`orchard/exhibit.py`).
What is *not* there: the room's furniture, its number of pedestals and its
prose are still hand-written per room id
(`grove/src/ui/exhibit-content.ts`, 163 lines keyed by `hall`, `einstruct`,
`spectre`, `phototroph`, `world-engine`). The contents follow the repo; the
room around them does not.

### (b) The architecture of a room is derived from repo structure

The building itself: floor area from the repository's size, wings from its
top-level directories, corridors from its nesting, closed doors from its
retired work.

**To a visitor.** You walk into an area and you are walking a repository.
`lanes/` is a corridor with six doors, two of them shut because that work is
retired. `core/` is one large room. The rooms with the most files are the
biggest rooms. You learn the shape of a project by walking it, without being
told anything.

**How far it already goes.** Further than it looks, and not all the way.
`grove/src/world/observatory.ts` builds real geometry at runtime from four
numbers: `bounds`, `doorways`, `hangings` and `fallback.kind`. No glb, no
bake, no lightmap (OBSERVATORY.md, "Architecture and navigation"). But it
also branches on room **id** in five places: `ROOM_FINISH` for `spectre`,
`phototroph` and `orangery`; wall sconces for `hall`, `gallery`, `orangery`;
rib spacing for `hall` and `spectre`; oculi for `hall`, `phototroph`,
`spectre`, `greenhouse`; and `grounds()` for `terrace` and `parterre`. A room
whose id nobody has heard of gets the default finish, no oculus and no
chandelier. It is walkable and it is plain.

TREE-AREAS.md is the full treatment of this reading.

### (c) The world topology follows the set of linked repositories

Which rooms exist at all, and how they join, comes from the set of linked
trees and the links between them. Link a repository and a door opens; unlink
it and the door shuts.

**To a visitor.** The Long Gallery has doors down both sides. Four of them
are shut. Behind each shut door is a repository the orchard knows about and
has not yet earned a room. When one is linked, that door opens and there is
somewhere new. The building's plan is the portfolio.

**How far it already goes.** It is seeded and hand-fed. The Long Gallery
carries four closed doorways named `event-atoms`, `mosaic`, `HNL` and
`someotherlife` (`grove/src/world/mansion.json`), which are exactly four of
the twelve manifests in `trees/`; the schema has a word for it
("A door leaf, not an opening: drawn solid, never crossed. A tree earns its
room", `DoorwaySchema.closed` in `grove/src/world/schema.ts`), and the
document validator deliberately allows a closed door to a room that does not
exist yet (`MansionSchema.superRefine`). PLATFORM.md says the same thing one
level up: "A linked node appears as a portal in the hall." What is missing is
that nothing derives those four names from `trees/*.yaml`. A human typed
them, and the list has been out of date since the day it was written: eight
other manifests exist and have no door.

**The one honest gap in (c).** "The links between them" has no data behind it
today. No tree manifest records a relation to another tree (`manifest.py`
has `name`, `path`, `remote`, `question`, `phenomena`, `artefacts`,
`producers`, `theses`, `budget`, and no edge field), and PACKAGES.md section
2 states plainly that "No repo declares a dependency on another today". The
only recorded cross-tree relations are prose, in PLATFORM.md's "The repos are
the features" table. So the edges of (c) must either be declared by hand or
wait for PACKAGES.md section 2 to land `orchard-tape` and give the graph its
first real edge.

### Recommendation: (c) first, then (b), then (a) in depth

Build **(c)** first, as a single day's work, for four reasons.

1. **Its input is already curated and small.** Twelve manifests in `trees/`,
   each one a human's decision. (b)'s input is a git tree of an arbitrary
   repository, which is untrusted input to a generator and needs the whole
   safety list in TREE-AREAS.md section 10 before the first room appears.
2. **It is the gate the other two must pass through anyway.** An area has to
   exist and be reachable before its architecture is worth generating. A
   generated building nobody can walk to except by URL is not a world.
3. **It is the reading that delivers the brief's actual promise.** "The
   Admins of that area linked" is about linking. Linking should visibly change
   the world; today it changes a YAML file on Manuel's box.
4. **It cannot damage the Observatory.** Opening a door and adding a room is
   additive. Regenerating the thirteen ruled rooms is not.

Then **(b)** for exactly one tree, behind one of those doors, as TREE-AREAS.md
section 11 already proposes. Then **(a)** in depth: contents beyond declared
artefacts, which is the reading with the least support and the most ways to
turn into a file browser.

---

## 2. What already supports this, honestly measured

| claim | how far it actually goes | cite |
|---|---|---|
| The architecture is procedural, not modelled by hand | True for all 14 rooms. Geometry is instanced primitives built from `bounds`, `doorways` and `hangings` at runtime. **But** five branches key on room id, so a generated room gets the default look | `grove/src/world/observatory.ts`; OBSERVATORY.md |
| Rooms are declared in one JSON document validated by a schema | True. 14 rooms, 25,660 bytes, one Zod schema that fails at boot rather than at frame 900 | `grove/src/world/mansion.json`, `schema.ts` |
| A room's contents can change without a rebuild | True for what hangs. `exhibit` refs resolve through the live table; a take-down reaches visitors. **But** the document itself is a build-time import, so a room appearing or disappearing is a deploy | `world.ts` `bundleUrl`; `main.ts:28` imports `mansion.json` |
| The harvest reads a repo's own manifest | True. `orchard.yaml` in the repo is canonical, `trees/` is the mirror; harvest refuses a dirty tree and records the commit the artefact was made at | `orchard/harvest.py`, `orchard/manifest.py` |
| `orchard scout` drafts a manifest from a repo | True, and it already extracts the sentence this design needs: the README's first heading and first paragraph. **But** it walks the working filesystem with `rglob`, not the git tree, so it is a precedent and not the reader a generator can use | `orchard/scout.py` |
| The schema already has the pieces | True. Closed doors, per-room `presence`, per-room `scale`, `portals` between scales, five hanging kinds, game surfaces | `schema.ts` |
| Portals between scales work | True and shipped. The Orrery is `scale: 0.02`, reached through the armillary; `crossPortal` refuses a body at the wrong scale | `portal.ts`, `space.ts`, OBSERVATORY.md |
| Rooms load by adjacency, so a big world is not resident | True, with a caveat: `neighbourhood()` is depth 2 and pulls in *every* ground cell as soon as one is in range | `world.ts` `neighbourhood` |
| Trees are already pushed to the live database | True for the tree row (`upsert_tree`). Presence rooms are **not**: `init` seeds six by name and the rest were added by hand with `set_room` on maincloud | `spacetime/spacetimedb/src/index.ts` |
| Per-area admins exist | **False.** `admin` is one identity allowlist for the whole database, seeded with whoever publishes; `requireAdmin` is the only check there is | `index.ts`; DECISIONS 2026-09-12, "Admin is whoever publishes" |

That last row matters for reading the brief. "The Admins of that area" cannot
mean a role in the module, because there is no such role. It can mean the
maintainers of the linked repository, who rule their area by committing to it
(TREE-AREAS.md section 10). Under that reading the sentence is buildable
today and needs no module change at all.

---

## 3. The mapping: what in a repository becomes what in a room

Two kinds of cost. **Cheap** means it reads a manifest the orchard already
has on disk and emits JSON. **Build step** means it needs a checkout at a
pinned commit, a `git ls-tree`, and a regeneration policy.

| read from | where it lives today | becomes | cost |
|---|---|---|---|
| the set of linked trees | `trees/*.yaml`, `manifest.py` `Tree.name` | which areas exist: one door off the Long Gallery per tree | cheap |
| `tree.question` | written by `scout.py` from the README's first paragraph | the area's entrance sentence, and the guide's room card | cheap |
| `tree.status`, `tree.stage` | `manifest.py` `Status`, `Stage` | the door's state: `closed: true` for dormant, archived, or nothing approved yet | cheap |
| `tree.artefacts[]` with `approved` and `bundle` | written by `harvest.py` | the hangings, by kind, each as an `exhibit` ref pinned to its bundle | cheap to emit; a harvest and a hang ruling behind it (LAWS 22) |
| `tree.phenomena[].hook` | `manifest.py` `Phenomenon` | the sentence on a pedestal beside one hanging | cheap |
| top-level directories of the git tree at a pinned commit | not read by anything today | chambers off the area's corridor | build step |
| directory byte weight | not read today | floor width and ceiling height (TREE-AREAS.md sections 4 and 5) | build step |
| a directory's `README.md` first heading and paragraph | `scout.py` does this for the repo root only | the room's title and its end-wall text | build step |
| files that are neither prose nor artefacts | not read today | furniture: instances in the room's existing batches | build step |
| retired or empty directories | not read today | closed doors | build step |
| languages and file extensions | `scout.py` detects the GPU framework only | one palette per **tree**, not per language (see the rule below) | build step |
| dependency edges between linked trees | **nothing records one** (PACKAGES.md section 2) | a doorway or a portal between two areas | build step, and the data does not exist yet |
| commit cadence | `scout.py` reads `git log -1 --format=%cs` into a note | **nothing. Recommended against.** See below | n/a |

### Two corrections to TREE-AREAS.md, both unmeasured

**Furniture is nearly free in draw calls, not the bulk of them.**
TREE-AREAS.md ruling 3 says shelving "is also the bulk of its draw calls".
Reading `Builder.add` and `Builder.finish` in `observatory.ts` says
otherwise: a batch is keyed `${primitive}-${finish}`, and every call with an
existing pair adds a matrix to an existing `InstancedMesh`. A shelf drawn as
a `box` in the `stone` finish costs one instance and twelve triangles, and no
new draw call. What costs draw calls is the number of **rooms** resident,
because each room builds its own batches. This is derived from reading the
code and is **proposed**, not measured; section 4 says how to measure it.

**A wordless room should not be a door.** TREE-AREAS.md section 4 lets a
directory earn a chamber for being top-level alone. That clause is the one
that can produce a room with no title, no sentence and nothing on its walls.
The rule below closes it, and section 7 turns it into a ruling rather than
settling it here.

### The one rule: a room a visitor cannot describe in one sentence is not a room

This is what keeps the design from becoming a three-dimensional file browser.

**Every room carries a title and one sentence, both taken from the
repository, and a directory that supplies neither becomes furniture in its
parent instead of a door.** The sentence comes from the directory's
`README.md` first paragraph, or from the tree's `question` for the entrance
gallery, or from a declared artefact's title for a room that exists only
because something hangs in it. Nothing else may promote a directory to a
room.

Three consequences, each one a LAWS line:

- **Nothing in a room is a number, a label of bytes, or a chart.** LAWS 7
  bans graphs, text and counters on the world. Size is felt as floor area and
  ceiling height; quantity is felt as how many doors a corridor has. A
  directory's byte count never appears as a figure anywhere.
- **Hue is not a data channel.** LAWS 12 reserves hue for meaning. One
  palette per tree, the way `ROOM_FINISH` already gives `spectre`,
  `phototroph` and `orangery` one, so two areas do not read alike. Colouring
  rooms by programming language would be a legend the visitor has to learn and
  it would compete with the tapes, which own their colours.
- **No inferred metric decides how a room looks.** Commit cadence is the
  tempting one and it is the one to refuse: a room that dims because nobody
  committed last month is a metric painted on a wall, and no person decided
  it. Retirement should render (it does, as a closed door) because a human
  wrote `status: dormant` in a manifest. That is a declaration, not a
  measurement.

The incentive this creates is the point: an area is legible exactly as far as
its repository is documented, and the fix for an illegible area is a README,
which is wanted anyway.

---

## 4. What must stay stable

A world that changes as repositories change still has to keep the promises
the current one makes. Five of them, each with a proposed rule.

### 4.1 Room URLs

`?room=<id>` starts a visit in any room, with optional `x`, `z`, `yaw` and
`pitch` (`grove/src/main.ts:75`, `grove/src/world/visit.ts`).
OBSERVATORY.md states the promise: "Existing room URLs remain useful." An
unknown id today falls back silently to `mansion.start`, so a dead link drops
you in the hall with no explanation.

What breaks if rooms come and go: every shared link into a generated room, on
every commit that renames a directory.

**Proposed rule.** A generated room's id is its path and nothing else:
`<tree>/<path/within/the/repo>`, never derived from position, weight or
ordering. TREE-AREAS.md section 5 already has the right instinct here, sorting
siblings by name so that "weight sets width; name sets place". And an id that
no longer exists is **answered, not swallowed**: the visitor lands at that
area's entrance gallery with a world notice
(`grove/src/ui/worldnotice.ts`) saying which room is gone. The fourteen
authored ids are frozen: they are the keys of `exhibit-content.ts`, the
stations of `grove/scripts/quality-world.mjs`, and the presence names in the
module.

### 4.2 Presence rooms in the live database

`room` rows are inserted by `init` for six names and were added for the rest
by hand with `set_room`, which is admin only
(`spacetime/spacetimedb/src/index.ts`). A visitor reads presence, poses and
chat only for the room they stand in (DECISIONS 2026-09-12, "The grove's
people are private"). spectre's prototype area is 26 rooms
(TREE-AREAS.md section 9). Twelve trees at that size is roughly three hundred
presence scopes, three hundred admin-only writes, and a visitor who is alone
in every one of them.

**Proposed rule.** **One presence room per area, not per generated room.**
The schema already permits it: `presence` is a plain string on each room and
nothing requires it to be unique. Presence is a social scope, not a geometric
one. The cost is that you see someone through a wall's worth of distance
inside an area, which is cheaper than being alone everywhere. One `set_room`
call per linked tree, written by the home box the way `upsert_tree` already
is.

### 4.3 Pinned bundle ids and the hang ruling

A hanging carries both an `exhibit` ref and a pinned content hash for
single-player (`schema.ts`). Pinned ids rot: the hall's poster pins
`c59c7baa6fd15489`, a still that was never pushed because it is unapproved, so
that wall 404s today (BACKLOG item 3).

**Proposed rule.** **Generation never invents a bundle id and never uploads
anything.** It emits a hanging only for an artefact whose manifest already
carries `approved: true` and a `bundle` id written by harvest; an artefact
without one gets no hanging rather than a broken one. Hanging stays a ruling
through `orchard exhibit hang` (LAWS 22, `orchard/exhibit.py`). Two artefacts
of one tree and kind in two generated rooms are already expressible: the
`bundle` pin on an exhibit ref exists for exactly that case
(DECISIONS 2026-09-12, "A hanging may pin an exhibit to a bundle").

### 4.4 The service worker's caching rules

`grove/src/sw/policy.ts` keeps content-addressed bundle paths forever
(`/^([0-9a-f]{16})\/…/`), keeps hashed build output, serves pages
network-first with a 3 s timeout, and passes live exhibits through without
ever caching them. PACKAGES.md states the rule underneath: **a name that
carries its content hash is kept forever; a fixed name is always re-checked.**

`mansion.json` is a build-time import (`main.ts:28`), so today the world
document is part of the hashed build and a world change is a deploy. A plan
fetched at runtime under a fixed name would be exactly the mistake
PACKAGES.md was written about.

**Proposed rule.** A plan is content-addressed: `plan/<sha256>.json`,
immutable, cacheable forever, with one small pointer document per area
fetched `no-store` that names the current plan. That is the bundle-and-exhibit
split reused unchanged, and it needs one new path pattern in `policy.ts` and
nothing else. TREE-AREAS.md section 5 already makes a plan a pure function of
`(generator version, commit sha, orchard.yaml digest)` addressed by its
sha256, so the id exists; this only says where it is served from.

Stages 1 and 2 below do not need this: they generate at build time and commit
the result, which changes nothing about caching.

### 4.5 Device budgets

`grove/quality/budgets.json` caps the build at 4.3 MB total and 700 kB of
gzipped JS. `docs/specs/DEVICE-TIERS.md` caps a frame at 100 draw calls on a
Quest 2 and 150 on a Quest 3. `grove/scripts/quality-world.mjs` checks
"Architecture stays below 150 draw batches across the whole world" with all
fourteen rooms loaded.

The arithmetic that follows is **proposed**, derived from that check rather
than separately measured: fourteen rooms under 150 batches is roughly ten
batches a room, and a room's batch count depends on how many
primitive-and-finish pairs it uses, not on how much is in it. So a corridor
with eight chambers open off it is around ninety batches, which is the entire
Quest 2 budget before a single exhibit draws. And `neighbourhood()` is depth
2, so standing in a corridor already asks for every chamber off it.

**Proposed rules.** The draw-batch check becomes per visible neighbourhood
rather than per world, because a generated world has no fixed room count.
`neighbourhood()` takes a resident-room cap alongside its depth. An area caps
how many doors one corridor may open (TREE-AREAS.md's `MAX_ROOMS` is a total,
not a fan-out). And the measurement that turns all of this into fact is one
capture station per generated room in `quality-world.mjs`, reporting batches
and triangles for the worst corridor, before stage 2 ships.

Two things that do **not** break: the build budget, because a runtime-fetched
plan is not build output, and the media caps in `policy.ts`, because
generation adds no media (section 4.3).

---

## 5. The sandbox part: what a visitor does, and what an owner changes

"Playable" has to mean more than looking. Everything below is built out of
things that exist.

### What a visitor does

- **Walks a repository and reads its shape.** Which corridor is long, which
  doors are shut, where the work actually is. TREE-AREAS.md section 9 found
  three true things about spectre this way on the first try.
- **Stands inside the evidence.** Tapes, video walls, stills and the planet
  cutaway are all existing hanging kinds with existing controls: play, pause,
  scrub, speed, the atlas modes on the planet
  (`planet-exhibit.ts`, `PlanetExhibit.setAtlas`).
- **Reads where it came from.** "About this view" is the provenance panel
  (`grove/src/ui/provenance.ts`), and every generated room's shell carries its
  own provenance record the way `buildObservatory` and `buildSpace` already do.
- **Meets people.** Presence, poses and chat, scoped to the area (4.2).
- **Crosses scales.** The Orrery mechanism is shipped: a portal is a soft
  sphere, the far room is rendered live from a camera standing where the eye
  would stand over there, scaled by the ratio (`portal.ts`, OBSERVATORY.md).
- **Plays the one game there is.** `gameSurfaces` with a trusted-origin
  allowlist, FTL Chess on the Lantern Walk
  (`grove/src/world/game-surface.ts`).

**One proposed addition, and it needs no new engine.** An area's entrance
holds a portal to the same area at a small scale, so a visitor can stand over
their own repository as a model, see every corridor at once, and walk into any
room by stepping toward it. That is the Orrery's mechanism applied to a second
subject: `scale`, `portals`, `crossPortal` and `buildSpace` are all shipped
and tested. It is the single cheapest thing that makes an area feel like a
place you can play with rather than a corridor you walk down. **Proposed**;
no measurement exists for two areas plus a live far view on a phone.

**What is not proposed.** No building, no placing, no editing of the world
from inside it. A visitor changes nothing. The sandbox is that the *world* is
made of something the admins already change all day, not that the world is
editable by whoever walks in.

### What an owner of a linked repository can change

Everything inside their own area, by committing, with no ruling and no queue
(TREE-AREAS.md section 10):

| they commit | the world does |
|---|---|
| move or rename a directory | the rooms move or are renamed |
| add a `README.md` | the room gets a title and a sentence, and stops being furniture |
| add an artefact to `orchard.yaml` | it hangs, once harvested and approved |
| set `status: dormant` | its door shuts |
| commit an `area.json` | their area is authored rather than generated |

What they cannot change: whether they are linked at all, whether an artefact
is approved (LAWS 22), the operator's admin allowlist, anything that runs
code on the operator's box, and anything outside their own area. Linking is
the only trust decision in the model and it stays the operator's.

---

## 6. Three stages

Each is independently shippable and each proves one thing.

### Stage 1: the doors tell the truth (one day)

**Build.** A Python emitter that writes the Long Gallery's doorway list from
`trees/*.yaml` instead of from a human's memory: one door per tree that has no
room, `closed: true` unless the tree is `active` and has at least one approved
artefact with a bundle. Open exactly one of them onto a **one-room area**
generated from that tree's manifest alone: the title is the tree's name, the
end wall carries its `question`, and its approved artefacts hang as exhibit
refs. Output is a fragment merged into `mansion.json` at build time and
committed, so nothing about caching, presence or the service worker changes.
One presence room for the area (4.2). One new station in
`quality-world.mjs`.

**Cost.** Roughly 150 lines of Python beside `orchard/portfolio.py`, a test
against the twelve manifests, one screenshot. No client change. No module
change.

**Proves.** That the world's topology can follow the link set, that a
generated room validates and is walkable, and, most usefully, whether a room
that is **only prose** reads as a place. Every tree behind the four closed
doors has zero approved artefacts, so the first generated room will be a room
with a sentence and nothing on its walls. That is the honest first test of the
rule in section 3, and it is better to fail it on day one than after the
generator is written.

**Risk.** Additive only. The thirteen ruled rooms are untouched.

### Stage 2: one repository becomes a building

**Build.** TREE-AREAS.md sections 3 to 7, for one tree, still generated at
build time and committed: the git tree at a pinned commit plus `orchard.yaml`,
the weight and earning rules, corridors and chambers, READMEs as titles and
end walls, artefacts hanging by path, furniture. Plus what this document adds:
the sentence rule (section 3), path-shaped room ids and the gone-room notice
(4.1), one presence room for the area (4.2), a per-neighbourhood draw budget
with measurements (4.5), and a palette per tree.

**Cost.** TREE-AREAS.md section 11 estimates about 600 lines of Python for the
generator plus a material vocabulary in `observatory.ts`. Add the safety list
in its section 10, which is not optional: a linked repository is untrusted
input. Add the measurement in 4.5.

**Proves.** Whether a repository makes a good building. There is no way to
find this out by arguing about it, which is what makes this stage worth its
cost even if the answer is no.

**Risk.** The draw-batch ceiling (4.5), and areas that read as file browsers
rather than places. Both are visible in the first screenshot.

### Stage 3: the world changes without a deploy

**Build.** Plans become content-addressed documents fetched at runtime with a
per-area `no-store` pointer (4.4), regenerated on a commit and rate-limited
(TREE-AREAS.md section 10), with `set_room` per area written by the home box
the way `upsert_tree` already is. Add the area's own scale portal (section 5).
Add the first real edge between two areas, if and only if PACKAGES.md section
2 has landed a package that one tree pins from another, so that the edge is a
fact rather than a drawing.

**Cost.** One path pattern in `policy.ts`, a pointer document, a regeneration
trigger, a module write per area, portal wiring per area. Client work for the
first time.

**Proves.** The sentence in the brief, literally: an admin commits to their
repository and the world is different, with nobody deploying anything.

---

## 7. Rulings for Manuel

Each is one question with a recommendation attached.

1. **Which reading is built first: (a) contents, (b) architecture, or (c)
   topology?**
   *Recommendation: (c), as stage 1.* Its input is twelve curated manifests
   rather than an arbitrary git tree, it is the gate the other two must pass
   through anyway, it is the reading that makes linking visible, and it cannot
   damage the Observatory. Then (b) for one tree, which is TREE-AREAS.md's own
   "cheap first cut", then (a) in depth.

2. **Is the sentence rule the law?** A room must carry a title and one
   sentence taken from the repository, and a directory that supplies neither
   becomes furniture rather than a door, even when it is top-level.
   *Recommendation: yes.* It is the only proposed rule that stops this
   becoming a file browser, it makes LAWS 3, 7 and 10 mechanically checkable,
   and its incentive (write a README) is one we want anyway. It overrides
   TREE-AREAS.md section 4's first earning clause.

3. **May any inferred metric decide how a room looks?** Commit cadence, churn,
   test counts, contributor counts.
   *Recommendation: no.* Only declarations render: `status: dormant` shuts a
   door because a person wrote it. A room that dims on its own is a counter
   painted on a wall (LAWS 7).

4. **One presence room per area, or one per generated room?**
   *Recommendation: one per area.* Three hundred presence scopes is three
   hundred rooms to be alone in, and the schema already allows rooms to share
   a `presence` string.

5. **Where does generation run: build time, or live?**
   *Recommendation: build time through stage 2, live in stage 3.* Build time
   costs nothing in caching, presence or client code, and the whole question
   of whether an area reads as a place is answerable without it.

6. **Does an unlinked or renamed room get a notice, or the silent hall?**
   *Recommendation: a notice at the area's entrance naming the room and the
   commit it was last in.* Silent fallback is what `visitRoom` does today and
   it makes every shared link into a generated area a trap.

7. **Does a per-tree maintainer role enter the module?**
   *Recommendation: not yet.* "The operator links, the repository rules"
   (TREE-AREAS.md section 10) needs no module change and is enough until a
   second person actually has a tree. The `admin` allowlist stays the
   operator's.

8. **Is the area's own scale portal in scope?** Stand over your repository as
   a model and step into any room.
   *Recommendation: yes, in stage 3.* It is the cheapest thing that makes an
   area playable rather than walkable, and every piece of it is already
   shipped and tested for the Orrery.

9. **What happens to the Observatory?**
   *Recommendation: it becomes the orchard repository's own authored area*
   (TREE-AREAS.md section 8), with its fourteen room ids frozen. Visitors keep
   arriving in a composed, ruled, deliberately lit building, and the generated
   areas hang off its Long Gallery doors, which is what those doors were put
   there for.

### Ruled by Manuel, 2026-09-16

The recommendation stands unless marked **overruled**. Where a ruling here
meets one in SANDBOX-TRUST.md, that document's ruling is the one about trust.

- **Scope: full generation.** Rooms, doorways and geometry all come from the
  structure of the repositories an area's admins link. Stage 1 alone was
  offered and not chosen. The trust layer (SANDBOX-TRUST.md) is built
  **before** generation, so nothing linked reaches a visitor before it can be
  withdrawn.
- 1 — **Topology first**, as recommended. Then architecture for one tree,
  then contents.
- 2 — **The sentence rule is the law**, as recommended.
- 3 — **No inferred metric decides how a room looks**, as recommended.
- 4 — **One presence room per area**, as recommended.
- 5 — **Overruled: generation is live from the start.** It is not build-time
  through stage 2. The client derives areas at runtime, so a commit can
  reshape an area without a deploy. The caching, presence and client cost
  that the recommendation deferred is now part of the first build.
- 6 — **A notice at the area's entrance** for an unlinked or renamed room, as
  recommended.
- 7 — **Overtaken.** SANDBOX-TRUST.md ruling 3 builds per-area admins now, so
  a per-tree role enters the module after all.
- 8 — **The area's scale portal is in scope, stage 3**, as recommended.
- 9 — **The Observatory stays authored**, as recommended. It becomes the
  orchard repository's own area. Note that its room count has moved: main had
  fifteen rooms at 6a9743b once the Belvedere was added. The ids frozen are
  the ids on main, not the fourteen this section was written against.
- **someotherlife's splat room is entered through its area model**, and its
  entrance is the Belvedere. Neither a doorway nor an equal-scale portal was
  chosen. The room is metric and must stay 1:1: its lean radius is a measured
  distance in metres. A portal must still change scale (schema.ts refuses a
  same-scale portal). The area's scale portal satisfies both rules. The
  visitor stands over the model at a small scale, and crossing lands the body
  at scale 1.

  someotherlife supplied four constraints, and they bind the build:
  1. **The body lands at the capture station.** A splat room has no outside.
     It holds up only within about a metre of where it was photographed.
  2. **No locomotion inside.** The head is clamped to the lean radius and
     guided back past it. clampHead and the lock predicate are the hook.
  3. **A far view needs its own SparkRenderer.** Spark sorts for one
     viewpoint per renderer, so a portal's view is a second sort worker and
     a second ordering. It is not just a second draw.
  4. **A splat far view stays a still on every device** until
     someotherlife's bench measures host room plus portal view together.
     It goes live only where that combined budget holds, **and only once
     far views render in XR at all**. Today `PortalFrame.live` is false
     whenever an XR session presents (main.ts passes `live: !presenting`),
     so in a headset, the device class where the lean radius matters most,
     the grove draws no far view of any portal.
  5. **A splat room needs a variant of the portal, and the area model's ratio
     has a ceiling.** someotherlife-ad derived this and I verified it by brute
     force. With the far eye at `exit + (eye − centre) · ratio^(1−t)` and a
     visitor walking straight in, the far eye's distance from the station is
     not monotonic. On a linear blend it peaks at `R / (e · ln(1/ratio))` and
     leaves the lean radius L unless `ratio ≤ exp(−R / (e · L))`. For R = 4.5 m
     that means ratio ≤ 0.19 at L = 1 m, and ≤ 0.036 at L = 0.5 m. (For ratios
     above 1/e the edge value R · ratio binds instead, but no safe ratio is
     that large.)

     orchard's portal as built fails a splat room before that bound even
     applies. Its blend reaches t = 1 at the **core boundary**, d = core · R
     (core 0.3, and up to 0.55 with full intent), not at the centre. So at the
     end of the blend the far eye is still 1.35–2.48 m from the station,
     whatever the ratio. `crossPortal` separately preserves the body's
     horizontal offset from the centre; that matches the eye on desktop but
     can differ in room-scale XR. A splat portal must therefore collapse both the far-eye offset
     and the landing offset to the station as t → 1. The ceiling above is
     then recomputed with orchard's real distance, `R · (1 − t · (1 − core))`.
     someotherlife's bench (apps/spike-c `?portal=`, someotherlife b2eb00c)
     models orchard's real `shapedBlend` rather than the linear `blendAt`,
     and reports the peak, the landing offset and the safe ratios for each
     run. For the splat variant (the far offset scaled by (1 − t), landing at
     the exit) in a 4.5 m sphere, it gives:

     | lean radius | strict core | full intent |
     |---|---|---|
     | 1 m | ratio ≤ 0.222 | ratio ≤ 0.165 |
     | 0.5 m | ratio ≤ 0.109 | ratio ≤ 0.053 |

     Full intent binds, because a committed walk starts its blend at 1.35 R.
     The grove's portal as it is today (no collapse, landing at the offset)
     has a safe ratio of 0 at any lean radius.
