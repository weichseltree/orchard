# WP3 · the baked hall

## What changed after the review (2026-09-12)

`docs/reviews/WP3-hall-bake-review.md` accepted the asset with fixes.  All of
them were applied **without re-baking** — the 21-minute lightmap is untouched and
still the shipped bytes.  The glb was patched in place by
`grove/tools/patch_hall_glb.py` (recorded in `asset.extras.orchard.post_bake_patch`
with its own sha256), and `bake_hall.py` was fixed so a future bake produces all
of it directly; a fresh `--no-bake` export was diffed against the patched glb to
prove the two now agree.

1. **Marker facing (HIGH).**  The Y-up export conjugates each node's rotation by
   the change of basis, which sends Blender-local **+Y** to the exported node's
   local **−Z**.  Aiming Blender's own −Z therefore put the facing on the node's
   local −Y and pointed −Z at the ceiling.  The three markers now carry
   rotations whose local −Z *is* the facing, and `verify_hall.py` asserts it
   numerically (it rotates (0,0,−1) by the quaternion) as well as asserting each
   marker is upright.
2. **Lightmap intensity (HIGH).**  three.js r155+ dropped the 1/π from the light
   map path, so `scale` alone is π× too dark.  `hall.json` and the glb extras now
   carry **both** `lightmap.scale` = 3.410822 (the irradiance/π convention the
   texture actually holds) and `lightmap.three_light_map_intensity` = scale·π =
   **10.715413**, which is what `material.lightMapIntensity` wants.
3. **Floor albedo (MED).**  `hall_floor` exported the glTF default white because
   its base colour and roughness were node-linked to the procedural.  Both are
   now constants in the glb — baseColorFactor `[0.150, 0.135, 0.125, 1]`,
   roughness `0.38` — and the script unlinks any non-image driver before export.
4. **Encoding string (LOW).**  The PNG is RGBA, not RGB; the record says so and
   the verifier checks the colour type against it.
5. **`--device GPU` (LOW)** now refuses unless `ORCHARD_GPU_LANE_HELD=1`, which
   only an `exp run … --prio 10 --` line has any business setting.  The docstring
   rule is a gate now.

