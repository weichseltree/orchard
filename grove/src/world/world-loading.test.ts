import { Box3, Group, type WebGLRenderer } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRoom, type RoomShell } from "./rooms";
import { TapeExhibit } from "./tape-exhibit";
import { parseMansion } from "./schema";
import { buildWorld, type BuildWorldOptions } from "./world";
import type { Provenance } from "../ui/provenance";

vi.mock("./rooms", () => ({ buildRoom: vi.fn() }));
vi.mock("./tape-exhibit", () => ({ TapeExhibit: { load: vi.fn() } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function shell(): RoomShell {
  return { group: new Group(), provenance: {}, lightmap: null, markers: { doors: new Map(), posters: new Map() } };
}

function makeWorld(exhibits?: BuildWorldOptions["exhibits"], onNotice = vi.fn()) {
  return buildWorld({
    mansion: parseMansion({
      schema: "orchard/mansion/1",
      start: "first",
      rooms: ["first", "next"].map((id, index) => ({
        id, presence: id,
        bounds: { min: [index * 10, 0, 0], max: [index * 10 + 10, 4, 10] },
        spawn: { position: [index * 10 + 5, 0, 5] },
        doorways: [{ to: index ? "first" : "next", axis: "x", at: 10, center: 5, width: 2, height: 3 }],
        hangings: [{ id: `${id}-tape`, kind: "tape", position: [index * 10 + 5, 1, 5], bundle: {
          path: `/tapes/${id}`,
          ...(exhibits ? { exhibit: { tree: "orchard", kind: "tape" } } : {}),
        } }],
      })),
    }),
    renderer: {} as WebGLRenderer,
    device: { tier: "desktop", touch: false, headset: false, maxPixelRatio: 2 },
    provenance: { register() {} } as unknown as Provenance,
    onNotice,
    ...(exhibits ? { exhibits } : {}),
  });
}

beforeEach(() => {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.mocked(buildRoom).mockReset();
  vi.mocked(TapeExhibit.load).mockReset().mockImplementation(async () => ({
    group: new Group(), bounds: new Box3(), bundle: { title: "A test tape" }, dispose() {},
  }) as unknown as TapeExhibit);
});
afterEach(() => vi.unstubAllGlobals());

describe("room and exhibit loading", () => {
  it("starts the first room's tape while an unrelated neighbouring shell is still loading", async () => {
    const neighbour = deferred<RoomShell>();
    vi.mocked(buildRoom).mockImplementation(async ({ room }) => room.id === "first" ? shell() : neighbour.promise);
    const world = makeWorld();
    const loaded = world.load();
    await vi.waitFor(() => expect(TapeExhibit.load).toHaveBeenCalledOnce());
    expect(vi.mocked(TapeExhibit.load).mock.calls[0]![0].hanging.id).toBe("first-tape");
    expect(world.tapes).toHaveLength(1);
    neighbour.resolve(shell());
    await loaded;
    // All neighbour geometry and media still land, preserving doorway views.
    expect(world.tapes).toHaveLength(2);
    expect(buildRoom).toHaveBeenCalledTimes(2);
    world.dispose();
  });

  it("shares pending room work and makes every caller wait for that room's hangings", async () => {
    const pendingShell = deferred<RoomShell>();
    vi.mocked(buildRoom).mockReturnValue(pendingShell.promise);
    const world = makeWorld();
    let firstDone = false, secondDone = false;
    const first = world.ensureRooms(["first"]).then(() => { firstDone = true; });
    const second = world.ensureRooms(["first"]).then(() => { secondDone = true; });
    await vi.waitFor(() => expect(buildRoom).toHaveBeenCalledOnce());
    expect(firstDone).toBe(false);
    expect(secondDone).toBe(false);
    pendingShell.resolve(shell());
    await Promise.all([first, second]);
    expect(TapeExhibit.load).toHaveBeenCalledOnce();
    expect(world.tapes).toHaveLength(1);
    world.dispose();
  });

  it("allows another attempt after a shell fails instead of marking it permanently loaded", async () => {
    vi.mocked(buildRoom).mockRejectedValueOnce(new Error("loader unavailable")).mockResolvedValue(shell());
    const world = makeWorld();
    await expect(world.ensureRooms(["first"])).rejects.toThrow("loader unavailable");
    await world.ensureRooms(["first"]);
    expect(buildRoom).toHaveBeenCalledTimes(2);
    expect(world.tapes).toHaveLength(1);
    world.dispose();
  });

  it("loads saved exhibit references when the live lookup rejects while another shell is pending", async () => {
    const neighbour = deferred<RoomShell>();
    vi.mocked(buildRoom).mockImplementation(async ({ room }) => room.id === "first" ? shell() : neighbour.promise);
    const exhibits = vi.fn().mockRejectedValue(new Error("offline"));
    const notice = vi.fn();
    const world = makeWorld(exhibits, notice);
    const loaded = world.load();
    await vi.waitFor(() => expect(TapeExhibit.load).toHaveBeenCalledOnce());
    expect(vi.mocked(TapeExhibit.load).mock.calls[0]![0].baseUrl).toBe("/tapes/first/");
    expect(notice).toHaveBeenCalledWith(expect.stringContaining("using the scene's saved references"));
    neighbour.resolve(shell());
    await loaded;
    expect(exhibits).toHaveBeenCalledOnce();
    expect(world.tapes).toHaveLength(2);
    world.dispose();
  });
});
