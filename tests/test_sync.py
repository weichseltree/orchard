"""Sync: the SQL JSON shape, and rulings flowing back into the manifests."""
from orchard.manifest import Stage, Thesis, Tree
from orchard.sync import _timestamp, apply_rulings, rows_from_sql_json, stage_implied


def test_rows_from_sql_json_reads_the_cli_s_shape():
    payload = [{"schema": {"elements": [{"name": {"some": "id"}, "algebraic_type": {"U64": []}},
                                        {"name": {"some": "hung_at"}, "algebraic_type": {}}]},
                "rows": [[1, [1789223296647488]], [2, [1789223339494062]]]}]
    rows = rows_from_sql_json(payload)
    assert rows == [{"id": 1, "hung_at": [1789223296647488]}, {"id": 2, "hung_at": [1789223339494062]}]
    assert _timestamp(rows[0]["hung_at"]) == 1789223296647488
    assert _timestamp({"__timestamp_micros_since_unix_epoch__": 5}) == 5
    assert _timestamp(7) == 7 and _timestamp(None) is None and _timestamp([]) is None
    assert rows_from_sql_json([]) == []


def test_stage_implied():
    assert stage_implied("styleframe", "approved") == Stage.styleframe
    assert stage_implied("still", "approved") == Stage.styleframe
    assert stage_implied("animatic", "approved") == Stage.animatic
    assert stage_implied("master", "approved") == Stage.mastered
    assert stage_implied("anything", "greenlit") == Stage.greenlit
    assert stage_implied("animatic", "changes") is None
    assert stage_implied("animatic", "rejected") is None
    assert stage_implied("poster", "approved") is None


def tree():
    return Tree(name="einstruct", path="/nowhere", question="q?",
                theses=[Thesis(id="rows-read-chemistry", question="q", stage=Stage.animatic,
                               blocked_by="narration says card"),
                        Thesis(id="throw-away-the-axes", question="q", stage=Stage.thesis)])


def test_rulings_advance_a_thesis_only_forward_and_clear_its_block():
    t = tree()
    items = [{"id": 1, "tree": "einstruct", "thesis": "rows-read-chemistry", "kind": "animatic", "status": "approved"},
             {"id": 2, "tree": "einstruct", "thesis": "rows-read-chemistry", "kind": "styleframe", "status": "approved"},
             {"id": 3, "tree": "einstruct", "thesis": "throw-away-the-axes", "kind": "styleframe", "status": "approved"}]
    rulings = [{"id": 1, "review_id": 1, "verdict": "greenlit", "note": "", "at": [10]},
               {"id": 2, "review_id": 2, "verdict": "approved", "note": "", "at": [11]},
               {"id": 3, "review_id": 3, "verdict": "approved", "note": "nice", "at": [12]}]
    changes = apply_rulings([t], items, rulings)
    by = {c["review_id"]: c for c in changes}
    assert by[1]["status"] == "advanced" and by[1]["to"] == "greenlit"
    assert by[2]["status"] == "unchanged", "an approved styleframe does not pull a greenlit thesis back"
    assert by[3]["status"] == "advanced" and by[3]["from"] == "thesis" and by[3]["to"] == "styleframe"
    assert t.theses[0].stage == Stage.greenlit and t.theses[0].blocked_by == ""
    assert t.theses[1].stage == Stage.styleframe


def test_the_latest_ruling_on_an_item_wins_and_changes_write_blocked_by():
    t = tree()
    items = [{"id": 5, "tree": "einstruct", "thesis": "throw-away-the-axes", "kind": "animatic", "status": "changes"}]
    rulings = [{"id": 1, "review_id": 5, "verdict": "approved", "note": "", "at": [10]},
               {"id": 2, "review_id": 5, "verdict": "changes", "note": "too hasty", "at": [20]}]
    changes = apply_rulings([t], items, rulings)
    assert changes[0]["status"] == "blocked_by written"
    assert t.theses[1].stage == Stage.thesis
    assert t.theses[1].blocked_by == "animatic changes: too hasty"
    # Idempotent: the same rulings again change nothing.
    assert apply_rulings([t], items, rulings)[0]["status"] == "unchanged"


def test_an_unknown_thesis_is_reported_not_raised():
    changes = apply_rulings([tree()], [{"id": 9, "tree": "spectre", "thesis": "x", "kind": "still", "status": "open"}],
                            [{"id": 1, "review_id": 9, "verdict": "approved", "note": "", "at": [1]}])
    assert changes == [{"tree": "spectre", "thesis": "x", "status": "no such thesis", "review_id": 9}]
    # An item with no ruling yet is simply not mentioned.
    assert apply_rulings([tree()], [{"id": 1, "tree": "einstruct", "thesis": "throw-away-the-axes", "kind": "still", "status": "open"}], []) == []
