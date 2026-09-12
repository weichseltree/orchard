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
- shows this week (first word): einstruct-33 (2026-09-12): the ab_d2 tape and clip already hanging; four more tapes (aa_d2, ab_d2_stir, lj_droplet, lj_liquid); eleven finished explainer animations under results/film/anims. No lane time needed.
- mechanism of the mansion:
- thesis:
- needs:
- room:

### spectre
- shows this week (first word): spectre-fe (2026-09-12): 13 tapes in video/tape/1 (the m04 planet worlds at chi 0/6/12, m01 mixture demixing, the v00 fluid tape); the two bundled videos; style-B styleframes on disk.
- mechanism of the mansion:
- thesis:
- needs:
- room:

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
- shows this week (first word): premosaic-57 (2026-09-12): 13 small stills, the best 400 px matplotlib figures of adaptive tiles over Gray-Scott stripes and a lid-driven cavity; no tape, no clip. The engine runs 1.5 to 2x slower than the plain baseline, which is the kill.
- mechanism of the mansion:
- thesis:
- needs:
- room:

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
  of the rate decision; recorded flux members resume bit-exactly from
  checkpoints, so a motion window costs minutes of CPU.
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
- shows this week (first word): someotherlife-c6 (2026-09-12): nothing on disk as splat, still, clip or tape; Spike C has not run, so no captured room and no measured 6DoF budget. What exists is a playable WebXR room of draft proxies with a desktop fallback, 21 SVG glyphs and synthesized voice lines. Asked for the splat bundle spec it would design, the lift-ready client modules, and Spike C in budget terms.
- mechanism of the mansion:
- thesis:
- needs:
- room:

## Rulings this plan asks of Manuel

Collected here as the answers come in; each is one `orchard exhibit hang
<dir> --approve` or a verdict in the flat dashboard.

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
