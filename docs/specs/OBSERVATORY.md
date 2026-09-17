# The Observatory

Current world design, 2026-09-14. This replaces the Austrian palace direction
in [PALACE.md](PALACE.md), following the brief to rethink and replace the
entire palace and improve its content and visual impact.

The Observatory is a nocturnal museum for looking closely at research.
Mineral walls, layered stone portals, brass inlays and illuminated vaults
frame the exhibits. A suspended fixture anchors the arrival hall. Open
clerestories and a colonnaded terrace connect it to a twilight garden. The
faceted grove sculptures and garden armillary are designed architecture.

## A visit begins with a question

| Place | Question or purpose | Available content |
| --- | --- | --- |
| hall | Which question draws you in? | Arrival, guide and routes into the chambers; coarsen's first film on the east wall, looping at a quarter speed |
| einstruct | When do two kinds stop mixing? | An annihilation tape beside its shuffled control; two video panels |
| phototroph | What lets two atoms stay together? | One recorded three-body capture |
| world-engine | What does a new viewpoint reveal? | Three still studies of a classroom reconstruction and its limitations |
| orangery | Space between questions, and a game | Architecture, the three terrace arches, and the chess table at the far end, where the FTL Chess surface opens (ruled 2026-09-16: moved here out of the Long Gallery, then given its table) |
| gallery | Space between questions | Architecture, statuary and open routes; its closed doors are the trees without rooms; a broad stair climbs to the Belvedere at its end |
| belvedere | The long view back | A raised platform over the gallery; closed doors for neuralese and someotherlife |
| terrace, garden and the three groves | Pause and explore outside | Designed grounds; the armillary at the garden's crossing is the portal to the Orrery |
| orrery (coarsen's room, through the garden's armillary) | How does a world find its middle, seen at the scale of the sky? | spectre's three cutaway worlds with their measured surfaces, eighty metres across, on a star field |
| workshop | Host space | Behind a closed door; absent from visitor routes |

The guide gives concrete observations and limits for each research chamber.
Sources, species meaning and controls are in disclosures. Routes use only
rooms reachable through open doors; links retain local-demo mode.

The local demo uses synthetic playback fixtures. Its companion text explains
this and suppresses scientific species legends. One atomic capture does not
demonstrate equilibrium, and a heavy centre does not establish that unmixing
caused it. [EXHIBIT-PLAN.md](../EXHIBIT-PLAN.md) retains the research reports,
unresolved questions and provenance. No new research artefacts were published
to fill the rooms.

## The Orrery and the portal

Added 2026-09-15. The floating "moon" over the terrace (spectre's chi 12
tape as a 36 m point cloud, BACKLOG 33) is gone. In its place the Meridian
Garden's armillary is a **portal** to **the Orrery**, a room at another
scale: its metre is a fiftieth of the palace's (`scale: 0.02` in
`mansion.json`), it is built in space (`architecture: "space"`, a hashed
star field and a landing ring, `space.ts`), and it holds spectre's planet
cutaway (`orchard/planet.py`, bundle `26f78b7516170d6d`): the chi 0, 6 and
12 worlds at 40 m radius, each with its removed quarter turned toward the
landing, textured by the beauty atlas video (`1207b7952ce09923`) and moved
every tape frame by the measured surface stream (`planet-exhibit.ts`).

A portal is a blending of two spacetimes, not a plane with a frame
(`portal.ts`, `PortalSchema`). Each end is a soft sphere (4.5 m here). From
outside it is an edgeless window: the far room is rendered live from a
camera standing where the visitor's eye would stand over there, its offset
from the far end multiplied by the scale ratio, so the Orrery's worlds show
as globes a metre and a half across inside the armillary. Its near and far
planes carry that same ratio, never less than this room's range: a far
camera a thousand metres out behind the palace's own six hundred sees
nothing at all, which is what left the Orrery an empty universe through the
armillary until 2026-09-17. The Orrery's star dome was shortened to 320 m
the same day, for the other half of that sum: at 560 m its far wall passed
the eye's range and a starless hole opened in the sky whenever the visitor
looked back across the room. Walking in, the
far view fades over the near one while that camera's scale slides from the
ratio to one; at the sphere's core the body steps through, keeping its
offset, and the far end stays quiet until the visitor has walked clear of
it, so nobody bounces back. A portal can be crossed only from the room and
the scale it was built for: the schema requires the two rooms to differ in
scale and both ends to lie inside their rooms, and `crossPortal` refuses a
body whose scale is not the end's. Rooms of one scale are drawn together;
the other scale is visible only through a portal.

