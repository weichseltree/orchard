# Palace assets: what to lift, where from, and how it enters the repo

Scouted 2026-09-12 for the direction in DECISIONS 2026-09-12: the hall is the
first room of an Austrian baroque palace with a real orchard outside its
windows. Target stack is the one M0 already runs: three.js 0.186, glTF with
meshopt and KTX2, Blender 4.2.1 LTS Cycles bakes, Quest 3 browser as the floor
device, phone tier under 20 MB.

Every entry names its licence exactly. LAWS 9 rules: lifted or generated
material only with a provenance sidecar. `orchard/bundle.py:provenance_sidecar`
already reads `<file>.json` beside an asset (provider, id, query or prompt,
license, author, sha256, bytes, retrieved_unix) into `source.provenance`; §5
fixes the fields for scenery. "Verified" below means the page or API was read
today; "guess" means inferred and to be checked on download. Nothing was
downloaded.

## 0. Licence verdicts per source

| source | licence | verdict |
|---|---|---|
| Poly Haven (models, textures, HDRIs) | CC0, "no credit required" (verified, polyhaven.com/license) | use freely |
| ambientCG | CC0 (verified, site banner) | use freely |
| Sketchfab, filter `license=cc0` via `api.sketchfab.com/v3/search` | per model; the CC0 filter is reliable, the page licence must still be copied into the sidecar | use; download needs a free account and the download API |
| noe-3d.at scans on Sketchfab (Harald Wraunek, Lower Austria) | CC0 per model (verified on 40+ results) | the Austrian statues; the find of this scout |
| WirtualneMuzeaMalopolski (Kraków museums) on Sketchfab | CC0 (verified) | capitals, a synagogue chandelier |
| Smithsonian 3D (3d.si.edu) | CC0 on items marked CC0; fetch blocked (403), the Sketchfab mirror verified | use, copy the item's own licence line |
| The Met 3D (2026 release, ~140 models) | press release says most are CC0 Open Access; object pages rate-limited today (429) | verify per object before download |
| Rijksmuseum | no first-party 3D download programme found; 28 models were made with Adobe Stock (not open); 2D is CC0 | skip for 3D |
| Blender demo files | per file: Classroom CC0 (Christophe Seux; a copy is at `~/tools/classroom`), Lone Monk CC0 (Monorender), Italian Flat CC-BY, Barbershop CC-BY | Lone Monk for stone arches; the rest as bake references only |
| Quaternius | CC0 (verified on two packs) | stylised, not photoreal; phone/preview stand-ins at most |
| Kenney | CC0 (verified: Nature Kit, Interface Sounds, UI Audio) | stylised; UI sounds are the real use |
| cgtrader / turbosquid free | site Royalty-Free licence, not CC0; page fetch returned nothing | flagged: do not use without a per-item licence read |
| textures.com | own licence; redistribution of images is forbidden and a served web asset IS redistribution (verified in their licence FAQ) | do not use |
| BlenderKit (Blendkit) free tier | mix of CC0 and Royalty-Free per asset; RF forbids re-selling the asset itself; download only through their add-on | CC0 items only, sidecar copies the asset's licence field |
| NASA CGI Moon Kit | US government work, not copyrighted; NASA asks to be credited as source (verified, nasa.gov media guidelines) | use, credit "NASA's Scientific Visualization Studio" in the sidecar |
| OpenAIR (York) | CC-BY-4.0 per the audeering mirror; both York hosts (openairlib.net, openair.hosted.york.ac.uk) were suspended/down today | use via the mirror, attribute |
| EchoThief (SDSU) | no licence stated anywhere, only "copyright 2013-2026 Dr. Chris Warren" | flagged: all rights reserved until written permission; do not ship |
| Freesound | per sound; filter CC0; the Karlskirche IR is CC0 (verified) | use CC0 sounds only |

CC-BY items need an attribution plan: a credits panel in the greenhouse and a
`credits.json` the client renders on the site home, generated from sidecars.
Nothing NC or SA is listed below; if one is ever proposed, it is flagged in
its sidecar `license` field and the bundler must refuse it.

