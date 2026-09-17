"""orchard audit over a synthetic ~/weichseltree of tiny git repos: one per check, ok and fail."""
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import orchard.audit as A
from orchard.toolchain import Probe

GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main",
       "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"]
UV_ENV = {k: v for k, v in os.environ.items() if k not in A.DROP_ENV}
ORCHARD_URL = "https://github.com/weichseltree/orchard"


def git(repo: Path, *args: str) -> str:
    return subprocess.run([*GIT, "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


def make_repo(root: Path, name: str, files: dict[str, str], commit: bool = True) -> Path:
    repo = root / name
    repo.mkdir(parents=True)
    git(repo, "init", "-q")
    for rel, text in files.items():
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_text(text)
    if commit:
        commit_all(repo)
    return repo


def commit_all(repo: Path) -> None:
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "c", "--allow-empty")


def uv(cwd: Path, *args: str) -> None:
    subprocess.run(["uv", *args, "--offline", "--quiet"], cwd=cwd, check=True, env=UV_ENV)


def pyproject(name: str, version: str = "0.1.0", extra: str = "") -> str:
    return (f'[project]\nname = "{name}"\nversion = "{version}"\nrequires-python = ">=3.12"\n'
            f"dependencies = []\n{extra}")


@pytest.fixture
def tree(tmp_path, monkeypatch):
    """tmp_path is $HOME: ~/weichseltree holds the repos; audit(tree) runs over them."""
    monkeypatch.setenv("PATH", os.environ["PATH"])        # audit() puts node and pnpm on it
    home = tmp_path
    wt = home / "weichseltree"
    wt.mkdir()

    def run(names=None, waivers=(), archived=(), out_of_scope=(), extra_roots=()):
        cfg = A.Config(roots=[wt, *extra_roots], archived=set(archived), out_of_scope=set(out_of_scope),
                       waivers=list(waivers))
        return A.audit(names, cfg=cfg, home=home, toolchain=False)
    run.home, run.root = home, wt
    return run


def findings(report, repo, rule=None):
    entry = next(e for e in report["repos"] if e["name"] == repo)
    return [f for f in entry["results"] if rule is None or f["rule"] == rule]


def statuses(report, repo, rule):
    return sorted(f["status"] for f in findings(report, repo, rule))


# --- discovery -----------------------------------------------------------------------

def test_discovery_skips_non_git_and_lists_archived_and_out_of_scope(tree):
    make_repo(tree.root, "live", {"README.md": "x"})
    make_repo(tree.root, "old", {"README.md": "x"})
    make_repo(tree.root, "theirs", {"README.md": "x"})
    (tree.root / "Art").mkdir()                       # not a checkout: silently passed over
    extra = make_repo(tree.home / "kaggle", "arcagi", {"README.md": "x"})
    rep = tree(archived=["old"], out_of_scope=["theirs"], extra_roots=[extra])
    assert [e["name"] for e in rep["repos"]] == ["arcagi", "live"]
    assert rep["summary"]["archived"] == ["old"] and rep["summary"]["out_of_scope"] == ["theirs"]
    assert "Art" not in json.dumps(rep)


def test_a_worktree_checkout_is_its_own_entry(tree):
    main = make_repo(tree.root, "life", {"pyproject.toml": pyproject("life")})
    git(main, "worktree", "add", "-q", "-b", "side", str(tree.root / "life-side"))
    rep = tree()
    assert {e["name"] for e in rep["repos"]} == {"life", "life-side"}
    assert statuses(rep, "life-side", "python-lock") == ["fail"]


# --- python-lock ---------------------------------------------------------------------

def test_python_lock_passes_a_current_lock_and_fails_a_missing_or_stale_one(tree):
    good = make_repo(tree.root, "good", {"pyproject.toml": pyproject("good")}, commit=False)
    uv(good, "lock"); commit_all(good)
    stale = make_repo(tree.root, "stale", {"pyproject.toml": pyproject("stale")}, commit=False)
    uv(stale, "lock"); commit_all(stale)
    (stale / "pyproject.toml").write_text(pyproject("stale", version="0.2.0"))
    make_repo(tree.root, "none", {"pyproject.toml": pyproject("none"),
                                  "tools/pyproject.toml": "[tool.ruff]\nline-length = 100\n"})
    rep = tree()
    assert statuses(rep, "good", "python-lock") == ["ok"]
    [f] = findings(rep, "stale", "python-lock")
    assert f["status"] == "fail" and f["where"] == "uv.lock" and "does not match" in f["detail"]
    [f] = findings(rep, "none", "python-lock")        # tool-only pyproject: nothing to lock
    assert f["status"] == "fail" and f["where"] == "pyproject.toml"


def test_a_workspace_member_is_locked_at_the_workspace_root(tree):
    repo = make_repo(tree.root, "ws", {
        "pyproject.toml": pyproject("ws", extra='[tool.uv.workspace]\nmembers = ["packages/*"]\n'),
        "packages/lib/pyproject.toml": pyproject("lib"),
    }, commit=False)
    uv(repo, "lock"); commit_all(repo)
    rep = tree()
    got = {f["where"]: f["status"] for f in findings(rep, "ws", "python-lock")}
    assert got == {"packages/lib/pyproject.toml": "ok", "uv.lock": "ok"}


def test_an_uncommitted_lock_does_not_count(tree):
    repo = make_repo(tree.root, "loose", {"pyproject.toml": pyproject("loose")})
    uv(repo, "lock")                                   # written, never committed
    [f] = findings(tree(), "loose", "python-lock")
    assert f["status"] == "fail" and "not committed" in f["detail"]


def test_requirements_need_a_pinned_freeze_without_a_pyproject(tree):
    make_repo(tree.root, "frozen", {"requirements.txt": "numpy\n",
                                    "requirements.lock.txt": "# frozen\nnumpy==2.1.0\ntorch==2.5.1+cu121\n"})
    make_repo(tree.root, "loose", {"requirements.txt": "numpy\n",
                                   "requirements.lock.txt": "numpy==2.1.0\nrequests>=2\n"})
    make_repo(tree.root, "bare", {"requirements.txt": "numpy\n"})
    rep = tree()
    assert statuses(rep, "frozen", "python-lock") == ["ok"]
    [f] = findings(rep, "loose", "python-lock")
    assert f["status"] == "fail" and "requests>=2" in f["detail"]
    assert statuses(rep, "bare", "python-lock") == ["fail"]


# --- script-lock ---------------------------------------------------------------------

SCRIPT = '# /// script\n# requires-python = ">=3.12"\n# dependencies = []\n# ///\nprint("hi")\n'


def vendored(files: dict[str, str], **doc) -> dict[str, str]:
    """A vendored copy under src/vendor/pkg/, plus the manifest that describes it."""
    manifest = {"upstream": "https://example.invalid/up", "commit": "abc1234", "version": "0.1.0",
                "files": {k: {"sha256": hashlib.sha256(v.encode()).hexdigest()} for k, v in files.items()},
                **doc}
    out = {f"src/vendor/pkg/{k}": v for k, v in files.items()}
    out["src/vendor/pkg/VENDORED.json"] = json.dumps(manifest, indent=1)
    return out


def test_vendored_passes_a_copy_that_matches_its_manifest(tree):
    make_repo(tree.root, "consumer", vendored({"cat.ts": "export const a = 1;\n", "LICENSE": "AGPL\n"}))
    [f] = findings(tree(), "consumer", "vendored")
    assert f["status"] == "ok" and f["where"] == "src/vendor/pkg/VENDORED.json"
    assert "2 files match https://example.invalid/up at abc1234" in f["detail"]


def test_vendored_fails_a_file_edited_in_the_copy(tree):
    repo = make_repo(tree.root, "consumer", vendored({"cat.ts": "export const a = 1;\n"}))
    (repo / "src/vendor/pkg/cat.ts").write_text("export const a = 2;  // fixed it here\n")
    commit_all(repo)
    [f] = findings(tree(), "consumer", "vendored")
    assert f["status"] == "fail" and f["where"] == "src/vendor/pkg/cat.ts"
    assert "lost at the next sync" in f["detail"]


def test_vendored_fails_a_file_missing_from_the_copy_and_one_it_does_not_list(tree):
    files = vendored({"cat.ts": "export const a = 1;\n"})
    del files["src/vendor/pkg/cat.ts"]
    files["src/vendor/pkg/extra.ts"] = "export const b = 2;\n"
    make_repo(tree.root, "consumer", files)
    got = findings(tree(), "consumer", "vendored")
    assert {f["status"] for f in got} == {"fail"}
    assert {f["where"] for f in got} == {"src/vendor/pkg/cat.ts", "src/vendor/pkg/extra.ts"}


def test_vendored_warns_when_the_sync_came_from_a_dirty_tree(tree):
    make_repo(tree.root, "consumer", vendored({"cat.ts": "export const a = 1;\n"}, dirty=True))
    got = findings(tree(), "consumer", "vendored")
    assert sorted(f["status"] for f in got) == ["ok", "warn"]
    assert any("dirty tree" in f["detail"] for f in got)


def test_vendored_fails_a_manifest_that_does_not_parse(tree):
    make_repo(tree.root, "consumer", {"src/vendor/pkg/VENDORED.json": "{not json",
                                      "src/vendor/pkg/cat.ts": "export const a = 1;\n"})
    [f] = findings(tree(), "consumer", "vendored")
    assert f["status"] == "fail" and "does not parse" in f["detail"]


def test_vendored_does_not_read_a_nested_copy_as_strays_of_the_outer_one(tree):
    files = vendored({"cat.ts": "export const a = 1;\n"})
    files |= {f"src/vendor/pkg/inner/{k.split('/')[-1]}": v
              for k, v in vendored({"dog.ts": "export const b = 2;\n"}).items()}
    make_repo(tree.root, "consumer", files)
    got = findings(tree(), "consumer", "vendored")
    assert [f["status"] for f in got] == ["ok", "ok"], got
    assert {f["where"] for f in got} == {"src/vendor/pkg/VENDORED.json", "src/vendor/pkg/inner/VENDORED.json"}


def test_vendored_refuses_a_manifest_reaching_outside_the_copy(tree):
    manifest = {"upstream": "u", "commit": "c",
                "files": {"../../../etc/passwd": {"sha256": "0" * 64}}}
    make_repo(tree.root, "consumer", {"src/vendor/pkg/VENDORED.json": json.dumps(manifest)})
    [f] = findings(tree(), "consumer", "vendored")
    assert f["status"] == "fail" and "outside the copy" in f["detail"]


def test_vendored_refuses_a_symlink_rather_than_hashing_its_target(tree):
    repo = make_repo(tree.root, "consumer", vendored({"cat.ts": "export const a = 1;\n"}), commit=False)
    link = repo / "src/vendor/pkg/cat.ts"
    link.unlink(); link.symlink_to("/etc/hostname")
    commit_all(repo)
    [f] = findings(tree(), "consumer", "vendored")
    assert f["status"] == "fail" and "symlink" in f["detail"]


def test_vendored_costs_one_finding_when_a_file_cannot_be_read(tree):
    repo = make_repo(tree.root, "consumer", vendored({"cat.ts": "export const a = 1;\n",
                                                      "b.ts": "export const b = 2;\n"}))
    locked = repo / "src/vendor/pkg/cat.ts"
    locked.chmod(0o000)
    try:
        got = findings(tree(), "consumer", "vendored")
    finally:
        locked.chmod(0o644)
    assert [f["status"] for f in got] == ["fail"] and got[0]["where"] == "src/vendor/pkg/cat.ts"
    assert "could not be read" in got[0]["detail"]


def test_vendored_accepts_an_uppercase_digest(tree):
    files = vendored({"cat.ts": "export const a = 1;\n"})
    doc = json.loads(files["src/vendor/pkg/VENDORED.json"])
    doc["files"]["cat.ts"]["sha256"] = doc["files"]["cat.ts"]["sha256"].upper()
    files["src/vendor/pkg/VENDORED.json"] = json.dumps(doc)
    make_repo(tree.root, "consumer", files)
    [f] = findings(tree(), "consumer", "vendored")
    assert f["status"] == "ok", f


def test_vendored_fails_a_manifest_with_no_provenance(tree):
    files = vendored({"cat.ts": "export const a = 1;\n"})
    doc = json.loads(files["src/vendor/pkg/VENDORED.json"]); del doc["commit"]
    files["src/vendor/pkg/VENDORED.json"] = json.dumps(doc)
    make_repo(tree.root, "consumer", files)
    got = findings(tree(), "consumer", "vendored")
    assert [f["status"] for f in got] == ["fail"]
    assert "a commit" in got[0]["detail"] and "traced" in got[0]["detail"]


def test_a_pep723_script_needs_its_lock_beside_it(tree):
    locked = make_repo(tree.root, "locked", {"tools/x.py": SCRIPT}, commit=False)
    uv(locked, "lock", "--script", "tools/x.py"); commit_all(locked)
    make_repo(tree.root, "unlocked", {"tools/x.py": SCRIPT, "tools/plain.py": "print(1)\n"})
    rep = tree()
    [f] = findings(rep, "locked", "script-lock")
    assert f["status"] == "ok" and f["where"] == "tools/x.py.lock"
    [f] = findings(rep, "unlocked", "script-lock")
    assert f["status"] == "fail" and f["where"] == "tools/x.py:1"


# --- node-pins -----------------------------------------------------------------------

PKG = {"name": "app", "engines": {"node": "22"}, "dependencies": {"left-pad": "^1.3.0"}}
NPM_LOCK = {"lockfileVersion": 3, "packages": {"": {"name": "app", "dependencies": {"left-pad": "^1.3.0"}}}}


def test_node_pins_ok_for_a_pinned_npm_project(tree):
    make_repo(tree.root, "npm", {"package.json": json.dumps(PKG), "package-lock.json": json.dumps(NPM_LOCK),
                                 ".nvmrc": "22\n"})
    assert statuses(tree(), "npm", "node-pins") == ["ok", "ok"]


def test_node_pins_fail_names_what_is_missing(tree):
    bare = {k: v for k, v in PKG.items() if k != "engines"}
    make_repo(tree.root, "npm", {"package.json": json.dumps(bare), "package-lock.json": json.dumps(NPM_LOCK)})
    make_repo(tree.root, "pnpm", {"package.json": json.dumps(PKG), "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
                                  ".nvmrc": "22\n"})
    make_repo(tree.root, "nolock", {"package.json": json.dumps(PKG), ".nvmrc": "22\n"})
    rep = tree()
    [f] = [f for f in findings(rep, "npm", "node-pins") if f["status"] == "fail"]
    assert "engines.node" in f["detail"] and ".nvmrc" in f["detail"] and "packageManager" not in f["detail"]
    [f] = [f for f in findings(rep, "pnpm", "node-pins") if f["where"] == "package.json"]
    assert f["status"] == "fail" and "packageManager" in f["detail"]
    [f] = findings(rep, "nolock", "node-pins")
    assert f["status"] == "fail" and "lockfile" in f["detail"]


def test_a_lockfile_that_disagrees_with_package_json_fails(tree):
    lock = json.loads(json.dumps(NPM_LOCK))
    lock["packages"][""]["dependencies"]["left-pad"] = "^1.0.0"
    make_repo(tree.root, "npm", {"package.json": json.dumps(PKG), "package-lock.json": json.dumps(lock),
                                 ".nvmrc": "22\n"})
    [f] = [f for f in findings(tree(), "npm", "node-pins") if f["status"] == "fail"]
    assert f["where"] == "package-lock.json" and "left-pad" in f["detail"]


PNPM_LOCK = """lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
      typescript:
        specifier: ^5.7.0
        version: 5.7.2

  packages/core:
    dependencies:
      zod:
        specifier: ^4.0.0
        version: 4.0.1

packages:

  typescript@5.7.2:
    resolution: {integrity: sha512-x}
"""


def test_a_pnpm_workspace_is_pinned_at_its_root_and_checked_per_importer(tree):
    root = {"name": "ws", "engines": {"node": "22"}, "packageManager": "pnpm@10.0.0",
            "devDependencies": {"typescript": "^5.7.0"}}
    core = {"name": "core", "dependencies": {"zod": "^4.0.0"}}     # no pins of its own: a member
    files = {"package.json": json.dumps(root), "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
             "pnpm-lock.yaml": PNPM_LOCK, ".nvmrc": "22\n", "packages/core/package.json": json.dumps(core)}
    make_repo(tree.root, "ws", files)
    assert statuses(tree(), "ws", "node-pins") == ["ok", "ok"]
    core["dependencies"]["zod"] = "^3.0.0"
    (tree.root / "ws/packages/core/package.json").write_text(json.dumps(core))
    [f] = [f for f in findings(tree(), "ws", "node-pins") if f["status"] == "fail"]
    assert f["where"] == "pnpm-lock.yaml" and "packages/core/package.json: zod" in f["detail"]


def test_pnpm_mismatch_follows_pnpm_s_rules():
    importer = {"dependencies": {"a": {"specifier": "^1", "version": "1.0.0"},
                                 "p": {"specifier": "^2", "version": "2.0.0"}}}
    pkg = {"dependencies": {"a": "^1"}, "peerDependencies": {"p": "^2"}}
    assert A.pnpm_mismatch(pkg, importer) == []                      # auto-installed peer
    assert A.pnpm_mismatch(pkg, importer, auto_install_peers=False) == ["p only in the lock"]
    moved = {"devDependencies": {"a": "^1"}, "peerDependencies": {"p": "^2"}}
    assert A.pnpm_mismatch(moved, importer) == ["dependencies differ: a", "devDependencies differ: a"]


def test_a_dependency_free_package_inside_a_project_needs_nothing(tree):
    make_repo(tree.root, "npm", {"package.json": json.dumps(PKG), "package-lock.json": json.dumps(NPM_LOCK),
                                 ".nvmrc": "22\n", "packages/rules/package.json": '{"name": "rules"}'})
    assert statuses(tree(), "npm", "node-pins") == ["ok", "ok", "ok"]


# --- sibling-import ------------------------------------------------------------------

CROSS = ('import sys\nfrom pathlib import Path\nSPECTRE = Path.home() / "weichseltree" / "spectre"\n'
         "sys.path.insert(0, str(SPECTRE))\n")


def test_a_sys_path_import_from_a_sibling_fails(tree):
    make_repo(tree.root, "spectre", {"README.md": "x"})
    make_repo(tree.root, "cross", {"film/assemble.py": CROSS,
                                   "env.py": 'import os, sys\nsys.path.append(os.environ["SPECTRE_ROOT"])\n',
                                   "tilde.py": 'import sys, os\nsys.path.insert(0, os.path.expanduser("~/weichseltree/spectre"))\n',
                                   "archive/old.py": CROSS})
    rep = tree()
    got = {f["where"]: f["status"] for f in findings(rep, "cross", "sibling-import")}
    assert got == {"film/assemble.py:4": "fail", "env.py:2": "fail", "tilde.py:2": "fail"}


def test_own_paths_data_paths_and_comments_are_not_sibling_imports(tree):
    make_repo(tree.root, "spectre", {"README.md": "x"})
    make_repo(tree.root, "self", {
        "own.py": 'import sys\nROOT = "/home/someone/weichseltree/self"\nsys.path.insert(0, ROOT)\n',
        # its own root on sys.path, a sibling's DATA read: the event-atoms t_line scripts
        "data.py": ('import sys\nfrom pathlib import Path\nsys.path.insert(0, str(Path(__file__).parents[1]))\n'
                    'D = Path("~/weichseltree/spectre/data").expanduser()\n'),
        "comment.py": "import sys\n# once loaded ~/weichseltree/spectre\nsys.path.insert(0, 'lib')\n",
    })
    assert statuses(tree(), "self", "sibling-import") == ["ok"]


def test_a_waiver_keeps_the_finding_visible_without_failing(tree):
    make_repo(tree.root, "spectre", {"README.md": "x"})
    make_repo(tree.root, "cross", {"film/assemble.py": CROSS})
    waiver = {"repo": "cross", "rule": "sibling-import", "path": "film/assemble.py", "reason": "BACKLOG 31"}
    stale = {"repo": "cross", "rule": "sibling-import", "path": "gone.py", "reason": "fixed long ago"}
    rep = tree(waivers=[waiver, stale])
    [f] = [f for f in findings(rep, "cross", "sibling-import") if f["status"] == "fail"]
    assert f["waived"] == "BACKLOG 31"
    assert rep["summary"]["fail"] == 0 and rep["summary"]["waived"] == 1
    [w] = findings(rep, "cross", "waiver")
    assert w["status"] == "warn" and "gone.py" in w["detail"]
    assert "waived: BACKLOG 31" in A.render(rep)


# --- manifests -----------------------------------------------------------------------

def test_a_dirty_artefact_commit_warns_with_its_line(tree):
    manifest = ("name: m\npath: x\nquestion: q\nartefacts:\n- kind: still\n  path: a.png\n  commit: abc1234\n"
                "- kind: tape\n  path: t\n  commit: def5678-dirty\n")
    make_repo(tree.root, "m", {"orchard.yaml": manifest})
    make_repo(tree.root, "clean", {"orchard.yaml": manifest.replace("-dirty", "")})
    rep = tree()
    [f] = findings(rep, "m", "manifest-dirty")
    assert f["status"] == "warn" and f["where"] == "orchard.yaml:10"
    assert statuses(rep, "clean", "manifest-dirty") == ["ok"]


def test_fund_copies_must_be_what_refresh_writes(tree):
    from orchard.portfolio import mirror_bytes
    doc = "name: {n}\npath: {p}\nquestion: q?\n"
    a = make_repo(tree.root, "a", {"orchard.yaml": doc.format(n="a", p=tree.root / "a")})
    b = make_repo(tree.root, "b", {"orchard.yaml": doc.format(n="b", p=tree.root / "b")})
    orchard = make_repo(tree.root, "orchard", {"README.md": "x"})
    (orchard / "trees").mkdir()
    (orchard / "trees/a.yaml").write_bytes(mirror_bytes(a / "orchard.yaml"))
    (orchard / "trees/b.yaml").write_bytes(mirror_bytes(b / "orchard.yaml") + b"notes: hand edit\n")
    (orchard / "trees/gone.yaml").write_text(doc.format(n="gone", p=tree.root / "gone"))  # not on this box
    got = {f["where"]: f["status"] for f in findings(tree(), "orchard", "fund-copies")}
    assert got == {"trees/a.yaml": "ok", "trees/b.yaml": "fail"}


# --- pinned-tags ---------------------------------------------------------------------

def consumer(tag: str) -> str:
    return pyproject("c", extra=f'\n[tool.uv.sources]\norchard-tape = {{ git = "{ORCHARD_URL}", '
                                f'subdirectory = "packages/tape", tag = "{tag}" }}\n')


def github_origin(repo: Path, slug: str, bare: Path) -> str:
    """origin spelled as on this box (`git@github.com-weichseltree:<slug>.git`); `insteadOf`
    sends every fetch and push to the local `bare` repo, so no test ever reaches GitHub."""
    subprocess.run([*GIT, "init", "-q", "--bare", str(bare)], check=True)
    url = f"git@github.com-weichseltree:{slug}.git"
    git(repo, "remote", "add", "origin", url)
    git(repo, "config", f"url.{bare}.insteadOf", url)
    return url


def repo_with_tags(tree, root: Path, name: str, slug: str, pushed: str, unpushed: str) -> Path:
    repo = make_repo(root, name, {"README.md": "x"})
    github_origin(repo, slug, tree.home / f"{name}-origin.git")
    git(repo, "tag", pushed)
    git(repo, "push", "-q", "origin", "main", pushed)
    git(repo, "tag", unpushed)                        # made here, never pushed
    return repo


@pytest.fixture
def orchard_with_origin(tree):
    return repo_with_tags(tree, tree.root, "orchard", "weichseltree/orchard", "tape-v1.0.0", "tape-v1.1.0")


def test_a_tag_pin_must_exist_here_and_on_origin(tree, orchard_with_origin):
    make_repo(tree.root, "pushed", {"pyproject.toml": consumer("tape-v1.0.0")})
    make_repo(tree.root, "unpushed", {"pyproject.toml": consumer("tape-v1.1.0")})
    make_repo(tree.root, "invented", {"pyproject.toml": consumer("tape-v9.0.0")})
    header = ('# /// script\n# dependencies = ["orchard-tape"]\n# [tool.uv.sources]\n'
              f'# orchard-tape = {{ git = "{ORCHARD_URL}", subdirectory = "packages/tape", branch = "main" }}\n'
              '# ///\n')
    make_repo(tree.root, "script", {"x.py": header})
    rep = tree()
    assert statuses(rep, "pushed", "pinned-tags") == ["ok"]
    [f] = findings(rep, "unpushed", "pinned-tags")
    assert f["status"] == "fail" and "not on origin" in f["detail"] and f["where"] == "pyproject.toml:8"
    [f] = findings(rep, "invented", "pinned-tags")
    assert f["status"] == "fail" and "does not have" in f["detail"]
    [f] = findings(rep, "script", "pinned-tags")
    assert f["status"] == "warn" and "branch" in f["detail"]


def test_an_unreachable_origin_is_a_skip_not_a_fail(tree, orchard_with_origin):
    url = git(orchard_with_origin, "config", "--get", "remote.origin.url").strip()
    git(orchard_with_origin, "config", "--remove-section", f"url.{tree.home / 'orchard-origin.git'}")
    git(orchard_with_origin, "config", f"url.{tree.home / 'nowhere.git'}.insteadOf", url)
    make_repo(tree.root, "pushed", {"pyproject.toml": consumer("tape-v1.0.0")})
    [f] = findings(tree(), "pushed", "pinned-tags")
    assert f["status"] == "skip" and "origin could not be checked" in f["detail"]


def private_pin(name: str, slug: str, subdir: str, tag: str) -> str:
    return (f'{name} = {{ git = "ssh://git@github.com-weichseltree/{slug}.git", '
            f'subdirectory = "{subdir}", tag = "{tag}" }}\n')


def test_a_pin_on_any_audited_repo_is_checked_against_that_repo_and_its_origin(tree):
    """arcagi2026 pins event-atoms and (archived) agivity over SSH with the host alias; each
    tag is looked up in the checkout whose origin names that repo, not in orchard."""
    repo_with_tags(tree, tree.root, "event-atoms", "weichseltree/event-atoms",
                   "gridevents-v1.0.0", "gridevents-v1.1.0")
    repo_with_tags(tree, tree.root, "agivity", "weichseltree/agivity", "ihwm-v1.0.0", "ihwm-v1.1.0")
    sources = ("\n[tool.uv.sources]\n"
               + private_pin("gridevents", "weichseltree/event-atoms", "packages/gridevents", "gridevents-v1.0.0")
               + private_pin("agivity-ihwm", "weichseltree/agivity", "packages/ihwm", "ihwm-v1.1.0")
               + private_pin("ghost", "Weichseltree/Event-Atoms", "packages/ghost", "ghost-v9.0.0")
               + 'other = { git = "https://github.com/someone/else", tag = "v1.0.0" }\n')
    group = ('\n[dependency-groups]\nexperiments = ["direct @ git+ssh://git@github.com-weichseltree/'
             'weichseltree/agivity.git@ihwm-v1.0.0#subdirectory=packages/ihwm"]\n')
    kaggle = make_repo(tree.home / "kaggle", "arcagi2026", {"pyproject.toml": pyproject("a", extra=group + sources)})
    rep = tree(archived=["agivity"], extra_roots=[kaggle])
    got = {f["detail"].split(",")[0]: f["status"] for f in findings(rep, "arcagi2026", "pinned-tags")}
    assert got == {
        "gridevents pins tag gridevents-v1.0.0": "ok",           # in event-atoms and on its origin
        "agivity-ihwm pins tag ihwm-v1.1.0": "fail",             # tagged in agivity, never pushed
        "ghost pins tag ghost-v9.0.0": "fail",                   # owner/name match regardless of case
        "direct pins tag ihwm-v1.0.0": "ok",                     # a PEP 508 direct reference
    }                                                            # someone/else: not audited, not checked
    [f] = [f for f in findings(rep, "arcagi2026", "pinned-tags") if f["status"] == "fail" and "ihwm" in f["detail"]]
    assert "not on origin" in f["detail"] and "agivity" in f["detail"]


def test_each_pinned_repo_s_origin_is_asked_once_per_run(tree, monkeypatch):
    repo_with_tags(tree, tree.root, "event-atoms", "weichseltree/event-atoms", "g-v1.0.0", "g-v1.1.0")
    pin = private_pin("gridevents", "weichseltree/event-atoms", "packages/gridevents", "g-v1.0.0")
    for name in ("one", "two", "three"):
        make_repo(tree.root, name, {"pyproject.toml": pyproject(name, extra="\n[tool.uv.sources]\n" + pin)})
    asked, real = [], A.run
    monkeypatch.setattr(A, "run", lambda cmd, cwd, timeout: (asked.append(cmd) if "ls-remote" in cmd else None)
                        or real(cmd, cwd, timeout))
    rep = tree()
    assert [statuses(rep, n, "pinned-tags") for n in ("one", "two", "three")] == [["ok"]] * 3
    assert len(asked) == 1 and asked[0][-3:] == ["ls-remote", "--tags", "origin"]


def test_direct_refs_keep_slashes_in_branches_and_tags(tree, orchard_with_origin):
    tag = "release/tape-v1.0.0"
    git(orchard_with_origin, "tag", tag)
    git(orchard_with_origin, "push", "-q", "origin", tag)
    make_repo(tree.root, "consumer", {"pyproject.toml":
        '[project]\nname = "consumer"\nversion = "0.1.0"\nrequires-python = ">=3.12"\n'
        'dependencies = [\n'
        '  "branch-pin @ git+https://github.com/weichseltree/orchard.git@feature/fix",\n'
        '  "tag-pin @ git+ssh://git@github.com-weichseltree/weichseltree/orchard.git@release/tape-v1.0.0#subdirectory=packages/tape",\n'
        '  "no-ref @ git+ssh://git@github.com-weichseltree/weichseltree/orchard.git",\n'
        ']\n'})
    got = findings(tree(), "consumer", "pinned-tags")
    assert len(got) == 3
    assert any(f["status"] == "warn" and "feature/fix" in f["detail"] for f in got)
    assert any(f["status"] == "ok" and tag in f["detail"] for f in got)
    assert any(f["status"] == "warn" and "no-ref" in f["detail"] and "by nothing" in f["detail"] for f in got)


@pytest.mark.parametrize("url, slug", [
    ("https://github.com/weichseltree/orchard", "weichseltree/orchard"),
    ("https://github.com/weichseltree/orchard.git/", "weichseltree/orchard"),
    ("git+https://github.com/weichseltree/orchard", "weichseltree/orchard"),
    ("ssh://git@github.com-weichseltree/weichseltree/event-atoms.git", "weichseltree/event-atoms"),
    ("git@github.com-weichseltree:Weichseltree-OU/arcagi2026.git", "weichseltree-ou/arcagi2026"),
    ("git@github.com:weichseltree/agivity.git", "weichseltree/agivity"),
    ("ssh://git@work/weichseltree/agivity.git", "weichseltree/agivity"),      # an ssh config alias
    ("https://gitlab.com/weichseltree/orchard", None),
    ("/home/manuel/weichseltree/orchard", None),
])
def test_github_urls_in_every_spelling_name_one_repo(tmp_path, url, slug):
    (tmp_path / ".ssh").mkdir()
    (tmp_path / ".ssh" / "config").write_text("Host work other-*\n    HostName github.com\nHost box\n  HostName 10.0.0.3\n")
    assert A.github_slug(url, A.github_host_re(tmp_path)) == slug


# --- orchard's own -------------------------------------------------------------------

def test_toolchain_mismatch_fails_and_missing_warns(monkeypatch):
    import orchard.toolchain as T
    monkeypatch.setattr(T, "report", lambda: [Probe("ffmpeg", "6.1.1", "/usr/bin/ffmpeg", "7.0", None),
                                              Probe("toktx", "4.4.2", None, None, None),
                                              Probe("node", "22", "/n", "22.17.1", None)])
    assert [f.status for f in A.check_toolchain()] == ["fail", "warn", "ok"]


def test_bindings_skip_without_the_script_and_follow_its_exit(tree, monkeypatch):
    orchard = make_repo(tree.root, "orchard", {"grove/package.json": '{"scripts": {}}'})
    assert [f.status for f in A.check_bindings(A.Repo("orchard", orchard))] == ["skip"]
    (orchard / "grove/package.json").write_text('{"scripts": {"check:bindings": "node x.mjs"}}')
    fake = tree.home / "pnpm"
    monkeypatch.setattr(A, "pnpm_exe", lambda: str(fake))
    for code, want in ((0, "ok"), (1, "fail"), (2, "warn")):
        fake.write_text(f"#!/bin/sh\necho 'bindings: said {code}' >&2\nexit {code}\n")
        fake.chmod(0o755)
        [f] = A.check_bindings(A.Repo("orchard", orchard))
        assert f.status == want, f
        assert code == 2 or "bindings: said" in f.detail


# --- the command, the file, the panel, the unit ------------------------------------------

def test_the_command_exits_1_on_an_unwaived_failure_and_writes_the_report(tree, monkeypatch, capsys):
    from orchard.cli import main
    make_repo(tree.root, "bare", {"requirements.txt": "numpy\n"})
    cfg = A.Config(roots=[tree.root])
    monkeypatch.setattr(A, "load_config", lambda path=None: cfg)
    monkeypatch.setattr(A, "OUT", tree.home / "results/audit.json")
    with pytest.raises(SystemExit) as exc:
        main(["audit"])
    assert exc.value.code == 1
    assert "FAIL" in capsys.readouterr().out
    rep = json.loads((tree.home / "results/audit.json").read_text())
    assert rep["summary"]["fail"] == 1 and rep["generated_at"]
    (tree.home / "results/audit.json").unlink()
    with pytest.raises(SystemExit):
        main(["audit", "bare"])                          # a partial run leaves the file alone
    assert not (tree.home / "results/audit.json").exists()


def test_the_panel_shows_unwaived_failures_and_marks_a_stale_report(tmp_path, monkeypatch):
    from orchard.dashboard import app as dashboard
    out = tmp_path / "audit.json"
    monkeypatch.setattr(A, "OUT", out)
    client = TestClient(dashboard.app, base_url="http://127.0.0.1:8787")
    assert "error" in client.get("/api/audit").json()
    rows = [{"rule": "node-pins", "status": "fail", "detail": "missing engines.node", "path": "package.json",
             "line": None, "where": "package.json", "waived": ""},
            {"rule": "sibling-import", "status": "fail", "detail": "x", "path": "a.py", "line": 3,
             "where": "a.py:3", "waived": "BACKLOG 31"},
            {"rule": "manifest-dirty", "status": "warn", "detail": "y", "path": "orchard.yaml", "line": 9,
             "where": "orchard.yaml:9", "waived": ""}]
    report = {"generated_at": "2026-09-13T10:00:00+00:00", "generated_at_unix": time.time() - 60,
              "duration_s": 2.0, "summary": {"repos": 1, "fail": 1, "warn": 1, "waived": 1, "skip": 0, "ok": 0},
              "repos": [{"name": "r", "results": rows}]}
    out.write_text(json.dumps(report))
    body = client.get("/api/audit").json()
    assert body["failures"] == [{"repo": "r", "rule": "node-pins", "where": "package.json",
                                 "detail": "missing engines.node"}]
    assert body["stale"] is False and body["summary"]["warn"] == 1
    report["generated_at_unix"] = time.time() - 46 * 60
    out.write_text(json.dumps(report))
    assert client.get("/api/audit").json()["stale"] is True
    assert "audit-meta" in client.get("/").text


def test_the_unit_is_installed_for_the_main_checkout_even_from_a_worktree(tree, monkeypatch):
    import orchard.sync as S
    main = make_repo(tree.root, "orchard", {"README.md": "x"})
    git(main, "worktree", "add", "-q", "-b", "agent", str(main / ".claude/worktrees/agent"))
    monkeypatch.setattr(S, "ROOT", main / ".claude/worktrees/agent")
    assert S.checkout_root() == main
    units = Path(S.UNIT_SRC)
    sync = (units / "orchard-sync.service").read_text()
    audit = (units / "orchard-audit.service").read_text()
    assert "Wants=orchard-audit.service" in sync
    assert "After=orchard-sync.service" in audit and "ExecStart=-" in audit   # never stops sync
    assert set(S.UNITS) == {p.name for p in units.iterdir()}
