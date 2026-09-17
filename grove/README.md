# Weichselmind

Walk through particle tapes, watch the result beside them, and inspect their
sources. Weichselmind is Orchard's browser world: Three.js, strict
TypeScript and Vite, with desktop, touch and WebXR controls, and a live
presence layer on SpacetimeDB.

The world is [the Mind Palace](../docs/specs/OBSERVATORY.md): a hall and
its research chambers, a gallery, an orangery, a terrace and gardens, an
orrery at another scale, a linked repository's area of rooms with the
repository itself as a table model, and a club in the cellar. All of it is generated in the browser from one scene document
and lit by a light field baked from its own lamps; no GLB, lightmap or
Blender bake ships with this scene.

## First run

Requirements: **Node.js 22** and **pnpm 10.29.2**. From this directory:

```bash
pnpm install --frozen-lockfile
pnpm demo
```

Open [localhost:5173/mind/?demo](http://localhost:5173/mind/?demo).
The command writes synthetic fixtures, prepares the texture decoder and
starts Vite. You land in the hall with a visible local-demo label. No API
keys, cloud account, Python environment or SpacetimeDB server is needed.
Dependency installation needs a network connection; the running demo reads
its world and media locally.

The particles are **synthetic test data, not a research result**. FFmpeg is
optional: when available, the generator adds a short test video; otherwise
the demo shows tapes alone. Generated files live in gitignored `dev/`, are
served only in development, and are excluded from `dist/`. The `?demo` flag
has no effect in a production build. The demo has no server, so there are no
locks: every door that leads to a room opens, including the club's; the sealed
doors to repositories without rooms stay sealed.

## Controls

| Action | Desktop | Touch | WebXR controllers |
| --- | --- | --- | --- |
| Walk | WASD or arrow keys | On-screen stick, bottom-left | Left stick |
| Look | Click the view, then move the mouse | Drag the view | Turn your head |
| Pause or play | Space or play button | Play button | Trigger |
| Scrub time | `[` / `]` or time slider | Time slider | Right stick |
| Inspect sources | P or About this view | About this view | Menu button |
| Go there | Click the floor | Tap the floor | Hold squeeze, aim at the floor, release |
| Frame an exhibit | Click it, or N / Shift+N; Esc ends | Tap it | — |
| Plan of the area | L or the Map button | Map button | — |
| Talk | Hold “Hold to talk” in the chat | Hold to talk | Press a thumbstick in |
| Ask the host | Type in the chat | Type in the chat | B/Y opens a menu of asks; right stick chooses, trigger sends |
| Take an offer | Its button | Its button | Trigger |
| Release pointer | Esc | — | — |

On desktop, **X** changes playback speed, **M** toggles video sound when
available, **C** cycles what a planet shows (lit, composition, temperature,
pressure; the buttons below the view do the same), **G** opens the game at
a table you stand at, and **F** opens frame timing. Sound starts muted until
you choose to play it. WebXR requires a compatible browser and a secure
context; hand tracking is not implemented. Quest and iPhone hardware
acceptance remains open in [BACKLOG.md](../docs/BACKLOG.md).

Some doors ask something of you. The club opens only when your microphone
and your sound are on; its stage only to an immersive session. A barred door
shows a curtain of light, bumping it says why, and the foyer offers the two
switches. Allow the microphone outside VR first: a headset cannot raise the
prompt. [CLUB.md](../docs/specs/CLUB.md) explains the rule.

## Develop with research bundles

```bash
pnpm dev
```

The home page is at [localhost:5173/](http://localhost:5173/) and the world
at [/mind/](http://localhost:5173/mind/). Without `?demo`, the scene uses
the real exhibit references in `src/world/mansion.json`. Development media
defaults to the parent repository's `results/bundles/`, served as
`/local-bundles/`; a fresh checkout has no harvested results there.

The database defaults to the live orchard, while the token service is off
in development because Vite does not run Pages Functions. Use `pnpm demo`
for independent local work. To test your own database, set the public
connection settings when starting Vite:

```bash
VITE_SPACETIME_URI=ws://127.0.0.1:3000 VITE_SPACETIME_DB=orchard-check pnpm dev
```

| Setting | Purpose |
| --- | --- |
| `VITE_MEDIA_BASE` | Directory URL serving real bundles; local `/local-bundles` in development, the configured R2 host in builds |
| `VITE_SPACETIME_URI` | SpacetimeDB WebSocket URL |
| `VITE_SPACETIME_DB` | Database name |
| `VITE_AUTH_URL` | Visitor token service URL; empty disables it |
| `VITE_VOICE_URL` | Voice grant route (Deepgram); empty hides hold-to-talk |
| `VITE_TURNSTILE_SITEKEY` | Public human-check site key |
| `VITE_FTL_CHESS_ENABLED` | `0` hides the chess table's game surface (on by default) |

These settings are embedded in the browser build. Keep signing keys and
service tokens in the server-side configuration described in
[SECURITY.md](../docs/SECURITY.md) and
[secrets.example.env](../secrets.example.env).

`src/world/mansion.json` describes the rooms, their doorways, spawn
positions and hangings. A room's box has a floor (`bounds.min[1]`): rooms
stand at different heights, a doorway between two floors gets a flight of
steps in the lower room, and a room may stand over another (the club under
the wing). A hanging names a tape, video, still, planet or live audio
stream; its `exhibit` reference follows the live table and its pinned bundle
identity is the fallback when the database cannot answer. A room may carry
`portals` to a room of another `scale` (the garden's armillary leads to the
orrery), `gameSurfaces` for a table, `repoModels` for a repository's folders on a
table (their lists live in `src/world/repos/`), `wallLines` for short
records on a wall, and `requires` for what it asks of a visitor. The
grounds' mounds are `terrain.mounds`. An area's plan is folded in with
`scripts/import-area.mjs`. Wall text lives in
`src/world/labels/<lang>.json`, one file per language, and every room and
hanging must be named in each. To inspect a room directly, open
`/mind/?room=einstruct`; add `&demo` for local fixtures. A link into a room
that asks something lands at its door.

## Check and build

```bash
pnpm quality
pnpm preview
```

The build writes `dist/index.html` and `dist/mind/index.html`, checks
immutable asset names, and includes the production service worker.
Preview serves that build at [localhost:4173](http://localhost:4173), using
its build-time media and database settings. It does not serve demo fixtures.

For automated browser checks, run `pnpm exec playwright install chromium`
once, then `pnpm quality:all`. This adds desktop/touch layout, keyboard,
accessibility and cold/warm production loading checks with local fixtures,
a room tour that visits every room three times and counts what it leaks,
and `pnpm quality:world`, which photographs eighteen rooms from a fixed
camera on each one's own floor and holds the world's architecture under
sixteen draw batches a room, averaged across every room.
[Quality measurements](../docs/QUALITY.md) defines each metric and the JSON
reports under `../results/quality/`. Press **F** while the world has focus
to see frame percentiles; `window.grove.metrics()` returns a local diagnostic
snapshot from browser developer tools.

`pnpm check:bindings` checks generated database bindings and requires the
SpacetimeDB CLI; `pnpm check:rooms` checks that every presence room the
scene joins exists in the module and in the live database (it needs the
admin identity; `node scripts/check-rooms.mjs` alone checks the module).
Before changing the database module, read
[spacetime/AGENTS.md](../spacetime/AGENTS.md) and run
[`scripts/module-check.ts`](scripts/module-check.ts) against a local
database; its header lists the setup. It exercises room visibility,
rate limits, reports, areas and moderation. Unit tests and a desktop browser
check do not establish headset frame rates or phone playback compatibility.

## If something does not load

| Symptom | Next step |
| --- | --- |
| Missing `/local-bundles/…` | Open `/mind/?demo` after `pnpm demo`, or harvest the scene's real bundles into `../results/bundles/`. |
| Missing `/dev-bundle/…` | Stop Vite and run `pnpm demo` again. It creates the files before Vite mounts them. |
| No test video | Install FFmpeg if you want video playback, then restart `pnpm demo`. Particle playback works without it. |
| Port 5173 is occupied | Stop the existing Vite server, or run `pnpm dev --port 5174` and open `/mind/?demo` on that port after generating fixtures. |
| A database warning outside the demo | Configure a local database or use `?demo`. World rendering and locally available media do not depend on presence. |
| A door will not open | Outside the demo a door needs the server's room row and whatever the room asks for; the notice says which. |
| No Enter VR button | Check the browser's WebXR support and secure context. Desktop controls remain available. |
| An old deployed page persists | Visit with `?nosw` to disable the worker for that visit, then reload. |

The production service worker verifies media against bundle digests and
caches it within a device-tier budget; a live audio stream is never cached.
It is not installed by `pnpm dev`. An available update offers a reload
outside a headset session. Hosts can deploy with `GROVE_SW=off pnpm run
deploy` to retire the worker and caches; normal deployment restores them.
Deployment configuration is in [HOSTING.md](../docs/HOSTING.md).

Current implementation and measured limits are recorded in
[WP2-grove.md](../docs/impl/WP2-grove.md). Voice between visitors, the
club's stream and karaoke queue, and room acoustics are the work ahead
([CLUB.md](../docs/specs/CLUB.md)).
