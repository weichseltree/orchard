# Decisions

Append-only. A decision names the day, the ruling, and the alternative it beat.

- **2026-09-11 · Name: orchard.** Beat greenlight and slate; ties to the channel name.
- **2026-09-11 · Unit of investment: the episode thesis**, not the repo. One
  question, one number, one picture; stages as the term sheet.
- **2026-09-11 · No fourth film pipeline.** spectre `core/film`, einstruct
  `film/` and phototroph `studio/ptstudio` feed the studio; the studio owns
  storyboards, narration, budgets, finishing and review. spectre's tape format
  is the interchange.
- **2026-09-11 · First slate:** einstruct "Rows read chemistry", spectre
  "Planet from scratch", then world-engine bent light and premosaic
  tessellations. phototroph on hold until its physics passes review.
- **2026-09-11 · A social VR layer, the grove**, public gallery plus admin
  greenhouse, started from someotherlife's WebXR client skeleton (plain
  Three.js, desktop fallback, PC VR and Quest browser first-class).
- **2026-09-11 · Hosting: SpacetimeDB + Cloudflare.** Beat Supabase (duplicates
  realtime and storage) and GCP/Firebase (blocked in mainland China). GCP kept
  for server-side Gemini calls only.
- **2026-09-11 · weichseltree.com moves from the Patreon redirect to the
  channel home**; nameservers move from Namecheap to Cloudflare. Patreon
  becomes a link.
- **2026-09-11 · The grove opens by invite link first**, public once the first
  episode is exhibited.
- **2026-09-11 · The home box is outbound-only.** No tunnel, no inbound port;
  snapshots pushed to SpacetimeDB, rulings pulled back.
- **2026-09-11 · orchard is a public open-source project, VR platform first.**
  The platform hosts research artefacts in streaming formats for VR and phones;
  the fund and studio are the operator layer inside it. The private audits move
  to gitignored `notes/`.
- **2026-09-11 · The world is a mansion that defies physics**: rooms per tree,
  portals between rooms and between orchards, baked ray-traced light. The
  repos' ideas are the mansion's mechanisms, not only its exhibits.
- **2026-09-11 · Federation and funding in kind**: forks run nodes, link by
  signed `node.json`, mirror bundles by hash, and fund trees by running their
  pinned code on their own GPU. Nodes only ever connect outward.
- **2026-09-11 · License: Apache-2.0.** Beat AGPL-3.0; a platform others
  host and fork needs the patent grant more than a share-back clause.
- **2026-09-11 · License: AGPL-3.0, superseding Apache-2.0 the same day.**
  Nodes that host and modify the platform must publish their changes; a
  little vendor lock toward the shared code is wanted for a federation whose
  nodes run each other's trusted code.
- **2026-09-12 · M0 specified** in `docs/specs/M0-hall.md`: one hall, one
  einstruct room, one HLS video wall, the ab_d2 tape as a walk-in point cloud,
  presence over the live database. Tape bundles are content-addressed chunked
  directories served by R2, format `orchard/bundle/1`.
- **2026-09-12 · Development method**: the orchestrator writes specs;
  Opus 5 subagents implement with an implementation note in `docs/impl/` and
  are reviewed independently in `docs/reviews/` before integration.
- **2026-09-12 · A 2D tape lies horizontal.** Tape z maps to world up, the
  sheet is centred 1.0 m above the floor so a visitor wades through it; 3D
  tapes keep the 1.2 m centre. (WP2 found the spec's 1.2 m put a vertical
  sheet half below the floor.)
- **2026-09-12 · Dev bundles never deploy.** Generated dev bundles and
  videos live outside `grove/public/`; `dist/` carries only real assets.
- **2026-09-12 · M0 deployed to www.weichseltree.com/grove** with the baked
  hall, the einstruct room, presence over the live database, and CSP headers.
  Media waits on R2 being enabled; the apex waits on Patreon releasing its
  custom hostname. Both are one click each on Manuel's side.
- **2026-09-12 · Production CSP allows only self, media.weichseltree.com and
  maincloud.spacetimedb.com** (https and wss); microphone stays denied until
  voice lands in M1.
- **2026-09-12 · CSP allows `unsafe-eval` for scripts.** The spacetimedb SDK
  2.10 generates its BSATN serializers with `Function()`; the first production
  deploy blocked it and presence silently retried forever. Everything else in
  the policy stays strict. Revisit when the SDK offers a non-JIT path.
- **2026-09-12 · The outside is a sky dome in the client, its sun taken from
  the bake record.** Beat glazing the windows with an emissive pane (hides
  the sun disc, and the pane's brightness would need a rebake to agree with
  the pools on the floor) and an HDR environment (a download on the phone
  tier for six apertures). The dome's colours are a placeholder until the
  hall gets its material and colour pass.
