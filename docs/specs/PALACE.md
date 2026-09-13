# The palace

> Historical design. The [Observatory](OBSERVATORY.md) replaces this palace
> in the current client as of 2026-09-14. Its original scene is preserved in
> [archive/palace-2026-09-12.json](archive/palace-2026-09-12.json).

The architecture of the grove's public world from here on: the hall becomes
the marble hall of a palace, Austrian in character, and the grounds outside
its windows are an orchard of sour cherry trees, the Weichsel the channel is
named after. Written 2026-09-12 against Manuel's direction (DECISIONS
2026-09-12, "a palace with an actual orchard"), the gallery palette ruling,
and the client as it stands. Nothing here is built yet; every number is a
plan, and the bake numbers are extrapolated from one record, the hall
(`grove/public/assets/hall/hall.json`, `docs/impl/WP3-hall-bake.md`).

Words used below: a **room** is one entry in `mansion.json`, an axis-aligned
box with doorways in its walls; a **cell** is a room with no ceiling, used
for the grounds; a **hanging** is what a tree puts in a room (tape, video,
still, later splat, page, portal). The client's axes: Y up, the hall's
windows on −X, its doorway to einstruct at z = −10. The compass below is a
convention so that the plan can be read: **−X is south** (the garden front,
where the sun is), **+X north** (the court), **−Z west**, **+Z east**.

## 1. The idea, and the first three minutes

One building, one level, one garden. A Baroque palace of the Schönbrunn,
Belvedere and Eggenberg kind is a line of rooms along a garden front, each
door aligned with the next so that from the hall you look through the whole
wing (the enfilade), with a marble hall at the centre, a long gallery and an
orangery at the ends, cabinets behind the state rooms, and in front of the
windows a terrace, a parterre and then the useful grounds. That plan is also
exactly what the client can do today: rooms are boxes, doorways are holes in
shared walls, light is baked, and a graph of rooms is what the loader and
the presence tables want. Each tree owns a state room on the garden front or
a cabinet behind; the hall is the operator's; the greenhouse is the small
glasshouse off the hall where the owner rules; linked orchards stand in the
orangery; the grounds are cells of terrace, parterre and orchard, all at
floor level, with spectre's chi12 ball hung in the sky as a moon. Nothing
here defies physics yet. Portals and world-engine's lens (M5) hang off the
same doorways later without moving a wall.

The visitor's first three minutes, on any device:

- **0:00** They arrive on the hall's spawn, (0, 0, 8), facing west down the
  hall. The doorway ahead at z = −10 is aligned with einstruct's far door at
  z = −22 and world-engine's at z = −34, so the first thing in view is a
  78 m sightline ending in the orangery's daylight. On the left, six tall
  windows; through them, sun on a terrace, a parterre, and rows of trees to
  the horizon. On the right, the poster wall. "2 here" in the HUD.
- **0:40** They turn left. The two central windows are French doors; three
  steps and they are on the terrace at the same floor level (no stairs
  anywhere: VR locomotion handles them badly). Balustrade, gravel, the
  basin at 35 m, the orchard beyond it in the sun at 33°, birds, and the
  facade behind them when they turn round. The moon, if ruled in, stands
  over the west orchard.
- **1:40** Back in, straight down the enfilade into einstruct. Between the
  two sheets is the 1.4 m aisle the enfilade line passes through; they wade
  into the left sheet at 1.0 m and the scrubber on the pedestal moves 2,634
  particles. The 40 s clip plays on the north wall because it is the nearest
  wall and the one decoder went to it.
- **3:00** Through the next door into world-engine (three stills and a
  plaque), or back through the hall into phototroph and the gallery. They
  have seen the palace, the orchard and one tape, and met whoever was there.

## 2. The plan

### 2.1 Room program

Two ranges. The **garden range** (x from −7 to 7) is the enfilade on the
south front: every room in it has windows on −X and the orchard outside.
The **court range** (x from 7 to 21) is the cabinets behind, windowless or
lit from the north. Room heights: 7 m for the hall, gallery and orangery
(the centre and the end pavilions), 6 m for state rooms and cabinets, 5 m
for the greenhouse. All floors at y = 0.

