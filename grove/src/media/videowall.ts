import { Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, VideoTexture } from "three";

// One wall, one decoder. Quest 3 will decode exactly one HLS stream without
// complaint and fall over on two, so the module refuses a second wall rather
// than letting a later room quietly halve the frame rate (grove/README.md:
// "One screen plays at a time").

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

export class VideoWall {
  readonly mesh: Mesh;
  readonly video: HTMLVideoElement;
  readonly mode: VideoWallMode;

  #texture: VideoTexture | null;
  #hls: { destroy(): void } | null = null;
  #disposed = false;

  private constructor(
    mesh: Mesh,
    video: HTMLVideoElement,
    texture: VideoTexture | null,
    mode: VideoWallMode,
    hls: { destroy(): void } | null,
  ) {
    this.mesh = mesh;
    this.video = video;
    this.#texture = texture;
    this.mode = mode;
    this.#hls = hls;
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

    let mode: VideoWallMode = "poster";
    let hls: { destroy(): void } | null = null;
    if (decoderInUse) {
      options.onNotice?.("a video is already playing; this wall stays a poster");
    } else {
      // MSE first, native second. Chromium answers "maybe" to
      // canPlayType("application/vnd.apple.mpegurl") on some builds while
      // having no HLS demuxer at all, so asking it first picks a path that
      // silently plays nothing. hls.js is the honest test: it either supports
      // this browser or it does not. Safari has no MSE for HLS and falls
      // through to the native player, which is also the only path that gets
      // hardware decode on an iPhone.
      const { default: Hls } = await import("hls.js");
      if (Hls.isSupported()) {
        const instance = new Hls({ enableWorker: true, lowLatencyMode: false });
        instance.loadSource(options.master);
        instance.attachMedia(video);
        hls = instance;
        mode = "hls.js";
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = options.master;
        mode = "native";
      } else {
        options.onNotice?.("this browser has neither MSE nor native HLS; showing the poster");
      }
    }
    if (mode !== "poster") decoderInUse = true;

    const texture = mode === "poster" ? null : new VideoTexture(video);
    if (texture) texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({
      color: texture ? 0xffffff : 0x1b241d,
      ...(texture ? { map: texture } : {}),
      toneMapped: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = "video-wall";

    if (mode !== "poster") {
      // A rejected play() is normal before any interaction; the HUD button retries.
      void video.play().catch(() => undefined);
    }
    return new VideoWall(mesh, video, texture, mode, hls);
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
    this.#disposed = true;
    this.#hls?.destroy();
    this.#hls = null;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
    this.#texture?.dispose();
    this.#texture = null;
    this.mesh.geometry.dispose();
    const material = this.mesh.material;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material.dispose();
    if (this.mode !== "poster") decoderInUse = false;
  }
}
