# Live audio streams and the `audio` kind

**Ruled 2026-09-15**, from [#11](https://github.com/weichseltree/orchard/pull/11)
against orchard as it stood at `b686314`, proposed by
[logswarm](https://github.com/Weichseltree-OU/logswarm). The exhibit carve-out
in §1 and the `audio` kind in §2 are landed (`PACKAGES.md`). Numbers marked
**budget** are still proposed, not facts; §7 is what turns them into facts,
and nothing there has been measured yet.

The case: a repository doing distributed work is an observation, and it is
already happening. LogSwarm watches one — its SDK's log events plus the infra
side channels underneath — and can render it as sound a visitor stands inside.
The orchard side of that is small but it is not free, because a live stream
breaks the one idea the packaging spec is built on.

## 1. The rule this has to survive

`PACKAGES.md`: **a name that carries its content hash is kept forever; a
fixed name is always re-checked.** A live stream has neither property. Its
bytes do not exist when its name is handed out, so it cannot be hashed, and
re-checking a name whose content changes forty times a second is not a cache
policy, it is a denial of one.

The proposal does not weaken the rule. It puts live outside it:

> **An exhibit is a name with no bytes behind it.** It is never cached, never
> immutable, never served by the service worker from storage, and never
> referenced by a manifest that claims a digest. A bundle is the only thing
> that may be kept. An exhibit that is worth keeping is *recorded into* a
> bundle, and the bundle obeys every existing rule.

So `audio/live/<provider>/<stream-id>` is an exhibit and is always fetched.
`audio/<hash>.opus` is a bundle and is kept forever. Nothing in between exists.

## 2. The `audio` kind

The kinds today are `tape`, `clip`, `master`, `still`, `figure`, `model`. The
archived form of a run is sound with no picture: not a `master` (no film, no
titles, no chapters), not a `clip` (not an excerpt of anything), not a `tape`.
Landed: **`audio`** — one or more Opus tracks, a manifest, and the score
(§4) that produced them.

`master` keeps its meaning and LAWS 18 is untouched: an `audio` bundle is not
a film and does not claim to be one.

## 3. Transport

Opus is already the declared wire format; this only names the carrier.

| | live | archived |
|---|---|---|
| carrier | LL-HLS, Opus in fMP4 | one `.opus` file per track |
| naming | exhibit, §1 | content-hashed bundle |
| service worker | **must pass through** — never `cache.put`, never a stale response | normal immutable bundle rules |
| target segment | 200 ms parts, 1 s segments (**budget**) | – |
| glass-to-ear | 2 s p50, 5 s p95 (**budget**) | – |

LL-HLS over Cloudflare Realtime rather than WebRTC, for the first cut: the
stream is one-to-many, the listener never talks back, and it survives a CDN.
When M1's spatial-voice work lands a Realtime path, a stream that needs sub-
second latency can move onto it; the exhibit rule does not change if it does.

**Failure is specified, not incidental.** A stream that falls behind its live
edge by more than 10 s (**budget**) is dropped to silence with a visible marker
in the room, not stretched, not played late. A dead stream is silence. Neither
is an error dialog: the room stays enterable.

## 4. The score, and why a number may be spoken

Between the observed repo and any sound there is a **score**: a versioned,
fixed-rate (proposed 10 Hz, **budget**) stream of per-node state — rate,
burstiness, template entropy, fan-out, anomaly z-score, health. It is JSON, it
is archived with every `audio` bundle, and it is the reason this can satisfy
the editorial laws instead of being exempted from them.

- **LAWS 24** — a spoken number names the command and file that produced it.
  Here it names a field and a frame index of a named score, and the gate can
  run mechanically before the take is recorded.
- **LAWS 5** — the score is where repo-speak gets left behind. Field names are
  internal; the narration line is written against the value, and the banned-word
  gate runs on the line.
- **LAWS 17** — silence is a budget, not an accident. Proposed: at least 20% of
  any 60 s window is near-silent (**budget**), because continuous sonification
  of a busy system is noise, and a system that is idle should sound idle.

Sonification is deterministic and seeded: the same score renders byte-identical
Opus, so the archived bundle's hash means what every other hash here means.

**Amended 2026-09-16 (#14, ruled by Manuel).** That holds for the *bed*, the
provider's Opus. It no longer holds for *positioned* sound: each positioned
node's voice is synthesised in the visitor's browser from the live score
(§5), so the bundle's hash does not cover it. What replaces the hash is
determinism: a voice is a pure function of the score frame, the node id and
`SYNTH_VERSION` (`grove/src/audio/voice.ts`, now `orchard/synth/1`), so what a
visitor heard is reproducible from the archived score plus that version
string. Changing the mapping changes the version.
The versioned schema lives in `orchard/packages/score/` (`orchard-score`),
pinned by tag the same way `orchard-tape` is (`PACKAGES.md` §2).

## 5. Attaching a stream to a room

A stream has no geometry, so it cannot be exhibited the way a tape is. What it
has is a **topology**: the DAG of the observed system. Proposed: the provider
publishes node positions in a unit space alongside the score, the room maps
that space onto its own, and each node becomes a positioned source. A listener
turns their head and places a service. That is the whole reason this is worth
doing in VR rather than in a browser tab.

**The topology is a document, `orchard/topology/1`.** It is published beside
the score, under the exhibit's own name, and it is part of the live exhibit —
so it is never cached, never hashed, and fetched `no-store`. An `audio` bundle
archives its topology the way it archives its score.

```
audio/live/<provider>/<stream-id>/topology.json   the nodes and the DAG
audio/live/<provider>/<stream-id>/live.m3u8       the LL-HLS playlist (§3)
```

Every node carries an id, a `label` written for a listener (never the id and
never a score field name — LAWS 5), and a position in the **unit cube**: each
coordinate in [0, 1], `y` up, so a provider that lays its DAG out flat
publishes a constant `y` and gets a floor plan rather than a wall. Edges are
carried and must name published nodes.

The room maps that cube onto itself. The hanging owns the map — centre, one
`sizeMeters` and a turn about `y` — the way a `planet` hanging owns
`radiusMeters`, so one topology stands small in a study and large in a hall
without the provider knowing which room it is in. The map is **uniform on all
three axes on purpose**: a non-uniform one would make a node's apparent
direction depend on which way the room is long, and a direction meaning
something is the entire point. A low room wants a smaller cube, not a
squashed one.

**A missing topology is not a failure.** It means the room does not know where
the nodes are, so every node folds into the bed — which is what the room
played before any of this. A dead topology is silence in the same way a dead
stream is (§3).

### The two DEVICE-TIERS rows disagree, and the cap is a ladder

`DEVICE-TIERS.md` carries a positioned-audio-sources row — 16 on `vr-quest`,
32 on `vr-high` and desktop, 8 on `phone` — and separately an
`audio: convolvers / panners / HRTF` row. They do not agree. The second gives
Quest 2 and Pico 4, both `vr-quest`, **six** panners and **no HRTF at all**, so
`vr-quest` cannot have sixteen HRTF-panned sources: a tier budget has to hold
on the weakest device in the tier.

They are reconciled as a ladder rather than by picking one, because being
positioned and being a `PannerNode` are not the same cost. Each node takes the
best rung the budget still has room for, nearest listener first, and
everything past the last rung folds into the bed:

| rung | what it is | what it gives |
|---|---|---|
| `hrtf` | `PannerNode`, `panningModel: "HRTF"` | externalised, elevation |
| `panner` | `PannerNode`, `panningModel: "equalpower"` | azimuth and distance |
| `stereo` | `StereoPannerNode` on the listener-relative azimuth | left and right only |
| `bed` | not positioned | the §5 bed |

| tier | positioned | panners | HRTF |
|---|---:|---:|---:|
| `vr-quest` | 16 | 6 | 0 |
| `vr-high` | 32 | 8 | 2 |
| `phone` | 8 | 4 | 0 |
| `desktop` | 32 | 16 | 4 |

**On a Quest a node is placed by azimuth and distance, not externalised.**
Quest 3 alone would allow two HRTF sources; Quest 2 and Pico 4 are in the tier
and allow none. That is worth saying out loud because it is the flagship
device for this whole idea.

Every number above is still a **budget**. Nothing has been measured on a
headset, and §7 item 2 now owes two numbers per tier rather than one.

Rungs are assigned by **distance alone**, with hysteresis. A node's placed
position never moves, so a distance ranking changes only when the visitor
moves, which is slow; ranking by how active a node is would reshuffle the
rungs at the score's 10 Hz and click on every reshuffle — and which activity
deserves a rung is a sonification judgement, which is the provider's (§4), not
the client's allocator's.

### What is landed, and the one thing that is not

Landed in `grove/src/audio/` and `grove/src/world/audio-exhibit.ts`: the
topology document and its schema, the unit-cube map, the per-tier ladder and
its selection, the Web Audio graph with a listener that follows the visitor's
head at frame rate and re-ranks four times a second, the `audio` hanging kind,
and the bed routed through that graph so one master gain governs the exhibit.

Not landed, and **not orchard's to invent**: what a positioned source actually
plays. §4 makes sonification the provider's and says it is deterministic and
seeded so an archived bundle's hash means what a listener heard; a timbre
invented in the client would be a second, unhashed sonification of the same
run. So the field positions whatever voices it is given and ships none. Until
that is settled the room plays the bed, positioned by nobody — which is
exactly the behaviour §5 already described as the fallback. §8 carries the
ruling this needs.

## 6. Ledger

TTS takes and Opus encoding cost money per run. Narration follows the model
`studio/`'s `narrate.py` already plans — max-of-N takes, a content-hash cache
keyed on the line plus voice plus score frame, take cap 5, ceiling 10 — and
meters into the ledger the same way. Encode is metered per stream-hour. A live
stream with no listeners is not free, so an exhibit with zero subscribers for
60 s (**budget**) stops encoding. (`studio/narrate.py` itself does not exist
yet — this is BACKLOG 31 territory — so the TTS side of this section is not
landed, only the reporting side in `orchard/ledger.py`.) The encoder appends
one line per accounted interval to `.audio_usage.jsonl`:
`{"stream_id", "provider", "kind": "encode"|"tts", "hours", "cost_usd"}`.
`orchard ledger` groups those entries by stream and reports encode hours,
encode cost, and TTS cost; malformed or incomplete entries are ignored rather
than producing invented spend.

## 7. Evidence still owed

Everything above is a proposal. Before any of it is a fact:

1. Glass-to-ear latency measured on a real stream, on a headset and a phone,
   against §3's budget.
2. Simultaneous positioned-source counts measured per tier, against §5's —
   now **two** numbers per tier, positioned and panners, since §5's ladder
   separates them, plus whether HRTF is affordable at all on `vr-quest`.
3. One end-to-end run: a repo observed, a score recorded, an `audio` bundle
   produced, its hash reproduced from the score on a second machine.
4. A silence measurement over a busy hour and an idle hour, against §4's 20%.
5. Cost per stream-hour, TTS and encode separately.

And one thing that is not orchard's to fix but blocks the public side of it:
side channels of a deployed repo leak its structure, and narration can read
private data aloud. **No stream from an observed repo hangs in a public room
before LogSwarm has a redaction and consent story.** A private greenhouse
exhibit is the honest first venue.

## 8. What this asks for, concretely

- `PACKAGES.md`: the exhibit definition in §1, and `audio` added to the kind
  list in §3. **Landed.**
- `grove/`: service-worker pass-through for exhibit names (**landed**); the
  fall-behind and dead-stream behaviour in §3 (**landed**, minimal player);
  the positioned-source exhibit of §5 — topology document, unit-cube map,
  per-tier ladder, the field and its listener, the `audio` hanging kind
  (**landed**, `grove/src/audio/`, `grove/src/world/audio-exhibit.ts`),
  **except** what a positioned source plays, which §5 says is not orchard's
  to invent and which the ruling below is about.
- **Nothing hangs yet.** `mansion.json` carries no `audio` hanging, and will
  not until §7's last paragraph is satisfied: no stream from an observed repo
  hangs in a public room before LogSwarm has a redaction and consent story.
  The schema accepts one; the palace offers none.
- `DEVICE-TIERS.md`: an audio-source row per tier. **Landed.**
- A ledger meter for stream-hours. **Landed** on the reporting side
  (`orchard/ledger.py`); the encode/TTS side that appends usage entries is
  outside this repo.
- **Where a positioned node's sound comes from: RULED 2026-09-16 (#14).**
  Manuel chose option 1 of the three that were on the table: **the client
  synthesises a voice per node from a live score feed.** The other two
  (a track per node, one Ambisonic stream) are recorded in #14.

  *Transport.* The provider publishes **`score.live.json`** beside
  `live.m3u8` and `topology.json`, under the exhibit's name, so it is never
  cached. It is the same `orchard/score/1` document an `audio` bundle archives
  as `score.json`, holding only a rolling window of recent frames: there is no
  second schema. `orchard_score.LiveScoreWriter` writes it (window 30,
  replaced atomically on every frame); the grove polls it once a second
  (`grove/src/audio/score-live.ts`). The window must outlast the poll:
  over 10 frames at 10 Hz.

  *Voice.* `grove/src/audio/voice.ts`: pitch is the node's identity (a
  pentatonic degree chosen by hashing its id, so every set of nodes is
  consonant and a node sounds like itself tomorrow); loudness is `rate`,
  log-scaled, and **an idle node is silent** (LAWS 17); brightness is
  `template_entropy`; tremolo is `burstiness`; ill health flattens and darkens;
  `|anomaly_z| >= 3` agitates the tremolo. A voice exists only for a node the
  tier's budget has positioned (`field.ts`), so a Quest runs at most sixteen.

  *Failure.* A feed that has published nothing new for 3.5 s is dead, and a
  dead feed is **silence**: holding the last state would sound like a system
  still running. A document that is not a score builds no voices. A live
  exhibit without `score.live.json` plays the bed alone, as before.

  *Archived bundles* do not yet play positioned voices from their
  `score.json`; that needs the voices driven by playback time rather than the
  newest frame, and is not built.

- A decision on whether LogSwarm is scouted and planted as a tree, and whether
  the score schema lives in `orchard/packages/` where both repos can pin it by
  tag per `PACKAGES.md` §2. **The schema's home is decided**: `orchard/packages/score/`.
  Whether LogSwarm itself is scouted and planted as a tree is still open.

**Licensing:** orchard is AGPL-3.0-or-later; LogSwarm's terms are in its
`legal/`. Compatibility is unverified and is checked before any code moves in
either direction.
