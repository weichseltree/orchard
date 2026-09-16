# Sandbox trust: areas, admins, linked repositories

Written 2026-09-16, as the trust and safety half of Manuel's direction the
same day: *"I'd also like the rendering of everything be based on the repo
structures of everything the Admins of that area linked. This is how orchard
becomes a playable sandbox world."*

`docs/specs/TREE-AREAS.md` answers the other half: how a repository becomes a
building. It assumes a linked repository is untrusted input and says the
generator must be pure, budgeted, sanitised, asset-free and rate-limited
(TREE-AREAS §10). This document is what has to be true around that generator
before a repository that is not Manuel's own may be linked at all.

Nothing here is built. Every number is a proposal. The document ends in
rulings that are Manuel's to make. Where a recommendation is given it is the
conservative one, on purpose: the whole cost of being wrong here is paid by
visitors, in a room, while the host is asleep.

Wherever this document states a fact about the system today it names the file.
Anything not checked against the code is marked **unverified**.

---

## 0. What is true today

The baseline this design has to extend, with its sources.

| fact | where |
|---|---|
| there is one admin set for the whole database, an identity allowlist seeded with the publisher | `spacetime/spacetimedb/src/index.ts` lines 82-85, 518-529 |
| every privileged action calls the same gate, `requireAdmin`, which is a single boolean | same file, lines 308-318 |
| `add_admin` grants everything, and the module has no reducer that removes an admin | same file, lines 720-726 (searched the whole file for a remove path; there is none) |
| an admin cannot be banned; the ban helper refuses | same file, line 426 |
| a visitor's identity comes from a token the grove's service signs, with a random `sub` and a keyed hash of their network | `grove/auth/issuer.ts` lines 12-19, 207-223 |
| the token service stores nothing, so an identity exists only while a browser keeps its site data | `grove/auth/issuer.ts` lines 17-19; `docs/SECURITY.md` lines 33-37 |
| what hangs is the database's call, and a take-down reaches visitors with no rebuild | `docs/specs/PACKAGES.md` §5 and §7; `take_down` in `index.ts` lines 786-792 |
| the scene document is not: `mansion.json` is imported into the client bundle | `grove/src/main.ts` line 28; changing it needs a build and a deploy, `docs/SECURITY.md` lines 110-113 |
| hanging is a ruling: an unapproved bundle is refused | `orchard/exhibit.py` lines 84-92; LAWS 22 |
| anything served to a visitor is content-addressed and immutable | `docs/specs/PACKAGES.md` §3, §4; `orchard/push.py` header; `grove/public/_headers` lines 15-27 |
| the client may load code and data from almost nowhere: self, `media.weichseltree.com`, the SpacetimeDB socket, Turnstile, and one game origin | `grove/public/_headers` line 9 |
| the home box makes outbound connections only | `docs/HOSTING.md` lines 30-31 |
| the only text a reducer cleans is chat and visitor names | `index.ts` lines 331-341, used in `say` and `join` only |
| `set_room` writes a room title with no cleaning, and `hang` writes a title and a URL with no cleaning or host check | `index.ts` lines 665-672 and 777-784 |
| moderation acts on people: mute, kick, ban, report, and rate limits | `index.ts` lines 674-718, and the constants at 46-74 |
| a report can only name an online visitor in your own room | `index.ts` lines 632-638 |
| retention is enforced by a ten-minute sweep: chat 24 h, reports 90 days, a visitor row 30 days | `index.ts` lines 50-53, 479-516; `docs/SECURITY.md` lines 88-94 |
| nothing in the orchard CLI clones a repository; the only outbound calls are Cloudflare, the ledger, and one `git ls-remote` against checkouts already on the box | searched `orchard/*.py`; `orchard/audit.py` lines 286-290 |
| a tree today is a local checkout: `trees/*.yaml` carries a `path`, and `remote` is often empty | `orchard/manifest.py` lines 96-99; `trees/spectre.yaml`; spectre has no remote, `docs/specs/PACKAGES.md` §2 |

Two of these decide most of what follows.

**The first**: a take-down of an exhibit reaches visitors in seconds, and a
change to the world's geometry reaches them only on a deploy. Under the brief,
geometry is the thing strangers supply.

**The second**: `requireAdmin` is one boolean. There is no smaller grant in the
module than "everything", and no way to take it back.

---

## 1. Who is an admin of an area

### 1.1 The smallest model

