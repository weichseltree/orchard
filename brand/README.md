# The Observatory visual identity

The Observatory is the current place you enter in **the grove**, the
orchard's browser world. Its public presentation uses dark mineral colours,
warm ivory type, brass entrances and a cool nocturnal atmosphere. This
inventory follows the implemented Observatory rebuild, dated 2026-09-14.

weichseltree remains Manuel Weichselbaum's research channel. The orchard is
the open source platform behind the grove. The Observatory names the museum
and its first room; it does not rename the research trees.

## Where the current design lives

| Surface | Implementation | Character |
| --- | --- | --- |
| Public landing page | [grove/index.html](../grove/index.html) | Large serif titles, fine brass rules, three research chapters and a browser architecture capture |
| Browser controls and guide | [grove.css](../grove/src/ui/grove.css), [config.ts](../grove/src/config.ts) | Mineral panels, ivory text, brass actions, system sans-serif type |
| Museum architecture | [observatory.ts](../grove/src/world/observatory.ts), [mansion.json](../grove/src/world/mansion.json) | Thick portal reveals, stone surfaces, luminous fixtures and long views through connected rooms |
| Scientific exhibits | [mansion.json](../grove/src/world/mansion.json), [exhibit-content.ts](../grove/src/ui/exhibit-content.ts) | Each tape keeps its recorded positions and has a stated interpretation and limit |
| Legal pages and local dashboard | [privacy](../grove/public/privacy/index.html), [impressum](../grove/public/impressum/index.html), [dashboard](../orchard/dashboard/index.html) | The earlier dark green weichseltree identity remains in use |

[tokens.json](tokens.json) records selected values from the current landing
and browser controls. It is documentation, not an imported stylesheet or a
runtime dependency. The linked implementation is authoritative. Update the
catalog when changing those values; do not add speculative tokens for
components or media that have not been built.

## Colour and material

| Role | Landing | Browser controls |
| --- | --- | --- |
| Background | `#080d14` | `#09111c` |
| Main text | `#f0eadf` | `#eee9df` |
| Body text | `#bec5cf` | `#c3c9cf` |
| Secondary text | `#96a1b2` | `#a1afbd` |
| Brass emphasis | `#d6bb87` | `#e1bd82` |

The two surfaces are related but do not use identical values. The landing
has square entrance buttons and generous editorial spacing. Browser panels
are compact; the visitor guide and recovery screen use opaque backgrounds
so their text does not depend on the world behind them. Destructive controls
retain a separate muted red treatment.

Architecture has its own palette in `OBSERVATORY_PALETTE` and room-specific
finishes in `observatory.ts`. The Gravity Chamber is darker, the Binding
Chamber warmer, and the Lantern Walk cooler. Surface shading, grain and
light pools are authored architectural effects. They are not measured
illumination from a research simulation or a claim of a physically baked
scene.

Brass and blue in the architecture carry no scientific meaning. Particle
colours are separate: the current hanging can supply an explicit palette.
Its guide must explain that palette consistently with the tape's species
indices. Do not recolour a scientific picture to match the page, imply that
kind means temperature, or claim the browser automatically transports a
source palette that it does not read.

## Type, marks and movement

The landing's display stack is **Iowan Old Style, Palatino Linotype, Book
Antiqua, Georgia, serif**. These are locally available fonts with a serif
fallback; no font file is requested. Body copy uses `system-ui, sans-serif`.
The page base is 16 px with a 1.65 line height; display headings are weight
400 and emphasis is 600. Its content width is at most 1440 px, with smaller
gutters and a single column on phones. Heading sizes respond to the viewport
and text can reflow when enlarged.

The HUD uses `14px/1.45 system-ui, sans-serif`. The current guide uses weight
500 for headings and 600 for emphasis; changing readouts use tabular
numerals. The timing panel uses a system monospace stack. Follow the actual
CSS for component sizes and breakpoints rather than applying the landing's
large typography inside the world.

The landing wordmark is **grove**, with **by the orchard** underneath and a
small inline SVG made of three portal outlines. This architectural mark is
part of the page source. The existing green seed remains the
[favicon](../grove/public/favicon.svg) and appears on the older legal pages;
it has not been replaced with an invented app-icon family.

The page does not animate its architecture capture or simulation poster.
Chapter hover feedback lasts 180 ms and is disabled for reduced motion.
Keep visible keyboard focus, the working Skip to content link, 44 px discrete
touch targets and narrow-screen text reflow. Inline prose links are distinct
from the discrete touch-target product requirement.

## Names and research story

[VOICE.md](VOICE.md) and [LAWS.md](../docs/LAWS.md) still govern plain language,
scientific honesty and the personal identity behind the work. The current
visitor names below supersede the older room descriptions in the archived
package. Internal room identifiers stay stable for links and provenance.

| Visitor name | Room identifier | Landing chapter |
| --- | --- | --- |
| The Observatory | `hall` | Entrance |
| The Mixing Chamber | `einstruct` | Patterns |
| The Gravity Chamber | `spectre` | Worlds |
| The Binding Chamber | `phototroph` | Bonds |
| The Reconstruction Gallery | `world-engine` | Additional exhibit |
| The Long Gallery | `gallery` | Between exhibits |
| The Lantern Walk | `orangery` | Between exhibits |
| The Horizon Terrace | `terrace` | Outdoor view |
| The Meridian Garden | `parterre` | Grounds |

Invite visitors to compare recorded runs. Do not describe changing a
simulation parameter as an available browser control. A heavy centre leaves
a causal question open; one capture does not establish equilibrium or
binding rates. The current
[exhibit plan](../docs/EXHIBIT-PLAN.md) and guide carry these boundaries.
The local demo uses synthetic particles, so its captions and guide cannot
inherit the research interpretation.

## Images and remaining assets

- [observatory.webp](../grove/public/site/observatory.webp) is the landing
  hero and share image: a 1600 × 900 browser capture of the local demo.
  Distant particles are synthetic. Caption it accordingly; it does not
  establish live-media availability or headset rendering quality.
- [particle-tape.png](../grove/public/site/particle-tape.png) is the unchanged
  einstruct poster, frame 400 from the sampled `vr-high` variant of bundle
  `2dd0038799b2db15`. It is scientific source imagery, separate from the demo
  capture. Preserve its pixels and source caption.
- [imagery.json](../grove/public/site/imagery.json) is the source and encoding
  record for the public images. The older Austrian hall render remains in
  [docs/img/palace-still-hall.png](../docs/img/palace-still-hall.png) as
  historical imagery, rather than the Observatory's current hero.

There is no new filmed tour, sound-cue collection or PNG app-icon family in
this rebuild. The SVG favicon still ships. The old sound and media wish list
is preserved as a proposal in the archive, not presented as existing media.

## Earlier identity

The [2026-09-13 README](archive/2026-09-13/README.md) and
[token catalog](archive/2026-09-13/tokens.json) are preserved byte-for-byte
from before this update. They describe the earlier green interface and
Austrian palace presentation, including its then-current asset inventory and
proposals. Resolve relative links in the archived README from its original
`brand/` location; its claims about what was current are dated evidence.

The legal pages, local dashboard and seed favicon still use elements of
that earlier identity. This documentation update does not recolour them,
change scientific images, or replace archived room evidence.
