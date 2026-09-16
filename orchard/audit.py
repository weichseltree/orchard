"""The packaging rules of docs/specs/PACKAGES.md, checked across every live repo.

    uv run orchard audit                  # every repo: a table, and results/audit.json
    uv run orchard audit phototroph       # some repos (results/audit.json is left alone)
    uv run orchard audit --json           # the report itself

GitHub Actions is off for billing, so this box's timer is the CI: the
orchard-sync timer runs the audit every 15 minutes (orchard-audit.service,
after each sync). It blocks nothing. It makes every drift visible within 15
minutes, naming the repo, the rule and the file, on the flat dashboard's Audit
panel and in results/audit.json. That file stays on this box: repo names
include private repos, so nothing here goes to the live database or R2.

Which repos: every git checkout directly under a root in audit.yaml
(`~/weichseltree`, so a new repo is covered the day it is cloned), or the root
itself when it is a checkout (`~/kaggle/arcagi2026`). A worktree checkout
(the someotherlife-* directories) is its own entry, since each is a working
tree that runs. audit.yaml names the archived and out-of-scope repos, listed
and not checked, and the waivers: a finding accepted with a reason still
shows, as `waived: <reason>`, and does not count as a failure.

Every result is ok / fail / warn / skip, with a detail and path[:line]:

    python-lock     a [project] needs uv.lock beside it or at its uv workspace
                    root, and `uv lock --check` passes; requirements.txt with no
                    pyproject.toml needs a pinned requirements.lock.txt
    script-lock     a PEP 723 script needs <file>.lock, and `uv lock --check --script`
    node-pins       a project's package.json: a lockfile whose specifiers match
                    it, engines.node, .nvmrc, and packageManager for pnpm
    sibling-import  a .py that names a sibling repo's path and edits sys.path
    manifest-dirty  an artefact commit ending in -dirty in <repo>/orchard.yaml (warn)
    fund-copies     trees/*.yaml equal to what `orchard trees refresh` writes (orchard)
    pinned-tags     a git pin on a repo the audit knows (its checkout's GitHub
                    origin) names a tag that exists in that checkout and on origin
    toolchain       orchard doctor's tools: a mismatch fails, a missing tool warns (orchard)
    bindings        `pnpm -C grove run check:bindings`, when grove has it (orchard)

Only what the repos TRACK is checked (`git ls-files`), read from the working
tree, which is what runs. The audit never writes into a repo.
"""
from __future__ import annotations

import fnmatch
import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
import tomllib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

import yaml

from . import RESULTS, ROOT

CONFIG = ROOT / "audit.yaml"
OUT = RESULTS / "audit.json"
STALE_S = 45 * 60          # the dashboard marks a report older than this stale (three timer runs)

RULES = ("python-lock", "script-lock", "node-pins", "sibling-import", "manifest-dirty",
         "fund-copies", "pinned-tags", "toolchain", "bindings", "waiver")
UV_TIMEOUT = 30            # one `uv lock --check`; offline it takes ~0.05 s
GIT_TIMEOUT = 30
LS_REMOTE_TIMEOUT = 10
BINDINGS_TIMEOUT = 90
MAX_PY_BYTES = 2_000_000   # larger tracked .py files are data, not code

# A caller's uv and git settings must not leak into the checks: UV_LOCKED is set
# in every Claude session, VIRTUAL_ENV names orchard's own venv, GIT_DIR a hook's repo.
DROP_ENV = {"UV_LOCKED", "UV_FROZEN", "UV_OFFLINE", "UV_NO_SYNC", "UV_PROJECT_ENVIRONMENT",
            "VIRTUAL_ENV", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"}


# --- results -------------------------------------------------------------------------

@dataclass
class Finding:
    rule: str
    status: str               # ok | fail | warn | skip
    detail: str
    path: str = ""            # relative to the repo
    line: int | None = None
    waived: str = ""          # the waiver's reason, when one matches

    @property
    def where(self) -> str:
        return f"{self.path}:{self.line}" if self.path and self.line else self.path

    def as_dict(self) -> dict:
        return asdict(self) | {"where": self.where}


def ok(rule, detail, path="", line=None):
    return Finding(rule, "ok", detail, path, line)


def fail(rule, detail, path="", line=None):
    return Finding(rule, "fail", detail, path, line)


def warn(rule, detail, path="", line=None):
    return Finding(rule, "warn", detail, path, line)


def skip(rule, detail, path="", line=None):
    return Finding(rule, "skip", detail, path, line)


# --- configuration and discovery ----------------------------------------------------

@dataclass
class Config:
    roots: list[Path]
    archived: set[str] = field(default_factory=set)
    out_of_scope: set[str] = field(default_factory=set)
    waivers: list[dict] = field(default_factory=list)


def load_config(path: Path | None = None) -> Config:
    path = path or CONFIG
    doc = (yaml.safe_load(path.read_text()) if path.exists() else None) or {}
    roots = [Path(os.path.expanduser(str(r))) for r in doc.get("roots") or ["~/weichseltree"]]
    return Config(roots=roots, archived=set(doc.get("archived") or []),
                  out_of_scope=set(doc.get("out_of_scope") or []),
                  waivers=list(doc.get("waivers") or []))


@dataclass
class Repo:
    name: str
    path: Path
    state: str = "live"       # live | archived | out_of_scope


def is_checkout(p: Path) -> bool:
    return (p / ".git").exists()     # a directory, or a worktree's file


def discover(cfg: Config) -> list[Repo]:
    """Every checkout the roots name; non-git directories are passed over silently."""
    repos, seen = [], set()
    for root in cfg.roots:
        if not root.is_dir():
            continue
        found = [root] if is_checkout(root) else sorted(
            c for c in root.iterdir() if c.is_dir() and is_checkout(c))
        for c in found:
            if c.name in seen:
                continue
            seen.add(c.name)
            state = ("archived" if c.name in cfg.archived else
                     "out_of_scope" if c.name in cfg.out_of_scope else "live")
            repos.append(Repo(c.name, c, state))
    return repos


# --- running things -----------------------------------------------------------------

@dataclass
class Ran:
    rc: int | None            # None: timed out, or could not start (see why)
    out: str = ""
    err: str = ""
    why: str = ""

    @property
    def text(self) -> str:
        return (self.out + "\n" + self.err).strip()


def put_tools_on_path() -> None:
    """nvm's node and pnpm's home onto this process's PATH, once, before any probe.

    The systemd user manager's PATH has neither: `pnpm run` needs both, and
    wrangler (`#!/usr/bin/env node`) reads no version without node, which the
    doctor's probe would report as a mismatch.
    """
    from .toolchain import resolve                              # noqa: PLC0415
    have = os.environ.get("PATH", "").split(os.pathsep)
    node = resolve("node")
    extra = [str(Path(node).parent)] if node else []
    pnpm_home = Path.home() / ".local/share/pnpm"
    if pnpm_home.is_dir():
        extra.append(str(pnpm_home))
    extra = [d for d in extra if d not in have]
    if extra:
        os.environ["PATH"] = os.pathsep.join([*extra, *have])


def tool_env() -> dict:
    """The environment minus uv/git overrides, and git never prompting."""
    env = {k: v for k, v in os.environ.items() if k not in DROP_ENV}
    env["GIT_TERMINAL_PROMPT"] = "0"
    env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=5")
    return env


def run(cmd: list[str], cwd: Path, timeout: float) -> Ran:
    """`cmd` in its own process group, killed whole on the timeout (pnpm spawns node spawns spacetime)."""
    try:
        p = subprocess.Popen(cmd, cwd=cwd, env=tool_env(), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, errors="replace", start_new_session=True)
    except OSError as exc:
        return Ran(None, why=f"{type(exc).__name__}: {exc}")
    try:
        out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
        p.communicate()
        return Ran(None, why=f"timed out after {timeout:g} s")
    return Ran(p.returncode, out, err)


def _first_error(text: str) -> str:
    lines = [ln.strip(" ×╰─▶") for ln in text.splitlines() if ln.strip()]
    pick = next((ln for ln in lines if re.search(r"error|fail|not found|unable", ln, re.I)), None)
    return _short(pick or (lines[-1] if lines else "no output"))


def _short(text: str, n: int = 220) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1] + "…"


