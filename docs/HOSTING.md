# Hosting: weichseltree.com, the Mind Palace, and what runs where

Decided 2026-09-11. Stack: **SpacetimeDB for world state, Cloudflare for
delivery, no Supabase, no Google endpoints in the client.** GCP stays for
server-side API calls from SirBase only (Gemini credits).

## Why not the someotherlife stack

someotherlife locked in Firebase and GCP. Firebase Hosting, Firestore, Firebase
Auth and Google Fonts are blocked in mainland China, and one of the grove's
requirements is that visitors there can join. Cloudflare, AWS-hosted services
and SpacetimeDB's cloud are not blocked as a class. Nothing without an ICP
licence is fast from the mainland, but reachable is the bar. YouTube is blocked
too, so in-world proxies of episodes are self-hosted. Voice needs a non-Google
TURN server or mainland visitors join mute. **None of this was probed from
here**; test from a mainland vantage point before launch.

## What runs where

| piece | where | why |
|---|---|---|
| world state: presence, avatar poses, chat, rooms, exhibits, review queue, rulings, directives, board snapshots, bans, reports | SpacetimeDB cloud (credits), module in `spacetime/` | built for multiplayer state; reducers enforce guest vs admin, views scope people to a room ([SECURITY.md](SECURITY.md)); SirBase is an outbound-only client |
| static site and WebXR client (`/`, `/mind`, `/privacy`) | Cloudflare Pages, `grove/` | free, on the domain already fronted by Cloudflare; `/grove` permanently redirects to `/mind` |
| the token service (`/auth`): Turnstile, then a signed token per visitor | a Pages Function in the same project, `grove/functions/auth` | no login and no server of ours; SpacetimeDB checks its tokens against the keys it publishes |
| episode proxies, stills, tapes for walk-inside | Cloudflare R2 | zero egress fees; video egress is the only cost that scales with viewers |
| voice | Cloudflare Realtime TURN + SFU | non-Google TURN; SFU when a room passes ~8 |
| the ledger, the studio, renders | SirBase and Legion, this repo | never exposed; pushes snapshots up, pulls rulings down |
| LLM and TTS calls | SirBase, keys in `~/.config/ptstudio/secrets.env` | metered by expusage.py into the ledger |

The home box makes outbound connections only. No tunnel to expdash, gpurun or
the node API; the node token stays the security boundary it is in `~/.claude/CLAUDE.md`.

## Secrets

One file outside the repo, `~/.config/orchard/secrets.env` (mode 600; override
with `$ORCHARD_SECRETS`), one line per variable; `services.yaml` says which
variables each service needs and `orchard doctor` reports presence by name.
The token service's own secrets (`AUTH_SIGNING_KEY`, `AUTH_NETWORK_KEY`,
`TURNSTILE_SECRET`) live there too and are copied into Pages secrets by
`orchard auth push`; SECURITY.md has the order. The `spacetime` CLI's token,
which is the database's admin, is in `~/.config/spacetime/cli.toml`: keep it
mode 600.
The legacy `~/.config/ptstudio/secrets.env` is still read as a fallback because
spectre, phototroph and expdash's usage cards point at it.

## Cloudflare access

An API token, not the global key, stored as `CLOUDFLARE_API_TOKEN` with
`CLOUDFLARE_ACCOUNT_ID` (dashboard: Workers & Pages overview, right column).

**Split it (2026-09-12).** One token that can edit DNS on every zone and
deploy Workers, in a file on a box where many agent sessions run, costs
everything if it leaks. The code now reads three, each falling back to
`CLOUDFLARE_API_TOKEN` until it exists:

| variable | used by | permissions |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | `pnpm run deploy`, `orchard auth push` (wrangler) | Account: Cloudflare Pages Edit; User: User Details Read |
| `CLOUDFLARE_R2_TOKEN` | `orchard push`, `orchard exhibit hang` | Account: Workers R2 Storage Edit |
| `CLOUDFLARE_ADMIN_TOKEN` | `orchard r2 ensure`, and by hand: DNS, Turnstile, Realtime | the full list below; better not kept in the file at all, but created when needed with a short TTL |

Create each at dash.cloudflare.com > My Profile > API Tokens > Create Token >
Custom token; delete the old all-in-one token once the three work. The full
list, for the admin token:

