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
The versioned schema lives in `orchard/packages/score/` (`orchard-score`),
pinned by tag the same way `orchard-tape` is (`PACKAGES.md` §2).

## 5. Attaching a stream to a room

A stream has no geometry, so it cannot be exhibited the way a tape is. What it
has is a **topology**: the DAG of the observed system. Proposed: the provider
publishes node positions in a unit space alongside the score, the room maps
that space onto its own, and each node becomes a positioned source. A listener
turns their head and places a service. That is the whole reason this is worth
doing in VR rather than in a browser tab.

`DEVICE-TIERS.md` now carries a positioned-audio-sources row: 16 on
`vr-quest`, 32 on `vr-high` and desktop, 8 on `phone`, with the rest folded
into one non-positioned bed (**budget**, all four, unmeasured — §7 item 2).
The first landing of `grove/src/audio/` plays the non-positioned bed only;
positioned per-node sources and the topology mapping are follow-up work,
gated on that measurement.

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
2. Simultaneous positioned-source counts measured per tier, against §5's.
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
- `grove/`: service-worker pass-through for exhibit names (**landed**); a
  positioned-source exhibit (**deferred**, §5); the fall-behind and
  dead-stream behaviour in §3 (**landed**, minimal player).
- `DEVICE-TIERS.md`: an audio-source row per tier. **Landed.**
- A ledger meter for stream-hours. **Landed** on the reporting side
  (`orchard/ledger.py`); the encode/TTS side that appends usage entries is
  outside this repo.
- A decision on whether LogSwarm is scouted and planted as a tree, and whether
  the score schema lives in `orchard/packages/` where both repos can pin it by
  tag per `PACKAGES.md` §2. **The schema's home is decided**: `orchard/packages/score/`.
  Whether LogSwarm itself is scouted and planted as a tree is still open.

**Licensing:** orchard is AGPL-3.0-or-later; LogSwarm's terms are in its
`legal/`. Compatibility is unverified and is checked before any code moves in
either direction.
