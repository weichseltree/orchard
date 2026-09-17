import { Mesh, Texture } from "three";
import { describe, expect, it, vi } from "vitest";
import type { Renderer } from "../render/types";
import { acquireEnvironment, buildRoomEnvironment, environmentScene, releaseEnvironment, type Environment } from "./model-environment";

// PMREMGenerator needs a GL context; its stand-in hands back a render target
// whose own dispose is watched, since in three r186 disposing only the
// target's texture frees nothing.
const pmrem = vi.hoisted(() => ({ targetDisposed: 0, generatorDisposed: 0 }));
vi.mock("three", async (importOriginal) => {
  const three = await importOriginal<typeof import("three")>();
  class FakePMREMGenerator {
    fromScene() {
      const texture = new three.Texture();
      return { texture, dispose: () => { pmrem.targetDisposed += 1; } };
    }
    dispose() { pmrem.generatorDisposed += 1; }
  }
  return { ...three, PMREMGenerator: FakePMREMGenerator };
});

function fake() {
  const dispose = vi.fn<() => void>();
  const environment: Environment = { texture: new Texture(), dispose };
  return Object.assign(environment, { dispose });
}

describe("the models' environment map", () => {
  it("is built only for WebGL, from a room of one geometry and six bright panels", () => {
    expect(buildRoomEnvironment({} as Renderer)).toBeNull();
    const meshes = environmentScene().children.filter((c): c is Mesh => c instanceof Mesh);
    expect(meshes).toHaveLength(7);
    expect(new Set(meshes.map((m) => m.geometry)).size).toBe(1);
  });

  it("frees the PMREM's render target itself with its last holder, not only the texture", () => {
    const gl = { isWebGLRenderer: true } as unknown as Renderer;
    const texture = acquireEnvironment(gl);
    expect(texture).toBeInstanceOf(Texture);
    expect(pmrem.generatorDisposed).toBe(1);
    expect(acquireEnvironment(gl)).toBe(texture);
    releaseEnvironment(texture);
    expect(pmrem.targetDisposed).toBe(0);
    releaseEnvironment(texture);
    expect(pmrem.targetDisposed).toBe(1);
  });

  it("is shared per renderer, and a new renderer's map is in place before the old one goes", () => {
    const a = {} as Renderer, b = {} as Renderer;
    const ea = fake(), eb = fake();
    let sharedWhenOldWent: Texture | null | undefined;
    ea.dispose.mockImplementation(() => {
      // Whoever asks for b's map while a's is being freed already gets b's.
      sharedWhenOldWent = acquireEnvironment(b, build);
    });
    const build = vi.fn((r: Renderer) => (r === a ? ea : eb));
    expect(acquireEnvironment(a, build)).toBe(ea.texture);
    expect(acquireEnvironment(a, build)).toBe(ea.texture);
    releaseEnvironment(ea.texture);
    expect(ea.dispose).not.toHaveBeenCalled();
    expect(acquireEnvironment(b, build)).toBe(eb.texture);
    expect(ea.dispose).toHaveBeenCalledOnce();
    expect(sharedWhenOldWent).toBe(eb.texture);
    releaseEnvironment(ea.texture); // a stale holder of the old map changes nothing
    expect(eb.dispose).not.toHaveBeenCalled();
    releaseEnvironment(eb.texture); // the hold taken while a's map was freed
    expect(eb.dispose).not.toHaveBeenCalled();
    releaseEnvironment(eb.texture);
    expect(eb.dispose).toHaveBeenCalledOnce();
    expect(build).toHaveBeenCalledTimes(2);
  });
});
