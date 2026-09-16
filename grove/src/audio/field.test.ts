import { describe, expect, it, vi } from "vitest";
import { AudioField, azimuthPan, type AudioFieldOptions } from "./field";
import { AUDIO_BUDGET } from "./sources";
import type { PlacedNode } from "./topology";

// A fake graph. Web Audio is not in the node environment, and the field's job
// is which nodes exist and what they are connected to -- not what they sound
// like -- so the fake records the graph and nothing else.

class FakeParam {
  value = 0;
  setValueAtTime(value: number): this {
    this.value = value;
    return this;
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  disconnected = 0;
  connect(target: FakeNode): FakeNode {
    this.outputs.push(target);
    return target;
  }
  disconnect(): void {
    ++this.disconnected;
    this.outputs.length = 0;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakePanner extends FakeNode {
  panningModel = "equalpower";
  distanceModel = "inverse";
  refDistance = 1;
  maxDistance = 10000;
  positionX = new FakeParam();
  positionY = new FakeParam();
  positionZ = new FakeParam();
}

class FakeStereoPanner extends FakeNode {
  pan = new FakeParam();
}

class FakeContext {
  currentTime = 0;
  destination = new FakeNode();
  closed = 0;
  resumed = 0;
  listener = Object.fromEntries(
    ["positionX", "positionY", "positionZ", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"]
      .map((key) => [key, new FakeParam()]),
  ) as Record<string, FakeParam>;
  panners: FakePanner[] = [];
  stereos: FakeStereoPanner[] = [];
  createGain(): FakeGain { return new FakeGain(); }
  createPanner(): FakePanner {
    const panner = new FakePanner();
    this.panners.push(panner);
    return panner;
  }
  createStereoPanner(): FakeStereoPanner {
    const stereo = new FakeStereoPanner();
    this.stereos.push(stereo);
    return stereo;
  }
  createMediaElementSource(): FakeNode { return new FakeNode(); }
  async resume(): Promise<void> { ++this.resumed; }
  async close(): Promise<void> { ++this.closed; }
}

function nodesAlongX(count: number): PlacedNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    label: "",
    position: [i + 1, 0, 0] as [number, number, number],
  }));
}

function field(nodes: PlacedNode[], options: Partial<AudioFieldOptions> = {}) {
  const context = new FakeContext();
  const instance = new AudioField({
    tier: "desktop",
    nodes,
    context: context as unknown as AudioContext,
    ...options,
  });
  return { context, field: instance };
}

/** The graph the fake recorded, for a node the field types as a real one. */
function graph(node: AudioNode): FakeNode {
  return node as unknown as FakeNode;
}

