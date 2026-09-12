"""`video/tape/1`, the particle tape: one writer, one reader, every repo.

The format and its only implementation, extracted from spectre's
`core/video/tape.py` so that spectre, einstruct, phototroph and orchard depend
on one tagged release instead of putting spectre's working tree on
`sys.path`. The module docstring of `orchard_tape.tape` is the format's
description; `README.md` beside `pyproject.toml` says how to depend on it.

`__version__` is the PACKAGE release (git tag `tape-v<version>`). The FORMAT's
version is `SCHEMA`, which changes only on a breaking change to the bytes, and
a reader keeps reading every schema it ever wrote.
"""
from .tape import (SCHEMA, Channel, TapeIntegrityError, TapeReader, TapeWriter,
                   subset_indices)

__version__ = "1.0.0"

__all__ = ["SCHEMA", "TapeWriter", "TapeReader", "subset_indices",
           "TapeIntegrityError", "Channel", "__version__"]
