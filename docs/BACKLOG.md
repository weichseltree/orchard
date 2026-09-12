# Backlog

Ordered. Items with a name in brackets wait on that person.

## Waiting on a deploy

0. **[Manuel] `cd grove && pnpm deploy`**: the sky outside the windows and the
   client that resolves hangings from the exhibit table are built, tested and
   committed but not live. The harness refused the deploy command from the
   agent session (production deploy); run it, or allow `pnpm deploy` for the
   agent.

## Blocking the M0 definition of done

1. **[Manuel] Enable R2** in the Cloudflare dashboard (R2 Object Storage,
   Purchase R2; free tier). Then: `uv run orchard r2 ensure`, and hang the
   two M0 exhibits, which pushes them first:
   `uv run orchard exhibit hang results/bundles/2dd0038799b2db15 --approve`
   (the ab_d2 tape) and
   `uv run orchard exhibit hang results/bundles/216b720501856b14 --approve`
   (the 40 s clip). Verify
   `https://media.weichseltree.com/2dd0038799b2db15/bundle.json`; re-run the
   production smoke test and confirm the tape sheet and the video wall load.
   The other harvested bundles (the einstruct master, the spectre master and
   assembly, the styleframe) wait on their own rulings; `orchard exhibit
   hang` will not take an unapproved one.
2. **[Manuel] Release the custom domain in Patreon** so the apex
   `weichseltree.com` stops being Patreon's SaaS hostname; then re-validate the
   Pages domain (docs/HOSTING.md). `www.weichseltree.com` already serves the grove.
3. **[Manuel] Hardware pass**: Quest 3 browser (XR entry, controllers,
   teleport, scrub, 72 Hz) and an iPhone (native HLS, touch stick). Everything
   past `requestSession` is untested on hardware (docs/impl/WP2-grove.md).

## Known visual issues from the first deploy

4. ~~Hall windows read as black rectangles with a bright rim~~ — fixed
   2026-09-12 in the client: a gradient sky dome outside the mansion with the
   sun where the bake put it (`grove/src/world/sky.ts`, `sky` in
   `mansion.json`; DECISIONS). **[Manuel] Deploy it**: `cd grove && pnpm
   deploy` (LAWS 22, publishing needs approval). The dome's colours are a
   first guess and belong to item 6.
5. Lightmap ships as a 2.2 MB PNG; produce KTX2 (UASTC) when `toktx` is
   installed (it is not on this box; KTX-Software ships a `.deb`), and a
   1024² tier for phones.
6. Windows' blown highlights and the plain grey palette; a first pass of
   material and colour design for the hall (LAWS 12, 13).

## M1 (company)

7. Spatial voice through Cloudflare Realtime (needs CLOUDFLARE_REALTIME_*
   in secrets and the CSP's `microphone` and `connect-src` widened).
8. The greenhouse: admin identity in the browser, review queue and rulings
   read from the private tables, a directives panel; the flat dashboard gains
   the same three panels.
9. `orchard sync` as a service: push trees and the ledger snapshot on a timer
   (systemd user unit, like expdash), pull rulings back into `trees/*.yaml`.

## Platform

10. ~~`orchard bundle` for stills; `orchard exhibit` calling `hang`;
    provenance sidecars~~ — done 2026-09-12 (docs/impl/M2-harvest-exhibit.md).
    A `still` hanging on the hall's poster wall followed the same day.
    Left: splats.
11. The spacetimedb SDK's `Function()` codegen forces `unsafe-eval` in the
    CSP; open an upstream issue asking for a non-JIT path.
12. Second node on Legion and the first portal (M3).
