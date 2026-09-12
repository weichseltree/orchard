"""Push a bundle to R2, and set the bucket up the one time it needs it.

    uv run orchard r2 ensure                 # bucket, CORS, media.weichseltree.com
    uv run orchard push results/bundles/<id>

R2 IS SERVED, NOT PROXIED. The grove fetches `https://media.weichseltree.com/
<id>/...` directly, so the only things that decide whether a bundle plays are
the object's `Content-Type` and the bucket's CORS rules; both are set here and
nowhere else.

NO S3 KEYS. The Cloudflare API token in `~/.config/orchard/secrets.env` is not
an R2 access key pair, and the S3 endpoint accepts nothing else, so uploads go
over the Cloudflare REST API (`PUT /accounts/{a}/r2/buckets/{b}/objects/{key}`)
on ONE keep-alive connection. `--method wrangler` shells out to
`wrangler r2 object put` per file instead; it is kept because it is the
documented path and needs no HTTP code, and it is not the default because it
pays a Node start-up per object (measured in docs/impl/WP1-bundle.md).

IDEMPOTENT. Every push writes `<id>/.orchard-index.json`, a map of relative
path to sha256, and skips any file whose bytes already match it. A bundle id
is a hash of `bundle.json` and `bundle.json` names the sha256 of every chunk,
so re-pushing the same id is almost always a no-op — but "almost always" is
not "always" (an interrupted first push), and the index is what tells the
difference without downloading the objects.

CACHED FOREVER. Everything under `<id>/` is immutable, because the id is a
hash over the digests of every file there, so each object is PUT with
`Cache-Control: public, max-age=31536000, immutable` — the REST PUT maps the
header onto the object's httpMetadata, exactly as `wrangler r2 object put
--cache-control` sends it. The one exception is the push index, which every
push rewrites: `no-cache`. Objects pushed before 2026-09-13 carry no
Cache-Control; `orchard push --refresh-headers <dir>` re-puts them.
"""
from __future__ import annotations

import hashlib
import http.client
import json
import mimetypes
import os
import ssl
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote, urlencode

from .bundle import sha256_file
from .secrets import get, require

#: Statuses worth trying again on an idempotent request: the server asking
#: for a slower client, or a transient edge failure.
RETRY_STATUS = frozenset({429, 500, 502, 503, 504})
RETRY_MAX_SLEEP = 30.0


def _backoff(attempt: int, retry_after) -> float:
    """`Retry-After` when the server gave one, else 0.5 s doubling."""
    if retry_after:
        try:
            return min(float(retry_after), RETRY_MAX_SLEEP)
        except (TypeError, ValueError):
            pass
    return min(0.5 * (2 ** attempt), RETRY_MAX_SLEEP)


BUCKET = "weichseltree-media"
PUBLIC_HOST = "media.weichseltree.com"
ZONE_NAME = "weichseltree.com"
INDEX_KEY = ".orchard-index.json"
API_HOST = "api.cloudflare.com"
WRANGLER = str(Path.home() / ".local/share/pnpm/wrangler")

#: The browser refuses to play HLS, and three.js refuses to decode a chunk, if
#: these are wrong; R2 defaults everything it does not know to
#: application/octet-stream, which is right for chunks and fatal for m3u8.
CONTENT_TYPES = {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".ts": "video/mp2t",
    ".m4s": "video/iso.segment",
    ".mp4": "video/mp4",
    ".bin": "application/octet-stream",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ktx2": "image/ktx2",
    ".glb": "model/gltf-binary",
    ".txt": "text/plain; charset=utf-8",
}

CORS_ORIGINS = [
    "https://weichseltree.com",
    "https://www.weichseltree.com",
    "https://*.weichseltree.pages.dev",
    "http://localhost:5173",
    "http://localhost:4173",
]
CORS_EXPOSE = ["Content-Length", "Content-Range", "ETag"]
CORS_MAX_AGE = 86400


def content_type(path) -> str:
    ext = Path(path).suffix.lower()
    if ext in CONTENT_TYPES:
        return CONTENT_TYPES[ext]
    return mimetypes.guess_type(str(path))[0] or "application/octet-stream"


#: A bundle's objects never change under their address, so a browser and the
#: edge may keep them for a year without asking again.
CACHE_IMMUTABLE = "public, max-age=31536000, immutable"
#: The push index is rewritten by every push; it must always be revalidated.
CACHE_INDEX = "no-cache"


def cache_control(rel: str) -> str:
    """The Cache-Control an object at `<id>/<rel>` is stored with."""
    return CACHE_INDEX if rel == INDEX_KEY else CACHE_IMMUTABLE


# ------------------------------------------------------------------ the API


