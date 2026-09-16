import { describe, expect, it, vi } from "vitest";
import { FLUSH_MS, SLICE_MS, VoiceCapture, type CaptureDeps, type VoiceRecorder, type VoiceSocket } from "./capture";

/** A socket whose frames the test delivers by hand. */
function fakeSocket() {
  const listeners: Record<string, Array<(event: never) => void>> = {};
  const sent: unknown[] = [];
  let closed = false;
  const socket: VoiceSocket = {
    send: (data) => sent.push(data),
    close: () => {
      closed = true;
    },
    addEventListener: (type: string, listener: (event: never) => void) => {
      (listeners[type] ??= []).push(listener);
    },
  };
  return {
    socket,
    sent,
    get closed() {
      return closed;
    },
    emit(type: string, event?: unknown) {
      for (const listener of listeners[type] ?? []) listener(event as never);
    },
    /** A Deepgram Results frame, as it arrives on the wire. */
    say(transcript: string, flags: { is_final?: boolean; speech_final?: boolean } = {}) {
      this.emit("message", {
        data: JSON.stringify({
          type: "Results",
          is_final: flags.is_final ?? false,
          speech_final: flags.speech_final ?? false,
          channel: { alternatives: [{ transcript }] },
        }),
      });
    },
  };
}

function fakeRecorder() {
  const listeners: Array<(event: { data: Blob }) => void> = [];
  let started: number | null = null;
  let stopped = false;
  const recorder: VoiceRecorder = {
    start: (ms) => {
      started = ms;
    },
    stop: () => {
      stopped = true;
    },
    addEventListener: (_type, listener) => listeners.push(listener),
  };
  return {
    recorder,
    get started() {
      return started;
    },
    get stopped() {
      return stopped;
    },
    chunk(size = 16) {
      for (const listener of listeners) listener({ data: { size } as Blob });
    },
  };
}


function harness(over: Partial<CaptureDeps> = {}) {
  const socket = fakeSocket();
  const recorder = fakeRecorder();
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
  const said: string[] = [];
  const captions: string[] = [];
  const errors: string[] = [];
  const deps: CaptureDeps = {
    openMicrophone: vi.fn(async () => stream),
    grant: vi.fn(async () => ({ token: "dg-temp", url: "wss://api.deepgram.com/v1/listen?x=1", expires_in: 30 })),
    connect: vi.fn(() => socket.socket),
    record: vi.fn(() => recorder.recorder),
    onUtterance: (text) => said.push(text),
    onCaption: (text) => captions.push(text),
    onError: (message) => errors.push(message),
    ...over,
  };
  return { capture: new VoiceCapture(deps), deps, socket, recorder, said, captions, errors, stopTrack };
}

describe("a turn", () => {
  it("opens the microphone, takes a grant, and records in slices", async () => {
    const h = harness();
    await h.capture.begin();
    expect(h.capture.state).toBe("listening");
    expect(h.deps.grant).toHaveBeenCalledOnce();
    expect(h.recorder.started).toBe(SLICE_MS);
  });

  it("carries the token as a subprotocol, since a browser cannot set a header", async () => {
    const h = harness();
    await h.capture.begin();
    expect(h.deps.connect).toHaveBeenCalledWith("wss://api.deepgram.com/v1/listen?x=1", ["token", "dg-temp"]);
  });

  it("sends one line for one sentence, not one per fragment", async () => {
    const h = harness();
    await h.capture.begin();
    h.socket.say("faye what is", { is_final: true });
    h.socket.say("running", { is_final: true, speech_final: true });
    expect(h.said).toEqual(["faye what is running"]);
  });

  it("shows a live caption while the words are still moving", async () => {
    const h = harness();
    await h.capture.begin();
    h.socket.say("faye wh");
    h.socket.say("faye what");
    expect(h.captions.at(-1)).toBe("faye what");
    expect(h.said).toEqual([]);
  });

  it("does not open twice when begin is called again", async () => {
    const h = harness();
    await h.capture.begin();
    await h.capture.begin();
    expect(h.deps.grant).toHaveBeenCalledOnce();
  });
});

describe("ending a turn", () => {
  it("tells Deepgram no more audio is coming, rather than waiting for silence", async () => {
    const h = harness();
    await h.capture.begin();
    h.capture.end();
    expect(h.socket.sent.some((s) => typeof s === "string" && s.includes("CloseStream"))).toBe(true);
    expect(h.recorder.stopped).toBe(true);
  });

  it("waits for the last words before closing the socket", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await h.capture.begin();
      h.socket.say("faye how is the peer", { is_final: true });
      h.capture.end();
      // Releasing the key does not end the utterance: audio already sent is
      // still being transcribed. Closing here loses the sentence.
      expect(h.socket.closed).toBe(false);
      vi.advanceTimersByTime(FLUSH_MS);
      expect(h.said).toEqual(["faye how is the peer"]);
      expect(h.socket.closed).toBe(true);
      expect(h.capture.state).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an unconfirmed last word rather than dropping it", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await h.capture.begin();
      h.socket.say("faye how is the", { is_final: true });
      h.socket.say("peer");
      h.capture.end();
      vi.advanceTimersByTime(FLUSH_MS);
      expect(h.said).toEqual(["faye how is the peer"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not write a slice into a socket that is gone", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await h.capture.begin();
      h.capture.end();
      vi.advanceTimersByTime(FLUSH_MS);
      const before = h.socket.sent.length;
      h.recorder.chunk();
      expect(h.socket.sent.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("when things go wrong", () => {
  it("treats a refused microphone as a choice, not a fault", async () => {
    const h = harness({ openMicrophone: vi.fn(async () => { throw new Error("NotAllowedError"); }) });
    expect(await h.capture.prime()).toBe(false);
    await h.capture.begin();
    expect(h.capture.state).toBe("idle");
    expect(h.errors).toEqual(["the microphone is not available"]);
  });

  it("does not reach Deepgram when the microphone was refused", async () => {
    const h = harness({ openMicrophone: vi.fn(async () => { throw new Error("no"); }) });
    await h.capture.begin();
    expect(h.deps.grant).not.toHaveBeenCalled();
  });

  it("recovers to idle when the grant fails", async () => {
    const h = harness({ grant: vi.fn(async () => { throw new Error("503"); }) });
    await h.capture.begin();
    expect(h.capture.state).toBe("idle");
    expect(h.errors).toEqual(["voice is not available right now"]);
  });

  it("keeps what was heard when the socket drops mid-sentence", async () => {
    const h = harness();
    await h.capture.begin();
    h.socket.say("faye status", { is_final: true });
    h.socket.emit("error");
    expect(h.said).toEqual(["faye status"]);
    expect(h.capture.state).toBe("idle");
    expect(h.errors.length).toBe(1);
  });

  it("does not report a close that follows a normal end", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await h.capture.begin();
      h.capture.end();
      h.socket.emit("close");
      vi.advanceTimersByTime(FLUSH_MS);
      expect(h.errors).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the microphone itself", () => {
  it("is kept between turns, because VR cannot raise a permission prompt", async () => {
    const h = harness();
    await h.capture.prime();
    await h.capture.begin();
    h.capture.end();
    await h.capture.begin();
    expect(h.deps.openMicrophone).toHaveBeenCalledOnce();
    expect(h.capture.primed).toBe(true);
  });

  it("is released on dispose, so the recording indicator goes out", async () => {
    const h = harness();
    await h.capture.begin();
    h.capture.dispose();
    expect(h.stopTrack).toHaveBeenCalledOnce();
    expect(h.capture.primed).toBe(false);
    expect(h.socket.closed).toBe(true);
  });
});
