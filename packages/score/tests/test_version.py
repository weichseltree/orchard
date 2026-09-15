"""The release number is written twice; they must agree.

Mirrors packages/tape/tests/test_version.py.
"""
import importlib.metadata
import sys
from pathlib import Path

import orchard_score

if sys.version_info >= (3, 11):
    import tomllib
else:                                                    # pragma: no cover
    tomllib = None


def test_the_installed_metadata_matches___version__():
    assert importlib.metadata.version("orchard-score") == orchard_score.__version__


def test_pyproject_matches___version__():
    if tomllib is None:
        return
    doc = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text())
    assert doc["project"]["version"] == orchard_score.__version__


def test_the_format_version_is_not_the_package_version():
    """`SCHEMA` moves only on a breaking change to the bytes; the package moves
    on every release. Conflating them would bump the format on a bug fix."""
    assert orchard_score.SCHEMA == "orchard/score/1"
