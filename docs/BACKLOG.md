# Backlog

Ordered. Items with a name in brackets wait on that person.

## Blocking the M0 definition of done

1. ~~**[Manuel] Enable R2**~~ Done 2026-09-12: R2 on, bucket and domain
   created, the ab_d2 tape (`2dd0038799b2db15`) and the 40 s clip
   (`216b720501856b14`) pushed, verified byte for byte, and hung on
   einstruct as exhibits 1 and 2; both serve from
   `https://media.weichseltree.com/` with the right content types and CORS
   for the production origin. The definition of done's items 1 and 2 hold.
   Still owed from the first production visit: nobody has yet walked into
   the einstruct room on the live site and watched the sheet and the wall
   load; the local client did against the same bytes. The other harvested
   bundles (the einstruct master, the spectre master and assembly, the
   styleframe for the hall's poster wall) wait on their own rulings;
   `orchard exhibit hang <dir> --approve` is the whole step for each.
2. ~~**[Manuel] Release the custom domain in Patreon**~~ Done by 2026-09-12
   16:30: both Pages domains report active and `https://weichseltree.com/`
   serves the grove.
3. **[Manuel] Hardware pass**: Quest 3 browser (XR entry, controllers,
   teleport, scrub, 72 Hz) and an iPhone (native HLS, touch stick). Everything
   past `requestSession` is untested on hardware (docs/impl/WP2-grove.md).
   Since 2026-09-12 also: walk einstruct's two sheets and two walls, and the
   world-engine and phototroph box rooms off its east and west walls, in a
   real browser; the headless shell shows the live site as sky only (every
   deployment, so a tooling artifact), and on this box the WSL resolver
   does not resolve media.weichseltree.com although public DNS does. The
   hall's poster wall pins `c59c7baa6fd15489`, a still never pushed (it is
   unapproved), so the wall 404s and stays bare until that styleframe is
   ruled on or the pin changes.

## Known visual issues from the first deploy

4. ~~Hall windows read as black rectangles with a bright rim~~ — fixed
   2026-09-12 in the client: a gradient sky dome outside the mansion with the
   sun where the bake put it (`grove/src/world/sky.ts`, `sky` in
   `mansion.json`; DECISIONS). Deployed 2026-09-12 with the exhibit-table
   client (`cd grove && pnpm run deploy`; `pnpm deploy` without `run` is
   pnpm's own workspace command and fails). The dome's colours are a first
   guess and belong to item 6.
5. ~~Lightmap ships as a 2.2 MB PNG; produce KTX2~~ Done 2026-09-12:
   KTX-Software 4.4.2 in `~/tools/ktx` (`toktx` on PATH),
   `grove/tools/compress_lightmap.py` writes `lightmap.ktx2` (2048², 1.9 MB,
   UASTC q2 + zstd 18, mipmapped) and `lightmap-1024.ktx2` (0.6 MB) and
   records both in hall.json and the glb; `mansion.json` lists the KTX2
   first with the PNG behind it, and a `lightmapPhone` list gives the phone
   the 1024 tier (`lightmapCandidates`, tested). Headless Chromium loads the
   2048 KTX2 through the Basis transcoder and the hall reads as before; the
   phone tier is unit-tested only (the headless shell does not emulate touch).
6. Windows' blown highlights and the plain grey palette; a first pass of
   material and colour design for the hall (LAWS 12, 13). **Ruled 2026-09-12:
   gallery** (charcoal walls, near-black polished floor), from the four
   previews in `docs/img/hall-palettes-2026-09-12.png`. Baked at 1024
   samples (794 s CPU, scale 2.969, 0.007% clipped), KTX2 tiers encoded,
   verified and deployed 2026-09-12 17:12. verify_hall.py now reads the
   baked palette from hall.json instead of the stone constants. Still
   open under this item: the doorway's light spill on the floor (WP3 known
   issue 2, a rebake with the neighbour room in place) and the windows'
   reveals, which the sky dome now sits behind.

