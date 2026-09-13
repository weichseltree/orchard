import { beforeEach, describe, expect, it, vi } from "vitest";
import { Presence, type TransportHandlers, defaultTransport } from "./presence";

const sdk = vi.hoisted(() => ({
  built: 0, uri: "", database: "", token: "", fail: false,
  connect: undefined as undefined | ((connection: unknown, identity: { toHexString(): string }, token: string) => void),
  error: undefined as undefined | ((context: unknown, error: Error) => void),
  disconnect: undefined as undefined | ((context: unknown, error?: Error) => void),
}));
vi.mock("../module_bindings", () => ({
  DbConnection: {
    builder: () => ({
      withUri(value: string) { sdk.uri = value; return this; },
      withDatabaseName(value: string) { sdk.database = value; return this; },
      withToken(value: string) { sdk.token = value; return this; },
      onConnect(callback: typeof sdk.connect) { sdk.connect = callback; return this; },
      onConnectError(callback: typeof sdk.error) { sdk.error = callback; return this; },
      onDisconnect(callback: typeof sdk.disconnect) { sdk.disconnect = callback; return this; },
      build() {
        if (sdk.fail) throw new Error("SDK failed to initialize");
        ++sdk.built;
      },
    }),
  },
}));

beforeEach(() => {
  sdk.built = 0; sdk.uri = ""; sdk.database = ""; sdk.token = ""; sdk.fail = false;
  sdk.connect = undefined; sdk.error = undefined; sdk.disconnect = undefined;
});
const storage = { getItem: () => null, setItem() {} };

describe("the deferred presence transport", () => {
  it("does not open a socket after disposal while the SDK import is pending", async () => {
    const presence = new Presence({}, { storage });
    presence.connect("grove");
    expect(sdk.built).toBe(0);
    presence.dispose();
    await vi.dynamicImportSettled();
    expect(sdk.built).toBe(0);
  });

  it("preserves connection configuration and opens a single pending socket", async () => {
    const presence = new Presence({}, { storage: { getItem: () => "saved-token", setItem() {} } });
    presence.connect("grove");
    presence.connect("einstruct");
    await vi.dynamicImportSettled();
    expect(sdk.built).toBe(1);
    expect(sdk.uri).toMatch(/^wss?:\/\//);
    expect(sdk.database).not.toBe("");
    expect(sdk.token).toBe("saved-token");
    presence.dispose();
  });

  it("reports a deferred SDK error and retries on the existing backoff path", async () => {
    sdk.fail = true;
    const timers: Array<() => void> = [];
    const presence = new Presence({}, {
      storage,
      setTimer: (fn) => { timers.push(fn); return 1 as unknown as ReturnType<typeof setTimeout>; },
      clearTimer() {},
    });
    presence.connect("grove");
    await vi.dynamicImportSettled();
    expect(presence.status).toBe("failed");
    expect(timers).toHaveLength(1);
    sdk.fail = false;
    timers[0]!();
    await vi.dynamicImportSettled();
    expect(sdk.built).toBe(1);
    expect(presence.status).toBe("connecting");
    presence.dispose();
  });

  it("preserves identity, token, failure and disconnect callbacks after loading", async () => {
    const handlers: TransportHandlers = { onConnect: vi.fn(), onConnectError: vi.fn(), onDisconnect: vi.fn() };
    defaultTransport(handlers, null);
    await vi.dynamicImportSettled();
    const connection = {};
    sdk.connect!(connection, { toHexString: () => "visitor" }, "echoed-token");
    expect(handlers.onConnect).toHaveBeenCalledWith(connection, "visitor", "echoed-token");
    const failure = new Error("socket closed");
    sdk.error!(null, failure);
    sdk.disconnect!(null, failure);
    expect(handlers.onConnectError).toHaveBeenCalledWith(failure);
    expect(handlers.onDisconnect).toHaveBeenCalledWith(failure);
  });
});
