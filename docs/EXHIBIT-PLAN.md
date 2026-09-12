# The first exhibit plan

What hangs in the grove this round, per tree, and what each tree needs to
get there. Filled in from the trees' answers to
[BRIEF-FOR-TREES.md](BRIEF-FOR-TREES.md); the manifests
(`<repo>/orchard.yaml`) stay the record, this page is the reading of them.
Started 2026-09-12; the first slate is einstruct, spectre, world-engine,
phototroph and premosaic (whose kill criterion fired 2026-08-18; it answers
whether anything survives), with someotherlife answering as a mechanism
donor rather than an exhibit tree.
Each tree answers from a session in its own repo; the orchard session
coordinates over SendMessage.

## Hanging now

| tree | kind | bundle | where |
|---|---|---|---|
| einstruct | tape, ab_d2 (801 frames, 200,000 → 2,634 particles) | `2dd0038799b2db15` | einstruct room, the sheet |
| einstruct | clip, ab_d2 segregation 40 s | `216b720501856b14` | einstruct room, the wall |

## Bundled, waiting on a ruling

| tree | kind | bundle | ruling needed |
|---|---|---|---|
| einstruct | still, ab_d2 styleframe | `c59c7baa6fd15489` | hang on the hall's poster wall? |
| einstruct | master, ep05 chemistry animatic 4:30 (~100 s silent) | `e95baa0fa9f068fc` | not until narration is fixed (LAWS 5) |
| spectre | master, EP02 S5 excerpt 42.8 s, no audio | `0462efca96af7297` | hang silent, or wait for style B? |
| spectre | clip, EP03 assembly v6, 8:25 with VO | `2527c24bbbde0982` | judged barely watchable; probably not |

## Per tree

One block per tree, filled from the tree's answer. Empty until it answers.

### einstruct
Answered 2026-09-12 by einstruct-33; manifest at einstruct 1056f1f, 6
phenomena, 25 artefacts, 1 thesis, all 25 bundled (21 new, 192 MB from 4.3
GB, the four live ab_d2 rows unchanged), nothing new approved. The harvest
ran before the commit fix landed, so the producing commits it had recorded
were overwritten with the harvest-time describe; they survive in each tape
header's `git` and each render manifest's `einstruct_git`, and the tree was
asked to restore them, which the fixed harvester now preserves.
- shows this week: five more tapes, all video/tape/1 through spectre's
  writer. ab_d2_stir (801 frames over 400 tau, 200,000 to 292 particles,
  2.1 GB): the control, colours shuffled every 20 steps, regions never
  form; the twin of the tape already hanging, and the pick. aa_d2 (one
  colour, the case where the textbook is right, 2.1 GB). lj_droplet (301
  frames, 256 particles, 3-D with velocity, 2.3 MB). lj_liquid-open (an
  open cube melting into a droplet, 10 MB) and lj_liquid-dense (13 MB).
  Each tape has a flat render clip of 10 to 20 s. Eleven explainer
  animations: only `row` is clean; walk, slab and bag need a one-line
  caption fix; counter, like, front, mechanism, dose and null show check
  ids or "registered", and the last three belong to a retired line.
- E32: not watchable yet; a static fixture with light-ground figures. The
  one watchable limit (48 nearest distances give the pressure exactly until
  the fluid is squeezed and the answer comes out low, never high) is listed
  as the phenomenon short_list_reach; a 12 s anim would show it on CPU.
  It gives "throw away the axes" an ending, not a number; that thesis is
  folded into the chemistry episode's first minute (row + walk, 30 s).
- what is left on Rows read chemistry: the claim is wrong. The decay
  exponent tracks whatever the decay is (-0.93 stirred, -0.87 one colour)
  and a particle count gives it without distances. What only distances
  give is the segregation ratio: the nearest other-colour partner is 8.8x
  as far as the nearest own-colour particle, against 1.0 when stirred. New
  number; the picture is the two tapes side by side with nine times fewer
  particles left in the stirred one. Then: "rows" never introduced;
  repo-speak in the voice and P-numbers on screen; 108 s silent (162 s of
  takes against 270 s of picture: re-cut to the takes, do not add words);
  two light figures; clocks and counters drawn on the particles (a style
  ruling); no camera or light; no music, titles, chapters, thumbnail; the
  voice from a random draw; no gate tying spoken numbers to their command.
  Stage animatic, blocked by all nine.
