// The microphone, the socket, and the turn-taking between them.
//
// Push-to-talk, not open-mic. An always-on microphone in a shared room
// transcribes every side conversation in the visitor's house and bills for
// it; holding a key is also the only honest way to show a person when they
// are being heard.
//
// Everything a browser provides is injected, so the loop is testable in node:
// there is no `navigator`, no `WebSocket` and no `MediaRecorder` referenced
// by name below.

import { EMPTY_TRANSCRIPT, advance, parseMessage, type TranscriptState } from "./transcript";

/** A grant, as `/voice/grant` returns it. */
export interface Grant {
  token: string;
  url: string;
  expires_in: number;
}

/** The socket, in the part of its shape this uses. */
export interface VoiceSocket {
  send(data: string | ArrayBufferLike | Blob): void;
  close(): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "open" | "error" | "close", listener: () => void): void;
}

/** A recorder that hands us encoded chunks. `MediaRecorder` satisfies this. */
export interface VoiceRecorder {
  start(timesliceMs: number): void;
  stop(): void;
  addEventListener(type: "dataavailable", listener: (event: { data: Blob }) => void): void;
}

export interface CaptureDeps {
  /** Opens the microphone. Must be called from a gesture, and NOT in VR. */
  openMicrophone: () => Promise<MediaStream>;
  /** Asks our own origin for a short-lived Deepgram token. */
  grant: () => Promise<Grant>;
  connect: (url: string, protocols: readonly string[]) => VoiceSocket;
  record: (stream: MediaStream) => VoiceRecorder;
  onCaption?: (text: string) => void;
  onUtterance: (text: string) => void;
  onError?: (message: string) => void;
}

/**
 * How often encoded audio is handed to the socket.
 *
 * Deepgram wants a steady trickle; too large a slice delays every partial by
 * its own length, and too small wastes frames on the main thread. 250 ms is
 * the interval their own browser examples use.
 */
export const SLICE_MS = 250;

/**
 * How long to wait after the key is released for the last words to come back.
 *
 * Releasing the key does not end the utterance: the audio already sent is
 * still being transcribed. Closing immediately is how the last two words of
 * every sentence go missing.
 */
export const FLUSH_MS = 1500;

export type CaptureState = "idle" | "opening" | "listening" | "closing";

/**
 * One push-to-talk session at a time.
 *
 * The microphone stream is kept between turns once opened. Re-requesting it
 * per turn re-prompts on some browsers, and -- the reason that matters here
 * -- a permission prompt cannot be shown at all inside an immersive session,
 * so a visitor in a headset would simply find the microphone dead. `prime()`
 * exists to take the permission while the DOM is still on screen.
 */
