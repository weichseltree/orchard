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
