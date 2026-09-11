"""orchard: a fund and a studio for the weichseltree research repos.

Trees are research repos. Capital is GPU-lane time, cpu-lane time, queue
position, API quota and disk. The harvest is an episode on the weichseltree
channel and an exhibit in the grove. See README.md.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TREES = ROOT / "trees"
RESULTS = ROOT / "results"
WEICHSELTREE = Path.home() / "weichseltree"
EXP_STATUS = Path.home() / ".exp_status"
EXPDASH_URL = "http://localhost:8686"
