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
from pydantic import BaseModel, Field


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

ArtefactKind = Literal["tape", "clip", "still", "figure", "summary", "master", "audio"]


class Artefact(BaseModel):
    kind: ArtefactKind
    path: str                      # relative to the tree's path
    title: str = ""
    produced_by: str = ""          # the command that made it, verbatim
    commit: str = ""               # tree commit it was made at
    sha256: str = ""               # of the file, when pinned
    approved: bool = False         # your ruling; only approved artefacts reach the grove


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
    lane: Literal["gpu", "cpu", "none"] = "cpu"
    env: dict[str, str] = Field(default_factory=dict)


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