# --- one run's shared state ---------------------------------------------------------

class Context:
    """What checks of different repos share: the repo set, orchard, and each pinned repo's tags."""

    def __init__(self, cfg: Config, repos: list[Repo], home: Path | None = None):
        self.cfg = cfg
        self.repos = repos
        self.home = home or Path.home()
        self.orchard = next((r for r in repos if r.name == "orchard"), None)
        self._lock = threading.Lock()
        self._repo_locks: dict[str, threading.Lock] = {}
        self._by_origin: dict[str, Repo] | None = None
        self._local_tags: dict[str, set[str]] = {}
        self._remote: dict[str, tuple[set[str] | None, str]] = {}
        self.sibling_patterns = self._sibling_patterns()
        self.github = github_host_re(self.home)

    # pinned repos and their tags --------------------------------------------------------
    def by_origin(self) -> dict[str, Repo]:
        """`owner/name` (lower case) of each checkout's GitHub origin -> the checkout.

        Every repo on the report counts, archived ones included: a pin on an archived
        repo still has to name a tag that exists. Worktrees share an origin (and their
        tags); the checkout named after the repo wins, else the first by name.
        """
        with self._lock:
            if self._by_origin is None:
                found: dict[str, Repo] = {}
                for r in sorted(self.repos, key=lambda r: r.name):
                    got = run(["git", "-C", str(r.path), "config", "--get", "remote.origin.url"],
                              r.path, GIT_TIMEOUT)
                    slug = github_slug(got.out.strip(), self.github) if got.rc == 0 else None
                    if slug and (slug not in found or r.name.lower() == slug.split("/")[1]):
                        found[slug] = r
                self._by_origin = found
            return self._by_origin

    def _repo_lock(self, key: str) -> threading.Lock:
        with self._lock:
            return self._repo_locks.setdefault(key, threading.Lock())

    def local_tags(self, repo: Repo) -> set[str]:
        key = str(repo.path)
        with self._repo_lock(key):
            if key not in self._local_tags:
                r = run(["git", "-C", key, "tag", "-l"], repo.path, GIT_TIMEOUT)
                self._local_tags[key] = set(r.out.split()) if r.rc == 0 else set()
            return self._local_tags[key]

    def remote_tags(self, repo: Repo) -> tuple[set[str] | None, str]:
        """origin's tags, from ONE `git ls-remote` per repo per run; (None, why) when it cannot answer."""
        key = str(repo.path)
        with self._repo_lock(key):
            if key not in self._remote:
                r = run(["git", "-C", key, "ls-remote", "--tags", "origin"], repo.path, LS_REMOTE_TIMEOUT)
                if r.rc == 0:
                    tags = {ln.split("refs/tags/", 1)[1].removesuffix("^{}")
                            for ln in r.out.splitlines() if "refs/tags/" in ln}
                    self._remote[key] = (tags, "")
                else:
                    self._remote[key] = (None, r.why or _first_error(r.text))
            return self._remote[key]

    # sibling paths -----------------------------------------------------------------------
    def _sibling_patterns(self) -> list[tuple[re.Pattern, str | None]]:
        """(regex, target) per root: a container root's regex captures the repo named
        after it (target None); a checkout root's regex means that checkout."""
        pats = []
        for root in self.cfg.roots:
            try:
                parts = root.relative_to(self.home).parts
            except ValueError:
                parts = ()
            container = not is_checkout(root)
            slash = "/".join(map(re.escape, parts))
            quoted = r"['\"]\s*/\s*['\"]".join(map(re.escape, parts))
            child = r"(?:/([\w.-]+))?" if container else r"(?![\w.-])"
            qchild = r"(?:/([\w.-]+)|['\"]\s*/\s*['\"]([\w.-]+)['\"])?" if container else r"(?![\w.-])"
            target = None if container else root.name
            if parts:
                pats.append((re.compile(r"(?:~|\$HOME|\$\{HOME\}|/home/[^/\s'\"]+)/" + slash + child), target))
                pats.append((re.compile(r"Path\.home\(\)\s*/\s*['\"](?:" + slash + "|" + quoted + ")" + qchild), target))
            else:  # a root outside the home directory: its absolute path is the only spelling
                pats.append((re.compile(re.escape(str(root)) + child), target))
        return pats

    def repo_names(self) -> set[str]:
        return {r.name for r in self.repos}