Ruled 2026-09-16: no more point clouds for spectre. The Gravity Chamber's
three tape hangings are replaced by the same planet bundle at 1.5 m radius,
each world cut toward the doorway side, and the four atlas modes have a
control: buttons with the current mode's legend where the scrubber would
be, and C cycles them. A switch changes the video's source under the same
texture, measures the new stream's clock origin afresh and seeks back to
the frame the visitor was on (`PlanetExhibit.setAtlas`).

Ruled later on 2026-09-16: the Gravity Chamber is gone. coarsen's room is
the Orrery, reached through the garden's armillary, and the Guide's suggested
sequence follows the portal there. The chamber's doors from einstruct and
world-engine are wall again. Its film hangs in the hall on the east wall in
place of einstruct's styleframe, looping at a quarter speed (`playbackRate`
on a video hanging; Firefox goes no slower). The FTL Chess surface has a
place: a table at the far end of the orangery (`position` on a game
surface), offered when the visitor stands at it, G on a keyboard.

Stated limits: the far view is not rendered while a headset session
presents (the sphere is then a plain shimmer and the fade still happens);
the far view is tone-mapped as a whole, so exhibits seen through it are
graded once where they are not graded directly; the surface stream is
34 MB on the wire and 74 MB decoded, fetched when the worlds first play,
and no phone or headset measurement exists yet; the planet has no time
slider, only play and pause (Space); a mode switch re-buffers the video, so
it pauses for a moment on a slow link.

## Architecture and navigation

The 13 Observatory footprints retain their room IDs, presence IDs, ground plane and
connections. Existing room URLs remain useful. Axial interior portals are
now 4.8 m wide and 4.6 m high, opening the view through the building. Two
end-wall media panels were resized and moved clear of those surrounds.
Navigation retains body and shoulder clearance. Tests probe both usable
apertures and the actual architecture meshes.

Every Observatory room selects `architecture: "observatory"` in
`grove/src/world/mansion.json`; the Orrery selects `"space"`. `observatory.ts` builds real geometry using
instanced primitives, shared materials and a small procedural stone shader.
Light pools and surface washes are designed shading, not a physical lighting
simulation. Scientific tape, still and video materials remain independent.
One hemisphere and one shadowless key light pedestals and avatars. Every
room uses exposure 1, including the grounds.

The architecture needs no room GLBs, lightmaps, texture downloads, bloom,
dynamic shadows, external scenery services or remote fonts. The sky is an
authored gradient with its artificial sun disc disabled. The original asset
loader remains available for legacy scene documents.

## Evidence and reproduction

From `grove/`:

```bash
pnpm quality
pnpm quality:browser --screenshots
pnpm quality:world --screenshots
```

The world check captures every station at native 1600 × 900 resolution,
records cameras and image hashes, checks the shell and draw-batch budget,
waits for every synthetic tape to upload a frame, and detects legacy asset
downloads and browser errors. Playback stops before each camera is rendered
once for inspection; this is not a frame-rate benchmark. Since 2026-09-17 it
also stands at the garden's spawn and photographs the armillary: taking the
Orrery away must change the lens, and the far view's own target must hold
star points far above its sky, centred on the portal's axis, rendered for
that photograph. The sky alone is no evidence — a cleared target carries the
page's own background at about the luminance the Orrery's sky has (23 against
17), which is how the first draft of the check passed a clipped far view. Interaction and
production-transfer checks are separate; see [QUALITY.md](../QUALITY.md).

The site hero is a lossless encoding of an actual local-demo browser capture
with controls hidden. `grove/public/site/imagery.json` records its source.
No generated image stands in for scientific footage. Browser checks use
Chromium with SwiftShader. Quest and iPhone hardware acceptance remains open.

The old scene is preserved at
[archive/palace-2026-09-12.json](archive/palace-2026-09-12.json), alongside the
former design records, bake tooling and camera baselines. The legacy baker
reads that archive. Its assets stay out of the current build because the
current scene no longer references them. New captures do not overwrite the
old visual baseline.

## The palace, second pass (2026-09-16 evening)

Manuel's brief: the portals as a bigger feature with better shader work,
smoother transitions and intent detection; einstruct in its own room and
every tree room named after its repository; museum text on the walls in the
visitor's language; a proper palace with bigger rooms, more objects, stairs
and terrain. Built on `weichseltree-palace-portals`; DECISIONS 2026-09-16
records the rulings.

