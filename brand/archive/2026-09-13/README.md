# The weichseltree brand package

What weichseltree looks and sounds like, in three files, so that a page, a
thumbnail, a HUD panel or a title card made by anyone in any session comes
out as one thing. Written 2026-09-12 against the shipped grove and the
gallery ruling (DECISIONS 2026-09-12).

| file | what it is | who reads it |
|---|---|---|
| `tokens.json` | colours, type, spacing, radii, motion, sound cues, and which assets exist; machine-readable | code, build scripts, a session making a page |
| `VOICE.md` | how weichseltree writes and speaks; names; what is never said | anyone writing a README line, a tweet, a narration take, a HUD notice |
| this file | what the package is and how to use it | you, first |

## What weichseltree is, in one line each

- **weichseltree** is a person's research channel: simulations, emergence,
  the mathematics of structure. It is not a company and does not talk like
  one.
- **The orchard** is the repo and the platform: trees, a fund, a studio, a
  grove. `orchard` is the name of the software; "the orchard" is the thing
  weichseltree runs.
- **The grove** is the public world at weichseltree.com/grove/. The current
  world has a hall and the einstruct, spectre, world-engine and phototroph
  exhibit rooms, plus a gallery, orangery, terrace, garden and orchard grounds.
- **A tree** is a research repo that registered. **A harvest** is what it
  hangs. **The greenhouse** is where rulings are made.
- **The palace** connects those rooms: Austrian in character, with orchard
  trees on the grounds outside the windows. Some rooms remain unfurnished;
  room models and local browser checks do not establish headset performance.

## The look, in four rules

1. **Dark, everywhere** (LAWS 13). Ground `#0e1310`, text `#d9e2da`. There is
   no light theme; a light figure is never letterboxed into it.
2. **Grey by default, one hue for meaning** (LAWS 12). The accent `#7fc97f`
   marks exactly four things: the way in (Enter, Enter VR), the host tag,
   playing, and the seed. `#c98a7f` marks failure and nothing else. Every
   other colour on a page is a grey from `tokens.json`.
3. **The world carries the light; the chrome stays out of it** (LAWS 7).
   Panels are translucent near-black with a hairline edge and a 6 px blur, no
   shadows, no counters on the world. The HUD shows numbers the visitor asked
   for or failures they need to know about.
4. **System type, one weight of bold.** `system-ui` at 14 px in the grove,
   16 px on pages; 600 for emphasis, never 700; tabular numerals on anything
   that ticks. No web fonts, because the client loads nothing from anywhere
   but itself (`grove/public/_headers`).

The materials of the hall itself are the gallery palette: charcoal walls,
near-black polished floor, the exhibits carry the light. Their linear albedos
are in `tokens.json` under `color.world`, copied from `grove/tools/bake_hall.py`.
They are not screen colours; do not paint a button with them.

## The mark

The wordmark is the word `weichseltree`, lower-case always, weight 600,
letter-spacing 0.02 em, with the seed before it: a 0.6 rem disc of the accent
with a 12 px glow. That is the whole identity today. There is no logo file, no
icon set, no pattern. If a platform needs a square avatar, it is the seed on
the ground colour (`asset.favicon` in `tokens.json` says the sizes). Do not
draw a tree.

## How to use the tokens

- **In the grove.** `grove/src/ui/grove.css` declares `--bg --text --dim
  --accent --panel --edge` on `:root` and `grove/src/config.ts` exports
  `PALETTE` with the same four hex values for Three.js materials. Those are
  the tokens' `color.ui.*`; change them in one place and copy the hex into
  the other. A token that is not yet in the CSS (`body`, `rule`, `faint`,
  `bad`) is inlined where used today; lift it into `:root` when you touch
  that file.
- **On a page.** Copy the `:root` block from `grove/index.html`. Body copy
  stays within 36 rem, page padding is 24 px, headings are 600. The landing
  page places its text and real imagery in a responsive layout up to 1160 px
  wide; the legal pages keep their reading columns. Green marks a way into
  the grove, never a follow or funding link.
- **In the flat dashboard** (`orchard serve`). Same ground, same greys, same
  one accent. It is admin-only and may show every number; it still uses no
  other hue, so a ruling button that means "approve" is accent-bordered and
  "reject" is plain, never red and green.
- **In video** (titles, thumbnails, inserts). Black ground, the same greys,
  the accent for the seed only. Particle colours come from the tape header's
  species palette (BACKLOG 17), never from the brand.
- **Adding a token.** Add it to `tokens.json` with a `$description` saying
  what it is for and where it is used, then use it. Do not add a second
  accent; if something needs a colour to mean something, that is a ruling
  (DECISIONS), not a token.

## How to use the voice

Read `VOICE.md` before writing anything a visitor, viewer or contributor
reads. The short form: plain words, numbers, no hype, no repo-speak, first
person past tense when it is Manuel speaking, and the names in the table
there. The banned list in `VOICE.md` is enforced on narration by the studio's
checks (LAWS 5); on everything else it is enforced by reading.

## What exists and what is missing

`tokens.json` `asset.*` says. The landing page now uses an unchanged poster
from einstruct's simulation tape (`grove/public/site/particle-tape.png`) and
an explicitly labelled architectural render (`grove/public/site/hall.webp`).
The hall uses lossless WebP with verified identical decoded pixels; the
original PNG and the encoding provenance remain in the repository.
`grove/public/site/imagery.json` records their source paths, dimensions and
sha256 digests; the tape record also names its sampled variant and frame.
The tape poster is the share image. The architectural render must never be
captioned as a browser screenshot or as evidence of headset rendering quality.

The SVG favicon is the seed (`grove/public/favicon.svg`). The four palette
previews remain in `docs/img/hall-palettes-2026-09-12.png`. A live browser hero
still with loaded exhibits and the 20-second clip are still missing; those
remain separate from the landing page's existing source imagery. PNG app
icons at 32 and 180 px remain to be made.

## Where the sound is

Nothing yet. `tokens.json` `sound.cues` names eight cues and a channel ident
with lengths and characters, so that they get produced once, in one session,
and never re-recorded. The narration voice is chosen by audition (LAWS 19) and
named by `ELEVENLABS_VOICE_ID`.