# --- the checks ---------------------------------------------------------------------

def _toml(path: Path):
    try:
        return tomllib.loads(path.read_text()), ""
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        return None, f"{type(exc).__name__}: {_short(str(exc), 120)}"


def _glob_re(pattern: str) -> re.Pattern:
    """A workspace glob as pnpm, npm and uv read it: `*` stays within a directory, `**` crosses."""
    pattern = pattern.strip().removeprefix("./").rstrip("/")
    out, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            out += ".*"; i += 2
            if pattern.startswith("/", i):
                out += "/?"; i += 1
        elif pattern[i] == "*":
            out += "[^/]*"; i += 1
        elif pattern[i] == "?":
            out += "[^/]"; i += 1
        else:
            out += re.escape(pattern[i]); i += 1
    return re.compile(out + r"\Z")


def _under(rel: PurePosixPath, anc: PurePosixPath) -> str:
    return str(rel.relative_to(anc)) if str(anc) != "." else str(rel)


def _p(d: PurePosixPath, name: str) -> str:
    return name if str(d) == "." else f"{d}/{name}"


def _line_of(text: str, needle: str, start: int = 0) -> int | None:
    i = text.find(needle, start)
    return text.count("\n", 0, i) + 1 if i >= 0 else None


NEEDS_UPDATE = "needs to be updated"
OFFLINE_MISS = re.compile(r"network was disabled|offline|not found in the cache|cache", re.I)
NETWORK = re.compile(r"network|dns|connect|timed out|failed to fetch|failed to download|"
                     r"resolve host|tls|http|ssh|could not read from remote", re.I)


def uv_lock_check(cwd: Path, rule: str, where: str, extra: tuple = ()) -> Finding:
    """`uv lock --check`, offline first. A demonstrated mismatch fails; an offline cache miss
    is retried online, and a network failure then is a skip, never a fail."""
    uv = shutil.which("uv") or str(Path.home() / ".local/bin/uv")
    r = run([uv, "lock", "--check", "--offline", *extra], cwd, UV_TIMEOUT)
    if r.rc == 0:
        return ok(rule, "uv lock --check passes", where)
    if r.rc is not None and NEEDS_UPDATE in r.text:
        return fail(rule, "the lock does not match its project: run `uv lock"
                    + (f" {' '.join(extra)}" if extra else "") + "` and commit it", where)
    if r.rc is None or OFFLINE_MISS.search(r.text):
        r2 = run([uv, "lock", "--check", *extra], cwd, UV_TIMEOUT)
        if r2.rc == 0:
            return ok(rule, "uv lock --check passes (online: the offline cache lacked a package)", where)
        if r2.rc is not None and NEEDS_UPDATE in r2.text:
            return fail(rule, "the lock does not match its project: run `uv lock` and commit it", where)
        if r2.rc is None or NETWORK.search(r2.text) or OFFLINE_MISS.search(r2.text):
            return skip(rule, "could not check the lock: " + (r2.why or _first_error(r2.text)), where)
        return warn(rule, "uv lock --check: " + _first_error(r2.text), where)
    return warn(rule, "uv lock --check: " + _first_error(r.text), where)


def _workspace_root(repo: Repo, rel_dir: PurePosixPath, tracked: set[str]) -> PurePosixPath | None:
    """The nearest ancestor whose [tool.uv.workspace] claims `rel_dir` as a member."""
    for anc in rel_dir.parents:
        key = _p(anc, "pyproject.toml")
        if key not in tracked:
            continue
        doc, _ = _toml(repo.path / key)
        ws = ((doc or {}).get("tool") or {}).get("uv", {}).get("workspace")
        if not isinstance(ws, dict):
            continue
        member = _under(rel_dir, anc)
        if any(_glob_re(m).match(member) for m in ws.get("members") or []) and \
                not any(_glob_re(x).match(member) for x in ws.get("exclude") or []):
            return anc
    return None


REQ_LINE = re.compile(r"^\s*(?!#|-)(\S.*?)\s*(?:#.*)?$")


def _unpinned(text: str) -> list[str]:
    bad = []
    for ln in text.splitlines():
        m = REQ_LINE.match(ln)
        if not m:
            continue
        req = m.group(1).split(";")[0].strip()
        if "==" in req or " @ " in req or req.startswith(("git+", "http://", "https://", "file:")):
            continue
        bad.append(req)
    return bad


def check_python_lock(repo: Repo, tracked: list[str], ts: set[str]) -> list[Finding]:
    rule, out = "python-lock", []
    lock_dirs: dict[PurePosixPath, str] = {}
    for rel in (f for f in tracked if PurePosixPath(f).name == "pyproject.toml"):
        d = PurePosixPath(rel).parent
        doc, err = _toml(repo.path / rel)
        if doc is None:
            out.append(warn(rule, f"pyproject.toml does not parse ({err})", rel)); continue
        if "project" not in doc:
            continue                        # tool configuration only: nothing to lock
        lock = _p(d, "uv.lock")
        if lock in ts:
            lock_dirs.setdefault(d, rel); continue
        ws = _workspace_root(repo, d, ts)
        if ws is not None and _p(ws, "uv.lock") in ts:
            lock_dirs.setdefault(ws, rel)
            out.append(ok(rule, f"a member of the uv workspace at {_p(ws, 'pyproject.toml')}, locked there", rel))
        elif (repo.path / lock).exists():
            out.append(fail(rule, "uv.lock exists beside it but is not committed", lock))
        else:
            out.append(fail(rule, "a [project] with no uv.lock beside it or at a uv workspace root "
                                  "(run `uv lock` and commit it)", rel))
    for d in sorted(lock_dirs, key=str):
        out.append(uv_lock_check(repo.path / str(d), rule, _p(d, "uv.lock")))

    # requirements.txt with no project around it: a pinned freeze (event-atoms' convention)
    for rel in (f for f in tracked if PurePosixPath(f).name == "requirements.txt"):
        d = PurePosixPath(rel).parent
        if _p(d, "pyproject.toml") in ts:
            continue
        lock = next((c for c in (_p(d, "requirements.lock.txt"), "requirements.lock.txt") if c in ts), None)
        if lock is None:
            out.append(fail(rule, "requirements.txt with neither a pyproject.toml nor a pinned "
                                  "requirements.lock.txt", rel)); continue
        try:
            bad = _unpinned((repo.path / lock).read_text(errors="replace"))
        except OSError as exc:
            out.append(warn(rule, f"cannot read {lock}: {exc}", lock)); continue
        if bad:
            out.append(fail(rule, f"{len(bad)} requirement(s) not pinned with ==: {', '.join(bad[:4])}", lock))
        else:
            out.append(ok(rule, f"requirements.txt frozen in {lock}", rel))
    return out


