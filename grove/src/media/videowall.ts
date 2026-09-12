import {
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  VideoTexture,
} from "three";

// One wall, one decoder. Quest 3 will decode exactly one HLS stream without
// complaint and fall over on two (grove/README.md: "One screen plays at a
// time"). Every wall is built showing its poster frame; the decoder is handed
// to ONE wall at a time by `attach()`, and `release()` hands it back, so a
// mansion with several walls plays the one the visitor is nearest and the
// others stay pictures.

let decoderInUse = false;

export interface VideoWallOptions {
  /** URL of the HLS master playlist. */
  master: string;
  poster?: string;
  widthMeters: number;
  /** Picture aspect; 16/9 unless the bundle says otherwise. */
  aspect?: number;
  onNotice?: (message: string) => void;
}

export type VideoWallMode = "hls.js" | "native" | "poster";

const POSTER_FALLBACK = 0x1b241d;

export class VideoWall {
  readonly mesh: Mesh;
  readonly video: HTMLVideoElement;
  readonly master: string;

  #mode: VideoWallMode = "poster";
  #texture: VideoTexture | null = null;
  #poster: Texture | null;
  #hls: { destroy(): void } | null = null;
  #disposed = false;
  #onNotice: ((message: string) => void) | undefined;

  private constructor(
    mesh: Mesh,
    video: HTMLVideoElement,
    master: string,
    poster: Texture | null,
    onNotice: ((message: string) => void) | undefined,
  ) {
    this.mesh = mesh;
    this.video = video;
    this.master = master;
    this.#poster = poster;
    this.#onNotice = onNotice;
  }

  /** "poster" until `attach()` hands this wall the decoder. */
  get mode(): VideoWallMode {
    return this.#mode;
  }

  get playing(): boolean {
    return this.#mode !== "poster";
  }

  static async create(options: VideoWallOptions): Promise<VideoWall> {
    const aspect = options.aspect && options.aspect > 0 ? options.aspect : 16 / 9;
    const height = options.widthMeters / aspect;
    const geometry = new PlaneGeometry(options.widthMeters, height);

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    // Autoplay is only granted to a muted video; the HUD offers the unmute.
    video.muted = true;
    video.setAttribute("muted", "");
    video.preload = "auto";
    if (options.poster) video.poster = options.poster;
    // iOS Safari will not decode a detached <video> into a WebGL texture, and
    // `display: none` counts as detached: the wall goes black with no error.
    // One transparent pixel in the corner keeps it composited and invisible.
    video.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1";
    video.setAttribute("aria-hidden", "true");
    document.body.append(video);

    // The poster frame is the wall's picture whenever it is not the one
    // playing; a wall that cannot even fetch its poster is a dark panel.
    let poster: Texture | null = null;
    if (options.poster) {
      try {
        poster = await new TextureLoader().loadAsync(options.poster);
        poster.colorSpace = SRGBColorSpace;
      } catch {
        options.onNotice?.("a video wall's poster did not load; showing a dark panel");
      }
    }
    const material = new MeshBasicMaterial({
      color: poster ? 0xffffff : POSTER_FALLBACK,
      ...(poster ? { map: poster } : {}),
      toneMapped: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = "video-wall";
    return new VideoWall(mesh, video, options.master, poster, options.onNotice);
  }

  /**
   * Take the decoder and play. False when another wall holds it or this
   * browser has no HLS path; the wall then keeps its poster.
   */
  async attach(): Promise<boolean> {
    if (this.#disposed || this.#mode !== "poster") return this.#mode !== "poster";
    if (decoderInUse) return false;
    // MSE first, native second. Chromium answers "maybe" to
    // canPlayType("application/vnd.apple.mpegurl") on some builds while
    // having no HLS demuxer at all, so asking it first picks a path that
    // silently plays nothing. hls.js is the honest test: it either supports
    // this browser or it does not. Safari has no MSE for HLS and falls
    // through to the native player, which is also the only path that gets
    // hardware decode on an iPhone.
    decoderInUse = true;
    const { default: Hls } = await import("hls.js");
    if (this.#disposed) {
      decoderInUse = false;
      return false;
    }
    if (Hls.isSupported()) {
      const instance = new Hls({ enableWorker: true, lowLatencyMode: false });
      instance.loadSource(this.master);
      instance.attachMedia(this.video);
      this.#hls = instance;
      this.#mode = "hls.js";
    } else if (this.video.canPlayType("application/vnd.apple.mpegurl")) {
      this.video.src = this.master;
      this.#mode = "native";
    } else {
      decoderInUse = false;
      this.#onNotice?.("this browser has neither MSE nor native HLS; showing the poster");
      return false;
    }
    this.#texture = new VideoTexture(this.video);
    this.#texture.colorSpace = SRGBColorSpace;
    const material = this.mesh.material as MeshBasicMaterial;
    material.map = this.#texture;
    material.color.set(0xffffff);
    material.needsUpdate = true;
    // A rejected play() is normal before any interaction; the HUD button retries.
    void this.video.play().catch(() => undefined);
    return true;
  }

  /** Hand the decoder back and show the poster frame again. */
  release(): void {
    if (this.#mode === "poster") return;
    this.#hls?.destroy();
    this.#hls = null;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.muted = true;
    this.#texture?.dispose();
    this.#texture = null;
    const material = this.mesh.material as MeshBasicMaterial;
    material.map = this.#poster;
    material.color.set(this.#poster ? 0xffffff : POSTER_FALLBACK);
    material.needsUpdate = true;
    this.#mode = "poster";
    decoderInUse = false;
  }

  get muted(): boolean {
    return this.video.muted;
  }

  /** Called from a click or a controller press: the only time audio is allowed to start. */
  async unmute(): Promise<void> {
    this.video.muted = false;
    await this.video.play().catch(() => {
      this.video.muted = true;
    });
  }

  mute(): void {
    this.video.muted = true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.release();
    this.#disposed = true;
    this.video.remove();
    this.#poster?.dispose();
    this.#poster = null;
    this.mesh.geometry.dispose();
    const material = this.mesh.material;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material.dispose();
  }
}
