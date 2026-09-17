# The club: a VR venue and karaoke stage under the north wing

Written 2026-09-17 from Manuel's ask: *"a place in the world below the
world-engine and orangery that is a VR club and karaoke place ... it should not
allow users to enter if they don't have their microphone and audio output
enabled. The karaoke stage also needs VR enabled. You can prepare the audio
streaming but work on the design and map integration first."* And his
question: *"are we baking the light and sound maps or is that feature not
ready?"* — answered in §6.

§1 to §5 are built; §5's stream is the first of the three ruled follow-ups.
§7 lists the rulings that are Manuel's. Numbers marked **budget** are
proposals, not measurements.

---

## 1. The map

Five rooms, one presence room (`club`), all `observatory` architecture at
the palace's scale. "Below" is taken literally: the club is a cellar under the
north wing, and the wing's floor is its lid.

| room | bounds (m) | floor | doors |
|---|---|---|---|
| `stair-north` | x −20..−11, z −84..−76, 7.6 m tall | −5.0 | west grove (x = −20, z −80, 2.4 × 3.2, opens at −1.6); foyer (z = −76) |
| `stair-south` | x −20..−11, z 72..80 | −5.0 | east grove (x = −20, z 76); foyer (z = 72) |
| `foyer` | x −20..−10, z −76..72, 3.6 m tall | −5.0 | the two stairs; club (x = −10, z −55 and z −27, 4 × 3.2) |
| `club` | x −10..10, z −70..−12, 6.1 m tall | −5.0 | foyer ×2; stage (z = −70, 10 m proscenium, 4 m high) |
| `stage` | x −6..6, z −76..−70 | −4.0 | club |