- artefact/: an untracked 284 KB single-file companion page from
  2026-09-07 on the retired coarse-simulation line; the film's palette
  comes from it. Not a harvestable kind. Commit or delete: Manuel's call.
- mechanism of the mansion, correcting PLATFORM: the tape format is
  spectre's; einstruct's candidate is a point's distances at the visitor's
  scale saying whether a cluster reads as a line, a sheet or a volume from
  where they stand, a level-of-detail signal for point clouds as
  premosaic's is for meshes. Untested. Otherwise einstruct is an exhibit.
- needs: 0 GPU h; a lit hero shot (spectre's Mitsuba, about 14 lane-hours
  per 40 s) only after a styleframe ruling; 6 CPU h for re-renders and dark
  redraws; 15k TTS characters (re-voicing four shots plus an audition); 5
  GB disk. Second node: E34's members, which are science, not film.
- kill: E34's held-out-dimension check; a rate law fitted in 2-D that
  misses 1-D and 3-D by more than 25% leaves the tree one episode. Nothing
  yet shows distances beating coordinates; potential below the fund's 8.
- room: the ab_d2 film as the floor, 632 sigma square, the stirred twin
  beyond a glass wall; a mirror wall where the reflection's row is
  identical and its forces are not; off the room, a street, a square and
  a stairwell lit with lamps at unit spacing, so walking twice as far
  passes 2x, 4x and 8x the lamps: "a dimension is how fast neighbours
  arrive" as architecture.

### spectre
Answered 2026-09-12 by spectre-fe; manifest at spectre 585ac72, 4 phenomena,
7 artefacts, 1 thesis at styleframe (down from the draft's animatic, on
purpose). Not harvested: 19.9 GB of source, and the harvester's tape digest
had to be fixed first (done, see below). After chi6 completes, one harvest
reads about 30 GB on one core in 10 to 20 minutes and writes about 63 MB per
tape.
- shows this week: the planet trio. adiabat-chi0 and adiabat-chi12 (1,129
  frames, 508,744 particles, 9.76 GB each), adiabat-chi6 finishing its last
  chunk (row added once `exp wait` confirms). Identical (step, t) per frame
  across the three, chi6's frames an exact prefix, cadence 2.0 tau with the
  same 12 chunk seams; t=0 is the end of relaxation, the ball still 50/50.
  Frame index keeps them aligned, so one scrubber drives all three. The
  bundler picks the same 3,975 slots in all three (now a tested guarantee).
  The other ten tapes are probes: the openings show about 30 bundled points
  of core swelling, firststeps, fine, smoke; the v00 slab (43,750 frames)
  needs a frame window; the e10 mixture tapes have no data. Stills: the
  locked style-B styleframe B_astro and two plates (shot 13 particle scale,
  shot 5 the body small in space), each with a render sidecar named
  `<stem>.json`. The two bundled rows keep their ids; two text fields were
  corrected (EP02 S4 not S5; H.264 viewing copy, made by final_pass at
  b8c5f00). Never hang the 8:25; the 42.8 s only as a silent wall loop, as
  a clip not a master (LAWS 18).
- mechanism of the mansion: the tape's clock contract (t0_origin,
  t0_offset_tau, per-frame step and t) is what lets one scrubber drive N
  tapes; the trio is the first exhibit that needs it. The core cannot be
  seen from outside a ball: the way of seeing is a hand-held cut plane that
  fades over one sigma (LAWS 11) and cuts all three at once. The per-particle
  heat channel `ke` carries the core heating and the bundler drops it. The
  distillation is not a mechanism yet: no coarse model exists, and the kill
  says so.
