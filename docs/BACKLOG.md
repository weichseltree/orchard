# Backlog

Ordered. Items with a name in brackets wait on that person.

## Blocking the M0 definition of done

1. **[Manuel] Enable R2** in the Cloudflare dashboard (R2 Object Storage,
   Purchase R2; free tier). Then: `uv run orchard r2 ensure` and
   `uv run orchard push results/bundles/84b67b5a0d22eeab` and
   `uv run orchard push results/bundles/2dc8ca525724aefd`; verify
   `https://media.weichseltree.com/84b67b5a0d22eeab/bundle.json`; re-run the
   production smoke test and confirm the tape sheet and the video wall load.
2. **[Manuel] Release the custom domain in Patreon** so the apex
   `weichseltree.com` stops being Patreon's SaaS hostname; then re-validate the
   Pages domain (docs/HOSTING.md). `www.weichseltree.com` already serves the grove.
3. **[Manuel] Hardware pass**: Quest 3 browser (XR entry, controllers,
   teleport, scrub, 72 Hz) and an iPhone (native HLS, touch stick). Everything
   past `requestSession` is untested on hardware (docs/impl/WP2-grove.md).

## Known visual issues from the first deploy

4. Hall windows read as black rectangles with a bright rim: the openings are
   unglazed and nothing exists outside them in the client. Add a sky (emissive
   dome or HDR) outside the hall, or glaze the windows with an emissive pane
   matching the bake's sun. WP3 review, docs/reviews/WP3-hall-bake-review.md.
5. Lightmap ships as a 2.2 MB PNG; produce KTX2 (UASTC) when `toktx` is
   installed, and a 1024² tier for phones.
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

10. `orchard bundle` for stills and splats; `orchard exhibit` calling `hang`;
    provenance sidecars carried through from spectre's stock format.
11. The spacetimedb SDK's `Function()` codegen forces `unsafe-eval` in the
    CSP; open an upstream issue asking for a non-JIT path.
12. Second node on Legion and the first portal (M3).
