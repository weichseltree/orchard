# orchard

A VR-first host for research artefacts, and the fund and studio that feed it.
Research repos register as trees and publish their outputs as bundles that
stream into a headset or onto a phone. The world is a map: a mansion that
defies physics, with portals between rooms and between orchards, lit by baked
ray-traced light. Anyone can fork it, run a node, link it to others, and fund
a tree in kind by hosting its trusted code for rendering and preprocessing.
[docs/PLATFORM.md](docs/PLATFORM.md) is the direction; the first mansion is
one hall, one room, one tape and one video.

The first orchard is [weichseltree](https://github.com/weichseltree)'s, at
weichseltree.com. Its trees are particle simulations, point-cloud mathematics
and emergence; its harvest is a YouTube series and the rooms of the mansion.
Capital is GPU-lane time, cpu-lane time, queue position, API quota and disk.

The name: weichseltree is a tree. An orchard is many trees under one
management, watered on purpose, pruned on evidence, harvested when ripe.

## Why this exists

Between 2026-08-11 and 2026-09-11 three repos each built half a studio and
none shipped a watchable episode. spectre delivered a 43 s excerpt with no
audio stream. einstruct delivered a 4:30 animatic with about 100 s of silence
and a narrator chosen by a random draw. phototroph built an 18,000-line studio
with a React editor and rendered zero seconds of its spine, because one
path-traced episode was costed at 58 GPU-days. Over the same month the two
boxes ran about 1,400 lane-hours, 11 percent of them on video, queue waiting
exceeded running six to one, and research jobs aborted 43 percent of the time.
The audit behind those numbers is operator-private (`notes/`).

The videos felt like a repo history because they were one: episodes in
experiment order, storyboards doubling as lab notebooks, narration saying
"registered" and "P1", mechanism before wonder, shot-level gates passing while
the episode failed. [docs/LAWS.md](docs/LAWS.md) is the standing answer.

## The model

**The fund** buys episode theses, not repos. A thesis is one viewer question,
one measured number and one picture. It moves through stages that are the
term sheet: `scouted → planted → thesis → styleframe → animatic → greenlit →
rendering → mastered → published → exhibited`. Capital for expensive renders
unlocks only past `greenlit`, after the render was costed from measured
coefficients. Every tree carries a kill criterion.

**The studio** owns storyboards, narration, rendering budgets, finishing and
review. One storyboard schema with a concept ledger, narration as data whose
durations come from measured takes, machine checks that read like an editor
(vocabulary chain, banned words, silence per shot, episode-scale contact
sheet), renderer plugins behind spectre's tape format, and channel-wide
finishing: palette, ident, music, titles, thumbnails, one voice.

**The greenhouse** is where you rule: a flat dashboard while you work and an
admin room in the grove. Rulings become law that every portfolio session reads.

**The grove** is public: each tree hangs its approved harvest in its room,
visitors join from a link with no login, hear each other spatially, and can
walk inside the tape of the simulation an episode is about. Linked orchards
appear as portals in the hall.

## Layout

```
orchard/            python: manifest schema, portfolio, ledger, scout, cli, flat dashboard
trees/<name>.yaml   the fund's copy of each tree manifest (canonical: <repo>/orchard.yaml)
docs/               PLATFORM (direction), LAWS (studio law), HOSTING, DECISIONS
notes/              operator-private, gitignored: audits of private repos and sessions
studio/             storyboard schema and checks (extracted from phototroph's ptstudio next)
grove/              WebXR client, Cloudflare Pages
spacetime/          SpacetimeDB module: presence, rooms, exhibits, review queue, rulings, directives
results/            gitignored outputs
```

## Use

```
uv sync
uv run orchard doctor            # what is wired up
uv run orchard scout [repo...]   # draft trees/<name>.yaml from a repo
uv run orchard plant <name>      # write orchard.yaml into the repo: registration
uv run orchard board             # the portfolio, with 30-day spend per tree
uv run orchard ledger [--json]   # capital spent and left, from ~/.exp_status and expdash
uv run orchard serve             # flat dashboard on http://127.0.0.1:8787
```

The ledger reads `~/.exp_status/**/*.json`, `.api_usage.jsonl` and
`http://localhost:8686/api/status`. It never writes. Lane rules, priorities and
the two-box discipline are in `~/.claude/CLAUDE.md` and `~/expdash/README.md`
and apply unchanged to every render the studio launches.

## Hosting

SpacetimeDB for world state, Cloudflare for site, media and voice, no Google
endpoints in the client so mainland China is not locked out. The home box only
ever connects outward. [docs/HOSTING.md](docs/HOSTING.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
