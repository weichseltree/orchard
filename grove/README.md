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
their doorways and what hangs where. No room is hard-coded; adding one is a
change to that file.

Guardrails from day one: random guest names, no guest uploads, mute, kick,
personal-space bubble, rate-limited chat, presence visible on the flat
dashboard. One screen plays at a time (the decoder budget is enforced in
`src/media/videowall.ts`).

[docs/impl/WP2-grove.md](../docs/impl/WP2-grove.md) is the implementation note:
architecture, the frame budget as measured, what was tested where, and the open
issues. [docs/specs/M0-hall.md](../docs/specs/M0-hall.md) is the spec.