class CloudflareError(RuntimeError):
    def __init__(self, status, path, errors):
        self.status, self.path, self.errors = status, path, errors
        codes = ", ".join(f"{e.get('code')}: {e.get('message')}"
                          for e in (errors or [])) or f"HTTP {status}"
        super().__init__(f"{path} -> {codes}")

    @property
    def codes(self) -> set[int]:
        return {e.get("code") for e in (self.errors or [])}


R2_OFF = (
    "R2 is not enabled on this Cloudflare account (API code 10042). Nothing "
    "here can turn it on: it needs a human at dash.cloudflare.com > R2 > "
    "'Purchase R2' once, which also accepts the R2 terms. The free tier "
    "covers M0 (10 GB, 1M class-A and 10M class-B operations a month). "
    "Re-run `uv run orchard r2 ensure` afterwards.")


class R2NotEnabled(RuntimeError):
    """The account has never been through R2's one-time dashboard opt-in.

    Not a bug and not something a token can fix, so it is its own type: the
    CLI prints it as an instruction and exits 2 instead of a traceback.
    """


def _raise_for(status: int, body: bytes, what: str):
    """The object API's error body as a CloudflareError, or R2NotEnabled."""
    try:
        errors = json.loads(body).get("errors")
    except Exception:                                             # noqa: BLE001
        errors = [{"code": status, "message": (body or b"")[:200].decode(
            "utf-8", "replace")}]
    if any(e.get("code") == 10042 for e in (errors or [])):
        raise R2NotEnabled(R2_OFF)
    raise CloudflareError(status, what, errors)


