# Review · WP3 · the baked hall

2026-09-12, independent. No bake run, no GPU lane taken.

## Verdict

**Accept with fixes.** Good asset, honest provenance, correct geometry. Three
things must change first: the intensity is short by π, WP2 binds 1 instead of the
scale, and the markers' facing axis is not −Z.

## Verified

    exprun uv run --with pygltflib python grove/tools/verify_hall.py grove/public/assets/hall  # VERIFY OK
    sha256sum grove/tools/bake_hall.py   # d83ed9d… == hall.json + asset.extras
    exprun ~/tools/blender/blender --version   # Blender 4.2.1 LTS

glTF 2.0 Y-up, 1 mesh / 5 primitives, TEXCOORD_0 **and** _1 on all, no Draco, no
required extensions, bounds x [−7.35, 7.04] y [0, 7.35] z [−10.45, 10].
**0 textures / 0 images** — "the client binds it" is true. PNG 2048², 8-bit,
colour type 6 (RGBA); sRGB-encoded by hand (bake_hall.py:572) and saved
Non-Color, so `SRGBColorSpace` is right. Provenance matches
`logs/orchard-hall-bake-1024.log` (1024 spp, 1265.17 s, CPU) and its `BAKE OK`
line. Lane clean: no `/tmp`, `compute_device_type="NONE"` on CPU
(bake_hall.py:464).

## Findings

1. **HIGH — 3.411 is π× too dark.** bake_hall.py:603. The texture is
   *irradiance/π*; three r186 (`lights_fragment_maps.glsl.js:7`) adds
   `texel * lightMapIntensity` to irradiance, then multiplies by `albedo/π` — the
   pre-r155 π factor is gone, so the client needs `scale·π ≈ 10.715`.
   `preview.png` (scale as emission strength, i.e. radiance) is the calibration.
2. **HIGH — WP2 hardcodes 1.** grove/src/render/lightmap.ts:113,119. Read
   `asset.extras.orchard.lightmap.scale` instead.
3. **HIGH — facing axis is local −Y, not −Z.** bake_hall.py:623 aims the empty's
   Blender-local −Z; the Y-up export conjugates the rotation, so in the glb
   `spawn`/`door_einstruct` (Rx +90°) have local −Z → **world +Y, straight up**
   and −Y → (0,0,−1); `poster_wall` (Rz −90°) has −Y → (−1,0,0). A camera given
   that quaternion faces the ceiling. verify_hall.py:118 checks translation only.
   Fix: pre-rotate the empties −90° about X.
4. **MED — the floor exports white,** not grey: `hall_floor baseColorFactor
   [1,1,1,1]`, roughness 1.0, because both inputs are node-linked
   (bake_hall.py:366‑399); intended (0.150,0.135,0.125)/0.38. ~6.7× too bright,
   and unlike preview.png. Fix: restore the constants before `export_glb`.
5. **LOW —** `lightmap.encoding` claims "8 bit RGB PNG" (bake_hall.py:909); it is
   RGBA, and verify_hall.py never checks colour type.
6. **LOW — hygiene.** 2.22 MB PNG is fine against the 20 MB budget; KTX2 is an M1
   fix, a 1024² fallback unnecessary. `preview.png` (766 kB) ships to production
   out of `public/`; move it to `docs/img/`.
7. **LOW —** provenance `4c373c3 (dirty)` is the *parent* of `23f28ed`, the commit
   that first contains the script; that checkout cannot reproduce it.
8. **LOW — lane.** `EXP_PRIO=0` on a 21-min bake (scale says 5) and on the
   <10-min probes (10); `--device GPU` (bake_hall.py:783) is guarded only by the
   docstring and should refuse outside `gpurun`.

## Client binding

```ts
const ex = (gltf.parser.json.asset.extras as any).orchard;
const tex = await new TextureLoader().loadAsync("assets/hall/lightmap.png");
tex.flipY = false;
tex.colorSpace = THREE.SRGBColorSpace;   // the PNG is sRGB-encoded
tex.channel = 1;                         // TEXCOORD_1
tex.generateMipmaps = false;
tex.minFilter = tex.magFilter = THREE.LinearFilter;
const intensity = ex.lightmap.scale * Math.PI;   // 10.715, NOT 3.411 (finding 1)
gltf.scene.traverse((o) => {
  const m = (o as any).material as THREE.MeshStandardMaterial;
  if (!m?.isMeshStandardMaterial) return;
  m.lightMap = tex; m.lightMapIntensity = intensity; m.needsUpdate = true;
});
const face = new THREE.Vector3(0, -1, 0).applyQuaternion(spawnNode.quaternion);
```

## Mismatches with mansion.json

* **spawn z**: asset 8.0 vs `[0, 0, 7.5]` (mansion.json:14) — 0.5 m out.
* **eye height**: `extras.eye_height_m` 1.6 vs `EYE_HEIGHT = 1.65` (view.ts:18).
* **lightmap list** names a `.ktx2` that does not exist.
* Agreeing: yaw 0 ↔ facing (0,0,−1); doorway `axis z, at −10, center 0, 2.4×3.2`
  ↔ inner face z = −10; AABB `[−7,0,−10]…[7,7,10]` ↔ the interior (the mesh
  rightly runs past it to −10.45 / 7.35).
* The einstruct fallback shell's 0.2 m wall at z ∈ [−10.2, −10] (rooms.ts,
  `WALL_THICKNESS`) sits inside the hall's 0.45 m jamb slab — doubled geometry.

## Visual

preview.png matches the note; known issues 1–7 all read true. Two it misses: the
sun does **not** climb the right-hand wall (floor and far wall only), and the
floor is featureless flat grey — see finding 4.