SCRIPT_HEADER = re.compile(r"^# /// script\s*$", re.M)


def pep723_block(text: str) -> tuple[dict | None, int]:
    """A PEP 723 `script` block as TOML, and its first line number."""
    m = SCRIPT_HEADER.search(text)
    if not m:
        return None, 0
    start = text.count("\n", 0, m.start()) + 1
    body = []
    for ln in text[m.end():].splitlines()[1:]:
        if ln.rstrip() == "# ///":
            break
        if not ln.startswith("#"):
            return None, start
        body.append(ln[2:] if ln.startswith("# ") else ln[1:])
    try:
        return tomllib.loads("\n".join(body)), start
    except tomllib.TOMLDecodeError:
        return None, start


def check_script_lock(repo: Repo, sources: dict[str, str], ts: set[str]) -> list[Finding]:
    rule, out = "script-lock", []
    for rel, text in sources.items():
        m = SCRIPT_HEADER.search(text)
        if not m:
            continue
        line = text.count("\n", 0, m.start()) + 1
        lock = f"{rel}.lock"
        if lock in ts:
            out.append(uv_lock_check(repo.path, rule, lock, ("--script", rel)))
        elif (repo.path / lock).exists():
            out.append(fail(rule, f"{PurePosixPath(lock).name} exists but is not committed", lock))
        else:
            out.append(fail(rule, f"a PEP 723 script with no {PurePosixPath(lock).name} beside it "
                                  f"(`uv lock --script {rel}`, then commit it)", rel, line))
    return out


# node ----------------------------------------------------------------------------

def _json(path: Path):
    try:
        return json.loads(path.read_text()), ""
    except (OSError, ValueError) as exc:
        return None, f"{type(exc).__name__}: {_short(str(exc), 120)}"


def _workspace_globs(repo: Repo, ts: set[str], pkgs: dict[str, dict]) -> list[tuple[PurePosixPath, list[str]]]:
    """(root dir, globs) of every pnpm-workspace.yaml and every package.json `workspaces`."""
    out = []
    for rel in (f for f in ts if PurePosixPath(f).name == "pnpm-workspace.yaml"):
        try:
            doc = yaml.safe_load((repo.path / rel).read_text()) or {}
        except (OSError, yaml.YAMLError):
            doc = {}
        out.append((PurePosixPath(rel).parent, [str(g) for g in doc.get("packages") or []]))
    for rel, doc in pkgs.items():
        ws = doc.get("workspaces")
        if isinstance(ws, dict):
            ws = ws.get("packages")
        if isinstance(ws, list):
            out.append((PurePosixPath(rel).parent, [str(g) for g in ws]))
    return out


def _is_member(d: PurePosixPath, workspaces) -> bool:
    for root, globs in workspaces:
        if d == root or (str(root) != "." and root not in d.parents):
            continue
        member = _under(d, root)
        inc = [g for g in globs if not g.startswith("!")]
        exc = [g[1:] for g in globs if g.startswith("!")]
        if any(_glob_re(g).match(member) for g in inc) and not any(_glob_re(g).match(member) for g in exc):
            return True
    return False


DEP_FIELDS = ("dependencies", "devDependencies", "optionalDependencies")


def _importers(text: str) -> dict | None:
    """The `importers:` section of a pnpm lockfile, parsed alone: the whole file is
    ~240 kB of packages the comparison never reads."""
    m = re.search(r"^importers:\s*$", text, re.M)
    if not m:
        return None
    end = re.search(r"^\S", text[m.end():], re.M)
    chunk = text[m.start(): m.end() + (end.start() if end else len(text) - m.end())]
    return (yaml.load(chunk, Loader=getattr(yaml, "CSafeLoader", yaml.SafeLoader)) or {}).get("importers") or {}


def pnpm_mismatch(pkg: dict, importer: dict, auto_install_peers: bool = True) -> list[str]:
    """What `pnpm install --frozen-lockfile` would object to: the lock's specifiers against
    package.json's (pnpm's satisfiesPackageManifest, without resolving anything)."""
    deps, dev, opt = (dict(pkg.get(f) or {}) for f in DEP_FIELDS)
    declared = {**dev, **deps, **opt}
    if auto_install_peers:
        peers = {n: s for n, s in (pkg.get("peerDependencies") or {}).items() if n not in declared}
        declared = {**peers, **declared}
        deps = {**peers, **deps}
    if "specifiers" in importer:                                  # lockfile v5
        locked = dict(importer.get("specifiers") or {})
    else:
        locked = {n: (e or {}).get("specifier") if isinstance(e, dict) else None
                  for f in DEP_FIELDS for n, e in (importer.get(f) or {}).items()}
    diff = []
    for n in sorted(set(declared) | set(locked)):
        if n not in locked:
            diff.append(f"{n} not in the lock")
        elif n not in declared:
            diff.append(f"{n} only in the lock")
        elif declared[n] != locked[n]:
            diff.append(f"{n} {declared[n]!r} but locked as {locked[n]!r}")
    if diff:
        return diff
    fields = {"dependencies": [n for n in deps if n not in opt], "optionalDependencies": list(opt),
              "devDependencies": [n for n in dev if n not in deps and n not in opt]}
    for f, names in fields.items():
        have = set((importer.get(f) or {}))
        if "specifiers" not in importer and set(names) != have:
            moved = sorted(set(names) ^ have)
            diff.append(f"{f} differ: {', '.join(moved[:4])}")
    return diff


def npm_mismatch(pkg: dict, root: dict) -> list[str]:
    """package-lock.json's root entry records package.json's four dependency maps; npm ci
    refuses a lock whose root disagrees."""
    diff = []
    for f in (*DEP_FIELDS, "peerDependencies"):
        want, have = pkg.get(f) or {}, root.get(f) or {}
        for n in sorted(set(want) | set(have)):
            if want.get(n) != have.get(n):
                diff.append(f"{f}.{n}: package.json {want.get(n)!r}, lock {have.get(n)!r}")
    return diff


