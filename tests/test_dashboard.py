"""The flat dashboard: localhost only, writes need the header, the moderation panel's shape."""
import pytest
from fastapi.testclient import TestClient

from orchard.dashboard import app as dashboard

ANN = "0x" + "a1" * 32
BOB = "0x" + "b2" * 32


@pytest.fixture
def calls(monkeypatch):
    """Every reducer the page asks for, instead of the live database."""
    seen: list[tuple] = []
    monkeypatch.setattr(dashboard, "call", lambda reducer, *args: seen.append((reducer, *args)))
    return seen


@pytest.fixture
def client():
    return TestClient(dashboard.app, base_url="http://127.0.0.1:8787")


WRITE = {"X-Orchard": "1"}


def test_answers_only_to_localhost_by_name(client):
    assert client.get("/api/portfolio").status_code == 200
    assert client.get("/api/portfolio", headers={"Host": "localhost:8787"}).status_code == 200
    assert client.get("/api/portfolio", headers={"Host": "[::1]:8787"}).status_code == 200
    # A DNS-rebinding page reaches 127.0.0.1 with its own name in Host.
    r = client.get("/api/portfolio", headers={"Host": "attacker.example:8787"})
    assert r.status_code == 421


def test_a_write_without_the_header_is_refused_even_with_no_body(client, calls):
    # The retire button's endpoint takes no body, so a cross-site form post could
    # reach it without a preflight; the header is what that post cannot carry.
    assert client.post("/api/directive/1/retire").status_code == 403
    assert calls == []
    assert client.post("/api/directive/1/retire", headers=WRITE).json() == {"ok": True}
    assert calls == [("retire_directive", 1)]


def test_a_write_from_another_origin_is_refused(client, calls):
    r = client.post("/api/people/kick", json={"who": ANN}, headers={**WRITE, "Origin": "https://evil.example"})
    assert r.status_code == 403
    assert calls == []
    r = client.post("/api/people/kick", json={"who": ANN}, headers={**WRITE, "Origin": "http://127.0.0.1:8787"})
    assert r.status_code == 200 and calls == [("kick", ANN)]


def test_the_page_cannot_be_framed(client):
    r = client.get("/")
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]
    assert "x-orchard" in r.text  # the page's own writes send the header


def test_moderation_writes_check_the_identity(client, calls):
    assert client.post("/api/people/ban", json={"who": "0xnothex", "minutes": 5}, headers=WRITE).status_code == 422
    assert client.post("/api/people/ban", json={"who": ANN, "minutes": -1}, headers=WRITE).status_code == 422
    client.post("/api/people/ban", json={"who": ANN, "minutes": 0, "reason": "spam", "network": True}, headers=WRITE)
    client.post("/api/people/mute", json={"who": BOB, "muted": True}, headers=WRITE)
    client.post("/api/people/unban", json={"who": ANN}, headers=WRITE)
    client.post("/api/reports/7/resolve", headers=WRITE)
    assert calls == [
        ("ban_visitor", ANN, 0, "spam", True),
        ("mute", BOB, True),
        ("unban", ANN),
        ("resolve_report", 7),
    ]


def test_the_gate_takes_only_urls(client, calls):
    bad = client.post("/api/auth", json={"issuers": ["not a url"], "required": True}, headers=WRITE)
    assert bad.status_code == 400 and calls == []
    client.post("/api/auth", json={"issuers": ["https://www.weichseltree.com/auth"], "required": True}, headers=WRITE)
    assert calls == [("set_auth", ["https://www.weichseltree.com/auth"], True)]


def test_people_reads_the_cli_s_shapes(client, monkeypatch):
    tables = {
        "visitor": [{"identity": [ANN], "name": "ann", "room": "grove", "is_admin": False, "muted": False,
                     "last_seen": [1_789_000_000_000_000], "online": True}],
        "report": [{"id": 3, "subject": [ANN], "subject_name": "ann", "room": "grove", "reason": "<b>spam</b>",
                    "context": "ann: hi", "status": "open", "at": [1_789_000_000_000_000]}],
        "ban": [{"identity": [BOB], "network": "k", "reason": "x", "until": [1_789_000_000_000_000]}],
        "guest": [{"identity": [ANN], "network": "zckbDCAl4o9B"}],
        "setting": [],
    }
    monkeypatch.setattr(dashboard, "sql", lambda q: tables[q.split(" from ")[1].split()[0]])
    body = client.get("/api/people").json()
    assert body["online"][0] | {} == {"identity": ANN, "name": "ann", "room": "grove", "is_admin": False,
                                      "muted": False, "network": "zckbDCAl4o9B", "last_seen": 1_789_000_000.0}
    assert body["reports"][0]["subject"] == ANN
    assert body["reports"][0]["reason"] == "<b>spam</b>"  # raw here; the page escapes it
    assert body["bans"] == [{"identity": BOB, "network": True, "reason": "x", "until": 1_789_000_000.0}]
    assert body["auth"] == {"issuers": [], "default_issuer": "https://www.weichseltree.com/auth", "required": False}


def test_identity_parsing_rejects_anything_but_hex():
    assert dashboard._identity([ANN]) == ANN
    assert dashboard._identity(ANN.upper().replace("0X", "0x")) == ANN
    assert dashboard._identity(["0x1234"]) == ""
    assert dashboard._identity(['0x" onclick="x']) == ""
