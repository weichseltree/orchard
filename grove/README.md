# the grove

Walk through particle tapes, watch the result beside them, and inspect their
sources. The grove is the orchard's browser world: Three.js, strict
TypeScript and Vite, with desktop, touch and WebXR controls.

The current world is [the Observatory](../docs/specs/OBSERVATORY.md):
illuminated vaults, dark research chambers and open gardens, built directly
in the browser. The former palace scene and bake tools are archived for
reproduction; their GLBs and lightmaps are not shipped by this scene.

## First run

Requirements: **Node.js 22** and **pnpm 10.29.2**. From this directory:

```bash
pnpm install --frozen-lockfile
pnpm demo
```

Open [localhost:5173/grove/?demo](http://localhost:5173/grove/?demo).
The command writes synthetic fixtures, prepares the texture decoder and
starts Vite. You land in the Mixing Chamber beside a particle tape, with a
visible local-demo label. No API keys, cloud account, Python environment or
SpacetimeDB server is needed. Dependency installation needs a network
connection; the running demo reads its world and media locally.

The particles are **synthetic test data, not a research result**. FFmpeg is
optional: when available, the generator adds a short test video; otherwise
the demo shows tapes alone. Generated files live in gitignored `dev/`, are
served only in development, and are excluded from `dist/`. The `?demo` flag
has no effect in a production build.

## Controls

| Action | Desktop | Touch | WebXR controllers |
| --- | --- | --- | --- |
| Walk | WASD or arrow keys | Bottom-left stick | Left stick |
| Look | Click the view, then move the mouse | Drag the view | Turn your head |
| Pause or play | Space or play button | Play button | Trigger |
| Scrub time | `[` / `]` or time slider | Time slider | Right stick |
| Inspect sources | P or About this view | About this view | Menu button |
| Teleport | — | — | Hold squeeze, aim at floor, release |
| Release pointer | Esc | — | — |

On desktop, **X** changes playback speed, **M** toggles video sound when
available, and **F** opens frame timing. Sound starts muted until you choose
to play it. WebXR requires a compatible browser and a secure context; hand
tracking is not implemented. Quest and iPhone hardware acceptance remains
open in [BACKLOG.md](../docs/BACKLOG.md).

## Develop with research bundles

```bash
pnpm dev
```

The home page is at [localhost:5173/](http://localhost:5173/) and the world
at [/grove/](http://localhost:5173/grove/). Without `?demo`, the scene uses
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
| `VITE_TURNSTILE_SITEKEY` | Public human-check site key |

These settings are embedded in the browser build. Keep signing keys and
service tokens in the server-side configuration described in
[SECURITY.md](../docs/SECURITY.md) and
[secrets.example.env](../secrets.example.env).

`src/world/mansion.json` describes the palace's rooms, doorways, spawn
positions and hangings. A hanging names a tape, video or still. Its `exhibit`
reference follows the live table; its pinned bundle identity is the fallback
when the database cannot answer. To inspect a room directly, open
`/grove/?room=einstruct`; add `&demo` for local fixtures.

## Check and build

```bash
pnpm quality
pnpm preview
```

The build writes `dist/index.html` and `dist/grove/index.html`, checks
immutable asset names, and includes the production service worker.
Preview serves that build at [localhost:4173](http://localhost:4173), using
its build-time media and database settings. It does not serve demo fixtures.

For automated browser checks, run `pnpm exec playwright install chromium`
once, then `pnpm quality:all`. This adds desktop/touch layout, keyboard,
accessibility and cold/warm production loading checks with local fixtures.
[Quality measurements](../docs/QUALITY.md) defines each metric and the JSON
reports under `../results/quality/`. Press **F** while the world has focus
to see frame percentiles; `window.grove.metrics()` returns a local diagnostic
snapshot from browser developer tools.

`pnpm check:bindings` checks generated database bindings and requires the
SpacetimeDB CLI. Before changing the database module, read
[spacetime/AGENTS.md](../spacetime/AGENTS.md) and run
[`scripts/module-check.ts`](scripts/module-check.ts) against a local
database; its header lists the setup. It exercises room visibility,
rate limits, reports and moderation. Unit tests and a desktop browser check
do not establish headset frame rates or phone playback compatibility.

## If something does not load

| Symptom | Next step |
| --- | --- |
| Missing `/local-bundles/…` | Open `/grove/?demo` after `pnpm demo`, or harvest the scene's real bundles into `../results/bundles/`. |
| Missing `/dev-bundle/…` | Stop Vite and run `pnpm demo` again. It creates the files before Vite mounts them. |
| No test video | Install FFmpeg if you want video playback, then restart `pnpm demo`. Particle playback works without it. |
| Port 5173 is occupied | Stop the existing Vite server, or run `pnpm dev --port 5174` and open `/grove/?demo` on that port after generating fixtures. |
| A database warning outside the demo | Configure a local database or use `?demo`. World rendering and locally available media do not depend on presence. |
| No Enter VR button | Check the browser's WebXR support and secure context. Desktop controls remain available. |
| An old deployed page persists | Visit with `?nosw` to disable the worker for that visit, then reload. |

The production service worker verifies media against bundle digests and
caches it within a device-tier budget. It is not installed by `pnpm dev`.
An available update offers a reload outside a headset session. Hosts can
deploy with `GROVE_SW=off pnpm run deploy` to retire the worker and caches;
normal deployment restores them. Deployment configuration is in
[HOSTING.md](../docs/HOSTING.md).

Current implementation and measured limits are recorded in
[WP2-grove.md](../docs/impl/WP2-grove.md). Spatial voice, browser host access
and linked nodes remain work ahead.
