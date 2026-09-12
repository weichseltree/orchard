# orchard-tape

`video/tape/1`, the particle tape: what a run recorded, and the only thing a
renderer reads. One writer (`TapeWriter`), one reader (`TapeReader`), numpy
and the standard library, nothing else. spectre, einstruct and phototroph
write tapes; orchard bundles them for the grove.

```python
from orchard_tape import TapeWriter, TapeReader

with TapeWriter("results/tapes/demo", box=(10.0, 10.0, 10.0), n_total=n,
                run_seed=seed, quantize="fp32",
                scalars=(("species", "uint8"),)) as w:
    for step, t, pos, species in frames:
        w.append(step, t, pos, species=species)

r = TapeReader("results/tapes/demo")
r.frame(0)["pos"]        # (n, 3) float32
r.at(1.25)               # interpolated state at physical time 1.25
```

## The format

A tape is a directory, because a file with an index in its header cannot
survive a kill:

| file | written | holds |
|---|---|---|
| `header.json` | once, at open | schema, box, units, periodicity, time origin, channels and their dtypes, quantization, run seed and subset rule, `git`, `env`, `meta` |
| `frames.jsonl` | one line per frame, flushed | `{"i", "step", "t", "n", "off", "len"}` |
| `data.bin` | appended per frame, flushed | the channels back to back in header order, `n` rows each |
| `trailer.json` | at close | frame count, bytes, positions clamped by the uint16 mapping |

A killed writer leaves at worst a torn final index line or a payload that
never reached `data.bin`; the reader drops that frame and keeps every frame
before it. Nothing is ever rewritten in place. The timeline only moves
forward (`append` refuses a step or time that does not increase), a resumed
writer refuses a header that does not match the one on disk, and an integer
channel is lossless or `append` raises. The full statement of each rule, and
the incident behind it, is in the docstrings of
[`src/orchard_tape/tape.py`](src/orchard_tape/tape.py).

The header's `git` field is the commit of the code that PRODUCED the tape:
the repository in the writer's working directory, or whatever the caller
passes as `TapeWriter(git_sha=...)`. It is never this package's own install
location.

## Depending on it

From another repo, by git tag, with uv:

```toml
[project]
dependencies = ["orchard-tape"]

[tool.uv.sources]
orchard-tape = { git = "https://github.com/weichseltree/orchard", subdirectory = "packages/tape", tag = "tape-v1.0.0" }
```

(`dependencies` is the repo's existing list with `"orchard-tape"` added.)
Then `uv sync` and `from orchard_tape import TapeWriter, TapeReader`.
uv resolves `numpy>=1.24` against whatever the repo already pins, and the
package supports Python 3.10 and later.

A script with no project of its own can carry the same pin inline
(PEP 723) and run with `uv run script.py`:

```python
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "numpy",
#   "orchard-tape @ git+https://github.com/weichseltree/orchard@tape-v1.0.0#subdirectory=packages/tape",
# ]
# ///
```

Inside orchard it is a uv workspace member (`orchard-tape = { workspace = true }`
in the root `pyproject.toml`), so orchard always runs the tape code in its own
tree.

## Versions

- **The release is the git tag `tape-vX.Y.Z`**, and `orchard_tape.__version__`
  says which one is installed. A consumer pins a tag, never a branch.
- **The format's version is `SCHEMA`, `"video/tape/1"`**, written into every
  header. It changes only on a breaking change to the bytes: a tape an older
  reader would misread. Adding a header field an older reader ignores is not
  one; changing a channel's layout, the index record or the quantization
  mapping is.
- **A reader keeps reading every schema it ever wrote.** A new schema is added
  beside the old one, not instead of it; tapes on disk outlive the code that
  wrote them.
- Anything that changes the bytes a writer produces for the same inputs is at
  least a minor release and says so in its tag message, even when the schema
  does not move.

## Tests

```sh
uv run pytest packages/tape/tests -q      # from orchard's root
```

`tests/data/golden_fd0f465/` is a tape written by spectre's own copy of this
module; the package must read it and write it again byte for byte
(`tests/test_provenance.py`, and `tests/data/README`).

## Provenance

Extracted from spectre's `core/video/tape.py` at spectre commit **fd0f465**
(`fd0f4652e6aa281a1c279c1706614109c96f39f1`; the file last changed there in
`68239c4`). Its tests are spectre's `tests/test_tape.py`,
`test_tape_channel_shape.py`, `test_tape_t0_origin.py` and the tape half of
`test_adiabatic_and_chunking.py`, adapted to import `orchard_tape` and to drop
what needs spectre's engine or its `tools/migrate_tape_t0.py`. The one
behavioural change from spectre's copy is the `git_sha` argument; the module
docstring says what it does and why the default is unchanged.

AGPL-3.0-or-later, like orchard.
