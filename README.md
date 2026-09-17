# the orchard

Walk inside a particle simulation. Pause it, move through it, and see where
the picture came from.

The orchard turns research outputs into rooms you can visit in a browser.
Its public world, **the Mind Palace**, hangs particle tapes, films, stills and
cut-open planets in a nocturnal palace and its grounds, and lets visitors be
there together: desktop, phone or headset, with no account and no install.
Its local tools collect those outputs, keep their provenance, and let the
host choose what hangs.

[Visit the Mind Palace](https://weichseltree.com/mind/) ·
[Run the local demo](#run-the-local-demo) ·
[Bring your research](#bring-your-research) ·
[Contribute](CONTRIBUTING.md)

![The palace, with illuminated vaults, layered stone portals and a suspended brass fixture.](grove/public/site/observatory.webp)

*The palace in the browser, captured in the local demo with controls
hidden. Distant particles are synthetic playback fixtures.*

## What is in the world

Every room is named after the repository whose work it shows, or after what
it is. The architecture is generated in the browser from one scene document
(`grove/src/world/mansion.json`); nothing is modelled by hand.

- **The hall** and three research chambers off it: **einstruct** (a mixture
  against its control), **world-engine** (a reconstruction study) and
  **phototroph** (a lit and a dark world of atoms in lockstep). Each chamber's wall text says what to
  look for and what the evidence cannot show, in eight languages.
- **The gallery** and its **belvedere**, with closed doors for repositories
  that have not earned a room yet.
- **The orangery** in the north wing, with a chess table at its far end.
- **The terrace, the garden and three groves**, on a rolling ground with a
  height field the feet, the trees and the steps all share.
- **The orrery**, reached through the garden's armillary: a portal between
  scales, where coarsen's cut-open worlds hang as planets at solar scale. Step
  through and you shrink fifty times.
- **arcedit's area**: six rooms off the gallery's east door, five at walking
  scale with something of that repository's to see, and in its workshop the
  repository's folders as a table model, a small city read by looking; the
  sixth is inside the task's canvas, through a portal. Any public repository
  under a redistributable licence can be linked as an area, with its own
  admins.
- **The club**, a cellar under the north wing (September 2026): a stair
  pavilion at each end of the terrace descends to an undercroft that opens into
  a vaulted dance floor with a bar, booths, a DJ's desk and a raised stage. Its
  door opens only to a visitor whose microphone and sound are on; the stage
  only to a headset. The floor plays a live stream, a seeded techno set
  encoded on the host only while someone is in the club, and the lights pulse
  to it. [CLUB.md](docs/specs/CLUB.md) is the design and what it still
  asks for.

## What you can do

- **Explore a result.** Walk through recorded particles, pause time, move
  frame by frame, and inspect the tape's source. Click the floor to glide
  there, click an exhibit to frame it with its panel, step through a room's
  exhibits, or open the plan of the area. Desktop, touch and WebXR controls
  share one world; a headset gets a pointer teleport and a wrist menu, a phone
  gets a dock.
- **Be there with others.** Visitors share rooms live: avatars, a room chat,
  a host who answers when named (Faye, the palace's spirit, who also reads the
  compute running on the host's machines), hold-to-talk voice, and cues the
  host can fire into a room. Moderation is the host's across the world and
  an area admin's inside their area.
- **Show your research.** Bundle particle tapes, videos, stills and planets
  with content hashes and provenance. Hang approved outputs without rebuilding
  the client: a room follows the live exhibit table.
- **Link a repository.** An area is a repository the world renders as rooms,
  governed by its own admins, behind a licence gate and a live revocation the
  host holds.
- **Run an orchard.** Track research trees, measured compute spend, review
  requests and rulings from a local dashboard. A tree is a research
  repository; its harvest is what visitors can see.

This is a working platform, not a finished one. Playback, rooms, media
bundles, presence, chat, voice to the host, areas and the local dashboard are
implemented and live. **Quest and iPhone hardware validation remains open.**
Voice between visitors, the club's karaoke queue and room acoustics are the
work ahead; [CLUB.md](docs/specs/CLUB.md) §5 to §7 and
[BACKLOG.md](docs/BACKLOG.md) say in what order.

## New in September 2026

- **Runtime architecture.** The Blender bake is retired. Walls, vaults, stairs,
  colonnades and lamps are generated from the scene document and lit by a
  light field baked in the browser from the architecture's own lamps
  ([OBSERVATORY.md](docs/specs/OBSERVATORY.md)). Floors at different heights
  get their flights of steps for free; door names are letters in a 3D face.
- **Rooms over rooms.** The club sits under the wing and the undercroft under
  the terrace: navigation, loading and the bake all know a storey.
- **Areas and the trust layer.** `area`, `area_admin` and sanctions in the
  database; link, unlink, pause and revoke live; a licence gate on the link
  ([TREE-AREAS.md](docs/specs/TREE-AREAS.md),
  [SANDBOX-TRUST.md](docs/specs/SANDBOX-TRUST.md)).
- **Planets and portals.** The `planet` exhibit kind, the orrery at scale
  0.02, and the armillary portal that blends the two scales.
- **Faye, live.** The host's spirit stands in the hall, hears the room and the
  compute, and answers when named; voice reaches her through Deepgram
  ([VR-PRESENCE.md](docs/specs/VR-PRESENCE.md)).
- **The club and its door.** A room can say what it asks of a visitor
  (`requires`: microphone, sound, an immersive session); one lock answers for
  every way through a doorway, a curtain of light hangs in a barred door, and
  the foyer offers the switches ([CLUB.md](docs/specs/CLUB.md)).
- **Point-and-go controls.** A click or tap on the floor glides there through
  the same clamp a walk uses; an exhibit or its plaque frames itself; N steps
  to the next; L opens a plan of the area
  ([INTERACTION.md](docs/specs/INTERACTION.md)).
- **arcedit redesigned.** Six rooms with something to see instead of a
  corridor per folder, and the repository itself as a tabletop model.
- **A phone dock.** The panels and the chat open from a dock that fits short
  phones in both orientations; the walking stick stays bottom-left.
- **Live audio exhibits.** A stream is a name with no bytes behind it, never
  cached; the per-tier ladder of positioned sources and the field behind it
  are built, and the club's floor is the first stream
  ([AUDIO-STREAM.md](docs/specs/AUDIO-STREAM.md)).

## Run the local demo

You need **Node.js 22** and **pnpm 10.29.2**. Run from a fresh checkout:

```bash
git clone https://github.com/weichseltree/orchard.git
cd orchard/grove
pnpm install --frozen-lockfile
pnpm demo
```

Open [localhost:5173/mind/?demo](http://localhost:5173/mind/?demo). You land
in the hall. Click the view, use **WASD** or the arrow keys to walk, move the
mouse to look, and press **Space** to pause a tape. **Esc** releases the
pointer so you can use the on-screen controls. The demo has no server behind
it, so every door that leads to a room is open, including the club's; the
sealed doors to repositories without rooms stay sealed.

The demo generates its own synthetic particles and runs without API keys,
a database, production media or a headset. It is a playback demonstration,
not scientific evidence. If FFmpeg is installed, it also generates a test
video. Stop the server with **Ctrl+C**.

For touch controls, development settings, build checks and troubleshooting,
see [grove/README.md](grove/README.md).

For repeatable checks, run `pnpm quality` from `grove/`. It tests playback,
checks types, builds the site and enforces size budgets; `pnpm quality:world`
photographs the palace's rooms from fixed cameras and checks the draw budget.
[Quality measurements](docs/QUALITY.md) adds automated browser checks and
explains the local performance reports.

## Use the local tools

The Python tools require **Python 3.12 or later** and **uv**. From the
repository root:

```bash
uv sync --locked
uv run orchard --help
uv run orchard board
uv run orchard serve
```

Open [127.0.0.1:8787](http://127.0.0.1:8787) for the local dashboard.
The checked-in tree manifests let you inspect the portfolio without cloning
every research repository. The ledger reads local job records and expdash;
on a new machine, no recorded spend and an unavailable expdash are expected.
The greenhouse panels need a configured SpacetimeDB connection.

`uv run orchard doctor` reports installed tools and optional service
configuration. Missing cloud or narration credentials do not prevent the
local demo, portfolio inspection or bundle verification. Configure only the
services you intend to use; [secrets.example.env](secrets.example.env)
explains each group. Hosting setup is in [HOSTING.md](docs/HOSTING.md);
Faye's service is installed by `deploy/faye/install.sh`.

## Bring your research

The smallest integration is an existing result: a particle tape in
[`video/tape/1`](packages/tape/README.md) format, an MP4, a still image, or
a planet bundle. The bundler writes local output without publishing it:

```bash
uv run orchard bundle tape /path/to/tape --tree my-research --title "A particle tape"
uv run orchard bundle video /path/to/clip.mp4 --tree my-research --title "A result in motion"
uv run orchard bundle still /path/to/figure.png --tree my-research --title "A measured result"
uv run orchard bundle verify results/bundles/BUNDLE_ID
```

Replace the paths with your own files and `BUNDLE_ID` with the directory
name printed by the bundler. Video and still conversion require FFmpeg;
`orchard doctor` checks the media tools. Verification checks the bundle's
identity and recorded digests without a token.

For a continuing research tree, `uv run orchard scout /path/to/my-research`
drafts `trees/my-research.yaml`. Review its question, paths and artefacts,
then `uv run orchard plant my-research` writes `orchard.yaml` into that
research repository. That file becomes canonical; `trees/` keeps a mirror.

```bash
uv run orchard harvest my-research --dry-run
uv run orchard harvest my-research
```

Harvest bundles supported artefacts and records their hashes and bundle
identities. It refuses unfinished tapes and dirty research repositories by
default. It does not run simulations or publish results.

Once hosting is configured, `orchard exhibit hang results/bundles/BUNDLE_ID`
uploads and hangs an approved artefact. Adding `--approve` records the
host's ruling in its manifest. See the
[harvest and exhibit guide](docs/impl/M2-harvest-exhibit.md) for the full
flow, including dry runs and taking an exhibit down.

To give a repository rooms of its own, link it as an area:

```bash
uv run orchard area link my-research --licence MIT   # opens as a draft, admin-only
uv run orchard area admin add my-research <identity>
uv run orchard area state my-research live
```

The link is refused unless the licence named is a redistributable one.
[TREE-AREAS.md](docs/specs/TREE-AREAS.md) describes how an area's rooms
follow its directories, and [SANDBOX-TRUST.md](docs/specs/SANDBOX-TRUST.md)
what an area admin may and may not do.

## How it fits together

| Path | Purpose |
| --- | --- |
| [grove/](grove/README.md) | Browser world and public site; Three.js, TypeScript and Vite |
| [orchard/](orchard/) | Python CLI, manifests, bundling, areas, ledger and local dashboard |
| [packages/tape/](packages/tape/README.md) | Shared particle tape format and Python reader/writer |
| [packages/score/](packages/score/) | The score a live audio exhibit publishes beside its stream |
| [spacetime/](spacetime/) | World state, presence, chat, exhibits, areas and moderation |
| [deploy/](deploy/) | Faye's service, the club's stream encoder, and the host's sync timer and audit, as systemd user units |
| [trees/](trees/) | Draft manifests and mirrored research manifests |
| [studio/](studio/README.md) | Planned shared episode production tools |
| [docs/specs/](docs/specs/) | Design specs, the newer ones ending in the host's rulings |
| [docs/](docs/) | Implementation notes, hosting, security and validation evidence |
| [brand/](brand/README.md) | Visual identity and [writing voice](brand/VOICE.md) |

The fund buys an episode thesis: one viewer question, one measured number
and one picture. The intended stages run from a first idea through a
styleframe, animatic and render ruling to an episode and its room. Expensive
renders need a measured cost and a ruling first. [LAWS.md](docs/LAWS.md)
records the editorial rules; [BACKLOG.md](docs/BACKLOG.md) records work and
validation still owed.

The first orchard is [weichseltree](https://github.com/weichseltree)'s, run
by Weichseltree OÜ. Contributions to playback, device testing, documentation
and research integration are welcome; [CONTRIBUTING.md](CONTRIBUTING.md)
gives starting points and the checks for each area.

## License

[AGPL-3.0-or-later](LICENSE). You can run your own node and modify the
platform under the terms of that license.