describe("AudioField", () => {
  it("is the bed alone until it is reassigned", () => {
    const { context, field: f } = field(nodesAlongX(3));
    expect(graph(f.bed).outputs).toContain(graph(f.master));
    expect(graph(f.master).outputs).toContain(context.destination);
    expect(context.panners).toHaveLength(0);
    expect([...f.assignment.keys()]).toHaveLength(0);
  });

  it("builds a source per node the budget allows and no more", () => {
    const { context, field: f } = field(nodesAlongX(10), {
      budget: { positioned: 4, panners: 2, hrtf: 1 },
    });
    f.setListener([0, 0, 0], [0, 0, -1]);
    const assignment = f.reassign();
    expect(context.panners).toHaveLength(2);
    expect(context.panners[0]!.panningModel).toBe("HRTF");
    expect(context.panners[1]!.panningModel).toBe("equalpower");
    expect(context.stereos).toHaveLength(2);
    expect([...assignment.values()].filter((k) => k === "bed")).toHaveLength(6);
  });

  it("puts a panner at the node's placed position", () => {
    const { context, field: f } = field([{ id: "api", label: "", position: [3, 1.6, -2] }], {
      budget: { positioned: 1, panners: 1, hrtf: 0 },
    });
    f.setListener([0, 0, 0], [0, 0, -1]);
    f.reassign();
    const panner = context.panners[0]!;
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([3, 1.6, -2]);
  });

  it("moves the listener, positions and orientation together", () => {
    const { context, field: f } = field(nodesAlongX(1));
    f.setListener([1, 2, 3], [0, 0, -1], [0, 1, 0]);
    expect(context.listener.positionX!.value).toBe(1);
    expect(context.listener.positionZ!.value).toBe(3);
    expect(context.listener.forwardZ!.value).toBe(-1);
    expect(context.listener.upY!.value).toBe(1);
  });

  it("retires a source that loses its rung and keeps one that does not", () => {
    const nodes: PlacedNode[] = [
      { id: "near", label: "", position: [1, 0, 0] },
      { id: "far", label: "", position: [50, 0, 0] },
    ];
    const { context, field: f } = field(nodes, {
      budget: { positioned: 1, panners: 1, hrtf: 0 },
      hysteresis: 1,
    });
    f.setListener([0, 0, 0], [0, 0, -1]);
    expect(f.reassign().get("near")).toBe("panner");
    const first = context.panners[0]!;
    // Walk past "far": it is now the nearer of the two and takes the rung.
    f.setListener([60, 0, 0], [0, 0, -1]);
    expect(f.reassign().get("far")).toBe("panner");
    expect(first.disconnected).toBe(1);
    expect(context.panners).toHaveLength(2);
    // Standing still rebuilds nothing.
    f.reassign();
    expect(context.panners).toHaveLength(2);
  });

  it("refreshes the cheap rung's pan as the visitor turns, since it has no listener", () => {
    const { context, field: f } = field([{ id: "east", label: "", position: [10, 0, 0] }], {
      budget: { positioned: 1, panners: 0, hrtf: 0 },
    });
    f.setListener([0, 0, 0], [0, 0, -1]);
    f.reassign();
    const stereo = context.stereos[0]!;
    expect(stereo.pan.value).toBeCloseTo(1, 6);
    // Turn to face the other way: the node is now on the other hand.
    f.setListener([0, 0, 0], [0, 0, 1]);
    f.reassign();
    expect(stereo.pan.value).toBeCloseTo(-1, 6);
  });

  it("routes a live exhibit's element into the bed", () => {
    const { field: f } = field(nodesAlongX(1));
    const source = graph(f.connectBed({} as HTMLMediaElement));
    expect(source.outputs).toContain(graph(f.bed));
  });

  it("connects a supplied voice to its node, and disposes it when the node is retired", () => {
    const disposed: string[] = [];
    const voice = vi.fn((_context: BaseAudioContext, node: PlacedNode) => ({
      output: new FakeNode() as unknown as AudioNode,
      dispose: () => disposed.push(node.id),
    }));
    const { field: f } = field(nodesAlongX(2), {
      budget: { positioned: 1, panners: 1, hrtf: 0 },
      hysteresis: 1,
      voice,
    });
    f.setListener([0, 0, 0], [0, 0, -1]);
    f.reassign();
    expect(voice).toHaveBeenCalledTimes(1);
    f.dispose();
    expect(disposed).toEqual(["n0"]);
  });

  it("ships no voice of its own: sonification is the provider's (AUDIO-STREAM.md §4)", () => {
    const { context, field: f } = field(nodesAlongX(3), { budget: { positioned: 3, panners: 3, hrtf: 0 } });
    f.setListener([0, 0, 0], [0, 0, -1]);
    f.reassign();
    // Panners exist and are placed, but nothing feeds them.
    expect(context.panners).toHaveLength(3);
    for (const panner of context.panners) expect(panner.outputs).toEqual([graph(f.master)]);
  });

  it("closes a context it made and leaves one it was handed", () => {
    const { context, field: f } = field(nodesAlongX(1));
    f.dispose();
    expect(context.closed).toBe(0);
    // Disposing twice is a no-op.
    f.dispose();
    expect(context.closed).toBe(0);
  });

  it("takes the tier's budget when none is given", () => {
    const { field: f } = field(nodesAlongX(1), { tier: "vr-quest" });
    expect(f.budget).toEqual(AUDIO_BUDGET["vr-quest"]);
  });
});

describe("azimuthPan", () => {
  it("is 0 straight ahead and +-1 on the hands", () => {
    expect(azimuthPan([0, 0, -10], [0, 0, 0], [0, 0, -1])).toBeCloseTo(0, 6);
    expect(azimuthPan([10, 0, 0], [0, 0, 0], [0, 0, -1])).toBeCloseTo(1, 6);
    expect(azimuthPan([-10, 0, 0], [0, 0, 0], [0, 0, -1])).toBeCloseTo(-1, 6);
  });

  it("swaps the hands when the listener turns around", () => {
    const ahead = azimuthPan([10, 0, 0], [0, 0, 0], [0, 0, -1]);
    const behind = azimuthPan([10, 0, 0], [0, 0, 0], [0, 0, 1]);
    expect(behind).toBeCloseTo(-ahead, 6);
  });

  it("is 0 for a node the listener stands on, and for a forward with no right hand", () => {
    expect(azimuthPan([0, 0, 0], [0, 0, 0], [0, 0, -1])).toBe(0);
    expect(azimuthPan([10, 0, 0], [0, 0, 0], [0, 1, 0], [0, 1, 0])).toBe(0);
  });

  it("never leaves the StereoPanner's range", () => {
    for (const angle of [0, 0.3, 1.1, 2.7, 4.9, 6.1]) {
      const pan = azimuthPan([Math.cos(angle) * 40, 3, Math.sin(angle) * 40], [0, 0, 0], [0, 0, -1]);
      expect(pan).toBeGreaterThanOrEqual(-1);
      expect(pan).toBeLessThanOrEqual(1);
    }
  });
});
