# cat-proxy (vendored)

**Generated from someotherlife — do not edit here.** This directory is a copy of
`packages/cat-proxy` from someotherlife (private), packages/cat-proxy, commit `780c039c15ec1a3b655dfdb12692d2ba69e1db2a`,
package version 0.0.0, copied 2026-09-17T22:12:27Z.

Edits belong upstream: change the package in someotherlife and re-run its sync, or the next sync
overwrites them. `node check-vendor.mjs` in this directory re-hashes the copy against
`VENDORED.json` and fails if anything here has drifted; it needs nothing but Node.

- `src/` — the package as plain TypeScript. No build step: import it by relative path and let
  your own pipeline compile it. `three` resolves to yours.
- `src/index.ts` — the public surface: `CatWorld`, `buildCat`, `createBrain`, the contract,
  the two appearances, `runHeadless` for CI.
- `assets/` — the generated `.glb` cats, their sidecars and previews.
- `LICENSE` — AGPL-3.0-or-later. It covers this package and the generated assets: the body, the
  brain, the contract, the appearances and the `.glb` files. The rest of someotherlife is not
  licensed, and the owner's cat photographs are neither included nor licensed by it.

The synced tests are DOM-free and run in a second or two, because your `pnpm test` will pick them
up on every PR. Anything needing a browser (the .glb round-trip, screenshots) stayed upstream.
