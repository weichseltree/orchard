"""The two manifest copies: the repo's orchard.yaml is canonical, trees/<name>.yaml its mirror."""
import pytest
import yaml

import orchard.portfolio as P
from orchard.manifest import Stage, load


@pytest.fixture
def fund(tmp_path, monkeypatch):
    """Two repos under a private ~/weichseltree: `planted` carries orchard.yaml, `draft` not."""
    home = tmp_path / "weichseltree"
    trees = tmp_path / "trees"; trees.mkdir()
    monkeypatch.setattr(P, "TREES", trees)
    monkeypatch.setattr(P, "WEICHSELTREE", home)
    for name, planted in (("planted", True), ("draft", False)):
        repo = home / name; repo.mkdir(parents=True)
        doc = {"name": name, "path": str(repo), "question": f"{name}?",
               "artefacts": [{"kind": "still", "path": "results/a.png", "title": "a"}],
               "theses": [{"id": "t1", "question": "q", "stage": "thesis"}]}
        (trees / f"{name}.yaml").write_text(yaml.safe_dump(doc) + "notes: the fund's old copy\n")
        if planted:
            (repo / "orchard.yaml").write_text(yaml.safe_dump(doc))
    return home, trees


def test_saving_a_planted_tree_writes_the_repo_and_mirrors_it(fund):
    home, trees = fund
    tree = P.get("planted")
    tree.artefacts[0].approved = True
    assert P.save(tree) == home / "planted/orchard.yaml"
    canonical = (home / "planted/orchard.yaml").read_bytes()
    mirror = (trees / "planted.yaml").read_bytes()
    header = f"# generated from {home / 'planted/orchard.yaml'} — edit that file, not this one\n"
    assert mirror == header.encode() + canonical
    # the comment is a comment: the mirror loads as the same tree
    assert load(trees / "planted.yaml") == load(home / "planted/orchard.yaml")
    assert load(trees / "planted.yaml").artefacts[0].approved


def test_a_tree_without_orchard_yaml_is_written_in_the_fund_as_before(fund):
    home, trees = fund
    tree = P.get("draft")
    tree.potential = 7
    assert P.save(tree) == trees / "draft.yaml"
    text = (trees / "draft.yaml").read_text()
    assert not text.startswith("# generated") and load(trees / "draft.yaml").potential == 7
    assert not (home / "draft/orchard.yaml").exists()


def test_refresh_regenerates_fund_copies_and_says_which_changed(fund):
    home, trees = fund
    (trees / "gone.yaml").write_text(yaml.safe_dump(
        {"name": "gone", "path": str(home / "not-cloned-here"), "question": "?"}))
    rows = {r["tree"]: r["status"] for r in P.refresh()}
    assert rows == {"draft": "no orchard.yaml", "gone": "no repo", "planted": "changed"}
    assert (trees / "planted.yaml").read_text().startswith("# generated from ")
    assert "the fund's old copy" not in (trees / "planted.yaml").read_text()
    assert {r["tree"]: r["status"] for r in P.refresh(["planted"])} == {"planted": "unchanged"}


def test_a_broken_canonical_copy_is_never_mirrored(fund):
    home, trees = fund
    before = (trees / "planted.yaml").read_bytes()
    (home / "planted/orchard.yaml").write_text("name: planted\nquestion: 'torn\n")
    [row] = P.refresh(["planted"])
    assert row["status"].startswith("unreadable") and (trees / "planted.yaml").read_bytes() == before


def test_refresh_by_name_creates_a_missing_fund_copy(fund):
    home, trees = fund
    repo = home / "newcomer"; repo.mkdir()
    (repo / "orchard.yaml").write_text(yaml.safe_dump(
        {"name": "newcomer", "path": str(repo), "question": "new?"}))
    assert P.refresh(["newcomer"])[0]["status"] == "changed"
    assert load(trees / "newcomer.yaml").question == "new?"


def test_sync_rulings_and_exhibit_approve_keep_both_copies_in_step(fund, monkeypatch):
    from orchard import exhibit, sync
    home, trees = fund
    monkeypatch.setattr(sync, "sql", lambda q: (
        [{"id": 1, "tree": "planted", "thesis": "t1", "kind": "styleframe", "status": "approved"}]
        if "review_item" in q else
        [{"id": 1, "review_id": 1, "verdict": "approved", "note": "", "at": [1]}]))
    sync.sync_rulings()
    for path in (home / "planted/orchard.yaml", trees / "planted.yaml"):
        assert load(path).theses[0].stage == Stage.styleframe, path

    tree = load(home / "planted/orchard.yaml")
    tree.artefacts[0].bundle = "0123456789abcdef"
    P.save(tree)
    art = P.get("planted").artefacts[0]
    assert (trees / "planted.yaml").read_bytes().endswith((home / "planted/orchard.yaml").read_bytes())
    assert exhibit.find_artefact("0123456789abcdef")[1] == art
    # and the CLI's approve path goes through the same save
    monkeypatch.setattr(exhibit, "call", lambda *a: None)
    monkeypatch.setattr(exhibit, "verify_id", lambda root: (True, "0123456789abcdef", ""))
    monkeypatch.setattr(exhibit, "verify_local", lambda root: {"mismatched": [], "missing": []})
    b = home / "bundles/0123456789abcdef"; b.mkdir(parents=True)
    (b / "bundle.json").write_text('{"id": "0123456789abcdef", "kind": "still", "poster": "thumb.jpg",'
                                   ' "tiers": [{"name": "full", "jpg": "full.jpg"}]}')
    rep = exhibit.hang(b, approve=True, push=False, verbose=False)
    assert rep["approved_in"] == str(home / "planted/orchard.yaml")
    assert load(trees / "planted.yaml").artefacts[0].approved