class CF:
    """One keep-alive connection to api.cloudflare.com, authenticated.

    The token never leaves this object: it is read from the secrets file, put
    in a header, and never printed, logged or returned.

    Two scopes, so an everyday token can do less than a setup token:
    `"r2"` (pushing bundles) uses CLOUDFLARE_R2_TOKEN, an R2-only token;
    `"admin"` (creating the bucket, attaching its domain, which reads the
    zone) uses CLOUDFLARE_ADMIN_TOKEN. Either falls back to
    CLOUDFLARE_API_TOKEN, the one token this started with (docs/HOSTING.md).
    """

    def __init__(self, token=None, account=None, scope: str = "r2"):
        scoped = {"r2": "CLOUDFLARE_R2_TOKEN", "admin": "CLOUDFLARE_ADMIN_TOKEN"}[scope]
        self._token = token or get(scoped) or require("CLOUDFLARE_API_TOKEN")
        self.account = account or require("CLOUDFLARE_ACCOUNT_ID")
        self._conn = None

    # -- plumbing
    def _connect(self):
        self._conn = http.client.HTTPSConnection(
            API_HOST, timeout=120, context=ssl.create_default_context())
        return self._conn

    def close(self):
        if self._conn:
            try:
                self._conn.close()
            finally:
                self._conn = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def raw(self, method: str, path: str, body=None, headers=None,
            retries: int = 2) -> tuple[int, bytes, dict]:
        """(status, body, headers). Retries only what is safe to retry.

        TWO KINDS OF RETRY, and they are not the same kind.

        *Transport*: a keep-alive connection the far end closed between calls
        fails on the NEXT request, not the last one, so a reconnect is right —
        the request never reached the server.

        *Status*: 429 and 5xx are the server asking for a slower client, and a
        50-file push that dies on file 34 because R2 rate-limited it has to be
        restarted by hand. Back off by `Retry-After` when it is given.

        **Neither applies to POST.** `POST /r2/buckets` creates a bucket; a
        lost response is not a lost request, and retrying it makes
        `r2 ensure` fail on an "already exists" error it caused itself.
        """
        h = {"Authorization": f"Bearer {self._token}", **(headers or {})}
        idempotent = method.upper() in ("GET", "HEAD", "PUT", "DELETE")
        attempts = (retries + 1) if idempotent else 1
        last = None
        for attempt in range(attempts):
            conn = self._conn or self._connect()
            try:
                conn.request(method, path, body=body, headers=h)
                resp = conn.getresponse()
                data = resp.read()
                status, hdrs = resp.status, dict(resp.headers)
                if resp.will_close:
                    self.close()
            except (http.client.HTTPException, OSError) as exc:
                last = exc
                self.close()
                if attempt + 1 < attempts:
                    time.sleep(_backoff(attempt, None))
                    continue
                raise ConnectionError(f"{method} {path}: {exc!r}") from exc
            if status in RETRY_STATUS and attempt + 1 < attempts:
                time.sleep(_backoff(attempt, hdrs.get("Retry-After")))
                continue
            return status, data, hdrs
        raise ConnectionError(f"{method} {path}: {last!r}")

    def api(self, method: str, path: str, payload=None, ok=(200, 201)) -> dict:
        body = json.dumps(payload).encode() if payload is not None else None
        headers = {"Content-Type": "application/json"} if body else {}
        status, data, _ = self.raw(method, "/client/v4" + path, body, headers)
        try:
            doc = json.loads(data or b"{}")
        except json.JSONDecodeError:
            doc = {"success": False,
                   "errors": [{"code": status, "message": data[:200].decode(
                       "utf-8", "replace")}]}
        if status not in ok or not doc.get("success", False):
            raise CloudflareError(status, path, doc.get("errors"))
        return doc.get("result")

    # -- objects
    def object_path(self, key: str, bucket=BUCKET) -> str:
        return (f"/client/v4/accounts/{self.account}/r2/buckets/{bucket}"
                f"/objects/{quote(key, safe='/')}")

    def put_object(self, key: str, data: bytes, ctype: str, bucket=BUCKET,
                   cache_control: str | None = None) -> None:
        headers = {"Content-Type": ctype, "Content-Length": str(len(data))}
        if cache_control:
            headers["Cache-Control"] = cache_control
        status, body, _ = self.raw("PUT", self.object_path(key, bucket), data,
                                   headers)
        if status not in (200, 201):
            _raise_for(status, body, f"PUT {key}")

    def list_objects(self, prefix: str = "", bucket=BUCKET, delimiter: str | None = None,
                     per_page: int = 1000) -> tuple[list[dict], list[str]]:
        """(objects, common prefixes) under `prefix`, every page followed.

        Each object is `{key, size, etag, last_modified, http_metadata, ...}`;
        `http_metadata` holds `contentType` and, once set, `cacheControl`.
        With `delimiter="/"` the second list is the `<id>/` prefixes.
        """
        objects, prefixes, cursor = [], [], None
        while True:
            q = {"per_page": per_page}
            if prefix:
                q["prefix"] = prefix
            if delimiter:
                q["delimiter"] = delimiter
            if cursor:
                q["cursor"] = cursor
            path = (f"/client/v4/accounts/{self.account}/r2/buckets/{bucket}"
                    f"/objects?{urlencode(q)}")
            status, body, _ = self.raw("GET", path)
            try:
                doc = json.loads(body or b"{}")
            except json.JSONDecodeError:
                doc = {}
            if status != 200 or not doc.get("success", False):
                _raise_for(status, body, f"LIST {bucket}/{prefix}")
            objects += doc.get("result") or []
            info = doc.get("result_info") or {}
            prefixes += info.get("delimited") or []
            if not info.get("is_truncated") or not info.get("cursor"):
                return objects, prefixes
            cursor = info["cursor"]

    def delete_object(self, key: str, bucket=BUCKET) -> None:
        status, body, _ = self.raw("DELETE", self.object_path(key, bucket))
        if status not in (200, 204, 404):
            _raise_for(status, body, f"DELETE {key}")

    def head_object(self, key: str, bucket=BUCKET) -> dict | None:
        """Response headers; None if the object is not there; `{"unsupported":
        True}` when the API refuses HEAD altogether.

        It does refuse: measured 405 on every object on 2026-09-12, the day
        R2 went on, while GET of the same key returned 200 and the bytes. A
        405 must not read as "missing", or the first push ever made raises
        `did not survive the upload` on the first chunk over 1 MB.
        """
        status, _body, hdrs = self.raw("HEAD", self.object_path(key, bucket))
        if status == 405:
            return {"unsupported": True}
        return hdrs if status == 200 else None

    def get_object(self, key: str, bucket=BUCKET) -> bytes | None:
        status, body, _ = self.raw("GET", self.object_path(key, bucket))
        if status == 404:
            return None
        if status != 200:
            errors = None
            try:
                errors = json.loads(body).get("errors")
            except Exception:                                     # noqa: BLE001
                pass
            if any(e.get("code") == 10042 for e in (errors or [])):
                raise R2NotEnabled(R2_OFF)
            raise CloudflareError(status, f"GET {key}", errors)
        return body


# ------------------------------------------------------------- the one-time


def _domain_state(entry: dict) -> str:
    """R2 returns `status` as an object now (ownership + ssl), so render it."""
    st = entry.get("status")
    if isinstance(st, dict):
        return ", ".join(f"{k}={v}" for k, v in sorted(st.items())) or "attached"
    return str(st or "attached")


