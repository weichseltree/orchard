# Talking to Faye in VR

Written 2026-09-16, from Manuel's ask: *"I want you to have a direct VR
integration. Can you appear in the local version of the orchard as The Great
Admin Spirit Faye?"* and *"plan the VR integration fully"*.

**Where this started.** Faye stood in a local grove, watched the compute on
both boxes, announced what changed and answered a visitor who named her —
but only as a script-to-script exchange: no visitor could reach any of it from
inside the grove. This document was the path from that to a conversation a
person can have wearing a headset. §1 says where that path now stands; the
sections after it are kept as the plan they were.

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
| The chat LOG in an immersive session | **works** — a canvas panel, visitor-locked, built on the first session |
| A visitor SPEAKS with their voice | **works in flat mode** — hold-to-talk in the chat panel |
| A visitor ASKS her something in a headset | **works** — a wrist menu of four asks: left B/Y, right stick, trigger (§6 option 2) |

Updated 2026-09-16, evening. Every row is done, and all of it is live: the
module with `broadcast`, the chat panel, the headset log, the wrist menu, and
voice through Deepgram (key set as a Pages secret, socket allowed by the CSP).
Faye herself goes live when `deploy/faye/install.sh` is first run.

**Deepgram changed what §6 says.** Voice was written down as blocked on
Cloudflare Realtime, and that is still true of visitor-to-visitor spatial
voice, which needs an SFU. It was never true of talking to Faye: that is one
client and a transcription service.

**She hears one room.** Chat reaches only the room it is said in, and she
stands in the hall (presence `grove`). Every way of asking her works in every
room, so a visitor elsewhere who names her is told where she stands, and one
in the hall while she is away is told nobody will answer
(`src/faye/names.ts`). Answering in every room would mean one admin speaking
into all of them, which is a ruling, not a fix.

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

## 6. Stage four — speaking in a headset

*As built (2026-09-16): (2) shipped as the wrist menu, and voice shipped too —
not through Cloudflare Realtime but as push-to-talk transcribed by Deepgram,
which needs no SFU because talking to Faye is one client and one service
(§1). Spatial voice between visitors is still (3) as written below. The rest
of this section is the plan as it was made.*

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
not local unless it is run with `--live` and her own identity.

- **She never claims a run succeeded.** `completed exit=0` is also what a
  kill, an OOM and a time-budget stop record. Enforced by a test.
- **She never invents an answer.** No model call; every reply comes from the
  feed she holds, and "I cannot see a peer from here" is a real answer.
- **She never announces the plumbing.** A dashboard that will not answer is
  logged, not broadcast.
- **She never reports what she cannot see.** With a run's own feed and no
  expdash she can say what runs declare and nothing about the lanes, and that
  is what she says — never that the boxes are idle (§10).
- **She speaks only when named.** A room where every sentence might summon a
  spirit is a room nobody can talk in.
- **She stands in the live world only as herself.** Ruled by Manuel on
  2026-09-16 (§8, ruling 1). Live she needs `--live` and her OWN identity
  (`~/.config/orchard/faye.token`, made with `--new-identity`, granted with
  `add_admin`, revocable with `remove_admin`), and never a CLI's token: the
  maincloud CLI's token is the publisher, and a long-running script must not
  hold what can delete the module (`src/faye/local.ts`). She runs as the user
  service `orchard-faye`, from her own worktree pinned to `origin/main`
  (`deploy/faye/install.sh`), never from the main checkout.

## 8. Rulings this asks for

1. **RULED 2026-09-16: yes, the public world.** Manuel accepted the disclosure
   below: she names trees by their labels and says how many runs are on each
   box, in a public room. The recommendation that follows is kept as the
   reasoning it was, not as the decision.
   *Original question:* **Does Faye ever stand in the PUBLIC grove, or only local?** Everything
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
   *Built, and voice to Faye then shipped anyway through Deepgram; item 7,
   spatial voice between visitors, still has no date.*
4. **May a `cue` name a bundle, or only a built-in effect?** Stage two ships
   built-ins only. Letting a cue name a content-hashed bundle is the general
   answer and needs a rule for what happens when a client does not have the
   bundle yet — silence, presumably, since a cue is a moment and cannot wait
   for a download.

## 9. What is landed against this document

- `grove/scripts/faye.ts` — presence, the compute watch, announcements, replies.
- `grove/src/faye/events.ts`, `reply.ts` — the feed, the cursor, the selection,
  the answers. Pure, tested, never in the client bundle.
