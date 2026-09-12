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
   material and colour design for the hall (LAWS 12, 13). **[Manuel] Rule
   on a palette** (LAWS 14): `bake_hall.py --palette {stone,warm,gallery,
   moss}` renders each; the four 96-sample previews are side by side in
   `docs/img/hall-palettes-2026-09-12.png` (stone is the M0 bake). Say
   which, or what to change, and the 1024-sample bake (21 min CPU) plus
   the KTX2 step and a deploy follow. The blown windows are the preview's
   exposure, not the palette: the client has the sky dome in them now.

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