def ensure_bucket(bucket=BUCKET, *, domain=PUBLIC_HOST, zone_name=ZONE_NAME,
                  cf: CF | None = None, verbose=True) -> dict:
    """Create the bucket, set CORS, attach the custom domain. Safe to re-run."""
    own = cf is None
    cf = cf or CF(scope="admin")
    report: dict = {"bucket": bucket, "domain": domain}
    try:
        # 1. the bucket
        try:
            cf.api("GET", f"/accounts/{cf.account}/r2/buckets/{bucket}")
            report["bucket_state"] = "exists"
        except CloudflareError as exc:
            if 10042 in exc.codes:
                raise R2NotEnabled(R2_OFF) from exc
            cf.api("POST", f"/accounts/{cf.account}/r2/buckets",
                   {"name": bucket})
            report["bucket_state"] = "created"

        # 2. CORS. The wildcard origin is what the spec asks for; if the API
        #    refuses wildcards, drop that one entry and SAY SO rather than
        #    quietly shipping a policy that blocks preview deployments.
        rules = [{
            "allowed": {"methods": ["GET", "HEAD"], "origins": CORS_ORIGINS,
                        "headers": ["*"]},
            "exposeHeaders": CORS_EXPOSE,
            "maxAgeSeconds": CORS_MAX_AGE,
        }]
        try:
            cf.api("PUT", f"/accounts/{cf.account}/r2/buckets/{bucket}/cors",
                   {"rules": rules})
            report["cors"] = CORS_ORIGINS
        except CloudflareError as exc:
            # ONLY an origin-validation refusal. Catching every CloudflareError
            # here turned an auth failure, or 10042, into a second attempt with
            # a shorter origin list and then surfaced THAT error, so the
            # operator was told about wildcards when the account was off.
            if 10042 in exc.codes:
                raise R2NotEnabled(R2_OFF) from exc
            said = " ".join(str(e.get("message", ""))
                            for e in (exc.errors or [])).lower()
            if not any(w in said for w in ("origin", "wildcard", "cors")):
                raise
            plain = [o for o in CORS_ORIGINS if "*" not in o]
            rules[0]["allowed"]["origins"] = plain
            cf.api("PUT", f"/accounts/{cf.account}/r2/buckets/{bucket}/cors",
                   {"rules": rules})
            report["cors"] = plain
            report["cors_warning"] = (
                f"the API refused the wildcard origin ({exc}); "
                "*.weichseltree.pages.dev preview deployments will be blocked "
                "by CORS until an exact origin is added")

        # 3. the custom domain
        zones = cf.api("GET", f"/zones?name={zone_name}") or []
        if not zones:
            report["domain_state"] = f"zone {zone_name} not found"
            return report
        zone_id = zones[0]["id"]
        got = cf.api("GET",
                     f"/accounts/{cf.account}/r2/buckets/{bucket}/domains/custom")
        have = {d.get("domain"): d for d in (got or {}).get("domains", [])}
        if domain in have:
            report["domain_state"] = _domain_state(have[domain])
        else:
            cf.api("POST",
                   f"/accounts/{cf.account}/r2/buckets/{bucket}/domains/custom",
                   {"domain": domain, "zoneId": zone_id, "enabled": True})
            report["domain_state"] = "attached"
        return report
    finally:
        if verbose:
            for k, v in report.items():
                print(f"  {k}: {v}")
        if own:
            cf.close()


def enable_dev_url(bucket=BUCKET, cf: CF | None = None) -> str:
    """Turn on the bucket's `*.r2.dev` public URL. A FALLBACK, not the plan.

    r2.dev is rate limited and not meant for production traffic; the grove
    should be on media.weichseltree.com. Only called when explicitly asked for.
    """
    own = cf is None
    cf = cf or CF(scope="admin")
    try:
        cf.api("PUT",
               f"/accounts/{cf.account}/r2/buckets/{bucket}/domains/managed",
               {"enabled": True})
        got = cf.api("GET",
                     f"/accounts/{cf.account}/r2/buckets/{bucket}/domains/managed")
        return f"https://{got['domain']}"
    finally:
        if own:
            cf.close()


# --------------------------------------------------------------- the upload


def bundle_files(bundle_dir) -> list[tuple[str, Path]]:
    """(key suffix, path) for everything in the bundle, `bundle.json` last.

    Last on purpose: `bundle.json` is what the client fetches first and what
    names every other file, so it must never be the one object that is present
    while the chunks it points at are not.
    """
    root = Path(bundle_dir)
    files = [(str(p.relative_to(root)).replace(os.sep, "/"), p)
             for p in sorted(root.rglob("*")) if p.is_file()]
    files = [f for f in files if f[0] != INDEX_KEY]
    return ([f for f in files if f[0] != "bundle.json"]
            + [f for f in files if f[0] == "bundle.json"])


