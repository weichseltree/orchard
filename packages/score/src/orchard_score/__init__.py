"""`orchard/score/1`, the score behind an audio bundle.

Extracted as its own package so LogSwarm and orchard can both pin one
versioned schema by git tag (`docs/specs/PACKAGES.md` §2), the same path
`orchard-tape` already takes. The module docstring of `orchard_score.score`
is the format's description; `README.md` beside `pyproject.toml` says how to
depend on it.

`__version__` is the PACKAGE release (git tag `score-v<version>`). The
FORMAT's version is `SCHEMA`, which changes only on a breaking change to the
bytes, and a reader keeps reading every schema it ever wrote.
"""
from .score import (FIELDS, LIVE_WINDOW, RATE_HZ, SCHEMA, Frame, LiveScoreWriter, NodeState,
                    ScoreIntegrityError, ScoreReader, ScoreWriter)

__version__ = "1.0.0"

__all__ = ["SCHEMA", "RATE_HZ", "FIELDS", "LIVE_WINDOW", "NodeState", "Frame", "ScoreWriter", "LiveScoreWriter",
           "ScoreReader", "ScoreIntegrityError", "__version__"]
