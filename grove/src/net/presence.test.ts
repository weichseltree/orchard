import type { ExhibitRow } from "../world/exhibits";
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

interface StubVisitor {
  hex: string;
  name: string;
  room: string;
  isAdmin?: boolean;
}

interface StubPose {
  hex: string;
  room: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

function stubConnection(options: {
  rooms?: string[];
  exhibits?: ExhibitRow[];
  refuse?: (room: string) => string | null;
  people?: StubVisitor[];
  poses?: StubPose[];
}): PresenceConnection & { joins: string[]; moves: number; queries: string[][]; reports: Array<[string, string]> } {
  const joins: string[] = [];
  const queries: string[][] = [];
  const reports: Array<[string, string]> = [];
  let moves = 0;
  const id = (hex: string) => ({ toHexString: () => hex });
  const table = <Row>(rows: () => Row[]) => ({
    iter: rows,
    onInsert: () => undefined,
    onUpdate: () => undefined,
    onDelete: () => undefined,
  });
  const connection = {
    joins,
    queries,
    reports,
    get moves() {
      return moves;
    },
    db: {
      peopleHere: table(() =>
        (options.people ?? []).map((v) => ({ identity: id(v.hex), name: v.name, room: v.room, online: true, isAdmin: v.isAdmin ?? false })),
      ),
      posesHere: table(() => (options.poses ?? []).map((p) => ({ ...p, identity: id(p.hex) }))),
      room: { iter: () => (options.rooms ?? ["grove", "einstruct"]).map((name) => ({ name })) },
      exhibit: { iter: () => options.exhibits ?? [] },
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
      reportVisitor: async ({ who, reason }: { who: { toHexString(): string }; reason: string }) => {
        reports.push([who.toHexString(), reason]);
      },
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
    reports: Array<[string, string]>;
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

  it("subscribes to the room-scoped views once, and not again per room", async () => {
    const connection = stubConnection({});
    let handlers!: TransportHandlers;
    const presence = new Presence({}, { transport: (h) => (handlers = h), storage: memoryStorage() });
    presence.connect("einstruct");
    handlers.onConnect(connection, "abc", "token");
    await settle(20);
    // The exhibit table is subscribed once, on connect, before any room.
    expect(connection.queries[0]).toEqual(["SELECT * FROM exhibit"]);
    expect(connection.queries[1]).toEqual([
      "SELECT * FROM people_here",
      "SELECT * FROM poses_here",
      "SELECT * FROM room",
    ]);
    presence.join("grove");
    await settle(20);
    expect(presence.joinedRoom).toBe("grove");
    expect(connection.queries).toHaveLength(2); // the server moves the views with us
  });
});

describe("exhibits", () => {
  const row: ExhibitRow = {
    id: 1n,
    tree: "einstruct",
    kind: "tape",
    title: "t",
    url: "https://media.weichseltree.com/aaaaaaaaaaaaaaaa/bundle.json",
    thumbUrl: "",
    tapeUrl: "https://media.weichseltree.com/aaaaaaaaaaaaaaaa/bundle.json",
  };

  it("hands the world the table once its subscription applied", async () => {
    const connection = stubConnection({ exhibits: [row] });
    let handlers!: TransportHandlers;
    const presence = new Presence({}, { transport: (h) => (handlers = h), storage: memoryStorage() });
    presence.connect("grove");
    const waiting = presence.whenExhibits(60_000);
    handlers.onConnect(connection, "abc", "token");
    expect(await waiting).toEqual([row]);
    // Asked again later: immediate, from the client cache.
    expect(await presence.whenExhibits(1)).toEqual([row]);
    expect(presence.exhibits()).toEqual([row]);
  });

  it("gives up on the timeout with an empty table while single-player", async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const presence = new Presence(
      {},
      {
        transport: () => {
          throw new Error("no network");
        },
        setTimer: (fn, ms) => {
          timers.push({ fn, ms });
          return timers.length as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => undefined,
        storage: memoryStorage(),
      },
    );
    presence.connect("grove");
    const waiting = presence.whenExhibits(8000);
    const timeout = timers.find((t) => t.ms === 8000);
    expect(timeout).toBeDefined();
    timeout!.fn();
    expect(await waiting).toEqual([]);
    expect(presence.exhibits()).toEqual([]);
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

describe("what arrives from other visitors", () => {
  it("skips a pose that is not a finite number instead of parking a capsule nowhere", async () => {
    const connection = stubConnection({
      people: [
        { hex: "p1", name: "ann", room: "grove" },
        { hex: "p2", name: "bob", room: "grove", isAdmin: true },
      ],
      poses: [
        { hex: "p1", room: "grove", x: Number.NaN, y: 0, z: Number.POSITIVE_INFINITY, yaw: 0 },
        { hex: "p2", room: "grove", x: 1, y: 0, z: 2, yaw: 0.5 },
      ],
    });
    let handlers!: TransportHandlers;
    const presence = new Presence({}, { transport: (h) => (handlers = h), storage: memoryStorage() });
    presence.connect("grove");
    handlers.onConnect(connection, "me", "token");
    await settle(20);
    presence.sync();
    const ann = presence.peers.get("p1");
    const bob = presence.peers.get("p2");
    expect(ann && [ann.x, ann.z]).toEqual([0, 0]);
    expect(bob && [bob.x, bob.z, bob.yaw]).toEqual([1, 2, 0.5]);
    expect(bob?.host).toBe(true);
    expect(ann?.host).toBe(false);
  });

  it("reports a visitor by the identity the server gave, not by name", async () => {
    const connection = stubConnection({ people: [{ hex: "p1", name: "ann", room: "grove" }] });
    let handlers!: TransportHandlers;
    const presence = new Presence({}, { transport: (h) => (handlers = h), storage: memoryStorage() });
    presence.connect("grove");
    handlers.onConnect(connection, "me", "token");
    await settle(20);
    await presence.report("p1", "shouting");
    expect(connection.reports).toEqual([["p1", "shouting"]]);
    await expect(presence.report("gone", "x")).rejects.toThrow("not here");
  });
});

describe("the token service", () => {
  it("connects with the token it hands over and does not store the echo", async () => {
    const storage = memoryStorage();
    const connection = stubConnection({});
    let handlers!: TransportHandlers;
    let given: string | null = "unset";
    const presence = new Presence(
      {},
      {
        transport: (h, token) => {
          handlers = h;
          given = token;
        },
        storage,
        token: async () => "grove-token",
      },
    );
    presence.connect("grove");
    expect(presence.status).toBe("connecting");
    await settle();
    expect(given).toBe("grove-token");
    handlers.onConnect(connection, "abc", "echoed");
    expect(storage.getItem("orchard.grove.token")).toBeNull();
  });

  it("uses the anonymous identity, and keeps it, when the source says there is no service", async () => {
    const storage = memoryStorage();
    storage.setItem("orchard.grove.token", "anon-before");
    const connection = stubConnection({});
    let handlers!: TransportHandlers;
    let given: string | null = "unset";
    const presence = new Presence(
      {},
      {
        transport: (h, token) => {
          handlers = h;
          given = token;
        },
        storage,
        token: async () => null,
      },
    );
    presence.connect("grove");
    await settle();
    expect(given).toBe("anon-before");
    handlers.onConnect(connection, "abc", "anon-after");
    expect(storage.getItem("orchard.grove.token")).toBe("anon-after");
  });

  it("treats a token service that fails like a dropped socket: single-player, retry later", async () => {
    const timers: number[] = [];
    let opened = 0;
    const presence = new Presence(
      {},
      {
        transport: () => {
          opened++;
        },
        storage: memoryStorage(),
        token: async () => {
          throw new Error("the token service did not answer");
        },
        setTimer: (_fn, ms) => {
          timers.push(ms);
          return 1 as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => undefined,
      },
    );
    presence.connect("grove");
    await settle();
    expect(presence.status).toBe("failed");
    expect(opened).toBe(0);
    expect(timers).toEqual([expect.any(Number)]);
  });
});
