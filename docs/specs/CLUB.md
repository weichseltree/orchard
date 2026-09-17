# The club: a VR venue and karaoke stage under the north wing

Written 2026-09-17 from Manuel's ask: *"a place in the world below the
world-engine and orangery that is a VR club and karaoke place ... it should not
allow users to enter if they don't have their microphone and audio output
enabled. The karaoke stage also needs VR enabled. You can prepare the audio
streaming but work on the design and map integration first."* And his
question: *"are we baking the light and sound maps or is that feature not
ready?"* — answered in §6.

§1 to §4 are built and live. §5 is the audio streaming as prepared: the
client's side is wired and the pipeline is designed, but no stream exists yet.
§7 lists the rulings that are Manuel's. Numbers marked **budget** are
proposals, not measurements.

---

## 1. The map

Three rooms, one presence room (`club`), all `observatory` architecture at
the palace's scale. "Below" is taken literally: the club is a cellar under the
north wing, and the wing's floor is its lid.

| room | bounds (m) | floor | doors |
|---|---|---|---|
| `foyer` | x 10..24, z −34..−20, 13 m tall | −5.0 | world-engine (x = 10, z −27, 3 × 4, opens at 1.5); club (x = 10, z −22.5, 3 × 4) |
| `club` | x −10..10, z −70..−12, 6.1 m tall | −5.0 | foyer; stage (z = −70, 10 m proscenium, 4 m high) |
| `stage` | x −6..6, z −76..−70 | −4.0 | club |

The descent is the generated stair the palace already uses for every change
of floor (`terrain.ts`): the foyer is the lower room of its world-engine
door, so it carries one flight of 41 steps, 11.9 m long, from the door at 1.5
down to −5, with the cheek walls, rail and newel lamps of every other flight.
The stage is a metre above the club floor, so the proscenium's threshold is a
7-step flight the full width of the opening: the stage's apron. Nothing here
was drawn by hand; every step is `bounds.min[1]`.

**Rooms may now stand over one another.** Navigation was xz-only: `roomAt`
and a pointer teleport took the first room in document order whose footprint
held the point, which under the wing would have been the orangery. Now
(`navigation.ts` `roomAt`, `locomotion.ts` `teleport`) the body's own room
wins when it holds the point, else the room whose floor is nearest the body's
feet; a caller that means a room names it (`into`), which the quality tour
does. The light bake was already three-dimensional; its cells sit inside the
club or inside the wing, never both, because the club's ceiling (1.1) is under
the wing's floor (1.5). A room under another (`observatory.ts` `covered`)
closes its vault's open crown with a dark lid, and the test that wants every
crown open to the sky now wants exactly that lid there.

The club's finish is its own (`ROOM_FINISH.club`, the stage aliased to it):
near-black stone, magenta lamps, cyan lines, and one new finish, `neon`, which
is self-luminous but not a lamp — it lights nothing around it in the bake —
for the floor tiles and the frames. The fittings (`clubFittings`,
`stageFittings`, `foyerFittings`): the dance floor of 24 neon tiles under a
mirror ball, two trusses of alternating colour along the vault, the bar and
back-bar down the east wall by the foyer door, four booths along the west,
the DJ's desk and stacks beside the stage, speaker stacks and a stone-and-neon
frame at the proscenium; footlights, the microphone stand, a neon-framed word
wall for the lyrics, a truss of five cans on the stage; a cloakroom counter
and two lanterns in the foyer. All instanced into the existing batches; the
world stays under the sixteen-batches-a-room budget.

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

- `world-engine` gained an east door at z −27 to the foyer; door signs and
  plaques come from the label files (eight languages, all written).
- Presence: one live row `club` (`set_room`), one line in the module's
  `SEED_ROOMS`. Chat and avatars are shared by the three rooms, as arcedit's
  eighteen share theirs.
- The quality stations now stand on each room's own floor (they stood at
  y = 0 everywhere, which put the raised wing's camera at ankle height and
  would have put the club's in the orangery); three stations added.

## 5. The audio, as prepared

**The club's music is a live exhibit** (AUDIO-STREAM.md §1–§3): a name with
no bytes behind it, never cached, LL-HLS Opus. The hanging that will carry
it is one line of JSON, left out of mansion.json on purpose until the stream
exists — a playlist that answers 404 is a fatal HLS error, which the client
reports as *"exhibit silent"* to every visitor who comes near, and the demo's
"no external requests" check would fail on the fetch:

```json
{ "id": "club-floor", "kind": "audio", "title": "The floor",
  "live": { "provider": "club", "streamId": "floor" },
  "position": [0, -2.5, -52], "sizeMeters": 14 }
```

Landed for it: a live audio exhibit now joins the venue's shared
`AudioContext` (`world.ts` `audioContext`, `audio-exhibit.ts` `context`), so
the same **Sound on** that opens the door is what makes the stream audible —
`AudioExhibit.unmute()` was never called from the app before; the venue's
exhibits are unmuted the moment the gate is on (`syncVenueSound`) — and the
beat follower reads the first venue exhibit's bed. With the hanging in place
and a stream at `media.weichseltree.com/audio/live/club/floor/live.m3u8`
(the encoder side of AUDIO-STREAM.md §3), the floor plays and the lights
follow it. No topology: the bed alone, which is what a DJ set is.

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