**Ruled 2026-09-17, second pass (Manuel: "remove the stairs from the
world-engine room and put them into the garden, leading below the terrace
from multiple sides").** A room cannot overlap another at the same height,
so a stair pit cut into the garden's ground is not a room this engine can
hold. The descents are two stair pavilions at the terrace's ends, one
entered from the west grove, one from the east grove: each is a walled
garden building whose flight (22 steps, 6.4 m) goes down inside it to an
undercroft, the `foyer`, that runs the length of the terrace under its
flagstones and opens into the club through two doors. World-engine's east
door and the stair tower of the first pass are gone. The flights are the
generated ones (`terrain.ts`); the stage's apron is a 7-step flight the
width of the proscenium.

**Rooms may now stand over one another.** Navigation was xz-only: `roomAt`
and a pointer teleport took the first room in document order whose footprint
held the point, which under the wing would have been the orangery. Now
(`navigation.ts` `roomAt`, `locomotion.ts` `teleport`) the body's own room
wins when it holds the point, else the room whose floor is nearest the body's
feet; a caller that means a room names it (`into`), which the quality tour
does. The light bake was already three-dimensional; its cells sit inside the
cellar or inside the room above, never both.

**A cellar is finished on the outside too.** Three things follow from a room
under another (`observatory.ts` `coverOf`): it closes its vault's open crown
with a lid that fills the void up to just inside the slab of the floor above
(never to the floor itself, where the visitor walks); its walls are clad on
the outside, from below any outside ground up to that slab, in the stone of
the room above, gapped at doorways, so the terrace's edge and the wing's foot
are the palace's stone and not the club's black; and a run of cladding the
grounds can see carries a dashed string course of the cornice's blue under
the floor above, credited to the grounds' light region, because in this
nocturne an unlit wall is black and a plinth is only a plinth once it is lit.
And a room over or under a loaded room loads with it (`world.ts`
`neighbourhood`): before this, from the terrace nothing stood under the wing
and the void showed through, which was the "see-through to the underground".

The club's finish is its own (`ROOM_FINISH.club`, the stage aliased to it):
near-black stone, magenta lamps, cyan lines, and one new finish, `neon`, which
is self-luminous but not a lamp — it lights nothing around it in the bake —
for the floor tiles and the frames. The fittings (`clubFittings`,
`stageFittings`, `foyerFittings`): the dance floor of 24 neon tiles under a
mirror ball, two trusses of alternating colour along the vault, the bar and
back-bar down the east wall, booths along the west clear of the foyer's
doors, the DJ's desk and stacks beside the stage, speaker stacks and a
stone-and-neon frame at the proscenium; footlights, the microphone stand, a
neon-framed word wall for the lyrics, a truss of five cans on the stage; a
lantern either side of each club door in the undercroft. All instanced into
the existing batches; the world stays under the sixteen-batches-a-room budget.

## 2. The door

A room may say what it asks for: `requires` in mansion.json, one or more of
`microphone`, `sound`, `immersive` (schema.ts, `VenueNeedSchema`). The club
asks for the first two, the stage for all three. The schema refuses a gated
room that no lesser room reaches by an open doorway, because then nobody could
ever get in.

The gate is the lock the palace already has. `lockedRoom` in main.ts is the
one predicate every way out of a room is asked — walking, the XR head push,
a pointer teleport, the portals — and it now answers *true* for a room whose
needs the visitor has not met (`world/venue.ts`). So a barred door behaves
exactly like a closed one: a wall. What the visitor *has* is never a flag the
page set once; it is read live each time the door is asked:

- **microphone**: an open `getUserMedia` stream with a live track
  (`audio/microphone.ts`). A track that ends — the tab's "stop sharing", a
  device unplugged — shuts the door again. This is separate from the voice
  capture that talks to Faye, which only exists when the transcription route
  is configured; a visitor with no such route can still open a microphone.
- **sound**: the shared `AudioContext` is `running` (`audio/gate.ts`). A
  browser starts it suspended until a gesture and the system can suspend it
  again; the door follows the state, not the click.
- **immersive**: `renderer.xr.isPresenting`.

**What the visitor sees.** A barred door is not an invisible wall: a curtain
of light threads hangs in it (`world/venue-curtain.ts`) and lifts the moment
the need is met. Bumping it says why, in one sentence (`venueReason`, tested):
*"club asks for your microphone on and your sound on. The offers on screen
switch it on."* Arriving in the foyer, or bumping the door, puts two offers in
the HUD — **Allow the microphone**, **Sound on** — each removed when its need
is met. In a headset the offers are not on any screen, so the trigger takes
the sound offer; a microphone cannot be prompted for inside an immersive
session, so the sentence says the honest thing: allow it outside VR first.

**A link into the club lands at its door.** `?room=club` (and `?room=stage`)
arrives in the foyer (`visitRoom`, `venueEntrance`), with a notice saying what
the room asks for; without this a shared link would stand a visitor inside a
room whose rule they have not met.

**The stage is left with the headset.** On `sessionend` a body standing in a
room that requires `immersive` steps down to the nearest room it may still be
in (`retreat`): the club floor, or the foyer if sound or microphone went too.
Entry is the only gate for the club itself: a visitor whose microphone ends
inside is not thrown out, they simply cannot come back in until it is on.

**The demo has no doors.** Every gate is off under `?demo`, like the presence
locks, so the quality suite's room tour reaches every room; the demo's
`venueState` reports everything on.

## 3. The light

The palace's light is **baked**: `lightfield.ts` sums every luminous element
of the architecture (and the portals) into a 3D texture the stone shader
samples once per fragment, once per boot, memoised. There is no Blender bake
any more and no scene lights on architecture. The club's lamps enter that
bake like any other room's: the sconces, the cornice, the ribs, the trusses,
the back-bar shelves, the footlights and the cans are emitters; the neon is
not.

What the club adds is **one moving layer over the bake**: a gain inside a box
(`uPulseMin/uPulseMax/uPulse`, the union of the gated rooms, `venueBox`) and
the same gain on the club's own luminous materials (`tintLuminous`). With
music playing the gain follows the low end of the stream, read from an
analyser on the field's bed (`audio/beat.ts`, the mapping pure and tested);
with nothing playing the room breathes slowly about one, so a silent club is
never a dead one. Cost: three uniforms and two colour writes a frame. The bake
itself never changes.

## 4. Where the palace meets it

- The west and east groves each gained a door to a stair pavilion; door
  signs and plaques come from the label files (eight languages, all written).
- Presence: one live row `club` (`set_room`), one line in the module's
  `SEED_ROOMS`. Chat and avatars are shared by the five rooms, as arcedit's
  eighteen share theirs.
- The quality stations now stand on each room's own floor (they stood at
  y = 0 everywhere, which put the raised wing's camera at ankle height and
  would have put the club's in the orangery); three stations added.

## 5. The audio: the floor's stream, built

**The club's music is a live exhibit** (AUDIO-STREAM.md §1–§3): a name with
no bytes behind it, never cached, Opus in fMP4 over HLS. This cut publishes
plain two-second segments and no LL-HLS parts, so a listener sits about five
to seven seconds behind the encoder and visitors hear the beat within a few
seconds of one another; §3's two-second budget is not met by it and waits
for a packager that writes parts. It is hung in the club:

```json
{ "id": "club-floor", "kind": "audio", "title": "The floor",
  "live": { "provider": "club", "streamId": "floor" },
  "position": [0, -2.5, -52], "sizeMeters": 14 }
```

**The encoder** is `orchard stream run` (`orchard/stream.py`), a service on
the host's machine (`deploy/stream/install.sh`, a systemd user unit like
Faye's). ffmpeg encodes Opus into two-second fMP4 segments under a live
playlist; the module uploads each new segment and then the playlist to the
media bucket under `audio/live/club/floor/` (the playlist with `no-store`,
the segments with a minute's cache) and deletes what fell out of the window,
keeping two extra for a player mid-fetch. Every accounted minute goes to the
ledger's `.audio_usage.jsonl` as encode hours and the host's operations.

**What plays** is a directory of tracks the venue may distribute
(`~/.local/share/orchard-stream/tracks`, looped; the ruling below allows own
or licensed recordings only). With none, the floor plays **the seeded set**
(`orchard/setgen.py`): an endless techno set rendered bar by bar as a pure
function of a seed and the bar index, four-on-the-floor at 124, a bass
pattern and a chord that change every eight bars, hats, a clap, a pad, now
and then an arpeggio, a breakdown every fourth section. A program, not a
person; the wall text says so. `orchard stream render out.wav --bars 16`
writes it to listen to.

**The encoder runs only while someone is in the club.** It counts the rows
of the live `whereabouts` table in the venue's presence room every five
seconds, on a thread of its own so a slow database never holds the players
up, and stops a minute after the last visitor leaves (AUDIO-STREAM.md §6).
While idle it leaves an **empty live playlist** published, so a player that
arrives waits rather than fails; when someone comes the encoder starts
within a poll and the playlist fills. The sequence and the set's position
survive a restart (`sequence.txt` in the workdir); a failed upload is logged
and retried with a backoff of up to half a minute while the encoder runs on;
an encoder that dies or stalls is restarted with a backoff; on stop the
retire is bounded. **The client's player is awake only in its room**: the
club's floor is fetched by the club's visitors, not by everyone in the
palace. Waking, it looks at the playlist first: a live one is attached, an
empty one is waited on quietly (a notice once), and it looks again every
eight seconds (`audio/exhibit.ts`). A playlist whose newest segment is more
than half a minute old is a leftover of an encoder that died, not a stream
(`playlistIsFresh`). Playback holds the live edge two segments back and
jumps back to it when it drifts by more than four seconds; §3's silence
applies when jumping does not help. A live exhibit joins the venue's shared
`AudioContext` so the same **Sound on** that opens the door is what makes
the stream audible, and the beat follower reads its bed for the lights; a
floor that is on but silent breathes like no stream at all. The demo loads
no live exhibit, having no network.

**Dev**: `orchard stream run --local results/bundles/audio/live/club/floor
--always` publishes into the directory Vite serves as `/local-bundles/`, so
`pnpm dev` plays the floor from this box.

**Karaoke** is three things, none of them the stream above:

1. **The backing track plays locally, not over the stream.** A singer cannot
   sing to a track that arrives two seconds late. So a song is a
   content-hashed `audio` bundle (Opus track, a manifest, timed lyrics as
   JSON: `orchard/lyrics/1`, lines with start and end seconds), kept forever
   by the service worker like every bundle, and every client in the room
   starts it at the same server timestamp. Latency to the singer: none.
2. **The singer's voice goes over WebRTC**, which is the piece AUDIO-STREAM.md
   §3 and VR-PRESENCE.md §6 both defer to Cloudflare Realtime: the stage
   publishes the microphone stream `audio/microphone.ts` already holds, only
   while the body is on the stage and only in an immersive session (the
   stage's own rule); every other client in the presence room subscribes and
   feeds the track into the same `AudioField` as a positioned node at the
   microphone stand, so a listener turns their head and the singer is *there*
   on every tier's ladder. Listeners' local track playback is delayed by the
   measured publish-to-subscribe latency (**budget** 250 ms p50) so voice and
   track stay together for them; the singer hears no delay. The same path,
   positioned at the avatar, is spatial voice chat on the floor — the
   microphone the door asked for is for this, not only for singing.
3. **The word wall** on the stage's back wall is a canvas panel (the
   `worldnotice.ts` pattern) showing the current line, the next line dimmer,
   in the visitor's language when the bundle carries it. Scene geometry, so
   the headset reads it.

**The queue** is the module's: `stage_queue` (identity, bundle, joined_at) and
`stage_set` (bundle, singer, started_at); reducers `queue_song`,
`leave_queue`, `start_set` (the head of the queue, once the stage is empty,
or the host), `end_set`. Area admins of the venue moderate the queue with the
moderation they already have. This is a module change and so a publish
Manuel makes.

**Privacy, stated.** The microphone the door asks for stays in the browser
until the visitor takes the stage or, once voice chat exists, speaks on the
floor; it is closed on page hide. Nothing is recorded. A set is *kept* into an
`audio` bundle only when the singer asks for it, and then it is theirs: the
bundle names them and the song, and it is unlisted until they list it.

**Licensing is the first ruling (§7).** A karaoke bundle is a recording
distributed to every listener; only tracks the venue may distribute can be
bundled — own recordings, licensed instrumentals, or public-domain and CC
material with attribution in the manifest. There is no "upload any song".

## 6. Light and sound maps: the answer

**Light: yes, baked, and it stays baked.** See §3. It is not a build-time
artefact in the sense of a file on disk; it is baked from the architecture
each boot in a few milliseconds and cached for the mansion object, which is
the same thing with no staleness. The club adds the only dynamic layer the
palace has.

**Sound: no, and there never was one.** What exists is placement: a live
exhibit's nodes are positioned sources on a per-tier ladder (HRTF, panner,
stereo, bed). No room has acoustics — no reverb, no occlusion, no early
reflections. A voice at the stage would sound the same in the vaulted cellar
as on the open terrace. That is the missing "sound map", and it is not ready.

Proposed, in two steps, both **budget**:

1. **A room's acoustic profile from its architecture.** Each room gets a
   reverberation time from Sabine's estimate over its box and its finishes
   (stone and inset absorb little, the grounds nothing to reflect off), an
   impulse response synthesised from it (decaying noise, a few early taps at
   the walls' distances), and a `ConvolverNode` on the field's master with a
   wet gain crossfaded at doorways. The cellar rings, the terrace does not.
   Cheap: one convolver, one IR per room, no offline bake. The estimate is a
   design token like the light's falloff, not a claim about acoustics.
2. **A baked sound map, like the light field.** Ray-traced IRs per cell of a
   coarse grid, stored beside the light field, sampled at the listener and at
   each source; occlusion from the same walls. This is real work (a tracer,
   a storage budget, a headset measurement) and is worth doing only once
   there is a voice to hear in the room. It is the same shape as the light
   field, which is why the answer is "not ready" rather than "no".

## 7. Rulings for Manuel

1. **The look.** Captures of the three rooms are in
   `results/quality/world-screenshots/{foyer,club,stage}.png`. Keep the
   magenta-and-cyan pair over near-black, or pick another pair; the finish is
   one line in `ROOM_FINISH`.
2. **Licensing of karaoke material** (§5): own and licensed recordings only,
   with attribution in the bundle manifest. Recommended, and a precondition
   for building the queue.
3. **Cloudflare Realtime** for the voice link (singer and floor chat), under
   Weichseltree OÜ's account. It is the same dependency VR-PRESENCE.md §6
   deferred; nothing else on the list needs a new vendor.
4. **The microphone policy**: opened at the door (as built) versus opened only
   on taking the stage, with the club asking only for sound. As built matches
   the brief; the alternative is a smaller ask of a visitor who only wants to
   listen.
5. **Acoustics step 1** (§6) before or after the stream: recommended after
   the first stream plays, so it is heard on something.
6. **The presence room**: one `club` for the three rooms (as built), or a
   `stage` of its own so a singer's chat is the stage's. One is recommended.

## Ruled by Manuel, 2026-09-17

1. **The look stays**: magenta lamps and cyan lines over near-black stone.
2. **Karaoke material**: own or licensed recordings only, attribution in the bundle manifest.
3. **Cloudflare Realtime** carries the voice link, under Weichseltree OÜ's account.
4. **The microphone is asked for at the door**, as built.
5. **Order of work**: the floor's live stream, then the karaoke queue, then acoustics step 1 — each its own PR, reviewed by a subagent (Copilot credits are used up), merged and deployed by the session.
6. **One presence room** (`club`) for the three rooms.