Not done, and why: `preview.png` stays in `public/` (moving it to `docs/img/` is
outside this work package's write scope — WP2 or the coordinator should decide);
the spawn is at z = 8.0 against `mansion.json`'s 7.5, a 0.5 m disagreement that
is WP2's to reconcile since the marker is the asset's own authority; the recorded
git commit is the parent of the one that first contains the script, because the
tree was dirty at bake time — the script sha256 in the record is the reproducible
identity, not the commit.

`grove/tools/bake_hall.py` builds the M0 hall from nothing but numbers, bakes a
Cycles lightmap onto a second UV set and writes the client's asset:

    grove/public/assets/hall/
        hall.glb        the room, glTF binary, Y-up, no Draco, TEXCOORD_1 = uv2
        lightmap.png    2048², sRGB, diffuse direct+indirect with no colour
        hall.json       provenance and geometry, the same record as asset.extras
        preview.png     1280×720, what you see standing on the spawn point
    grove/tools/verify_hall.py     the checks below, "VERIFY OK"
    grove/tools/patch_hall_glb.py  the one post-review edit to the shipped bytes

Nothing is modelled by hand: change a constant at the top of the script and the
hall changes.  The bake runs on the CPU under `exp run --lane cpu`; no CUDA context is ever
opened.

    exp run orchard-hall-bake --prio 10 --lane cpu -- /home/manuel/tools/blender/blender --background --factory-startup \
        --python grove/tools/bake_hall.py -- --samples 1024 --res 2048 \
        --out grove/public/assets/hall

## Geometry and coordinates

Blender space: **Z up, origin at the centre of the floor, +Y towards the
doorway**.  The interior is 14 (X) × 20 (Y) × 7 m (Z) to the beam soffits.

| feature | where (Blender) |
|---|---|
| floor | z = 0, x ∈ [−7, +7], y ∈ [−10, +10] |
| ceiling | beam soffits at z = 7, coffers recessed up to z = 7.35 |
| windows | −X wall, six, 1.6 m wide, sill 1.6 m, head 5.6 m, reveal 0.35 m deep, centres at y = ±8.33, ±5.0, ±1.67 |
| poster panel | +X wall, 6 × 3.4 m, recessed 0.04 m, centre (7.04, 0, 3.10), material `hall_poster_panel` |
| doorway | +Y wall, 2.4 × 3.2 m, centred on x = 0, sill at z = 0, reveal 0.45 m deep |
| back wall | −Y, blank |
| wainscot | 0 → 1.1 m, standing 0.06 m proud |
| cornice | 6.55 → 6.85 m, standing 0.12 m proud |
| spawn | (0, −8, 0) **on the floor**, facing +Y (preview eye height 1.6 m) |

The walls are a stepped profile (wainscot → field → cornice → frieze) built from
visible faces only: no face is hidden behind another, so no lightmap texel is
spent on something you cannot see, and the shell stays closed against light
leaks.  Openings are cut by splitting each surface on the hole edges, and every
opening gets a reveal ring so the bake has depth to shade.

**What the client should expect.**  The glTF exporter converts to Y-up:

    (x, y, z)_blender  ->  (x, z, −y)_gltf

so in the client's coordinates the hall is x ∈ [−7, 7], y ∈ [0, 7],
z ∈ [−10, 10]; **the doorway is at z = −10** and the windows are on −X.

* **spawn**: translation `(0, 0, 8)` — **on the floor, y = 0**.  It is the body
  position, not the eye: the client adds its own eye height (`view.ts`
  `EYE_HEIGHT`), which is the convention `mansion.json` already uses.  Its
  rotation is identity, so its local −Z is `(0, 0, −1)`: three.js' default camera
  forward, facing the doorway down the length of the hall, windows on the left,
  poster wall on the right.  (`extras.eye_height_m = 1.6` is the height
  `preview.png` was rendered from, not an instruction.)
* **doorway**: floor centre `(0, 0, −10)`; you walk through it towards −Z, and the
  jamb is 0.45 m deep, so the far side of the wall is at z = −10.45.  The
  `door_einstruct` node's local −Z points the other way, `(0, 0, +1)`, **back
  into the hall** — the portal-normal convention, so a quad given that rotation
  faces a visitor standing in the hall.
* **poster panel**: centre `(7.04, 3.1, 0)`, normal −X, 6 × 3.4 m.

Those three are also **empty nodes in the glb** — `spawn`, `door_einstruct`,
`poster_wall` — so WP2 can read them instead of copying numbers.  Convention:
the node's local **−Z is the facing direction** (camera convention) and local +Y
is up; each carries its own `extras` (`role`, `width_m`, `height_m`,
`eye_height_m`).  Final transforms:

| node | translation | rotation (xyzw) | local −Z |
|---|---|---|---|
| `spawn` | (0, 0, 8) | (0, 0, 0, 1) | (0, 0, −1) |
| `door_einstruct` | (0, 0, −10) | (0, 1, 0, 0) | (0, 0, +1) |
| `poster_wall` | (7.04, 3.1, 0) | (0, √½, 0, √½) | (−1, 0, 0) |
`hall.json` and `asset.extras.orchard.geometry` carry the same coordinates in
both spaces.

## Materials and the lightmap

Five materials — `hall_floor`, `hall_wall`, `hall_ceiling`, `hall_trim`,
`hall_poster_panel` — export as principled with flat base colours (5 primitives
in one mesh).  The floor's subtle procedural (a 1 m checker of two near
identical greys, mottled with noise, driving base colour and roughness) exists
only inside Blender: **glTF cannot carry procedural nodes**, so it shapes the
bake's bounce light and then the exported baseColor is a constant.  A real
albedo map, baked or authored, is the fix if the floor ever needs to read as
stone up close.

`--grid-floor` swaps that procedural for a generated 1 m grid PNG on UV0 (which
is a cube projection at 1 unit = 1 m, so the grid tiles at true metre scale).
It is a debug aid for pacing and scale: it writes `grid_1m.png`, and unlike the
procedural it *does* travel into the glb, so do not ship a build made with it.

