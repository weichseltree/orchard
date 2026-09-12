"""The release number is written twice; they must agree.

`pyproject.toml` carries it for the installer and `__version__` for anyone
recording which writer produced a file (orchard's bundle does). A release that
bumps one and not the other reports a version that was never tagged.
"""
import importlib.metadata
import sys
from pathlib import Path

import orchard_tape

if sys.version_info >= (3, 11):
    import tomllib
else:                                                    # pragma: no cover
    tomllib = None


def test_the_installed_metadata_matches___version__():
    assert importlib.metadata.version("orchard-tape") == orchard_tape.__version__


def test_pyproject_matches___version__():
    if tomllib is None:
        return
    doc = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text())
    assert doc["project"]["version"] == orchard_tape.__version__


def test_the_format_version_is_not_the_package_version():
    """`SCHEMA` moves only on a breaking change to the bytes; the package moves
    on every release. Conflating them would bump the format on a bug fix."""
    assert orchard_tape.SCHEMA == "video/tape/1"