def check_lock_sync(repo: Repo, d: PurePosixPath, kind: str, pkgs: dict[str, dict],
                    workspaces: list) -> Finding:
    rule, lock = "node-pins", _p(d, kind)
    if kind == "pnpm-lock.yaml":
        try:
            text = (repo.path / lock).read_text()
            importers = _importers(text)
            if importers is None and re.search(r"^specifiers:\s*$", text, re.M):
                importers = {".": yaml.safe_load(text)}             # lockfile v5, one project
        except (OSError, yaml.YAMLError) as exc:
            return warn(rule, f"cannot read the lockfile: {type(exc).__name__}", lock)
        if importers is None:
            return skip(rule, "lockfile format not understood; its match with package.json unchecked", lock)
        peers = not re.search(r"^\s+autoInstallPeers:\s*false\s*$", text, re.M)
        diffs = []
        for key, importer in importers.items():
            prel = _p(d / key if key != "." else d, "package.json")
            pkg = pkgs.get(prel)
            if pkg is None:
                diffs.append(f"importer {key!r} has no tracked package.json"); continue
            diffs += [f"{prel}: {x}" for x in pnpm_mismatch(pkg, importer or {}, peers)]
        mine = [w for w in workspaces if w[0] == d]
        for prel in pkgs:
            pd = PurePosixPath(prel).parent
            if pd != d and _is_member(pd, mine) and _under(pd, d) not in importers:
                diffs.append(f"{prel}: a workspace member with no importer in the lock")
    else:
        doc, err = _json(repo.path / lock)
        if doc is None:
            return warn(rule, f"lockfile does not parse ({err})", lock)
        packages = doc.get("packages")
        if not isinstance(packages, dict) or "" not in packages:
            return skip(rule, f"lockfileVersion {doc.get('lockfileVersion')}: no root entry; "
                              "its match with package.json unchecked", lock)
        diffs = npm_mismatch(pkgs[_p(d, "package.json")], packages[""])
    if diffs:
        return fail(rule, f"the lockfile does not match package.json ({len(diffs)}): " + "; ".join(diffs[:3]), lock)
    return ok(rule, "lockfile specifiers match package.json", lock)


def check_node_pins(repo: Repo, tracked: list[str], ts: set[str]) -> list[Finding]:
    rule, out = "node-pins", []
    pkgs: dict[str, dict] = {}
    for rel in (f for f in tracked if PurePosixPath(f).name == "package.json"
                and "node_modules" not in PurePosixPath(f).parts):
        doc, err = _json(repo.path / rel)
        if doc is None:
            out.append(warn(rule, f"package.json does not parse ({err})", rel)); continue
        pkgs[rel] = doc
    workspaces = _workspace_globs(repo, ts, pkgs)
    for rel, doc in sorted(pkgs.items()):
        d = PurePosixPath(rel).parent
        if _is_member(d, workspaces):
            continue                        # the workspace root pins it
        locks = [k for k in ("pnpm-lock.yaml", "package-lock.json") if _p(d, k) in ts]
        has_deps = any(doc.get(f) for f in (*DEP_FIELDS, "peerDependencies"))
        inside = any(_p(a, "package.json") in pkgs for a in d.parents) if str(d) != "." else False
        if inside and not locks and not has_deps:
            out.append(ok(rule, "a dependency-free package inside another project: nothing to pin", rel))
            continue
        pnpm = ("pnpm-lock.yaml" in locks or str(doc.get("packageManager", "")).startswith("pnpm")
                or _p(d, "pnpm-workspace.yaml") in ts)
        missing = []
        if not locks:
            missing.append("a lockfile (pnpm-lock.yaml or package-lock.json)")
        if not (doc.get("engines") or {}).get("node"):
            missing.append("engines.node")
        if _p(d, ".nvmrc") not in ts and ".nvmrc" not in ts:
            missing.append(".nvmrc (in its directory or at the repo root)")
        if pnpm and not doc.get("packageManager"):
            missing.append("packageManager (a pnpm project)")
        if len(locks) > 1:
            out.append(warn(rule, "both pnpm-lock.yaml and package-lock.json: one package manager, one lock", rel))
        if missing:
            out.append(fail(rule, "missing " + ", ".join(missing), rel))
        else:
            out.append(ok(rule, f"{'pnpm' if pnpm else 'npm'} project: lockfile, engines.node, .nvmrc"
                               + (", packageManager" if pnpm else "") + " present", rel))
        for k in locks:
            out.append(check_lock_sync(repo, d, k, pkgs, workspaces))
    return out


# sibling imports -----------------------------------------------------------------

SYS_PATH = re.compile(r"\bsys\.path\.(?:insert|append)\s*\(")
ENV_ROOT = re.compile(r"\b([A-Z][A-Z0-9_]*)_ROOT\b")


def _code_lines(text: str):
    for i, ln in enumerate(text.splitlines(), 1):
        if not ln.lstrip().startswith("#"):
            yield i, ln


def sibling_refs(ctx: Context, repo: Repo, text: str) -> list[tuple[int, str]]:
    """(line, what) for every mention of another repo's checkout in `text`'s code lines."""
    names = {n.lower() for n in ctx.repo_names()}
    own = repo.name.lower()
    refs = []
    for i, ln in _code_lines(text):
        for pat, target in ctx.sibling_patterns:
            for m in pat.finditer(ln):
                name = target or next((g for g in m.groups() if g), None)
                if name is not None and name.lower() == own:
                    continue
                refs.append((i, name or m.group(0)))
        for m in ENV_ROOT.finditer(ln):
            name = m.group(1).lower().replace("_", "-")
            if name != own and name in names:
                refs.append((i, f"${m.group(0)}"))
    return refs


def foreign_path_edits(text: str) -> list[int]:
    """Lines that put something on sys.path other than a path derived from `__file__`.

    `sys.path.insert(0, str(Path(__file__).parents[2]))` is a repo reaching its own
    root, which the event-atoms t_line scripts do while reading arcagi2026's DATA:
    no import crosses a repo there, so it does not count.
    """
    lines = text.splitlines()
    out = []
    for i, ln in _code_lines(text):
        m = SYS_PATH.search(ln)
        if m and "__file__" not in ln[m.end():] + (lines[i] if i < len(lines) else ""):
            out.append(i)
    return out