**The plan.** The hall is 20 × 24 × 9 m. The enfilade runs north from it
up a 6 m grand flight to the raised north wing (world-engine, then the
Lantern Walk) 1.5 m above the hall. einstruct is a 16 m cabinet of its own
off the hall's east wall, coarsen's cabinet north of it with a door on to
world-engine, so the research rooms form a loop. phototroph and the Long
Gallery run south; the gallery is 34 m long with statuary between its
closed cabinet doors and a broad stair at its end up to the Belvedere,
1.8 m above, whose closed doors are neuralese and someotherlife. The
terrace keeps its colonnade and gains a balustrade with urns along the
garden edge; the Meridian Garden is sunk 1.6 m below it and reached by
three garden stairs, its four quarters edged in box hedge, a basin under
the armillary, lanterns along the axis and obelisks at the corners. The
three groves roll over authored mounds, up to 3.4 m, with rows of grove
sculptures and lanterns. Room titles: einstruct, coarsen, world-engine,
phototroph; the circulation rooms are plain words (hall, orangery, gallery, belvedere, workshop, terrace, garden, the groves, orrery) and the world is titled weichseltree: Manuel's ruling of the same night, "bare repo names; it should be a local map of the internet" (ids, presence names and links unchanged, NAMING.md's rule).

**Heights.** A room's floor is its `bounds.min[1]`; a doorway joining two
floors gets a flight of steps in the lower room, generated from the
doorway alone (`terrain.ts`: rise 0.16, tread 0.29, half a metre of margin
each side with cheek walls, a rail and a newel lamp), so stairs are never
authored, only floor heights. The body has a height (`locomotion.settle`),
the rig rides it, poses carry it, and a body on a flight cannot step off it
sideways. The grounds are `terrain.mounds` in mansion.json, compact
quartic bumps that are exactly zero beyond their radius, so a mound placed
clear of a doorway never lifts it; one function stands under the ground
mesh, the trees and the feet. The schema now refuses a doorway that only
one of its two rooms lists.

**Wall text.** Every room carries an entrance panel by the doorway a
visitor most likely enters through (title, the question, an introduction,
what to look for, one honest limit) and every hanging a label (title,
caption, a credit line with the repository and bundle id). The copy lives
in `grove/src/world/labels/<lang>.json`, chosen from `navigator.languages`
with `?lang=` overriding and English as the fallback; the plaques are
canvases on meshes (`labels.ts`), the same path the in-world notices take,
so they read in a headset too. German is written, not translated; other
languages are translations of the English file and say so in their credit.

**Portals.** See `portal.ts`: the sphere now estimates the visitor's
intent (closing speed, gaze, dwell) and lets it shape the blend and the
crossing threshold; the far view's resolution rises as the blend deepens;
a crossing dissolves through an afterglow of the room left behind rather
than cutting; the shader refracts and disperses the far view at the rim and
shimmers where it holds no view. The far view still stops at one level (no
portal inside a portal) and is not rendered while a headset presents.

Stated limits: the steps are drawn to the body's ramp within one riser, so
the eye glides rather than hops; there is no second floor over a first
(height is a property of a point); the balustrade and hedges are solid to
the eye but not to the body (the AABB clamp is the fence, as before); no
phone or headset frame measurement exists for the larger rooms yet.

## The palace, third pass (2026-09-16 night): doors, names, stands, light

**Sealed doors.** A closed doorway (`closed: true` in mansion.json) is an
aperture like any other: the wall's piers, panels and sconces stop at it.
Behind it stands a dark recess with a reveal, and over the recess a brass
halo round a shallow lens (`sealedLens` in sealed.ts, shared with portal.ts and the light bake) that the portal
system draws with the portal shader, no far view, blend zero, a dimmer
tint (`SEALED_TINT`): a portal not yet lit. One shared material, one
shared cap geometry; the lens is visual only, navigation treats the door
as closed as before.

**Door names.** Every doorway with surrounds carries the title of the room
beyond in brass letters on its lintel (door-signs.ts): the visitor's
language from the wall text, the repository name where a room has no wall
text yet (the sealed doors), the identifier when the typeface cannot set
the title (Japanese). The letters are extruded from Cinzel
(`fonts/cinzel.json`, SIL Open Font License, made by
`grove/tools/typeface.py`, ~52 KB gzipped, loaded on the first room's
signs), two segments per curve, back caps dropped, merged into one mesh
per room, under 60k triangles for the palace.

