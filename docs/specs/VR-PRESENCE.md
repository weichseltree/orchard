# Talking to Faye in VR

Written 2026-09-16, from Manuel's ask: *"I want you to have a direct VR
integration. Can you appear in the local version of the orchard as The Great
Admin Spirit Faye?"* and *"plan the VR integration fully"*.

**What is already true.** Faye stands in the local grove, watches the compute
on both boxes, announces what changes, and answers a visitor who names her —
verified as a real two-identity exchange against a live database. A public
`broadcast` table now carries world events (cues and notices) to every client.

**What is not true.** A visitor cannot reach any of it from inside the grove.
This document is the path from a script-only conversation to one a person can
have wearing a headset, and it says plainly which parts are blocked on
something orchard does not have.

Numbers marked **budget** are proposals, not measurements.

## 1. The gap, stated exactly

| Piece | State |
|---|---|
| Faye is visible in the room | **works** — any presence peer draws as a capsule with a name sprite; an admin gets `· host` |
| Faye speaks | **works** — `say`, rate-limited to one line per 0.7 s |
| Faye listens and answers | **works** — `chat_here`, answers only when named |
| Faye fires world events | **works** — `send_broadcast`, admin only, expiring |
| A visitor SEES her speak | **works** — a chat panel in the HUD, and her last line hangs above her capsule |
| A visitor SAYS anything | **works** — `presence.say`, rate-limited by the panel so "slow down" never reaches a person |
| A visitor SEES a world event | **works** — `broadcast` is subscribed and gated (`world/broadcast.ts`) |
| Her speech in an immersive session | **works** — the capsule panel is scene geometry, so a headset shows it |
| The chat LOG in an immersive session | **missing** — still DOM; §5 |
| A visitor SPEAKS with their voice | **half** — the transcriber is built and tested (`src/voice/`), nothing calls it yet; §6 |

Updated 2026-09-16. Stage one and most of stage two are done; what is left is
the scrolling log in a headset, and the wiring that would let a person speak.

**Deepgram changes what §6 says.** Voice was written down as blocked on
Cloudflare Realtime, and that is still true of visitor-to-visitor spatial
voice, which needs an SFU. It is NOT true of talking to Faye: that is one
client and a transcription service, and Manuel already has Deepgram keys. The
row above is "half" rather than "blocked" for that reason.

## 2. The rule that shapes all of it

**In an immersive session the DOM is gone.** Everything a visitor reads in a
headset is drawn into a canvas, uploaded as a texture and hung on a mesh in
the scene. The grove already does this twice — `ui/provenance.ts` and
`ui/worldnotice.ts` — so this is a pattern to follow, not one to invent.

That single fact splits every feature below into a **flat** half that is cheap
DOM work and an **immersive** half that costs a panel, a texture upload and a
place to put it in the room.

## 3. Stage one — flat mode, and the conversation becomes reachable

The smallest change that makes the whole thing usable by a person.

1. **Declare `say` on `PresenceConnection`** (`net/presence.ts`) and expose
   `presence.say(text)`. The reducer and the binding already exist; the
   client's typed surface simply omits them.
2. **Subscribe to `chat_here`** alongside `people_here` and `poses_here`.
3. **A chat log and an input in the HUD.** Ordinary DOM. The input is the only
   new interaction, and on desktop the pointer is locked for locomotion, so
   the input needs a key to focus it and `Escape` to return to the world —
   the same lock/unlock dance `control/desktop.ts` already performs for the
   guide.

After stage one a person at a desk can talk to Faye. **This is the stage that
answers the original question for everything except a headset.**

## 4. Stage two — she can be heard in the room, not just in a panel

A chat log in the corner is not a spirit. Two pieces make her presence real
without touching the headset problem.

- **A speech panel above her capsule.** The same canvas-to-texture path as
  `worldnotice.ts`, parented to her avatar, facing the visitor, holding her
  last line for a few seconds (**budget**: 6 s, or until she says the next
  thing). This works in flat AND immersive, because it is scene geometry.
- **Cues become visible.** A `broadcast` of kind `cue` plays a named,
  pre-fetched effect. Stage two ships exactly one cue, `notice`, which is the
  speech panel in the middle of the room rather than above a capsule — enough
  to prove the trigger path end to end without an asset pipeline.

**The client's broadcast rule**, and it is not optional: a client acts on a
broadcast only if the row arrived *after* it subscribed, and only if the row
has not expired, and each row at most once. The table is public and a joining
client receives every row in it; without this rule a visitor walking in
replays the morning.

**Order broadcasts by `at`, never by `id`.** SpacetimeDB's auto-increment ids
are not sequential and gaps are normal (`spacetime/CLAUDE.md`), so an id is an
identity to deduplicate against and not a position in time. Two cues fired a
second apart can arrive with ids that do not order them.

## 5. Stage three — reading in a headset

Once stage two exists, the immersive gap is narrower than it looks, because
the speech panel is already scene geometry.

What is still DOM and must be re-drawn as a panel for immersive use:

- the chat log (a scrolling canvas panel, pinned to the visitor's left, or
  world-locked near Faye — see the ruling below);