def expected_digests(bundle_dir) -> dict[str, str]:
    """The sha256 the bundle ITSELF claims for each file it serves.

    Three spellings, all read, because bundles already written keep theirs:

    - a tape names them in `bundle.json` (`chunks[*].sha256`, `poster_sha256`);
    - a video or still written since 2026-09-13 names every file in
      `bundle.json:files` (`{relpath: {sha256, bytes}}`), so its id covers them;
    - a video or still written before that names them in `media.json`
      (`files: [{file, sha256, bytes}]`), which its id does not cover. Those
      ids were computed over their own `bundle.json`, so they still verify.

    `bundle.json` and `media.json` are not in the map: nothing names their
    digests, and the id covers `bundle.json` itself.
    """
    root = Path(bundle_dir)
    doc = json.loads((root / "bundle.json").read_text())
    out: dict[str, str] = {}
    if doc.get("poster") and doc.get("poster_sha256"):
        out[doc["poster"]] = doc["poster_sha256"]
    for v in (doc.get("variants") or {}).values():
        for c in v.get("chunks") or []:
            out[c["file"]] = c["sha256"]
    if isinstance(doc.get("files"), dict):
        for rel, f in doc["files"].items():
            out[rel] = f["sha256"]
    media = doc.get("media")
    if media and (root / media).exists():
        for f in json.loads((root / media).read_text()).get("files") or []:
            out[f["file"]] = f["sha256"]
    return out


def verify_local(bundle_dir) -> dict:
    """Check the bytes on disk against the digests the bundle claims.

    Ran nowhere before: `push` hashed every file and compared it only to the
    PREVIOUS push, so a chunk truncated after bundling uploaded happily under
    an id that promised different bytes, and the id verified because the id
    covers `bundle.json` and not the disk.
    """
    root = Path(bundle_dir)
    want = expected_digests(root)
    bad, missing = [], []
    for rel, digest in sorted(want.items()):
        f = root / rel
        if not f.exists():
            missing.append(rel)
        elif sha256_file(f) != digest:
            bad.append(rel)
    known = {k for k, _ in bundle_files(root)}
    unclaimed = sorted(known - set(want) - {"bundle.json", "media.json"})
    return {"checked": len(want), "mismatched": bad, "missing": missing,
            "unclaimed": unclaimed}


#: Objects up to this size are read back whole and hashed. Every file a
#: bundle serves is a chunk or a segment of a few MB, so this is all of them;
#: it doubles the transfer, and it is the only check the REST API allows.
INLINE_VERIFY_MAX = 64 << 20


def _verify_uploaded(cf, bid: str, rel: str, path: Path, digest: str | None,
                     bucket: str, inline_max=INLINE_VERIFY_MAX) -> str:
    """What actually landed. 'ok' | 'unverified' | a reason it is wrong.

    An object up to `inline_max` is re-fetched and hashed. A larger one is
    checked by `Content-Length`, and by `ETag` when R2 gives a plain
    (non-multipart) MD5 — where the API answers HEAD at all; it did not on
    2026-09-12 (405), and then the object is read back like a small one.
    """
    size = path.stat().st_size
    hdrs = None if size <= inline_max else cf.head_object(f"{bid}/{rel}", bucket)
    if size <= inline_max or (hdrs and hdrs.get("unsupported")):
        got = cf.get_object(f"{bid}/{rel}", bucket)
        if got is None:
            return "missing after upload"
        if len(got) != size:
            return f"length {len(got)} != {size}"
        if digest and hashlib.sha256(got).hexdigest() != digest:
            return "sha256 mismatch"
        return "ok"
    if hdrs is None:
        return "missing after upload"
    length = hdrs.get("Content-Length")
    if length is not None and int(length) != size:
        return f"length {length} != {size}"
    etag = (hdrs.get("ETag") or "").strip('"')
    if len(etag) == 32 and "-" not in etag:
        if hashlib.md5(path.read_bytes()).hexdigest() != etag:  # noqa: S324
            return "etag mismatch"
        return "ok"
    return "ok" if length is not None else "unverified"


def _wrangler_put(key: str, path: Path, ctype: str, bucket=BUCKET,
                  cache_control: str | None = None) -> None:
    env = dict(os.environ)
    env["CLOUDFLARE_API_TOKEN"] = require("CLOUDFLARE_API_TOKEN")
    env["CLOUDFLARE_ACCOUNT_ID"] = require("CLOUDFLARE_ACCOUNT_ID")
    cmd = [WRANGLER, "r2", "object", "put", f"{bucket}/{key}",
           "--file", str(path), "--content-type", ctype, "--remote"]
    if cache_control:
        cmd += ["--cache-control", cache_control]
    out = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if out.returncode:
        raise RuntimeError(f"wrangler r2 object put {key}: "
                           f"{(out.stderr or out.stdout).strip()[:400]}")