def check_sibling_import(ctx: Context, repo: Repo, sources: dict[str, str]) -> list[Finding]:
    rule, out, n = "sibling-import", [], 0
    for rel, text in sources.items():
        if "archive" in PurePosixPath(rel).parts:
            continue
        n += 1
        edits = foreign_path_edits(text)
        if not edits:
            continue
        refs = sibling_refs(ctx, repo, text)
        if refs:
            line, what = refs[0]
            out.append(fail(rule, f"names another repo's checkout ({what}, line {line}) and puts a path "
                                  "on sys.path: depend on a tagged package instead", rel, edits[0]))
    if not out:
        out.append(ok(rule, f"{n} tracked .py files: no sys.path import from another repo"))
    return out


# manifests -----------------------------------------------------------------------

def check_manifest_dirty(repo: Repo, ts: set[str]) -> list[Finding]:
    rule, rel = "manifest-dirty", "orchard.yaml"
    path = repo.path / rel
    if not path.exists():
        return []
    try:
        text = path.read_text()
        doc = yaml.safe_load(text) or {}
    except (OSError, yaml.YAMLError) as exc:
        return [warn(rule, f"orchard.yaml does not parse ({type(exc).__name__})", rel)]
    out, pos = [], 0
    for a in doc.get("artefacts") or []:
        commit = str((a or {}).get("commit") or "")
        if commit.endswith("-dirty"):
            i = text.find(commit, pos)
            pos = i + 1 if i >= 0 else pos
            out.append(warn(rule, f"{a.get('kind', '?')} {a.get('path', '?')} was made at {commit}: "
                                  "not rebuildable from its sha; re-harvest from a clean tree",
                            rel, _line_of(text, commit, max(i, 0)) if i >= 0 else None))
    if not out:
        out.append(ok(rule, f"{len(doc.get('artefacts') or [])} artefacts, none made on a dirty tree", rel))
    return out


def check_fund_copies(ctx: Context, repo: Repo) -> list[Finding]:
    """trees/*.yaml byte-equal to what `orchard trees refresh` writes (portfolio.refresh,
    without the write): the resolution is the same, the bytes come from mirror_bytes."""
    from .manifest import load                                   # noqa: PLC0415
    from .portfolio import CANONICAL, mirror_bytes              # noqa: PLC0415
    rule, out = "fund-copies", []
    container = next((r for r in ctx.cfg.roots if not is_checkout(r)), ctx.home / "weichseltree")
    for fund in sorted((repo.path / "trees").glob("*.yaml")):
        name, rel = fund.stem, f"trees/{fund.name}"
        root = None
        try:
            root = Path(str(yaml.safe_load(fund.read_text())["path"])).expanduser()
        except Exception:                                         # noqa: BLE001
            root = None
        root = root or container / name
        src = root / CANONICAL
        if not root.is_dir() or not src.exists():
            continue                         # the fund copy IS the manifest here
        try:
            tree = load(src)
        except Exception as exc:                                  # noqa: BLE001
            out.append(fail(rule, f"{src} does not load ({type(exc).__name__}), so it is never mirrored", rel))
            continue
        if tree.name != name:
            out.append(fail(rule, f"{src} names itself {tree.name!r}", rel)); continue
        if fund.read_bytes() != mirror_bytes(src):
            out.append(fail(rule, f"differs from {src}: run `uv run orchard trees refresh {name}`", rel))
        else:
            out.append(ok(rule, f"mirrors {src}", rel))
    return out


# tags ----------------------------------------------------------------------------

def github_host_re(home: Path) -> str:
    """github.com, a `github.com-<name>` host alias, or any ssh config Host whose HostName is github.com."""
    hosts = [r"github\.com(?:-[\w.-]+)?"]
    try:
        text = (home / ".ssh" / "config").read_text(errors="replace")
    except OSError:
        text = ""
    current: list[str] = []
    for ln in text.splitlines():
        words = ln.split("#", 1)[0].split()
        if len(words) < 2:
            continue
        key = words[0].lower()
        if key == "host":
            current = [h for h in words[1:] if not any(c in h for c in "*?!")]
        elif key == "hostname" and words[1].lower() == "github.com":
            hosts += [re.escape(h) for h in current]
    return "(?:" + "|".join(hosts) + ")"


def github_slug(url: str, host: str) -> str | None:
    """`owner/name` (lower case) of a GitHub repo URL, in any spelling git and uv accept:
    https://github.com/o/n, ssh://git@<alias>/o/n.git, git@<alias>:o/n.git (a `git+` prefix allowed)."""
    tail = r"/(?P<o>[\w.-]+)/(?P<n>[\w.-]+?)(?:\.git)?/?$"
    m = (re.match(r"(?:git\+)?(?:https?|ssh|git)://(?:[^@/]+@)?" + host + r"(?::\d+)?" + tail, url, re.I)
         or re.match(r"(?:[\w.-]+@)?" + host + r":" + tail[1:], url, re.I))
    return f"{m['o']}/{m['n']}".lower() if m else None


DIRECT_URL = re.compile(r"git\+[^\s;]+")
VERSIONISH = re.compile(r"(?:^|[-_])v?\d+(?:\.\d+)+$")


def _pins(doc: dict, host: str) -> list[tuple[str, str, str, str]]:
    """(dependency, kind, ref, owner/name) for each git pin on a GitHub repo in a TOML document."""
    pins = []
    sources = ((doc.get("tool") or {}).get("uv") or {}).get("sources") or {}
    for dep, spec in sources.items():
        for s in spec if isinstance(spec, list) else [spec]:
            slug = github_slug(str(s.get("git", "")), host) if isinstance(s, dict) else None
            if slug:
                kind = next((k for k in ("tag", "rev", "branch") if s.get(k)), "")
                pins.append((dep, kind, str(s.get(kind, "")) if kind else "", slug))
    proj = doc.get("project") or {}
    reqs = list(doc.get("dependencies") or []) + list(proj.get("dependencies") or [])
    for group in list((proj.get("optional-dependencies") or {}).values()) + \
            list((doc.get("dependency-groups") or {}).values()):
        reqs += [r for r in group if isinstance(r, str)]
    for r in reqs:
        m = DIRECT_URL.search(str(r))
        if not m:
            continue
        url = m.group(0).split("#", 1)[0]
        try:
            parsed = urlsplit(url.removeprefix("git+"))
        except ValueError:
            continue
        # Split inside the path: SSH's user@host is not a revision separator,
        # and the ref itself may contain slashes (feature/fix, release/v1.0.0).
        path, _, ref = parsed.path.partition("@")
        slug = github_slug(parsed._replace(path=path).geturl(), host)
        if slug:
            dep = str(r).split("@")[0].strip()
            pins.append((dep, "tag" if VERSIONISH.search(ref) else "ref" if ref else "", ref, slug))
    return pins


