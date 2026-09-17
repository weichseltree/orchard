// The venue's sound, as one question: is the visitor's audio output on?
//
// A browser starts an AudioContext suspended until the page has had a
// gesture, and the operating system can suspend it again (a headset taken
// off, a call). So "sound on" is not a flag the page sets once but the
// context's own state, read whenever the door asks. The context is made
// lazily and shared: the club's live exhibit joins it (`AudioField` takes a
// context to join), so the same "Sound on" that opens the door is what lets
// the stream be heard, and there is never a second graph to unmute.

export interface SoundGateDeps {
  /** Makes the context; `AudioContext` in a browser, a fake in tests. */
  create: () => AudioContext;
}

export class SoundGate {
  #context: AudioContext | null = null;
  readonly #create: () => AudioContext;
  readonly #listeners = new Set<() => void>();

  constructor(deps: SoundGateDeps = { create: () => new AudioContext() }) {
    this.#create = deps.create;
  }

  /** The shared context, made on first ask; suspended until `enable`. */
  get context(): AudioContext {
    if (!this.#context) {
      this.#context = this.#create();
      this.#context.addEventListener?.("statechange", () => this.#changed());
    }
    return this.#context;
  }

  /** Whether sound is on: a context that exists and is running. */
  get enabled(): boolean {
    return this.#context?.state === "running";
  }

  /**
   * Switches sound on. Call from a gesture (a button, an XR select); a
   * context resumed without one stays suspended and this answers false
   * rather than throwing, since a refused resume is a browser's policy, not
   * a fault to report as one.
   */
  async enable(): Promise<boolean> {
    const context = this.context;
    try {
      await context.resume();
    } catch {
      /* stays suspended */
    }
    this.#changed();
    return this.enabled;
  }

  /** Called whenever `enabled` may have changed. Returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}