def push(bundle_dir, *, bucket=BUCKET, method="rest", dry_run=False,
         force=False, check=True, cf: CF | None = None, verbose=True) -> dict:
    """Upload every file of a bundle under `<id>/`. Returns a report.

    Two checks bracket the upload and both are on by default: the bytes on
    disk must match the digests the bundle claims for them, and what landed
    in the bucket must match what was sent.
    """
    root = Path(bundle_dir).resolve()
    doc = json.loads((root / "bundle.json").read_text())
    bid = doc["id"]
    if root.name != bid:
        raise ValueError(
            f"{root} is named {root.name!r} but its bundle.json says "
            f"id={bid!r}; the directory name IS the address and pushing under "
            "a mismatched one puts the bundle where nothing will look for it")
    if check:
        local = verify_local(root)
        if local["mismatched"] or local["missing"]:
            raise ValueError(
                f"{root.name} does not match its own manifest: "
                f"mismatched={local['mismatched']} missing={local['missing']}. "
                "Re-bundle rather than push bytes the bundle does not claim.")
        if verbose:
            print(f"  verified {local['checked']} local files against "
                  f"bundle.json/media.json", flush=True)
    want = expected_digests(root) if check else {}
    files = bundle_files(root)
    # A dry run must not need a token: it is the one form of `push` a reviewer
    # can run on a machine that has never seen ~/.config/orchard/secrets.env.
    own = cf is None and not dry_run
    cf = cf or (None if dry_run else CF())
    t0 = time.perf_counter()
    try:
        index = {}
        if not force and not dry_run:
            index = _read_index(cf, bid, bucket)

        uploaded, skipped, unverified, sent_bytes = [], [], [], 0
        new_index = {}
        for rel, path in files:
            digest = sha256_file(path)
            ctype = content_type(path)
            cc = cache_control(rel)
            size = path.stat().st_size
            new_index[rel] = {"sha256": digest, "bytes": size,
                              "content_type": ctype, "cache_control": cc}
            was = index.get(rel)
            if was and was.get("sha256") == digest and was.get("content_type") == ctype:
                # Same bytes, same type: skipped, and the index keeps saying
                # which Cache-Control the object really has (none, for one
                # pushed before 2026-09-13; `--refresh-headers` fixes those).
                new_index[rel]["cache_control"] = was.get("cache_control")
                skipped.append(rel)
                continue
            if dry_run:
                uploaded.append(rel)
                sent_bytes += size
                continue
            if method == "wrangler":
                _wrangler_put(f"{bid}/{rel}", path, ctype, bucket, cc)
            else:
                cf.put_object(f"{bid}/{rel}", path.read_bytes(), ctype, bucket,
                              cache_control=cc)
            uploaded.append(rel)
            sent_bytes += size
            if check:
                why = _verify_uploaded(cf, bid, rel, path, want.get(rel), bucket)
                if why == "unverified":
                    unverified.append(rel)
                elif why != "ok":
                    raise ValueError(f"{bid}/{rel} did not survive the upload: "
                                     f"{why}")
            if verbose:
                print(f"  put {rel}  {size / 1e6:.2f} MB  {ctype}", flush=True)

        if not dry_run:
            _put_index(cf, bid, new_index, bucket)
        elapsed = time.perf_counter() - t0
        report = {"id": bid, "kind": doc.get("kind"), "bucket": bucket,
                  "method": method, "files": len(files),
                  "uploaded": len(uploaded), "skipped": len(skipped),
                  "verified": len(uploaded) - len(unverified),
                  "unverified": unverified,
                  "bytes": sent_bytes, "seconds": round(elapsed, 2),
                  "dry_run": dry_run,
                  "url": f"https://{PUBLIC_HOST}/{bid}/bundle.json"}
        if verbose:
            print(f"{'would push' if dry_run else 'pushed'} {bid}: "
                  f"{len(uploaded)} uploaded, {len(skipped)} unchanged, "
                  f"{len(unverified)} unverified, "
                  f"{sent_bytes / 1e6:.2f} MB in {elapsed:.1f}s "
                  f"({sent_bytes / 1e6 / max(elapsed, 1e-9):.1f} MB/s, "
                  f"{len(uploaded) / max(elapsed, 1e-9):.1f} files/s)")
            print(f"  {report['url']}")
        return report
    finally:
        if own and cf is not None:
            cf.close()


