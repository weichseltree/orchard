"""Versioned renderer model and pixel-stream transport contract.

The descriptor is deliberately useful without raw pixels: a client can select
the stream URL and correlate it with the contributors that produced it. Raw
frames are an opt-in capability, so older or descriptor-only clients receive
the same model and stream metadata without being sent binary frame payloads.
"""
from __future__ import annotations

import base64
import json
from dataclasses import dataclass, field
from typing import Any, Iterable, Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA = "orchard/render-stream/1"
MODEL_EVENT = "renderer.model"
PIXELS_EVENT = "renderer.pixels"


class RendererContribution(BaseModel):
    """One renderer currently contributing to the hybrid output."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    role: str = ""
    source: str = ""
    contribution: str = ""
    version: str | None = None


class StreamDescriptor(BaseModel):
    model_config = ConfigDict(extra="ignore")

    stream_id: str = Field(min_length=1)
    correlation_id: str = Field(min_length=1)
    width: int = Field(ge=0)
    height: int = Field(ge=0)
    pixel_format: str = Field(min_length=1)
    fps: float = Field(ge=0)
    transport: Literal["sse", "get", "webrtc", "raw"]
    raw_frames: bool = False


class PixelFrame(BaseModel):
    sequence: int = Field(ge=0)
    timestamp: int = Field(ge=0)
    encoding: str = Field(min_length=1)
    data: str


class ClientCapabilities(BaseModel):
    """Capabilities negotiated by a client before receiving raw frames."""

    model_config = ConfigDict(extra="ignore")

    protocol: str = SCHEMA
    raw_frames: bool = False
    formats: list[str] = Field(default_factory=list)


class RendererModelEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    schema: str = SCHEMA
    event: Literal["renderer.model"] = MODEL_EVENT
    stream: StreamDescriptor
    renderers: list[RendererContribution] = Field(default_factory=list)
    capabilities: ClientCapabilities
    session_id: str | None = None


class RendererPixelsEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    schema: str = SCHEMA
    stream: StreamDescriptor
    event: Literal["renderer.pixels"] = PIXELS_EVENT
    frame: PixelFrame | None = None
    renderers: list[RendererContribution] | None = None
    capabilities: ClientCapabilities | None = None
    session_id: str | None = None


@dataclass
class RenderStreamHub:
    """In-memory current view; the dashboard remains the process boundary."""

    stream: StreamDescriptor
    _contributors: dict[str, RendererContribution] = field(default_factory=dict)
    _frame: PixelFrame | None = None
    _revision: int = 0

    def set_contributors(self, contributors: Iterable[RendererContribution]) -> None:
        self._contributors = {item.id: item for item in contributors}
        self._revision += 1

    def upsert_contributor(self, contributor: RendererContribution) -> None:
        self._contributors[contributor.id] = contributor
        self._revision += 1

    def remove_contributor(self, renderer_id: str) -> None:
        if renderer_id in self._contributors:
            del self._contributors[renderer_id]
            self._revision += 1

    def publish_frame(
        self,
        *,
        frame_id: int,
        timestamp_ms: int,
        data: bytes,
        encoding: str = "base64",
    ) -> None:
        if not self.stream.raw_frames:
            raise ValueError("raw frames are not available for this stream")
        if frame_id < 0 or timestamp_ms < 0:
            raise ValueError("frame_id and timestamp_ms must be non-negative")
        self._frame = PixelFrame(
            sequence=frame_id,
            timestamp=timestamp_ms,
            encoding=encoding,
            data=base64.b64encode(data).decode("ascii"),
        )

    def model_event(
        self,
        capabilities: ClientCapabilities | None = None,
        session_id: str | None = None,
    ) -> RendererModelEvent:
        return RendererModelEvent(
            stream=self.stream,
            renderers=list(self._contributors.values()),
            capabilities=capabilities or ClientCapabilities(),
            session_id=session_id,
        )

    def messages(
        self,
        capabilities: ClientCapabilities | None = None,
        session_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return the initial client view, omitting raw frames by default."""
        negotiated = capabilities or ClientCapabilities()
        messages: list[dict[str, Any]] = [
            {"event": MODEL_EVENT, "data": self.model_event(negotiated, session_id).model_dump(mode="json")}
        ]
        format_ok = (
            not negotiated.formats
            or self.stream.pixel_format in negotiated.formats
        )
        if (
            negotiated.protocol == SCHEMA
            and negotiated.raw_frames
            and format_ok
            and self._frame is not None
        ):
            messages.append({"event": PIXELS_EVENT, "data": RendererPixelsEvent(
                stream=self.stream,
                frame=self._frame,
                session_id=session_id,
            ).model_dump(mode="json")})
        return messages

    def sse(self, capabilities: ClientCapabilities | None = None, session_id: str | None = None) -> str:
        """Serialize the current view as one replayable SSE response."""
        return "".join(
            f"event: {message['event']}\ndata: {json.dumps(message['data'], separators=(',', ':'))}\n\n"
            for message in self.messages(capabilities, session_id)
        )