- `grove/src/faye/feeds.ts` — more than one feed at once: a cursor and a
  baseline per feed, one poll turned into what she says, and the echo check
  (§10, orchard #60).
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

- `grove/src/ui/world-chat.ts` — §5's log as scene geometry, visitor-locked,
  redrawn only when the text changes.
- `grove/src/voice/browser.ts`, `support.ts`, `ui/chat.ts` — §6's hold-to-talk.

- `grove/src/ui/ask-menu.ts`, `wrist-menu.ts` — §6 option 2, ruled in by
  Manuel on 2026-09-16: four asks on the left wrist. Left B/Y opens it, the
  right stick's vertical steps, the trigger asks — and while it is open the
  trigger does NOT toggle playback, or choosing a question would also pause the
  tape behind it. A test holds every entry to the intent `intentOf` reads.

- Voice made live-ready, ruled by Manuel on 2026-09-16: `microphone=(self)`
  and `wss://api.deepgram.com` in `public/_headers`, Deepgram named on the
  privacy page, and the grant sent as a `bearer` subprotocol (it had been
  `token`, which Deepgram reserves for account keys and refuses for a grant).
- Push-to-talk in a headset: hold either thumbstick in. A permission prompt
  cannot be raised in an immersive session, so an ungranted microphone says so
  in the headset log instead of doing nothing.
- The `update` cue: every open page checks for a new build now and requires it,
  still only at a safe moment (#16).

- The `turnstile` cue, ruled by Manuel on 2026-09-16 as "close the doorways":
  for the broadcast's lifetime every way out of the room -- doorway, teleport,
  portal -- is held, through the same `lockedRoom` question the ordinary locks
  use, capped at ten minutes on the client as well as in the module. The room
  says why when a visitor tries a door, and says once when the doors open.

All of the above is published and deployed. Manuel set the `DEEPGRAM_API_KEY`
Pages secret on 2026-09-16; before that `/voice/grant` answered 503 and the
button stayed hidden.

- `grove/src/faye/names.ts` — her name and her room, shared by the script and
  the client, which tells a visitor who names her where she cannot hear them
  where she stands. Her "what is running" answer is per box and never says
  "the card", since a cpu-lane run holds no GPU.

**The startup budget.** The ceiling was 215,000 when this was written and
voice alone would have broken it; it is now 230,000 (raised for the palace's
second pass, see `quality/budgets.json`) and this branch measures 222,156. Both features added here are loaded on
demand — voice on the first press, the log panel on the first session — and
that deferral is what keeps it under. The next thing on the startup path needs
either its own deferral or a deliberate ruling on the ceiling.

## 10. What she hears — the two feeds

*Built 2026-09-17 against [orchard #60](https://github.com/weichseltree/orchard/issues/60).*

expdash's `/api/status` says what the **lane** did: started, `completed
exit=0`, crashed. It cannot say what a **run declares about itself** — balanced
at year 41, hit the 60-year cap unbalanced, stalled, or the alerts coarsen
asked for — because no such vocabulary exists in a lane record. LogSwarm
watches those runs from outside (its `docs/specs/COMPUTE-WATCH.md`) and
publishes `logswarm/announce/1`, deliberately in the same document shape Faye
already reads (`ANNOUNCE-FEED.md` there), so `readFeed`, `accumulate` and
`announce` take it unchanged.

    pnpm tsx scripts/faye.ts … \
      --feed-url 'http://localhost:6104/feeds/<project>/planet/live.json?ns=demo-logswarm-default-rtdb' \
      --feed-token-file ~/.config/orchard/logswarm-feed.token

`--feed-url` is repeatable. The token is read from a mode-600 file and sent as
a header: a URL ends up in `ps`, in logs and in a `Referer`.

**One feed at a time, and the announcement feed is the one she is heading for**
(Manuel, 2026-09-17, after the code landed). expdash's raw stream is mostly
queue churn and reprioritisations — "the previous feed was garbage anyway" —
and that noise is exactly why LogSwarm re-publishes it through a filter a
person can read and edit in the graph. So:

- **Today she reads expdash, because it is the only feed that exists off the
  emulator.** That is the default and the deployed unit passes nothing.
- **When the announcement feed is deployed behind the `no-store` Worker she
  reads that one instead**, as her only feed: `--status-url ""` with one
  `--feed-url`. Nothing in the code needs to change for that — both feeds are
  the same document shape, so it is a URL.
- **What she can say then follows from what that document carries.** A feed of
  run declarations has no `experiments[]` and no mirror, so "what is running"
  becomes "I hear what the runs say about themselves, but I cannot see the
  lanes from here" and the peer answer becomes "I cannot see a peer from
  here" — two of the four wrist-menu asks. Getting them back means LogSwarm's
  graph carrying the lane facts, not Faye reading two feeds.

The rules below therefore describe a configuration she is not in: **the
two-feed path stays, unused** (ruled 2026-09-17, rather than deleted), because
it is what makes reading a second feed safe on the day one is wanted, and with
one feed the merge simply never runs. Its rule was that **expdash is the
primary feed** — it is the one that places a run on a box and reports the
mirror, so an announcement feed would run beside it rather than replacing it:

- **A cursor and a baseline per feed.** Both number their events `ev_<n>` from
  their own counter, and the counters have nothing to do with each other: one
  shared cursor would swallow the lower-numbered feed entirely or re-baseline
  every poll. Each feed's first reading is its own arrival, so a feed that
  comes up an hour late does not recite that hour.
- **One event is said once.** LogSwarm can ingest expdash's feed as well, so a
  crash can arrive on both. Announced together they would collapse into "2 runs
  crashed", which is not what happened, so a later feed's copy of what an
  earlier one already reported is dropped — matched on the run, the repo and
  the state, within three minutes, across polls as well as inside one.
- **The primary is never silenced.** Only a later feed's events can be
  dropped, so adding a feed can make her say more and never less than expdash
  alone would have.
- **A feed that does not answer changes nothing, except the tense.** The
  mirror and what is running come from expdash alone; a poll where it was down
  keeps the last answer it gave rather than reporting an idle box — and says
  so, with an age: "When I last looked, 20 minutes ago, 1 run: 1 on SirBase
  (coarsen)." An hour-old count in the present tense is a fabricated
  freshness, and a failed poll is the only place she can learn the dashboard
  has stopped answering, so that is decided even on a poll where nothing
  answered at all.
- **One fact is one sentence, whoever spelled it.** Two watchers of the same
  `~/.exp_status` record disagree about the word — expdash calls a start
  `started`, the planet watcher declares `running` — so the echo check
  compares what she would SAY, not the producer's spelling; otherwise one set
  of starts is announced twice, in the same sentence both times.
- **A line is as long as a room can take, not as long as the module allows.**
  Read off the emulator's feed on 2026-09-17: the planet watcher's plateau
  alert is 178 characters, 83 of them the thresholds it fired on, while its
  cap, finish and "no longer watched" lines are 68, 66 and 127. The module
  would carry all of it — and clip anything past 280 silently and mid-word —
  so the trim is hers: over 140 characters the parenthetical evidence goes
  first, **wherever in the sentence it sits**, and only then the sentence
  itself, at a word boundary, counted in code points so a cut cannot split a
  surrogate pair, and never leaving a bracket she did not close. Dropping only
  a *trailing* parenthesis was the first attempt and was wrong: the slowdown
  alert reads "…so far (load 25.1 on 16 cores; top: chrome 310%, node 180%).
  Box load, not the code", and a cut at the last word would have dropped the
  one clause ANNOUNCE-FEED.md §3 requires it to keep while leaving the numbers
  that invite the reading it forbids. Every line she says goes through this,
  not only the ones `announce` built.
- **A condition ending and a condition going unwatched are different facts.**
  The metric engine names both from whatever a person called the condition:
  `<name>-cleared` is the condition genuinely over, `<name>-expired` is the
  group dropped because the samples stopped — worded by the producer itself as
  "no longer watched (no samples)". So they are said as "cleared the plateau"
  and "are no longer watched for the plateau"; calling the second one cleared
  would announce a resolution to a run that merely went quiet, which is
  `completed`-is-not-success in another coat.
- **No declared state becomes a conclusion.** A collapsed burst needs English
  ("2 runs hit the cap unbalanced"), and that translation is the whole of it:
  `balanced` is not "stable", `plateau` is not "stuck", `finished` is not
  "succeeded", and a `slowdown` stays the box slowing a run and is never called
  a regression. A lone event keeps the producer's own title, which is how
  "s=0.96: hit the 60-year cap unbalanced at -3.26 W/m²" reaches the room.

**What is worth saying is decided upstream, in the graph, not here.**
`ANNOUNCE-FEED.md` §2 puts that filter in the editor on purpose — a person can
read and change it there, and the demo graphs wire "Worth saying" and
"Run-declared states and alerts" into theirs. So Faye has no allow-list of
types: she says what the feed she was pointed at publishes, in the producer's
own words. Pointing her at a stream of box facts would put box facts in the
room, and the fix for that is the graph, not a second filter here that would
silently swallow a state the runs learn to declare next month. One caveat of
the same kind: the spec lets `repo` fall back to `context.service`, and a
service name in that field reads in the room as though it were a tree.

**The live service does not pass `--feed-url` yet.** The announce feed exists
only on the local emulator; a feed that observes real boxes goes behind the
`no-store` Worker first (`AUDIO-STREAM.md` §7), and the deployed unit
(`deploy/faye/orchard-faye.service`) takes it then.
