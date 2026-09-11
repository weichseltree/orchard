# Hosting: weichseltree.com, the grove, and what runs where

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
| world state: presence, avatar poses, chat, rooms, exhibits, review queue, rulings, directives, board snapshots | SpacetimeDB cloud (credits), module in `spacetime/` | built for multiplayer state; reducers enforce guest vs admin; SirBase is an outbound-only client |
| static site and WebXR client (`/`, `/grove`) | Cloudflare Pages, `grove/` | free, on the domain already fronted by Cloudflare |
| episode proxies, stills, tapes for walk-inside | Cloudflare R2 | zero egress fees; video egress is the only cost that scales with viewers |
| voice | Cloudflare Realtime TURN + SFU | non-Google TURN; SFU when a room passes ~8 |
| the ledger, the studio, renders | SirBase and Legion, this repo | never exposed; pushes snapshots up, pulls rulings down |
| LLM and TTS calls | SirBase, keys in `~/.config/ptstudio/secrets.env` | metered by expusage.py into the ledger |

The home box makes outbound connections only. No tunnel to expdash, gpurun or
the node API; the node token stays the security boundary it is in `~/.claude/CLAUDE.md`.

## The domain

`weichseltree.com`: Namecheap, registered 2025-01-24, expires 2027-01-24,
Namecheap default nameservers, records pointing at Patreon's custom-domain
front (hence the 302 to patreon.com). Plan:

1. Create a Cloudflare account under your own email (none exists; Patreon's
   Cloudflare is theirs).
2. Add `weichseltree.com` as a zone; Cloudflare shows two nameservers.
3. At Namecheap: Domain > Nameservers > Custom DNS, paste the two. Propagation
   minutes to hours. The Patreon redirect ends; Patreon stays at
   patreon.com/weichseltree and becomes a link on the site.
4. `wrangler login`, then `wrangler pages project create weichseltree`, custom
   domain `weichseltree.com` + `www`.
5. R2 bucket `weichseltree-media`, public via a custom domain `media.weichseltree.com`.

## SpacetimeDB

CLI installed at `~/.local/bin/spacetime` (2.10.0). Published 2026-09-11 to
maincloud as database **`orchard`** (dashboard: https://spacetimedb.com/orchard);
admin bootstrapped with the CLI login identity. Guests get anonymous
identities; admin is an identity allowlist in the module. If the cloud proves
unreachable from the mainland, the same module self-hosts on a small Singapore
VPS.

```
cd spacetime
spacetime login                          # once per machine
spacetime publish orchard                # build + publish (config: spacetime.json, server maincloud)
spacetime call orchard bootstrap_admin   # only succeeds while the allowlist is empty
spacetime sql orchard "SELECT * FROM admin"
```

Reducer names are snake_case on the wire (`bootstrapAdmin` in TypeScript is
`bootstrap_admin` for `spacetime call` and in generated clients).
`spacetime.local.json` is gitignored and must name the database (`orchard`);
the template pre-fills a generated name, which makes `call` misread its
arguments.

## Cost lines the ledger tracks

GCP credit (Gemini; expdash card), ElevenLabs characters (expdash card),
SpacetimeDB credits (manual until an API exists), R2 storage and Class A/B
operations (wrangler), Cloudflare Realtime minutes. Pages and DNS are free.
