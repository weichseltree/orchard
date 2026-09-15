import type { Camera, Scene, ToneMapping, WebGLRenderer } from "three";

export interface RendererInfo {
  render: { calls: number; triangles: number; points: number };
  memory: { geometries: number; textures: number };
  programs?: unknown[] | null;
}

/** Common renderer API shared by Three's WebGL2 and WebGPU backends. */
export interface Renderer {
  toneMapping: ToneMapping;
  toneMappingExposure: number;
  xr: WebGLRenderer["xr"];
  info: RendererInfo;
  setPixelRatio(value?: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setAnimationLoop(callback: ((time: number, frame?: XRFrame) => void) | null): void | Promise<void>;
  render(scene: Scene, camera: Camera): void;
  getPixelRatio(): number;
  dispose(): void;
  init?(): Promise<Renderer>;
}