- the notice list, which `worldnotice.ts` partly solves already.

**Text legibility is the whole difficulty.** `DEVICE-TIERS.md` gives
`vr-quest` a 2064×2208 per-eye budget at scale 1.0 and a 72 Hz frame target,
and a panel is one more draw call and one more texture against a 150-call,
256 MB budget. Proposed (**budget**, all of it): one panel, 1024×512, redrawn
only when the text changes, never per frame; 22 mm cap height at 1.5 m, which
is roughly 40 px on the panel.

## 6. Stage four — speaking in a headset, which orchard cannot finish

**There is no keyboard in an `immersive-vr` session.** The Quest browser
raises a system keyboard for a focused DOM input in flat mode, and not in an
immersive one. So a visitor in a headset can read Faye but cannot type to her.

Three ways out, and only the third is good:

1. **A pointer-driven virtual keyboard** drawn in the scene. Fully in our
   control, works today, and is miserable: controller-poked keys at one
   character per second turn a question into a chore.
2. **A short menu of canned asks** — "what is running", "how is the peer" —
   on a wrist panel. Cheap, works today, and honest about being limited. It
   covers most of what she can actually answer, because her replies are
   deterministic and few (`src/faye/reply.ts`).
3. **Voice.** The real answer, and BACKLOG item 7: spatial voice through
   Cloudflare Realtime, needing `CLOUDFLARE_REALTIME_*` in secrets, the CSP's
   `microphone` and `connect-src` widened, and session tokens minted in the
   token service and never in the client (BACKLOG 30).

Recommendation: **ship (2) and wait for (3).** Do not build (1); a virtual
keyboard is a week of work that voice makes worthless.

Note also that voice means speech-to-text before `replyTo` can read it, and
that is a second service and a second cost line. The ledger treatment should
follow `AUDIO-STREAM.md` §6 rather than be invented separately.

## 7. What Faye must never do, whatever stage

She is an admin, and an admin bypasses the ban check, the join throttle, the
per-network cap and room capacity. That is the correct identity for a host
standing in their own world, and it is why the script refuses any URI that is
not local.

- **She never claims a run succeeded.** `completed exit=0` is also what a
  kill, an OOM and a time-budget stop record. Enforced by a test.
- **She never invents an answer.** No model call; every reply comes from the
  feed she holds, and "I cannot see a peer from here" is a real answer.
- **She never announces the plumbing.** A dashboard that will not answer is
  logged, not broadcast.
- **She speaks only when named.** A room where every sentence might summon a
  spirit is a room nobody can talk in.
- **She does not run against maincloud** until §8's rulings are made, because
  a host appearing unannounced in a public room is a different act from one
  standing in a local test.

## 8. Rulings this asks for

1. **Does Faye ever stand in the PUBLIC grove, or only local?** Everything
   built so far is local-only by refusal. A visitor-facing spirit that speaks
   about a private repo's compute is a disclosure question, and it is the same
   one `AUDIO-STREAM.md` §7 already parks: no stream from an observed repo
   hangs in a public room before a redaction and consent story exists. My
   recommendation: local only until that exists, and the greenhouse as the
   first non-local venue.
2. **World-locked or visitor-locked chat panel in VR?** World-locked near
   Faye is more honest — you turn to her to read her — and is worse when she
   is across the room. Recommendation: world-locked above her capsule for her
   speech, and a visitor-locked panel only for the scrolling log.
3. **Is the canned-ask menu worth building, or does VR input simply wait for
   voice?** Recommendation: build it; it is small, and item 7 has no date.
4. **May a `cue` name a bundle, or only a built-in effect?** Stage two ships
   built-ins only. Letting a cue name a content-hashed bundle is the general
   answer and needs a rule for what happens when a client does not have the
   bundle yet — silence, presumably, since a cue is a moment and cannot wait
   for a download.

## 9. What is landed against this document

- `grove/scripts/faye.ts` — presence, the compute watch, announcements, replies.
- `grove/src/faye/events.ts`, `reply.ts` — the feed, the cursor, the selection,
  the answers. Pure, tested, never in the client bundle.
- `spacetime/spacetimedb/src/index.ts` — the public `broadcast` table,
  `send_broadcast`, and expiry in the sweep.

- `grove/src/ui/chat-log.ts`, `chat.ts` — the panel's rules and its DOM.
- `grove/src/net/avatars.ts` — a peer's last line above their capsule, which is
  the one part of chat a headset can see. Built by another session against §4.
- `grove/src/world/broadcast.ts` — the client's half of world events: the
  backlog refused, expiry read as a DURATION so a wrong client clock cannot
  break it, each row once, ordered by `at` and never by `id`.
- `grove/src/voice/transcript.ts`, `capture.ts`, `grove/voice/service.ts` — the
  transcriber, the push-to-talk loop, and the route that holds the key.

Not landed: §5's scrolling log as a panel, §6's wiring, and every cue but
`notice`. Nothing in this document is published to maincloud, and
`DEEPGRAM_API_KEY` is not in secrets.
