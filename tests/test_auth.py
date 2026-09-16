"""orchard auth keygen: what it writes must work both for bash (`set -a; . secrets.env`) and for secrets.py."""
import json
import os
import shutil
import subprocess

import pytest

from orchard import auth, secrets


@pytest.mark.skipif(not shutil.which("node"), reason="keygen makes the EC key with node's WebCrypto")
def test_keygen_writes_keys_that_bash_and_secrets_py_both_read(tmp_path, monkeypatch):
    path = tmp_path / "secrets.env"
    path.write_text("CLOUDFLARE_ACCOUNT_ID=abc\n")
    monkeypatch.setattr(auth, "_secrets_file", lambda: path)
    monkeypatch.setattr(auth, "get", lambda name: None)
    assert auth.keygen(write=True) == ["AUTH_SIGNING_KEY", "AUTH_NETWORK_KEY"]
    if os.name != "nt":
        assert oct(path.stat().st_mode & 0o777) == "0o600"

    parsed = secrets._parse(path)
    jwk = json.loads(parsed["AUTH_SIGNING_KEY"])
    assert jwk["kty"] == "EC" and jwk["crv"] == "P-256" and jwk["d"]
    assert len(parsed["AUTH_NETWORK_KEY"]) >= 40

    sourced = subprocess.run(["bash", "-c",
                              f"set -a; . {auth._bash_path(path)}; printenv AUTH_SIGNING_KEY"],
                             capture_output=True, text=True, check=True).stdout
    assert json.loads(sourced) == jwk


def test_keygen_leaves_existing_keys_alone(monkeypatch):
    monkeypatch.setattr(auth, "get", lambda name: "already")
    assert auth.keygen(write=True) == []


def test_turnstile_creates_the_widget_once_and_stores_both_keys(tmp_path, monkeypatch):
    path = tmp_path / "secrets.env"
    path.write_text("CLOUDFLARE_ACCOUNT_ID=acct\n")
    monkeypatch.setattr(auth, "_secrets_file", lambda: path)
    monkeypatch.setattr(auth, "get", lambda name: None)
    monkeypatch.setattr(auth, "require", lambda name: "acct")
    calls = []

    def cloudflare(method, url, body=None):
        calls.append((method, url.split("?")[0], body))
        if method == "GET":
            return []
        return {"sitekey": "0x4AAA", "secret": "0x4BBB"}

    monkeypatch.setattr(auth, "_cloudflare", cloudflare)
    assert auth.turnstile() == "0x4AAA"
    assert calls[1][0] == "POST" and calls[1][2]["mode"] == "managed"
    assert set(calls[1][2]["domains"]) == {"weichseltree.com", "www.weichseltree.com", "weichseltree.pages.dev"}
    parsed = secrets._parse(path)
    assert parsed["TURNSTILE_SITEKEY"] == "0x4AAA" and parsed["TURNSTILE_SECRET"] == "0x4BBB"


def test_turnstile_rotates_the_secret_of_an_existing_widget(tmp_path, monkeypatch):
    path = tmp_path / "secrets.env"
    path.write_text("")
    monkeypatch.setattr(auth, "_secrets_file", lambda: path)
    monkeypatch.setattr(auth, "get", lambda name: None)
    monkeypatch.setattr(auth, "require", lambda name: "acct")
    seen = []

    def cloudflare(method, url, body=None):
        seen.append(url.split("?")[0])
        if method == "GET":
            return [{"name": "grove token service", "sitekey": "0x4OLD"}]
        return {"secret": "0x4NEW"}

    monkeypatch.setattr(auth, "_cloudflare", cloudflare)
    assert auth.turnstile() == "0x4OLD"
    assert seen[1].endswith("/challenges/widgets/0x4OLD/rotate_secret")
    assert secrets._parse(path)["TURNSTILE_SECRET"] == "0x4NEW"
