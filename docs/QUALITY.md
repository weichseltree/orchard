# Measure the grove

The quality checks cover build cost, browser interaction, accessibility,
frame cadence and tape fidelity. They run locally with synthetic media and
produce JSON records. None of these checks deploys the site or uploads
visitor measurements.

## Run the checks

From `grove/`, after `pnpm install --frozen-lockfile`:

```bash
pnpm quality                         # tests, types, build, size budgets
pnpm exec playwright install chromium
pnpm quality:all                     # adds desktop/touch and production browser checks
```

Linux CI uses `pnpm exec playwright install --with-deps chromium` to install
browser system libraries. `quality:browser` generates its own synthetic demo
and owns an ephemeral server, then closes both server and browser. FFmpeg
adds a synthetic video when available; tape checks run without it. Python
and dashboard checks remain `uv run --frozen pytest -ra` at the repo root.

The [Checks workflow](../.github/workflows/checks.yml) runs these checks on
pull requests and pushes to `main`. JSON reports, including failures, are
retained as CI artifacts for 30 days. Locally, reports live under ignored
`results/quality/`; keep the relevant record with a review when comparing
releases. Browser timings vary with machine load: compare several samples,
record the environment and preserve regressions.

## Build size

```bash
pnpm quality:build --output ../results/quality/before.json
# After making a change and rebuilding:
pnpm quality:build --baseline ../results/quality/before.json --output ../results/quality/after.json
```

The report records the built version, inventory, raw bytes, estimated gzip
bytes and category totals. Startup JavaScript includes the bootstrap,
immediately imported `main.ts` and their static imports, deduplicated using
Vite's manifest. Deferred room loaders, video code, geometry, textures and
media are measured separately; startup JS size alone is not the initial
visit's download. Gzip uses level 9 per text asset, independent of the CDN.

[budgets.json](../grove/quality/budgets.json) sets byte limits and requires
the presence SDK and HLS decoder to have deferred manifest entries outside
the startup closure. This catches shared bundler helpers accidentally
pulling optional code into startup, even if a size limit still passes. A missing or
misspelled metric fails instead of silently skipping a check. Use
`--report-only` to record an intentionally failing baseline. A budget change
needs a measured reason; a lower score obtained by omitting a visible room
or losing source data is not an improvement.

Total build bytes include optional PNG fallbacks when their local bake files
exist. Those files are ignored by Git; a clean checkout can therefore build
fewer bytes than an operator's checkout. Compare the same asset inputs.
The large-chunk warning for Three.js/HLS remains visible; deferred HLS does
not belong to the startup closure.

## Browser checks

```bash
pnpm quality:browser --out ../results/quality/demo.json
pnpm quality:browser --dist dist --gzip --samples 3 --out ../results/quality/production.json
```

Reports distinguish cold and warm visits, encoded and decoded body bytes,
network transfer accounting, completed requests, cache hits and loaded room
count. The observation window ends 1.5 seconds after the starting geometry
appears; deferred transfers can still be pending. This measures the early
visit, not the eventual whole palace. Local gzip transport is an explicit
model. It is not a measurement of the production CDN or a mobile connection.

Checks include automatic WCAG A/AA rules, separate manual-review findings,
44-pixel discrete touch targets, keyboard skip and dialog focus, narrow
layouts, transport/joystick overlap, playback shortcuts and graphics failure
recovery. Inline prose links are not included in the 44-pixel product target.
The harness blocks external connections and disables service workers so
cache comparisons describe HTTP caching. Production mode checks the built
site and geometry with live services unavailable; demo mode checks playable
synthetic media. Neither is a live-service acceptance test.

The [Playwright accessibility guide](https://playwright.dev/docs/accessibility-testing)
explains why automatic scans complement manual and assistive-technology
testing. Zero detected violations does not establish full accessibility.

## Frame and visit diagnostics

In a desktop visit, focus the world and press **F** to toggle the timing
overlay. In browser developer tools:

```js
JSON.stringify(window.grove.metrics(), null, 2)
```

This creates a local report with build, room, device tier, viewport, first
room and tape readiness, frame percentiles, rendering counters, resident
tape bytes and resource totals. It contains no visitor identities, tokens
or resource URLs. The report is only returned to the caller; no analytics
service receives it.

| Measure | Definition and limit |
| --- | --- |
| Frame cadence | Last 240 positive, finite animation-loop intervals, measured before the movement cap. p50/p95/p99 use nearest rank. These are observed frame intervals, not GPU query timings. |
| Frame target | 60 Hz outside XR, the existing 72 Hz acceptance target in XR. The window resets when the target changes. It does not infer the display's actual refresh rate. |
| Over budget | Interval exceeds target by more than 5%, allowing small clock jitter. Stalls exceed 50 ms. Session stall count persists after the rolling window expires. |
| Visibility | Hidden non-XR tabs suspend frame work. Returning resets the clock so tab suspension is not counted as a rendering stall. Actual foreground stalls remain uncapped in the report. Movement stays capped at 100 ms. |
| Readiness | Navigation to first room callback, and first active tape with an available frame before its render. Neither proves a completed GPU presentation. |
| Long tasks | Browser Long Tasks API count, longest task and the sum of time above 50 ms per task. `null` means unsupported, not zero. This is not Lighthouse Total Blocking Time. |
| Layout shifts | Largest session window of unexpected DOM layout shifts, with one-second gap and five-second duration limits. It does not measure movement within the 3D canvas. |
| Resources | Completed resource entries available in the browser buffer. Unknown cross-origin sizes stay explicit; `resourceTimingBufferFull` warns about incomplete totals. The navigation document is separate. |

The [Resource Timing documentation](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/transferSize)
describes cache accounting and timing restrictions. The
[Long Tasks API](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming)
describes its browser support and measurement boundaries.

## Source fidelity and remaining acceptance

New tape bundles preserve exact recorded times, source cadence before frame
thinning, source time origin and unit labels. Older bundles retain their
nominal clock and say so in provenance. Extra source channels that are not
transported are listed explicitly. The compatible format extension is in
[M0-hall.md](specs/M0-hall.md#compatible-source-clock-extension-2026-09-13).
Exact time arrays add JSON bytes while leaving particle chunk payloads
unchanged; their measured cost belongs in the review.

Physical Quest and iPhone tests, live media/auth/presence verification,
initial phone transfer under 20 MB, and scientific exhibit acceptance remain
in [BACKLOG.md](BACKLOG.md). A passing local browser run does not close them.
