"""orchard auth keygen: what it writes must work both for bash (`set -a; . secrets.env`) and for secrets.py."""
import json
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
    assert oct(path.stat().st_mode & 0o777) == "0o600"

    parsed = secrets._parse(path)
    jwk = json.loads(parsed["AUTH_SIGNING_KEY"])
    assert jwk["kty"] == "EC" and jwk["crv"] == "P-256" and jwk["d"]
    assert len(parsed["AUTH_NETWORK_KEY"]) >= 40

    sourced = subprocess.run(["bash", "-c", f"set -a; . {path}; printf %s \"$AUTH_SIGNING_KEY\""],
                             capture_output=True, text=True, check=True).stdout
    assert json.loads(sourced) == jwk


def test_keygen_leaves_existing_keys_alone(monkeypatch):
    monkeypatch.setattr(auth, "get", lambda name: "already")
    assert auth.keygen(write=True) == []
