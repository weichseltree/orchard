"""The tools orchard shells out to: where each is found, and which version it expects.

    uv run orchard doctor        # every tool: ok / mismatch / missing

A bundle's bytes depend on the encoder that made them, so the version that
made a bundle is recorded in its `bundle.json` (`tools`), and the versions
this box is expected to run are named here, once. `orchard doctor` compares
the two. Nothing refuses to run on a mismatch: the record is what makes a
changed encoder visible, and the doctor is where it is noticed.

An expected version is a PREFIX of dotted components: `6.1.1` accepts
`6.1.1-3ubuntu5`, `22` accepts any Node 22, and `6.1.1` does not accept
`6.1.10`. Resolution tries each candidate path in order, so a tool pinned in
the repo (the grove's `node_modules/.bin/wrangler`) wins over a global one.
"""
from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Callable

from . import ROOT

HOME = Path.home()


@dataclass(frozen=True)
class Tool:
    name: str
    expected: str
    candidates: Callable[[], list]      # paths to try, in order; None entries skipped
    args: tuple = ("--version",)
    pattern: str = r"(\d+(?:\.\d+)+)"  # first group: the version
    banner: str = r".+"                 # the line recorded as the banner
    note: str = ""


def _which(name: str) -> str | None:
    return shutil.which(name)


TOOLS: dict[str, Tool] = {t.name: t for t in [
    Tool("ffmpeg", "6.1.1", lambda: [_which("ffmpeg")], ("-version",),
         r"ffmpeg version (\S+)", r"ffmpeg version .*",
         "video and still bundles; the banner goes into every bundle.json"),
    Tool("toktx", "4.4.2",
         lambda: [_which("toktx"),
                  str(HOME / "tools/ktx/KTX-Software-4.4.2-Linux-x86_64/bin/toktx")],
         pattern=r"v?(\d+\.\d+\.\d+)",
         note="KTX-Software; the lightmap tiers (grove/tools/palace/palace.py)"),
    Tool("blender", "4.2.1", lambda: [str(HOME / "tools/blender/blender")],
         pattern=r"Blender (\d+\.\d+\.\d+)", banner=r"Blender .*",
         note="4.2.1 LTS; the palace bakes"),
    Tool("spacetime", "2.10.0",
         lambda: [_which("spacetime"), str(HOME / ".local/bin/spacetime")],
         pattern=r"tool version (\d+\.\d+\.\d+)", banner=r".*tool version.*",
         note="the live database: sync, exhibit, gc"),
    Tool("wrangler", "4.131.1",
         lambda: [str(ROOT / "grove/node_modules/.bin/wrangler"),
                  str(HOME / ".local/share/pnpm/wrangler"), _which("wrangler")],
         note="Pages deploys, push --method wrangler; the grove pins it"),
    Tool("node", "22",
         lambda: [_which("node"),
                  *sorted(glob.glob(str(HOME / ".nvm/versions/node/v22*/bin/node")),
                          reverse=True)],
         pattern=r"v?(\d+\.\d+\.\d+)", note="the grove's build and wrangler"),
]}


@dataclass(frozen=True)
class Probe:
    name: str
    expected: str
    path: str | None
    version: str | None
    banner: str | None

    @property
    def status(self) -> str:
        if self.path is None:
            return "missing"
        return "ok" if version_matches(self.version, self.expected) else "mismatch"


def version_matches(found: str | None, expected: str) -> bool:
    """`found`'s leading dotted numbers start with every component of `expected`."""
    if not found:
        return False
    m = re.match(r"v?(\d+(?:\.\d+)*)", found)
    if not m:
        return False
    have, want = m.group(1).split("."), expected.split(".")
    return have[:len(want)] == want


def resolve(name: str) -> str | None:
    """The first candidate path for `name` that exists and is executable."""
    for c in TOOLS[name].candidates():
        if not c:
            continue
        p = Path(c)
        if not p.is_file():
            continue
        if os.access(c, os.X_OK):
            return str(c)
        try:
            text = p.read_text(encoding="utf-8")
        except OSError:
            continue
        if text.startswith("#!"):
            return str(c)
    return None


def _bash_env() -> dict[str, str]:
    env = os.environ.copy()
    if os.name != "nt":
        return env
    git_roots = [
        Path(r"C:\Program Files\Git"),
        Path(r"C:\Program Files\Git\usr\bin"),
        Path(r"C:\Program Files\Git\bin"),
        Path(r"C:\Program Files\Git\mingw64\bin"),
    ]
    extra = [str(p) for p in git_roots if p.exists()]
    if extra:
        env["PATH"] = os.pathsep.join([*extra, env.get("PATH", "")])
    env.setdefault("MSYSTEM", "MINGW64")
    return env


@lru_cache(maxsize=1)
def _bash_drive_prefix() -> str:
    """The Windows-drive mount used by the available bash (WSL or Git Bash)."""
    if os.name != "nt":
        return ""
    try:
        mounted = subprocess.run(
            ["bash", "-c", "test -d /mnt/c"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
            env=_bash_env(),
        ).returncode == 0
    except (OSError, subprocess.SubprocessError):
        mounted = False
    return "/mnt" if mounted else ""


def _bash_path(path: str) -> str:
    if os.name != "nt":
        return path
    p = path.replace("\\", "/")
    if len(p) >= 2 and p[1] == ":":
        drive = p[0].lower()
        rest = p[2:].lstrip("/")
        return f"{_bash_drive_prefix()}/{drive}/{rest}"
    return p


def _run_tool(path: str, args: tuple[str, ...]) -> str:
    if os.name == "nt":
        p = Path(path)
        try:
            head = p.read_bytes()[:2]
        except OSError:
            head = b""
        if head.startswith(b"#!") or p.suffix.lower() in {".sh", ".bash"}:
            out = subprocess.run(["bash", _bash_path(str(p)), *args], capture_output=True,
                                 text=True, timeout=60, env=_bash_env())
            return (out.stdout or "") + "\n" + (out.stderr or "")
    out = subprocess.run([path, *args], capture_output=True, text=True, timeout=60,
                         env=_bash_env())
    return (out.stdout or "") + "\n" + (out.stderr or "")


@lru_cache(maxsize=None)
def probe(name: str) -> Probe:
    """Where `name` is and what it says its version is. Cached per process."""
    tool = TOOLS[name]
    path = resolve(name)
    if path is None:
        return Probe(name, tool.expected, None, None, None)
    try:
        text = _run_tool(path, tool.args)
    except (OSError, subprocess.SubprocessError) as exc:
        return Probe(name, tool.expected, path, None, f"{type(exc).__name__}: {exc}")
    m = re.search(tool.pattern, text)
    line = next((ln.strip() for ln in text.splitlines()
                 if ln.strip() and re.fullmatch(tool.banner, ln.strip())), None)
    return Probe(name, tool.expected, path, m.group(1) if m else None, line)


def record(*names: str) -> dict[str, str]:
    """`{tool: banner}` for `bundle.json:tools`: what made the bundle, verbatim.

    The banner, not a parsed number, because the build string (`6.1.1-3ubuntu5`)
    is what pins the libraries; and never the path, which would make the id
    depend on the machine.
    """
    out = {}
    for n in names:
        p = probe(n)
        out[n] = p.banner or p.version or "missing"
    return out


def report() -> list[Probe]:
    return [probe(n) for n in TOOLS]