| room | owner | kind | x | z | h | what is in it |
|---|---|---|---|---|---|---|
| hall | operator | marble hall | −7..7 | −10..10 | 7 | poster wall; the enfilade start; French doors to the terrace |
| einstruct | einstruct | state room | −7..7 | −22..−10 | 6 | two 6 m sheets at x = ±3.6, y = 1.0; clip wall on +X; `row` wall on the hall side |
| world-engine | world-engine | state room | −7..7 | −34..−22 | 6 | three stills, the `page` plaque; its east door is the lens doorway (M5) |
| orangery | operator | portal court | −7..7 | −70..−34 | 7 | 9 open arches to the terrace; 8 portal niches on the north wall, a tub tree beside each |
| phototroph | phototroph | state room, clerestory | −7..7 | 10..22 | 6 | the 3 m dimer sheet at centre; windows with a 3.5 m sill so light enters high |
| gallery | operator | great gallery | −7..7 | 22..58 | 7 | 6 poster panels on the north wall between three cabinet doors; the wall of the pruned trees (premosaic's two posters) on the east end wall |
| spectre | spectre | Planet Room (cabinet) | 7..21 | −24..−10 | 6 | three 3.6 m balls in a row at x = 14, z = −21.5 / −17 / −12.5; the silent loop on the north wall; no windows, a star-field ceiling |
| greenhouse | operator, admin | glasshouse | 7..15 | 2..10 | 5 | the review queue on benches; admin only, capacity 4 |
| event-atoms, mosaic, HNL | second wave | cabinet | 7..21 | 22..34 / 34..46 / 46..58 | 6 | one north window each; a closed door until the tree has hung something |
| someotherlife | donor | closed door | (stub) | (stub) | – | a door on the gallery's east wall that opens on a captured room when one exists |
| terrace | grounds | cell | −15..−7 | −70..58 | open | balustrade at x = −15 with three openings |
| parterre | grounds | cell | −55..−15 | −40..40 | open | four box-hedge quarters, gravel, a 10 m basin at x = −35 |
| orchard-west / -south / -east | grounds | cell | −130..−15 / −130..−55 / −130..−15 | −110..−40 / −40..40 / 40..110 | open | about 450 sour cherry trees on a 7 m grid |
| court | grounds | cell, no access | 21..60 | −24..58 | open | gravel and the far ring, seen only from the cabinets' north windows |

Rules the program follows:

- **Rooms are earned, not reserved as boxes.** A tree with nothing approved
  gets a closed door, not an empty grey room (Manuel walked the first box
  rooms and they looked terrible). A closed door is a `doorways[]` entry
  with `closed: true`: the fallback builder draws that wall solid, the
  baked room shows a door leaf, navigation refuses the crossing.
- **Windows all show the same orchard.** Two windows in one wall must agree,
  so the garden front looks onto the modelled grounds. someotherlife's
  splat vantage points go where a reveal can hide the splat's edge and no
  second window contradicts it: the orangery's west end arch and the
  greenhouse's window, as `role: "vantage"` markers with a `radius_m`.
- **No mirrors, no stairs, no glass.** A mirror is a second render of the
  room per eye; stairs break the AABB clamp; glass in a diffuse bake costs
  samples and darkens the room (WP3 known issue 1). Windows, arches and
  the greenhouse roof are open apertures, as the hall's already are.
- **Everything the presence module needs is a `room` row**: one per room
  and per cell, capacity 24 (the module's default), the greenhouse
  `admin_only`. The `open_room` reducer exists; `init` should seed them so
  a `--delete-data` republish does not lose the palace.

### 2.2 Plan at metre scale

North up, east right. One character is 2 m in z, one line about 3 m in x.

```
 x=21 ┌──────────────┐                                       ┌────────┬────────┬────────┐
      │   spectre    │             court (no access)         │ event- │ mosaic │  HNL   │
      │  Planet Room │                        ┌──────┐       │ atoms  │        │        │
 x=7  ├──────┬───────┼──────────────┬─────────┤green-├───────┼───┬────┴───┬────┴───┬────┤
      │      │       d   einstruct  D   HALL  │house │ photo-│   d        d        d    │
      │ oran-D w-eng D   sheets     D  poster D      │ troph D   gallery, 36 m         ██ pruned wall + closed door
      │ gery │       │   ±3.6       │  wall   └──────┘       │                          │
 x=-7 └AAA─AAA─AAA───┴─www──www──www┴ww─ww─FF─ww─ww┴─www──www┴─www──www──www──www──www──┘
      terrace, 8 m deep ─────────────────────────────────────────────────────────────── balustrade
 x=-15════════════════════════════════╪═══════╪═══════════════════════════════════════
      orchard-west     │           parterre, 40 × 80 m, basin at (−35, 0)   │ orchard-east
                       │                                                     │
 x=-55                 ├─────────────────────────────────────────────────────┤
                       │                    orchard-south                    │
 x=-130 ───────────────┴─────────────────────────────────────────────────────┴───────────
       z=-110    -70   -40     -22   -10     0      10   22          58            110
```

`D` a 2.4 × 3.2 m doorway on the enfilade line (centre 0), `d` a cabinet
door, `w` a window bay, `F` the pair of French doors, `A` an open arch,
`═` the balustrade with `╪` its openings. The enfilade line is z through
x = 0: hall door, einstruct door, world-engine door, orangery door all at
centre 0, so the sightline from the spawn runs to the orangery's west wall
at z = −70.

Elevation of the garden front, from the parterre (south), 1 character 2 m:

```
      orangery 7 m      w-eng   einstruct       HALL 7 m       phototroph        gallery 7 m
    ┌──────────────┐  ┌──────┬──────┐  ┌──────────────┐  ┌──────┬──────────────────────┐   roof, slate, +4 m
    │ A  A  A  A  A│  │ w w w│ w w w│  │ w w w FF w w w│  │ h h h│ w w w w w w w w w    │   windows sill 1.6, head 5.6
    │              │  │      │      │  │               │  │      │                      │   clerestory h: sill 3.5
    └──────────────┘  └──────┴──────┘  └───────────────┘  └──────┴──────────────────────┘   rusticated base to 1.1 m
   z=-70            -34    -22    -10  -10             10  10    22                    58
```

### 2.3 Doorways, in mansion.json's convention

`axis` is the axis the wall is perpendicular to, `at` the wall's coordinate,
`center` the opening's centre on the other horizontal axis. Both rooms list
the same opening. Sizes: state doors 2.4 × 3.2 (the hall's existing door),
cabinet doors 2.4 × 3.2, the French doors 1.6 × 5.6 (the window aperture
taken down to the floor; the transom above 3.2 m is open like every
window), arches 3.0 × 5.0, balustrade openings and cell edges with `height`
equal to the cell height so the fallback draws no lintel.

| room | to | axis | at | center | width | height | note |
|---|---|---|---|---|---|---|---|
| hall | einstruct | z | −10 | 0 | 2.4 | 3.2 | exists |
| hall | phototroph | z | 10 | 0 | 2.4 | 3.2 | new: the hall's blank back wall |
| hall | terrace | x | −7 | −1.67 | 1.6 | 5.6 | French door, was window 3 |
| hall | terrace | x | −7 | 1.67 | 1.6 | 5.6 | French door, was window 4 |
| hall | greenhouse | x | 7 | 6 | 1.6 | 3.0 | `admin: true`; closed to visitors |
| einstruct | world-engine | z | −22 | 0 | 2.4 | 3.2 | the lens doorway, plain until M5 |
| einstruct | spectre | x | 7 | −20 | 2.4 | 3.2 | |
| world-engine | orangery | z | −34 | 0 | 2.4 | 3.2 | |
| orangery | terrace | x | −7 | −40, −52, −64 | 3.0 | 5.0 | three of the nine arches are walkable |
| phototroph | gallery | z | 22 | 0 | 2.4 | 3.2 | |
| gallery | event-atoms / mosaic / HNL | x | 7 | 28 / 40 / 52 | 2.4 | 3.2 | `closed: true` until each hangs something |
| gallery | someotherlife | z | 58 | −3.5 | 2.4 | 3.2 | `closed: true`; the pruned wall is at z = 58, x from 0 to 7 |
| terrace | parterre | x | −15 | 0 | 12 | 8 | the axial opening |
| terrace | parterre | x | −15 | ±36 | 4 | 8 | |
| parterre | orchard-south | x | −55 | 0 | 80 | 8 | open edge |
| parterre | orchard-west / -east | z | −40 / 40 | −35 | 40 | 8 | open edge |
| orchard-west / -east | orchard-south | z | −40 / 40 | −92.5 | 75 | 8 | open edge |

Hall markers the rebake must export, on top of `spawn`, `door_einstruct`
and `poster_wall`: `door_phototroph`, `door_terrace_1`, `door_terrace_2`,
`door_greenhouse`, and `window_1..6` with `role: "window"` (the client
needs the apertures for the visibility map and the vantage rule). Every
palace room exports the same set: `spawn`, `door_<to>`, `poster_<n>`,
`window_<n>`, and cells `vantage_<n>` where they have one.

### 2.4 Migration of the rooms that exist

The einstruct-anchored boxes were provisional because a new hall doorway is
a rebake (DECISIONS 2026-09-12, "Rooms off einstruct, not off the hall").
The rebake is 13 minutes of CPU, so the order is: **rebake the hall with
its four new openings first, then move the boxes.** Until then nothing
moves, because a grey box behind a solid baked wall is a wall you walk
through.

| room | today (bounds) | palace (bounds) | hangings move to |
|---|---|---|---|
| hall | −7..7 × 0..7 × −10..10 | same | poster wall unchanged; the marker file gains the new doors |
| einstruct | −7.5..7.5 × 0..5 × −20..−10 | −7..7 × 0..6 × −22..−10 | sheets to x = ±3.6, z = −16 (pedestals at z = −13); clip wall to +X at (6.9, 2.35, −14), rot −90; `row` wall stays on the hall wall at x = −4.2, width 4.5 |
| world-engine | 7.5..17.5 × 0..5 × −20..−10 | −7..7 × 0..6 × −34..−22 | two stills 5 m wide on +X at z = −25.2 and −30.8; the third 4.5 m on the west wall at x = 4.1; plaque by the door |
| phototroph | −17.5..−7.5 × 0..5 × −20..−10 | −7..7 × 0..6 × 10..22 | sheet at centre (0, 1.0, 16), pedestal at z = 13.5 |
| spectre | −7.5..7.5 × 0..5 × −32..−20 | 7..21 × 0..6 × −24..−10 | balls at (14, 1.5, −21.5/−17/−12.5); the wall at (20.9, 2.35, −17), rot −90; spawn (8.5, 0, −20) facing +X |
| greenhouse | none | 7..15 × 0..5 × 2..10 | spawn (8.5, 0, 6) |
| grounds | the sky dome | the cells above | the moon: a tape hanging in `terrace`, see 3.4 |

Presence room names stay; the spectre and world-engine rows already exist.
Each move is one edit of `mansion.json` plus the grey box until that room
bakes; hangings deeper than `WALL_THICKNESS` (the facing test) as before.

## 3. The exterior: the orchard grounds

### 3.1 Terrain and program

Flat. The palace's floor, the terrace, the parterre and the orchard are all
at y = 0; the ground rises only beyond the orchard, as a low hill line in
the far ring. Austrian gardens of this kind step down in terraces
(Belvedere) or run flat to a hill (Schönbrunn); the flat one is the one
the AABB clamp can walk. In order, from the windows:

- **Terrace**, 8 m deep, gravel, along the whole 128 m front, with a stone
  balustrade at x = −15 (the same kit piece as the parapet) and three
  openings.
- **Parterre**, 40 × 80 m: four quarters of gravel edged with box hedge
  0.6 m high, in a plain axial pattern (a broderie is a texture decision
  for later), a round basin 10 m across at (−35, 0), still water, no jet.
  Hedges are static geometry in the parterre's atlas: about 260 m of hedge,
  under 3,000 triangles.
- **Orchard**, three cells around the parterre, about 22,000 m², trees on a
  7 m grid with the rows running north–south so that from the terrace you
  look down the rows: about 450 trees. Sour cherry: 4 to 5 m tall, crowns 4
  to 5 m, trunks 0.2 m. Grass between rows, a mown path down the axis.
- **Far ring**, an impostor: a cylinder band at 300 m with a rendered
  panorama of more orchard, a treeline and the hill line, alpha-cut against
  the sky. Nothing is walkable beyond the orchard cells' bounds.

### 3.2 Sky and sun, from the bake record

The sun stays exactly where the hall's bake put it: travel direction
(0.7796, 0.2999, −0.5498) in Blender axes, that is towards the sun
(−0.78, 0.55, 0.30) in the client's, 33° above the horizon, 21° east of
due south. It is a late-morning sun on a south front. Every exterior bake
uses the same sun (strength 3.6, 1.6° disc) and the same Nishita world
(strength 0.85, altitude 120 m, dust 1.6) as `bake_hall.py`, so the pools
on the hall floor and the shadows on the terrace agree by construction. A
5 m cherry tree casts a 7.7 m shadow at this elevation.

The client's gradient dome stays (0 bytes, already deployed); the change is
that its five colours and the haze width are **sampled from the Nishita
world at bake time** and written into `sky` in `mansion.json` with the
source noted, instead of guessed. `SKY_RADIUS` goes from 80 to 400 m and
the camera's far plane from 120 to 600 (near 0.1: a 6,000:1 ratio, fine
for a 24-bit depth buffer). A 256² PMREM of the dome, generated at load in
about 30 ms, is the environment map for the polished floor, the basin and
the gilt.

### 3.3 Baked, instanced, impostor

| thing | how | why |
|---|---|---|
| terrace, parterre ground, hedges, basin, balustrade | one mesh, one lightmap atlas (4096² desktop, 2048² Quest, 1024² phone) | static; the sun and the facade's shade are the picture |
| the garden facade, 128 m: base, window surrounds, parapet, roof | one mesh, one 2048² atlas | seen from every cell; 6 to 8 m tall, the roof only from the parterre |
| orchard ground, 22,000 m² | one mesh per cell, one shared 2048² atlas (13.8 px/m, 7 cm texels) | tree shadows on grass need no more; the trees themselves are not in the atlas |
| trees | 3 variants × 3 LODs, `InstancedMesh`, one draw call per variant per LOD (9); transforms in `orchard.json` from a seeded RNG (seed recorded) | 450 unique meshes would be 450 draw calls |
| tree light | vertex AO per LOD0/LOD1 (Cycles AO to vertex colour, shared by all instances) + the sun as **the one runtime directional light in the world**, on tree materials only, + the cell's SH probe as ambient | baked light cannot rotate with a random yaw; one Lambert light is free; shadow maps are not |
| far ring | 32 segments, 256 tris, 4096 × 512 ETC1S KTX2 (about 0.6 MB) rendered by Cycles from the scattered far orchard | the horizon |
| moon | a `tape` hanging | see 3.4 |
| sky | the shader dome | see 3.2 |

Tree LODs and their distances, per instance, re-sorted when the visitor
moves more than 5 m:

| LOD | distance | triangles | what |
|---|---|---|---|
| 0 | < 25 m | 4,000 | trunk, branches, leaf cards with alpha test, fruit as part of the leaf card |
| 1 | 25 to 60 m | 800 | trunk, main branches, 8 large cards |
| 2 | > 60 m | 4 | two crossed cards, a 512² rendering of LOD0 per variant |

From the terrace the nearest tree is 40 m away, so the palace never sees
LOD0; inside the orchard about 55 trees are within 25 m (a 25 m circle on a
7 m grid), 150 in the 25 to 60 m ring, the rest cards: about 220k + 120k +
2k = 340k triangles in the worst spot, which is the Quest budget (5.3)
with 50k to spare for the facade and the ground. The trees come from
Blender's bundled Sapling add-on (procedural, ours to ship), not a kit,
because a cherry tree with a fixed sun and three LODs has to be re-emitted
whenever the season changes; leaf and bark textures are CC0 tilings with a
provenance sidecar like any stock.

### 3.4 The moon

spectre's chi12 ball (bundle `64546061a0b52660`) hangs in the sky as a
`tape` hanging in the `terrace` cell: position (−105, 55, −60) in the
west-south-west sky, away from the sun's azimuth, 25° up from the terrace,
`longSideMeters` 14, `pointSize` about 600 so that a point 100 m away
covers a few pixels. Its bounds are 100 m from the nearest wall, and since
tapes in a room load with that room, it appears whenever the terrace does,
that is in every garden-front room. Two rules: it always streams the
`phone` variant (a new `variant` override on the hanging: 0.96 MB chunks,
not 1.92), and it runs on the one transport with every other tape, so
scrubbing the Planet Room turns the moon. Whether a moon reads in a
daylight sky is the first look ruling's question (section 7), rendered
both ways.

## 4. Material and light

### 4.1 The gallery palette, extended

The hall's ruling stands: charcoal walls (linear 0.195), a near-black
polished floor (0.055, roughness 0.22), the exhibits carry the light. The
palace keeps that key and adds what a palace is made of, each as a flat
colour plus at most one 1024² tiling map, ETC1S, under 0.4 MB:

| surface | where | linear albedo | roughness | map |
|---|---|---|---|---|
| black marble floor, pale veins | hall, gallery | 0.055 | 0.22 | veins, 2 m tile |
| dark oak parquet, Tafelparkett | state rooms, cabinets | 0.08 | 0.45 | 1.2 m tile |
| grey stone flags | orangery, greenhouse, terrace | 0.18 | 0.7 | 1 m tile |
| stucco lustro, charcoal | walls everywhere inside | 0.195 | 0.9 | none |
| stone-grey dressing | pilasters, door surrounds, window reveals, cornice | 0.32 | 0.6 | none |
| gilt | capitals, the cornice's top bead, the Supraporte crests, portal arches | (0.85, 0.65, 0.30), metalness 1 | 0.35 | none |
| ceiling field | coffers and coves | 0.235 | 0.92 | none |
| Planet Room walls | spectre | 0.02 | 0.95 | none; the ceiling an emissive star field |
| facade limewash or Schönbrunner Gelb | outside | 0.55 grey-white, or (0.75, 0.58, 0.28) | 0.9 | none |
| slate roof | outside | 0.05 | 0.8 | none |
| gravel, grass, box | grounds | 0.30 / (0.10, 0.16, 0.06) / (0.06, 0.10, 0.05) | 0.9 | one 512² each |

**Gilt in restraint** is a number: the generator sums the area of gilt
material per room and refuses above 2 % of the room's visible surface. The
window reveals are the light stone so the windows read as bright frames
in a dark wall, which is what the six windows do already. The orangery is
the one candidate for a light room (limewashed, as orangeries are); it is
in the contact sheet both ways.

### 4.2 Cycles bake per room

The pipeline is `bake_hall.py`'s, generalised (section 5): direct+indirect
diffuse, no colour pass, adaptive threshold 0.01, 8 bounces (4 diffuse),
indirect clamp 10, 8 px margin, compositor OIDN after the bake, 99.9th
percentile normalised to 0.95, sRGB 8-bit, UASTC q2 + zstd 18 with mips.
What changes:

- **One scene, one target at a time.** The generator builds the whole
  palace and grounds in one Blender scene; `bake.py --room X` selects room
  X's object as the bake target with everything else present as occluder
  and bouncer. That is the fix for WP3 known issue 2 (the hall's doorway
  spill assumed nothing behind it) and it makes the terrace's shade the
  facade's, not a guess.
- **Resolution follows area**, at about 50 px/m for interiors and 30 px/m
  outside, with tiers per device.
- **Per-atlas scale** as today; exteriors normalise the same way (the sunlit
  ground is most of the texels and sits at the top of the range, shade at a
  tenth, which 8-bit sRGB resolves).

| asset | m² | full tier | Quest | phone | samples | CPU estimate |
|---|---|---|---|---|---|---|
| hall (rebake) | 1,133 | 2048² | 2048² | 1024² | 1024 | 13 min (measured 794 s) |
| state room, 14 × 12 × 6 | ~650 + ornament | 2048² | 2048² | 1024² | 1024 | 10 to 12 min |
| cabinet, 14 × 12 × 6 | ~650 | 2048² | 2048² | 1024² | 1024 | 10 min |
| Planet Room, 14 × 14 × 6 | ~730 | 2048² | 2048² | 1024² | 1024 | 12 min |
| greenhouse, 8 × 8 × 5 | ~290 | 1024² | 1024² | 512² | 512 | 3 min |
| gallery, orangery, 36 × 14 × 7 | ~1,800 | 4096² | 2048² | 1024² | 512 | 26 min |
| facade | ~1,500 | 2048² | 2048² | 1024² | 512 | 5 min |
| terrace + parterre | ~5,000 | 4096² | 2048² | 1024² | 512 | 26 min |
| orchard ground | 22,000 | 2048² | 2048² | 1024² | 256 | 10 to 30 min (leaf alpha; calibrate at 1024² first) |

The coefficient behind the estimates is the hall's: 2.5 M covered texels ×
1024 samples in 794 s, about 3.3 M samples per second on 16 threads, with
adaptive sampling handing back 15 to 20 % at the top. A 4096² atlas is four
times the texels. The 512² smoke bake is a poor predictor (WP3 measured
that), so every new kind of asset gets a 1024² calibration at 64 samples
before its production number is trusted.

Sizes per room on the wire: glb 0.1 to 0.6 MB (meshopt), lightmap 2 MB at
2048² UASTC (0.6 MB at 1024²), probes 8 KB, IR 60 KB, maps shared. The
whole palace and grounds is about 27 MB of lightmaps on the Quest tier and
is never resident at once (section 6.3).

### 4.3 Probes for what is not baked

Tapes are unlit sprites and stay so. Avatars, pedestals, the cut-plane
handle, hands, the tub trees and the orchard trees are lit at runtime, and
today by the fallback hemisphere light. Two probe sets per room ride
beside the lightmap:

- **Irradiance probes**, `probes.json`: L2 spherical harmonics (27 floats)
  on a 2 m grid at 1.6 m, e.g. 7 × 10 = 70 for the hall, 8 KB. Baked by
  rendering a 32² cubemap at each point (about 1 s each at 64 samples,
  70 s per room). The client takes the nearest probe (trilinear later) as
  the ambient term for anything dynamic in that room; cells use a 10 m
  grid.
- **One reflection probe** per interior room at its centre, 1.6 m up: a
  6 × 256² cubemap at 256 samples (about 2 min), UASTC, 0.4 MB, 128² on
  Quest, none on the phone (the sky PMREM stands in). It is what makes the
  gilt and the polished floor read; a diffuse lightmap alone leaves them
  dead. world-engine's lens (M5) asked for "the far room as a baked
  cubemap": the same probe, taken at its doorway instead, is that.

### 4.4 What changes for exteriors

The sun dominates, so 256 to 512 samples converge where interiors need
1024; the atlases are bigger and coarser; leaf cards need
`transparent_max_bounces` 8 in the orchard bake, which is the one cost
to calibrate. Trees are not in any atlas (3.3). The far ring and the tree
cards are Cycles renders, not bakes. The one runtime light exists only
outside and only on tree materials. Nothing else in the world is lit at
runtime, which is the rule the hall set and the reason the Quest budget
holds.

## 5. Geometry strategy

### 5.1 The generator

`grove/tools/palace/`, a Python package run inside Blender 4.2 exactly as
`bake_hall.py` is, and grown out of it (its `Build`, `build_wall`,
`reveal`, `make_uvs`, `bake`, `write_lightmap_png`, `add_markers`,
`patch_glb_extras` and the record layout carry over unchanged in spirit).
Its input is `mansion.json` itself: bounds, doorways and spawn are the
contract, and each room carries a `palace` block the client ignores
(`RoomSchema` is a `looseObject`, so it passes):

```json
"palace": {
  "type": "state-room",
  "windows": {"wall": "-x", "bays": 3, "width": 1.6, "sill": 1.6, "head": 5.6, "reveal": 0.35},
  "order": {"pilasters": true, "bay": 4.0, "capital": "kit/capital-ionic-a"},
  "ceiling": {"type": "cove", "rise": 0.6},
  "floor": "parquet",
  "cornice": {"z0": 5.55, "z1": 5.85, "proud": 0.12},
  "wainscot": {"h": 1.1, "proud": 0.06},
  "doors": {"depth": 0.45, "surround": "kit/supraporte-b"},
  "bake": {"res": 2048, "phone": 1024, "samples": 1024},
  "acoustics": {"walls": "stucco", "floor": "parquet"}
}
```

Modules and what each emits:

| module | does | emits |
|---|---|---|
| `plan.py` | reads mansion.json, checks that shared walls agree (both rooms list the doorway, `at` on both bounds), that no two rooms overlap, that every enfilade door is on its line | a report; refuses otherwise |
| `build.py` | walls as stepped profiles with holes and reveals (WP3's), cornice and wainscot by sweeping a profile along the perimeter, coffers or coves, pilasters on the bay rhythm, door surrounds and window surrounds as kit instances, the facade from the same window list, the greenhouse's iron lattice | one object per room and per cell, uv0 at 1 unit = 1 m, uv2 packed per object |
| `grounds.py` | terrain planes, parterre pattern, hedges, basin, balustrade, tree scatter with a seeded RNG, far ring camera | the cells' objects, `orchard.json` transforms, the ring panorama |
| `trees.py` | Sapling parameters for three cherry variants, LOD decimation, vertex AO, card render | `tree-<v>-lod<n>.glb`, `tree-cards.ktx2` |
| `bake.py --room` | the hall's bake per object; probes; the reflection cubemap; KTX2 tiers | `lightmap*.ktx2`, `probes.json`, `reflection.ktx2`, `<room>.json` record |
| `export.py` | glb per room with markers, meshopt, extras with the full record; the phone glb with ornament simplified to 25 % (same uv2, same lightmap) | `<room>.glb`, `<room>-phone.glb` |
| `visibility.py` | section 6.3 | `visibility.json` |
| `audio.py` | section 6.1 | `ir.opus`, `audio.json` |
| `verify.py` | `verify_hall.py` for every room: markers, bounds against mansion.json, uv2 on every primitive, digest agreement, gilt under 2 %, triangle counts under budget | `VERIFY OK` |
| `stills.py` | the contact-sheet cameras, Cycles renders at 1280 × 720 | `docs/img/palace-*.png` |

Ornament comes from a **CC0 kit**, `grove/tools/palace/kit/`: capitals,
a Supraporte crest, a balustrade baluster, an urn, a console. Each piece
is decimated to under 1,000 triangles, carries a sidecar
(`<piece>.json`: source URL, licence, the file's sha256, what was changed),
and is merged into its room's mesh with its own uv2 island so it bakes
like the wall it stands on. Nothing in the kit is a whole room; the
generator decides where every piece goes.

### 5.2 Budgets per device tier

| | Quest 3 browser, 72 Hz (the floor) | phone (iPhone Safari, mid Android) | desktop (the ceiling) |
|---|---|---|---|
| frame | 13.9 ms | 16.7 ms at 60 | 16.7 ms |
| triangles per frame | 350k | 200k | 2M |
| draw calls per frame, both eyes | 120 | 80 | 400 |
| resident textures | 96 MB | 64 MB | 512 MB |
| download to the first view | 12 MB | 8 MB (20 MB is M0's ceiling) | – |
| lightmap tier | 2048² UASTC | 1024² UASTC | 2048², 4096² for the big atlases |
| room glb | full | `-phone` (ornament at 25 %) | full |
| video decoders | 1 | 1 | 1 (the rule, not the hardware) |
| tapes resident | current room + neighbours | current room | current + neighbours |
| pixel ratio cap | 1.0 | 1.5 | 2.0 |

A room's own mesh must stay under 40k triangles on the full tier (the hall
is 660 today; a state room with 8 pilasters, 6 capitals, 3 surrounds and a
cornice profile lands near 20k) and under 12k on the phone glb. The view
from the hall's spawn on Quest, counted: sky 1, hall 5 primitives + 3
ornament materials, poster 1, grounds 4, hedges 1, orchard ground 1, trees
9, facade 2, far ring 1, moon 1, einstruct through the door 8 + its two
sheets 2 + two walls 2, avatars up to 24: about 65 draw calls, and about
90k triangles before the trees, which from the terrace are all LOD1 and
LOD2. The measurement that matters is BACKLOG 3, the hardware pass;
everything here is arithmetic until a Quest has run it.

### 5.3 The grey box keeps working

Every room keeps `bounds`, `doorways`, `fallback` and its hangings'
literal positions, so a room whose glb is not there yet, or fails to load,
is the grey box it is today, with real holes where its doorways are
(`proceduralRoom`). Three small additions to `rooms.ts`: a fallback
`kind: "ground"` for cells (a floor plane, no walls, no ceiling; walls
only where a doorway is `closed`), the `closed` flag drawn solid, and
markers read by role for `window_*` and `vantage_*`. The palace lands one
room at a time, each first as a box at its final place, then baked, and
the client never waits on a bake. The hall's markers stay the authority
over `mansion.json`'s copied metres (WP2's rule), which the migration in
2.4 relies on: the four new doorways are read out of the rebaked glb.

## 6. Sound and the visibility map

### 6.1 Room acoustics, baked as data

Every room is a shoebox, so its impulse response can be computed rather
than recorded: `audio.py` runs pyroomacoustics' image-source method (a
shoebox `Room` with per-wall absorption, randomised image positions
against sweeping echoes) with the same bounds and a material table, and
writes a mono 48 kHz IR trimmed at −60 dB as `ir.opus` beside the
lightmap, plus `audio.json` with the RT60 per octave it measured, the
absorption table and the source and receiver positions used. Sabine says
what to expect, with open apertures counted as fully absorbing:

| room | volume | absorbing area | RT60 |
|---|---|---|---|
| hall, marble and stucco, 6 windows and 4 doors | 1,960 m³ | ~92 m² | 3.4 s |
| state room, parquet, 3 windows, 2 doors | 1,008 m³ | ~66 m² | 2.5 s |
| Planet Room, walls hung with velvet (α 0.5) | 1,176 m³ | ~200 m² | 0.9 s |
| orangery, stone, 9 open arches | 3,528 m³ | ~180 m² | 3.2 s |
| cells | – | – | no reverb; a 0.2 s early reflection off the facade for the terrace |

The client: one `ConvolverNode` per room that is current, fed by a room
send bus, 4 s IRs on desktop and 2 s on Quest and phone (the convolver's
cost is the IR's length; one 2 s convolver is about 2 % of a mobile core).
Sends: exhibit sound (the one video wall) −6 dB into the room, voice
−12 dB (a 3.4 s hall would swallow speech at full send; real marble halls
do), ambience dry. Ambience per room and cell is a 30 s Opus loop under
300 KB with a provenance sidecar: `hall-quiet`, `birds-far` inside on the
garden front, `birds-near` and `fountain` (a point source at the basin) on
the terrace, wind in the orchard cells.

**Occlusion is the room graph.** A neighbour's bus is heard through each
shared doorway as a point source at the doorway's centre, attenuated and
low-passed by the aperture: a 2.4 × 3.2 door −6 dB and 4 kHz, an open
window −9 dB and 2.5 kHz, a closed door −24 dB and 800 Hz, an open cell
edge 0 dB with no filter; two hops sum. Those four numbers are a first
guess to tune by ear and live in `visibility.json` next to what they
describe. Voice is not carried through doorways: presence is scoped to
the room by the module's views (DECISIONS, "the grove's people are
private"), and the audio follows the data.

Spatial voice (M1, Cloudflare Realtime): each peer track through a
`PannerNode`, HRTF on desktop, equal-power on Quest and phone with HRTF
for the 6 nearest, distance model inverse with a 1 m reference and a 20 m
cut, a 24-voice room mixed down to one bus.

### 6.2 What plays

The existing rules stand and the map only decides scope: the one decoder
goes to the nearest video wall **in the current room**; walls in
neighbouring rooms seen through a door stay posters. One transport drives
every tape that is resident. Ambience crossfades over 1 s on a doorway
crossing; the convolver swaps IR on the crossing with a 0.5 s tail.

### 6.3 The visibility map

`visibility.json`, at the mansion level, generated by `visibility.py` from
the same scene the bake used, is the one structure the loader reads:

```json
{
  "schema": "orchard/visibility/1",
  "rooms": {
    "hall": {
      "adjacent": ["einstruct", "phototroph", "terrace", "greenhouse"],
      "sees": {"einstruct": 0.61, "world-engine": 0.12, "orangery": 0.04,
               "phototroph": 0.55, "gallery": 0.09,
               "terrace": 1.0, "parterre": 0.97, "orchard-south": 0.9,
               "orchard-west": 0.31, "orchard-east": 0.28},
      "hears": {"einstruct": {"db": -6, "lowpass_hz": 4000},
                "terrace": {"db": -9, "lowpass_hz": 2500}},
      "ambience": ["hall-quiet", "birds-far"],
      "reverb": "assets/palace/hall/ir.opus"
    }
  }
}
```

`sees[b]` is the fraction of eye points in room a (a 1 m grid at 1.6 m)
from which any part of room b is visible through a chain of apertures
(doorways and windows are rectangles on axis-aligned planes, so the test
is a projection of rectangles, no ray tracing needed; cells with open
edges see each other fully). `adjacent` is the doorway graph.

What the client does with it, per room, relative to the visitor's room:

| relation | shell + lightmap | stills | tapes | video | probes, IR | ambience |
|---|---|---|---|---|---|---|
| current | full tier | yes | streaming, on the transport | decoder to the nearest wall | loaded | playing |
| adjacent | full tier | yes | resident (Quest, desktop), poster quads on the phone | poster frame | probes only | through the doorway |
| seen, `sees` ≥ 0.25 | full tier | yes | poster quads (the bundle's poster on the tape's box) | poster frame | no | no |
| seen, `sees` > 0 | **phone tier** lightmap, full glb | poster thumbs | nothing | nothing | no | no |
| not seen, graph distance ≥ 3 | disposed (GPU resources freed, bundle.json kept) | disposed | disposed | disposed | no | no |

The phone-tier lightmap for a room seen only through a 2.4 m opening 30 m
away is the one trick worth naming: it halves the resident texture memory
on the garden front. Loading order on entry is adjacent first, then seen
by descending `sees`, then nothing; on a doorway crossing the sets are
recomputed and only the difference is fetched or freed. Resident tape
chunks stay at 3 per tape (5.8 MB on the VR tiers), so a hall visitor
holds einstruct's two sheets and phototroph's one and no more.

The grounds are the exception that proves the table: from every
garden-front room `terrace`, `parterre` and `orchard-south` are seen at
0.9 or better, so their atlases and the tree LOD1/LOD2 sets are resident
whenever the visitor is on that front, which is the whole point of the
windows. From the Planet Room and the cabinets they are not, and they
unload.

## 7. Milestones

Stills gate every bake (LAWS 14, 15): options as PNG, one contact sheet,
a ruling, then the lane, which here is the CPU under `exprun` and never
the GPU. The hall bake proved the CPU fits: 13 minutes for a room at
1024 samples. A whole palace is a few hours of CPU spread over evenings
and, if wanted, half of it on Legion's cpu lane through `lanepush`, since
every room bakes independently once the scene builds. OptiX would do it
in about a tenth of the time, and the lane is worth more than that.

| stage | what is ruled on | what is built | CPU (16 threads) | GPU |
|---|---|---|---|---|
| **P0 first look** | one contact sheet, 12 stills 1280 × 720 at 256 samples, denoised, in a 4 × 3 grid: (1) the hall with the French doors and the orchard through the windows, (2) the enfilade from the spawn, (3, 4) the terrace looking back at the facade, limewash and Schönbrunner Gelb, (5, 6) the parterre and orchard from the terrace in blossom and in fruit, (7) inside the orchard rows, LOD0, (8, 9) the west sky with and without the moon, (10, 11) the orangery charcoal and limewashed, (12) the Planet Room with the trio as placeholder spheres | the generator's `plan`, `build`, `grounds`, `trees`, `stills`; no bake; no client change | 15 to 25 min (about 70 s per still at 3.3 M samples/s) | 0 |
| **P1 the hall and one room** | the hall rebake preview and einstruct's preview, each as a `preview.png` from the spawn as WP3 did | hall rebaked with 4 new openings, palette unchanged, in the full scene; einstruct baked; `mansion.json` migrated per 2.4, the other rooms as grey boxes at their palace places; client: `SKY_RADIUS`, `closed`, `kind: "ground"`, window and vantage markers, `variant` override | 13 + 12 min, plus 5 min of previews | 0 |
| **P2 the grounds** | a second sheet: the terrace at eye height, the parterre from the basin, the orchard at three depths, the far ring | facade, terrace + parterre, orchard ground, trees with vertex AO, cards, far ring, `orchard.json`, the moon hanging, the sampled sky; client: instanced LOD trees, the one directional light, the cells; then **the Quest hardware pass** (BACKLOG 3) on this build, which decides the tree budget | 60 to 90 min | 0 |
| **P3 the rest of the palace** | previews per room | world-engine, phototroph, spectre's Planet Room, the greenhouse, the gallery, the orangery with 8 empty niches, three closed cabinet doors and someotherlife's; `init` seeds the room rows | about 2.5 h (4 rooms at 10 to 12 min, 2 big atlases at 26 min, greenhouse 3 min) | 0 |
| **P4 sound and the map** | none (listened to, not looked at) | `audio.py`, `visibility.py`, the loader and the audio graph | under 15 min | 0 |
| **P5 probes and gilt** | one still per room, gilt on | irradiance and reflection probes, the PMREM sky, avatars lit by probes | 45 min | 0 |

About 5 CPU hours of bakes and renders in all, half of which could run on
the peer's cpu lane, and no GPU lane at any stage. Each bake is launched
with `EXP_NAME`, `EXP_PRIO` and `EXP_LOG` set and waited on with
`exp wait --done-when 'BAKE OK'`, as the hall's record shows; a bake is
under 30 min and is prio 5, a still sheet is prio 10. Records: every asset
carries `asset.extras.orchard` with the script sha256, the Blender version,
the git commit, the bake settings and timings, and the same record as
`<room>.json` beside it, so that a rebake is the same command again.
Contact sheets go to `docs/img/palace-<stage>-<date>.png` and the ruling
into DECISIONS.

Where the room assets live: today in `grove/public/assets/hall/`, shipped
with the Pages deploy. At 27 MB of lightmaps plus meshes the palace should
not redeploy with every client change; the plan is a `room` bundle kind
(`orchard bundle room <dir>`: glb, tiers, probes, IR, record, content-
addressed like every other bundle, on R2), with `mansion.json`'s room
naming `bundle: {"id": ...}` the way a hanging does. P1 ships from
`public/` as the hall does; the bundle kind lands with P3, when there are
ten rooms to move.

## 9. As built (2026-09-13)

Manuel ruled the look on the evening of 2026-09-12 ("white and gold and
marble, like the Naturhistorisches Museum; choose yourself; build the
entire scene"), so the six questions of section 8 were answered by
delegation (DECISIONS 2026-09-12) and `grove/tools/palace/palace.py` built
the plan above in one evening. Where the build departs from the spec:

- **Walls stand 10 cm inside their bounds** (`WALL_HALF`): two rooms
  sharing a plane had coplanar faces that shadowed each other black in the
  bake, so each room's faces sit 20 cm apart (a wall that thick) and every
  doorway carries a 10 cm reveal on each side, meeting at the bounds plane.
  The first build stood them 10 cm *outside*, which put each neighbour's
  side walls, floor strip, wainscot and cornice 20 cm into the next room
  along every shared plane (Manuel saw the room behind sticking through the
  wall, 2026-09-13); every room's geometry now lies within its own bounds
  and `palace.py --check` verifies it before lane time is spent. Pilasters
  keep clear of every still and video wall in the plan.
- **A doorway's reveal belongs to one room** (2026-09-13, afternoon): the
  first cut gave each side a 10 cm half meeting at the bounds plane, which
  put a seam from two bakes down every jamb. Now the room whose wall is
  the +x or +y face runs the full 20 cm and the other builds none; on the
  garden front the room runs its doors and windows to the facade's outer
  plane at -7.5, the facade only cuts the holes and dresses them (frames
  built without backs, in absolute coordinates: the first facade read
  wall-relative numbers as absolute and hung every frame 58 m along), and
  the terrace's ground stops at the facade's face so floor-level openings
  have nothing to fight. A window to the floor gets a threshold, not a
  bottom reveal.
- **`--check` finds face collisions before a bake** and `bake_all.sh`
  refuses to queue without it: every room's raw quads in world space,
  reported as same-plane overlaps (a z-fight, and a black patch in the
  bake), faces piercing other faces (two bodies sharing volume: the hedge
  corners were four overlapping boxes with their inner corners in the
  basin, the balustrade's rail ran through its piers, corner pilasters met
  by 2 cm), and anything of the facade in front of an opening. The walls'
  laps into floor and ceiling and a card tree's crown through its trunk
  are whitelisted as the design. The wainscot stops where a door surround
  stands, and every proud strip cuts a vertex at the other insets so the
  T-junctions weld (the greenhouse's line of sky at the cornice).
- **Ambient occlusion**, ruled 2026-09-13: a Cycles AO pass (128 samples,
  1 m) on the same UVs, multiplied into the lightmap at 0.4 before
  normalisation; `ao.png` and the strength sit in the record, so another
  strength is a recomposition, not a bake. Per-material lightmap statistics
  (mean, p10, p90 at each face's centre) are logged and recorded, and a
  material whose p10 is under 3 % of the white point is flagged DARK.
- **No runtime lights in a baked room**: the client used to add a
  hemisphere and a key per room at low intensity, and lights are global,
  so the marble collected one highlight per loaded room. One scene-level
  hemisphere keeps pedestals and avatars visible; the marble's roughness
  is 0.35 for the probe to come; lightmaps use their KTX2 mip levels;
  `?debug=overdraw` shows doubled and hidden faces as brighter patches.
- **Interior fill lamps and a per-room exposure** (2026-09-13): the sun
  and sky through the windows left every underside (the gilt cornice bead,
  the capitals) at a fifth of the floor's light, black after AgX, so each
  interior room hangs warm 400 W point lamps, one per 8 m along its long
  axis at 0.55 of its height (a probe at 300 and 900 W chose the value).
  One sun bakes the whole palace, so the grounds carry about six times the
  hall's light: `mansion.json` gives each room an `exposure` (grounds 0.2,
  orangery 0.6, the rest 1) and the client's eye adapts toward it over
  about a second on crossing. Mouldings run through the corners without
  cap pieces and walls lap the floor and ceiling planes by 5 cm, so the
  T-junction hairlines show wall, not sky.
- **The materials are the museum's, not the gallery palette**: cream
  stucco, a red-brown marble wainscot, grey-white marble dressings a step
  below the wall so the order reads, gilt capitals, crests and the
  cornice bead, an inlaid marble floor in the hall and gallery, parquet in
  the state rooms, stone in the orangery and greenhouse, near-black in the
  Planet Room. Every texture is value-noise marble generated in the script
  and embedded as a JPEG.
- **Trees are card trees, not Sapling**: no tree add-on ships with this
  Blender. Three crossed 4.6 m cards with a generated crown texture and
  small dark cherries, an eight-sided trunk, a per-vertex sun term, exported
  unlit and alpha-masked (the exporter writes emission as black PBR, so the
  glb's materials are patched after export). About 370 trees on a 7 m grid
  with jitter, merged per cell: one draw call per cell.
- **The facade is one wall with a flat slate roof**, stone surrounds, a
  string course and a parapet band; no hipped roof, no rustication.
- **Cells bake at 4096² (terrace, parterre) and 2048² (orchards)** with
  the whole palace as occluder; the hall and rooms at 2048² and 512
  samples, the gallery and orangery at 4096² and 256.
- **The client loads rooms by neighbourhood** (two open doorways, and every
  cell as soon as one is in), grows on each crossing, and does not unload
  yet; closed doors, ground cells, a tape `variant` override for the moon
  and a 400 m sky dome landed with it.
- Not built yet from sections 4.3 and 6: probes, the reflection cubemap,
  the impulse responses, `visibility.json`, the far ring, the `page` kind.

## 8. Open questions for Manuel

1. **The facade**: Schönbrunner Gelb, or a grey-white limewash like the
   Belvedere? The sheet shows both from the terrace. Recommended: limewash,
   because the gallery palette inside and an ochre outside will fight in
   every window.
2. **The season**: blossom (white, April) or fruit (dark red Weichseln,
   late June)? One texture swap, but the trees, the grass and the sky are
   baked for one of them. Recommended: fruit, the namesake.
3. **The moon by day**: chi12 over the west orchard under a 33° sun, or not
   until there is a night sky? Shown both ways.
4. **The hall's French doors**: the two central windows taken to the floor
   (a rebake of the ruled hall, the palette unchanged), or the terrace
   reached only through the orangery's arches? Recommended: the doors; the
   orchard should be three steps away from the spawn.
5. **The orangery**: charcoal like the rest, or limewashed as the one light
   room? Shown both ways; no recommendation, it is a taste call.
6. **Closed doors for unearned rooms** (second wave, someotherlife) rather
   than grey boxes: yes or no? Recommended: yes.

References used for scale: Schönbrunn's Great Gallery is 43 m long and
almost 10 m wide, its Orangery 189 m by 10 m (schoenbrunn.at); this
palace's gallery and orangery are 36 by 14, its front 128 m, about two
thirds of the model, which is what a 24-visitor room and a 2048² atlas
want. pyroomacoustics: LCAV, MIT licence, shoebox rooms by the image-source
method with Sabine-derived absorption.
