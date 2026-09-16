"""Areas: a linked repository's place in the world, and who rules inside it.

    uv run orchard area link <tree> [--repo URL] [--commit SHA]
    uv run orchard area unlink <tree>
    uv run orchard area state <tree> draft|live|paused
    uv run orchard area host-pause <tree> on|off
    uv run orchard area admin add|drop <tree> <identity hex>
    uv run orchard area list

The host's side of SANDBOX-TRUST.md §1 (ruled 2026-09-16): only the host
links and unlinks, opens an area out of `draft`, and holds the pause an area
admin cannot lift. An area admin is an `area_admin` row, never `add_admin`;
their own moderation (mute, kick, ban inside the area) is theirs to call from
the client, not the host's to run for them. Every call here is a live write
to the database's admin reducers; the linked tree must already exist
(`orchard sync trees`) and its presence room must carry the tree's name
(`set_room`), since that is how `join` knows which area a room belongs to.
"""
from __future__ import annotations

import subprocess

from .sync import DB, SPACETIME_DIR, _cli, call

STATES = ("draft", "live", "paused")


def _identity(hex_: str) -> str:
    """The CLI's spelling of an identity argument: 0x and 64 hex digits."""
    h = hex_.strip().lower().removeprefix("0x")
    if len(h) != 64 or any(c not in "0123456789abcdef" for c in h):
        raise ValueError(f"an identity is 64 hex digits, not {hex_!r}")
    return f"0x{h}"


def link(tree: str, repo: str = "", commit: str = "") -> None:
    call("link_area", tree, repo, commit)


def unlink(tree: str) -> None:
    call("unlink_area", tree)


def set_state(tree: str, state: str) -> None:
    if state not in STATES:
        raise ValueError(f"state must be one of {STATES}, not {state!r}")
    call("set_area_state", tree, state)


def host_pause(tree: str, paused: bool) -> None:
    call("host_pause_area", tree, paused)


def add_admin(tree: str, identity: str) -> None:
    call("add_area_admin", tree, _identity(identity))


def drop_admin(tree: str, identity: str) -> None:
    call("drop_area_admin", tree, _identity(identity))


def listing() -> str:
    """The area table as the CLI prints it (public, no admin needed)."""
    r = subprocess.run([_cli(), "sql", DB,
                        "select tree, repo, commit, state, host_paused, linked_at, confirmed_at from area"],
                       cwd=SPACETIME_DIR, capture_output=True, text=True, timeout=60)
    out = (r.stdout + r.stderr).replace(
        "WARNING: This command is UNSTABLE and subject to breaking changes.", "").strip()
    if r.returncode != 0:
        raise RuntimeError(out)
    return out
