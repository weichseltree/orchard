# Renderer and pixel stream contract

Orchard exposes `GET /api/render/stream` from the existing localhost-only
dashboard. The response is Server-Sent Events and uses
`orchard/render-stream/1`. The endpoint retains the dashboard's host, origin,
frame, and `X-Orchard` middleware boundaries; `session_id` is correlation
metadata only and is never used to widen access.

Every client receives one `renderer.model` event:

```json
{
  "schema": "orchard/render-stream/1",
  "event": "renderer.model",
  "stream": {
    "stream_id": "hybrid-1",
    "correlation_id": "model-7",
    "width": 1920,
    "height": 1080,
    "pixel_format": "rgba8",
    "fps": 30,
    "transport": "sse",
    "raw_frames": false
  },
  "renderers": [
    {"id": "scene", "kind": "webgl2", "role": "scene",
     "source": "grove", "contribution": "pixels"}
  ],
  "capabilities": {"protocol": "orchard/render-stream/1",
                   "raw_frames": false, "formats": []}
}
```

`stream.correlation_id` ties the stream to the renderer model. Renderer
contributors may be empty and `role`, `source`, `contribution`, and `version`
may be partial. Unknown fields are ignored for additive compatibility.

Clients opt in with `?raw_frames=true`. Only when the stream advertises
`raw_frames: true` and the client negotiates the same protocol does Orchard
send `renderer.pixels` events. They contain the same `stream_id` and
`correlation_id`, plus an optional `frame`:

```json
{
  "schema": "orchard/render-stream/1",
  "event": "renderer.pixels",
  "stream": {"stream_id": "hybrid-1", "correlation_id": "model-7"},
  "frame": {"sequence": 4, "timestamp": 123,
             "encoding": "base64", "data": "..."}
}
```

Descriptor-only and older/unsupported clients therefore receive the model and
stream metadata but no raw frame payload. `renderer.pixels` may repeat
`renderers` when the contributor set changes.
