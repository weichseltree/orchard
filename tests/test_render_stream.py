import base64
import json

import pytest

from orchard.render_stream import (
    SCHEMA,
    ClientCapabilities,
    RenderStreamHub,
    RendererContribution,
    StreamDescriptor,
)


def hub(*, raw=False):
    return RenderStreamHub(
        stream=StreamDescriptor(
            stream_id="hybrid-1",
            correlation_id="model-7",
            width=1920,
            height=1080,
            fps=30,
            pixel_format="rgba8",
            transport="sse",
            raw_frames=raw,
        )
    )


def test_model_lists_multiple_current_contributors_and_stream_correlation():
    current = hub()
    current.set_contributors([
        RendererContribution(id="scene", kind="webgl", role="scene", source="grove", contribution="pixels"),
        RendererContribution(id="ui", kind="dom", role="ui", source="grove", contribution="controls"),
    ])

    messages = current.messages()
    assert [message["event"] for message in messages] == ["renderer.model"]
    data = messages[0]["data"]
    assert data["schema"] == SCHEMA
    assert [item["id"] for item in data["renderers"]] == ["scene", "ui"]
    assert data["stream"]["correlation_id"] == "model-7"
    assert data["stream"]["stream_id"] == "hybrid-1"


def test_empty_and_partial_contributors_are_valid_descriptor_only_views():
    current = hub()
    assert current.model_event().renderers == []
    current.upsert_contributor(RendererContribution(id="ui", kind="dom"))
    contributor = current.model_event().renderers[0]
    assert contributor.role == ""
    assert contributor.source == ""


def test_raw_pixels_are_omitted_unless_capability_and_protocol_match():
    current = hub(raw=True)
    current.publish_frame(frame_id=4, timestamp_ms=123, data=b"pixels", encoding="base64")

    assert [m["event"] for m in current.messages()] == ["renderer.model"]
    assert [m["event"] for m in current.messages(ClientCapabilities(raw_frames=True))] == [
        "renderer.model", "renderer.pixels"
    ]
    frame = current.messages(ClientCapabilities(raw_frames=True))[1]["data"]
    assert frame["stream"]["correlation_id"] == "model-7"
    assert base64.b64decode(frame["frame"]["data"]) == b"pixels"
    assert [m["event"] for m in current.messages(
        ClientCapabilities(raw_frames=True, formats=["rgb24"])
    )] == ["renderer.model"]
    unsupported = current.messages(ClientCapabilities(protocol="orchard/render-stream/0", raw_frames=True))
    assert [m["event"] for m in unsupported] == ["renderer.model"]
    assert unsupported[0]["data"]["capabilities"]["protocol"] == "orchard/render-stream/0"


def test_raw_frame_requires_an_available_stream():
    with pytest.raises(ValueError, match="not available"):
        hub().publish_frame(frame_id=0, timestamp_ms=0, data=b"x")


def test_sse_contains_replayable_model_and_negotiated_pixels():
    current = hub(raw=True)
    current.upsert_contributor(RendererContribution(id="scene", kind="webgl2"))
    current.publish_frame(frame_id=1, timestamp_ms=10, data=b"x")
    response = current.sse(ClientCapabilities(raw_frames=True))
    assert "event: renderer.model\n" in response
    assert "event: renderer.pixels\n" in response
    payloads = [json.loads(line[6:]) for line in response.splitlines() if line.startswith("data: ")]
    assert payloads[0]["stream"]["correlation_id"] == payloads[1]["stream"]["correlation_id"] == "model-7"
