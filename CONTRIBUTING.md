# Contributing to the orchard

Help someone understand a result by seeing it. Useful contributions include
clearer first visits, reliable particle playback, device testing, better
documentation and integrations that carry the source of a result with it.

Start with the [local demo](grove/README.md#first-run). It runs without
production credentials or access to the research repositories. Read
[brand/VOICE.md](brand/VOICE.md) for public copy and
[docs/LAWS.md](docs/LAWS.md) for scientific and editorial rules.

## Choose an area

| Area | Start here | Useful checks |
| --- | --- | --- |
| First visits and controls | `grove/src/ui/`, `grove/src/control/` | Keyboard, touch layout, browser console, grove tests and typecheck |
| Particle playback | `grove/src/tape/`, `grove/src/world/tape-exhibit.ts` | Tape tests, scrubbing, provenance and a browser visit |
| Research integration | `orchard/manifest.py`, `orchard/harvest.py`, `packages/tape/` | Relevant Python tests and a local bundle verification |
| CLI and dashboard | `orchard/cli.py`, `orchard/dashboard/` | Relevant Python tests and local dashboard inspection |
| World state and moderation | `spacetime/AGENTS.md`, `grove/scripts/module-check.ts` | Local database checks and generated bindings |
| Site and documentation | `grove/index.html`, `README.md`, `docs/` | Links, mobile layout, keyboard navigation and factual claims |

[BACKLOG.md](docs/BACKLOG.md) contains known gaps and the evidence still
needed. Historical implementation notes record what was checked at the time;
rerun the relevant check before claiming a current result.

## Set up and verify

From the repository root, for Python work:

```bash
uv sync --locked
uv run pytest tests/test_bundle.py
# Run the complete Python suite for changes that cross components:
uv run pytest
```

For grove work:

```bash
cd grove
pnpm install --frozen-lockfile
pnpm demo
```

In a second terminal, from `grove/`:

```bash
pnpm test
pnpm typecheck
pnpm build
```

The [Checks workflow](.github/workflows/checks.yml) runs the Python suite
(including dashboard interactions), grove tests, TypeScript checks and the
production build on pull requests and pushes to `main`. It uses locked
dependencies and does not publish. Tests against locally harvested research
bundles report a skip when those gitignored files are absent; synthetic
playback tests still run. Database integration and physical-device checks
remain separate.

Choose tests that exercise the changed behavior. For controls and layout,
also visit the page, navigate by keyboard and inspect a narrow viewport.
Record which browser and device you used. A simulated mobile viewport does
not count as an iPhone test; a desktop WebXR probe does not count as a
headset session.

Keep synthetic fixtures in `grove/dev/` and local bundles in
`results/bundles/`. Everything in `grove/public/` may reach the public
build; it is not a scratch directory. Do not replace accepted camera
stations or rebake room assets merely to update a UI screenshot.

## Propose a change

A useful pull request explains the concrete problem, what happens after
the change, and how you checked it. For a visible change, include a before
and after image or a short recording. For a research integration, include
the input format, the command that produced the result, its provenance and
any playback or size limits.

Keep scientific claims tied to evidence. Do not present synthetic particles
as simulation results or a local test as production validation. Preserve
failed evidence when it explains a limitation. New specimen media needs a
source, permission to redistribute it, and the appropriate provenance.

Use an isolated local database for reducer and moderation tests. Commands
such as `orchard push`, `orchard exhibit hang`, `orchard sync` and
`pnpm run deploy` can change hosted state; they are not part of the local
contribution checks. Real credentials belong outside the repository as
described in [secrets.example.env](secrets.example.env).

## Report a problem

Include the page or command, what you expected, what happened, and steps
that reproduce it. For grove issues, include browser, device, room, whether
you used the local demo, and any relevant console error. Remove tokens and
private paths from logs before sharing them.

The platform is licensed under [AGPL-3.0-or-later](LICENSE).
