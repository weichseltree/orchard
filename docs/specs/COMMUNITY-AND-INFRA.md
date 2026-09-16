# Community and infrastructure: from the outside in

Written 2026-09-12 for the orchard at weichseltree.com, whose operator is one
person, an Austrian researcher, not a company. It walks from the outside
(the repo as the front door and the places people hear about it) inward
(what a member can do, what runs where and what it costs, the law that
applies) and ends with an order of work. Prices were fetched on 2026-09-12
from the vendors' own pages where they could be; each number says where it
came from, and "not verified" means exactly that. Dollar prices are quoted
as the vendors quote them; euro lines are Manuel's own numbers.

The three scales used throughout, per month:

| scale | visitors | visits × minutes | voice | commands to the API |
|---|---|---|---|---|
| A, tens | 50 | 50 × 10 | 300 participant-minutes | 150 |
| B, hundreds | 500 | 500 × 10 | 3,000 | 1,500 |
| C, low thousands | 3,000 | 3,000 × 10 | 30,000 | 15,000 |

Nothing in this document creates an account, installs anything or touches
`~/.config/orchard`. Secrets are named, never shown.

---

## 1. Advertising by hosting the repo

The repo is public and AGPL; the cheapest advertising is to make it the
place people land, and to make landing there tell them what this is in
twenty seconds.

### 1.1 The GitHub repo as the front door

**README rewrite, in this order.** The current README is written for a
session, not a stranger. The rewrite keeps every fact and reorders it:

1. The wordmark line: `weichseltree` and one sentence. "Walk inside a
   particle simulation. A VR world for research results, and the fund and
   studio that feed it."
2. **The hero still** (`brand/tokens.json` `asset.hero-still`, missing today):
   the hall in the gallery palette with einstruct's sheet lit. One image,
   3840×2160 source, served at 1600 px wide, AVIF with JPEG fallback,
   under 400 kB.
3. **The 20-second clip** as a `<video>` in the README (GitHub renders an
   mp4 under 10 MB dropped into a PR or issue; the README links that
   upload URL). Walking through the doorway into the sheet, scrubbing time
   once. No music, no titles: the seed ident and silence.
4. Three links: Enter the grove · Watch the series · Read the platform.
5. "What is here": the five rooms, in one table, with what hangs in each.
6. "Run it": the `uv sync` block as it is.
7. "Run a node": one paragraph pointing at PLATFORM.md and M3, honest that
   the second node does not exist yet.
8. "Fund a tree": Sponsors, Patreon, and in kind.
9. Licence, and the AGPL sentence that already ends the README.

The "Why this exists" section (the month that produced no episode) moves to
`docs/WHY.md` and is linked; it is the truest paragraph in the repo and the
wrong second paragraph for a stranger.

**Topics** (repo settings, up to 20): `webxr`, `threejs`, `spacetimedb`,
`cloudflare-pages`, `particle-simulation`, `scientific-visualization`,
`research-software`, `virtual-reality`, `quest`, `agpl`, `point-cloud`,
`open-science`. Topics are how GitHub's explore pages and search find a
repo; they cost nothing.

**A public roadmap from BACKLOG.** `docs/BACKLOG.md` is already an ordered
list with owners. The public roadmap is a GitHub Project (board, free) with
four columns, `M1 company · M2 bundles · M3 the first portal · M4 jobs`,
whose cards are issues opened from BACKLOG items 7, 8, 12, 13, 16 to 24. The
private-repo audits (`notes/`) never appear. `docs/PLATFORM.md`'s roadmap
list becomes the Project's description. Update rule: a card moves when a
DECISIONS line lands, not before.

**Discussions vs Issues.** Turn Discussions on with four categories:
*Q&A* (how do I run it), *Ideas* (what should hang next), *Show* (someone's
own room or node), *Announcements* (releases, episodes; operator-only
posting). Issues are for defects and for roadmap cards only; an issue that is
a question is converted to a discussion with one click. The privacy page
names GitHub issues as the contact for data requests; keep that until the
Impressum's address exists (section 4), then move it to email.

**Labels.** `good first issue` (GitHub's own name; the explore page reads
it), `help wanted`, `tree` (a request from a research repo), `grove`,
`studio`, `fund`, `node`, `docs`, `hardware: quest`, `hardware: phone`,
`mainland` (reachability from China). Ten good first issues to open on day
one, each under two hours and each with the file named: the favicon;
lifting inline colours into `grove.css` `:root` (brand/README); the
`prefers-reduced-motion` rule; a `make check` that runs `pnpm typecheck`,
`vitest` and `pytest` together; a HUD notice when the media host 404s;
`orchard doctor` printing which secrets are set by name only (it does; a
test for it); an `orchard bundle verify --json`; alt text on the README
images; a Mastodon-verified `rel="me"` link on the site; the third-party
licence list (section 4.5).

**CONTRIBUTING.md, in brief.** Twelve lines: run `uv sync` and `cd grove &&
pnpm install`; every change comes with a test or says why not; the studio
checks (LAWS) apply to anything a viewer sees; commit messages in the
DECISIONS voice (what, and what it beat); sign off every commit (DCO, below);
no GPU job outside `gpurun` on Manuel's boxes (contributors have their own
boxes and this line is for the trees); rulings are Manuel's, and a PR that
needs one says so in its title; be plain, be short (`brand/VOICE.md`).

**CODE_OF_CONDUCT.md, in brief.** Adopt the Contributor Covenant 2.1
unchanged, with the enforcement contact set to the Impressum email. Four
lines of preface in weichseltree's voice: what we are here for (the work),
what gets you removed (harassment, doxxing, posting someone's voice or chat
from the grove without their consent), who decides (Manuel, and later a
second host), and that the grove's in-world rules (section 2.3) are the
same rules.

**SECURITY.md pointer.** GitHub reads a `SECURITY.md` at the repo root for
its "Report a vulnerability" button. The root file is five lines: report
privately through GitHub's private vulnerability reporting (repo settings,
free), expect an answer in 7 days, no bounty, and a link to
`docs/SECURITY.md` for what is protected and how. Do not move the long file.

