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
- shows this week (first word): world-engine-8f (2026-09-12): sphere-space headbox figures (bake-vs-bend comparisons, fringe and matte crops of the classroom scene) and bent-light.html, a self-contained page of four live 2D lens experiments. No tape, no clip.
- mechanism of the mansion:
- thesis:
- needs:
- room:

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
- **phototroph, the dimer-split previews.** Eight 854x480 stills as a
  styleframe candidate on the review queue, or wait for the tape.

## Second wave

event-atoms, mosaic, HNL. Not trees: stratum (a design document with no
implementation) and autora (a product app, not research).