def _read_index(cf, bid: str, bucket=BUCKET) -> dict:
    raw = cf.get_object(f"{bid}/{INDEX_KEY}", bucket)
    if not raw:
        return {}
    try:
        return json.loads(raw).get("files") or {}
    except (json.JSONDecodeError, AttributeError):
        return {}


def _put_index(cf, bid: str, files: dict, bucket=BUCKET) -> None:
    payload = json.dumps({"schema": "orchard/push-index/1", "bundle_id": bid,
                          "files": files}, indent=1).encode()
    cf.put_object(f"{bid}/{INDEX_KEY}", payload, "application/json", bucket,
                  cache_control=cache_control(INDEX_KEY))


def _md5(path: Path) -> str:
    h = hashlib.md5()                                             # noqa: S324
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def refresh_headers(bundle_dir, *, bucket=BUCKET, dry_run=False, force=False,
                    cf: CF | None = None, verbose=True) -> dict:
    """Re-put the objects of an already-pushed bundle whose Cache-Control is wrong.

    The bucket's own listing is the truth, not the push index: every object
    under `<id>/` whose `http_metadata.cacheControl` is not what `push` would
    set now is PUT again from the local bundle with the same bytes, type and
    the right header (the REST API has no metadata-only update, and the
    objects are small). `force` re-puts every object regardless.

    Only metadata changes. Before anything is sent, every object to be re-put
    must match the local file (size, and the MD5 R2 reports as a plain ETag),
    and the local bundle must match its own `bundle.json`; any disagreement
    refuses the whole bundle, because re-putting then would change bytes under
    a published address — `push --force` is the verb for that.
    """
    root = Path(bundle_dir).resolve()
    doc = json.loads((root / "bundle.json").read_text())
    bid = doc["id"]
    if root.name != bid:
        raise ValueError(f"{root} is named {root.name!r} but its bundle.json "
                         f"says id={bid!r}")
    local = verify_local(root)
    if local["mismatched"] or local["missing"]:
        raise ValueError(f"{bid} does not match its own manifest: "
                         f"mismatched={local['mismatched']} "
                         f"missing={local['missing']}")
    own = cf is None
    cf = cf or CF()
    try:
        objects, _ = cf.list_objects(prefix=f"{bid}/", bucket=bucket)
        if not objects:
            raise ValueError(f"nothing under {bid}/ in {bucket}; this bundle "
                             "was never pushed, so `orchard push` it instead")
        stale, current, no_local, differs = [], [], [], []
        for obj in objects:
            rel = obj["key"][len(bid) + 1:]
            have = (obj.get("http_metadata") or {}).get("cacheControl")
            if rel == INDEX_KEY:
                continue
            path = root / rel
            if not path.is_file():
                no_local.append(rel)
                continue
            if have == cache_control(rel) and not force:
                current.append(rel)
                continue
            etag = str(obj.get("etag") or "").strip('"')
            if (int(obj.get("size", -1)) != path.stat().st_size
                    or (len(etag) == 32 and "-" not in etag and _md5(path) != etag)):
                differs.append(rel)
            stale.append(rel)
        if differs:
            raise ValueError(
                f"{bid}: {len(differs)} object(s) in the bucket are not the "
                f"local bytes ({', '.join(differs[:5])}); refreshing headers "
                "would change bytes under a published address. Use "
                "`orchard push --force` to replace them deliberately.")
        # bundle.json last, as in push: it names every other object
        stale.sort(key=lambda r: r == "bundle.json")
        if not dry_run:
            for rel in stale:
                path = root / rel
                cf.put_object(f"{bid}/{rel}", path.read_bytes(), content_type(path),
                              bucket, cache_control=cache_control(rel))
                why = _verify_uploaded(cf, bid, rel, path, sha256_file(path), bucket)
                if why not in ("ok", "unverified"):
                    raise ValueError(f"{bid}/{rel} did not survive the re-put: {why}")
                if verbose:
                    print(f"  re-put {rel}  {cache_control(rel)}", flush=True)
            index = _read_index(cf, bid, bucket)
            for rel in stale + current:
                if rel in index:
                    index[rel]["cache_control"] = cache_control(rel)
            _put_index(cf, bid, index, bucket)
            # what the bucket now says, not what was sent
            after, _ = cf.list_objects(prefix=f"{bid}/", bucket=bucket)
            wrong = sorted(o["key"][len(bid) + 1:] for o in after
                           if (o.get("http_metadata") or {}).get("cacheControl")
                           != cache_control(o["key"][len(bid) + 1:])
                           and o["key"][len(bid) + 1:] not in no_local)
        else:
            wrong = []
        rep = {"id": bid, "bucket": bucket, "objects": len(objects),
               "refreshed": len(stale), "current": len(current),
               "no_local_copy": no_local, "still_wrong": wrong,
               "dry_run": dry_run}
        if verbose:
            print(f"{'would refresh' if dry_run else 'refreshed'} {bid}: "
                  f"{len(stale)} re-put, {len(current)} already right, "
                  f"{len(no_local)} with no local copy"
                  + (f", STILL WRONG: {wrong}" if wrong else ""), flush=True)
        return rep
    finally:
        if own:
            cf.close()


