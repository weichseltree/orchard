"""The tree manifest: how a research repo registers with the orchard.

One YAML file per tree. Canonical location is `orchard.yaml` at the repo's
root; `trees/<name>.yaml` in this repo is the fund's copy and wins when the
repo has none (drafts written by `orchard scout` start here). The manifest
says what the repo is asking a viewer, what it can already show, how its
artefacts are produced, and where each thesis stands in the studio's stages.

Stages are the term sheet. Capital for expensive renders unlocks only past
`greenlit`, and a render is costed from measured coefficients before that gate.
"""
from __future__ import annotations

from enum import StrEnum
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, model_validator


LEGACY_LAUNCHERS = ("exprun", "gpurun", "$HOME/.local/bin/gpurun")


class Status(StrEnum):
    active = "active"
    dormant = "dormant"
    archived = "archived"


class Stage(StrEnum):
    scouted = "scouted"        # the fund has looked
    planted = "planted"        # the repo carries a manifest; capital may flow
    thesis = "thesis"          # one viewer question with one number, written
    styleframe = "styleframe"  # a still you approved
    animatic = "animatic"      # full length, slates + measured VO, you watched it
    greenlit = "greenlit"      # your ruling: spend render capital
    rendering = "rendering"
    mastered = "mastered"      # picture + VO + music + titles, verified by decode
    published = "published"    # on the channel
    exhibited = "exhibited"    # hanging in the grove


STAGE_ORDER = list(Stage)

#: `planet` is spectre's cutaway worlds (orchard/planet.py). A tree declares it like any other
#: artefact (path: the bake delivery; sha256: the bake manifest's; bundle: the id `orchard bundle
#: planet` printed), but harvest does not bundle it: the tree runs `orchard bundle planet` itself
#: and writes the id back, since the bundle names the atlas videos the tree bundled first.
ArtefactKind = Literal["tape", "clip", "still", "figure", "summary", "master", "audio", "planet",
                       "model"]


class Artefact(BaseModel):
    kind: ArtefactKind
    path: str                      # relative to the tree's path
    title: str = ""
    produced_by: str = ""          # the command that made it, verbatim
    commit: str = ""               # tree commit it was made at
    sha256: str = ""               # of the file, when pinned
    approved: bool = False         # your ruling; only approved artefacts reach the grove
    bundle: str = ""               # id of the bundle `orchard harvest` wrote from it


class Phenomenon(BaseModel):
    id: str
    title: str
    hook: str                      # the sentence that makes a viewer lean in
    evidence: str = ""             # a path a reviewer can open today
    hero: bool = False             # candidate for a lit 3D shot


class Thesis(BaseModel):
    """What the fund is buying: one viewer question, one number, one picture."""
    id: str
    question: str
    number: str = ""               # the one measured number the episode turns on
    picture: str = ""              # the one picture a viewer should keep
    phenomena: list[str] = Field(default_factory=list)
    stage: Stage = Stage.thesis
    episode: str = ""              # working title
    blocked_by: str = ""


class Producers(BaseModel):
    """Commands the studio may run in the tree. `{scene}` etc. are filled in."""
    tape: str = ""
    render: str = ""
    figure: str = ""
    model: str = ""                # makes a glb for `orchard bundle model` (arcedit's environment)
    lane: Literal["gpu", "cpu", "none"] = "cpu"
    env: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def local_launches_use_expdash_lanes(self) -> "Producers":
        commands = {"tape": self.tape, "render": self.render, "figure": self.figure,
                    "model": self.model}
        for key, cmd in commands.items():
            if not cmd:
                continue
            if "GPU_LOCK" in cmd or "GPU_LOCK" in self.env:
                raise ValueError(f"producers.{key} must not bypass lane locks with GPU_LOCK")
            if self.lane == "none":
                raise ValueError(f"producers.{key} needs an exp run lane, not lane=none")
            if any(legacy in cmd for legacy in LEGACY_LAUNCHERS):
                raise ValueError(f"producers.{key} must use exp run, not a legacy launcher")
            if "exp run " not in cmd or f"--lane {self.lane}" not in cmd or " -- " not in cmd:
                raise ValueError(f"producers.{key} must launch with: exp run <name> --lane {self.lane} -- <command>")
        return self


class Budget(BaseModel):
    """Allocation for the current round. Zero means: ask first."""
    gpu_h: float = 0
    cpu_h: float = 0
    tts_chars: int = 0
    llm_usd: float = 0
    disk_gb: float = 0
    prio_cap: int = 10             # highest EXP_PRIO the tree may stamp without a ruling


class Tree(BaseModel):
    name: str
    #: What a human reads, when it differs from `name`. The name is identity:
    #: it is inside the bytes every bundle id hashes, so it cannot be changed
    #: without moving every id, pin and exhibit row (docs/specs/NAMING.md).
    #: The title is free to change. Empty means "use the name".
    title: str = ""
    path: str
    remote: str = ""
    question: str                  # the repo's one sentence
    status: Status = Status.active
    stage: Stage = Stage.scouted
    gpu: str = "none"              # torch | jax | numba | mitsuba | none
    phenomena: list[Phenomenon] = Field(default_factory=list)
    artefacts: list[Artefact] = Field(default_factory=list)
    producers: Producers = Field(default_factory=Producers)
    theses: list[Thesis] = Field(default_factory=list)
    budget: Budget = Field(default_factory=Budget)
    kill: str = ""                 # the criterion that prunes this tree
    potential: int = 0             # 1-10, the fund's current guess
    notes: str = ""

    @property
    def root(self) -> Path:
        return Path(self.path).expanduser()

    @property
    def label(self) -> str:
        """The name to show a person; `name` is the identity to match on."""
        return self.title or self.name

    def furthest_stage(self) -> Stage:
        stages = [t.stage for t in self.theses] or [self.stage]
        return max(stages, key=STAGE_ORDER.index)


def load(path: Path) -> Tree:
    with open(path) as f:
        return Tree.model_validate(yaml.safe_load(f))


def dump(tree: Tree, path: Path) -> None:
    data = tree.model_dump(mode="json", exclude_defaults=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True, width=100)
