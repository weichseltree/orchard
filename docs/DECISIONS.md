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
- **2026-09-12 · M2: the manifest is the join.** `orchard harvest` bundles
  each artefact a tree declares and writes the bundle id, the source digest
  and the commit back into the artefact; the bundle id moves with the tree's
  commit, as WP1 ruled, and the manifest follows it. Beat a separate registry
  of bundles (a second list to drift) and hand-copying ids into the client.
- **2026-09-12 · A hanging may name an exhibit, not a bundle.**
  `{"exhibit": {"tree": "einstruct", "kind": "tape"}}` takes the latest row
  of the live `exhibit` table; the pinned `id` beside it plays while
  single-player. `orchard exhibit hang` is therefore the whole publish step
  for a new result, and it refuses an artefact that is not `approved`
  (LAWS 22), recording the ruling in the manifest when `--approve` gives it.
- **2026-09-12 · Stills are AVIF with a JPEG at every width** (full ≤ 4096,
  phone 1600, thumb 640, the thumb JPEG only), recipe in the id and digests in
  `media.json` like video, because libaom is not promised bit-stable.
  spectre's stock sidecar (`<file>.json`) rides into `source.provenance`.
- **2026-09-12 · The first two exhibits: einstruct's ab_d2 tape and its 40 s
  clip**, approved by Manuel and hung the day R2 went on. The einstruct
  master, the spectre master and assembly, and the styleframe are bundled
  and not hung; each waits on its own ruling.
- **2026-09-12 · Rulings flow back through `orchard sync`**, a systemd user
  timer every 15 minutes, into the thesis's `stage` in the manifest: an
  approved styleframe or still is `styleframe`, an approved animatic or cut
  `animatic`, `greenlit` is greenlit, an approved master `mastered`; stages
  only ever advance, and `changes` writes the note into `blocked_by`. The
  flat dashboard is the first greenhouse: it reads the private tables and
  writes rulings and directives through the CLI's admin identity, and only
  listens on the loopback. Beat a browser admin identity first, which needs
  a token flow the grove does not have yet.
- **2026-09-12 · Hall palette: gallery** (charcoal walls, near-black polished
  floor; LAWS 13), chosen by Manuel from four 96-sample previews; the
  1024-sample bake follows. Beat stone (the M0 grey), warm and moss.
- **2026-09-12 · The mansion grows into a palace with an actual orchard.**
  Manuel's direction: the hall is the first room of a palace, Austrian in
  character, and the grounds outside its windows are a real orchard, the
  namesake made visible. The sky dome is the placeholder for those grounds.
- **2026-09-12 · Next: the trees speak.** With harvest, exhibit, sync and the
  greenhouse panels in place, the next sessions run inside the research
  repos against `docs/BRIEF-FOR-TREES.md`: what each can show now, which of
  its ideas is a mechanism of the mansion, one thesis, and what it needs.
- **2026-09-12 · The first exhibit plan's rulings, accepted by Manuel** ("I
  accept your recommendations", on docs/EXHIBIT-PLAN.md): einstruct's
  stirred twin `903d0c5a939b0ba1` beside its ab_d2 tape and the `row`
  animation `f0b3eba5f655c2a9` as a clip; spectre's trio once chi6 lands,
  its 42.8 s excerpt reclassed clip and hung silent; world-engine's three
  stills in a room of its own; phototroph's dimer-split tape funded (one
  CPU conversion, `cecbb68e2d2274af`, hung); a private remote for spectre
  after a clean secrets scan (the scan came back clean; creating the repo
  is Manuel's own step); someotherlife's Spike C capture funded with the
  orchard grounds as the first target.
- **2026-09-12 · A hanging may pin an exhibit to a bundle.** `exhibit:
  {tree, kind, bundle}` takes the latest row of the live table whose media
  is under that bundle id, so one room holds two sheets of one tree and a
  take-down still reaches visitors; without `bundle` the latest row of the
  kind still wins. Beat a slot column in the exhibit table (the database
  would then know the client's furniture) and pinning by `id` alone (no
  take-down without a deploy).
- **2026-09-12 · Several tapes, one transport.** The client's single tape
  volume and single video wall became lists; the HUD's scrub, speed and
  play act on every tape in step, which is what einstruct's pair (same
  801 frames over 400 tau) and spectre's trio (identical per-frame clocks)
  both want, and the HUD reads from the first. Beat one transport per
  volume for now; a per-room or nearest-tape transport comes with the
  spectre room.
