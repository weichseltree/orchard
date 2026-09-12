# grove

The public WebXR space at weichseltree.com and weichseltree.com/grove. Plain
Three.js, TypeScript strict, Vite, no framework; WebXR with a desktop fallback
(pointer lock + WASD) and a phone fallback (touch look + on-screen stick), from
one scene document. World state comes from the SpacetimeDB module in
`../spacetime`, media from R2, and the whole thing is a static bundle on
Cloudflare Pages.

M0 is here: one hall, one tree room, one video wall, and the tape of a
simulation you can walk into and scrub in time. Voice, chat, the greenhouse and
other rooms are M1 and later.

```bash
pnpm install
pnpm dev:bundle    # a synthetic tape + HLS bundle in the real format, for local work
pnpm dev           # http://localhost:5173/  (home)  and  /grove/  (the app)
pnpm test          # vitest
pnpm typecheck
pnpm build         # -> dist/index.html and dist/grove/index.html
```

`src/world/mansion.json` is the scene document: rooms, their glb, their spawn,
their doorways, what hangs where, and the sky outside the windows. No room is
hard-coded; adding one is a change to that file. A hanging's `bundle` may name
an `exhibit` (a tree and a kind) and take whatever `orchard exhibit hang` put
there last, with a pinned `id` for when the database is unreachable. Hangings
are `tape` (a volume you walk into), `video` (an HLS wall) and `still` (a
panel on a room's poster marker).

Guardrails: no guest uploads; names cleaned and capped; a visitor sees only
the people, poses and chat of the room they stand in (the module's
`people_here`, `poses_here` and `chat_here` views); poses rate-limited and
bounded server-side; "N here" opens who is here, with a Report button and a
field for your own name; hosts carry a green tag no name can fake and get
Mute, Kick and Ban next to each person there, as on the flat dashboard. The token service in `functions/auth` (logic in `auth/issuer.ts`)
gives each visitor a token after Cloudflare's human check; see
[docs/SECURITY.md](../docs/SECURITY.md). One screen plays at a time (the
decoder budget is enforced in `src/media/videowall.ts`).

`scripts/module-check.ts` holds several visitors against a local SpacetimeDB
and checks every rule of the module (visibility, floods, kicks, bans, the
per-network cap, the gate); its header says how to start the local server
and the token service. Run it before publishing a module change.

[docs/impl/WP2-grove.md](../docs/impl/WP2-grove.md) is the implementation note:
architecture, the frame budget as measured, what was tested where, and the open
issues. [docs/specs/M0-hall.md](../docs/specs/M0-hall.md) is the spec.
