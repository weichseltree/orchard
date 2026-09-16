"""Every hanging in mansion.json hangs through the ruling and take-down machinery.

Issue #20: two planet hangings pinned a bundle id with no exhibit ref and no
artefact record, so nothing could take them down or say who approved them.
Now every bundle a hanging shows must name an exhibit (tree, kind, bundle) and
be named by an approved artefact, with its digest, in the fund's copy of that
tree's manifest (trees/<name>.yaml, the mirror of the repo's orchard.yaml).
The copies are read as plain YAML, not through the portfolio: a manifest the
portfolio refuses for its producers (a legacy launcher) still records what
hangs, and the check must hold on CI where no repo is on disk.
"""
import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
MANSION = ROOT / "grove" / "src" / "world" / "mansion.json"
TREES = ROOT / "trees"

#: Which artefact kinds a hanging of each kind may show (grove/src/world/exhibits.ts).
KINDS_FOR = {"tape": {"tape"}, "video": {"clip", "master"}, "still": {"still"}, "planet": {"planet"}}


def hangings():
    doc = json.loads(MANSION.read_text())
    for room in doc["rooms"]:
        for h in room["hangings"]:
            if h.get("bundle"):
                yield room["id"], h


def artefacts_by_bundle():
    out = {}
    for path in sorted(TREES.glob("*.yaml")):
        tree = yaml.safe_load(path.read_text())
        for art in tree.get("artefacts") or []:
            if art.get("bundle"):
                out[art["bundle"]] = (tree["name"], art)
    return out


def test_every_hanging_names_an_exhibit_and_pins_its_bundle():
    for room, h in hangings():
        ref = h["bundle"].get("exhibit")
        assert ref, f"{room}/{h['id']} pins a bundle with no exhibit ref"
        assert ref["kind"] == h["kind"], f"{room}/{h['id']}: exhibit kind {ref['kind']} for a {h['kind']} hanging"
        # An exhibit ref may take the tree's latest row of its kind; one that names a bundle pins the same one.
        if ref.get("bundle"):
            assert ref["bundle"] == h["bundle"].get("id"), f"{room}/{h['id']}: the pinned id and the exhibit's bundle differ"


def test_every_hung_bundle_is_an_approved_artefact_with_a_digest():
    arts = artefacts_by_bundle()
    for room, h in hangings():
        bundle = h["bundle"]["id"]
        assert bundle in arts, f"{room}/{h['id']}: no tree manifest names bundle {bundle}"
        tree, art = arts[bundle]
        assert tree == h["bundle"]["exhibit"]["tree"], f"{room}/{h['id']}: bundle {bundle} belongs to {tree}"
        assert art.get("approved") is True, f"{room}/{h['id']}: {tree}'s {art['path']} is not approved"
        assert art.get("sha256"), f"{room}/{h['id']}: {tree}'s {art['path']} carries no digest"
        assert art["kind"] in KINDS_FOR[h["kind"]], f"{room}/{h['id']}: a {art['kind']} artefact on a {h['kind']} hanging"