- **2026-09-12 · Rooms off einstruct, not off the hall.** world-engine and
  phototroph are grey box rooms on einstruct's east and west walls (its
  bounds widened to 15 m for the two sheets), because the hall is a baked
  mesh whose doorways are holes in real geometry; a new hall doorway is a
  rebake. The palace plan decides the real plan of rooms.
- **2026-09-12 · Manuel walked the new rooms and they looked terrible; what
  was wrong.** The three world-engine stills and einstruct's second wall
  were placed 10 cm inside the bounds, inside the 20 cm box walls, so the
  rooms were empty boxes; hangings must sit deeper than `WALL_THICKNESS`
  and a facing test now says so. Hangings loaded one after another across
  the whole mansion, so a room's pictures waited behind another room's
  tapes; they load at once now. A second video wall was refused the
  decoder and drawn as a dark rectangle; walls are built showing their
  poster frame and the decoder goes to the wall nearest the visitor. A
  tape of eight particles at 14 px was invisible; a tape hanging has a
  `pointSize`. Local screenshots had hidden all of this because the WSL
  resolver does not resolve the media host: the check now runs the full
  Chromium over the DevTools protocol with the host mapped to Cloudflare's
  edge (scratchpad shot.mjs, to be moved into grove/tools).
- **2026-09-12 · The spectre room: three balls, one clock.** chi0, chi6 and
  chi12 hang as 3D tapes at 3.6 m, centres 1.5 m up, 5 m apart, in a
  near-black box off einstruct's back wall, with the silent 42.8 s excerpt
  on the far wall; the HUD's one transport scrubs all three in step, which
  the tapes' identical per-frame clocks allow. The cut plane, the slot
  budget and the style-B palette (backlog 16, 17, 20) are what the room
  still needs to read as the "one number" picture; it opens plain rather
  than not at all.
