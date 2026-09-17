import { describe, expect, it, vi } from "vitest";
import { SoundGate } from "./gate";
import { MicrophoneGrant } from "./microphone";
import { pulseGain } from "../world/venue";

class FakeContext extends EventTarget {
  state: AudioContextState = "suspended";
  refuse = false;
  async resume(): Promise<void> {
    if (this.refuse) return;
    this.state = "running";
    this.dispatchEvent(new Event("statechange"));
  }
}

describe("SoundGate", () => {
  it("is off until enabled from a gesture, and shares one context", async () => {
    const context = new FakeContext();
    const create = vi.fn(() => context as unknown as AudioContext);
    const gate = new SoundGate({ create });
    expect(gate.enabled).toBe(false);
    expect(gate.context).toBe(context);
    expect(gate.context).toBe(context);
    expect(create).toHaveBeenCalledTimes(1);
    expect(gate.enabled).toBe(false);
    const changed = vi.fn();
    gate.onChange(changed);
    expect(await gate.enable()).toBe(true);
    expect(gate.enabled).toBe(true);
    expect(changed).toHaveBeenCalled();
  });

  it("answers false, not a throw, when the browser keeps the context suspended", async () => {
    const context = new FakeContext();
    context.refuse = true;
    const gate = new SoundGate({ create: () => context as unknown as AudioContext });
    expect(await gate.enable()).toBe(false);
    expect(gate.enabled).toBe(false);
  });

  it("follows the context when the system suspends it again", async () => {
    const context = new FakeContext();
    const gate = new SoundGate({ create: () => context as unknown as AudioContext });
    await gate.enable();
    const changed = vi.fn();
    gate.onChange(changed);
    context.state = "suspended";
    context.dispatchEvent(new Event("statechange"));
    expect(gate.enabled).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

function fakeStream(): { stream: MediaStream; track: { readyState: string; enabled: boolean; stop: () => void; end: () => void } } {
  const target = new EventTarget();
  const track = {
    readyState: "live", enabled: true,
    stop() { this.readyState = "ended"; },
    end() { this.readyState = "ended"; target.dispatchEvent(new Event("ended")); },
    addEventListener: target.addEventListener.bind(target),
  };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

describe("MicrophoneGrant", () => {
  it("is on once a stream with a live track is open, and off when the track ends", async () => {
    const { stream, track } = fakeStream();
    const grant = new MicrophoneGrant({ open: () => Promise.resolve(stream) });
    expect(grant.live).toBe(false);
    expect(await grant.open()).toBe(true);
    expect(grant.live).toBe(true);
    expect(grant.stream).toBe(stream);
    const changed = vi.fn();
    grant.onChange(changed);
    track.end();
    expect(grant.live).toBe(false);
    expect(grant.stream).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("answers false on refusal and asks once for two callers", async () => {
    const open = vi.fn(() => Promise.reject(new Error("NotAllowedError")));
    const grant = new MicrophoneGrant({ open });
    const both = await Promise.all([grant.open(), grant.open()]);
    expect(both).toEqual([false, false]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(grant.live).toBe(false);
  });

  it("closes the stream on demand", async () => {
    const { stream, track } = fakeStream();
    const grant = new MicrophoneGrant({ open: () => Promise.resolve(stream) });
    await grant.open();
    grant.close();
    expect(track.readyState).toBe("ended");
    expect(grant.live).toBe(false);
  });
});

describe("pulseGain", () => {
  it("breathes about one in silence and never goes dark", () => {
    const samples = Array.from({ length: 50 }, (_, i) => pulseGain(null, i / 10));
    expect(Math.min(...samples)).toBeGreaterThan(0.85);
    expect(Math.max(...samples)).toBeLessThan(1.15);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.2);
  });

  it("lifts with the low end and falls between kicks", () => {
    expect(pulseGain(1, 0)).toBeGreaterThan(pulseGain(0.5, 0));
    expect(pulseGain(0.5, 0)).toBeGreaterThan(pulseGain(0, 0));
    expect(pulseGain(0, 0)).toBeGreaterThan(0.7);
    expect(pulseGain(1, 0)).toBeLessThanOrEqual(1.7);
    expect(pulseGain(2, 0)).toBe(pulseGain(1, 0));
  });
});
