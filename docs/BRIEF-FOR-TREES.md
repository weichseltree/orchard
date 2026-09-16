# Brief for a tree: what the orchard wants from your repo

Read this from a session inside one of the research repos (einstruct,
spectre, world-engine, premosaic, mosaic, phototroph, event-atoms, points,
HNL, agivity, lumina-consensus). It says what the orchard is, what it can
already show, what it takes from you, and what to answer.

## What the orchard is, in three lines

A public VR world at https://weichseltree.com/mind/ (desktop, Quest browser,
phone): a hall and one room per tree, baked light, presence. A fund that buys
episode theses (one viewer question, one measured number, one picture) for the
weichseltree channel, and a studio that finishes them. Your repo is a tree;
what it can show is its harvest. README.md and docs/PLATFORM.md in
`~/weichseltree/orchard` are the long form; docs/LAWS.md is the studio law
every artefact is judged by.

## What the grove can show today

| kind | what it is | how it reaches the grove |
|---|---|---|
| `tape` | a particle tape in spectre's `video/tape/1` format (a directory with `header.json`, `data.bin`); the visitor stands inside it and scrubs time | `orchard harvest` writes a chunked bundle (4,000 slots, three device tiers) |
| `clip`, `master` | an mp4; a clip is a shot or excerpt, a master a finished episode | an HLS ladder (360p/720p/1080p) on a video wall |
| `still` | a PNG or JPEG: a styleframe, a figure, a poster | AVIF + JPEG at three widths, on the hall's poster wall |

Everything is content-addressed, served from R2 at `media.weichseltree.com`,
and carries provenance: the command that made it, the commit, the source hash,
and a stock sidecar (`<file>.json`) when the source was lifted or generated.

Not yet: splats, audio-only, live instruments, portals. Say if you have them.

## What the orchard already knows about you

`~/weichseltree/orchard/trees/<repo>.yaml` is the fund's draft of your
manifest, written by `orchard scout` from your README and the lane ledger. Two
trees (einstruct, spectre) have been harvested and einstruct's tape and clip
hang in the grove. The others are drafts with empty fields on purpose.

The manifest (`orchard/manifest.py`) is the whole contract:

- `question`: the one sentence your repo asks a viewer.
- `phenomena`: things you can already show, each with a `hook` (the sentence
  that makes a viewer lean in) and `evidence` (a path a reviewer can open).
- `artefacts`: files that exist now, with `kind`, `path` (relative to your
  repo), `title`, `produced_by` (the exact command).
- `producers`: the commands the studio may run in your repo to make more
  (`tape`, `render`, `figure`), the lane they need (`cpu`/`gpu`/`none`).
- `theses`: what the fund would buy: question, number, picture, the phenomena
  it uses, its stage, what blocks it.
- `budget`: what you would need this round (GPU hours, CPU hours, TTS
  characters, LLM dollars, disk); zero means "ask".
- `kill`: the criterion that prunes the tree. Every tree has one.

## What to answer, from your repo

Write it into your manifest and say it in prose. Concretely:

1. **What can you show this week without a render?** Existing tapes, clips,
   stills. Each becomes an artefact row. If a tape is not in `video/tape/1`,
   say what it is in; the tape writer in spectre `core/video/tape` is the
   reference and einstruct already imports it.
2. **Which of your ideas is a mechanism of the mansion, not just an exhibit?**
   docs/PLATFORM.md lists the guesses (world-engine's lenses as portals,
   premosaic's tessellation as level of detail, someotherlife's splats). Correct
   them.
3. **One thesis**, in the manifest's shape: the viewer question, the one
   number you would measure, the one picture. Its `stage` (`thesis`,
   `styleframe`, `animatic`) and what blocks it.
4. **What you need**: lane hours by kind, disk, API quota, and what you would
   run on a second node if one hosted your pinned code (docs/PLATFORM.md,
   "funding in kind").
5. **What the grove could look like for your tree.** A room per tree; the
   hall is a baked palace-to-be with an orchard outside its windows planned.
   If your repo produces geometry, light, or a way of seeing, say how it would
   change the building.

## The mechanics, when you are ready

```
cd ~/weichseltree/orchard
uv run orchard scout ~/weichseltree/<repo> --force   # redraft from the repo (optional)
$EDITOR trees/<repo>.yaml                             # or write <repo>/orchard.yaml yourself
uv run orchard plant <repo>                           # copies the manifest into <repo>/orchard.yaml; the repo's copy is canonical from then on
uv run orchard harvest <repo> --dry-run               # what would be bundled
uv run orchard harvest <repo>                         # bundle it; ids are written back into the manifest
uv run orchard board                                  # bundled/approved per tree
```

Hanging in the grove is a ruling (LAWS 22): Manuel runs
`orchard exhibit hang results/bundles/<id> --approve`, or approves the artefact
in the manifest and the sync timer carries it. A review item for a styleframe
or animatic goes through the flat dashboard (`uv run orchard serve`,
http://127.0.0.1:8787); rulings flow back into your thesis's stage every 15
minutes.

## Rules that reach into your repo

- Every GPU, render, or long-running local job goes through
  `exp run <name> --prio <n> --lane gpu|cpu -- ...`; never set `GPU_LOCK`
  or call old `gpurun` / `exprun` wrappers directly. The manifest's
  `budget.prio_cap` is the highest priority you may stamp without a ruling.
- Outputs on disk under `results/`, never `/tmp`.
- Simulation footage is never interpolated, upscaled or generated (LAWS 9);
  stock only with a provenance sidecar.
- Repo-speak never reaches narration (LAWS 5): no "registered", "card", "P1",
  seeds, experiment ids.
- Stills gate long renders (LAWS 14): render options as PNG, get a ruling,
  then spend the lane.