- **2026-09-12 · The grove's people are private; each visitor reads their own
  room.** `visitor`, `pose` and `chat` became private tables read through
  three query views scoped to the caller's room. Beat row-level filters,
  which SpacetimeDB stacks inside each other and then refuses ("subscriptions
  require indexes on join columns") as soon as the pose filter joins a
  filtered visitor table, and beat leaving the tables public, which let
  anyone read the greenhouse's presence and every room's chat.
- **2026-09-12 · Identities cost a human check, not a login.** A Pages
  Function beside the grove runs Turnstile and signs an ES256 token whose
  `ipk` is an HMAC of the visitor's network; SpacetimeDB verifies it through
  OIDC discovery, the module caps and bans by `ipk`. Beat a login (the grove
  is join-from-a-link), a Worker with its own state (nothing to store), and
  raw per-connection limits (free anonymous identities make them per-socket).
  The gate is a setting, off until the service has keys, so the rollout
  needs no second republish.
- **2026-09-12 · Admin is whoever publishes.** `init` seeds the allowlist
  with the publisher; `bootstrap_admin` (first caller wins on an empty list)
  is gone, because a `--delete-data` republish would have opened it to any
  visitor.
- **2026-09-12 · The interaction harness is a bandit first, RL only if it
  shows headroom.** arcedit's critique of INTERACTION.md §4.5, adopted as
  §4.6: session summaries as the observation, binding presets instead of
  free rebindings, degenerate configs scored before any learner, per-verb
  validation at p50 and p90, a synthetic generator with seeded visitor
  types that does not contain the answer, and a two-level design in which
  the learnable, transfer-relevant object is a visitor that learns the
  verbs from hints. Stages S0 to S2 may run in any session; the visitor
  agent stays with arcedit, behind its own gate.
- **2026-09-12 · The palace round's five specs are the direction for the
  next months**, written by subagents from Manuel's evening brief and
  reviewed: PALACE.md (one level, Euclidean, an enfilade with the hall at
  the centre, a gallery east, an orangery of portals west, orchard grounds
  of about 450 cherry trees, the moon as chi12; stills first), PALACE-
  ASSETS.md (CC0 only, verified per item; Belvedere statues found), DEVICE-
  TIERS.md (eight tiers, a five-state exhibit lifecycle, `visibility.json`
  gating what plays, loads and is heard), INTERACTION.md (seven verbs, hints
  as furniture, voice as a structured LLM call behind a Worker, an opt-in
  recorder, a PWA first and a Play Store wrapper later, never Flutter), and
  COMMUNITY-AND-INFRA.md with brand/ (the repo as the front door, Sponsors
  and DCO, Cloudflare Realtime for voice at launch and LiveKit Cloud at
  scale, SpacetimeDB as state and signalling only, Whisper on Workers AI,
  Austrian legal basics). Beat building any of it first: each spec ends in
  rulings Manuel makes before lane time is spent.
- **2026-09-12 · Only the visitor's room plays.** Tapes advance and the one
  video decoder is handed over only inside the room the visitor stands in;
  other rooms freeze and show posters. Scrubbing still moves every tape so
  shared clocks stay aligned. The first state of DEVICE-TIERS.md's
  lifecycle; the rest follows its migration list.
- **2026-09-12 · The palace look: white, gold and marble.** Manuel's
  ruling, in the spirit of the Naturhistorisches Museum Wien, with the
  choices delegated ("choose yourself instead of waiting for me. Build the
  entire scene"). Chosen: cream stucco walls, a red-brown marble wainscot,
  pale veined-marble dressings, pilasters and reveals with gilt capitals,
  crests and a gilt cornice bead, a light marble floor with a dark diagonal
  inlay lattice in the hall and gallery, dark oak parquet in the state
  rooms, stone flags in the orangery and greenhouse, white coffered
  ceilings; the Planet Room stays near-black. This supersedes the gallery
  palette for the interiors; the six open questions of PALACE.md are
  answered by the same delegation: grey-white limewash outside, fruit
  season, the moon shown, French doors yes, the orangery limewashed,
  closed doors for unearned rooms. Every texture is generated in the
  generator (value-noise marble), nothing lifted.
- **2026-09-16 · The palace, second pass: bigger rooms, stairs, terrain, and
  rooms named after their repositories.** Manuel's brief of the evening
  ("portals a bigger feature, einstruct into its own room, rename them all
  after the repo, museum text on the walls in the browser's language, a
  proper palace with bigger rooms, fancy objects, stairs and terrain").
  Ruled and built on branch `weichseltree-palace-portals`: (1) the tree
  rooms are titled after their repositories (einstruct, coarsen,
  world-engine, phototroph; ids and presence names unchanged, so links and
  the live `room` table keep working); (2) einstruct is a 16 m cabinet off
  the hall's east wall, no longer the corridor of the enfilade, with
  coarsen's cabinet north of it and a door on to the north wing, so the
  research rooms form a loop; (3) a room's floor is its `bounds.min[1]`,
  the north wing (world-engine, the orangery) stands 1.5 m up, the Long
  Gallery ends in a Belvedere 1.8 m up, the garden is sunk 1.6 m below the
  terrace, and every doorway between two floors gets a flight of steps in
  the lower room, generated from the doorway alone (terrain.ts,
  observatory.ts): stairs are never authored, only floor heights are; (4)
  the grounds are a height field of authored mounds (`terrain.mounds` in
  mansion.json), one function under the ground mesh, the trees and the
  feet, so nothing is climbed that is not seen; (5) the palace gains a
  balustrade with urns, colonnades, chandeliers, statuary, box hedges, a
  basin under the armillary, lanterns and obelisks, all instanced
  primitives in the existing batches. Beat a per-room `platforms` list
  (stairs to nowhere) and beat authoring stairs by hand (the doorway
  already says where the height changes). The Belvedere shares the
  gallery's presence room so no `set_room` is needed. Issue #16's ruling
  is confirmed: a forced update is one the visitor cannot dismiss, and it
  still waits for the immersive session to end. Issue #18 (chat) was built
  in parallel by the Faye session on `weichseltree-spatial-audio-field`;
  this branch's duplicate was dropped in favour of it, keeping only the
  speech line above a peer's capsule for the merge. arcedit (planted the
  same evening by its own session, with an 18-room area manifest, a scale
  portal and eight harvested bundles, all unapproved) gets a closed door on
  the gallery's east wall; the area is placed once Manuel rules on its
  bundles, under the rule that a tree earns its room.

- **2026-09-16 · The palace, third pass: sealed doors, door names, reading
  stands, a baked light field, the portal court.** Manuel's brief: the
  placeholder doors were ugly (the piers and panels ran across them) and
  should be deactivated portals; the doors should carry the rooms' names
  in a 3D typeface; the wall text's backs z-fought and the old pedestals
  should go, the tape's progress moving on to bigger, better placed signs;
  the old bake no longer made sense and light should be re-baked so the
  portal glows into the rooms; the garden portal should move off the
  crossing to the far side, with the park's objects redistributed off the
  walks; the light system rethought without going overboard. Ruled and
  built: (1) a closed doorway is a real aperture, no pier or sconce
  crosses it, with a dark recess and a brass halo behind a shallow lens
  drawn by the portal shader with no far view and a dimmer tint
  (`sealedLens` in sealed.ts, portal.ts's sealed material): a portal not yet lit, one
  material for all of them; (2) every doorway with surrounds carries the
  name of the room beyond in brass letters extruded from Cinzel (SIL OFL,
  `fonts/cinzel.json` made by `tools/typeface.py`, loaded lazily), in the
  visitor's language, falling back to the identifier where the typeface
  cannot set it (Japanese), one merged mesh per room, the hidden back caps
  dropped, under 60k triangles for the palace; (3) the pedestal is gone:
  a tape's wall text is the face of the reading stand the tape builds at
  its near edge, whose strip carries the progress bar and the lamp, both
  placed from one frame (stand.ts), and every plaque grew (entrance panel
  1.8 m, labels 0.7 m) with a brass body and a dark back a hair off it,
  which is what removed the z-fighting; (4) the Blender bake
  (`tools/palace`) lit glb rooms the runtime architecture replaced and is
  not run again; in its place the architecture's own luminous elements
  (sconces, chandeliers, lanterns, door inlays, obelisks), the portals and
  the sealed lenses are emitters baked at build time into a 2 m × 1 m ×
  2 m RGB light field (lightfield.ts, a few hundred kilobytes) that stays
  inside its room and spills through open doorways, sampled once per
  fragment by every architectural material; the analytic floor pools and
  wall rhythm are gone, the two scene lights remain for avatars; no sound
  filter was ever baked, so none is re-baked; (5) the armillary stands in
  a court 12 m west of the crossing: a round of gravel, a water ring, a
  stone dais with a brass rim, two bridges on the axis walk, four
  lanterns, with the western quarters set back from it and the crossing
  reduced to a gravel round with a brass rose, walks added from the
  terrace's side stairs, nothing left standing in a walk. Beat lighting
  by three.js lights (per-object cost, no occlusion) and by per-room
  materials (the material budget).

- **2026-09-16 · The first tree area: arcedit's eighteen rooms off the
  gallery.** Manuel, on the list of what could go live next: "do all that
  and put it live", and "I approve all exhibits because I need to see them
  first anyway". arcedit's authored area (TREE-AREAS.md §8,
  `results/grove/area.json`) is folded into mansion.json at (+10, 0, +31.5)
  so its entrance is the gallery's east cabinet door at z 34, opened; the
  canvas room at a tenth of the scale keeps its own coordinates like the
  Orrery; its eight bundles hang as approved. Decided along the way: (1) a
  room of an area takes its tree's finish and, when wider than deep, runs
  its vault, route and lamps along x; (2) inner doors stop 0.6 m under the
  lower ceiling so the lintel name fits; (3) four hangings moved and every
  tape got a stand foot to meet the label rules, arcedit-22 told the
  numbers; (4) an entrance panel goes round the corner when its short wall
  has no room beside the door; (5) the draw, triangle and door-sign budgets
  scale per room (about fifteen batches and fourteen thousand triangles a
  room, 200,000 sign triangles for the world); (6) one presence room
  "arcedit" for the whole area, in `SEED_ROOMS` and added live with
  `set_room`, no module publish. The area's furniture is not rendered.
