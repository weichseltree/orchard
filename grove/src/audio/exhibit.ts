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
import { DEFAULT_MAX_LAG_SECONDS, RETRY_MS, SEEK_LAG_SECONDS, lagSeconds, playlistIsFresh, shouldFallSilent } from "./stream";

export type ExhibitStreamState = "connecting" | "live" | "silent" | "disposed";

export interface ExhibitStreamOptions {
  /** `audio/live/<provider>/<stream-id>`'s LL-HLS playlist URL (AUDIO-STREAM.md §1). */
  url: string;
  /** Seconds behind the live edge before this drops to silence (§3, budget). */
  maxLagSeconds?: number;
  /** How often the live-edge lag is checked, in ms. */
  checkIntervalMs?: number;
  onNotice?: (message: string) => void;
  /**
   * Start asleep: nothing is fetched until `setActive(true)`. A live exhibit
   * is loaded with its room's neighbourhood, but it is heard only in its
   * room, and an encoder that runs only for the room's visitors should not
   * be polled by everyone in the palace.
   */
  dormant?: boolean;
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
  #retry: ReturnType<typeof setInterval> | null = null;
  /** Seeks back to the edge since playback was last in step; two in a row that did not help mean the stream is behind. */
  #seeks = 0;
  #onNotice: ((message: string) => void) | undefined;
  #disposed = false;
  /** Whether a room control asked to hear this; kept across a silence so the way back is heard too. */
  #wantsSound = false;
  /** Set when silence is this browser's, not the stream's: there is nothing to come back to. */
  #unplayable = false;
  /** Asleep: not fetching, not polling, not playing, until the visitor is in its room. */
  #dormant = false;
  /** Told the visitor the exhibit is quiet; said once per silence. */
  #saidQuiet = false;

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

  /** How far behind the live edge playback is, in seconds; null without a live edge to measure against. For diagnostics. */
  get lag(): number | null {
    const edge = this.#hls?.liveSyncPosition;
    return edge == null ? null : lagSeconds(edge, this.audio.currentTime);
  }

  static async create(options: ExhibitStreamOptions): Promise<ExhibitStream> {
    const audio = document.createElement("audio");
    audio.crossOrigin = "anonymous";
    // Autoplay is only granted muted; a room-level control unmutes on
    // interaction, the same discipline `media/videowall.ts` uses.
    audio.muted = true;
    audio.setAttribute("muted", "");
    // Muted autoplay is permitted, and it is what plays again after a
    // re-attach, where an explicit play() races the new source.
    audio.autoplay = true;
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
    if (options.dormant) {
      stream.#dormant = true;
      stream.#state = "silent";
    } else {
      await stream.#wake();
    }
    return stream;
  }

  /**
   * Awake, the stream fetches and plays; asleep, it holds nothing open. The
   * room's owner flips this as the visitor comes and goes.
   */
  setActive(active: boolean): void {
    if (this.#disposed || this.#unplayable) return;
    if (active && this.#dormant) {
      this.#dormant = false;
      void this.#wake();
    } else if (!active && !this.#dormant) {
      this.#dormant = true;
      this.#sleep();
    }
  }

  /** Looks at the playlist first: a live one is attached, an empty or stale one is waited on quietly. */
  async #wake(): Promise<void> {
    if (this.#disposed || this.#dormant) return;
    let live = false;
    try {
      const response = await fetch(this.url, { cache: "no-store" });
      live = response.ok && playlistIsFresh(await response.text(), Date.now());
    } catch {
      live = false;
    }
    if (this.#disposed || this.#dormant) return;
    if (live) {
      this.#state = "connecting";
      await this.#start();
      if ((this.#state as ExhibitStreamState) === "live") {
        this.#saidQuiet = false;
        if (this.#wantsSound) this.unmute();
      }
      return;
    }
    this.#state = "silent";
    if (!this.#saidQuiet) {
      this.#saidQuiet = true;
      this.#onNotice?.("exhibit quiet: nothing is playing just now");
    }
    this.#retry ??= setInterval(() => void this.#lookAgain(), RETRY_MS);
  }

  #sleep(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    if (this.#retry !== null) clearInterval(this.#retry);
    this.#retry = null;
    this.#hls?.destroy();
    this.#hls = null;
    this.audio.pause();
    this.audio.muted = true;
    this.#state = "silent";
  }

  async #start(): Promise<void> {
    try {
      const platform = globalThis as { MediaSource?: unknown; ManagedMediaSource?: unknown };
      if (platform.MediaSource || platform.ManagedMediaSource) {
        const { default: Hls } = await loadHls();
        if (this.#disposed) return;
        if (Hls.isSupported()) {
          // Low-latency mode, for a provider that publishes parts; the floor's
          // encoder publishes plain two-second segments (CLUB.md §5), on which
          // this is a no-op and playback sits some five seconds behind.
          // Hold the live edge two segments back; `#checkLag` seeks back to it
          // when playback drifts, rather than letting §3's rule fire first.
          const instance = new Hls({ enableWorker: true, lowLatencyMode: true, liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 6 });
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
          this.#unplayable = true;
          this.#fallSilent("no MSE and no native HLS in this browser");
          return;
        }
        this.audio.src = this.url;
        this.audio.onerror = () => this.#fallSilent("the native player gave up");
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
    if (shouldFallSilent(lag, this.#maxLagSeconds) && this.#seeks >= 2) {
      // Seeking did not bring it back: the stream, not the player, is behind.
      this.#fallSilent(`fell behind the live edge by ${lag.toFixed(1)}s`);
      return;
    }
    if (lag > SEEK_LAG_SECONDS) {
      // A page that froze (the world building) or a slow start: jump back to
      // the edge, a glitch a listener hears once rather than a set played late.
      this.#seeks++;
      this.audio.currentTime = liveEdge;
      if (this.audio.paused) void this.audio.play().catch(() => undefined);
    } else {
      this.#seeks = 0;
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
    this.#wantsSound = true;
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
    // A dead stream can come back (an idle floor's encoder starts when
    // someone arrives, orchard/stream.py): watch its playlist for media.
    if (this.#unplayable || this.#disposed || this.#dormant) return;
    this.#hls?.destroy();
    this.#hls = null;
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    this.#retry ??= setInterval(() => void this.#lookAgain(), RETRY_MS);
  }

  async #lookAgain(): Promise<void> {
    if (this.#disposed || this.#dormant || this.#state !== "silent") return;
    try {
      const response = await fetch(this.url, { cache: "no-store" });
      if (!response.ok || !playlistIsFresh(await response.text(), Date.now())) return;
    } catch {
      return;
    }
    if (this.#disposed || this.#dormant || this.#state !== "silent") return;
    if (this.#retry !== null) clearInterval(this.#retry);
    this.#retry = null;
    this.#state = "connecting";
    await this.#start();
    if ((this.#state as ExhibitStreamState) === "live") {
      this.#saidQuiet = false;
      this.#onNotice?.("exhibit playing");
      if (this.#wantsSound) this.unmute();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    if (this.#retry !== null) clearInterval(this.#retry);
    this.#retry = null;
    this.#hls?.destroy();
    this.#hls = null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.audio.remove();
    this.#state = "disposed";
  }
}
