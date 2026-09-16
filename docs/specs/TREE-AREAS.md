# Tree areas: the repository as the floor plan

Written 2026-09-16 against Manuel's direction: *"I'd like the rendering of
everything be based on the repo structures of everything the Admins of that
area linked. This is how orchard becomes a playable sandbox world."* With the
two decisions taken the same day: **an area is a tree** (one linked
repository, governed by its own maintainers), and **its geometry is generated
from that repository's structure**, not drawn by hand.

Nothing here is built. Every number is a plan. The spec ends in rulings
(section 12) that are Manuel's to make before lane time is spent.

---

## 1. The inversion

Today the world is composed and the repositories are flat. `mansion.json` is
a hand-written list of fourteen boxes; a tree enters through `trees/*.yaml`
as a curated list of phenomena and artefacts, and a human decides that
spectre's planet hangs at (0, 1.6, −4) in a room called the Gravity Chamber.
A tree's own shape — that it has six lanes, that two of them are retired,
that its engine is one directory and its instruments another — is invisible.

Under this spec that is reversed. **The repository is the floor plan.** Its
directories are its rooms, its nesting is the route between them, its
declared artefacts hang in the rooms whose paths contain them, and its
maintainers change the world by committing to it. No one places a wall.

This is what makes it a sandbox rather than a museum: the building material
is the thing the admins already make all day.

## 2. Words

- **tree** — one linked repository. Already the repo's word (`trees/*.yaml`).
- **area** — the walkable place one tree generates. One tree, one area.
- **admins of an area** — that tree's maintainers. They rule their area by
  committing; see section 10 for what that does and does not grant.
- **plan** — the generated document describing an area: rooms, doorways,
  hangings. It is a `mansion.json` fragment and validates against the
  existing schema.
- **gallery** — the room a directory itself becomes: a corridor.
- **chamber** — a room a subdirectory becomes, entered from its parent's
  gallery.
- **stacks** — the single overflow chamber that absorbs siblings cut by the
  room budget.

## 3. What the generator reads, and what it refuses to read

The source is **the git tree at a pinned commit, plus the tree's
`orchard.yaml`**. Nothing else. In particular it never reads the working
filesystem of the checkout.

This matters more than it looks. spectre's `results/` is gitignored, and it
is where every tape lives. A generator that walked the working directory
would produce a different world on every box, would render build caches and
`.venv` as architecture, and could not be reproduced by anyone else. A
generator that read only the git tree would produce a spectre with no
evidence in it at all.

So both, with a clean division:

| source | what it decides |
|---|---|
| the git tree at commit `C` | the architecture — which rooms exist and how they connect |
| `orchard.yaml` `artefacts:` | what hangs, and where |

A declared artefact path may lie outside the tracked tree. Its directories
are then **created** as rooms by the declaration. That is how
`results/m04_planet/` becomes a room without being in git: because its owner
declared, hashed and approved something in it.

The room set is therefore: *tracked directories* ∪ *directories on declared
artefact paths*, minus the exclusions.

**Exclusions**, applied before anything else: any path segment beginning
`.`, and the fixed set `__pycache__`, `node_modules`, `.venv`, `venv`,
`dist`, `build`, `target`, `.git`. A tree that wants one of these rendered
says so in `orchard.yaml`; the default is silence.

## 4. Weight, and which directories earn a room

Every directory `D` gets a weight:

```
own(D)    = sum of bytes of the files directly in D
art(D)    = number of declared artefacts directly in D
w(D)      = own(D) + ARTEFACT_BYTES * art(D) + sum(w(child) for child in D)
```

`ARTEFACT_BYTES` (proposed 64 KiB) is the only tuning constant that says
what this world is *for*: it buys a declared artefact more floor than the
source that made it. Raise it and the world becomes a gallery; lower it and
it becomes a codebase.

A directory earns its own chamber when **any** of these hold:

