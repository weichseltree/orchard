// A live audio exhibit: LL-HLS, Opus in fMP4, played through a hidden
// <audio> element (AUDIO-STREAM.md §3). This class is the CARRIER and the
// fall-behind rule, and nothing else: it knows how to be a stream and how to
// go silent, not where it is heard.
//
// Where it is heard is `audio/field.ts`. Unmuted, the element feeds that
// graph's non-positioned bed, and the per-node positioned sources §5 asks
// for hang off the same graph. Both are still against the §5 budget, which
// is unmeasured (§7 item 2).
//
// The exhibit's URL is never handed to the service worker as anything but
// network (`grove/src/sw/policy.ts`'s EXHIBIT_PATH): no `cache.put`, no
// stale response, whatever this class does with it.
import { DEFAULT_MAX_LAG_SECONDS, lagSeconds, shouldFallSilent } from "./stream";

export type ExhibitStreamState = "connecting" | "live" | "silent" | "disposed";

export interface ExhibitStreamOptions {
  /** `audio/live/<provider>/<stream-id>`'s LL-HLS playlist URL (AUDIO-STREAM.md §1). */
  url: string;
  /** Seconds behind the live edge before this drops to silence (§3, budget). */
  maxLagSeconds?: number;
  /** How often the live-edge lag is checked, in ms. */
  checkIntervalMs?: number;
  onNotice?: (message: string) => void;
}

let hlsModule: Promise<typeof import("hls.js")> | null = null;

function loadHls(): Promise<typeof import("hls.js")> {
  return hlsModule ??= import("hls.js").catch((error: unknown) => {
    hlsModule = null;
    throw error;
  });
}

export class ExhibitStream {
  readonly audio: HTMLAudioElement;
  readonly url: string;

  #state: ExhibitStreamState = "connecting";
  #hls: { destroy(): void; liveSyncPosition: number | null } | null = null;
  #maxLagSeconds: number;
  #checkIntervalMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #onNotice: ((message: string) => void) | undefined;
  #disposed = false;

  private constructor(audio: HTMLAudioElement, url: string, maxLagSeconds: number,
                      checkIntervalMs: number, onNotice: ((message: string) => void) | undefined) {
    this.audio = audio;
    this.url = url;
    this.#maxLagSeconds = maxLagSeconds;
    this.#checkIntervalMs = checkIntervalMs;
    this.#onNotice = onNotice;
  }

  get state(): ExhibitStreamState {
    return this.#state;
  }

  /** A dropped or dead stream is silence -- never an error dialog (§3). */
  get silent(): boolean {
    return this.#state !== "live";
  }

  static async create(options: ExhibitStreamOptions): Promise<ExhibitStream> {
    const audio = document.createElement("audio");
    audio.crossOrigin = "anonymous";
    // Autoplay is only granted muted; a room-level control unmutes on
    // interaction, the same discipline `media/videowall.ts` uses.
    audio.muted = true;
    audio.setAttribute("muted", "");
    audio.preload = "auto";
    audio.setAttribute("aria-hidden", "true");
    audio.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none";
    document.body.append(audio);
    const stream = new ExhibitStream(
      audio, options.url,
      options.maxLagSeconds ?? DEFAULT_MAX_LAG_SECONDS,
      options.checkIntervalMs ?? 1000,
      options.onNotice,
    );
    await stream.#start();
    return stream;
  }

  async #start(): Promise<void> {
    try {
      const platform = globalThis as { MediaSource?: unknown; ManagedMediaSource?: unknown };
      if (platform.MediaSource || platform.ManagedMediaSource) {
        const { default: Hls } = await loadHls();
        if (this.#disposed) return;
        if (Hls.isSupported()) {
          // Low-latency mode: the carrier this exhibit asks for (§3's 200 ms
          // parts / 1 s segments), not the video wall's ordinary VOD path.
          const instance = new Hls({ enableWorker: true, lowLatencyMode: true });
          this.#hls = instance;
          instance.on(Hls.Events.ERROR, (_event: unknown, data: { fatal?: boolean }) => {
            if (data.fatal) this.#fallSilent("a fatal HLS error");
          });
          instance.loadSource(this.url);
          instance.attachMedia(this.audio as unknown as HTMLMediaElement);
          this.#state = "live";
        }
      }
      if (this.#state !== "live") {
        if (!this.audio.canPlayType("application/vnd.apple.mpegurl")) {
          this.#fallSilent("no MSE and no native HLS in this browser");
          return;
        }
        this.audio.src = this.url;
        this.#state = "live";
      }
      void this.audio.play().catch(() => undefined);
      this.#timer = setInterval(() => this.#checkLag(), this.#checkIntervalMs);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.#fallSilent(`could not start (${detail})`);
    }
  }

  #checkLag(): void {
    if (this.#disposed || this.#state !== "live" || !this.#hls) return;
    const liveEdge = this.#hls.liveSyncPosition;
    if (liveEdge == null) return;
    const lag = lagSeconds(liveEdge, this.audio.currentTime);
    if (shouldFallSilent(lag, this.#maxLagSeconds)) {
      this.#fallSilent(`fell behind the live edge by ${lag.toFixed(1)}s`);
    }
  }

  /**
   * Let it be heard. Autoplay is granted muted, so the element starts muted
   * and a room control calls this on a real interaction. When the element
   * feeds an `AudioField` (`audio/field.ts`), unmuting it hands the sound to
   * that graph rather than straight to the speakers, and the field's master
   * gain is what a volume control then moves.
   *
   * A silent or disposed stream stays muted: there is nothing to unmute, and
   * §3's fall-behind rule must not be undone by a control.
   */
  unmute(): void {
    if (this.#state !== "live") return;
    this.audio.muted = false;
    this.audio.removeAttribute("muted");
    void this.audio.play().catch(() => undefined);
  }

  mute(): void {
    this.audio.muted = true;
  }

  get muted(): boolean {
    return this.audio.muted;
  }

  /**
   * Dropped to silence, not stretched, not played late (§3). The room stays
   * enterable: this is state a caller renders as a visible marker, never an
   * error dialog.
   */
  #fallSilent(reason: string): void {
    if (this.#state === "silent" || this.#state === "disposed") return;
    this.#state = "silent";
    this.audio.pause();
    this.audio.muted = true;
    this.#onNotice?.(`exhibit silent: ${reason}`);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    this.#hls?.destroy();
    this.#hls = null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.audio.remove();
    this.#state = "disposed";
  }
}