An area is a tree, one linked repository (TREE-AREAS §2). The smallest model
that gives an area its own admins is two tables and four reducers, all
additive. Additive matters: an upgrade that needed `--delete-data` would take
the rulings with it (`docs/HOSTING.md` lines 146-149), and the module already
has a precedent for adding a table rather than a column for exactly this
reason (`join_throttle`, `index.ts` line 262).

    area        { tree (pk), repo, commit, plan, state, linked_by, linked_at, confirmed_at }
    area_admin  { tree, identity, added_by, added_at }   indexed by tree and by identity

    link_area / unlink_area        host only
    set_area_state                 host, or an admin of that area (pause and resume only)
    add_area_admin / drop_area_admin   host, or an admin of that area, inside that area

`state` is one of `draft`, `live`, `paused`. It is the kill switch and section
4 depends on it.

**Do not use `add_admin` for this.** It grants the whole database, it cannot be
undone from the module, and the holder cannot even be banned (`index.ts` lines
426, 720-726). An area admin must be a row in `area_admin` and nothing else.

**What an area admin may do**: everything inside their own area, by committing
to their repository, exactly as TREE-AREAS §10 describes; plus, in the world,
pause their own area, hide one hanging in their own area, and resolve a content
report about their own area.

**What an area admin may not do**: anything about people. Not mute, not kick,
not ban, not read a report about a person, not see another room's presence.
Nothing outside their own area. Nothing about the admin list. The visitor
tables are private and read through three room-scoped views (`index.ts` lines
844-876); area admins gain no new read anywhere.

Recommendation: **do not build any of this yet**. Stages 1 and 2 (section 6) do
not need it. TREE-AREAS §12.5 asks the same question and this document gives
the same answer: the operator links, the repository rules, until a second
person actually has a tree.

### 1.2 How someone becomes one

The proof that someone controls an area should be the same proof that they
control the repository, because under this design the repository is the area.
So: **an area's admin list lives in the repository**, as a list of grove
identity hexes in `orchard.yaml`, read by the generator at the pinned commit
and mirrored into `area_admin` by the home box on its ordinary sync pass
(`orchard/sync.py` installs a fifteen-minute timer).

That buys three things for no new machinery:

- Whoever can commit is the admin. No invitation flow, no account, no email.
- Rotation is a commit. This matters because an identity is a browser's token
  and dies with its site data (`grove/auth/issuer.ts` lines 17-19,
  `docs/SECURITY.md` lines 33-37): an admin who clears their browser commits a
  new hex and is themselves again on the next pass.
- Succession is a commit. Whoever holds the repository holds the area.

The identity a person pastes into that file is obtained the way Manuel's own
browser identity was: `grove.presence.identityHex` in the console
(`docs/SECURITY.md` lines 33-37; `grove/src/net/presence.ts` line 244).

The weakness is honest and should be stated in the same breath: an identity hex
in a public file is a bearer name, not a credential. It proves nothing about a
person, only about who committed it. That is enough for "this area's admins",
because the area is the repository. It is not enough for anything that touches
people, which is why section 1.1 gives area admins no power over people. If
that ever changes, the identity must survive a cleared browser first, which is
the passkey route already sketched in `docs/specs/COMMUNITY-AND-INFRA.md` §3.7
item 4.

### 1.3 The host's veto

Absolute, one-sided, and never mediated by an area admin:

- Only the host links and unlinks. An area admin cannot bring an area into
  existence (TREE-AREAS §10: linking is the only trust decision in the model).
- The host can pause any area, at any time, without the area's admins, and the
  area cannot resume itself out of a host pause. Two flags, not one: an area
  admin's pause and a host's pause are different fields, or a host pause is a
  state an area admin's reducer refuses to leave.
- `requireAdmin` stays exactly as it is. Every new reducer checks the host
  first and the area membership second.
- An area admin's row can be dropped by the host in one call, unlike an
  `admin` row.

### 1.4 When an admin leaves

There is no inheritance mechanism, and there should not be one. An area with
nobody able to commit to its repository is a building nobody maintains.

Proposed behaviour, cheapest first:

1. **Nothing breaks.** The plan is pinned to a commit (TREE-AREAS §5,
   determinism). An unmaintained area keeps rendering what it last rendered.
2. **Confirmation ages.** `confirmed_at` on the `area` row is refreshed
   whenever an admin acts, or the host confirms a refresh. Past a threshold
   (proposed 180 days) the area goes to `paused` on its own.
