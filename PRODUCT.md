# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three audiences, in priority order (confirmed 2026-09-16):

1. The curious public, who should understand what Weichselmind is and step
   into the 3D world at `/mind/` (desktop, touch, WebXR).
2. Researchers, who judge credibility from the evidence and method on show.
3. Supporters and collaborators, who fund or join the work.

## Product Purpose

Weichselmind is Manuel Weichselbaum's public research world: recorded
particle simulations and their provenance, presented as rooms a visitor can
walk through. Orchard is the open-source platform (AGPL-3.0) behind it. The
landing page's job is to make the offer intelligible in one viewport and get
the visitor into the world; everything else is secondary.

## Positioning

No login, no installation, no tracking: a walkable record of real research
outputs where every exhibit keeps its source and its stated limits. The
evidence is the content — not renderings about the work.

## Operating Context

Runs at `https://weichseltree.com/mind/` on Cloudflare Pages + R2 +
SpacetimeDB. Installable PWA (manifest + service worker). Built from
`grove/` with Vite/Three.js; deployed via wrangler from WSL2. Legal pages
(`/privacy/`, `/impressum/`, Weichseltree OÜ) are fixed by EU/Estonian law.

## Capabilities and Constraints

- Fixed: the name **Weichselmind**, the `/mind/` world link, the legal
  pages, the AGPL source link.
- Replaceable: all landing-page visuals, copy, and the name "The
  Observatory" (explicitly dropped 2026-09-16).
- CSP is strict and self-hosted; no font downloads, no external analytics.
- Mobile and desktop must both work; headset path exists but is unvalidated
  on hardware.

## Brand Commitments

Name Weichselmind; the weichseltree channel, GitHub org and domain; links
to YouTube (@weichseltree), GitHub (weichseltree/orchard), Patreon
(/weichseltree). No binding visual assets: favicon, palette, typography and
all imagery are open to replacement.

## Evidence on Hand

Real exhibit material: `grove/public/site/particle-tape.png` (einstruct
simulation frame), `grove/public/site/observatory.webp` (browser capture,
its caption subject to change with the rename), provenance in
`grove/public/site/imagery.json`. Three research chapters exist:
einstruct (patterns), spectre/coarsen (worlds), phototroph (bonds), plus a
world-engine reconstruction study. No testimonials, metrics or press — do
not fabricate any.

## Product Principles

- The evidence leads; claims follow it.
- One obvious way in; no account, no install.
- Quiet and factual over marketing voice (stated preference: none recorded;
  the user said "nothing is off-limits; surprise me").
- Honest limits: every exhibit states what it cannot show.
