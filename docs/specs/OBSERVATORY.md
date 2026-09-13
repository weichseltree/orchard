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
| Terrace, Meridian Garden and three groves | Pause and explore outside | Designed grounds; the distant world reuses the existing spectre tape |
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

## Architecture and navigation

The 13 footprints retain their room IDs, presence IDs, ground plane and
connections. Existing room URLs remain useful. Axial interior portals are
now 4.8 m wide and 4.6 m high, opening the view through the building. Two
end-wall media panels were resized and moved clear of those surrounds.
Navigation retains body and shoulder clearance. Tests probe both usable
apertures and the actual architecture meshes.

Every current room selects `architecture: "observatory"` in
`grove/src/world/mansion.json`. `observatory.ts` builds real geometry using
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

The world check captures all 13 rooms at native 1600 × 900 resolution,
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