The lightmap is baked with Cycles `DIFFUSE`, pass filter `{DIRECT, INDIRECT}`
and the **colour pass off** — the "no colour" form of a combined diffuse bake;
`COMBINED` has no colour toggle, so `--bake-type COMBINED` exists but is not
what ships.  What the texture holds is therefore irradiance/π, i.e. the outgoing
radiance of a white Lambertian surface, which the client multiplies by its own
base colour.

Second UV set `uv2` (TEXCOORD_1) comes from Smart UV Project at a 66° angle
limit with an 8 px island margin, then `average_islands_scale` and
`pack_islands`, so texel density is uniform across the room rather than per
island.  1133 m² of surface into 2048² is 3702 texels/m² before packing; islands
plus their margins cover 60% of the atlas, so the delivered density is about
47 px/m — a texel is roughly 2 cm.

The float bake is normalised so that its 99.9th percentile lands at 0.95, then
sRGB-encoded to 8 bit RGBA (the alpha channel is a constant 1).  The divisor is
recorded as `lightmap.scale` = **3.410822**:

    irradiance/pi = srgb_decode(texel) * scale

**The exact client binding**, which is also spelled out in
`lightmap.binding`:

    texture.colorSpace          = THREE.SRGBColorSpace   // the PNG is sRGB-encoded
    texture.flipY               = false                  // glTF UV origin
    texture.channel             = 1                      // TEXCOORD_1 = uv2
    material.lightMapIntensity  = lightmap.three_light_map_intensity   // 10.715413

`three_light_map_intensity` is `scale · π`, **not** `scale`: three.js r155+
removed the 1/π that used to sit in the light map path, so it adds
`texel · lightMapIntensity` straight to irradiance and then multiplies by
`albedo/π`.  With `scale·π` the product is `albedo · texel · scale`, which is
exactly the radiance `preview.png` was rendered at, so the preview remains the
calibration for the corrected binding.  Clipping above the percentile is measured
and reported in `hall.json` (it is the sunlit floor and window reveals only).

`toktx` is **not installed on this box**, so the asset ships `lightmap.png` and
`hall.json` records that.  When it lands, the script writes `lightmap.ktx2`
with

    toktx --t2 --encode uastc --uastc_quality 2 --zcmp 18 \
          --assign_oetf srgb --genmipmap lightmap.ktx2 lightmap.png

UASTC rather than ETC1S deliberately: a lightmap is a smooth low-frequency
signal and ETC1S bands visibly across a 20 m wall.  ETC1S is roughly 4× smaller
and is the fallback if the phone-tier download budget bites.

## Lighting

One sun (strength 3.6, 1.6° angular diameter) travelling
(0.78, 0.30, −0.55) — in through the six windows, about 33° above the horizon,
raking down the length of the hall — plus a Nishita sky world at strength 0.85.
The windows are **unglazed openings**: sun and sky reach the room directly, and
the client will see its own environment through them.  Lights are baked, not
exported; the glb carries no `KHR_lights_punctual`.

## Bake settings and timings

Blender 4.2.1 LTS, Cycles CPU, 16 threads, adaptive sampling threshold 0.01,
max 8 bounces (4 diffuse), indirect clamp 10, bake margin 8 px `ADJACENT_FACES`.

**Cycles 4.2 does not denoise bakes.** `scene.cycles.use_denoising` is honoured
for renders only: a 64-sample bake is pixel-for-pixel as grainy with it on as
with it off (noise metric 0.13115 both ways — that is how the measurement was
made).  So the script denoises after the fact, pushing the baked image through
the compositor's OpenImageDenoise node and keeping the bake's own alpha as the
coverage mask.  It costs about 6 s at 2048² and takes the noise metric down by
roughly 4×.

| run | resolution | samples | bake | denoise | total | noise metric (raw → denoised) |
|---|---|---|---|---|---|---|
| smoke, pipeline | 512² | 64 | 4.7 s | 0.4 s | 8.3 s | 0.13115 → 0.06373 |
| smoke, after the geometry fix | 512² | 96 | 13.5 s | 0.8 s | 29.7 s | 0.11055 → 0.05408 |
| calibration | 2048² | 128 | 191.2 s | 5.6 s | 200.5 s | 0.11239 → 0.02422 |
| **production** | **2048²** | **1024** | **1265.2 s (21m05s)** | **4.5 s** | **1275.2 s (21m15s)** | **0.04806 → 0.02158** |