1. it is a top-level directory of the tree, or
2. it carries a `README.md` (or the tree's declared `doc_names`), or
3. a declared artefact path passes through it.

Everything else is not a room. Its files are counted into its parent's
weight and it appears there as furniture — a named shelf, not a door. This
single rule is what keeps `core/engine/potentials/` from becoming a corridor
to a cupboard while `lanes/m04_planet/` becomes a chamber.

**Budget.** At most `MAX_ROOMS` per area (proposed 64) and `MAX_DEPTH` 5.
When a directory's children exceed the budget, the lowest-weight siblings
collapse into one **stacks** chamber that names them on its shelves. The
budget is never exceeded, and exceeding it is not an error — a repository
with ten thousand directories renders as a large but finite building.

**Collapse.** A room with no files and no artefacts of its own and exactly
one child room is not a place; it is a hallway to one door. It merges into
that child, which takes the compound name (`adiabat-chi0/tape`). Applied
bottom-up **on the room tree, not on path strings** — a room's parent is its
nearest ancestor that earns a room, and collapsing re-parents onto that tree.
Collapsing by path prefix instead silently orphans siblings and dissolves
rooms that had four children; this was found by building it (§9).

## 5. The plan: corridors and the rooms off them

A directory renders as a **gallery**: a corridor. Its child chambers stand
along that corridor, each sharing a wall with it, each with a doorway in
that shared wall. The directory's own files are furniture in the gallery.
The axis alternates with depth, so the plan is rectilinear and each level
reads as a turn.

```
  root gallery (the tree's entrance, README.md on the end wall)
  ┌──────────────────────────────────────────────┐
  │  ▸ core   ▸ lanes   ▸ docs   ▸ tests  ...     │   corridor, runs +Z
  └──┬────────┬─────────┬─────────┬──────────────┘
     │        │         │         │
  ┌──┴──┐ ┌───┴───┐ ┌───┴──┐ ┌────┴───┐
  │core │ │lanes  │ │docs  │ │tests   │   chambers, each a gallery in turn
  └─────┘ └───────┘ └──────┘ └────────┘
```

The algorithm, in full:

1. The area gets a footprint rectangle sized from `w(root)`.
2. Split it along its longer horizontal axis into a **corridor band** of
   fixed width (proposed 5 m) and a **chamber band** holding the rest.
3. Sort the earning children **by name**, not by weight, and lay them along
   the chamber band with widths proportional to `w(child)`, clamped to
   `[6 m, 24 m]` and quantised to 1 m.
4. Cut a doorway in each shared wall, centred, 2.4 m × 3.0 m. A chamber whose
   directory is empty of both files and artefacts gets a **closed door**
   (`closed: true`) — the schema already has the concept and the Long Gallery
   already uses it.
5. Recurse into each chamber with the axis swapped.

Two properties fall out of ordering by name rather than by weight, and both
are worth more than a prettier packing:

- **Insertion is local.** Adding `lanes/m07_x/` moves its siblings along the
  band; it does not permute the building. An admin who adds a directory can
  find the change.
- **Editing a file changes a room's size, not its address.** Weight sets
  width; name sets place. A visitor who learned the route keeps it.

**Ceiling height** is `clamp(3.2 + 1.1 * log2(1 + w(D)/MiB), 3.2, 9.0)` m.
Big directories are tall rooms. Corridors take their parent's height, so the
entrance gallery is the tallest thing in an area and every route descends
from it.

**Determinism.** The plan is a pure function of
`(generator version, commit sha, orchard.yaml digest)` and is addressed by
the sha256 of those. Same commit, same building, on any box. This is the
same discipline the bundles already have, and it makes the diff between two
commits presentable to an admin as *"these four rooms changed."*

## 6. What hangs, and what furniture is

**Artefacts hang by path.** A declared artefact at `results/m04_planet/tape`
hangs in the chamber generated for `results/m04_planet/`. Its kind picks the
hanging kind the schema already has (`tape`, `video`, `still`, `planet`,
`audio`). Position within the room: on the wall clockwise from the door, in
declaration order, at 1.6 m eye height; a `tape` or `planet` takes the room's
centre instead. No hand placement anywhere.

**Prose is readable surface.** A directory's `README.md` renders on its
gallery's end wall — the existing guide surface (`grove/src/ui/guide.ts`)
already renders text and disclosures. Its first heading becomes the room's
title. This is the single largest quality lever in the whole spec: an area
is legible exactly as far as its repository is documented, which is the
incentive we want.

**Source files are furniture.** Files that are neither prose nor declared
artefacts become shelving along the gallery's walls, one unit per file,
height by line count, grouped by extension. They carry a name and nothing
else. They are there so an area feels inhabited and so its shape is honest
about where the work actually is — not so anyone reads code in VR.

## 7. What renders it

The generator emits rooms into `mansion.json`'s existing
`orchard/mansion/1` schema with `architecture: "observatory"`. That path
already builds runtime geometry from bounds and doorways
(`grove/src/world/observatory.ts`: box, column, arch, ring, crown, halo
primitives, a palette with per-room finish overrides, procedural stone
surfacing). **No glb, no bake, no lightmap, no asset pipeline.** A generated
area is walkable the moment the JSON validates.

This is the finding that makes the whole proposal cheap: the client already
generates architecture at runtime, so the work is a Python generator that
emits documents `parseMansion` accepts, and `observatory.ts` gains a
material vocabulary rather than a new renderer.

Each tree gets a palette entry the way `spectre`, `phototroph` and
`orangery` already have one in `ROOM_FINISH`, derived from the tree, so two
areas do not read alike.

## 8. Authored areas, and how the Observatory survives

A tree may ship an **authored** plan instead of a generated one, by
committing its own `area.json` and declaring it in `orchard.yaml`. The
generator then validates and passes it through.

This is not a special case for the hub; it is a property every tree has. But
it is how the 2026-09-12 palace ruling and the 2026-09-14 Observatory
survive intact: **the orchard repository is itself a tree, and the
Observatory is its authored area.** Visitors still arrive in a composed,
ruled, deliberately lit building. The generated areas of the other trees
hang off its doorways and its orangery portals, which is what those were
designed to be.

Nothing is thrown away, and the model has one rule rather than an exception.

## 9. Worked example: what spectre renders as today

Measured, not imagined: sections 3 and 4 were implemented
([`tree-areas-probe.py`](tree-areas-probe.py), a probe, not the generator) and
run against spectre's git tree at `1345f10` and its `orchard.yaml`. The area is **26 rooms**, four
deep, of which **13 are created by declaration** (they are not in git) and
**8 directories become furniture** rather than doors.

```
spectre                              7 files          <- the entrance gallery
   core                              1 file           <- 6 subdirectories as furniture
   deliverables                      1 clip, README
   docs                              3 files
   lanes                             3 files
      m01_ground_truth              28 files, README
      m02_coarse_dynamics           18 files, README
      m03_first_film                 1 file,  README   <- retired
      m04_planet                     9 files, README
         exhibit                     8 files, README
            viewer                   6 files, README
      m05_slide                      2 files, README   <- retired
      m06_earth_system               3 files, README   <- the plan of record
   archive/legacy_2d                 7 files, README   <- collapsed, one child
   results                                             <- not in git
      m03_first_film
         assembly-v6                 1 clip
         plates                      2 stills
         styleframes-v2              1 still
      m04_planet
         exhibit-v2                  2 clips
         adiabat-chi0/tape           1 tape             <- collapsed
         adiabat-chi12/tape          1 tape             <- collapsed
         adiabat-chi6/tape           1 tape             <- collapsed
   tests                            83 files
   tools                             9 files
```

Four things this shows, and the last two are the point of the exercise:

1. **It is already legible.** spectre was restructured into numbered lanes as
   *work areas* in September; that restructure turns out to have been a floor
   plan. `lanes/` is a corridor of six doors, and a visitor walks the project's
   actual shape without being told it. Nobody designed this and it is true.

2. **Retirement renders.** m03 (film) and m05 (slide) are retired; their rooms
   hold one and two files against m01's twenty-eight. The corridor shows which
   work is alive by how much room it takes up.

3. **`core/` is a single room with six subdirectories as furniture** —
   `engine/`, `flywheel/`, `instruments/`, `video/`, `film/`,
   `engine/potentials/`. They are the actual machine of the project and they
   render as shelving, because not one of them carries a README. This is the
   §4 incentive working exactly as designed and it stings, which is the
   evidence that it is calibrated: the fix is a README, and the README is
   wanted anyway.

4. **The evidence is in a different wing from its explanation.** Thirteen of
   the twenty-six rooms hang under `results/`, and every word explaining them
   is under `lanes/`. `lanes/m04_planet` (README, 9 files) and
   `results/m04_planet` (four rooms, three tapes and two clips) are the same
   work in two wings that do not touch: one of unillustrated prose, one of
   unexplained evidence.

That fourth finding is not a defect in the generator; it is the generator
working. It has surfaced a real defect in how spectre stores its work on the
first repository we pointed it at, and the fix belongs in spectre — declare
the artefacts under the lane that explains them, or give `deliverables/` the
role its own README already claims, the room where finished things hang by
plain name. **No aliasing layer should ever be added to the generator to hide
this.** An alias would restore the hand-placement this whole spec exists to
remove, and would do it invisibly.

**The rules generalise.** The same probe over the other linked trees, at
their current commits:

| tree | rooms | by declaration | directories as furniture |
|---|---|---|---|
| world-engine | 12 | 4 | 7 |
| spectre | 26 | 13 | 8 |
| phototroph | 33 | 3 | 92 |
| einstruct | 37 | 0 | 63 |

Every one lands between 12 and 37 rooms, four deep — comfortably inside the
64-room budget, so `stacks` (§4) is a guard against a hostile or unusual
repository rather than a thing visitors will normally meet. The furniture
column is the §4 incentive at larger scale: phototroph renders 92 directories
as shelving. Whether that is right is ruling 5.

Two of these trees declare no artefacts at all under `results/`, so their
areas are architecture and prose with nothing hung. An area is worth visiting
in proportion to what its tree has declared, which is the correct dependency
and an uncomfortable one.

**orchard is not yet a tree.** It has no `orchard.yaml`, so the probe cannot
read it at all. Section 8 makes the Observatory *orchard's own authored area*,
and that requires orchard to declare itself the way every other tree does.
That is small work and it is a precondition, not an afterthought.

A fifth thing was found by building rather than writing: the collapse rule
(§4) is wrong if implemented on path strings, which is how it was written
first. `results/m04_planet` has four children, but once
`adiabat-chi0` had merged into `adiabat-chi0/tape`, a prefix-based parent
lookup no longer saw those children and dissolved their parent. The room
count was 30 before the rule, 24 with the broken rule and 26 with the correct
one. A spec that had shipped its first number would have been wrong twice.

## 10. Admins, and untrusted input

**What an admin of an area may do:** everything, inside their area, by
committing to their repository. Rearranging directories rearranges rooms.
Declaring an artefact hangs it. Writing a README titles a room and fills its
end wall. No ruling, no review queue, no waiting on the operator.

**What an admin may not do:** exist in the world at all without being
linked. Linking and unlinking a tree is the node operator's decision and the
only trust decision in the model. Everything downstream of it is mechanical.

Which means a linked repository is **untrusted input to a generator that
runs on the operator's box**, and the generator must be built as such:

- **Pure.** It reads a git tree and a YAML document and returns JSON. It
  executes nothing from the repository — no build, no import, no hook, no
  `orchard.yaml`-specified command.
- **Budgeted.** `MAX_ROOMS`, `MAX_DEPTH`, a wall-clock limit and an output
  size limit, all enforced by truncation into `stacks`, never by failure.
- **Sanitised.** Room titles and furniture names are clamped to 64 characters,
  stripped of control characters and bidirectional overrides, and never
  rendered as markup. Path segments are normalised and `..` refused.
- **Asset-free.** No image, mesh, font or video from a repository enters the
  scene except through the existing bundle path, which hashes it and requires
  `approved: true` or an explicit ruling (LAWS 22). Generation changes the
  *architecture* story, not the *media* story.
- **Rate-limited on regeneration.** A plan is rebuilt on a commit, not on a
  push storm; one rebuild per tree per interval, coalesced.

The existing `admin` allowlist and `add_admin` reducer are the node
operator's, and are untouched by this spec. A per-tree maintainer role in the
module is new work and is listed in section 12 as a ruling, not assumed here.

## 11. What this costs

| piece | size | notes |
|---|---|---|
| the generator | new, ~600 lines Python | `orchard/area.py`; pure, tested against fixture trees |
| schema | additive | `orchard/mansion/1` already accepts every room a plan needs; `area.json` passthrough is new |
| `observatory.ts` | a material vocabulary | per-tree palettes, furniture primitives; no new renderer |
| bake / assets | **none** | runtime architecture, no glb, no lightmap |
| client | none at first | a generated document loads like the authored one |
| module | one ruling's worth | only if per-tree maintainer roles are wanted (§12) |

The cheap first cut is one tree, generated, reachable through a door from the
Long Gallery, beside the thirteen authored rooms. It does not disturb the
Observatory and it either reads as a place or it does not — which is the only
way to find out whether a repository makes a good building.

## 12. Rulings this spec needs

1. **Generated areas at all** — does the world gain repository-shaped areas
   beside the authored Observatory, on the model of §8?
2. **`ARTEFACT_BYTES`** — how much more floor does a declared artefact buy
   than the source that made it? The number decides whether an area reads as
   a gallery or as a codebase (§4).
3. **Furniture** — are source files rendered as shelving at all (§6), or is an
   area only its prose and its artefacts? Shelving is what makes an area feel
   inhabited and is also the bulk of its draw calls.
4. **The spectre finding** — is §9.4 fixed in spectre (declare artefacts under
   the lane that explains them, or promote `deliverables/`), or is an aliasing
   layer added to the generator? This spec recommends the former and
   recommends against ever building the latter.
5. **Undocumented directories** — §9.3 renders spectre's whole engine as
   shelving because `core/*` carries no README. Is that the wanted incentive,
   or does a directory earn a room on size alone past some threshold? The
   spec's position is that the incentive is right and the thresholds are a way
   of not asking for the README.
6. **Per-tree maintainer role** — do areas need admins other than the operator
   in the module today, or is "the operator links, the repository rules" enough
   until a second person actually has a tree?
7. **Naming** — parked by decision on 2026-09-16 until the design is settled.
   The design settles one thing relevant to it: under this spec **"tree"
   stops being a metaphor**. A repository is literally the terrain, and
   orchard's vocabulary — trees, grove, harvest, greenhouse, orangery —
   describes the mechanism rather than decorating it. The name that carries
   no weight under this design is spectre's.