3. **A paused area closes its doors, it does not vanish.** The schema already
   has `closed: true` on a doorway (`grove/src/world/schema.ts` line 43, used
   by the hall's greenhouse door in `mansion.json`). A closed door keeps every
   route a visitor learned, which a deleted area would break.
4. **A repository that goes private or disappears is unlinked by the host.**
   The fetch will simply fail, because the fetcher carries no credentials
   (section 2.3). A failed fetch is not an emergency; it pauses, it does not
   delete.
5. **Unlinking is a DECISIONS line**, like every other ruling in this repo.

---

## 2. What a link is, and what it may render

### 2.1 A link is not a URL

A link is a row the host writes: a repository, a commit, a generated plan
identified by its hash, a licence, and a state. TREE-AREAS §5 already makes the
plan a pure function of the generator version, the commit and the manifest
digest, addressed by the sha256 of those. The link is what the host ruled about
one such plan.

Consequences worth stating plainly: a push does not change the world; a link
refresh does. The host can see the diff between two plans before anything
renders, which is the whole of the asleep defence in section 3.7.

### 2.2 Which repositories may be linked

Three options were considered.

| option | what it costs |
|---|---|
| any public URL | new outbound fetching of attacker-chosen data on the one box that holds the Cloudflare tokens, the SpacetimeDB owner token and the secrets file (`docs/HOSTING.md` §Secrets) |
| only repositories the host has planted as trees | one more step for a stranger, no new capability at first, and the manifest already exists (`orchard/manifest.py` lines 96-99) |
| only repositories on an allowlist of forges | a middle option that still fetches strangers' bytes, and pretends a forge is a trust boundary |

Recommendation: **only trees the host has planted**, through stages 1 and 2.
Nothing in the CLI clones anything today, so "any public URL" is not a
configuration change, it is a new class of capability on the home box. When
stage 3 arrives, the link request should still be a request: a stranger asks,
the host links.

### 2.3 What is read, by whom, where

Read: **the git tree at the pinned commit, plus `orchard.yaml`**, and nothing
else (TREE-AREAS §3). Concretely, and narrower than that spec needs to be:

- path names, directory structure, file sizes and line counts;
- the text of README-like files, up to a byte cap per file and per area;
- the artefact declarations in `orchard.yaml`.

Never: file contents other than the declared prose; never binary; never any
image, mesh, font or video (TREE-AREAS §10, asset-free); and, this document
adds, **never committer names, e-mail addresses, commit messages or blame**.
Those are personal data about people who never agreed to be in a world
(section 5).

By whom, and where: **the home box, in two separate processes.**

1. A **fetcher**, which is the only part that touches the network. It runs on
   the home box, outbound only, with no credentials (`GIT_TERMINAL_PROMPT=0`
   and an askpass that fails, so a private repository cannot be read even by
   accident), submodules off, hooks off, a fixed git config, a byte quota, a
   file-count quota and a wall-clock timeout, writing into `results/areas/`
   on disk and never `/tmp`. Each of those git flags must be checked against
   the installed git before the first repository that is not ours: **unverified**.
2. A **generator**, which has no network at all, is pure, and is the thing
   TREE-AREAS §10 describes.

Never in a Cloudflare Worker, and never in the visitor's browser.

### 2.4 Can a linked repository ever render live?

**No. Not without the host's machine fetching it.** Three independent reasons,
each of which is enough on its own:

1. The home box makes outbound connections only (`docs/HOSTING.md` lines
   30-31). Nothing outside can push into the pipeline; the box pulls or nothing
   happens.
2. The client cannot reach a forge. The CSP allows connections only to the site
   itself, `media.weichseltree.com` and the SpacetimeDB socket
   (`grove/public/_headers` line 9). Rendering `github.com` content in the
   browser means widening the one line that keeps a compromised dependency from
   phoning anywhere.
3. Anything served to a visitor is content-addressed and immutable
   (`docs/specs/PACKAGES.md` §3 and §4). A repository URL is a fixed name whose
   content changes, which is the exact thing that spec was written to forbid.
   The live-stream carve-out does not apply: it is for a name with no bytes
   behind it (PACKAGES.md §1), not for somebody's files.

So the honest wording for the world is not "live". It is "at commit `abc1234`,
as of a date". The guide should say that on the entrance wall, always.

---

## 3. The attack surface

Each item: what it is, what already covers it, what does not, and what to do.

### 3.1 Hostile repository content rendered as visible text

Directory names become room titles, README text becomes a wall a visitor reads,
file names become furniture labels (TREE-AREAS §6). All of it is text a
stranger wrote, shown to everyone who walks in, with none of chat's limits.

Covered today: nothing. `cleanText` and `cleanName` exist (`index.ts` lines
331-341) but are used only by `say` and `join`. `set_room` takes a title
unsanitised (lines 665-672) and `hang` takes a title and a URL unsanitised
(lines 777-784), which is safe only because the only caller is the home box.

Mitigations:

- Sanitise at generation, as TREE-AREAS §10 already specifies: 64 characters,
  control characters and bidirectional overrides stripped, never markup.
- Sanitise again at the module boundary. Any reducer that accepts text on the
  area path runs it through `cleanText`. The database should not be the weak
  link if the generator is ever wrong.
- Keep the client's text rendering as `textContent`, which is what the guide
  does today (`grove/src/ui/guide.ts` lines 190-204), with a test that says so.
- Never let area content become a link. Today the only href built from exhibit
  content is a fixed notes path plus an anchor (`grove/src/ui/exhibit-content.ts`
  lines 133-135). Keep that property.
- Cap the total rendered text per area, not only per string.

What none of that catches: well-formed prose that is abusive, targeted, or
defamatory. No filter finds it. A per-room word filter was already considered
and rejected for the chat case, with reasons (`docs/specs/COMMUNITY-AND-INFRA.md`
§2.2). The answer is the report path and the pause (section 4), plus the
staging in section 6.

### 3.2 Enormous or adversarial repositories

The client budget and the build budget are both at risk: a repository with a
hundred thousand directories, a README of 40 MB, paths 4,000 characters long, a
symlink loop, a `..` escape, a git history designed to be slow to clone.

Covered today: in the plan only. TREE-AREAS §4 and §10 give `MAX_ROOMS` 64,
`MAX_DEPTH` 5, a wall-clock limit, an output size limit, truncation into a
stacks chamber rather than failure, path normalisation and a refusal of `..`.

Not covered: the fetch, the disk, and the client's draw calls across many
areas at once.

Mitigations:

- Quotas at the fetcher (section 2.3), enforced before the generator ever runs.
- A ceiling on the total number of rooms across all linked areas, not only per
  area, and a ceiling on the number of live areas.
- Furniture off by default. It is the bulk of the draw calls and TREE-AREAS
  §12.3 already flags it as a ruling. Device tiers exist as a spec
  (`docs/specs/DEVICE-TIERS.md`); what it says about room and draw-call budgets
  is **unverified** here.
- A plan that exceeds any budget truncates, and the truncation is visible in
  the world, so an admin can see that their repository was cut.

### 3.3 A repository that links another repository

Cycles, and amplification: one commit causing many fetches, or an area that
teleports visitors into an area that teleports them onward.

Mitigation, and it is simple: **links are not transitive.** Only the host
creates a link. A repository may put a request in `orchard.yaml`, and a request
is a line in a queue that a human reads. It never causes a fetch. Portals
between areas are drawn from the host's link table, not from repository
content, so the graph of the world is a thing the host wrote. One fetch per
tree per interval at most, coalesced, which TREE-AREAS §10 already asks for.

### 3.4 Private data leaked by structure alone

`docs/specs/AUDIO-STREAM.md` §7 flags exactly this for observed repositories
and rules it out: no stream from an observed repository hangs in a public room
before there is a redaction and consent story, and a private greenhouse exhibit
is the honest first venue. Structure is a stronger leak than a side channel,
because structure is the product here. A path can name a customer, an
unreleased project, a person, or an unfixed vulnerability.

This repository already knows the shape of the problem: `results/audit.json`
stays on the box precisely because repository names include private repositories
(`docs/specs/PACKAGES.md` §8).

Mitigations:

- Public repositories only, proved by fetching with no credentials, so a
  private one fails rather than renders.
- The generator reads the git tree at a commit, never the working directory
  (TREE-AREAS §3), which also keeps gitignored material out.
- An area's first render happens in an admin-only room. The mechanism exists:
  `room.admin_only`, and the greenhouse uses it (`index.ts` lines 343-349,
  521). Its admins walk it, then it goes public.
- Per-path exclusions in `orchard.yaml` that an admin can extend, applied
  before anything else (TREE-AREAS §3).
- No committer identity, ever (section 2.3).

### 3.5 An admin who turns hostile after being trusted

With the powers in section 1.1 the worst case is deliberately boring: they
rewrite their own repository so their own area reads badly. They cannot hang
media, because media still goes through harvest, approval and push
(`orchard/exhibit.py` lines 84-110; LAWS 22; TREE-AREAS §10 asset-free). They
cannot touch people. They cannot touch another area.

Mitigations beyond that:

- The pin. A hostile push does not reach visitors until a refresh, and a
  refresh is a diff a human can gate (section 2.1).
- The host's pause and unlink, in one call, without them.
- Never `add_admin` (section 1.1), because that grant cannot be revoked from
  the module and its holder cannot be banned (`index.ts` lines 426, 720-726).
- An area admin who adds another area admin does so inside their own area only,
  and the host sees the row.

### 3.6 The world as free hosting, or as a channel to reach visitors

**Free hosting** is largely closed by construction and should stay that way: the
area path carries no bytes to visitors, no asset from a repository enters the
scene, and a plan may never name a URL. Bundles remain the only route for
bytes, and they are content-addressed, verified and approved
(`orchard/push.py`, `orchard/exhibit.py`, `docs/specs/PACKAGES.md` §3).

**Reaching visitors** is the open one. Text in a room is a broadcast that none
of the module's limits touch. Chat is one line per 0.7 s and 280 characters
(`index.ts` lines 46, 616-629); a room title has no gap and no cap, is seen by
everyone who enters, and persists. That is a better spam channel than chat.

Mitigations: the text caps of section 3.1; attribution on the entrance wall, so
every word in an area is visibly somebody's repository; no links; and the
report path of section 4, which is what turns "somebody noticed" into "the
doors closed".

### 3.7 What any of this costs while the host is asleep

One operator, in Austria, with a budget of about three hours a week
(`docs/specs/COMMUNITY-AND-INFRA.md` §2.5). Every privileged action today is
synchronous and manual, and the only thing that runs unattended is the sweep,
which enforces retention and nothing else (`index.ts` lines 743-755).

So, today, an abusive room title that got in would stay until Manuel woke up,
and if it were in the scene document it would stay until he woke up **and
deployed** (`grove/src/main.ts` line 28).

In order of cost:

1. **Refresh is gated.** Nothing new renders without a human pass. The asleep
   case becomes "nothing changed", which is the safest default available and
   costs no code.
2. **A kill switch that is one reducer call**, closing every door into an area.
   Doors already have `closed: true`.
3. **Automatic pause on reports**: N distinct reporters about one area inside M
   minutes closes its doors. This is the only unattended defence worth
   building, and it is abusable, so it must close doors rather than delete
   anything, must be reversible in one call, and must be logged.
4. **A second pair of hands.** A moderator role short of admin is already
   listed as not built (`docs/SECURITY.md` line 38) and sized at about 40 lines
   with the note that it is worth doing before the first person is asked to
   help (`docs/specs/COMMUNITY-AND-INFRA.md` §2.2). Stage 3 needs it.

### 3.8 What the existing tools cover, and what they do not

| threat | mute / kick / ban / report / sweep |
|---|---|
| a person harassing others in a room | covered (`index.ts` 674-718) |
| a person spamming chat or poses | covered by the rate limits (lines 46-74) |
| many identities from one network | covered by the per-network cap and network bans (lines 74, 380-399) |
| a banned person coming back as an admin's guest | covered: an admin cannot be banned, everyone else can (line 426) |
| an abusive room title, wall of text or furniture label | **not covered.** No reducer takes it down, and no report names it |
| an abusive exhibit title | **not covered** by reporting; `take_down` exists but is admin-only and needs the id (lines 786-792) |
| a whole area that has to go | **not covered.** There is no area |
| taking geometry down without a deploy | **not covered** (`grove/src/main.ts` line 28) |
| removing a trusted person's powers | **not covered** for `admin`; nothing removes an admin |
| anything at all between 23:00 and 08:00 Vienna | **not covered.** Nothing acts unattended except retention |

---

## 4. The moderation story

### 4.1 What a visitor can report

Today: a person, who must be online and in the same room (`index.ts` lines
632-638), throttled to one report per 30 s, keeping the subject's last five
lines of chat, retained 90 days.

Proposed addition: **a content report**, in its own table so the upgrade only
adds (the `join_throttle` precedent, `index.ts` line 262), and tested against a
local server with the module published over a copy of the old one first
(`docs/HOSTING.md` lines 146-149).

    content_report { id, reporter, target_kind, target_id, area, reason, room, status, at }

`target_kind` is `area`, `room` or `hanging`. The reason goes through
`cleanText`. The same 30 s throttle applies, from the same throttle row. No
chat context is attached, because the subject is not a person.

The client needs one thing the HUD does not have: a way to point at what you
are looking at. Reporting a person already exists in the client
(`grove/src/net/presence.ts` lines 377-388, and the people panel described in
`docs/specs/COMMUNITY-AND-INFRA.md` §2.4 item 6); a "Report this room" entry in
the guide is the cheapest equivalent.

### 4.2 What a host or an area admin can do

| action | host | area admin |
|---|---|---|
| pause or resume an area | yes, and an area admin cannot resume out of a host pause | own area only |
| unlink an area | yes | no |
| hide one hanging | yes (`take_down`) | own area only |
| close a door | yes | own area only |
| resolve a content report | yes | own area only |
| mute, kick, ban | yes | **no** |
| read reports about people | yes | **no** |
| add or drop an area admin | yes | own area only |
| anything about `admin` | yes | **no** |

### 4.3 How fast a takedown reaches visitors

This is the load-bearing paragraph of the whole document.

There are two speeds today and they differ by construction. A row in the
`exhibit` table reaches visitors live, and a take-down reaches them with no
rebuild (`docs/specs/PACKAGES.md` §5 and §7, landed at grove `cefca89`). The
scene document does not: `mansion.json` is imported into the bundle
(`grove/src/main.ts` line 28) and only a build and a deploy change it.

Therefore: **anything a stranger can put in front of a visitor must be
revocable from the database, not from the build.**

Concretely, an area's plan must be addressed by a row whose state the module
owns, so that setting `paused` reaches open tabs the way an exhibit take-down
already does, with the client treating the database as the authority exactly as
PACKAGES.md §5 says it does for hangings. Whether the plan's bytes travel as a
bundle on R2 or as a row is a separate question; what may not happen is that
the only way to withdraw a stranger's text is `pnpm run deploy`.

If Manuel rules the other way, the design still works, but it stops at stage 1:
the world can then host only content the host would be happy to leave up for
as long as it takes him to wake up and deploy. That is a coherent position. It
is not compatible with strangers linking repositories.

### 4.4 What is retained

The existing numbers stand and are not to be extended for this
(`docs/SECURITY.md` lines 88-94; `index.ts` lines 50-53):

- content reports: 90 days, the same as reports about people, swept by the same
  reducer;
- a takedown or pause record: 90 days in the database, plus a DECISIONS line
  for an unlink, which is how every other ruling in this repository is kept;
- the fetched clone and the generated plans: kept while the area is linked plus
  one refresh interval, then deleted. An unlinked area's material goes.
- chat, poses and visitor rows: unchanged. A content report must not become a
  reason to keep a person's data longer.

A README can contain personal data, so an area's rendered text is in scope for
an erasure request even though it is somebody else's repository. The only
honest answer to such a request is to pause or unlink the area and tell the
person who owns the repository. Say that in the privacy page before stage 2,
not after.

---

## 5. The legal and licensing edge

Not legal advice, and this section deliberately gives none. It lists the
questions that must have answers before a stranger's repository renders in a
public world, and the conservative default that holds until they do.
`docs/specs/COMMUNITY-AND-INFRA.md` §4 is the existing groundwork: the
Impressum, the Datenschutzerklärung, and the AGPL notice.

The questions:

1. **Is a rendered plan a reproduction of the repository?** Structure and names
   may be facts. A README shown on a wall is a verbatim reproduction of a
   copyrightable work. Which parts of what the generator renders need a licence
   from the repository's author?
2. **What grants that licence?** Is a maintainer's act of linking, or of
   committing an admin list, an adequate grant? If not, what is?
3. **Attribution.** What do the common licences require to be shown, and where
   does it have to be? A wall in a room is not a footer.
4. **Personal data inside a repository.** A README can contain a name, an
   e-mail address, a photograph's credit. Which legal basis covers rendering
   that, and what does an erasure request do to an area whose repository we do
   not control?
5. **Names and marks.** A room labelled with a company's repository name uses
   that name in public. When is that a problem?
6. **Notice and takedown.** Who receives a complaint, at what address, within
   what time, and who decides? The Impressum exists (Weichseltree OÜ, registry
   code 17482992, `docs/SECURITY.md` lines 141-144) so the address is not the
   hard part; the stated time and the decision rule are.
7. **Operator liability.** The host serves what an area shows. What does
   Austrian and EU hosting law ask of an operator who publishes user-linked
   content, and does the answer change between "the host links" and "strangers
   link"?
8. **AGPL.** `docs/specs/COMMUNITY-AND-INFRA.md` §1.1 already settles the
   mirror case: a tree's code is not touched, and communicating through files
   and a manifest does not make a tree a derivative of the orchard. What is
   unanswered is the other direction, which is question 1.

The conservative default meanwhile:

- Only repositories Manuel owns, or whose owner has given written permission.
- Only repositories carrying a licence that permits redistribution, recorded in
  the link row, checked at link time. No licence means all rights reserved,
  which the repository already states as the default for a bundle without a
  licence field (COMMUNITY-AND-INFRA §1.1), and which is not enough to put
  someone's prose on a wall we serve.
- Every area names its repository, its commit and its licence on its entrance
  wall, always visible, not behind a menu.
- No committer names, e-mail addresses or commit messages rendered, ever.
- No area goes public before a human has read its rendered text once.

---

## 6. Stages

### Stage 1: the host links his own trees

**The current code can support this today, with no module change.** Generation
happens on the home box; the plan ships in the build exactly as `mansion.json`
does now (`grove/src/main.ts` line 28); everything a visitor sees passed through
`requireAdmin` or a deploy; the only repositories involved are Manuel's own, so
sections 3.4, 3.5 and 5 do not bite.

Trust work that must land first, all of it outside the module:

- the generator's purity, budgets and sanitising (TREE-AREAS §10);
- the text-only rendering rule, with a test;
- attribution on the entrance wall: repository, commit, licence, date;
- furniture off until a device-tier budget has been measured;
- a DECISIONS line for each area.

### Stage 2: the host links repositories he does not own, with consent

Trust work before the first one:

- **plan state in the database**, so a pause reaches visitors without a deploy
  (section 4.3). This is the gate for the whole stage;
- the content report path and the takedown record (section 4.1);
- the fetcher, with quotas, no credentials, no submodules, no hooks (2.3), and
  its git flags actually verified;
- first render in an admin-only room, then public (3.4);
- the licence gate, the attribution wall, and no committer identity (section 5);
- refresh gated by a human reading the diff (2.1, 3.7);
- the privacy page's paragraph about what an erasure request does to an area.

### Stage 3: strangers link repositories

Trust work before the first stranger:

- `area` and `area_admin` with the strict power subset of section 1.1, and
  never `add_admin`;
- an identity that survives a cleared browser, for anyone whose loss of it
  would matter (COMMUNITY-AND-INFRA §3.7 item 4);
- a way to remove a trusted person's powers, which the module does not have at
  all today;
- a second moderator, and the moderator role short of admin
  (`docs/SECURITY.md` line 38; COMMUNITY-AND-INFRA §2.2);
- unattended auto-pause on reports (3.7 item 3);
- answers to section 5, at least questions 1, 2, 6 and 7;
- rate limits on link requests, and a cost line for fetching and storing
  strangers' repositories, which nobody has costed anywhere in this repository.

---

## 7. What could not be verified here

- Whether the git flags in section 2.3 behave as assumed on the installed git,
  particularly around submodules, filters and hooks.
- Whether the owner can delete an `admin` row directly through `spacetime sql`.
  If not, the only removal path is a republish, which would be far worse than
  the problem.
- What `docs/specs/DEVICE-TIERS.md` budgets per tier, which decides the
  furniture and room-count caps of section 3.2.
- Whether the client can drop an area's geometry on a database change without a
  reload, which section 4.3 requires. The exhibit path does this for hangings
  (PACKAGES.md §5); the scene document path has never had to.
- Everything in section 5, all of which is a question for a lawyer and none of
  which is answered here.

---

## Rulings for Manuel

Each is one question. Each recommendation is the conservative one, and says so
where the cautious answer costs something real.

1. **Revocation route.** Must anything a linked repository puts in front of a
   visitor be withdrawable from the database rather than from the build?
   *Recommended: yes.* This is the conservative answer and it is also the
   expensive one. A no is coherent, but it caps the design at stage 1 for good
   (section 4.3).

2. **Which repositories.** May any public repository URL be linked, or only a
   tree the host has planted? *Recommended: only planted trees*, through stages
   1 and 2 (section 2.2).

3. **Per-area admins now.** Do `area` and `area_admin` get built now, or does
   "the operator links, the repository rules" stand until a second person
   actually has a tree? *Recommended: stand.* This is the same question as
   TREE-AREAS §12.5 and this document reaches the same answer (section 1.1).

4. **Power over people.** Do area admins ever get mute, kick or ban inside their
   own area? *Recommended: no, never.* An identity hex in a public file is a
   bearer name, not a credential (section 1.2).

5. **The admin list.** Is `add_admin` allowed to be the mechanism for an area
   admin? *Recommended: no.* It grants the whole database, it cannot be undone
   from the module, and its holder cannot be banned (section 1.1).

6. **Sleeping hours.** Does an area pause itself when several visitors report
   it inside a short window? *Recommended: yes, from stage 2*, closing doors
   only, never deleting, reversible in one call (section 3.7).

7. **Licence gate.** Must a repository carry a licence permitting
   redistribution before it may be linked? *Recommended: yes*, recorded in the
   link row, with attribution on the entrance wall (section 5).

8. **Committer identity.** May committer names, e-mail addresses or commit
   messages ever render? *Recommended: never* (sections 2.3 and 5).

9. **Furniture.** Do source files render as shelving before a device-tier
   budget has been measured? *Recommended: no, off by default.* TREE-AREAS
   §12.3 asks this for quality; this document asks it for the client's budget
   and for the amount of stranger-supplied text on screen (section 3.2).

10. **First venue.** Does every new area render first in an admin-only room
    before it is public? *Recommended: yes, always*, which is the same rule
    AUDIO-STREAM §7 applies to an observed repository's stream (section 3.4).

11. **Takedown promise.** What address answers a complaint about an area, and
    within what time? *Recommended: the Impressum address, 72 hours, stated on
    the privacy page, and unlink first and argue afterwards* (section 5).

### Built, 2026-09-16 (the first step of the trust layer)

The `area` and `area_admin` tables and the area-scoped moderation of ruling 4
are in the module (`spacetime/spacetimedb/src/index.ts`, "areas"), additive,
no table of the old module touched:

- `area { tree (pk), repo, commit, licence, plan, state, host_paused,
  linked_by, linked_at, confirmed_at }`, public, so a client can read an
  area's state. `licence` is the licence gate of §5 and ruling 7: an SPDX
  identifier from the module's list of licences that permit redistribution,
  checked by `link_area`; no licence, no link;
  `plan` is empty while an area's plan ships in the build. `state` is
  `draft` (the admin-only first venue: the host and the area's admins may
  join its room, nobody else), `live`, or `paused` (the host alone);
  `host_paused` is the host's own pause, which an area admin cannot lift.
- `area_admin { id, tree, identity, added_by, added_at }`, private.
- `area_sanction { key = tree:identity, tree, identity, muted, until, reason,
  by, at }`, private: an area admin's mute and ban (a kick is a ten-minute
  ban), which `join` and `say` apply in that area's room and nowhere else,
  and which can never touch an admin of the world. Expired bans are swept
  with the others.