| scope | permission | level |
|---|---|---|
| Account | Cloudflare Pages | Edit |
| Account | Workers R2 Storage | Edit |
| Account | Workers Scripts | Edit |
| Account | Account Settings | Read |
| Account | Calls | Edit |
| Zone | Zone | Edit |
| Zone | DNS | Edit |
| Zone | Zone Settings | Edit |
| User | User Details | Read |

Account resources: the one account. Zone resources: all zones from the account
(the zone does not exist until it is created). No IP filter; a TTL of a year is
fine, the file is local. wrangler reads the token from the environment, and
the ledger will use the same token for R2 usage.

## The domain

`weichseltree.com`: Namecheap, registered 2025-01-24, expires 2027-01-24,
Namecheap default nameservers, records pointing at Patreon's custom-domain
front (hence the 302 to patreon.com). Plan:

Done 2026-09-12 over the API with the token: zone `weichseltree.com` created
(status pending), Pages project `weichseltree` created and a holding page
deployed from `grove/public/` (https://weichseltree.pages.dev), custom domains
`weichseltree.com` and `www` attached, proxied CNAMEs to
`weichseltree.pages.dev` in the zone. Cloudflare's nameservers for the zone:

    clark.ns.cloudflare.com
    susan.ns.cloudflare.com

Nameservers switched 2026-09-12; the zone is active and
`https://www.weichseltree.com` serves the grove.

**The apex is still Patreon's for now.** `weichseltree.com` remains registered
as Patreon's *custom hostname* on Cloudflare for SaaS, and on Cloudflare's
edge a SaaS custom hostname takes precedence over the zone owner's own
record. So the bare domain still 302s to Patreon while `www` works, and the
Pages custom domain for the apex shows `deactivated` / certificate error.
Fix: remove the custom domain in Patreon's creator settings (only Manuel
can); Cloudflare also retires a SaaS hostname whose DNS no longer points at
the SaaS zone, but that takes days. Afterwards re-validate with
`PATCH /accounts/{acct}/pages/projects/weichseltree/domains/weichseltree.com`
(already done once, 2026-09-12; it stays `initializing` until the release).

Left to do:

1. **In Patreon** (only you can): remove the custom domain `weichseltree.com`.
2. Redeploy: `wrangler pages deploy ./grove/public --project-name weichseltree
   --branch main` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the
   environment (`set -a; . ~/.config/orchard/secrets.env; set +a`).
3. ~~R2 bucket `weichseltree-media`, public via `media.weichseltree.com`, when the
   first bundle exists (M0).~~ Done 2026-09-12: Manuel purchased R2 in the
   dashboard (the API cannot accept the terms), then `uv run orchard r2 ensure`
   created the bucket, the CORS list (both production origins, the
   `*.weichseltree.pages.dev` wildcard, which the API accepted, and the two
   localhost ports) and attached the custom domain. The REST API answers 405
   to HEAD on objects, so `push` reads every object back to verify it.
   The WSL resolver on SirBase may cache the new name negatively for a
   while; public DNS was right within minutes.

## SpacetimeDB

CLI installed at `~/.local/bin/spacetime` (2.10.0). Published 2026-09-11 to
maincloud as database **`orchard`** (dashboard: https://spacetimedb.com/orchard);
admin bootstrapped with the CLI login identity. Guests get their identity
from the grove's token service (anonymous SpacetimeDB identities until it
has keys); admin is an identity allowlist in the module. If the cloud proves
unreachable from the mainland, the same module self-hosts on a small Singapore
VPS.

```
cd spacetime
spacetime login                          # once per machine
spacetime publish orchard                # build + publish (config: spacetime.json, server maincloud)
spacetime sql orchard "SELECT * FROM admin"
```

A new or wiped database makes its publisher admin in `init`; the old
`bootstrap_admin` reducer (first caller wins) is gone. Before publishing a
module change, run `grove/scripts/module-check.ts` against a local server
and publish the new module over a copy of the old one there first: an
upgrade that would need `--delete-data` would take the rulings with it.

Reducer names are snake_case on the wire (`banVisitor` in TypeScript is
`ban_visitor` for `spacetime call` and in generated clients).
`spacetime.local.json` is gitignored and must name the database (`orchard`);
the template pre-fills a generated name, which makes `call` misread its
arguments.

## Cost lines the ledger tracks

GCP credit (Gemini; expdash card), ElevenLabs characters (expdash card),
SpacetimeDB credits (manual until an API exists), R2 storage and Class A/B
operations (wrangler), Cloudflare Realtime minutes. Pages and DNS are free.