## 1. Architecture and ornament

Finding: there is no CC0 baroque kitbash set anywhere. Mouldings, pilasters,
balustrades and window frames are cheap to build parametrically in Blender
(profiles swept along curves, Archimesh for openings) and expensive to find.
Lift the ornament that is hard to model (statues, capitals, chandeliers,
scanned reliefs) and model the straight architecture.

### 1.1 Statues, reliefs, fountains: noe-3d.at on Sketchfab, CC0

Photogrammetry of Vienna and Lower Austria monuments, mostly Belvedere garden
sculpture and public fountains, ~500-900k faces each, single texture set
(assume 8k, guess). Every one below returned `CC0 Public Domain` from the
search API. Search: `api.sketchfab.com/v3/search?type=models&downloadable=true&license=cc0&q=<word>`;
viewer URL is `sketchfab.com/3d-models/none-<uid>`.

| name | uid | faces | palace use | note |
|---|---|---|---|---|
| Apollo und Daphne | 2d77409f93c249cca9c52a8c54e9607a | 588k | garden statue on the parterre axis | Belvedere; verified via API |
| Herkules und Kalliope | 0caca2b9956844caa9893968d118373a | 591k | garden statue | Belvedere; verified |
| Venus | 47c7f4d3b6e640858e1d3afac28c1766 | 598k | niche statue in the hall | verified |
| Rossbändiger (horse tamer) | 0bd8088f92be4a39a3c8a7faafbf897f | 608k | forecourt pair | verified |
| Sphinx ×3 | d94a2dfbf413465395fde1bd17981b85, 87fbe7f18d314ef49ef0424f507c4ab5, 321280b8420541c186940cef8e2763b8 | ~605k | terrace stair flanks (Belvedere's signature) | verified |
| Allegorie Feuer / Wasser | 15e9a7ec5cfd47a2b183aa0010c42c14, 06cac67a52e149e499cb8e0498c11c88 | ~595k | window-bay allegories | verified |
| Putti Gruppe | 49342e3b3c7d4e3c92bb5525ffeb397f | 630k | over-door group | verified |
| Putto mit Krokodil, Putto auf Fisch | 95e337d074644c568e08efc9794baf6c, 8ba656b736a54a24904d163c7097c3c9 | ~490k | fountain figures | verified |
| Josefsbrunnen, Märchenbrunnen, Magna-Mater-Brunnen, Bärenbrunnen | db17f06596aa4bfcae53b1945818dc4f, c6d197575daf4a41b952ac25f6e91561, f6fa0a62a03149319e4fee21cb6dd5af, e0ffe6efc1a745c78151d7bca2d93724 | 485-925k | the orchard's fountain | verified |
| Löwe ×3, Greif, Löwenkopf | 46eea1a922bd433a935351e7c2eff652, 3396c1f61742469ea956b1320d22eb95, 4522a4cdc1c14190bf1a8811fa27da32, 87945b7cc58341adb84f5e850975c5cb, 19f2b4025f6c4c4db47214ce0605b866 | ~500-640k | gate piers, keystones | verified |
| Relief | f3d7855ca18046bf88b97a0797c8ea92 | 487k | wall panel above the wainscot | verified |
| Heiligenkreuzerhof | dab7bcee33924008a69bbc8b63f4140d | 915k | a scanned baroque gateway: reference and kitbash donor for portal frames | verified |

Scan geometry carries no clean UVs or LODs; §5 gives the decimation ladder.
Scans of outdoor stone read as stone; for the interior "marble" pieces
replace the albedo with a Poly Haven/ambientCG marble and keep the scan's
normal map (guess: their normal maps exist; check the download).

Other CC0 sculpture verified via the API: `smkmuseum` Apollo Belvedere
(fe5c0cffdc2a4f3985872212c692af0c, 291k); Smithsonian George Washington bust
(23630d35f855409e9c00c810b1416c71, 300k); Cleveland Museum busts
(fc442ce1d47a49b0aea6ee03e86b5080 17k, 9b2fbfe552ac4107a3623e19c1ddb4e4 80k);
Poly Haven `marble_bust_01` (CC0, glTF, Renaissance male bust, size not read).

### 1.2 Capitals and a chandelier: Kraków museums on Sketchfab, CC0

| name | uid | faces | use |
|---|---|---|---|
| Corinthian capital (Archaeological Museum Kraków) | 1b61fd199e744afa9bdb8f46cf843e31 | 22k, textures up to 8k | pilaster capitals in the hall; the only low-poly capital found |
| Twin capital with plant motifs; griffin; rosette; interlace (Tyniec, Romanesque) | 0c16db638e0a45f2b4cbcb87fe455e6a, 04045f7e2a874ea6a1d9e3a451ec78ad, 489d18a58e0a47d7b17f5d6be2e3ea53, f6091e541dc742d19b2c6401b39fa7bd | 200-270k | orchard wall and grotto, not the hall (Romanesque, not baroque) |
| Chandelier from the Great Synagogue, Oświęcim | f53d0a6d218c4b51973a6de830b60b0f | 1.9M | reference; too heavy, and it is a memorial object: use only with its story in the room |

Corinthian Capital Trimontium (Sketchfab ad82060c…, 9.6k tris) is CC-BY, not
CC0: usable with the credits panel, listed as second choice.

### 1.3 Chandeliers, frames, mirrors, clocks: Poly Haven, CC0, glTF

Author Kirill Sannikov unless noted; sizes from `api.polyhaven.com/files/<id>`.

| id | what | size (glTF + textures) |
|---|---|---|
| Chandelier_01 | ornate brass, six fabric shades | 1k 1.3 MB, 2k 2.1 MB, 4k 4.9 MB; geometry .bin 892 KB (verified) |
| Chandelier_02 | 0.8 m, "ornate, elegant" | not read; assume similar |
| Chandelier_03 | 1 m, brass with crystal dishes | not read; assume similar |
| Lantern_chandelier_01 | Victorian brass lantern chandelier | for the stair |
| brass_candleholders (Tina) | engraved bases, scrolling arms | mantels, console tables |
| ornate_mirror_01 (James Ray Cock) | arched, gilded floral crest | pier mirrors between windows |
| fancy_picture_frame_01/02 (Rob Tuytel, Rico Cilliers) | gilt frames with paintings | swap the canvas for tree posters: the poster wall's frames |
| mantel_clock_01, vintage_grandfather_clock_01 | carved ornate clocks | props |
| brass_vase_02/03/04 (Rico Cilliers) | ornate brass, "gold" tag | the only gilt objects with a gold material to steal |
| large_iron_gate | cast-iron double gate, spear finials | orchard gate |
| large_castle_door | arched double door, iron straps | too medieval for the hall; a service door |
| ArmChair_01, Sofa_01, sofa_03, GreenChair_01 | carved, upholstered | hall furniture; Chinese_* pieces are wrong for Austria |

The 892 KB chandelier geometry is dense for Quest; meshopt + `simplify`
to ~30% for `vr-quest` (guess at ratio, measure).

### 1.4 Marble, parquet, stucco, gilt: PBR textures

Poly Haven (CC0; physical size in cm from the API):

| id | what | size |
|---|---|---|
| herringbone_parquet | glossy herringbone | not read |
| diagonal_parquet | diagonal parquet, varnished | 236 cm |
| rectangular_parquet | polished rectangular parquet | not read |
| lacquered_cherry_wood, dark_wood | fine polished hardwood for doors, wainscot | |
| floor_tiles_06 | checkered brown/beige marble | 300 cm; the classic palace floor |
| floor_tiles_02, floor_tiles_04 | beige and pale marble tiles | 400 cm |
| grey_cartago_01/03 | polished grey stone, veined | 75/93 cm |
| terrazzo_tiles | terrazzo | 200 cm |
| beige_wall_001/002 | smooth and textured painted plaster | 300 cm |
| white_stucco | granular matte stucco | 200 cm |
| grey_plaster | plain weathered plaster | 100 cm |

ambientCG (CC0): Marble012 (white, veined, polished), Marble021 (bright
white), Marble016 (black gloss), Marble020/014 (beige), Tiles074 and
Tiles078 (tiled marble floors), 77 marble/onyx/travertine results in all;
WoodFloor051/064/070/043/040/041/062/071 in the parquet query (68 results;
none tagged herringbone, so Poly Haven's is the herringbone); Plaster001/002/
003/004/006 (white walls), PaintedPlaster016/017; Metal048A/B/C, Metal034,
Metal042A/B (gold, clean to fingerprinted); Gravel043/023/022/041/040;
Grass001/004/005 (lawn), Grass007 (weeds). Sizes: ambientCG serves 1K to 8K
zips; 2K JPG zips are typically 5-15 MB (guess).

Gilt: no gold-leaf scan exists on either site. Gilding is a material, not a
texture: metallic 1, roughness 0.25-0.4, base colour ~(1.0, 0.78, 0.35)
linear, with a scratch/dirt mask from Metal048B for wear. Poly Haven has no
gold, brass or bronze textures at all (verified: 25 metal textures, all
steel/rust).

### 1.5 What must be modelled

Cornice, dado and architrave profiles (sweep a curve; Wikipedia's Baluster
article and the Heiligenkreuzerhof scan are the reference), pilasters (a box
plus the Kraków capital), balustrades (one baluster instanced, then
`gltf-transform instance`), window frames and doors (Archimesh parametric,
GPL add-on on extensions.blender.org, verified), coffers (already procedural
in `bake_hall.py`). Stucco ornament: model one cartouche and one acanthus
scroll, bake to a normal+AO decal, reuse.

## 2. Grounds

### 2.1 Orchard trees: nothing lift-ready exists

Poly Haven's 20 trees are firs, pines, coastal and Karoo species plus one
jacaranda and `tree_small_02`; no apple, pear, cherry, walnut (verified).
Sketchfab CC0 `apple tree` and `hedge` return zero results (verified).
Quaternius and Kenney trees are stylised low-poly, CC0, FBX/OBJ/Blend
(Textured LowPoly Trees: 45 models, 11 MB, birch and pine only; Nature
MegaKit: 40 trees, unnamed species; Nature Kit: 330 assets, formats not
stated). They are placeholders at best and clash with the gallery palette.

Generate the trees, with a sidecar naming the generator and its parameters:

| tool | licence | notes |
|---|---|---|
| Sapling Tree Gen (extensions.blender.org) | GPL-3.0-or-later; was bundled until 4.1, an extension since 4.2 | Weber-Penn parametric; apple/pear read as "small deciduous, open crown"; leaves as cards |
| Modular Tree (MTree) | add-on GPL-3.0, library MIT; needs Blender 4.3+ (verified), so NOT for our 4.2.1 without the `modular_tree_py311` fork | node-based, better bark and branching |
| EZ-Tree (`@dgreenheck/ez-tree` 1.1.0, MIT, three >=0.167) | MIT | runtime or offline generation in three.js, exports GLB from eztree.dev; 15 presets (oak, ash, aspen; no fruit trees, tune from oak) |

Bark and leaves: Poly Haven `bark` category (23 textures, CC0); an apple leaf
card must be photographed or painted (none found). Fruit for close cards:
Poly Haven `food_apple_01`, `food_pears_asian_01` (CC0, photoscans).

Impostors for the far rows: `agargaro/octahedral-impostor` (MIT, three.js,
bakes at runtime, explicitly "wip", verified) is the only three.js library;
Pandrodor's Blender Impostor Baker is GPL-3.0 but targets Blender 2.8x and
Unreal materials and is unmaintained (verified on the forum thread). Plan:
our own Blender script renders 8×8 hemi-octahedral views to one 2048 atlas
(albedo+alpha, normal+depth) and the client's impostor shader is written
against agargaro's layout so we can swap in his library when it settles.

### 2.2 Ground, lawn, parterre, gravel

Poly Haven CC0: `gravel_ground_01` (300 cm, Rob Tuytel), `gravel_road`,
`grass_path_2/3`, `park_dirt` (300 cm), `forest_ground_04` (315 cm),
`dirt_floor`; grass tufts as models `grass_medium_01/02`, `grass_bermuda_01`;
ground cover `celandine_01`, `dandelion_01`, `moss_01`; `fern_02`;
`planter_pot_clay` and `painted_wooden_bench` for the terrace.
ambientCG lawn: Grass001/004/005.
Hedges: no CC0 boxwood hedge model exists (Sketchfab 0, Poly Haven none).
Model as a box with a tiled leaf texture and a fuzzy silhouette card; a
photographed boxwood tile is on the shoot list.

### 2.3 Sky: Poly Haven HDRIs (CC0), the Austrian light

Coordinates from the API; all within 150 km of the border with Austria's
Alpine and Danube light.

| id | where | light | res |
|---|---|---|---|
| alps_field (Andreas Mischok) | Alps | sunny, partly cloudy | 20k; 4k HDR 26.5 MB, 2k 6.5 MB, 1k 1.6 MB (verified) |
| dreifaltigkeitsberg | 48.08 N 8.76 E | clear midday over a meadow | 17k |
| ehingen_hillside, ehingen_hillside_02 | 48.31 N 9.72 E | sunrise; sunset | 21k, 22k |
| farmland_overcast | 50.36 N 17.34 E | soft overcast | 29k |
| blaubeuren_night | 48.41 N 9.79 E | park at night, tree, bench | |
| solitude_night | 48.79 N 9.08 E | field with moon | |
| ladybrand_heritage_house | South Africa | manor, hedge, lawn, garden: the parterre reference, wrong hemisphere | |

Runtime: 2k HDR for bakes only; the client ships a 1k or 2k KTX2 (UASTC,
RGBE or a PMREM-ready equirect) with the ground removed, never the 8k.

### 2.4 Moon

NASA CGI Moon Kit (svs.gsfc.nasa.gov/4720): colour maps to 16384×8192
(2025 set, 909 MB 16-bit TIFF; JPEG previews at 2k and 4k), displacement to
23040×11520 float. Take the 4k colour JPEG, encode to a 2k KTX2; credit
"NASA's Scientific Visualization Studio" in the sidecar. Verified.

## 3. Sound

| asset | licence | what | use |
|---|---|---|---|
| Freesound 220752, jmuehlhans, "Impulse Response Church" | CC0 (verified) | Karlskirche, Vienna: balloon burst 8 m from the mic, mono 44.1 kHz WAV, 5.16 s, 447 KB, RT60 5.0 s | the chapel and the stair; too long for the hall |
| OpenAIR via audeering `audb` mirror | CC-BY-4.0 (verified on the mirror) | 341 WAVs, 44.1/48/96 kHz, mono/stereo/B-format; spaces include Elveden Hall (a marble-halled stately home, several rooms), Central Hall York, Hamilton Mausoleum, St Patrick's Patrington | Elveden's rooms are the palace-scale IRs; attribute the University of York |
| Freesound Nox_Sound pack 31372 | not read; per-sound | Cathedral, Small Church, Chamber, Living Room, Forest at 5/10/20 m | the forest IRs suit the orchard; check each licence |
| Kenney Interface Sounds | CC0 (verified) | 100 sounds, click/button | UI |
| Kenney UI Audio | CC0 (verified) | 50 sounds, 2012 | gesture confirms |
| Freesound 394266, turtledudeproductions | not read | wind with birds, 1 min | orchard ambience candidate; verify CC0 |
| EchoThief | none stated | ~100 North American spaces | do not use |

Convolution on Quest: one `ConvolverNode` per room, IRs trimmed to 3 s, Opus
at 48 kHz mono as PLATFORM.md's audio row says, the WAV kept in the bundle
source. Ambience: three CC0 loops (wind in leaves, blackbird, distant bells
from Freesound, each verified per sound before use).

## 4. Tools

| tool | version | licence | role |
|---|---|---|---|
| Blender | 4.2.1 LTS at `~/tools/blender` | GPL | modelling, Cycles bakes (bake_hall.py) |
| Archimesh | extension | GPL-3.0 | doors, windows, walls, stairs |
| Bake Wrangler | 4.2 to 5.1 (verified) | GPL | node-based batch baking; replaces hand-written bake passes when rooms multiply |
| The Lightmapper (Naxela) | GitHub | free, licence not read | HDR lightmaps with denoise; evaluate against bake_hall.py |
| Sapling Tree Gen / MTree / EZ-Tree | §2.1 | GPL / GPL+MIT / MIT | trees |
| LilySurfaceScraper, AmbientCG Material Importer (extensions) | | GPL | paste a Poly Haven or ambientCG URL, get the material; both cache downloads (write the sidecar from the URL at that moment) |
| Poly Haven Assets add-on | paid (Patreon) | | not needed; the API is public |
| glTF-Transform CLI | 4.5.0 (verified, npm) | MIT | `dedup`, `prune`, `weld`, `simplify`, `instance`, `resample`, `meshopt`, `uastc`/`etc1s` (bundles Basis; no toktx needed) |
| meshoptimizer / gltfpack | 1.2.0 (verified, npm) | MIT | `gltfpack -cc -si <ratio> -tc`; decoder already in three (`MeshoptDecoder`) |
| KTX-Software | 4.4.2 at `~/tools/ktx/KTX-Software-4.4.2-Linux-x86_64/bin` (`toktx`, `ktx create`, `ktx2check`; verified locally) | Apache-2.0 | lightmaps and HDR equirects; `ktx create --encode uastc|basis-lz|astc --zstd --generate-mipmap --assign-tf srgb|linear` |
| three.js | 0.186 in grove | MIT | `KTX2Loader` (already wired in `grove/src/render/lightmap.ts`), `MeshoptDecoder` |
| Spark (`@sparkjsdev/spark`) | 2.2.0 (verified, npm), three >=0.180 | MIT | Gaussian splat vantage points (someotherlife); PLY/SPZ/SPLAT/KSPLAT/SOG; WebXR demo on Quest 3 |
| SuperSplat (PlayCanvas) | superspl.at/editor | MIT | clean, crop and compress splats before Spark |
| agargaro/octahedral-impostor | wip | MIT | far-row tree impostors |
| Sketchfab download API | | account token | `GET /v3/models/<uid>/download` returns a signed glTF zip URL; the script in §5 records the licence from `/v3/models/<uid>` |

Note on `ktx create --encode astc`: Quest 3 decodes ASTC natively, but a raw
ASTC KTX2 is one file per GPU family while Basis (UASTC/ETC1S) transcodes to
ASTC on Quest and BC7 on desktop from one file. Stay on Basis; the hall's
lightmap already uses UASTC q2 + zstd 18 with mipmaps.

## 5. Sourcing workflow

Every lifted or generated file enters through one script,
`grove/tools/lift.py` (to write), and never by hand:

1. `lift.py polyhaven <id> --res 2k`, `lift.py sketchfab <uid>`,
   `lift.py ambientcg <id> --res 2K`, `lift.py freesound <id>`,
   `lift.py file <path> --provider ... --license ...` (for NASA, OpenAIR,
   generated trees). It downloads into `results/lift/<provider>/<id>/`
   (gitignored, on disk, never /tmp), computes sha256 and bytes, reads the
   licence from the provider API (Poly Haven: constant CC0; Sketchfab:
   `license.label` and `license.slug` from `/v3/models/<uid>`; ambientCG:
   constant CC0; Freesound: the sound's `license` URL), and refuses any
   licence not in the allow-list `{CC0-1.0, CC-BY-4.0, CC-BY-3.0,
   US-Gov-PD}` unless `--allow-flagged` is given, which sets
   `flagged: true` in the sidecar so the bundler can refuse it.
2. The sidecar `<file>.json` matches what `provenance_sidecar` already reads
   plus the fields LAWS 9 names:

   ```json
   {"provider": "sketchfab", "id": "2d77409f93c249cca9c52a8c54e9607a",
    "title": "Apollo und Daphne", "author": "Harald Wraunek (www.noe-3d.at)",
    "url": "https://sketchfab.com/3d-models/none-2d77409f…",
    "license": "CC0-1.0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
    "query": "Belvedere", "use": "garden statue, parterre axis, east",
    "sha256": "…", "bytes": 0, "retrieved_unix": 0,
    "modifications": "decimated 588k->60k/15k/5k, albedo swapped for marble012",
    "credit_line": "Apollo und Daphne, scan by noe-3d.at, CC0"}
   ```
   Generated material (a Sapling tree, an impostor atlas) uses
   `provider: "generated"`, `id` = the generator and its parameter hash,
   `query` = the parameters or prompt, `author` = the script.
3. Processing happens in Blender or gltf-transform from the lifted copy,
   never in place; the derived file's sidecar copies the source sidecar and
   appends to `modifications`. A scan becomes: `weld` → `simplify` to the
   tier ratio (or Blender Decimate with UVs preserved) → `resample`/`prune`
   → `uastc` for normal maps, `etc1s` for albedo → `meshopt`. One command
   per tier, recorded in the sidecar as `produced_by`.
4. Tiers and budgets (project targets, to be measured against M0's 72 Hz
   definition of done, not sourced from Meta, whose WebXR guide gives no
   numbers):

   | tier | scene triangle budget | per statue | per capital / chandelier | texture max |
   |---|---|---|---|---|
   | vr-high (desktop) | 1.5 M | 60k | 20k | 4k albedo, 2k normal |
   | vr-quest | 400k | 15k | 8k | 2k / 1k, ETC1S albedo |
   | phone | 150k, under 20 MB total | 5k | 3k | 1k / 512 |
   | preview | 50k | 2k | 1k | 512 |

   Impostors replace trees beyond 25 m on `vr-quest` and 12 m on `phone`.
5. Naming: `<kind>_<subject>_<nn>` in snake case, kind from
   `{statue, capital, moulding, door, window, chandelier, frame, tree,
   hedge, ground, sky, moon, ir, sfx, amb}`; tier as a suffix on the file
   (`statue_apollo_daphne_01.vr-quest.glb`), one sidecar per source and one
   per derived file.
6. Where it lives. `grove/public/assets/` holds only what the hall needs to
   open (the hall glb, its lightmaps, one sky, the UI sounds), under 8 MB
   together, committed with sidecars. Everything else is a bundle:
   `orchard bundle scenery <dir>` (to add to `bundle.py`, kind `scenery`)
   writes `results/bundles/<id>/` with the four variants, carries every
   sidecar into `source.provenance[]`, and `orchard push` puts it on R2;
   `mansion.json` references the bundle id. Raw lifts under `results/lift/`
   stay on disk and are never committed; the sidecar's sha256 is what makes
   a re-download verifiable.
7. Credits: `orchard credits` walks bundles and writes `credits.json`
   (title, author, licence, url) for every non-CC0 item; the site home and
   the greenhouse render it. That is the CC-BY attribution plan.

## Gaps and asks

- Photograph or paint: an apple-leaf card, a boxwood tile, an orchard grass
  tile in Austrian light. Nothing CC0 exists.
- Manuel: a shoot at the Belvedere gardens or Schloss Hof for reference
  stills and a phone photogrammetry of one balustrade section would close
  the biggest hole (balustrade, cornice) in an afternoon.
- Verify on first download: Kenney's formats, Sketchfab scan texture maps,
  the Met object licences, the two Freesound ambiences.
- OpenAIR's York hosts are down; if the audeering mirror also goes, the
  Karlskirche CC0 IR is the only verified palace-scale IR.
