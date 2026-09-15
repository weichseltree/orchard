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
| The Observatory | Which question draws you in? | Arrival, guide and routes into the chambers |
| The Mixing Chamber | When do two kinds stop mixing? | An annihilation tape beside its shuffled control; two video panels |
| The Gravity Chamber | How does a world find its middle? | Three heavy/light mixtures with different interaction strengths; a silent excerpt |
| The Binding Chamber | What lets two atoms stay together? | One recorded three-body capture |
| The Reconstruction Gallery | What does a new viewpoint reveal? | Three still studies of a classroom reconstruction and its limitations |
| The Lantern Walk and Long Gallery | Space between questions | Architecture and open routes |
| Terrace, Meridian Garden and three groves | Pause and explore outside | Designed grounds; the armillary at the garden's crossing is the portal to the Orrery |
| The Orrery | How does a world find its middle, seen at the scale of the sky? | spectre's three cutaway worlds with their measured surfaces, eighty metres across, on a star field |
| The Workshop | Host space | Behind a closed door; absent from visitor routes |

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
as globes a metre and a half across inside the armillary. Walking in, the
far view fades over the near one while that camera's scale slides from the
ratio to one; at the sphere's core the body steps through, keeping its
offset, and the far end stays quiet until the visitor has walked clear of
it, so nobody bounces back. A portal can be crossed only from the room and
the scale it was built for: the schema requires the two rooms to differ in
scale and both ends to lie inside their rooms, and `crossPortal` refuses a
body whose scale is not the end's. Rooms of one scale are drawn together;
the other scale is visible only through a portal.

Stated limits: the far view is not rendered while a headset session
presents (the sphere is then a plain shimmer and the fade still happens);
the far view is tone-mapped as a whole, so exhibits seen through it are
graded once where they are not graded directly; the surface stream is
34 MB on the wire and 74 MB decoded, fetched when the worlds first play,
and no phone or headset measurement exists yet; the display modes
(species, temperature, pressure) are bundled but no control switches them;
the planet has no time slider, only play and pause (Space).

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

The world check captures all 14 rooms at native 1600 × 900 resolution,
records cameras and image hashes, checks the shell and draw-batch budget,
waits for every synthetic tape to upload a frame, and detects legacy asset
downloads and browser errors. Playback stops before each camera is rendered
once for inspection; this is not a frame-rate benchmark. Interaction and
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
