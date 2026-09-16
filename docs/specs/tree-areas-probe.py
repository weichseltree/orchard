"""A probe for TREE-AREAS.md sections 3 and 4, NOT the generator.

    uv run python docs/specs/tree-areas-probe.py /path/to/a/tree

Applies the room-selection and collapse rules to a repository's git tree and
its orchard.yaml, and prints the rooms the area would earn. It exists so the
numbers in TREE-AREAS.md section 9 can be rechecked, and so the rules were
written against a real tree rather than an imagined one. It does no layout,
emits no mansion.json and enforces none of section 10's budgets.
"""
import subprocess, sys, yaml
from pathlib import Path

REPO = Path(sys.argv[1])
EXCLUDE = {"__pycache__","node_modules",".venv","venv","dist","build","target",".git"}
DOC_NAMES = {"README.md","SPEC.md"}

def excluded(parts): return any(p.startswith(".") or p in EXCLUDE for p in parts)

files = [f for f in subprocess.run(["git","-C",str(REPO),"ls-files"],
         capture_output=True,text=True).stdout.split() if not excluded(f.split("/")[:-1])]

own, docs, tracked = {}, set(), set()
for f in files:
    parts = f.split("/"); d = "/".join(parts[:-1])
    own.setdefault(d, []).append(f)
    if parts[-1] in DOC_NAMES: docs.add(d)
    for i in range(1, len(parts)): tracked.add("/".join(parts[:i]))

decl = yaml.safe_load((REPO/"orchard.yaml").read_text())
art_at, art_dirs = {}, set()
for a in decl.get("artefacts") or []:
    p = a["path"]
    home = p if (REPO/p).is_dir() else "/".join(p.split("/")[:-1])
    art_at.setdefault(home, []).append(a["kind"])
    parts = home.split("/")
    for i in range(1, len(parts)+1): art_dirs.add("/".join(parts[:i]))

earns = {""} | {d for d in sorted(tracked|art_dirs)
                if "/" not in d or d in docs or d in art_dirs}

# Build the room tree: a room's parent is its NEAREST ancestor that earns a room.
kids = {r: [] for r in earns}
for r in sorted(earns):
    if r == "": continue
    parts = r.split("/")
    parent = next(("/".join(parts[:i]) for i in range(len(parts)-1, 0, -1)
                   if "/".join(parts[:i]) in earns), "")
    kids[parent].append(r)

# Collapse bottom-up on the TREE: a room with no content of its own and exactly
# one child room is a hallway to one door, not a place. Merge it into the child.
name = {r: (r.split("/")[-1] if r else decl["name"]) for r in earns}
def collapse(r):
    for c in list(kids[r]): collapse(c)
    for c in list(kids[r]):
        if len(kids[c]) == 1 and not own.get(c) and c not in art_at:
            g = kids[c][0]
            name[g] = f"{name[c]}/{name[g]}"
            kids[r][kids[r].index(c)] = g
            del kids[c]
collapse("")

rooms = []
def walk(r, d=0):
    rooms.append((d, r))
    for c in sorted(kids[r], key=lambda x: x.split("/")[-1]): walk(c, d+1)
walk("")

print(f"{decl['name']}: {len(rooms)} rooms, deepest {max(d for d,_ in rooms)}, "
      f"{len(art_dirs-tracked)} created by declaration, "
      f"{len((tracked|art_dirs)-earns)} directories as furniture")
for d, r in rooms:
    h = art_at.get(r, [])
    n = len(own.get(r, []))
    tag = []
    if h: tag.append(f"{len(h)} {'/'.join(sorted(set(h)))}")
    if n: tag.append(f"{n} files")
    if r and r in docs: tag.append("README")
    print(f"  {'   '*d}{name[r]:<34}{'  <- ' + ', '.join(tag) if tag else ''}")
