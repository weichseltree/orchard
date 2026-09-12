# Backlog

Ordered. Items with a name in brackets wait on that person.

## Blocking the M0 definition of done

1. ~~**[Manuel] Enable R2**~~ Done 2026-09-12: R2 on, bucket and domain
   created, the ab_d2 tape (`2dd0038799b2db15`) and the 40 s clip
   (`216b720501856b14`) pushed, verified byte for byte, and hung on
   einstruct as exhibits 1 and 2; both serve from
   `https://media.weichseltree.com/` with the right content types and CORS
   for the production origin. The definition of done's items 1 and 2 hold.
   Still owed from the first production visit: nobody has yet walked into
   the einstruct room on the live site and watched the sheet and the wall
   load; the local client did against the same bytes. The other harvested
   bundles (the einstruct master, the spectre master and assembly, the
   styleframe for the hall's poster wall) wait on their own rulings;
   `orchard exhibit hang <dir> --approve` is the whole step for each.
2. ~~**[Manuel] Release the custom domain in Patreon**~~ Done by 2026-09-12
   16:30: both Pages domains report active and `https://weichseltree.com/`
   serves the grove.
3. **[Manuel] Hardware pass**: Quest 3 browser (XR entry, controllers,
   teleport, scrub, 72 Hz) and an iPhone (native HLS, touch stick). Everything
   past `requestSession` is untested on hardware (docs/impl/WP2-grove.md).

## Known visual issues from the first deploy

4. ~~Hall windows read as black rectangles with a bright rim~~ — fixed
   2026-09-12 in the client: a gradient sky dome outside the mansion with the
   sun where the bake put it (`grove/src/world/sky.ts`, `sky` in
   `mansion.json`; DECISIONS). Deployed 2026-09-12 with the exhibit-table
   client (`cd grove && pnpm run deploy`; `pnpm deploy` without `run` is
   pnpm's own workspace command and fails). The dome's colours are a first
   guess and belong to item 6.
5. ~~Lightmap ships as a 2.2 MB PNG; produce KTX2~~ Done 2026-09-12:
   KTX-Software 4.4.2 in `~/tools/ktx` (`toktx` on PATH),
   `grove/tools/compress_lightmap.py` writes `lightmap.ktx2` (2048², 1.9 MB,
   UASTC q2 + zstd 18, mipmapped) and `lightmap-1024.ktx2` (0.6 MB) and
   records both in hall.json and the glb; `mansion.json` lists the KTX2
   first with the PNG behind it, and a `lightmapPhone` list gives the phone
   the 1024 tier (`lightmapCandidates`, tested). Headless Chromium loads the
   2048 KTX2 through the Basis transcoder and the hall reads as before; the
   phone tier is unit-tested only (the headless shell does not emulate touch).
6. Windows' blown highlights and the plain grey palette; a first pass of
   material and colour design for the hall (LAWS 12, 13). **Ruled 2026-09-12:
   gallery** (charcoal walls, near-black polished floor), from the four
   previews in `docs/img/hall-palettes-2026-09-12.png`. Baked at 1024
   samples (794 s CPU, scale 2.969, 0.007% clipped), KTX2 tiers encoded,
   verified and deployed 2026-09-12 17:12. verify_hall.py now reads the
   baked palette from hall.json instead of the stone constants. Still
   open under this item: the doorway's light spill on the floor (WP3 known
   issue 2, a rebake with the neighbour room in place) and the windows'
   reveals, which the sky dome now sits behind.

## M1 (company)

7. Spatial voice through Cloudflare Realtime (needs CLOUDFLARE_REALTIME_*
   in secrets and the CSP's `microphone` and `connect-src` widened).
8. The greenhouse. ~~The flat dashboard gains the three panels~~: done
   2026-09-12, `orchard serve` shows the review queue with verdict buttons,
   the rulings, the directives (set and retire) and what hangs in the grove,
   all through the CLI's admin identity, local only. Left: the admin identity
   in the browser and the greenhouse room in the grove.
9. ~~`orchard sync` as a service~~ Done 2026-09-12: `orchard sync all`
   pushes the planted trees and the ledger snapshot and pulls rulings back
   into the manifests (a ruling's verdict and the review item's kind imply a
   stage; stages only move forward; `changes` writes `blocked_by`);
   `orchard sync install` puts `deploy/systemd/orchard-sync.{service,timer}`
   into the user's systemd, every 15 minutes, enabled and running on
   SirBase. `journalctl --user -u orchard-sync` is the log.

## Platform

10. ~~`orchard bundle` for stills; `orchard exhibit` calling `hang`;
    provenance sidecars~~ — done 2026-09-12 (docs/impl/M2-harvest-exhibit.md).
    A `still` hanging on the hall's poster wall followed the same day.
    Left: splats.
11. The spacetimedb SDK's `Function()` codegen forces `unsafe-eval` in the
    CSP. **[Manuel] File the issue**: the text is drafted with the line
    numbers in `docs/upstream/spacetimedb-unsafe-eval.md`; filing is under
    your GitHub account.
12. Second node on Legion and the first portal (M3).
13. **The palace and its orchard** (Manuel, 2026-09-12): the hall becomes
    the first room of a palace, Austrian in character, and the grounds
    outside the windows an actual orchard: terrain, trees, a garden the sky
    dome stands in for today. Needs a look ruling (stills first, LAWS 14)
    and a bake pipeline for exteriors; instanced trees for the Quest budget.
14. ~~**Talk to the trees.**~~ Done 2026-09-12: six trees answered
    (einstruct, spectre, world-engine, premosaic, phototroph,
    someotherlife); the answers and the rulings they ask are in
    `docs/EXHIBIT-PLAN.md`, the manifests in each repo's `orchard.yaml`.

## From the trees' answers (2026-09-12)

15. **Harvester, fixed the same day:** a tape's digest covers header, index
    and trailer and a tape still being written is refused; `commit` set by
    the tree survives a harvest; one unreadable manifest no longer blocks
    every tree (`portfolio.BROKEN`, a stderr line). The bundler's aligned
    slot choice across tapes with the same slot count is a test.
16. **Per-artefact slot budget and frame stride** (spectre bug 7): a
    manifest field on the artefact, so a 508k-particle tape can ship 16k
    slots at every 4th frame (about 36 MB) instead of 1 point in 128. First
    of the format items; blocks the trio reading as a ball when sliced.
17. **Species names and palette from the tape header** (spectre bug 3):
    `meta.species_masses` names heavy and light; the client's orange and
    blue break LAWS 12 for spectre's style B (iron-warm and pale). A
    per-exhibit palette in the hanging, defaulting from the header.
18. **The `ke` channel and per-frame `t`** (spectre bugs 5, 6): carry heat
    as a channel, and the index's per-frame t instead of one mean dt (drift
    up to a tau inside a chunk).
19. **`<stem>.json` render sidecars** (spectre bug 4): carry beside the
    stock `<file>.json` sidecar, under a different key; the measured numbers
    live there.
20. **One scrubber for N tapes, and a cut plane** (spectre): the clock
    contract already aligns the trio by frame index; the room needs a
    shared scrub and a hand-held cut plane fading over one sigma (LAWS 11).
21. **A `page` artefact kind** (world-engine): one self-contained HTML
    file, CSP-clean, opened flat from a plaque; bent-light.html first.
22. **A `splat` kind** (someotherlife): SPZ tiers, stations with a measured
    coverage radius, an occluder mesh and a preview still; Spark as the
    decoder; no SharedArrayBuffer path (the grove sends COOP without COEP).
    Needs Spike C's numbers first.
23. **Lift from someotherlife's client:** the XR-support probe token
    (stale "unsupported" can land last in the grove's watchXrSupport), the
    distance-clamped orbit for vantage-point rooms, dwell and raycast
    pointing if exhibits get point-to-select.
24. **Stage regression check in `orchard sync`:** spectre set its thesis
    back to styleframe on purpose; confirm a stale approved-animatic review
    row cannot push it up again.
