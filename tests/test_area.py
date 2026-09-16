"""The host's area commands call the module's area reducers, and nothing else."""
import pytest

from orchard import area as A


def test_area_commands_call_the_reducers(monkeypatch):
    calls = []
    monkeypatch.setattr(A, "call", lambda reducer, *args: calls.append((reducer, args)))
    hex_ = "ab" * 32
    A.link("probe", repo="https://example.com/p.git", commit="abc1234")
    A.set_state("probe", "live")
    A.host_pause("probe", True)
    A.add_admin("probe", hex_)
    A.drop_admin("probe", "0x" + hex_.upper())
    A.unlink("probe")
    assert calls == [
        ("link_area", ("probe", "https://example.com/p.git", "abc1234")),
        ("set_area_state", ("probe", "live")),
        ("host_pause_area", ("probe", True)),
        ("add_area_admin", ("probe", "0x" + hex_)),
        ("drop_area_admin", ("probe", "0x" + hex_)),
        ("unlink_area", ("probe",)),
    ]


def test_a_state_or_identity_the_module_would_refuse_is_refused_here_first(monkeypatch):
    monkeypatch.setattr(A, "call", lambda *a: pytest.fail("must not be called"))
    with pytest.raises(ValueError):
        A.set_state("probe", "open")
    with pytest.raises(ValueError):
        A.add_admin("probe", "not-an-identity")