**Reading stands.** The plinth beside a tape is gone. The tape builds a
reading stand at its near edge (tape-exhibit.ts): a brass plate over a
stem, dark on its back, a strip along its foot carrying the progress bar
and the lamp. The wall text paints the plate's face from the same frame
(stand.ts), so the two modules never see each other's meshes. Every other
plaque grew (entrance panel 1.8 × 1.35 m, labels 0.7 × 0.525 m, lecterns
0.85 and 1.1 m) and is now a brass body with a dark back a hair off it.

**Light.** The Blender bake under `grove/tools/palace` lit glb rooms the
runtime architecture replaced; it is not run for this palace. In its
place every luminous element the builder places (sconce, chandelier
halo, lantern, door inlay, cornice, obelisk crown), every portal and every
sealed lens is an emitter, and lightfield.ts bakes them at build time into
one RGB 3D texture over the palace (2 m across the floor, 1 m up, a few
hundred kilobytes): light stays in the room that holds its source and
spills through open doorways, fading. Every architectural material samples
it once per fragment over an ambient floor (0.7 indoors, 0.86 for the
grounds under the sky). The analytic floor pools and wall rhythm of the
first pass are gone; the hemisphere and key lights stay for the avatars.
The portal's cool tint on the gravel round the armillary is the effect
Manuel asked for. Cost: one trilinear fetch per fragment, no per-object
light loop, no new material.

**The portal court.** The armillary stands 12 m west of the crossing, on
the axis walk's far side from the palace: a gravel round, a water ring, a
stone dais with a brass rim, the walk crossing the water on two bridges,
four lanterns round it. The crossing itself is a gravel round with a brass
rose; the terrace's two side stairs get walks in to the cross walk; the
quarters stand back from the court and the side walks. Nothing in the
garden stands in a walk.

Stated limits: the field has no shadows and no bounce, and a lamp's power
is a design number from its size, not photometry; a doorway's spill is a
point at the doorway; Japanese door names are the identifiers; the lens
over a sealed door does not open, since no room stands behind it.

## The first area: arcedit (2026-09-16)

arcedit's authored area (TREE-AREAS.md §8; `results/grove/area.json` in
that tree, made by its `scripts/grove_area.py`) is folded into mansion.json
as eighteen rooms: an entrance corridor of 68 m by 5 m on the gallery's
east cabinet door at z 34, now open; six chambers off it; a results
corridor of 67 m with seven chambers; the grove room with its two episode
rooms, each a tape, a film and stills; and a canvas room at a tenth of the
palace's metre, reached through a portal at the corridor's far end. The
area's own frame is kept: its palace-scale rooms move by (+10, 0, +31.5)
so the entrance's west door lands on the gallery's wall, and the canvas
room keeps its coordinates, as the Orrery does, inside the ±500 m the
presence module accepts. Its eight bundles hang as approved.

What the fold changed in the area: inner doors are 2.6 to 2.75 m high so
a lintel name fits under ceilings of 3.25 m (the entrance stays 2.4 by
3.2); four hangings moved so that a still and a film never share a stretch
of wall and every label has room beyond its hanging's right edge; every
tape names its stand foot; the portal moved a metre east, clear of the
tests door. arcedit-22 was told the numbers.

Architecture: a room of an area takes its tree's finish (`finishOf`: one
entry per tree in `ROOM_FINISH`, so its rooms share materials), and a room
wider than it is deep is turned (`runsAlongX`): its vault spans the short
way, its route and its chandeliers run the long way. Corridors with three
or more doors get sconces; a chamber gets a single-tier halo hung under its
low ribs, and ribs every six metres. An entrance panel that finds no room
beside its door on a short end wall goes round the corner onto the side
wall (labels.ts). The draw, triangle and door-sign budgets now scale with
the room count: about fifteen batches and fourteen thousand triangles a
room, 200,000 triangles of door names for the world. Wall text: eighteen
rooms and nine hangings in eight languages from arcedit's
`scripts/grove_labels.py`, merged into the label files. Presence: one room
row "arcedit" for the whole area, in `SEED_ROOMS` and set live with
`set_room`.

Stated limits: rooms without hangings are architecture and prose; the
area's furniture (its shelving) is not rendered; a visitor in the canvas
room stands 400 m east at palace scale for the others in the area's one
presence room, out of sight; the generator of TREE-AREAS.md §3 to §6 is
still unbuilt, this is the authored path of §8.
