# Security: who can do what, and what stops them

Written 2026-09-12, when the grove went from "anyone can script anything" to
the rules below. The code is the authority: `spacetime/spacetimedb/src/index.ts`
for the world, `grove/auth/issuer.ts` for the token service,
`orchard/dashboard/app.py` for the local dashboard. `grove/scripts/module-check.ts`
checks every rule here against a local server; run it after touching the module.

## The pieces and their boundaries

| piece | who can reach it | what guards it |
|---|---|---|
| the site and the grove client (Cloudflare Pages) | everyone | a strict Content-Security-Policy: code only from the site (plus Turnstile), data only from R2 and SpacetimeDB; `'unsafe-eval'` is the one hole, forced by the SpacetimeDB SDK (BACKLOG 11) |
| the token service, `/auth/*` (a Pages Function) | everyone | Turnstile, when its secret is set; same-origin only; it stores nothing |
| the world database, `orchard` on maincloud | everyone with a websocket | the module's reducers, views and the token gate; see below |
| bundles on R2, media.weichseltree.com | everyone | content-addressed and public by design; only approved bundles are hung |
| the home box (SirBase): studio, ledger, dashboard, sync timer | nobody from outside | it only connects outward; the dashboard answers to localhost by name only |

## Kinds of people

- **Visitor.** No login. The grove asks the token service for a token (a
  random identity, 30 days, renewed while they keep coming). They can walk
  into public rooms, move, chat, and report someone. They see the people,
  poses and chat of the room they stand in, and nothing else.
- **Host (admin).** An identity on the private `admin` list. `init` puts the
  publisher there, so there is never a moment when the list is empty and a
  visitor could claim it (the old `bootstrap_admin` did exactly that after a
  `--delete-data` republish). Today that is the `spacetime` CLI login on
  SirBase, which the sync timer and the dashboard use. Hosts pass the token
  gate with any token, get into full rooms and admin-only rooms, cannot be
  banned (remove them from the list first), and carry a green "host" name tag
  that no visitor can fake by picking a name. Since 2026-09-12 the list also
  holds Manuel's browser (`0xc200b5df…0501`, added with `add_admin`): an
  identity from a grove token, so it lasts as long as that browser keeps its
  site data. A new one is added the same way (`grove.presence.identityHex`
  in the console, then `spacetime call orchard add_admin '"0x…"'`).
- **Not built:** moderators short of admin, tree owners, node operators with
  portable identities (PLATFORM.md), a host in the browser (BACKLOG 8).

## Bots and abuse: the rules the module enforces

| rule | number | where |
|---|---|---|
| people per network online at once (IPv4 address, IPv6 /64), from the token's `ipk` | 8 | `join` |
| people per room | the room's `capacity` (24, greenhouse 4) | `join` |
| poses | 20 a second sustained, bursts of 10; others never see the excess | `move` |
| a pose must be finite and inside a ±500 m box, 50 m down to 100 m up | | `move` |
| joins, which are also renames | bursts of 10, then one every 2 s | `join` |
| chat | one line per 0.7 s, 280 characters, no control or invisible formatting characters | `say` |
| reports | one per 30 s per visitor; carries the subject's last five lines of chat in that room | `report_visitor` |
| kick | out now, and a 10-minute ban | `kick` |
| ban | for N minutes or for good; optionally the whole network | `ban_visitor`, `unban` |
| the gate | with `auth.required` on, only tokens from the listed token services get in | `onConnect`, `set_auth` |

What makes the per-person numbers mean something is that identities now cost
something. Without the gate, a script can open a fresh anonymous identity per
connection and every per-identity limit is per-connection. With it, every
identity comes from the token service, the token names the visitor's network
by a keyed hash, and the module counts and bans by that hash. Turnstile makes
each new token cost a human check. A determined attacker with many networks
still gets in, a few at a time; that is the honest limit of a no-login space.

The home box never sees addresses and the database never stores them: the
token service turns the network into an HMAC under `AUTH_NETWORK_KEY`, which
lives only in Pages secrets and the home box's secrets file.

## Privacy and retention

`grove/public/privacy/index.html` (weichseltree.com/privacy/) is the visitor-facing
version. `sweep`, every ten minutes: chat after 24 hours, reports after 90
days, a visitor's row 30 days after they were last seen (with their guest and
throttle rows), bans when they end, connections the server never saw close
after a day. The owner reads the private tables directly; nobody else can.

## Running it

    the grove itself                     # hosts: "N here" lists everyone with Mute, Kick and Ban
    uv run orchard serve                 # the dashboard: people, reports, bans, the gate
    uv run orchard auth status           # what the live token service answers, and the gate
    uv run orchard auth gate on|off      # turn anonymous visitors away, or let them in

Turning the token service on, once (order matters):

1. `uv run orchard auth keygen --write` puts `AUTH_SIGNING_KEY` and
   `AUTH_NETWORK_KEY` into the secrets file.
2. `uv run orchard auth turnstile` creates the widget (managed mode, the
   domains weichseltree.com, www.weichseltree.com and weichseltree.pages.dev)
   and puts `TURNSTILE_SITEKEY` and `TURNSTILE_SECRET` into the secrets file.
3. `uv run orchard auth push`, then deploy the grove as always
   (`set -a; . ~/.config/orchard/secrets.env; set +a; pnpm run deploy`). The
   build takes the site key from that environment, so a client with the human
   check and a service that demands it go out together. Steps 1 to 3 write
   secrets, so they are yours to run or to approve explicitly.
4. `uv run orchard auth status` should say the discovery document and one key
   are served and that a token without a human check is refused (403).
5. Open the grove, check the HUD says connected, then `orchard auth gate on`.
   If the grove cannot connect once tokens flow, check that SpacetimeDB can
   fetch `/auth/jwks.json`: Cloudflare's signature check refuses some user
   agents with error 1010 (Python's default is one; SpacetimeDB's Rust
   client and curl pass, measured 2026-09-12). A WAF skip rule for `/auth/*`
   is the fix if it ever bites.

Until step 3 the token service answers 503 and the grove keeps its anonymous
identities, so the rest of the rules still hold except the per-network ones.

State on 2026-09-12: all five steps done, the gate is on. Only the grove's
tokens get in; the home box's CLI login passes as admin. Automated browsers
are shown Turnstile's checkbox and cannot pass it, so they render the world
but never join presence; test presence locally instead.

Rotating: a new `AUTH_SIGNING_KEY` makes every visitor a new identity once
(their old tokens cannot be renewed); a new `AUTH_NETWORK_KEY` forgets every
network ban. Remove the old line from the secrets file, run keygen and push,
redeploy.

## What is still open

- **Voice** needs the same token service to mint Cloudflare Realtime session
  tokens; the Realtime secret must never reach the browser.
- **The Impressum** is at /impressum/ (Weichseltree OÜ, registry code
  17482992, from the Estonian Business Register on 2026-09-12). Keep it in
  step with the register when the address, the board or the VAT status
  change.
- **Upstream `'unsafe-eval'`** (BACKLOG 11).
