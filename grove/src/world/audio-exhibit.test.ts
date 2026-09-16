import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioExhibit, PLAYLIST_FILE, TOPOLOGY_FILE, exhibitBase, placementOf } from "./audio-exhibit";
import { MEDIA_BASE } from "../config";
import { AudioHangingSchema, type AudioHanging } from "./schema";
import { classify } from "../sw/policy";

function hanging(over: Record<string, unknown> = {}): AudioHanging {
  return AudioHangingSchema.parse({
    id: "logswarm-stream",
    kind: "audio",
    live: { provider: "logswarm", streamId: "run-7" },
    position: [4, 1.6, -3],
    sizeMeters: 10,
    ...over,
  });
}

const topology = {
  schema: "orchard/topology/1",
  provider: "logswarm",
  nodes: [
    { id: "api", position: [0, 0.5, 0.5] },
    { id: "worker", position: [1, 0.5, 0.5] },
  ],
};

describe("exhibitBase", () => {
  it("builds the §1 live name on the media host", () => {
    expect(exhibitBase(hanging(), null)).toBe(`${MEDIA_BASE}/audio/live/logswarm/run-7/`);
  });

  it("escapes a provider or stream id that would otherwise change the path", () => {
    const base = exhibitBase(hanging({ live: { provider: "a/b", streamId: "../secrets" } }), null);
    expect(base).toBe(`${MEDIA_BASE}/audio/live/a%2Fb/..%2Fsecrets/`);
    expect(base).not.toContain("/../");
  });

  it("takes the resolved bundle base for an archived hanging", () => {
    const archived = hanging({ live: undefined, bundle: { id: "0123456789abcdef" } });
    expect(exhibitBase(archived, "https://media.example/0123456789abcdef/"))
      .toBe("https://media.example/0123456789abcdef/");
  });
});