def check_pinned_tags(ctx: Context, repo: Repo, tracked: list[str], sources: dict[str, str]) -> list[Finding]:
    """A git pin on a repo the audit knows (by its checkout's origin) names a tag it has, here and on origin."""
    rule, out = "pinned-tags", []
    docs = []
    for rel in (f for f in tracked if PurePosixPath(f).name == "pyproject.toml"):
        doc, _ = _toml(repo.path / rel)
        if doc:
            docs.append((rel, doc, None))
    for rel, text in sources.items():
        if SCRIPT_HEADER.search(text):
            doc, _ = pep723_block(text)
            if doc:
                docs.append((rel, doc, text))
    for rel, doc, text in docs:
        text = text if text is not None else (repo.path / rel).read_text(errors="replace")
        for dep, kind, ref, slug in _pins(doc, ctx.github):
            target = ctx.by_origin().get(slug)
            if target is None:
                continue                     # not a repo this box audits: nothing to compare against
            line = _line_of(text, ref) if ref else None
            if kind != "tag":
                out.append(warn(rule, f"{dep} pins {slug} by {kind or 'nothing'}"
                                      f"{' ' + ref if ref else ''}, not by a tag", rel, line))
                continue
            name = target.name
            if ref not in ctx.local_tags(target):
                out.append(fail(rule, f"{dep} pins tag {ref}, which {name} does not have", rel, line))
                continue
            remote, why = ctx.remote_tags(target)
            if remote is None:
                out.append(skip(rule, f"{dep} pins tag {ref}: in {name}; origin could not be checked ({why})",
                                rel, line))
            elif ref not in remote:
                out.append(fail(rule, f"{dep} pins tag {ref}, which {name} has but is not on origin "
                                      f"(git -C {target.path} push origin {ref})", rel, line))
            else:
                out.append(ok(rule, f"{dep} pins tag {ref}, in {name} and on its origin", rel, line))
    return out


# orchard's own -------------------------------------------------------------------

def check_toolchain() -> list[Finding]:
    from .toolchain import TOOLS, report                        # noqa: PLC0415
    rule, out = "toolchain", []
    for p in report():
        what = f"{p.name}: found {p.version or '?'}, expected {p.expected}"
        if p.status == "ok":
            out.append(ok(rule, what, "orchard/toolchain.py"))
        elif p.status == "mismatch" and not p.version:
            out.append(warn(rule, f"{p.name} at {p.path} printed no version it could read "
                                  f"(expected {p.expected}): {_short(p.banner or 'no output', 100)}",
                            "orchard/toolchain.py"))
        elif p.status == "mismatch":
            out.append(fail(rule, f"{what} ({p.path})", "orchard/toolchain.py"))
        else:
            out.append(warn(rule, f"{p.name} not found (expected {p.expected}; {TOOLS[p.name].note})",
                            "orchard/toolchain.py"))
    return out


def pnpm_exe() -> str | None:
    for c in (shutil.which("pnpm"), str(Path.home() / ".local/share/pnpm/pnpm")):
        if c and Path(c).is_file() and os.access(c, os.X_OK):
            return c
    return None


def _run_script(path: str, *args: str) -> list[str]:
    p = Path(path)
    try:
        head = p.read_bytes()[:128]
    except OSError:
        return [path, *args]
    if not head.startswith(b"#!"):
        return [path, *args]
    shell = shutil.which("bash") or shutil.which("sh")
    if shell is None:
        return [path, *args]
    return [shell, path, *args]


def check_bindings(repo: Repo) -> list[Finding]:
    rule, rel = "bindings", "grove/package.json"
    doc, _ = _json(repo.path / rel)
    if not doc or "check:bindings" not in (doc.get("scripts") or {}):
        return [skip(rule, "grove/package.json has no check:bindings script yet", rel)]
    pnpm = pnpm_exe()
    if pnpm is None:
        return [skip(rule, "pnpm not found", rel)]
    cmd = _run_script(pnpm, "-C", "grove", "run", "check:bindings")
    r = run(cmd, repo.path, BINDINGS_TIMEOUT)
    last = next((ln.strip() for ln in reversed(r.text.splitlines()) if ln.strip().startswith("bindings:")), "")
    if r.rc == 0:
        return [ok(rule, last or "check:bindings passes", "grove/src/module_bindings")]
    if r.rc == 1:
        return [fail(rule, _short(" ".join(ln.strip() for ln in r.text.splitlines()
                                           if ln.strip() and not ln.startswith(">"))) or "stale",
                     "grove/src/module_bindings")]
    return [warn(rule, "check:bindings could not run: " + (r.why or last or _first_error(r.text)),
                 "grove/src/module_bindings")]


# --- one repo, all repos -------------------------------------------------------------

def tracked_files(repo: Repo) -> tuple[list[str] | None, str]:
    r = run(["git", "-C", str(repo.path), "ls-files", "-z"], repo.path, GIT_TIMEOUT)
    if r.rc != 0:
        return None, r.why or _first_error(r.err)
    return [f for f in r.out.split("\0") if f], ""


def read_sources(repo: Repo, tracked: list[str]) -> dict[str, str]:
    out = {}
    for rel in tracked:
        if not rel.endswith(".py"):
            continue
        p = repo.path / rel
        try:
            if p.stat().st_size <= MAX_PY_BYTES:
                out[rel] = p.read_text(errors="replace")
        except OSError:
            continue                          # tracked but deleted in the working tree
    return out