**Releases and tags.** Tag `v0.1.0` at the commit that deploys the gallery
hall (`685f69f` or its successor), then a tag per deploy that changes what a
visitor sees (`v0.1.x`) and a minor bump per milestone (`v0.2.0` = M1
company). Release notes are the DECISIONS lines since the last tag, copied,
plus the deployed grove commit and the SpacetimeDB module version. Connect
the repo to Zenodo (free, one click in Zenodo's GitHub integration) so every
release gets a DOI; that is what a paper or a talk cites (section 1.3).

**GitHub Sponsors and the Patreon link.** GitHub Sponsors charges no fee on
sponsorships from personal accounts ("100% of these sponsorships go to the
sponsored developer", docs.github.com, fetched 2026-09-12); Austria is in
the supported-regions list; payout is to a bank account or through a fiscal
host, and a W-8BEN is required for a non-US person. Patreon's standard plan
takes 10% of income plus payment processing, currency conversion and payout
fees (patreon.com/pricing, fetched 2026-09-12; the processing rate for EUR
is on a support page that returned 403 to the fetch; third-party summaries
say about 2.9% + a fixed amount per payment, not verified). So: apply for
Sponsors, add `.github/FUNDING.yml` with `github: weichseltree` and
`patreon: weichseltree` and `custom: https://weichseltree.com/fund`, and
let the site's Fund page rank them Sponsors first, Patreon for people who
already have it, Stripe memberships (section 3.3) once the greenhouse vote
exists and there is something a membership does.

**AGPL, for a VR host and for trees.** The orchard is AGPL-3.0-or-later.
What that means for the three kinds of people who touch it:

- *Someone who runs a node* (hosts the grove client and a module for others
  to use over the network) is bound by AGPL §13: they must offer the
  corresponding source of the version they run to every visitor. The grove
  already links "Source (AGPL-3.0)"; section 4.5 pins that link to the
  deployed commit so the offer is precise. A node operator who changes the
  platform and keeps the change private is in breach; that is the point of
  the licence ("Run a node, change the platform, publish the change").
- *A tree's code* is not touched. A tree registers with a manifest (data),
  publishes bundles (data), and, in M4, declares jobs that a node runs as a
  separate program with files in and files out. Communicating through
  files and a manifest does not make the tree a derivative of the orchard.
  A tree keeps whatever licence it has; spectre's private remote stays
  private. The one thing a tree cannot do is copy orchard code into itself
  and close it.
- *Bundles and harvests* are content, not code, and AGPL says nothing about
  them. Each tree picks a licence for what it hangs; the recommendation is
  CC BY 4.0 for stills and clips and CC BY 4.0 or CC0 for tapes, recorded in
  `bundle.json` as `license`, shown in the provenance panel. Without a
  licence field a bundle is "all rights reserved, view in the grove", which
  is a fine default and should be stated.

**CLA or DCO: DCO.** A CLA would let the operator relicense contributions
(say, sell a proprietary node), which contradicts the promise the README
makes. The Developer Certificate of Origin (a `Signed-off-by:` line, `git
commit -s`) keeps inbound = outbound: contributors certify they may
contribute under AGPL and nobody gains rights over anyone else. Enforce it
with the DCO GitHub App (free) and one line in CONTRIBUTING. The cost of
this choice: the licence can never change without every contributor's
consent, which is the intended cost.

### 1.2 Where people hear about it

**YouTube.** The series is the front door for viewers; the repo is the front
door for builders. Every episode's description carries three lines: enter
the grove (the room that episode's tape hangs in, deep-linked once rooms
have URLs), the source, and the fund. Every episode ends on the seed and the
grove link, 4 s, silent. Chapters, always (LAWS 18). One thumbnail style:
black ground, one frame of the phenomenon, one line of title at 600 weight,
no faces, no arrows. Cadence is set by the fund, not by the calendar; when
there is no episode, there is no upload. A Short of the 20-second clip once,
tagged to the first episode.

**Patreon.** Already exists. Posts are the DECISIONS lines that a viewer can
read (a ruling on a styleframe, with the four options; a room opening), once
a fortnight at most, and never a post that says nothing happened. Tiers:
one, at the same price as the Stripe membership, doing the same thing (the
vote), so nobody is asked to move.

**Bluesky, Mastodon, X.** The same post on all three, written once: the clip
or a still, one sentence, the grove link. Mastodon: an account on a science
or FOSS instance (fosstodon.org, mathstodon.xyz or scholar.social; pick one,
do not run an instance), with `rel="me"` verification from weichseltree.com.
Bluesky: set the handle to `weichseltree.com` (a DNS TXT record on the zone
that is already on Cloudflare; free). X: the account exists or it does not;
do not open one for this. Alt text on every image (the seed and the palette
are describable). Post when something opened, not on a schedule.

**Reddit.** Subreddits where this fits: r/WebXR, r/virtualreality,
r/OculusQuest (hardware pass first; a Quest post that says "untested on
hardware" is honest and dead), r/Simulated, r/Physics only for an episode
with a result, r/opensource for the repo, r/selfhosted for the node story
once M3 exists. Read each subreddit's self-promotion rule before posting; most
want a 10:1 ratio of participation to promotion and a plain title. One post
per subreddit per milestone, never cross-posted the same day, answered in
the comments for the first four hours.

**Hacker News.** A "Show HN: weichseltree – walk inside a particle
simulation in the browser (WebXR, AGPL)" post, once, when the hardware pass
is done and the first episode is exhibited. Show HN rules: it must be
something people can try, the poster answers questions, no asking for
upvotes anywhere, and the title says what it is with no adjectives. Best
observed window is a weekday, 14:00 to 16:00 Vienna (morning US east). Have
the cost table (section 3.6) and the AGPL paragraph ready; those are the
first two questions. Expect the grove to take 20 to 200 concurrent visitors
for two hours: SpacetimeDB rooms cap at 24 and the per-network cap is 8,
so the hall fills and the HUD must say "the hall is full, try the einstruct
room" rather than fail; that notice is a launch prerequisite (section 5).

**Launch etiquette that applies everywhere.** Say what it is, what it costs,
what does not work yet. Link the source in the first line. Reply to every
substantive comment for a day. Never argue about the licence in a thread;
link section 1.1. Do not post the same thing twice.

### 1.3 The research community

The orchard has one thing a research audience does not have elsewhere: a
tape format and a client that stream a 500,000-particle simulation into a
headset at a few MB a minute with provenance carried through. That is a
short paper, a demo and a software citation, in that order of cost:

- **arXiv.** A 6-page note in cs.GR (cross-list physics.comp-ph): the tape
  format (chunked, quantized, indexed by time, aligned slots across tapes),
  the bundle model (content-addressed, device tiers, provenance sidecars)
  and measured numbers (bytes per minute, frames to first render on Quest,
  desktop, phone). A first arXiv submission needs an endorser in the
  category; a colleague from a previous affiliation is the usual route.
  Cost: about 30 hours once the numbers exist.
- **JOSS** (Journal of Open Source Software) reviews and publishes research
  software with a DOI; AGPL is fine; the review is public on GitHub and
  improves the repo. `orchard` (the CLI: harvest, bundle, exhibit, sync)
  qualifies once it has tests and docs a stranger can follow. Cost: 20
  hours plus the review's asks.
- **Conference demos.** IEEE VR (demos track, deadline usually December),
  Web3D (ACM, summer), SIGGRAPH's Immersive Pavilion (submissions around
  January). A demo needs the hardware pass and a Quest in hand. Pick one per
  year.
- **Zenodo DOI per release** (section 1.1) so any of the above can cite a
  version.

The research angle is also the one place where "AI" belongs: none of the
above sells it.

---

## 2. Community

### 2.1 What a member can do

There are four things, from cheapest to dearest:

| do | who | what it takes | exists |
|---|---|---|---|
| **Visit.** Walk the rooms, stand in a tape, scrub it, hear and talk to whoever is there, report someone. | anyone, no login | a link | yes (voice: M1) |
| **Vote in the greenhouse.** Once a month the review queue's open styleframes and theses are put to members; the vote is one input to the ruling, the ruling stays Manuel's (LAWS 14, 22). | members: Stripe or Patreon, or a node operator | a membership bound to a grove identity (section 3.7) | not yet; needs the greenhouse in the browser |
| **Fund a tree in kind.** Run a node: host a mirror of bundles, and from M4 run a tree's declared jobs on your own GPU. The ledger records it publicly. | anyone with a box and a public IP or a Cloudflare account | `node.json`, the module, a bucket | M3, M4 |
| **Contribute a tree.** Register a research repo with a manifest; get a room when the first harvest is approved. | a researcher with results in a format the grove can show (tape, clip, still; splats later) | `orchard scout`, `orchard plant`, a ruling | yes, by hand, for Manuel's own repos; a stranger's tree needs the "tree owner" role (SECURITY.md: not built) |

The word "member" is reserved for the second, third and fourth rows. A
visitor is a visitor.

### 2.2 Moderation

**What exists** (commit f256992, `spacetime/spacetimedb/src/index.ts`):
people, poses and chat are private tables read through three views scoped
to the room the reader stands in (`people_here`, `poses_here`, `chat_here`);
`visitor.muted` blocks `say`; `kick` is a 10-minute ban; `ban_visitor`
bans for N minutes or for good, optionally a whole network (matched by the
token's keyed hash of the network, never the address); `report_visitor`
keeps the subject's last five lines of chat for 90 days; rate limits on
poses (20/s, bursts of 10), chat (one line per 0.7 s, 280 characters, no
control characters) and reports (one per 30 s); rooms have capacities (24,
greenhouse 4) and `admin_only`; the sweep deletes chat after 24 h. The flat
dashboard has mute, kick, ban, unban and reports. The host tag is green and
cannot be faked.

**Presence chat.** Enough for launch. Two additions before opening voice:
a per-room word filter is *not* one of them (it catches nothing worth
catching and breaks German), but a **new-visitor quiet period** is: an
identity younger than 10 minutes may not `say` more than one line per 5 s.
And `report` should carry the reporter's room and the time, which it does.

**Voice.** Rules that hold for every route in section 3.10:

- Push-to-talk by default on every device; open mic is a setting the
  visitor turns on, and it turns itself off after 30 minutes.
- `muted` in the module means muted on voice too: peers stop playing the
  track, and where a media server is in the path (Realtime, LiveKit) the
  server-side session is closed by the token service so a modified client
  cannot keep talking.
- Voice rooms are the same rooms; a kicked visitor loses the room's views
  and the token service refuses a new voice session for a banned identity.
- A report made while someone is talking records "voice" as the channel; the
  host cannot replay what was said (nothing is recorded, section 4.1), so the
  host acts on the report and the last chat lines, and on being present.
- The host can **mute a whole room** (one flag on `room`; not built) for
  the case where a raid outruns per-person action.
- Nobody under 16 on voice (section 4.4); the age line is in the rules.

**Who moderates.** Manuel, from the dashboard, and from a headset once the
host is in the browser (BACKLOG 8, 29). A second host is a row in `admin`
(`add_admin`), which today grants everything; a "moderator" role that can
mute, kick and ban but not rule is a module change of about 40 lines
(SECURITY.md lists it as not built) and is worth doing before the first
person is asked to help.

### 2.3 The rules, in plain words

Shown once on first entry (a panel, one screen, a single "I understand"
button; stored in local storage like the name) and linked from the HUD:

1. Be kind. Nobody here owes you their time.
2. No harassment, slurs, threats, or following someone room to room.
3. Do not record or post anyone's voice or chat from the grove without
   their consent.
4. Use your own name or none. Do not pretend to be the host or another
   visitor.
5. Voice is for people 16 and over. The grove is for 14 and over.
6. The host can mute, remove or ban anyone, and will; reports go to the
   host with your last lines of chat.
7. What hangs here is someone's research. It may be wrong; say so kindly.

### 2.4 Onboarding flow

1. A link, from the README, an episode, a post: `weichseltree.com` or a
   room link `weichseltree.com/mind/#spectre` (room deep links: a small
   client change).
2. The holding page: what it is in one line, Enter the grove, device hints.
3. The grove loads: Turnstile runs (usually invisible), the token service
   issues an identity, the hall appears; on a headset "Enter VR" shows; on
   a phone the stick shows.
4. First visit only: the rules panel; then a name prompt ("visitor" if
   skipped).
5. The hint panel says the three controls for this device, and goes away
   on first movement.
6. "N here" in the corner; opening it lists the people, the host tag, and
   Report. The voice button appears only after the rules were accepted and
   the age line was read.
7. Nothing asks for an email, an account or a follow. The fund link is on
   the Leave page, not in the world.

### 2.5 The operator's time budget

Manuel's time is the scarcest resource in this document. A weekly budget,
after launch, that this plan is sized to:

| task | hours per week |
|---|---|
| reports, bans, the dashboard's people panel | 0.5 |
| issues and PRs (triage, not implementation) | 1 |
| Discussions, Reddit and Mastodon replies | 0.5 |
| the monthly greenhouse vote (amortised) | 0.5 |
| releases and the roadmap board | 0.5 |
| **total** | **3** |

Launch weeks (Show HN, an episode) cost 8 to 10 hours that week and are
scheduled, not absorbed. Anything that would push the steady state past 3
hours a week (a second language, a Discord, a newsletter, tree owners who
need hand-holding) is declined until there is a second host. Specifically
**no Discord**: it is a third place to moderate, it is closed, and the grove
itself is the place to talk.

---

## 3. Infrastructure

For each piece: what it is for, the cost tier at this scale, setup steps,
the secrets by name (in `~/.config/orchard/secrets.env`, listed in
`services.yaml`, reported present-or-absent by `orchard doctor`), and what it
does to the CSP (`grove/public/_headers`) and to privacy (section 4). "CSP:
none" means the client never talks to it.

### 3.1 Cloudflare

Already the DNS, the site, the bundle store and the human check.

**Pages** (the site, the grove, the token service). Free plan: 500 builds
a month, 20,000 files, 25 MiB per file, 100 custom domains per project
(developers.cloudflare.com/pages/platform/limits, fetched 2026-09-12); Pages
Functions count against the Workers free plan's 100,000 requests a day
(the Workers pricing page, via search). At scale C the token service sees
about 3,000 visits × 2 requests a month: nothing. Cost $0 at A, B, C.
Secrets: `CLOUDFLARE_API_TOKEN` (Pages edit) and `CLOUDFLARE_ACCOUNT_ID`
for deploys; the token service's `AUTH_SIGNING_KEY`, `AUTH_NETWORK_KEY`,
`TURNSTILE_SECRET` are pushed into Pages secrets by `orchard auth push`.
Setup: done; BACKLOG 25 (turn the token service on) is Manuel's.

**R2** (bundles at media.weichseltree.com). $0.015 per GB-month standard
storage, Class A $4.50 per million, Class B $0.36 per million, egress free;
free tier 10 GB-month, 1 M Class A, 10 M Class B a month
(developers.cloudflare.com/r2/pricing, fetched 2026-09-12). The harvested
bundles are about 0.5 GB today; a year of episodes with HLS ladders and
three tape tiers per tree is 20 to 60 GB. Reads: a visit is 100 to 400
range requests (HLS segments, tape chunks); scale C is 3,000 × 400 = 1.2 M
Class B a month, inside the free 10 M. Cost: A $0, B about $0.30, C about
$1 to $2. Secret: `CLOUDFLARE_R2_TOKEN`. Setup: done. CSP: already in
`img-src`, `media-src`, `connect-src`. Privacy: R2 access logs are
Cloudflare's; the bucket is public by design and stores no personal data.

**Realtime** (voice: TURN and SFU). $0.05 per GB of egress with a free
tier of 1,000 GB a month shared between SFU and TURN; TURN traffic that
goes into the SFU is not charged twice; only traffic from Cloudflare toward
clients is charged (developers.cloudflare.com/realtime/sfu/pricing, fetched
2026-09-12). Cost at every scale in this document: $0 (section 3.10 has the
arithmetic). Secrets: `CLOUDFLARE_REALTIME_APP_ID`,
`CLOUDFLARE_REALTIME_APP_SECRET`, held by the token service only (BACKLOG
30). CSP: `connect-src` gains the Realtime API host the SDK posts to (the
SFU docs page does not list the hostname; take it from the first request in
the browser's network panel and pin it), and WebRTC media itself is not
governed by CSP. `Permissions-Policy: microphone=(self)` replaces
`microphone=()`. Privacy: Cloudflare relays audio and sees the visitor's IP
for the connection; nothing is stored (section 4.1).

**Workers** (an API gateway that holds keys). The free plan's 100,000
requests a day covers everything in this document except two things that
need the Workers Paid plan at $5 a month: Workers AI beyond the free
neurons and Email Sending (developers.cloudflare.com, fetched and via
search 2026-09-12). One Worker, `api.weichseltree.com`, with routes:
`/voice/token` (Realtime or LiveKit sessions), `/speech` (audio in, text
out), `/act` (text in, an action out, section 3.5), `/member/link`
(section 3.7), `/errors` (section 3.9). Every route requires the visitor's
grove token (the same ES256 token SpacetimeDB checks; the Worker fetches
`/auth/jwks.json`), rate-limits by the token's `ipk`, and meters per
identity (LAWS 21: a breaker per visitor per day). Cost: $0 at A, $5 at B
and C. Secrets it holds as Worker secrets (never in the client):
`ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY` (if chosen),
`CLOUDFLARE_REALTIME_APP_SECRET` or `LIVEKIT_API_SECRET`,
`STRIPE_WEBHOOK_SECRET`; they are copied from the secrets file by a new
`orchard gateway push`, mirroring `orchard auth push`. CSP: `connect-src
https://api.weichseltree.com`. Privacy: the Worker logs nothing but counts;
Cloudflare's own request logs exist for 24 h on the free plan (not
verified).

**Web Analytics.** Free on all plans (developers.cloudflare.com/web-analytics,
fetched 2026-09-12). Two modes: automatic injection at the edge, which
posts same-origin to `/cdn-cgi/rum` and needs no CSP change beyond
`script-src` allowing `https://static.cloudflareinsights.com`; or the
manual snippet, which posts cross-origin to `cloudflareinsights.com` and
needs both `script-src` and `connect-src` widened (dev.to and hostim.dev
write-ups via search; Cloudflare's own page did not state the hosts). It
sets no cookies, according to the same write-ups and Cloudflare's
"privacy-first" wording; Cloudflare's docs page fetched did not say the
word "cookie", so verify on the data-origin page before the privacy page
claims it. Decision: turn it on for `weichseltree.com` and `/privacy/` only;
**leave it off the grove**, whose `script-src` is the one line that keeps a
compromised dependency from phoning anywhere, and whose visitors are
counted by the database anyway. Cost $0.

**Access** (admin login). Zero Trust free tier covers up to 50 users, $7
per user beyond (via search, cloudflare.com/plans; not fetched from
Cloudflare's own page). Section 3.7 uses it for the host in the browser.
Cost $0.

**Turnstile.** Free: up to 20 widgets, 10 hostnames each
(developers.cloudflare.com/turnstile/plans, fetched 2026-09-12). Already in
the CSP. Cost $0.

**DNS** for weichseltree.com: on Cloudflare since 2026-09-12. Add now,
free: DNSSEC (one switch), a CAA record allowing Let's Encrypt and
Google Trust Services (Pages' issuers), `v=spf1 -all` and a DMARC
`p=reject` on the apex so nobody can spoof mail from the domain before the
domain sends any, a `_atproto` TXT for the Bluesky handle, and the
`media` and `api` subdomains. The registrar stays Namecheap (renewal
2027-01-24, about €12 a year, not verified).

### 3.2 SpacetimeDB

World state: presence, rooms, exhibits, the review queue, rulings,
directives, moderation. Maincloud database `orchard`.

**Pricing** (spacetimedb.com/energy, fetched 2026-09-12): Free $0 with
2,500 TeV a month (about 3 M reducer calls, 12.5 GB egress, 1 GB storage);
Pro $25 with 100,000 TeV (about 120 M calls, 500 GB, 40 GB); Team $250;
after the credit, 2,592 TeV per dollar; free-tier accounts may buy prepaid
energy packs. The Space Race referral programme raises the free credit by
2,500 TeV per referral (spacetimedb.com/space-race, via search).

**What burns energy here** is poses: the client sends `move` up to 20 a
second. At 10 a second for 10-minute visits, scale A is 0.3 M calls, B is
3 M (the free credit's edge), C is 18 M (about 12,500 TeV over, roughly
$5 as energy or $25 as Pro). The lever is the send rate: 10/s with
interpolation on the receiver is indistinguishable in a room and halves
the bill; sending only when the pose changed by more than 2 cm or 2° cuts
it again. Cost: A $0, B $0 to $5, C $5 to $25.

**Identity.** Visitors: the token service's ES256 tokens (SECURITY.md).
Admin: the `admin` allowlist, seeded with the publisher. The CLI's token in
`~/.config/spacetime/cli.toml` is the database's owner and must never leave
SirBase. Members and the host in the browser: section 3.7.

**Admin from the dashboard** is local only. The greenhouse in the browser
needs an admin identity minted by the token service for a person who passed
Cloudflare Access (section 3.7); `add_admin` puts that identity on the
list once.

**If maincloud is unreachable from the mainland** the same module self-hosts
(HOSTING.md). That is a VPS in Singapore at about €5 a month (not verified)
and the CSP's `connect-src` changes; nothing else does. Test from a
mainland vantage point before deciding (BACKLOG 27).

Secrets: none in the file; CSP: already present. Privacy: Clockwork Labs is
a processor (section 4.2).

### 3.3 Stripe

For memberships (recurring) and one-off funding of a specific tree. Not
before the greenhouse vote exists: a membership that does nothing is a
donation with paperwork.

**Fees for an Austrian account** (stripe.com/at/pricing, fetched
2026-09-12): EEA standard cards 1.5% + €0.25; EEA premium cards 2.8% +
€0.25; UK cards 2.5% + €0.25; international cards 3.15% + €0.25; currency
conversion +2%; Stripe Billing pay-as-you-go 0.7% of billing volume; Stripe
Tax 0.5% per transaction (or €0.45 per transaction depending on
integration); no monthly fee. A €5 membership on an EEA card costs €0.325 +
€0.035 (Billing) = €0.36, 7.2%; with Stripe Tax €0.385, 7.7%. Against
Patreon's 10% plus processing and GitHub Sponsors' 0%.

**What it needs from an Austrian sole trader**, in the order Stripe and the
law ask:

1. **Impressum** on the site (section 4.3) and a page with terms, prices,
   what the membership does, how to cancel, and the refund rule. Stripe
   reviews the site for these before enabling live payouts.
2. **Business status.** Whether memberships and one-off funding make this a
   Gewerbe (needing a Gewerbeanmeldung) or "neue Selbständigkeit", and what
   that means for SVS insurance, is a question for the WKO Gründerservice or
   a Steuerberater. Not verified here; it decides which Impressum items
   apply (section 4.3).
3. **VAT: Kleinunternehmer.** Since 2025 the limit is €55,000 gross turnover
   a calendar year, not exceeded in the current or previous year; exceeding
   it by up to 10% keeps the exemption for the rest of the year; invoices
   carry the note "Umsatzsteuerfrei aufgrund der Kleinunternehmerregelung"
   (wko.at Kleinunternehmerregelung, fetched 2026-09-12; §6 Abs 1 Z 27
   UStG). At scale C, 3,000 visitors with a 3% membership rate at €5 is
   €5,400 a year: far inside. Stripe Tax is therefore **off** at every scale
   in this document; it becomes relevant only past the limit or if the
   EU-wide place-of-supply rules for digital services to consumers bite
   (the €10,000 EU threshold and OSS; since 2025 an Austrian
   Kleinunternehmer can also use the EU small-business scheme with an
   "EX" number for other member states, via search, not verified). Ask the
   Steuerberater once, before the first sale.
4. **Invoices.** Stripe's invoicing sends a receipt per charge; set the
   footer to the Kleinunternehmer note, the Impressum name and address.
   Keep the Stripe export as the record (7 years, BAO §132).
5. **Consumer law.** A subscription sold at a distance carries the 14-day
   withdrawal right (FAGG); Stripe Checkout's consent checkbox and a
   plain sentence on the terms page cover it; refund any first month on
   request without argument.

Setup: a Stripe account in Manuel's name (only Manuel), one Product
("member") with one Price (€5 a month) and one Price per tree for one-off
funding (€20, €50), Checkout links (no custom checkout code), a webhook to
the Worker's `/member/link` or, simpler and outbound-only, `orchard sync
members` on the home box's 15-minute timer pulling active subscriptions
through Stripe's API and upserting `member` rows in the module (section
3.7). Secrets: `STRIPE_SECRET_KEY` (restricted key: read subscriptions,
customers), `STRIPE_WEBHOOK_SECRET` only if the webhook route is used. CSP:
none; Checkout is a redirect to stripe.com, the grove never loads Stripe
JS. Privacy: Stripe is a controller for payment data; the orchard keeps
the customer id and the membership end date, nothing else (section 4.2).

### 3.4 Speech to text

For two uses: **voice-to-action** (a visitor says "show me the stirred one"
and the room responds, section 3.5) and, later, **live captions** for
voice chat. Three routes:

| route | price | streaming | where audio goes | CSP |
|---|---|---|---|---|
| **Cloudflare Workers AI Whisper** (`@cf/openai/whisper`, `whisper-large-v3-turbo`) | $0.0005 per audio minute; 41 to 47 neurons a minute; 10,000 neurons a day free on Free and Paid, $0.011 per 1,000 beyond (developers.cloudflare.com/workers-ai/platform/pricing, fetched 2026-09-12) | no; batch, a clip at a time | the Worker (EU: not selectable; Cloudflare's network) | `connect-src api.weichseltree.com`, already needed |
| **Deepgram Nova-3** | streaming $0.0048 a minute promotional, $0.0077 regular; pre-recorded $0.0043; $200 free credit (deepgram.com/pricing, fetched 2026-09-12) | yes | Deepgram, US, via the Worker (proxy the websocket so the key stays server-side) | same, if proxied |
| **Web Speech API** | $0 | yes | Chrome sends the audio to Google's recognition service (chromium.org group thread and MDN via search); on-device recognition is a newer option not everywhere | none, but it is a Google endpoint in the client, which HOSTING.md rules out; the Quest browser's support is not documented |

Decision: **Workers AI Whisper for voice-to-action** (push-to-talk clips of
2 to 8 seconds; batch is fine; 240 free minutes a day covers 15,000
commands a month at 5 s each with room to spare, so $0 at every scale
until captions). **Deepgram for captions if captions happen**, because
captions need streaming; at scale C's 30,000 voice minutes that is $144 a
month at the promotional rate and $231 regular, which is the single most
expensive line in this document and the reason captions are "later". Web
Speech API: no, for the Google reason and the CSP reason.

Secrets: `DEEPGRAM_API_KEY` (only if captions). Privacy: audio for a command
leaves the visitor's browser, is transcribed and discarded; the transcript
is kept 24 h with the chat (it is chat, in effect) and the privacy page says
so (section 4.1).

### 3.5 Anthropic API: voice to action

The transcript of a command becomes one of a small set of actions the room
already supports (scrub to a time, change speed, pause, go to a room, open
provenance, show one tape and hide the others). The model chooses an action
and its arguments from the transcript; the client executes it; the model
never touches the world.

- **The key never reaches the client.** `ANTHROPIC_API_KEY` is a Worker
  secret; the Worker's `/act` route takes a transcript and returns JSON.
- **Model.** `claude-opus-5` by default (the claude-api skill's cached
  table, 2026-06-24: $5 per million input tokens, $25 per million output;
  cache reads at 10%). A command is about 800 tokens of cached system
  prompt, 50 of transcript, 60 of output: about $0.002 per command. Scale
  A $0.30, B $3, C $35 a month. `claude-sonnet-5` ($2/$10) would be about
  40% of that; that is Manuel's call, not a default. Check the console for
  today's prices before the first deploy; the skill's table is cached.
- **Structured output** (`output_config.format`) with the action schema,
  and `strict: true`, so the client never parses free text.
- **A breaker per visitor** (LAWS 21): 50 commands a day per identity,
  2,000 a day for the orchard; past either the Worker answers "later" and
  the HUD says so. Counters in Workers KV (free tier; not verified).
- **The rooms' vocabulary** in the system prompt comes from the exhibit
  table at request time (tree names, tape names, the hall's poster wall),
  so a new hanging is speakable without a deploy.

CSP: `connect-src api.weichseltree.com`. Privacy: transcripts are personal
data for 24 h; Anthropic is a processor under its DPA (check the current
EU-US Data Privacy Framework list for Anthropic before the privacy page
names it; not verified). No audio ever reaches Anthropic.

### 3.6 ElevenLabs (narration, already in use)

Used by the studio for narration takes (LAWS 16, 19), metered by the
expdash card. Plans (elevenlabs.io/pricing, fetched 2026-09-12): Free $0
with 10,000 credits and no commercial use; Starter $6 with 30,000; Creator
$22 with 121,000 (half price the first month); Pro $99 with 600,000; one
character is one credit on standard models. An episode is about 3,500
characters of narration; at five takes a line worst case that is 17,500
credits, so Creator covers six episodes a month and Starter one. This is a
production cost that does not move with visitors: $6 to $22 at every
scale. Not used in the grove at runtime; a talking room is not planned and
would be the wrong kind of wonder. Secrets: `ELEVENLABS_API_KEY`,
`ELEVENLABS_VOICE_ID`. CSP: none.

### 3.7 Auth: visitors, members, the host

**Visitors** keep what they have: an anonymous ES256 token from `/auth`
with a keyed network hash, 30 days, renewed. No accounts.

**Members** need one thing: a link between a payment and a grove identity,
so the greenhouse vote can count them. The smallest design:

1. Stripe Checkout's success URL is `weichseltree.com/fund/thanks?session=…`.
   That page runs in the browser that holds the grove token and posts the
   session id plus the token to the Worker's `/member/link`.
2. The Worker verifies the token (JWKS) and the Checkout session (Stripe
   API, restricted key) and stores `(customer, identity)` in a Cloudflare
   D1 table (free tier; limits not verified) or KV.
3. The home box's 15-minute sync pulls that table (outbound, with the
   admin token) and Stripe's active subscriptions, and upserts a `member`
   row in the module: `{identity, source: stripe|patreon|node, until}`.
   Patreon members do the same through the Patreon API's pledge list
   (`PATREON_ACCESS_TOKEN`), or, for the first year, by hand.
4. **Passkeys (WebAuthn)** carry the same identity to a second device: the
   token service offers "add a passkey" to a member; the credential's
   public key is stored beside `(customer, identity)`; "sign in with a
   passkey" on another device mints a token for that identity. Passkeys
   need no password, no email, and no library beyond the browser API and
   a small verifier (SimpleWebAuthn's server package runs on Workers).
   OpenAuth (openauth.js.org, an OAuth issuer on Workers) is the
   alternative if members should also log in with GitHub or an email
   code; it is more than this needs today.

**The host in the browser** (BACKLOG 8, 29): put **Cloudflare Access** in
front of `weichseltree.com/greenhouse/*` and `/auth/admin` with a policy of
one email (Manuel's), one-time PIN login. `/auth/admin` reads the
`Cf-Access-Jwt-Assertion` header, verifies it against the Access team's
certificates and the AUD, and mints a grove token whose identity is on the
module's `admin` allowlist. The CLI token never enters a browser. A second
host is a second email in the policy and one `add_admin` call. Config, not
secrets: `CLOUDFLARE_ACCESS_TEAM`, `CLOUDFLARE_ACCESS_AUD`. Cost $0 (free
to 50 users).

### 3.8 Email

Two directions. **Inbound** (the Impressum's address, data requests, the
code of conduct contact): Cloudflare Email Routing, free, forwards
`hello@weichseltree.com` to a mailbox and cannot send
(developers.cloudflare.com/email-routing, fetched 2026-09-12). **Outbound**
(a vote is open; a membership is ending; a report was acted on): Resend,
free for 3,000 emails a month, 100 a day, 3 domains; Pro $20 for 50,000
(resend.com/pricing, fetched 2026-09-12). Cloudflare's own Email Sending
needs the Workers Paid plan. At scale C with 90 members and one mail a
month each, the free tier is 30× what is needed. Cost $0. Secrets:
`RESEND_API_KEY`, Worker-side. DNS: Resend's SPF include and DKIM records
replace the `-all` placeholder when it goes live. CSP: none. Privacy: an
email address is collected only from a member who asks for mail, stated on
the terms page; nobody else has one.

### 3.9 Error reporting

The grove fails quietly today: notices on the HUD, nothing reported back.
Three options:

| option | cost | CSP and privacy |
|---|---|---|
| **Sentry SaaS** | Developer free: 5,000 errors a month, 1 user, 30-day retention; Team $26 with 50,000 errors (via search, sentry.io pricing; not fetched from Sentry's own page) | `connect-src` to the ingest host, or tunnel through the Worker's `/errors` so the CSP stays; `sendDefaultPii: false`, no session replay, EU data region |
| **Self-hosted Sentry or GlitchTip** | a VPS at about €5 a month plus updates; the home box cannot host it (outbound-only) | same as above but the data stays with the operator |
| **Own beacon** | $0: the client posts `{message, stack, commit, device tier}` to the Worker's `/errors`, which writes to KV with a daily cap; `orchard doctor` prints the last 50 | nothing new in the CSP; nothing personal collected beyond what the message contains |

Decision: the **own beacon** first (about 4 hours; the HUD already has the
notice path and the device tier), Sentry's free tier through the Worker
tunnel if the volume of distinct failures ever exceeds what a list of 50
shows. Never a self-hosted server for one person to maintain.

### 3.10 Multiplayer voice

Three routes for spatial voice in the grove. In every one of them **spatial
audio is done in the client**: each remote track goes through a Web Audio
`PannerNode` placed at that person's position from `poses_here`, relative
to the listener's own pose; distance model inverse, reference distance
1.5 m, max 25 m, a room is a room. Neither Cloudflare's SFU nor LiveKit
mixes or spatialises audio server-side; LiveKit's own spatial-audio example
does it with the PannerNode in the browser (blog.livekit.io tutorial and
livekit-examples/spatial-audio, via search). The who-hears-whom map is the
same in all three: the room-scoped views from f256992.

The three cost lines below use participant-minutes: 10, 100 and 1,000
"concurrent minutes per day" read as 10, 100 and 1,000 participant-minutes
of voice per day, 300, 3,000 and 30,000 a month. Audio is Opus at about
32 kbps, 0.24 MB a minute per received stream, in rooms averaging four
people, so each participant-minute pulls three streams, 0.72 MB.

**(a) Cloudflare Realtime: SFU plus TURN.** Already named in
`services.yaml`. It "routes WebRTC media tracks and DataChannels" and "does
not define rooms, participants, roles, or presence for your application"
(developers.cloudflare.com/realtime/sfu, fetched 2026-09-12): the
application's backend creates sessions with the app secret, clients push
and pull tracks by session and track id. Pricing is per GB of egress, not
per participant-minute: $0.05 per GB after 1,000 GB free a month, TURN
included when used with the SFU (pricing page, fetched 2026-09-12).
Converted: 0.72 MB per participant-minute is $0.000036 beyond the free
tier, and the free tier is 1.4 million participant-minutes a month.
Monthly cost: **$0 / $0 / $0** at 10, 100 and 1,000 minutes a day (21.6 GB
a month at the top). What the client needs: a `RTCPeerConnection`, the
Realtime session API through the token service (never the app secret), and
the presence views for who to pull. CSP: `connect-src` gains the Realtime
API host; `Permissions-Policy` allows the microphone. Moderation: `muted`
in the module makes peers stop pulling that track and makes the token
service refuse to renew the speaker's session; `kick` and `ban` drop the
room views, and the token service (which reads the ban table through the
Worker's admin identity, or the home box closes sessions through the SFU
API when it sees a ban land) closes the session server-side; `report`
stays in the module. There is no participant concept to attach a mute to,
so the enforcement is "close the session", coarse but sufficient.

**(b) LiveKit.** An open-source SFU (server under Apache-2.0,
github.com/livekit/livekit LICENSE, fetched 2026-09-12) with a
room/participant/track model, a JS SDK (`livekit-client`), server-side
token minting (a JWT with grants: room, `canPublish`, `canSubscribe`,
`hidden`), selective forwarding, adaptive stream (subscribe at the
resolution a tile needs; irrelevant for audio), dynacast, Krisp noise
cancellation in the web SDK (`@livekit/krisp-noise-filter`, via search),
and Egress for recording (a separate service; only with consent, section
4.1). Spatial audio: left to the client, as above. **LiveKit Cloud**
(livekit.com/pricing, fetched 2026-09-12): Build $0 with 5,000 participant
WebRTC minutes, 50 GB downstream, 100 concurrent connections, then
$0.0005 per minute and $0.12 per GB; Ship from $50 with 150,000 minutes,
250 GB, 1,000 concurrent; Scale from $500. Monthly cost on Build: **$0 /
$0 / $12.50** (30,000 − 5,000 minutes × $0.0005; 21.6 GB is inside the 50
GB). **Self-hosted** on a small VPS (about €5 a month, not verified; the
docs recommend far more for production and Redis for multi-node): needs
inbound TCP 7881 and UDP 50000 to 60000, a public IP or STUN-discoverable
address, and TURN on 5349/443 (docs.livekit.io self-hosting deployment,
fetched 2026-09-12). **Not on the home box**: it only ever connects outward
(HOSTING.md), and Cloudflare Tunnel carries HTTP and TCP services, not
inbound UDP media to the public internet (the Tunnel docs page fetched did
not say either way; this is the author's understanding and not verified).
Moderation: native. The token is per room and per identity, so `admin_only`
rooms and bans are a refusal to mint; `mute` is
`RoomServiceClient.mutePublishedTrack`, `kick` is `removeParticipant`,
both from the Worker with `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`
when the module's row changes (the home box or the Worker watches the
table). CSP: `connect-src wss://<project>.livekit.cloud` and its HTTPS
host. Privacy: LiveKit Inc. becomes a processor; Cloud regions include the
EU (not verified which).

**(c) SpacetimeDB.** A state database, not a media server; it carries no
audio bytes and should not be asked to (a reducer per audio frame would
burn the energy budget in minutes and add a database round trip to every
20 ms of speech). What it does carry, and already does: presence and poses
(the spatialisation input), the room-scoped visibility map (who may hear
whom), `muted`, bans, kicks, reports, and, cheaply, **signalling** for a
peer-to-peer WebRTC mesh: SDP offers and answers and ICE candidates as
rows in a `signal` table scoped like chat, a few dozen reducer calls per
connection. A mesh works for 2 to 4 people (each browser uploads one
stream per peer; a phone on mobile data cannot upload four); past that it
needs an SFU. TURN is still needed for NAT traversal: Cloudflare's TURN
alone has the same 1,000 GB free tier (Realtime pricing page). Monthly
cost: **$0 / $0 / $0** at all three lines, as long as rooms stay at four.
Moderation is the strongest of the three in one sense and the weakest in
another: `muted` and `kick` are enforced by the views (a kicked visitor
loses the signalling rows; peers read `muted` from `people_here` and stop
playing), but the enforcement is in the peers' clients, so a modified
client can still push audio to a peer that does not check. Every peer
checks; that is a client rule, not a server one.

**Recommendation.** **Launch on (a), Cloudflare Realtime**: it is the
route the repo already chose (services.yaml, BACKLOG 7 and 30), its
secrets are already named, it costs $0 at every scale here with a
1,000 GB margin, TURN comes with it, no new vendor enters the privacy page,
and the token service already exists to mint sessions. Its cost is the
missing room model, which the module already provides, and coarse
moderation (close the session), which is enough for a host who is present.
**Scale on (b), LiveKit Cloud**, when rooms pass eight people regularly,
when Krisp or captions matter, or when a second host needs a mute button
that acts in under a second without the home box in the loop; Build is free
to 5,000 minutes and Ship is $50. Self-host LiveKit only on a VPS and only
if the bill or a region rule says so. **Keep (c) for what it is**: the
state, the map and the flags for both; and the peer-to-peer mesh as the
fallback for the mainland if Cloudflare's Realtime hosts turn out to be
unreachable there (untested, HOSTING.md), because a mesh needs only TURN
and the database.

### 3.11 Backups

**The database.** Maincloud's own backups are not documented on the pages
fetched (not verified). The private tables are the rulings and directives,
which are law, and reports and bans. `orchard sync` already reads rulings
back; add `orchard backup`: nightly, on the home box's timer, `spacetime
sql` dumps of `ruling`, `directive`, `review_item`, `tree`, `exhibit`,
`room`, `ban`, `report`, `admin`, `setting`, `snapshot` to
`results/backups/<date>/` (gitignored, on disk, never /tmp), and a copy to
a second R2 bucket `weichseltree-backups` (private, no custom domain,
Infrequent Access at $0.01 per GB-month) with `CLOUDFLARE_R2_TOKEN` widened
to that bucket. A restore is `spacetime publish` plus replaying the dump
through the admin reducers; write that script the same day as the dump and
test it against a local server once. Visitors, poses and chat are not
backed up: they expire anyway and a backup would extend retention (section
4.1).

**R2 media.** Bundles are content-addressed and every source lives in a
tree's repo and `results/`; R2 is a mirror. `orchard push` re-creates it
from the harvest record. Keep a bucket manifest (`orchard r2 manifest`:
every key, size and digest) in the nightly backup so a lost bucket is a
list of what to re-push, and turn on R2's object versioning only if a
deleted-by-mistake bundle ever happens (it costs storage; not needed now).

**The secrets file and the CLI token**: Manuel's own encrypted backup, not
this document's.

### 3.12 Uptime monitoring

UptimeRobot's free plan: 50 monitors at 5-minute intervals, email alerts,
one status page (via search; not fetched from UptimeRobot's own page).
Better Stack's free plan: 10 monitors at 3 minutes. Either is enough. Five
monitors: `https://weichseltree.com/`, `https://weichseltree.com/mind/`,
one known bundle object on `media.weichseltree.com` (a HEAD returns 405,
so a GET with a range), `https://weichseltree.com/auth/jwks.json`, and the
SpacetimeDB HTTP endpoint for the database. Alerts to the Impressum
mailbox. Cost $0. No public status page until there is a second host to
answer it.

### 3.13 Monthly cost table

Vendor prices in dollars as quoted; the ElevenLabs line is a production cost
independent of visitors. "Voice" assumes route (a).

| line | A, tens | B, hundreds | C, low thousands | source |
|---|---|---|---|---|
| Cloudflare Pages, DNS, Turnstile, Access, Email Routing, Web Analytics | $0 | $0 | $0 | fetched |
| Cloudflare R2 | $0 | $0.30 | $2 | fetched |
| Cloudflare Realtime voice | $0 | $0 | $0 | fetched |
| Cloudflare Workers Paid (gateway) | $0 | $5 | $5 | via search |
| Workers AI Whisper, commands only | $0 | $0 | $0 | fetched |
| SpacetimeDB | $0 | $0 to $5 | $5 to $25 | fetched |
| Anthropic, voice to action, `claude-opus-5` | $0.30 | $3 | $35 | skill table, cached 2026-06-24 |
| ElevenLabs Starter or Creator | $6 to $22 | $6 to $22 | $6 to $22 | fetched |
| Resend, Sentry, UptimeRobot | $0 | $0 | $0 | fetched / via search |
| Domain renewal, amortised | €1 | €1 | €1 | not verified |
| Stripe | 7.2% of membership revenue | | | fetched |
| **total, about** | **$7 to $24** | **$15 to $36** | **$54 to $90** | |

Optional lines that change the picture: Deepgram captions at scale C,
$144 to $231; LiveKit Cloud Ship, $50; a VPS for a self-hosted module or
SFU, about €5; Sentry Team, $26. The largest line at every scale is
Manuel's 3 hours a week.

---

## 4. Legal and privacy for an EU/Austrian operator

Not legal advice; a list of what applies and what the code already does.
Confirm the Impressum and the Stripe paragraph with the WKO or a lawyer
once; both are one-hour questions.

### 4.1 GDPR basics for presence, voice and recording

- **Presence, poses, chat, the network hash** are personal data (a chosen
  name and behaviour tied to an identity). Legal basis: legitimate interest
  (Art 6(1)(f)) for running a shared room and keeping it safe; the privacy
  page already states what, who sees it and how long (30 days, session
  only, 24 h, 90 days, until it ends). Keep those numbers in the code and
  the page in step; the sweep is the enforcement.
- **Voice** is personal data in transit and, if stored, biometric-adjacent.
  Rule: **never stored**. No server-side recording, no client-side capture
  of others. The privacy page gains a paragraph: audio goes browser to
  Cloudflare to browser (or LiveKit), is not recorded, and a command's
  5-second clip is transcribed and discarded, transcript kept 24 h.
- **Session recording** (a demo capture, an episode filmed in the grove):
  only with consent from everyone in the room at the time, asked in the
  room, announced by a red "recording" tag on the host that the client
  cannot hide, in an `admin_only` room by preference. A `room.recording`
  flag in the module (not built) so the client can show it.
- **Records** (Art 30): keep a one-page record of processing activities
  (the privacy page's table plus purposes and processors); the small-
  enterprise exemption does not apply because the processing is not
  occasional.
- **Data subject requests**: the privacy page's route (name and time, or
  an issue) works; add the Impressum email. Deletion is `ban` for zero
  minutes plus deleting the visitor row, a dashboard button.
- **Transfers.** Cloudflare, Clockwork Labs, Stripe, Anthropic, Deepgram and
  LiveKit are US companies; rely on their DPAs and, where listed, the
  EU-US Data Privacy Framework; check each on the DPF list before naming it
  (not verified here). Prefer EU regions where a vendor offers one.

### 4.2 Impressum and Datenschutzerklärung

- **Impressum** (ECG §5 for every commercial site; MedienG §25 for the
  media owner; the WKO's "Das korrekte Website Impressum" pages, via
  search; the specific page fetched returned 404). For a sole trader not in
  the Firmenbuch, the "small website" set: name, a postal address for
  service (a Postfach is not enough; a c/o at a coworking or the WKO's
  address service, if available, is the usual answer for someone who does
  not want a home address online), an email, the Unternehmensgegenstand
  ("Forschung und Videoproduktion"), the place of residence, and, if a
  Gewerbe exists, the trade and the authority; a UID once there is one.
  Reachable in one click from every page: a footer link on the holding
  page, the privacy page, the grove's Leave page and the HUD's people
  panel footer. A palace-sized site with editorial content ("große
  Website") owes the fuller MedienG §25 disclosure (ownership, editorial
  line); the site today is small and stays so until it publishes opinion.
- **Datenschutzerklärung**: `grove/public/privacy/index.html` is already
  most of it. It needs: the controller's name and address (the Impressum),
  the legal bases per row, the processors list extended as vendors are
  added (section 3), the voice and transcript paragraphs, the analytics
  paragraph (cookie-less, and only on the site), the age line, the
  Datenschutzbehörde's address, and a date. In English with a German
  version; Austrian law does not require German but the audience is
  partly here.
- **Terms** (for members only): what a membership does, the price, the
  monthly term, cancellation any time from Stripe's portal, the 14-day
  withdrawal, the Kleinunternehmer note, governing law Austria, consumer
  court venue as the law provides.

### 4.3 Cookie-less analytics

No consent banner is owed for something that sets no cookie and stores
nothing on the device beyond what the service needs (TKG 2021 §165(3), the
ePrivacy rule as Austria transposed it). The grove's three local-storage
entries (token, name, the old token) are strictly necessary for the thing
the visitor asked for and are listed on the privacy page. Cloudflare Web
Analytics on the site only, with the "no cookies" claim verified on
Cloudflare's data-origin page before it goes on the privacy page. No
analytics in the grove; the database counts visits.

### 4.4 Age policy for voice chat

Austria sets the digital age of consent at 14 (DSG §4 Abs 4, via search;
GDPR Art 8 allows 13 to 16). The grove processes visitors on legitimate
interest, not consent, so the 14-year line is a floor for the service
itself, stated in the rules. Voice with strangers is the risk, not the
data: **16 and over on voice**, no verification (there are no accounts to
verify), the line shown before the microphone button appears, and a report
reason "underage on voice" that the host acts on by muting first and
asking second. YouTube's own age rules govern the channel.

### 4.5 The AGPL notice in the client

AGPL §13: a visitor interacting with the grove over the network must be
offered the corresponding source. The client has "Source (AGPL-3.0)"
linking to the repo; make it exact: the build stamps the commit into the
bundle (`import.meta.env.VITE_COMMIT` from `git rev-parse` in `pnpm run
deploy`) and the link becomes `github.com/weichseltree/orchard/tree/<sha>`,
shown on the holding page footer, the Leave page and the provenance panel
(which already shows commits for bundles). Ship `LICENSE` in `dist/` and a
`third-party.txt` generated from the lockfile (three.js MIT, hls.js
Apache-2.0, zod MIT; check the SpacetimeDB SDK's package licence field
before stating it). A node operator who forks inherits the same
obligation, and the README's node paragraph says so in one sentence.

---

## 5. Sequencing

Six steps, each with what it unlocks and a rough cost in Manuel's hours
(sessions do the typing; the hours are reading, rulings, accounts and the
things only Manuel can do). Total about 90 hours over two to three months
at 8 to 10 hours a week.

| step | what | unlocks | hours |
|---|---|---|---|
| 1 | **The front door.** README rewrite, hero still and clip (needs the hardware pass or a desktop capture), topics, labels and ten good first issues, the roadmap Project, CONTRIBUTING, CODE_OF_CONDUCT, root SECURITY.md, DCO app, FUNDING.yml, `v0.1.0` tag and Zenodo, GitHub Sponsors application, the Impressum page and the privacy page's address, DNS hygiene (DNSSEC, CAA, SPF/DMARC), Email Routing for `hello@`. | a repo a stranger can land on; sponsorships at 0%; a legal site | 12 |
| 2 | **The gate and voice.** BACKLOG 25 (Turnstile and the token service on), the Realtime session route in the token service, push-to-talk with the PannerNode, CSP and Permissions-Policy widened, the rules panel and the age line, the "room is full" notice, the new-visitor quiet period, a room-mute flag, the own error beacon, five uptime monitors. | M1 company; a launch that survives a full hall | 20 |
| 3 | **The host in the browser.** Cloudflare Access on `/greenhouse/*`, `/auth/admin` minting admin tokens, the greenhouse room with the review queue and rulings, a moderator role in the module, `orchard backup` and its restore script. | moderation from a headset; a second host; rulings from anywhere; the vote's venue | 16 |
| 4 | **Launch.** The first episode exhibited (LAWS 22), the hardware pass done, Show HN, r/WebXR and r/opensource, Bluesky and Mastodon with the clip, a Patreon post, Web Analytics on the site. | visitors; the numbers that decide whether steps 5 and 6 are worth doing | 10 plus the episode |
| 5 | **Membership and the vote.** Stripe account and Checkout links, the terms page, the Steuerberater hour (Gewerbe, Kleinunternehmer, EU digital-services rule), `/member/link` and `orchard sync members`, passkeys, the monthly vote in the greenhouse, Resend for the vote mail, the Patreon tier aligned. | money that does something; members who are members of something | 20 |
| 6 | **Speech and voice to action.** The Worker gateway with `orchard gateway push`, Workers AI Whisper on push-to-talk clips, the `/act` route with structured output and the per-visitor breaker, the rooms' vocabulary from the exhibit table, the privacy page's transcript paragraph. | rooms you can talk to; the research demo's best minute | 14 |

Not in the six, and next after them: the second node on Legion and the
first portal (M3), which is the "fund a tree in kind" path made real, and
the paper (section 1.3), which needs M3's numbers to be worth writing.

---

## Sources fetched 2026-09-12

- developers.cloudflare.com/r2/pricing · realtime/sfu/pricing · realtime/sfu ·
  workers-ai/platform/pricing · pages/platform/limits · web-analytics ·
  web-analytics/get-started · email-routing · turnstile/plans
- spacetimedb.com/energy
- deepgram.com/pricing
- stripe.com/at/pricing
- elevenlabs.io/pricing
- resend.com/pricing
- livekit.com/pricing · docs.livekit.io self-hosting deployment ·
  github.com/livekit/livekit LICENSE
- docs.github.com: About GitHub Sponsors; Setting up GitHub Sponsors for
  your personal account
- patreon.com/pricing (the creator-fees support article returned 403)
- wko.at Kleinunternehmerregelung (the Impressum page tried returned 404;
  the WKO's "Das korrekte Website Impressum" pages were found by search only)

Via search only, not fetched from the vendor: Cloudflare Workers paid plan
and Access pricing, Sentry plans, UptimeRobot and Better Stack free plans,
Web Speech API's server-side processing, DSG §4 Abs 4, the Web Analytics
beacon hosts, LiveKit's spatial-audio example and Krisp filter, Patreon's
processing rate, the SpacetimeDB referral programme. Not verified at all:
VPS prices, the domain renewal price, D1 and KV free-tier limits,
Cloudflare Tunnel's UDP behaviour, maincloud backups, LiveKit Cloud regions,
Anthropic's DPF status, the EU small-business VAT scheme's mechanics.
