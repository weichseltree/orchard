"""The grove's token service, from the home box: keys, Pages secrets, the gate.

The service itself is a Pages Function (grove/functions/auth, grove/auth/issuer.ts)
that runs Cloudflare's human check and signs the token a visitor connects to
SpacetimeDB with. It needs two secrets of its own and, for the human check, a
third; this module makes them, hands them to Cloudflare Pages, and checks the
result. The order matters and is the order of the commands:

    uv run orchard auth keygen --write   # AUTH_SIGNING_KEY, AUTH_NETWORK_KEY into the secrets file
    uv run orchard auth turnstile        # the widget; TURNSTILE_SITEKEY, TURNSTILE_SECRET likewise
    uv run orchard auth push             # the secrets, and AUTH_ISSUER, into Pages
    (redeploy the grove so a new Function version picks them up)
    uv run orchard auth status           # the live service: keys, discovery, a token
    uv run orchard auth gate on          # only then: turn anonymous visitors away

A client built without the site key sends no human check, and a service with
the secret refuses it. The grove's build takes TURNSTILE_SITEKEY from the
environment the deploy sources, so the two go out together by construction.

Values are never printed. `keygen` without --write says what it would add.
"""
from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

from .secrets import PATHS, get, load, require


def _bash_path(path) -> str:
    """A shell-safe path for bash on Windows. Prefer the accessed mount and quote it
    so the shell treats it as a single filename even with spaces or special chars.
    """
    p = os.fspath(path)
    if os.name != "nt":
        return shlex.quote(p)
    p = p.replace("\\", "/")
    if p.startswith("//"):
        return shlex.quote(p)
    if len(p) >= 2 and p[1] == ":":
        drive = p[0].lower()
        rest = p[2:].lstrip("/")
        candidates = [
            f"/mnt/{drive}/{rest}" if rest else f"/mnt/{drive}/",
            f"/{drive}/{rest}" if rest else f"/{drive}/",
        ]
        for candidate in candidates:
            try:
                if subprocess.run(["bash", "-lc", f"test -e {shlex.quote(candidate)}"],
                                  stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL,
                                  check=False).returncode == 0:
                    return shlex.quote(candidate)
            except OSError:
                pass
        return shlex.quote(candidates[0])
    return shlex.quote(p)

PROJECT = "weichseltree"
WIDGET = "grove token service"
WIDGET_DOMAINS = ["weichseltree.com", "www.weichseltree.com", "weichseltree.pages.dev"]
ISSUER = "https://www.weichseltree.com/auth"
SITE = "https://www.weichseltree.com"
#: What `push` sends to Pages, in this order. TURNSTILE_SECRET only if it is set.
PAGES_SECRETS = ("AUTH_SIGNING_KEY", "AUTH_NETWORK_KEY", "TURNSTILE_SECRET")

_KEYGEN_JS = """
const pair = await crypto.subtle.generateKey({name: "ECDSA", namedCurve: "P-256"}, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const net = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
process.stdout.write(JSON.stringify({signing: JSON.stringify({kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d}), network: net}));
"""


def _secrets_file():
    return next(p for p in PATHS if p is not None)


def keygen(write: bool) -> list[str]:
    """Makes the keys that are missing; appends them to the secrets file with `write`."""
    missing = [k for k in ("AUTH_SIGNING_KEY", "AUTH_NETWORK_KEY") if not get(k)]
    if not missing:
        return []
    node = shutil.which("node")
    if not node:
        sys.exit("node is needed to make the EC key (WebCrypto); it is not on PATH")
    out = subprocess.run([node, "--input-type=module", "-e", _KEYGEN_JS],
                         capture_output=True, text=True, check=True).stdout
    keys = json.loads(out)
    lines = {
        "AUTH_SIGNING_KEY": f"AUTH_SIGNING_KEY={json.dumps(keys['signing'])}",
        "AUTH_NETWORK_KEY": f"AUTH_NETWORK_KEY={json.dumps(keys['network'])}",
    }
    if write:
        path = _secrets_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", newline="\n") as f:
            f.write("\n# The grove's token service (orchard auth keygen). Rotating the signing\n"
                    "# key logs every visitor out once; the network key re-keys every ban.\n")
            for k in missing:
                f.write(lines[k] + "\n")
        os.chmod(path, 0o600)
        load.cache_clear()
    return missing


def _cloudflare(method: str, path: str, body: dict | None = None):
    """One Cloudflare API call; exits with Cloudflare's own message on failure."""
    token = get("CLOUDFLARE_ADMIN_TOKEN") or require("CLOUDFLARE_API_TOKEN")
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "User-Agent": "orchard-auth"},
        method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            reply = json.loads(r.read())
    except urllib.error.HTTPError as e:
        reply = json.loads(e.read() or b"{}")
    if not reply.get("success"):
        why = "; ".join(str(x.get("message")) for x in reply.get("errors", [])) or "failed"
        sys.exit(f"cloudflare {method} {path.split('?')[0]}: {why}")
    return reply.get("result")