- thesis: planet-from-scratch. An even heavy/light mix in a self-gravitating
  ball: does the heavy kind find the middle, and how would you know it was
  not put there? Number: 97% heavy inside r<30 (a fifth of the particles)
  against 38% outside at 24 dynamical times, chi 12; the whole ball 50.0% in
  every frame. Picture: the trio sliced at one moment reading 53 / 83 / 97%
  (the draft's "core in only one" was false; chi6 grows one too). Blocked:
  plates for 4 of 18 shots, all from one tape frame, so the contact sheet
  was never rendered or ruled; the script must be rewritten because the
  world is a ball and never collapses; the verdict waits on chi6.
- the style-B redesign: PIPELINE.md, ep03/design.py (direction B locked),
  styleframes.py, shots.py (18 shots, 17 distinct, 11 moving, variety
  clean), stagings.py, 9 plates. Candidly one brown disc at different
  zooms; the redesign should use time and the trio, not only the camera.
- the verdict tool's dress rehearsal (a727137): three instrument defects
  (a finished chunk read as unfinished because the broken gpurun of 09-10
  printed after BALL COMPLETE; chi0 read as "drainage winning" when it has
  no domains; deciding numbers on a knife-edge, now flagged AT THRESHOLD),
  no threshold changed. Through row 11 nothing converged, nothing degraded.
- needs: 0 GPU h (plates render on CPU), 6 CPU h, 12k TTS, $5 LLM, 5 GB.
  Nothing for a second node; shipping 30 GB of tapes costs more than
  bundling here. The missing measurement is a second seed for the trio,
  about 86 GPU h, not asked for this round.
- remote: wanted, private, after a secrets scan. The history was rewritten
  on 08-25 and reboots have torn objects; a sha on one disk is not
  provenance, and lanepush refuses an unpushed HEAD.
- room: true black, the style-B palette (iron-warm heavy, pale light; the
  grove's orange and blue break LAWS 12). Three balls at walking scale with
  one shared scrubber and the cut plane; B_astro and the two plates on the
  wall; the 42.8 s loop. For the building: the chi12 ball hanging in the
  sky above the orchard as a moon. Honest, since every point sits where the
  tape put it.
- as the studio's supplier: the studio takes, as a copy at a pinned SHA
  after which spectre deletes its own, audio/vo.py, pacing.py, post
  (encode, animatic, overlay, diagrams, bloom, firefly, boil, plates),
  check/variety.py, scene/ with Rig.verify, render/plate.py, stock.py and
  secrets.py, and the generic part of mts (render, camera, scene,
  sampling, sequence). spectre keeps core/video/tape.py, which should become
  a small pinned package since einstruct and orchard import it unpinned;
  mts/matter, look, guts, tape_frame, cull, synth, teaching; and
  lanes/m03_first_film with measure.py binding the spoken numbers
  (LAWS 24).
- harvester bugs it found: (1) tape digest was header-only, no mid-write
  guard: fixed 2026-09-12; (2) commit stamped with HEAD: fixed; (3) species
  named A/B in orange and blue when header meta has species_masses [2,1]:
  backlog; (4) only `<file>.json` sidecars carried, the measured numbers
  live in `<stem>.json`: backlog; (5) `ke` dropped: backlog; (6) one mean
  dt of 1.981 lets times drift up to a tau inside a chunk: backlog; (7)
  3,975 slots show 1 point in 128 and a slice reads sparse, wants a
  per-artefact slot budget and frame stride (16k slots at every 4th frame,
  about 36 MB): backlog, first.

### world-engine
Answered 2026-09-12 by world-engine-8f; manifest at world-engine 6b8bd6c,
status dormant, three stills harvested and verified here (ok on all three,
1.7 MB together), none approved.
- shows this week: three stills. Behind the chair (the true view, then torn,
  stretched, stretched per object, holes in magenta: the bake-vs-bend row),
  `0a674d5fc6ec8899`. The fringe round a chair leg six ways,
  `df31b52fbd0faada`. The classroom rebuilt from 28,112 spheres in 2.1 MB
  from a head position never shown, `8fd0f876cee6a54f`, the only whole-room
  picture, its produced_by reconstructed. The classroom is the CC0 Blender
  demo; every still carries a stock sidecar. Plus bent-light.html: one file,
  78.7 KB, no external requests, no eval, four 2D canvases on
  requestAnimationFrame, one takes pointer drag, sliders and buttons,
  follows prefers-color-scheme; an essay with four live figures.
- alive? Dormant. Last commit 2026-08-11; the founding question (one small
  network holding a world of repeated objects) answered no on three lines.
  Stays alive only if the lens becomes the M5 doorway; the kill says so.
- mechanism of the mansion, correcting PLATFORM: loops and portals need no
  lens, they are graph topology plus a stencil portal and a teleport, and
  should not wait for this tree. A lens cannot make a loop. "Larger inside
  than outside" plain portals already do with a cut; the lens adds
  continuity, the space visibly expanding across a threshold band. That is
  the only part that is theirs. Real today: a 2D numerical proof and the
  2D page. No 3D, no shader, nothing on a headset.
- the one number: unknown. Reasoning: a spherically symmetric lens collapses
  to a 1D table, one ray-sphere hit, one table read, one cubemap fetch per
  covered pixel, the class of a refraction material; a general lens needs
  tens of integration steps per pixel. Kill: prune if the symmetric doorway
  costs more than 2 ms per frame on a Quest 3 browser at about 15% of each
  eye. The client would expose a per-portal fragment material, the far room
  as a baked cubemap or a second per-eye pass, per-eye matrices and the lens
  frame as uniforms, stencil and depth compositing, a locomotion hook
  (speed divides by n inside the lens), a tier fallback to a plain portal,
  and a GPU timer query, if the Quest browser has one.
- thesis: lens-doorway. Can a doorway open onto a room larger than its wall
  with light bending honestly at the threshold instead of cutting? Number:
  Quest 3 milliseconds per frame. Picture: a hall doorway where the room
  beyond bends open, rays curving at the threshold. Stage thesis, blocked
  by no 3D lens, no shader, no Quest timing, no client hook. The nearer
  alternative from existing stills: "looking beats guessing", a seventh
  baked view beats the best stretched guess by about one JOD (5.19 vs 4.24).
- needs: 0 GPU h, 2 CPU h (a ray tape if greenlit: rays through a lens as
  particles, time as distance along the ray, a day of writing), 0.5 GB.
  The real needs are a Quest 3 in hand for one timing run and 1 to 2 days
  of a session writing the shader. Nothing for a second node.
- room: its doorway is the lens; from the hall the room swells past its
  wall. Inside, the three stills, the four live figures on walls if an
  interactive kind exists, and the ray tape to stand inside. Under 2 ms,
  every threshold in the palace bends instead of cuts; otherwise prune to
  three stills and one page.
- interactive kind, the orchard's reading: not this round. The page runs
  as a flat page in the Quest browser already, so the room links to it;
  inside the immersive grove the canvases would need re-hosting as wall
  textures with synthetic pointer events. A `page` kind (one self-contained
  HTML file, CSP-clean, opened flat from a plaque) is the cheap version and
  is what the plan proposes.

### premosaic
Answered 2026-09-12 by premosaic-57; manifest at premosaic 4c2d1e1, status
archived (the schema has no "pruned"), two stills harvested and unapproved,
no thesis, budget zero, lane none.
- shows this week: two stills, 400 px light-theme matplotlib with axes and
  a title, poster wall at most and never letterboxed dark (LAWS 7, 13).
  `de02c4fd02881d3c` a lid-driven cavity: the cheapest honest description
  per square puts the kinetic tiles in one row under the moving lid and
  nowhere else, 16 of 256 tiles, mass conserved exactly (2fdf90d).
  `ae70864df21aa916` one frame of Turing stripes cut into 49 tiles, 44 a
  single wave each, spacing right to a tenth (2c60850). The plotting
  command was never recorded; produced_by says so and gives the command
  that regenerates the data. The other eleven PNGs are sprite sheets and
  diagnostics.
- the kill, with numbers: beat B1 (step only non-empty cells) on rigid
  advection at fixed fidelity or stop. At n=256 over 400 steps at 5% of
  occupied RMS the engine ran at 0.50x, 0.53x and 0.68x of B1, which is
  bit-exact there; its own abstraction was 1.00x at every point that met
  the budget, predicted in closed form before the run.
- mechanism of the mansion: none. Strike "adaptive tessellation as level
  of detail" from PLATFORM.md: tile-granular scheduling lost 1.5 to 2x to
  a per-cell mask, three quarters of the flops went to deciding; "exact
  where you look" was never tested; grove LOD is conventional rendering.
  The one transferable lesson is negative: never pay a per-region
  model-selection step at runtime unless it is far cheaper than what it
  saves.
- thesis: none. The only story is the kill, and an episode that is only a
  mistake breaks LAWS 6.
- needs: nothing. The open line (a propagator that can express a shift) is
  a different engine and belongs in a new repo.
- room: none; at most two posters on a wall of pruned trees.
- the frozen JAX file: a pip freeze of the deleted 5 GB venv, written by
  the 2026-09-09 disk reclaim; the only record of the environment behind
  the Flow Lenia and advection stages. Commit as the reproduction pin:
  Manuel's call.

### phototroph
Answered 2026-09-12 by phototroph-04; manifest at phototroph 524db21, zero
artefacts, one thesis, resolves on the board and the harvest bundles nothing.
- shows this week: nothing that should hang. The two simulation clips from
  1 Sep predate four physics fixes (Q66, Q76, Q77, Q80), one ran at a flux
  that does not bind, and both carry counter panels and per-species hue
  (LAWS 7, 12). The 119 animatic clips are assembly tests, the stock clips
  are fillers. The only stills on corrected physics are eight flat 854x480
  previews of the dimer-split bake: material for a styleframe ruling, not
  artefacts.
- mechanism of the mansion: not tapes (2D, matter only, light-starved) but
  spectral light. ptstudio's Mitsuba 3 spectral path (dispersive glass,
  measured solar spectrum, rainbow phase function, beam emitters, light
  tracing) is what would split sunlight into spectra on the palace floors.
  It renders camera frames today; lightmap and probe baking would be new
  work, uncosted.
- thesis: h1-pigment. Shine one colour on a soup of atoms long enough: do
  the clumps that form start catching that colour? Number: lit-minus-dark
  pigment index over 8 seeds per arm against a threshold fixed before
  launch. Picture: the same box lit and dark side by side; the null is
  also the picture. Stage thesis, blocked by the Q77/Q42 rate decision.
- needs: 20 CPU-h, 0 GPU, 2 GB, prio cap 5. In kind: Legion runs half of
  H1's seeds from a pinned commit on the cpu lane; the members are
  independent single-thread jobs. Tape export is a ~60-line CPU converter
  from PTVF into spectre's writer, matter only (bonds and photons have no
  slot in video/tape/1); dimer-split is motion-grade now and independent
  of the rate decision. Corrected later the same day: dimer-split is an
  existing dump, so its tape is a pure conversion (frames 1600 to 2400,
  801 frames, about 0.13 MB, CPU seconds, channels species and bond_count
  since video/tape/1 has no bond slot); producers.tape and notes hold the
  one exprun (phototroph 0b2e2ba). Whether a flux or horizon member can
  resume with a changed cadence is unverified.