## M1 (company)

7. Spatial voice through Cloudflare Realtime (needs CLOUDFLARE_REALTIME_*
   in secrets and the CSP's `microphone` and `connect-src` widened).
8. The greenhouse. ~~The flat dashboard gains the three panels~~: done
   2026-09-12, `orchard serve` shows the review queue with verdict buttons,
   the rulings, the directives (set and retire) and what hangs in the grove,
   all through the CLI's admin identity, local only. Left: the admin identity
   in the browser and the greenhouse room in the grove.
9. ~~`orchard sync` as a service~~ Done 2026-09-12: `orchard sync all`
   pushes the planted trees and the ledger snapshot and pulls rulings back
   into the manifests (a ruling's verdict and the review item's kind imply a
   stage; stages only move forward; `changes` writes `blocked_by`);
   `orchard sync install` puts `deploy/systemd/orchard-sync.{service,timer}`
   into the user's systemd, every 15 minutes, enabled and running on
   SirBase. `journalctl --user -u orchard-sync` is the log.

## Platform

10. ~~`orchard bundle` for stills; `orchard exhibit` calling `hang`;
    provenance sidecars~~ — done 2026-09-12 (docs/impl/M2-harvest-exhibit.md).
    A `still` hanging on the hall's poster wall followed the same day.
    Left: splats.
11. The spacetimedb SDK's `Function()` codegen forces `unsafe-eval` in the
    CSP. **[Manuel] File the issue**: the text is drafted with the line
    numbers in `docs/upstream/spacetimedb-unsafe-eval.md`; filing is under
    your GitHub account.
12. Second node on Legion and the first portal (M3).
13. **The palace and its orchard** (Manuel, 2026-09-12): the hall becomes
    the first room of a palace, Austrian in character, and the grounds
    outside the windows an actual orchard: terrain, trees, a garden the sky
    dome stands in for today. Needs a look ruling (stills first, LAWS 14)
    and a bake pipeline for exteriors; instanced trees for the Quest budget.
14. ~~**Talk to the trees.**~~ Done 2026-09-12: six trees answered
    (einstruct, spectre, world-engine, premosaic, phototroph,
    someotherlife); the answers and the rulings they ask are in
    `docs/EXHIBIT-PLAN.md`, the manifests in each repo's `orchard.yaml`.

## From the trees' answers (2026-09-12)

15. **Harvester, fixed the same day:** a tape's digest covers header, index
    and trailer and a tape still being written is refused; `commit` set by
    the tree survives a harvest; one unreadable manifest no longer blocks
    every tree (`portfolio.BROKEN`, a stderr line). The bundler's aligned
    slot choice across tapes with the same slot count is a test.
16. **Per-artefact slot budget and frame stride** (spectre bug 7): a
    manifest field on the artefact, so a 508k-particle tape can ship 16k
    slots at every 4th frame (about 36 MB) instead of 1 point in 128. First
    of the format items; blocks the trio reading as a ball when sliced.
17. **Species names and palette from the tape header** (spectre bug 3):
    `meta.species_masses` names heavy and light; the client's orange and
    blue break LAWS 12 for spectre's style B (iron-warm and pale). A
    per-exhibit palette in the hanging, defaulting from the header.
18. **Extra channels and per-frame `t`** (spectre bugs 5, 6; phototroph):
    the bundler reads only pos, species and alive, so spectre's `ke` (heat)
    and phototroph's `bond_count` never reach the grove; carry declared
    extra channels, and the index's per-frame t instead of one mean dt
    (drift up to a tau inside a chunk). The poster labels time in "tau"
    whatever the header's `units` says; phototroph's unit is t0.
19a. ~~**bundle.json's `source.tree_commit`** still records the harvest HEAD~~
    Done 2026-09-13 (docs/impl/bundle-hygiene.md). Harvest passes the
    artefact's commit into the bundle. A commit the tree wrote survives,
    and a source git tracks gets the commit that last touched it. A
    gitignored result still gets HEAD, now never `-dirty`, because harvest
    refuses a dirty tree without `--allow-dirty`.
19. **`<stem>.json` render sidecars** (spectre bug 4): carry beside the
    stock `<file>.json` sidecar, under a different key; the measured numbers
    live there.
20. **One scrubber for N tapes, and a cut plane** (spectre): the clock
    contract already aligns the trio by frame index; the room needs a
    shared scrub and a hand-held cut plane fading over one sigma (LAWS 11).
21. **A `page` artefact kind** (world-engine): one self-contained HTML
    file, CSP-clean, opened flat from a plaque; bent-light.html first.
22. **A `splat` kind** (someotherlife): SPZ tiers, stations with a measured
    coverage radius, an occluder mesh and a preview still; Spark as the
    decoder; no SharedArrayBuffer path (the grove sends COOP without COEP).
    Needs Spike C's numbers first.
23. **Lift from someotherlife's client:** the XR-support probe token
    (stale "unsupported" can land last in the grove's watchXrSupport), the
    distance-clamped orbit for vantage-point rooms, dwell and raycast
    pointing if exhibits get point-to-select.
24. **A tree lowering its own stage.** spectre set its thesis back to
    styleframe on purpose. Checked 2026-09-12: the database holds no rulings
    yet (the timer logs 0 reviewed), so nothing can push it up today; but
    sync only moves stages forward, so once an approved-animatic ruling
    exists a later honest demotion by the tree would be undone every 15
    minutes. Needs a rule: a ruling advances a stage only if it is newer
    than the manifest's last change to that thesis, or the tree records the
    demotion as a ruling of its own.

## Security (2026-09-12, docs/SECURITY.md)

25. ~~**Turn the token service on**~~ Done 2026-09-12: keys generated,
    Turnstile widget "grove token service" (managed, site key
    0x4AAAAAAExzRPz5E0HakeDL, now the build's default), secrets pushed to
    Pages, grove deployed, maincloud accepting the tokens, gate on. Automated
    browsers get Turnstile's checkbox and cannot pass it, so a headless check
    of the live grove renders the world but never joins presence; test
    presence on the local stack (grove/scripts/module-check.ts).
26. **[Manuel] Split the Cloudflare token** into deploy, R2 and admin tokens
    (HOSTING.md, "Split it"); the code already reads all three.
27. ~~Turnstile reachability check~~ dropped 2026-09-12 by Manuel's ruling.
28. ~~**An Impressum**~~ Done 2026-09-12: /impressum/ names Weichseltree OÜ
    (registry code 17482992, Sepapaja tn 6, Tallinn), and the privacy page
    names it as responsible.
29. The host in the browser (with item 8): an admin identity in the grove
    needs its own token path; the CLI token must not go into a browser.
30. Voice (item 7) mints Cloudflare Realtime session tokens in the same
    token service, never in the client.
31. **[Manuel] Everything under Weichseltree OÜ.** Move the services to an
    organisation account of the company and switch their billing, and
    Stripe's payouts, to the Wise Business account: Cloudflare (Pages, R2,
    DNS, Turnstile), SpacetimeDB (maincloud credits), Google Cloud (Gemini),
    Anthropic, OpenAI, ElevenLabs, GitHub (weichseltree), YouTube, Patreon.
    Moving the Cloudflare account is also the moment for the token split
    (item 26); moving SpacetimeDB means a new publisher identity, so add it
    with `add_admin` before the old login goes.

## The palace round (2026-09-12, evening)

Manuel's ask: per-exhibit playback with pre-baked sound and a visibility
map; the walls' z-fighting; a full palace design with models, scenes, bakes
and device optimisation; a rethought UI with gestures, 3D hints, sound,
voice through an LLM, a session recorder for arcedit, a desktop UI and a
phone-first client; a brand package; the community and the infrastructure
from the repo inward, including multiplayer voice. Done the same evening:
the z-fighting (no outward wall faces), tapes and walls play only in the
visitor's room, the Quest's still tier; five specs written by subagents and
reviewed. What each asks next:

25. **PALACE.md P0, the contact sheet.** Twelve stills (15 to 25 min CPU)
    for the look ruling, after Manuel answers its six questions (facade
    colour, season, the moon by day, the hall's French doors, the
    orangery's light, closed doors for unearned rooms). Then P1 hall plus
    einstruct rebake, P2 grounds, P3 the rest; about 5 CPU hours, half
    eligible for Legion. Needs `grove/tools/palace/` grown from
    `bake_hall.py` first.
26. **PALACE-ASSETS.md:** `grove/tools/lift.py` (download, hash, licence
    from the provider API, sidecar); the Belvedere statues and Vienna
    fountains (CC0, noe-3d.at) as the first lifts; the Karlskirche impulse
    response; no baroque kitbash exists, so cornices and windows are
    modelled by the generator.
27. **DEVICE-TIERS.md migration, twelve steps:** the perf panel with
    per-exhibit state and bytes first (so the hardware pass fills the
    table), then budgets, frame rate and foveation, `TapeStream.release()`
    for frozen tapes (34 MB resident today), the pure state machine,
    `visibility.json`, rooms by adjacency, the bundler's chunk size scaling
    with slots, sound, splats, pages. Done from it already: the Quest takes
    the 1600 px still tier.
28. **INTERACTION.md, steps 1 to 4 first (a day):** the seven verbs and
    "act on what you point at", the Escape and pointer-lock fix, hints as
    furniture, then the recorder before voice so voice is measurable;
    `microphone=()` in `_headers` becomes `microphone=(self)` when voice
    lands; the arcedit harness per §4.6 (S0 to S2 can run in any session).
29. **COMMUNITY-AND-INFRA.md, six steps, about 90 hours:** the front door
    (README with a hero still and a 20 s clip, Discussions, Sponsors, DCO),
    the gate and voice (Cloudflare Realtime at launch, LiveKit Cloud at
    scale, Whisper on Workers AI for commands, `claude-opus-5` behind a
    Worker for voice-to-action), the host in the browser, launch,
    membership and the vote (Stripe), speech. Legal: Impressum,
    Datenschutzerklärung, 14+ for the grove and 16+ for voice. **Correction
    owed:** the spec assumed an Austrian sole trader, but the operator is
    Weichseltree OÜ, Tallinn (another session's impressum page under
    `grove/public/impressum/` says so); the Stripe, VAT, Impressum and
    invoicing paragraphs must be redone for an Estonian OÜ selling to EU
    consumers (OSS VAT, Estonian e-invoicing, the ECG duties still apply to
    the Austrian audience).
30. **brand/**: the package exists (tokens, voice, names); the hero still,
    the 20 s clip, the favicon and the sound cues are listed as missing and
    are made once, from the grove, after the palace's first look ruling.
31. **The studio's first task: take spectre's film code before it goes.**
    spectre-79 is removing core/film and lanes/m03_first_film on Manuel's
    ruling and tags the last pre-removal commit `film-final`. einstruct's
    film/assemble.py imports `core.film.pacing` from spectre's working
    tree and expects vo.py's take layout, so it breaks the moment the
    removal lands. Extract pacing, vo, encode, scene, render/plate,
    check/variety, the generic mts and measure.py into `studio/` from
    that tag (`git archive film-final core/film lanes/m03_first_film`;
    the tag is 9721bf8, the removal 68239c4, and every commit the film
    produced_by lines name is an ancestor of the tag), and point einstruct
    at the package; until then einstruct pins a copy. Left behind by the
    removal: core/film/pacing.py stays as a stub for einstruct's sys.path
    import (delete it and its two tests once einstruct carries its own),
    vo.py is gone and einstruct depends only on its take naming
    `S<nn>_<hash>.mp3`, which the studio copy must keep; mitsuba left
    spectre's pyproject; spectre's episode is now the studio's to make
    from lanes/m03_first_film/episodes/ep03 at the tag.