def turnstile() -> str | None:
    """Creates the widget (or, if it exists, rotates its secret: Cloudflare shows a
    secret only once) and appends both keys to the secrets file. None if both are set."""
    if get("TURNSTILE_SITEKEY") and get("TURNSTILE_SECRET"):
        return None
    account = require("CLOUDFLARE_ACCOUNT_ID")
    widgets = _cloudflare("GET", f"/accounts/{account}/challenges/widgets?per_page=50") or []
    mine = next((w for w in widgets if w.get("name") == WIDGET), None)
    if mine:
        rotated = _cloudflare("POST", f"/accounts/{account}/challenges/widgets/{mine['sitekey']}/rotate_secret",
                              {"invalidate_immediately": True})
        sitekey, secret = mine["sitekey"], rotated["secret"]
    else:
        made = _cloudflare("POST", f"/accounts/{account}/challenges/widgets",
                           {"name": WIDGET, "domains": WIDGET_DOMAINS, "mode": "managed", "region": "world"})
        sitekey, secret = made["sitekey"], made["secret"]
    path = _secrets_file()
    with open(path, "a", newline="\n") as f:
        f.write(f"\n# Turnstile widget \"{WIDGET}\" (orchard auth turnstile). The site key is public.\n")
        f.write(f"TURNSTILE_SITEKEY={sitekey}\nTURNSTILE_SECRET={secret}\n")
    os.chmod(path, 0o600)
    load.cache_clear()
    return sitekey


def push() -> list[str]:
    """wrangler pages secret put, each value on stdin. Returns the names sent."""
    wrangler = shutil.which("wrangler")
    if not wrangler:
        sys.exit("wrangler is not on PATH")
    env = {**os.environ, "CLOUDFLARE_API_TOKEN": require("CLOUDFLARE_API_TOKEN"),
           "CLOUDFLARE_ACCOUNT_ID": require("CLOUDFLARE_ACCOUNT_ID")}
    values = {k: get(k) for k in PAGES_SECRETS}
    values["AUTH_ISSUER"] = ISSUER
    for k in ("AUTH_SIGNING_KEY", "AUTH_NETWORK_KEY"):
        if not values[k]:
            sys.exit(f"{k} is not set; run `orchard auth keygen --write` first")
    sent = []
    for name, value in values.items():
        if not value:
            continue
        r = subprocess.run([wrangler, "pages", "secret", "put", name, "--project-name", PROJECT],
                           input=value, capture_output=True, text=True, env=env)
        if r.returncode != 0:
            # wrangler's own message, which never contains the value
            sys.exit(f"{name}: {(r.stderr or r.stdout).strip()[-400:]}")
        sent.append(name)
    return sent


def _fetch(url: str, *, data: bytes | None = None, headers: dict | None = None) -> tuple[int, dict]:
    # Cloudflare's signature check refuses Python's default user agent outright
    # (error 1010), which would read as the service being down.
    headers = {"User-Agent": "orchard-auth-status", **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def status(site: str = SITE) -> dict:
    """What the live token service answers. Never prints a token."""
    out: dict = {}
    code, doc = _fetch(f"{site}/auth/.well-known/openid-configuration")
    out["discovery"] = code if code != 200 else f"200, issuer {doc.get('issuer')}"
    code, jwks = _fetch(f"{site}/auth/jwks.json")
    out["keys"] = code if code != 200 else f"200, {len(jwks.get('keys', []))} key(s)"
    code, body = _fetch(f"{site}/auth/token", data=b"{}",
                        headers={"Content-Type": "application/json", "Origin": site})
    out["token"] = {200: "200, issued (no human check asked)",
                    403: f"403, {body.get('error', 'refused')} (expected once Turnstile is on)",
                    503: "503, no keys yet: visitors stay anonymous"}.get(code, f"{code} {body}")
    try:
        from .sync import sql
        settings = {r["key"]: r["value"] for r in sql("select * from setting")}
        out["gate"] = "on" if settings.get("auth.required") == "true" else "off"
        out["issuers"] = (settings.get("auth.issuers") or f"{ISSUER} (default)")
    except Exception as exc:                                    # noqa: BLE001
        out["gate"] = f"unknown ({exc})"
    return out


def gate(on: bool) -> None:
    from .sync import call
    call("set_auth", [ISSUER], on)


def main(a) -> None:
    if a.what == "keygen":
        made = keygen(a.write)
        if not made:
            print("AUTH_SIGNING_KEY and AUTH_NETWORK_KEY are already set")
        elif a.write:
            print(f"added {', '.join(made)} to {_secrets_file()}")
        else:
            print(f"would add {', '.join(made)} to {_secrets_file()}; rerun with --write")
    elif a.what == "turnstile":
        sitekey = turnstile()
        print("TURNSTILE_SITEKEY and TURNSTILE_SECRET are already set" if sitekey is None
              else f"widget ready, site key {sitekey}; both keys added to {_secrets_file()}")
    elif a.what == "push":
        print("sent to Pages:", ", ".join(push()), "(redeploy the grove to use them)")
    elif a.what == "status":
        for k, v in status().items():
            print(f"{k:>9}  {v}")
    elif a.what == "gate":
        gate(a.state == "on")
        print(f"gate {a.state}")