# -------------------------------------------------------------- measurement


def benchmark(bundle_dir, *, bucket=BUCKET, n=10, prefix="_bench") -> dict:
    """Time both upload paths on the same files, into a throwaway prefix.

    The objects land under `<prefix>/` and are deleted afterwards, so this
    never touches a real bundle.
    """
    root = Path(bundle_dir).resolve()
    files = bundle_files(root)[:n]
    out = {}
    with CF() as cf:
        for method in ("rest", "wrangler"):
            t0 = time.perf_counter()
            for rel, path in files:
                key = f"{prefix}/{method}/{rel}"
                if method == "wrangler":
                    _wrangler_put(key, path, content_type(path), bucket)
                else:
                    cf.put_object(key, path.read_bytes(), content_type(path),
                                  bucket)
            dt = time.perf_counter() - t0
            out[method] = {"files": len(files), "seconds": round(dt, 2),
                           "per_file_s": round(dt / max(len(files), 1), 3)}
            for rel, _ in files:
                try:
                    cf.raw("DELETE", cf.object_path(f"{prefix}/{method}/{rel}",
                                                    bucket))
                except Exception:                                 # noqa: BLE001
                    pass
    return out


def wrangler_spawn_cost(n=10) -> float:
    """Seconds per `wrangler` invocation, ignoring the upload itself.

    The floor under `--method wrangler`: one Node process per object, whatever
    the network does.
    """
    t0 = time.perf_counter()
    for _ in range(n):
        subprocess.run([WRANGLER, "--version"], capture_output=True)
    return (time.perf_counter() - t0) / n


# ------------------------------------------------------------- verification


def fetch_public(bid: str, path="bundle.json", host=PUBLIC_HOST,
                 timeout=15) -> tuple[int, bytes | str, dict]:
    url = f"https://{host}/{bid}/{path}"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:200], dict(e.headers)
    except Exception as exc:                                      # noqa: BLE001
        return 0, repr(exc), {}


def wait_public(bid: str, path="bundle.json", host=PUBLIC_HOST,
                timeout_s=300, every=10, verbose=True) -> dict:
    """Poll until the object is served, or give up and say what it did instead.

    A freshly attached R2 custom domain is a DNS record plus a certificate; it
    is normal for it to 404 or fail TLS for a few minutes.
    """
    t0 = time.perf_counter()
    last = None
    while True:
        status, body, headers = fetch_public(bid, path, host)
        last = {"status": status,
                "content_type": headers.get("Content-Type"),
                "access_control_allow_origin":
                    headers.get("Access-Control-Allow-Origin"),
                "seconds": round(time.perf_counter() - t0, 1),
                "url": f"https://{host}/{bid}/{path}"}
        if status == 200:
            last["ok"] = True
            if verbose:
                print(f"  200 in {last['seconds']}s  {last['url']}")
            return last
        if time.perf_counter() - t0 > timeout_s:
            last["ok"] = False
            last["detail"] = body if isinstance(body, str) else body[:200].decode(
                "utf-8", "replace")
            if verbose:
                print(f"  gave up after {last['seconds']}s: {last['status']} "
                      f"{last.get('detail', '')}")
            return last
        if verbose:
            print(f"  {status}, retrying in {every}s "
                  f"({last['seconds']}s elapsed)", flush=True)
        time.sleep(every)


def cors_preflight(bid: str, path="bundle.json", host=PUBLIC_HOST,
                   origin="https://weichseltree.com") -> dict:
    """What a browser at `origin` is actually told. The header, not the config."""
    req = urllib.request.Request(f"https://{host}/{bid}/{path}", method="OPTIONS")
    req.add_header("Origin", origin)
    req.add_header("Access-Control-Request-Method", "GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            h = dict(r.headers)
            return {"status": r.status,
                    "allow_origin": h.get("Access-Control-Allow-Origin"),
                    "expose": h.get("Access-Control-Expose-Headers"),
                    "max_age": h.get("Access-Control-Max-Age")}
    except urllib.error.HTTPError as e:
        h = dict(e.headers)
        return {"status": e.code,
                "allow_origin": h.get("Access-Control-Allow-Origin")}
    except Exception as exc:                                      # noqa: BLE001
        return {"status": 0, "error": repr(exc)}
