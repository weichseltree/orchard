import { describe, expect, it, vi } from "vitest";
import {
  Presence,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  reconnectDelay,
  type PresenceConnection,
  type TransportHandlers,
} from "./presence";

// The two findings that mattered in review live here: a refused join used to
// retry at network speed, and a dropped socket used to be permanent. Both are
// now driven against a stub rather than against maincloud.

function stubConnection(options: {
  rooms?: string[];
  refuse?: (room: string) => string | null;
}): PresenceConnection & { joins: string[]; moves: number; queries: string[][] } {
  const joins: string[] = [];
  const queries: string[][] = [];
  let moves = 0;
  const table = () => ({
    iter: () => [],
    onInsert: () => undefined,
    onUpdate: () => undefined,
    onDelete: () => undefined,
  });
  const connection = {
    joins,
    queries,
    get moves() {
      return moves;
    },
    db: {
      visitor: table(),
      pose: table(),
      room: { iter: () => (options.rooms ?? ["grove", "einstruct"]).map((name) => ({ name })) },
    },
    reducers: {
      join: async ({ room }: { room: string }) => {
        joins.push(room);
        const refusal = options.refuse?.(room);
        if (refusal) throw new Error(refusal);
      },
      move: async () => {
        moves++;
      },
      leave: async () => undefined,
    },
    subscriptionBuilder: () => {
      const builder = {
        onApplied(cb: () => void) {
          cb();
          return builder;
        },
        onError() {
          return builder;
        },
        subscribe(q: string[]) {
          queries.push(q);
          return { unsubscribe: () => undefined };
        },
      };
      return builder;
    },
    disconnect: () => undefined,
  };
  return connection as unknown as PresenceConnection & {
    joins: string[];
    moves: number;
    queries: string[][];
  };
}

const memoryStorage = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
};

const settle = async (times = 6): Promise<void> => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

describe("reconnectDelay", () => {
  it("doubles from 1 s and stops at 30 s", () => {
    const noJitter = () => 1;
    expect(reconnectDelay(0, noJitter)).toBe(RECONNECT_MIN_MS);
    expect(reconnectDelay(1, noJitter)).toBe(2000);
    expect(reconnectDelay(2, noJitter)).toBe(4000);
    expect(reconnectDelay(3, noJitter)).toBe(8000);
    expect(reconnectDelay(4, noJitter)).toBe(16000);
    expect(reconnectDelay(5, noJitter)).toBe(RECONNECT_MAX_MS);
    expect(reconnectDelay(50, noJitter)).toBe(RECONNECT_MAX_MS);
  });

  it("jitters down by up to half, never up", () => {
    for (const attempt of [0, 3, 9]) {
      const full = reconnectDelay(attempt, () => 1);
      expect(reconnectDelay(attempt, () => 0)).toBe(Math.round(full / 2));
      expect(reconnectDelay(attempt, () => 0.5)).toBeGreaterThanOrEqual(Math.round(full / 2));
      expect(reconnectDelay(attempt, () => 0.5)).toBeLessThanOrEqual(full);
    }
  });
});

describe("join refusal", () => {
  it("asks once for a room the server refuses, then falls back to the grove", async () => {
    const notices: string[] = [];
    const connection = stubConnection({ refuse: (room) => (room === "einstruct" ? "room full" : null) });
    let handlers!: TransportHandlers;
    const presence = new Presence(
      { onNotice: (m) => notices.push(m) },
      { transport: (h) => (handlers = h), storage: memoryStorage() },
    );
    presence.connect("einstruct");
    handlers.onConnect(connection, "abc", "token");
    await settle(20);

    expect(connection.joins.filter((r) => r === "einstruct")).toHaveLength(1);
    expect(presence.joinedRoom).toBe("grove");
    expect(notices.some((n) => n.includes("room full"))).toBe(true);
    expect(notices.some((n) => n.includes("falling back"))).toBe(true);
  });

  it("does not re-ask on later join calls, so nothing loops", async () => {
    const connection = stubConnection({ refuse: () => "admin only" });
    let handlers!: TransportHandlers;
    const presence = new Presence({}, { transport: (h) => (handlers = h), storage: memoryStorage() });
    presence.connect("einstruct");
    handlers.onConnect(connection, "abc", "token");
    await settle(20);
    const after = connection.joins.length;
    for (let i = 0; i < 10; i++) presence.join("einstruct");
    await settle(20);
    expect(connection.joins.length).toBe(after);
    expect(presence.joinedRoom).toBeNull();
  });

  it("says so and stays put when the room is not in the room table", async () => {
    const notices: string[] = [];
    const connection = stubConnection({ rooms: ["grove"] });
    let handlers!: TransportHandlers;
    const presence = new Presence(
      { onNotice: (m) => notices.push(m) },
      { transport: (h) => (handlers = h), storage: memoryStorage() },
    );
    presence.connect("grove");
    handlers.onConnect(connection, "abc", "token");
    await settle(20);
    presence.join("cellar");
    await settle(20);
    expect(connection.joins).toEqual(["grove"]);
    expect(presence.joinedRoom).toBe("grove");
    expect(notices.some((n) => n.includes("cellar"))).toBe(true);
  });

  it("subscribes per room, quoting the room name", async () => {
    const connection = stubConnection({});
    let handlers!: TransportHandlers;
    const presence = new Presence({}, { transport: (h) => (handlers = h), storage: memoryStorage() });
    presence.connect("einstruct");
    handlers.onConnect(connection, "abc", "token");
    await settle(20);
    expect(connection.queries[0]).toEqual([
      "SELECT * FROM visitor WHERE room = 'einstruct'",
      "SELECT * FROM pose WHERE room = 'einstruct'",
      "SELECT * FROM room",
    ]);
  });
});