export class VoiceCapture {
  #deps: CaptureDeps;
  #stream: MediaStream | null = null;
  #socket: VoiceSocket | null = null;
  #recorder: VoiceRecorder | null = null;
  #transcript: TranscriptState = EMPTY_TRANSCRIPT;
  #state: CaptureState = "idle";
  #flush: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: CaptureDeps) {
    this.#deps = deps;
  }

  get state(): CaptureState {
    return this.#state;
  }

  /** Whether the microphone has been granted, and so whether VR can use it. */
  get primed(): boolean {
    return this.#stream !== null;
  }

  /**
   * Takes the microphone permission ahead of time.
   *
   * Call this from the flat HUD, before the visitor enters VR. Returns false
   * rather than throwing: a refused microphone is a choice, not a fault, and
   * the caller's job is to hide the control, not to report an error.
   */
  async prime(): Promise<boolean> {
    if (this.#stream) return true;
    try {
      this.#stream = await this.#deps.openMicrophone();
      return true;
    } catch {
      return false;
    }
  }

  /** Begins a turn. Safe to call twice; the second call is ignored. */
  async begin(): Promise<void> {
    if (this.#state !== "idle") return;
    this.#state = "opening";
    this.#cancelFlush();
    try {
      if (!(await this.prime())) {
        this.#state = "idle";
        this.#deps.onError?.("the microphone is not available");
        return;
      }
      const grant = await this.#deps.grant();
      // Deepgram takes its credential as a websocket subprotocol, because a
      // browser cannot set an Authorization header on a WebSocket -- and the
      // SCHEME matters: `token` is for an account API key, `bearer` for the
      // short-lived access token a grant returns. Sending a grant as `token`
      // is refused at the handshake, which surfaces as a dropped connection
      // with nothing to say why (deepgram-js-sdk's browser tests pin both).
      const socket = this.#deps.connect(grant.url, ["bearer", grant.token]);
      socket.addEventListener("message", (event) => this.#hear(event.data));
      socket.addEventListener("error", () => this.#fail("the transcriber dropped the connection"));
      socket.addEventListener("close", () => {
        if (this.#state === "listening") this.#fail("the transcriber closed the connection");
      });
      this.#socket = socket;

      const recorder = this.#deps.record(this.#stream!);
      recorder.addEventListener("dataavailable", (event) => {
        // A closed socket must not be written to, and a slice can arrive
        // after `end()` -- the recorder flushes one on stop.
        if (this.#socket && this.#state !== "idle" && event.data.size > 0) {
          this.#socket.send(event.data);
        }
      });
      recorder.start(SLICE_MS);
      this.#recorder = recorder;
      this.#state = "listening";
    } catch {
      this.#state = "idle";
      this.#teardown();
      this.#deps.onError?.("voice is not available right now");
    }
  }

  /**
   * Ends a turn: stops recording, asks for the rest of the transcript, and
   * gives the socket a moment to send it before closing.
   */
  end(): void {
    if (this.#state !== "listening" && this.#state !== "opening") return;
    this.#state = "closing";
    try {
      this.#recorder?.stop();
    } catch {
      // A recorder already stopped throws; nothing to do about it here.
    }
    this.#recorder = null;
    // Deepgram's own signal that no more audio is coming: it finalises what
    // it holds rather than waiting for a silence timeout that will not come.
    try {
      this.#socket?.send(JSON.stringify({ type: "CloseStream" }));
    } catch {
      /* the socket may already be gone */
    }
    this.#flush = setTimeout(() => {
      this.#emitRemainder();
      this.#teardown();
      this.#state = "idle";
    }, FLUSH_MS);
  }

  /**
   * Releases the microphone.
   *
   * The recording indicator stays lit until the tracks are stopped, and a
   * visitor cannot see that indicator inside a headset -- so leaving it on is
   * not a cosmetic bug here.
   */
  dispose(): void {
    this.#cancelFlush();
    this.#teardown();
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = null;
    this.#state = "idle";
  }

  #hear(data: unknown): void {
    if (typeof data !== "string") return;
    const message = parseMessage(data);
    if (!message) return;
    const step = advance(this.#transcript, message);
    this.#transcript = step.state;
    this.#deps.onCaption?.(step.caption);
    if (step.utterance !== null) this.#deps.onUtterance(step.utterance);
  }

  /** Whatever was held when the socket went away, rather than losing it. */
  #emitRemainder(): void {
    const step = advance(this.#transcript, { type: "UtteranceEnd" });
    this.#transcript = step.state;
    if (step.utterance !== null) this.#deps.onUtterance(step.utterance);
    this.#deps.onCaption?.("");
  }

  #fail(message: string): void {
    if (this.#state === "idle") return;
    this.#cancelFlush();
    this.#emitRemainder();
    this.#teardown();
    this.#state = "idle";
    this.#deps.onError?.(message);
  }

  #cancelFlush(): void {
    if (this.#flush !== null) clearTimeout(this.#flush);
    this.#flush = null;
  }

  #teardown(): void {
    try {
      this.#socket?.close();
    } catch {
      /* already closed */
    }
    this.#socket = null;
    this.#recorder = null;
    this.#transcript = EMPTY_TRANSCRIPT;
  }
}
