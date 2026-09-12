# The platform

orchard is a VR-first host for research artefacts. A research repo registers
as a tree, ships its outputs in formats that stream into a headset or onto a
phone, and gets a room in a shared world. The world is a map: a mansion that
defies physics, with portals between rooms and between orchards, lit by baked
ray-traced light. Anyone can fork the setup, run a node, and link it to
others; a node that hosts trusted code from a tree, rendering or
preprocessing on its owner's GPU, funds that tree in kind.

Start small. The first mansion has one hall, one room, one streamed particle
tape, one video on a wall, and presence. Everything below is the direction
that first room is built to grow in: a palace, Austrian in character, with an
actual orchard on its grounds outside the windows (DECISIONS 2026-09-12).

## The repos are the features

Every idea in the weichseltree repos is a mechanism of the mansion, not only
an exhibit in it.

| repo | in the mansion |
|---|---|
| spectre, einstruct, phototroph | particle tapes streamed as points you can stand inside and scrub; the tape format is the interchange |
| world-engine | SDF lenses that bend light: portals, rooms larger inside than outside, corridors that loop |
| someotherlife | captured rooms as Gaussian splats, articulated avatars from performance tracks, the WebXR client skeleton |
| premosaic | adaptive tessellation as level of detail: cheap model far away, exact model where you look |
| lumina-consensus | a screen-and-camera link as the simplest inter-node handshake |
| mosaic, HNL, agivity, points | rooms; later, live instruments |

## Artefact bundles

A tree publishes bundles, not files. A bundle is a content-addressed directory
with a `bundle.json` naming the tree, the commit and command that produced it,
its provenance sidecars, and one or more variants per device tier
(`vr-high`, `vr-quest`, `phone`, `preview`). Formats:

| kind | wire format | why |
|---|---|---|
| video | HEVC and AV1 in fragmented MP4, HLS ladder; 2D, 180 or 360 | one decoder on Quest, adaptive on phones |
| tape (particles) | chunked binary, positions quantized per chunk, species and one scalar channel, index by time | scrub without downloading the tape; 2,634 particles at 30 fps is a few MB per minute |
| splat | compressed Gaussian splats with LOD tiers | someotherlife's decision, zero decode sessions |
| mesh and scenery | glTF with meshopt and KTX2 textures | the mansion itself |
| light | baked lightmaps and probes as KTX2 | ray-traced once with Blender Cycles or Mitsuba, free at runtime |
| still | AVIF with JPEG fallback | posters |
| audio | Opus | narration, ambience |

A bundle's hash is its identity everywhere. Nodes mirror bundles by hash;
rooms reference bundles by hash; a portal carries the hash of the room it
opens on.

## The world

A mansion is a graph of rooms, not a floor plan. Rooms are glTF scenes with
baked light; portals are quads that render the far room through them and
teleport on crossing, which is what lets the map defy physics. Each tree
owns a room; the hall belongs to the operator; the greenhouse is admin only.
World state (who is here, where, what they say, what hangs where) lives in
SpacetimeDB; the client is WebXR with a desktop and phone fallback.

## Nodes and the landscape

A node is one operator's orchard: a SpacetimeDB database, a bundle store,
a static client, and optionally a worker. Nodes link by exchanging a signed
`node.json` (identity, endpoints, the trees it hosts, the bundles it
mirrors). A linked node appears as a portal in the hall. Visitors cross
portals without a new login; identity is portable because it is a key pair.

**Funding in kind.** A tree may declare jobs: server-side render, transcode,
bake, preprocess. A job names the tree's commit, the command, its inputs by
hash and the resources it needs. A node operator chooses which trees they
trust and runs their jobs on their own GPU through their own lane discipline
(here, `gpurun`). Results are bundles, signed by the node, verifiable by hash
by anyone. The ledger records who spent what for whom; that record is the
funding, and it is public.

**Trust.** Only code at a pinned commit of a registered tree runs on a node,
in a sandbox the operator chooses. A node never runs code from a visitor.
Nodes never accept inbound execution requests; they pull jobs they have
opted into. The home box rule generalizes: a node only ever connects outward.

## Roadmap, smallest step first

- **M0 the hall**: static mansion, one hall and one room, baked light, one
  video wall, one streamed tape you can stand in. Desktop, Quest, phone.
  Deployed to weichseltree.com/grove from Cloudflare Pages and R2.
- **M1 company**: presence, poses, chat, spatial voice through SpacetimeDB and
  Cloudflare Realtime; the greenhouse with the review queue and rulings.
- **M2 bundles**: `orchard bundle` produces variants from a tree's artefacts;
  `orchard exhibit` hangs a bundle; provenance sidecars carried through.
- **M3 the first portal**: a second node on Legion, `node.json` exchange, a
  portal in the hall, a bundle mirrored by hash.
- **M4 jobs**: a tree declares a transcode job; the second node runs it and
  publishes the signed bundle; the ledger shows the in-kind funding.
- **M5 the mansion defies physics**: world-engine's lenses as non-Euclidean
  portals; splat rooms from someotherlife captures.