describe("reconnection", () => {
  it("retries on backoff after a drop and re-joins the room it was in", async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const connection = stubConnection({});
    let handlers!: TransportHandlers;
    const presence = new Presence(
      {},
      {
        transport: (h) => (handlers = h),
        storage: memoryStorage(),
        random: () => 1,
        setTimer: (fn, ms) => {
          timers.push({ fn, ms });
          return timers.length as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => undefined,
      },
    );
    presence.connect("einstruct");
    handlers.onConnect(connection, "abc", "token");
    await settle(20);
    expect(presence.joinedRoom).toBe("einstruct");

    handlers.onDisconnect(new Error("socket closed"));
    expect(presence.status).toBe("failed");
    expect(presence.joinedRoom).toBeNull();
    expect(timers.map((t) => t.ms)).toEqual([RECONNECT_MIN_MS]);

    timers[0]!.fn();
    handlers.onConnect(connection, "abc", "token");
    await settle(20);
    expect(presence.status).toBe("online");
    expect(presence.joinedRoom).toBe("einstruct");
    expect(presence.reconnectAttempts).toBe(0);
  });

  it("backs off further each time the retry also fails", async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    let handlers!: TransportHandlers;
    const presence = new Presence(
      {},
      {
        transport: (h) => (handlers = h),
        storage: memoryStorage(),
        random: () => 1,
        setTimer: (fn, ms) => {
          timers.push({ fn, ms });
          return timers.length as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => undefined,
      },
    );
    presence.connect("grove");
    for (let i = 0; i < 6; i++) {
      handlers.onConnectError(new Error("no route"));
      timers[timers.length - 1]!.fn();
    }
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
    expect(presence.status).toBe("connecting");
  });

  it("keeps the visitor single-player, not crashed, when nothing connects", async () => {
    const statuses: string[] = [];
    const presence = new Presence(
      { onStatus: (s) => statuses.push(s) },
      {
        transport: () => {
          throw new Error("websocket refused");
        },
        storage: memoryStorage(),
        setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimer: () => undefined,
      },
    );
    expect(() => presence.connect("grove")).not.toThrow();
    expect(statuses).toEqual(["connecting", "failed"]);
    expect(presence.here).toBe(1);
    expect(presence.knownRooms()).toEqual([]);
  });
});

describe("move", () => {
  it("sends at 10 Hz while moving, once on stopping, and not again", async () => {
    const connection = stubConnection({});
    let handlers!: TransportHandlers;
    const presence = new Presence({}, { transport: (h) => (handlers = h), storage: memoryStorage() });
    presence.connect("grove");
    handlers.onConnect(connection, "abc", "token");
    await settle(20);

    presence.sendPose(0, 0, 0, 0, 0);
    expect(connection.moves).toBe(1);
    // Inside the 100 ms window, however much it moves.
    presence.sendPose(1, 0, 0, 0, 50);
    expect(connection.moves).toBe(1);
    presence.sendPose(1, 0, 0, 0, 120);
    expect(connection.moves).toBe(2);
    // Standing still: one last pose, then silence.
    presence.sendPose(1, 0, 0, 0, 260);
    expect(connection.moves).toBe(3);
    presence.sendPose(1, 0, 0, 0, 400);
    presence.sendPose(1, 0, 0, 0, 900);
    expect(connection.moves).toBe(3);
  });

  it("says nothing at all while disconnected", () => {
    const presence = new Presence({}, { transport: () => undefined, storage: memoryStorage() });
    presence.connect("grove");
    expect(() => presence.sendPose(1, 2, 3, 4, 0)).not.toThrow();
  });
});

describe("dispose", () => {
  it("stops the retry timer", () => {
    const cleared = vi.fn();
    let handlers!: TransportHandlers;
    const presence = new Presence(
      {},
      {
        transport: (h) => (handlers = h),
        storage: memoryStorage(),
        setTimer: () => 7 as unknown as ReturnType<typeof setTimeout>,
        clearTimer: cleared,
      },
    );
    presence.connect("grove");
    handlers.onConnectError(new Error("nope"));
    presence.dispose();
    expect(cleared).toHaveBeenCalledWith(7);
  });
});
