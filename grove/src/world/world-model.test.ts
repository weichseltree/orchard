import { Box3, Group, type WebGLRenderer } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRoom, type RoomShell } from "./rooms";
import { ModelExhibit } from "./model-exhibit";
import { parseMansion } from "./schema";
import { buildWorld } from "./world";
import type { Provenance } from "../ui/provenance";

// A model hanging in the world: a load that fails says so, and a model that
// lands after the world was disposed is freed rather than hung.

vi.mock("./rooms", () => ({ buildRoom: vi.fn() }));
vi.mock("./model-exhibit", () => ({ ModelExhibit: { load: vi.fn() } }));

function makeWorld(onNotice = vi.fn(), register = vi.fn()) {
  return buildWorld({
    mansion: parseMansion({
      schema: "orchard/mansion/1",
      start: "only",
      rooms: [{
        id: "only", presence: "only",
        bounds: { min: [0, 0, 0], max: [10, 4, 10] },
        spawn: { position: [5, 0, 8] },
        hangings: [{ id: "chair", kind: "model", position: [5, 0, 3], bundle: { path: "/models/chair" } }],
      }],
    }),
    renderer: {} as WebGLRenderer,
    device: { tier: "desktop", touch: false, headset: false, maxPixelRatio: 2 },
    provenance: { register } as unknown as Provenance,
    onNotice,
  });
}

function fakeModel() {
  return { group: new Group(), bounds: new Box3(), modelBounds: new Box3(), bundle: { title: "a chair" }, dispose: vi.fn(), update() {} };
}

beforeEach(() => {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.mocked(buildRoom).mockReset().mockImplementation(async () => (
    { group: new Group(), provenance: {}, lightmap: null, markers: { doors: new Map(), posters: new Map() } } as RoomShell
  ));
  vi.mocked(ModelExhibit.load).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("a model in the world", () => {
  it("hangs, registers its framing box, and is disposed with the world", async () => {
    const model = fakeModel();
    vi.mocked(ModelExhibit.load).mockResolvedValue(model as unknown as ModelExhibit);
    const register = vi.fn();
    const world = makeWorld(vi.fn(), register);
    await world.load();
    expect(world.models).toHaveLength(1);
    const target = register.mock.calls.map(([t]) => t).find((t) => t.id === "model:chair");
    expect(target.frame).toBe(model.modelBounds);
    world.dispose();
    expect(model.dispose).toHaveBeenCalledOnce();
  });

  it("says why when the model does not load", async () => {
    vi.mocked(ModelExhibit.load).mockRejectedValue(new Error("model.glb could not load (HTTP 404)"));
    const notice = vi.fn();
    const world = makeWorld(notice);
    await world.load();
    expect(world.models).toHaveLength(0);
    expect(notice).toHaveBeenCalledWith("model chair: model.glb could not load (HTTP 404)");
    world.dispose();
  });

  it("frees a model that lands after the world is gone, and hangs nothing", async () => {
    let land!: (m: ModelExhibit) => void;
    vi.mocked(ModelExhibit.load).mockReturnValue(new Promise((resolve) => { land = resolve; }));
    const register = vi.fn();
    const world = makeWorld(vi.fn(), register);
    const loading = world.load();
    await vi.waitFor(() => expect(ModelExhibit.load).toHaveBeenCalledOnce());
    world.dispose();
    const model = fakeModel();
    land(model as unknown as ModelExhibit);
    await loading;
    expect(model.dispose).toHaveBeenCalledOnce();
    expect(world.models).toHaveLength(0);
    expect(register.mock.calls.some(([t]) => t.id === "model:chair")).toBe(false);
  });
});