describe("the exhibit name the service worker sees", () => {
  const ORIGIN = "https://weichseltree.com";
  const facts = (url: string) => ({ url, method: "GET", mode: "cors", range: false });
  // The worker is only ever handed absolute URLs; the browser has already
  // resolved a relative media base (dev serves bundles same-origin from
  // /local-bundles, production from the media host) by the time it sees one.
  const asBrowser = (url: string) => new URL(url, ORIGIN).toString();

  // exhibitBase and `sw/policy.ts` recognise the same shape from opposite
  // ends, and nothing connects them but this test. A provider or stream id
  // carrying a slash would split into extra path segments, stop matching
  // EXHIBIT_PATH's two-segment pattern, and be cached as a bundle -- exactly
  // what §1 forbids. That is what the escaping in exhibitBase is for.
  it("classifies every name exhibitBase can build as pass-through, never as media", () => {
    const wrong: string[] = [];
    for (const mediaBase of [MEDIA_BASE, "https://media.weichseltree.com"]) {
      const scope = { origin: ORIGIN, mediaBase };
      for (const live of [
        { provider: "logswarm", streamId: "run-7" },
        { provider: "a/b", streamId: "../secrets" },
        { provider: "a.b-c", streamId: "repo-abc123" },
      ]) {
        const base = exhibitBase(hanging({ live }), null)!;
        for (const file of [PLAYLIST_FILE, TOPOLOGY_FILE, "seg-42.m4s"]) {
          const url = asBrowser(`${base}${file}`);
          const route = classify(facts(url), scope);
          if (route.kind !== "exhibit") wrong.push(`${url} (media ${mediaBase}) -> ${route.kind}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("placementOf", () => {
  it("takes the centre and size, and only the turn about y", () => {
    expect(placementOf(hanging({ rotationDeg: [30, 90, 45] }))).toEqual({
      center: [4, 1.6, -3],
      sizeMeters: 10,
      yawDeg: 90,
    });
  });
});

describe("AudioHangingSchema", () => {
  it("refuses a hanging that is both live and archived, or neither", () => {
    expect(() => hanging({ bundle: { id: "0123456789abcdef" } })).toThrow(/not both and not neither/);
    expect(() => hanging({ live: undefined })).toThrow(/not both and not neither/);
  });
});

// The load path. Web Audio and the DOM are not in the node environment, so
// both are stubbed; what is under test is which URLs are asked for and what
// happens when the topology is not there.

class FakeNode {
  connect(target: unknown): unknown { return target; }
  disconnect(): void {}
}
class FakeGain extends FakeNode { gain = { setValueAtTime() {} }; }
class FakeContext {
  currentTime = 0;
  destination = new FakeNode();
  listener = {};
  createGain(): FakeGain { return new FakeGain(); }
  createPanner(): FakeNode { return new FakeNode(); }
  createStereoPanner(): FakeNode { return new FakeNode(); }
  createMediaElementSource(): FakeNode { return new FakeNode(); }
  async resume(): Promise<void> {}
  async close(): Promise<void> {}
}

function stubBrowser(): void {
  vi.stubGlobal("AudioContext", FakeContext);
  // No MediaSource and no native HLS: the stream falls silent on its own,
  // which is the point -- a dead stream must not cost the room its topology.
  vi.stubGlobal("document", {
    createElement: () => ({
      style: { cssText: "" },
      muted: true,
      setAttribute() {},
      removeAttribute() {},
      remove() {},
      pause() {},
      load() {},
      play: () => Promise.resolve(),
      canPlayType: () => "",
    }),
    body: { append() {} },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("AudioExhibit.load", () => {
  it("fetches the topology beside the exhibit, uncached, and places every node", async () => {
    stubBrowser();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(topology)));
    const exhibit = await AudioExhibit.load({
      hanging: hanging(), tier: "desktop", fetch: fetchImpl as unknown as typeof fetch,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${MEDIA_BASE}/audio/live/logswarm/run-7/${TOPOLOGY_FILE}`);
    // Keeping a document that changes with the observed system is keeping a lie.
    expect(init.cache).toBe("no-store");
    expect(exhibit.nodes.map((n) => n.id)).toEqual(["api", "worker"]);
    // The unit cube is 10 m across, centred on the hanging.
    expect(exhibit.nodes[0]!.position).toEqual([-1, 1.6, -3]);
    expect(exhibit.nodes[1]!.position).toEqual([9, 1.6, -3]);
    exhibit.dispose();
  });

  it("plays the bed alone when there is no topology, and says so rather than failing", async () => {
    stubBrowser();
    const notices: string[] = [];
    const exhibit = await AudioExhibit.load({
      hanging: hanging(),
      tier: "desktop",
      onNotice: (m) => notices.push(m),
      fetch: (async () => new Response("", { status: 404 })) as unknown as typeof fetch,
    });
    expect(exhibit.nodes).toEqual([]);
    expect(notices.some((m) => m.includes("no topology"))).toBe(true);
    // Not an error dialog, and not a thrown load: the room stays enterable (§3).
    expect(exhibit.state).toBe("silent");
    exhibit.dispose();
  });

  it("plays the bed alone when the topology is not a topology", async () => {
    stubBrowser();
    const notices: string[] = [];
    const exhibit = await AudioExhibit.load({
      hanging: hanging(),
      tier: "desktop",
      onNotice: (m) => notices.push(m),
      fetch: (async () => new Response('{"schema":"orchard/topology/9","nodes":[]}')) as unknown as typeof fetch,
    });
    expect(exhibit.nodes).toEqual([]);
    expect(notices.some((m) => m.includes("no topology"))).toBe(true);
    exhibit.dispose();
  });

  it("names the playlist beside the topology", async () => {
    stubBrowser();
    const asked: string[] = [];
    const exhibit = await AudioExhibit.load({
      hanging: hanging(),
      tier: "desktop",
      fetch: (async (url: string) => {
        asked.push(url);
        return new Response(JSON.stringify(topology));
      }) as unknown as typeof fetch,
    });
    expect(exhibit.base).toBe(`${MEDIA_BASE}/audio/live/logswarm/run-7/`);
    expect(`${exhibit.base}${PLAYLIST_FILE}`).toBe(`${MEDIA_BASE}/audio/live/logswarm/run-7/live.m3u8`);
    exhibit.dispose();
  });

  it("reports what it is without claiming the sound is the grove's", async () => {
    stubBrowser();
    const exhibit = await AudioExhibit.load({
      hanging: hanging(), tier: "vr-quest",
      fetch: (async () => new Response(JSON.stringify(topology))) as unknown as typeof fetch,
    });
    const record = exhibit.provenance();
    expect(record.cached).toBe(false);
    expect(record.scientific_content).toBe(false);
    expect(record.exhibit).toBe("audio/live/logswarm/run-7");
    expect(String(record.note)).toContain("never cached");
    expect(record.budget).toEqual({ positioned: 16, panners: 6, hrtf: 0 });
    exhibit.dispose();
  });

  it("puts the provenance box around the placed cube", async () => {
    stubBrowser();
    const exhibit = await AudioExhibit.load({
      hanging: hanging(), tier: "desktop",
      fetch: (async () => new Response(JSON.stringify(topology))) as unknown as typeof fetch,
    });
    expect(exhibit.bounds.min.toArray()).toEqual([-1, -3.4, -8]);
    expect(exhibit.bounds.max.toArray()).toEqual([9, 6.6, 2]);
    exhibit.dispose();
  });
});
