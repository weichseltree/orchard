import { Mesh, Texture } from "three";
import { describe, expect, it, vi } from "vitest";
import type { Renderer } from "../render/types";
import { acquireEnvironment, buildRoomEnvironment, environmentScene, releaseEnvironment } from "./model-environment";

describe("the models' environment map", () => {
  it("is built only for WebGL, from a room of one geometry and six bright panels", () => {
    expect(buildRoomEnvironment({} as Renderer)).toBeNull();
    const scene = environmentScene();
    const meshes = scene.children.filter((c): c is Mesh => c instanceof Mesh);
    expect(meshes).toHaveLength(7);
    expect(new Set(meshes.map((m) => m.geometry)).size).toBe(1);
  });

  it("is shared per renderer and disposed with its last holder, or when the renderer changes", () => {
    const a = {} as Renderer, b = {} as Renderer;
    const ta = new Texture(), tb = new Texture();
    const freedA = vi.fn();
    ta.addEventListener("dispose", freedA);
    const build = vi.fn((r: Renderer) => (r === a ? ta : tb));
    expect(acquireEnvironment(a, build)).toBe(ta);
    expect(acquireEnvironment(a, build)).toBe(ta);
    releaseEnvironment(ta);
    expect(freedA).not.toHaveBeenCalled();
    expect(acquireEnvironment(b, build)).toBe(tb);
    expect(freedA).toHaveBeenCalledOnce();
    releaseEnvironment(ta); // a stale holder of the old map changes nothing
    releaseEnvironment(tb);
    expect(build).toHaveBeenCalledTimes(2);
    expect(acquireEnvironment(b, build)).toBe(tb);
    expect(build).toHaveBeenCalledTimes(3);
    releaseEnvironment(tb);
  });
});