Sizing: the 512² smoke is a poor predictor (it suggested 2.26 s per sample at
2048²), so the sample count came from the 2048² calibration, which measured
**1.49 s per sample** — dead linear between 128 and 192 samples.  1024 samples
predicted 1526 s; the run took 1265 s, adaptive sampling giving back 17% at the
high end.  A 30-minute ceiling therefore allows roughly 1200 samples on this
box; 1024 was chosen to leave the margin.  **The GPU was never used** — the CPU
bake fits the budget, so there was no reason to take a lane.

The denoised noise metric is almost the same at 128 and at 1024 samples: the
denoiser will always hand back something smooth.  What the extra samples buy is
that it is smooth *and right* — at 128 the mottle in the ceiling and the dark
corners is invented, at 1024 it is the geometry.

Sizes: `hall.glb` 49.9 kB (402 verts, 332 quads, one mesh, five primitives),
`lightmap.png` 2.22 MB, `preview.png` 766 kB, `hall.json` 5.2 kB.  The glb is
tiny because the lightmap is *not* embedded: the bake target image node is left
unconnected in every material, so the exporter never sees it and the client
loads the texture itself.

Provenance of this build: Blender 4.2.1 LTS, script sha256
`d83ed9d63a1bdaece…`, git `4c373c3` (dirty), baked 2026-09-12.  The `exp` record
flagged a foreign CUDA context on the card during the run; the bake is CPU-only
so it does not affect the result, but the wall clock is only comparable to
another run under the same CPU load.

### Bring-up, for the record

Two bugs the preview caught that no assertion would have.  The reveal rings were
built *into the room* rather than into the wall (the frame handed to `reveal()`
gives the outward normal, not the interior one), which put a 0.35 m slab in
front of every window; and the hole tuples were unpacked in a different order
than `build_wall` writes them, which threw two stray quads across the doorway
wall.  Both showed up as a rectangular step in the light on the far wall.  The
script now asserts that no vertex escapes the hall's bounding box, and
`verify_hall.py` checks the mesh bounds in glTF axes, which would have caught
the first one.

### Launch discipline, and one trap

    exp run orchard-hall-bake-1024 --prio 10 --lane cpu -- \
      /home/manuel/tools/blender/blender --background \
        --factory-startup --python grove/tools/bake_hall.py -- \
        --samples 1024 --res 2048 --out grove/public/assets/hall \
        > logs/orchard-hall-bake-1024.log 2>&1
    exp wait orchard-hall-bake-1024 --done-when 'BAKE OK samples=1024 res=2048'

**Let `exp run` own the lane.**  Do not set `GPU_LOCK` or start `nohup`
yourself; the launcher records the log and keeps the lane serialised. The
script's last line is deliberately
`BAKE OK samples=… res=… bake_s=… total_s=…`, which no crash, kill or
time-budget stop can produce.

## Verification

    exp run orchard-verify-hall --prio 5 --lane cpu -- uv run --with pygltflib python grove/tools/verify_hall.py \
        grove/public/assets/hall

asserts, and prints, all of: one mesh, TEXCOORD_0 and TEXCOORD_1 on every
primitive, no Draco and no required extensions, `asset.extras.orchard` with the
script, its sha256, the Blender version, the git commit and the whole bake
record, the three marker nodes at their expected glTF positions, the mesh bounds
in Y-up, `lightmap.png` at 2048² 8-bit, `preview.png` at 1280×720, the glb under
8 MB, and agreement between `hall.json` and the glb's extras.

## The preview

