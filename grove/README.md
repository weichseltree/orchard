# grove

Not built yet. The public WebXR space at weichseltree.com/grove and the admin
greenhouse. Starts from someotherlife's `apps/client` skeleton: WebXR, plain
Three.js, TypeScript strict, Vite, desktop fallback, PC VR at 90 Hz and Quest
browser at 72 Hz from one scene document. Firebase is replaced by the
SpacetimeDB client (`../spacetime`), media comes from R2, voice from Cloudflare
Realtime. Deployed with wrangler to Cloudflare Pages.

Rooms: the grove (public, invite link first), the greenhouse (admin identity
allowlist). Each tree is a tree; approved artefacts hang on it. One screen
plays at a time; others are posters that wake on approach (decoder budget).
Signature feature: walk inside the tape, the simulation's particles as points
you can scrub in time.

Guardrails from day one: random guest names, no guest uploads, mute, kick,
personal-space bubble, rate-limited chat, presence visible on the flat
dashboard.
