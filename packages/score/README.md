# orchard-score

`orchard/score/1`: the versioned, fixed-rate stream of per-node state behind
an `audio` bundle -- rate, burstiness, template entropy, fan-out, anomaly
z-score, health (`docs/specs/AUDIO-STREAM.md` §4). One writer
(`ScoreWriter`), one reader (`ScoreReader`), the standard library, nothing
else. LogSwarm produces scores; orchard bundles them
(`orchard.bundle.bundle_audio`).

```python
from orchard_score import ScoreWriter, ScoreReader, NodeState

with ScoreWriter("score.json", provider="logswarm", run_seed=7) as w:
    w.append(0, 0.0, {"api": NodeState(rate=1.0, burstiness=0.1,
                                       template_entropy=0.5, fan_out=2,
                                       anomaly_z=0.0, health=1.0)})

r = ScoreReader("score.json")
r.value_at(0, "api", "rate")   # 1.0 -- what a spoken line names (LAWS 24)
```

## The format

A score is one JSON document, not JSONL: it is archived whole beside its
`audio` bundle, never read while still being written the way a tape is
(`orchard_tape`) is. It carries `schema`, `rate_hz`, `provider`, `run_seed`,
the fixed `fields` list and every recorded `frames[]` entry
(`{"index", "t", "nodes": {node_id: {field: value, ...}}}`). A frame's index
only moves forward, the same rule the tape's `t` and `step` follow.

## Why a number may be spoken

- **LAWS 24** -- a spoken number names the command and file that produced
  it. Here it names a field and a frame index of a named score
  (`ScoreReader.value_at`), and the gate can run mechanically before a take
  is recorded.
- **LAWS 5** -- field names (`rate`, `fan_out`, ...) are internal; the
  narration line is written against the *value*, and the banned-word gate
  runs on that line, not on a field name.
- **LAWS 17** -- `ScoreReader.silence_share` measures the near-silent share
  of a run's frames, what the 20%-per-60s budget is checked against.

## Depending on it

From another repo, by git tag, with uv:

```toml
[project]
dependencies = ["orchard-score"]

[tool.uv.sources]
orchard-score = { git = "https://github.com/weichseltree/orchard", subdirectory = "packages/score", tag = "score-v1.0.0" }
```

Inside orchard it is a uv workspace member
(`orchard-score = { workspace = true }` in the root `pyproject.toml`).

## Versions

- **The release is the git tag `score-vX.Y.Z`**, and
  `orchard_score.__version__` says which one is installed.
- **The format's version is `SCHEMA`, `"orchard/score/1"`.** It changes only
  on a breaking change to the bytes; a reader keeps reading every schema it
  ever wrote. A field is added beside the others, not instead of one.

## Tests

```sh
uv run pytest packages/score/tests -q      # from orchard's root
```

AGPL-3.0-or-later, like orchard.