- Reducers: `link_area` (with the licence), `unlink_area`, `host_pause_area` (host only);
  `set_area_state` (the host any state; an area admin between `live` and
  `paused`, never out of `draft`, never out of a host pause);
  `add_area_admin`, `drop_area_admin`, `area_mute`, `area_kick`, `area_ban`,
  `area_unban` (the host, or an admin of that area). Every one checks the
  host first and the area's membership second; `requireAdmin` is untouched.
- An area's presence room carries the tree's name: that is how `join` knows
  which area a room belongs to, and what the sanctions key on.
- The host's side from the command line: `orchard area link --licence|
  unlink|state|host-pause|admin|list` (orchard/area.py).
- `grove/scripts/module-check.ts` holds twenty-one rules for it against a
  local server: no link without a redistributable licence, a draft turns
  visitors away and admits its admin, an area admin
  cannot open the area or lift a host pause or act in another area or touch
  an admin of the world, a mute and a ban hold in the area's room only, and
  unlinking takes the admins along.

Not yet built, in the order the rulings ask: live revocation in the client (a
paused or unlinked area closes its doors without a deploy; the `area` table is
the row it will watch), the attribution wall (repository, commit and licence
on the entrance wall, from the `area` row), and the fetcher.

### Ruled by Manuel, 2026-09-16

The recommendation stands unless marked **overruled**. Three of the overrulings
widen what strangers can do, and they are the ones to read twice.

- **Build order: the trust layer first**, before any generation. It covers the
  area and area_admin tables, live revocation, the licence gate and the
  admin-only first venue.
- 1 — **Revocation is live, from the database**, as recommended. This is what
  permits SANDBOX-WORLD.md's full generation.
- 2 — **Overruled: any public repository URL may be linked**, not only planted
  trees. The licence gate (7), the admin-only first venue (10) and live
  revocation (1) are therefore the whole defence. None of the three is
  optional.
- 3 — **Overruled: `area` and `area_admin` are built now.** The operator does
  not wait for a second person to have a tree.
- 4 — **Overruled: area admins have full moderation (mute, kick and ban)
  inside their own area.** Section 1.2 worried about an identity hex in a
  public file acting as a bearer name, and the grant in ruling 5 answers it:
  admin status comes from a row the operator writes, not from a file anyone
  can edit. Scope is still load-bearing. A ban issued by an area admin must
  not reach beyond that area, and it must never reach an operator admin.
- 5 — **An `area_admin` row, never `add_admin`**, as recommended.
- 6 — **Sleeping hours, from stage 2**, as recommended.
- 7 — **Licence gate**, as recommended.
- 8 — **Partly overruled: committer names and commit messages may render;
  e-mail addresses never do.**
- 9 — **No source-file furniture by default**, as recommended.
- 10 — **Every new area opens first in an admin-only room**, as recommended.
- 11 — **Takedown**: the Impressum address, 72 hours, stated on the privacy
  page, unlink first and argue afterwards, as recommended.
