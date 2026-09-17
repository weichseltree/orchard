// The venue's microphone grant. The club's door asks for a microphone that is
// on, which means a stream that is open and whose track is live -- not a
// permission that was once granted. The stream is kept open, the way
// `voice/capture.ts` keeps its own: a permission prompt cannot be raised
// inside an immersive session, so what is opened outside VR is what a
// headset has. Nothing is sent anywhere by this file; it holds the stream
// the karaoke link will publish (docs/specs/CLUB.md) and answers the door.
//
// It is separate from the voice capture on purpose: that one exists only
// when the transcription route is configured and its browser can record,
// and a visitor with neither can still open a microphone.

export interface MicrophoneDeps {
  open: () => Promise<MediaStream>;
}

const defaultDeps: MicrophoneDeps = {
  open: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
};

export class MicrophoneGrant {
  #stream: MediaStream | null = null;
  #opening: Promise<boolean> | null = null;
  readonly #deps: MicrophoneDeps;
  readonly #listeners = new Set<() => void>();

  constructor(deps: MicrophoneDeps = defaultDeps) {
    this.#deps = deps;
  }

  /** Whether the microphone is on: an open stream with a live audio track. */
  get live(): boolean {
    return this.#stream?.getAudioTracks().some((track) => track.readyState === "live" && track.enabled) ?? false;
  }

  /** The open stream, for whatever will publish it; null until allowed. */
  get stream(): MediaStream | null {
    return this.live ? this.#stream : null;
  }

  /**
   * Asks for the microphone. False when refused or unavailable, never a
   * throw: a refusal is the visitor's choice. Two asks at once share one
   * prompt.
   */
  async open(): Promise<boolean> {
    if (this.live) return true;
    if (this.#opening) return this.#opening;
    this.#opening = (async () => {
      try {
        const stream = await this.#deps.open();
        this.#stream = stream;
        // A track the browser or the visitor ends (the tab's "stop sharing",
        // a device unplugged) switches the microphone off again.
        for (const track of stream.getAudioTracks()) track.addEventListener?.("ended", () => this.#changed());
        this.#changed();
        return this.live;
      } catch {
        this.#stream = null;
        return false;
      } finally {
        this.#opening = null;
      }
    })();
    return this.#opening;
  }

  /** Stops the stream; the door closes with it. */
  close(): void {
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = null;
    this.#changed();
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}