`preview.png` is still the reference for the shipped asset: nothing in the
post-review patch changed a pixel of the lightmap, and the floor albedo the
patch wrote into the glb is the same constant the preview multiplies by.  It is
rendered from the spawn point (0, −8, 1.6) with a 22 mm lens,
Cycles, emission only (`max_bounces = 0`), using the **saved** `lightmap.png`
re-loaded as sRGB and multiplied by each material's flat base colour — that is,
it renders exactly what the client will assemble, not what Blender knows.  It is
therefore a check on the whole chain: normalisation, sRGB encoding, uv2, and the
scale factor.

You are looking the length of the hall at the doorway, windows on the left,
poster panel on the right.  What to look for: six sun patches raking across the
floor and up the right-hand wall, the coffer grid picked out by soft contact
shadows on the beams, the wainscot line dark against the wall field, the window
reveals bright on their sun side and dark on the other, and the doorway blown
out white — beyond it is Blender's sky, because in M0 nothing has been built
there yet.

## Known issues

1. **The windows and the doorway are open holes.**  The sun and sky reach the
   room through them, which is the point, but the client sees its own background
   through them too.  WP2 needs an environment behind the hall (and the
   einstruct room behind the doorway) or the room reads as having seven voids in
   it.  Glazing would need a separate bake decision: glass in a diffuse bake
   costs samples and darkens the room.
2. **The bake assumes nothing is behind the doorway.**  Light spills in from the
   exterior sky and lands on the threshold, the jambs and the floor near the
   door.  When M5 (or WP2) puts a real room there, that spill is wrong.  Fix by
   rebaking with the neighbour in place, or by capping the opening with a
   matching emitter during the bake.
3. **Island-boundary values.**  uv2 is one island per flat surface, so every
   corner, mitre and coffer edge is a seam.  The 8 px `ADJACENT_FACES` margin
   keeps bilinear filtering off the black gutter, but neighbouring islands are
   independent samples of the same corner and can differ slightly; the four
   wainscot and cornice corner squares are the most visible instance.  No light
   leak between inside and outside was found — the shell is closed and the mesh
   is manifold except at the reveal rims.
4. **Denoise blotching in the darkest corners.**  OIDN over a diffuse-only bake
   with no albedo or normal guide turns the last of the noise into low-frequency
   mottle rather than grain; it is visible on the ceiling behind the cornice.
   More samples is the only cure the current pipeline offers.
5. **Highlights clip.**  Everything above the 99.9th percentile of luminance is
   clamped by the 8-bit encode (measured fraction is in `hall.json`).  Those
   texels are the sunlit floor and the sunny window reveals.  An EXR or RGBM
   lightmap would keep them; 8-bit sRGB is the M0 trade.
6. **The floor's procedural does not export** (see above), and the exported
   materials have no albedo, normal or roughness maps at all, so the room is
   flat matte until WP2 gives it an environment map for specular.
7. **`lightmap.png` is RGBA** because Blender writes what the image datablock
   holds; the alpha channel is constant 1 and costs about 15% of the file.
   `toktx` with ETC1S, or any RGB re-encode, removes it.

## What M5's portal work will need

* The doorway is a plain rectangular opening, 2.4 × 3.2 m, with a 0.45 m deep
  reveal.  In glTF the inner face is the plane **z = −10**, the outer face
  z = −10.45, and the node `door_einstruct` sits on the floor at the inner face
  with its −Z pointing the way through and `width_m` / `height_m` in its extras.
  A stencil or render-to-texture portal quad belongs on the inner face so the
  jamb frames it; a world-engine lens wants the plane and the normal, both of
  which are in `asset.extras.orchard.geometry.doorway` in both coordinate
  systems.
* **One atlas per room.**  The lightmap is the hall's alone; a portal that shows
  the far room must have that room's glb and lightmap resident, so portal
  visibility has to drive asset loading, not only draw calls.
* **The hall is a single mesh with five primitives.**  There is no per-wall
  split to cull against, and no portal-shaped hole to render into other than the
  doorway opening itself.  If M5 wants to draw only the wall carrying the
  portal, the script has to emit that wall as its own object — a change of a few
  lines in `build_hall`, not a remodel.
* **Rebake, do not patch.**  Every number that produced the asset is in
  `hall.json` and in `asset.extras`; the script is deterministic given its
  arguments, so the honest way to change the light for a portal is to change the
  scene and rerun the same command.