- room: the 2D world as a floor about 7 by 4 m with a gallery above, light
  entering by a clerestory along one long wall and leaving by the open
  walls. Grey particles, hue only where one is excited. Today that is a
  dim grey gas where clumps form and dissolve, which is the truthful
  picture; after H1, two floors, lit and dark.
- as the studio's donor: take storyboard, assembly, budget with measured
  render coefficients, narrate with measured takes, the PTVF lift with its
  detonated-frame guard, stock provenance, and check_runs.py (re-runs a
  bake's command and requires bit-identical output). Leave the React
  editor and server; keep Mitsuba as a plugin behind tapes. Lesson: check
  a board's picture against a bake before narration.
- pruned? Not yet. No episode until H1 reads; the kill says so.

### someotherlife
Answered 2026-09-12 by someotherlife-c6; manifest at someotherlife 270723a,
0 artefacts, 0 phenomena, one thesis (the Spike C capture) with a kill
date. The fund's stub `trees/someotherlife.yaml` was added the same day so
the tree resolves. Every number below is a prior from public demos, not a
measurement (its ADR 0006 keeps unmeasured numbers out of its own docs).
- shows this week: nothing. 20 SVG glyphs and 25 voice lines sit in notes.
- the splat bundle it would design: SPZ (Niantic, MIT; about 10x smaller
  than PLY, the payload of the Khronos glTF splat extension work, whose
  ratification status is to be checked), raw PLY kept as source and never
  shipped. bundle.json mirrors its SplatAssetSchema: per tier file, splat
  count, SH degree, bytes; bounds and frame (metres, +Y up, floor at 0);
  stations with position, yaw and a MEASURED coverage radius; capture id,
  consent ref, provenance; two sidecars, a small glTF occluder/floor mesh
  (splats cannot be raycast or depth-written cheaply) and an AVIF preview.
  Tiers pruned from one reconstruction: vr-high 1.5 to 2M splats SH 2 to 3
  (25 to 50 MB), vr-quest 300 to 500k SH 0 to 1 (5 to 10 MB), phone 150
  to 250k SH 0 (2 to 4 MB), preview the still; a room 40 to 70 MB, one
  download, nothing streamed. Decoder Spark (World Labs, MIT): three.js
  native, reads PLY/SPZ/SPLAT/KSPLAT, WebGL2 and WebXR, sorts in a WASM
  worker, which `_headers` already allows. Watch: the grove sends COOP
  without COEP, so no SharedArrayBuffer; pick a sort path that does not
  need it. Quest 3: the sort is the bottleneck (10 to 20 ms for 500k on
  CPU, run asynchronously, pops on fast turns); 72 Hz holds at 300 to
  500k at reduced framebuffer scale. Draw order: opaque glTF with depth
  write, then splats depth-tested without depth write back to front, then
  transparent grove content.
- mechanism of the mansion, correcting PLATFORM: a phone capture is not a
  walkable room but a vantage point; parallax holds only inside the
  measured radius. The mechanism is the measured headbox: stand on a marked
  spot, locomotion stops, lean and look, step off and walking returns. It
  suits windows, doorways and alcoves, and a window is a natural headbox,
  so real captured views outside the hall's windows (the orchard) are the
  strongest fit. Foliage in wind is a harder capture. Avatars come after
  Spike C and are not for this round.
- what to lift from its client (three 0.185, TypeScript strict, no eval,
  strict-CSP clean): not XR entry (the grove's local-floor rule stays) but
  one fix from xr/support.ts, a token so an older probe can never report
  over a newer one, which the grove's watchXrSupport lacks; no locomotion
  (it has none by design); desktop/orbit.ts and focus.ts, an orbit camera
  distance-clamped to the coverage radius, for splat rooms only;
  input/dwell.ts and input/raycast.ts (mouse ray, two controller rays, 300
  ms dwell, nearest hit) if exhibits get point-to-select.
- thesis: a room shot on one phone, stood in with a headset: how far can
  you lean before the walls come apart? Number: the measured lean radius
  in metres at the standing point on Quest 3 at 72 Hz, checked at 0.5 and
  1.0 m. Picture: one corner from the standing point and the same corner a
  metre to the side where it tears. Stage thesis, blocked by no shoot, no
  toolchain, no splat render pass. Spike C may run in parallel with M1.
- needs, Spike C in budget terms (unmeasured): gpu_h 5 (SfM matching plus
  three reconstructions of about an hour on 8 GB; fits Legion's 7.3 GB at
  reduced resolution, a fair in-kind job), cpu_h 4, disk 15 GB peak, prio
  cap 10; the owner about 1 h shooting a room they own and half a day
  measuring in the headset. Before any of it the capture tooling must be
  committed there (nodes run pinned code), and licensed for it: gsplat
  (Apache-2.0), not INRIA's non-commercial original. Kill: pruned as a
  donor if Spike C misses 72 Hz at a 0.5 m lean or no room is shot by
  2026-11-30.
- room: a closed door until a capture exists, not a proxy box. With one, a
  vantage point: a real cellar, one marked spot, locomotion off inside the
  radius, a gentle fade guiding the visitor back past it.

## Rulings this plan asks of Manuel

Collected here as the answers come in; each is one `orchard exhibit hang
<dir> --approve` or a verdict in the flat dashboard.

- **einstruct, hang the stirred twin.** ab_d2_stir `903d0c5a939b0ba1`
  beside the ab_d2 tape already in the room, the segregation-versus-stirred
  pair that is the new thesis picture; harvested 2026-09-12 (einstruct
  1056f1f, 21 bundles, 192 MB from 4.3 GB, verified here). One
  `orchard exhibit hang results/bundles/903d0c5a939b0ba1 --approve`.
  Recommended yes. The `row` animation `f0b3eba5f655c2a9` as a clip
  likewise; walk, slab and bag need a re-render for their captions (the
  text is drawn into every frame), so not this round.
- **einstruct, the thesis number changes.** "Predicted from rows" was
  wrong; the segregation ratio (8.8x against 1.0 stirred) replaces the
  decay exponent. Rule that the animatic is re-cut to the takes on the new
  number before any narration or music spend.
- **einstruct, clocks and counters on the particles.** A style ruling
  (LAWS 7): overlays off the tape, or a plaque beside it.
- **einstruct, the styleframe.** `c59c7baa6fd15489` is bundled and waits;
  the tree now says a lit hero shot comes only after a styleframe ruling,
  so this is the still to rule on.
- **einstruct, artefact/.** Commit the companion page or delete it.
- **spectre, a private remote.** After a secrets scan; the harvest stamps
  commits that otherwise live on one disk, and in-kind jobs need a pinned
  commit. Recommended yes, before its harvest.
- **spectre, the 42.8 s excerpt.** Rule its kind master to clip and hang it
  as a silent wall loop, or leave it down. Recommended: hang, as clip.
- **spectre, the styleframe.** B_astro and the two plates as the style-B
  candidates on the review queue; the 18-shot contact sheet has never been
  rendered, so this is the ruling before any plate spend.
- **spectre, the trio.** Hang chi0, chi6, chi12 in the room once chi6
  completes and the harvest lands, with the shared scrubber and the cut
  plane as grove work. Recommended yes; it is the exhibit of this round.
- **spectre, the moon.** The chi12 ball above the orchard. A look ruling
  when the grounds exist; noted for the palace.
- **premosaic, two posters.** On a wall of pruned trees, if the hall grows
  one; and commit the frozen JAX file as the reproduction pin.
- **someotherlife, fund Spike C now?** One hour of your shooting, half a
  day in the headset, about 5 GPU h on Legion in kind. Recommended yes if
  the orchard grounds are the first capture target; it decides the splat
  kind's real numbers.
- **phototroph, the rate decision (Q77/Q42).** Owner picks the collisional
  rate with the derivation Q77 asks for, informed by H1's scan; then
  goldens rebaselined, the Bose-Einstein gate green over 8 seeds, the dt
  pair re-run, the witness tolerance pinned. Owner time, a separate
  reviewing session, CPU hours. Nothing in phototroph moves before it.
- **phototroph, one tape for the room.** Fund the ~60-line PTVF converter
  and a motion-grade dimer-split window (minutes of CPU on exprun,
  prio 5), so the tree has one honest thing to hang: the dim grey gas.
  Recommended yes; it is independent of the rate decision.
- **world-engine, hang the three stills.** All verified. The classroom
  `8fd0f876cee6a54f` on the hall's poster wall or the world-engine room
  (recommended: the room, it is the tree's only whole picture); the
  bake-vs-bend row and the fringe in the room. One `orchard exhibit hang`
  each with `--approve`.
- **world-engine, the Quest timing.** The 2 ms question needs your Quest 3
  and a session writing the symmetric-lens shader first (1 to 2 days).
  Decide whether that session runs this round or the tree stays at three
  stills and a page. Loops and plain portals do not wait on it.
- **world-engine, the `page` kind.** Add a self-contained HTML artefact
  kind opened flat from a plaque, and hang bent-light.html as the first.
  Orchard work, about a day; recommended yes.
- **phototroph, the dimer-split previews.** Eight 854x480 stills as a
  styleframe candidate on the review queue, or wait for the tape.

## Second wave

event-atoms, mosaic, HNL. Not trees: stratum (a design document with no
implementation) and autora (a product app, not research).