def audit_repo(ctx: Context, repo: Repo) -> list[Finding]:
    tracked, why = tracked_files(repo)
    if tracked is None:
        return [skip("python-lock", f"git ls-files failed: {why}")]
    ts = set(tracked)
    sources = read_sources(repo, tracked)
    out = []
    for check in (lambda: check_python_lock(repo, tracked, ts),
                  lambda: check_script_lock(repo, sources, ts),
                  lambda: check_node_pins(repo, tracked, ts),
                  lambda: check_sibling_import(ctx, repo, sources),
                  lambda: check_manifest_dirty(repo, ts),
                  lambda: check_pinned_tags(ctx, repo, tracked, sources)):
        try:
            out += check()
        except Exception as exc:                                  # noqa: BLE001
            out.append(warn("audit", f"a check crashed: {type(exc).__name__}: {_short(str(exc), 160)}"))
    if repo is ctx.orchard:
        out += check_fund_copies(ctx, repo)
    return out


def apply_waivers(results: dict[str, list[Finding]], waivers: list[dict], audited: set[str]) -> None:
    """Mark matching findings waived; a waiver that matches nothing becomes a warn of its own."""
    for w in waivers:
        repo, rule, path, reason = (str(w.get(k) or "") for k in ("repo", "rule", "path", "reason"))
        if repo not in audited:
            continue
        if not (rule and path and reason.strip()):
            results[repo].append(warn("waiver", f"a waiver in audit.yaml lacks rule, path or reason: {w}"))
            continue
        hit = False
        for f in results[repo]:
            if f.rule == rule and f.status in ("fail", "warn") and fnmatch.fnmatchcase(f.path, path):
                f.waived, hit = reason.strip(), True
        if not hit:
            results[repo].append(warn("waiver", f"the {rule} waiver for {path} matches nothing: "
                                                "remove it from audit.yaml", "audit.yaml"))


ORDER = {"fail": 0, "warn": 1, "skip": 3, "ok": 4}


def _rank(f: dict) -> tuple:
    return (2 if f["waived"] else ORDER[f["status"]], f["rule"], f["path"], f["line"] or 0)


def counts(findings: list[dict]) -> dict:
    c = {"fail": 0, "warn": 0, "skip": 0, "ok": 0, "waived": 0}
    for f in findings:
        c["waived" if f["waived"] and f["status"] in ("fail", "warn") else f["status"]] += 1
    return c


def audit(names: list[str] | None = None, cfg: Config | None = None, home: Path | None = None,
          toolchain: bool = True, workers: int = 12) -> dict:
    """The report: every live repo's findings (or only `names`), with counts and a summary."""
    t0 = time.time()
    put_tools_on_path()
    cfg = cfg or load_config()
    repos = discover(cfg)
    ctx = Context(cfg, repos, home)
    unknown = sorted(set(names or []) - {r.name for r in repos})
    live = [r for r in repos if r.state == "live" and (not names or r.name in names)]
    results: dict[str, list[Finding]] = {r.name: [] for r in live}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = {pool.submit(audit_repo, ctx, r): r.name for r in live}
        if ctx.orchard is not None and ctx.orchard.name in results:
            jobs[pool.submit(check_bindings, ctx.orchard)] = ctx.orchard.name
            if toolchain:
                jobs[pool.submit(check_toolchain)] = ctx.orchard.name
        for fut, name in jobs.items():
            try:
                results[name] += fut.result()
            except Exception as exc:                              # noqa: BLE001
                results[name].append(warn("audit", f"crashed: {type(exc).__name__}: {_short(str(exc), 160)}"))
    apply_waivers(results, cfg.waivers, set(results))
    entries = []
    for r in live:
        rows = sorted((f.as_dict() for f in results[r.name]), key=_rank)
        entries.append({"name": r.name, "path": str(r.path), "counts": counts(rows), "results": rows})
    entries.sort(key=lambda e: (-e["counts"]["fail"], -e["counts"]["warn"], e["name"]))
    total = counts([f for e in entries for f in e["results"]])
    now = datetime.now(timezone.utc)
    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "generated_at_unix": round(now.timestamp(), 3),
        "duration_s": round(time.time() - t0, 2),
        "partial": bool(names),
        "summary": {"repos": len(entries), **total,
                    "archived": sorted(r.name for r in repos if r.state == "archived"),
                    "out_of_scope": sorted(r.name for r in repos if r.state == "out_of_scope"),
                    "unknown": unknown},
        "repos": entries,
    }


def write(report: dict, out: Path | None = None) -> Path:
    out = out or OUT
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f".{out.name}.tmp")
    tmp.write_text(json.dumps(report, indent=1) + "\n")
    tmp.replace(out)
    return out


LABEL = {"fail": "FAIL", "warn": "warn", "skip": "skip", "ok": "ok"}


def render(report: dict, show_ok: bool = False) -> str:
    """The compact table: repos with failures first, each repo's failures first."""
    s = report["summary"]
    lines = [f"orchard audit · {s['repos']} repos · {s['fail']} fail · {s['warn']} warn · "
             f"{s['waived']} waived · {s['skip']} skip · {s['ok']} ok · {report['duration_s']:.1f} s"]
    clean = []
    for e in report["repos"]:
        rows = [f for f in e["results"] if show_ok or f["status"] != "ok"]
        c = e["counts"]
        if not rows:
            clean.append(f"{e['name']} ({c['ok']})"); continue
        lines.append("")
        lines.append(f"{e['name']}  " + "  ".join(f"{c[k]} {k}" for k in ("fail", "warn", "waived", "skip", "ok") if c[k]))
        w = max(len(f["where"]) for f in rows)
        for f in rows:
            label = "waived" if f["waived"] else LABEL[f["status"]]
            detail = f["detail"] + (f"  [waived: {f['waived']}]" if f["waived"] else "")
            lines.append(f"  {label:<6} {f['rule']:<14} {f['where']:<{min(w, 48)}}  {detail}")
    if clean:
        lines += ["", "clean (ok checks): " + ", ".join(clean)]
    if s["archived"]:
        lines.append("archived, not checked: " + ", ".join(s["archived"]))
    if s["out_of_scope"]:
        lines.append("out of scope: " + ", ".join(s["out_of_scope"]))
    if s["unknown"]:
        lines.append("no such live repo: " + ", ".join(s["unknown"]))
    return "\n".join(lines)
