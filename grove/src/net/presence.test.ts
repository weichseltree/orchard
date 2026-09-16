import type { ExhibitRow } from "../world/exhibits";
import type { ChatLine, ChatRow } from "./presence";
import { describe, expect, it, vi } from "vitest";
import {
  Presence,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  REFUSAL_TTL_MS,
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
  muted?: boolean;
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
  /** Rooms whose join never settles until the test settles it by hand. */
  pending?: (room: string) => boolean;
  /** Rooms whose row says `open: false`: shut to everyone, host included. */
  closed?: string[];
  /** Rooms only a host may enter. */
  adminOnly?: string[];
  refuseSay?: (text: string) => string | null;
  /** Hold `onApplied` until `applyNow()`, so a test can sit in the backlog. */
  applyLater?: boolean;
  people?: StubVisitor[];
  poses?: StubPose[];
}): PresenceConnection & {
  joins: string[];
  names: string[];
  moves: number;
  leaves: number;
  pendingJoins: Array<{ room: string; resolve: () => void; reject: (error: Error) => void }>;
  queries: string[][];
  reports: Array<[string, string]>;
  moderation: string[];
  said: string[];
  chatInserts: Array<(ctx: unknown, row: ChatRow) => void>;
  applyNow: () => void;
} {
  const joins: string[] = [];
  const names: string[] = [];
  const said: string[] = [];
  const pendingApplied: Array<() => void> = [];
  const chatInserts: Array<(ctx: unknown, row: ChatRow) => void> = [];
  const moderation: string[] = [];
  const queries: string[][] = [];
  const reports: Array<[string, string]> = [];
  let moves = 0;
  let leaves = 0;
  const pendingJoins: Array<{ room: string; resolve: () => void; reject: (error: Error) => void }> = [];
  const id = (hex: string) => ({ toHexString: () => hex });
  const table = <Row>(rows: () => Row[]) => ({
    iter: rows,
    onInsert: () => undefined,
    onUpdate: () => undefined,
    onDelete: () => undefined,
  });
  const connection = {
    joins,
    names,
    said,
    chatInserts,
    pendingJoins,
    moderation,
    queries,
    reports,
    get moves() {
      return moves;
    },
    get leaves() {
      return leaves;
    },
    db: {
      peopleHere: table(() =>
        (options.people ?? []).map((v) => ({
          identity: id(v.hex),
          name: v.name,
          room: v.room,
          online: true,
          isAdmin: v.isAdmin ?? false,
          muted: v.muted ?? false,
        })),
      ),
      posesHere: table(() => (options.poses ?? []).map((p) => ({ ...p, identity: id(p.hex) }))),
      chatHere: {
        iter: () => [],
        onInsert: (cb: (ctx: unknown, row: ChatRow) => void) => { chatInserts.push(cb); },
        onDelete: () => {},
      },
      room: {
        iter: () =>
          (options.rooms ?? ["grove", "einstruct"]).map((name) => ({
            name,
            open: !(options.closed ?? []).includes(name),
            admin_only: (options.adminOnly ?? []).includes(name),
          })),
      },
      exhibit: { iter: () => options.exhibits ?? [] },
    },
    reducers: {
      say: async ({ text }: { text: string }) => {
        said.push(text);
        const refusal = options.refuseSay?.(text);
        if (refusal) throw new Error(refusal);
      },
      join: async ({ room, name }: { room: string; name: string }) => {
        joins.push(room);
        names.push(name);
        if (options.pending?.(room)) {
          await new Promise<void>((resolve, reject) => pendingJoins.push({ room, resolve, reject }));
          return;
        }
        const refusal = options.refuse?.(room);
        if (refusal) throw new Error(refusal);
      },
      move: async () => {
        moves++;
      },
      leave: async () => {
        leaves++;
      },
      reportVisitor: async ({ who, reason }: { who: { toHexString(): string }; reason: string }) => {
        reports.push([who.toHexString(), reason]);
      },
      mute: async ({ who, muted }: { who: { toHexString(): string }; muted: boolean }) => {
        moderation.push(`mute ${who.toHexString()} ${muted}`);
      },
      kick: async ({ who }: { who: { toHexString(): string } }) => {
        moderation.push(`kick ${who.toHexString()}`);
      },
      banVisitor: async (p: { who: { toHexString(): string }; minutes: number; network: boolean; reason: string }) => {
        moderation.push(`ban ${p.who.toHexString()} ${p.minutes} ${p.network} ${p.reason}`);
      },
    },
    subscriptionBuilder: () => {
      const builder = {
        onApplied(cb: () => void) {
          if (options.applyLater) pendingApplied.push(cb);
          else cb();
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
    applyNow: () => {
      for (const cb of pendingApplied.splice(0)) cb();
    },
    disconnect: () => undefined,
  };
  return connection as unknown as PresenceConnection & {
    joins: string[];
    names: string[];
    moves: number;
    leaves: number;
    pendingJoins: Array<{ room: string; resolve: () => void; reject: (error: Error) => void }>;
    queries: string[][];
    reports: Array<[string, string]>;
    moderation: string[];
    said: string[];
    chatInserts: Array<(ctx: unknown, row: ChatRow) => void>;
    applyNow: () => void;
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
  it("asks once for a room the server refuses, and joins nothing in its place", async () => {
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

    // Falling back to the grove used to look like staying online through a
    // refusal. It was not: the visitor is standing in the Mixing Chamber, so
    // joining the grove puts their avatar there at this room's coordinates,
    // for everyone in the grove to see. Present nowhere is the honest answer.
    expect(connection.joins.filter((r) => r === "einstruct")).toHaveLength(1);
    expect(connection.joins).not.toContain("grove");
    expect(presence.joinedRoom).toBeNull();
    expect(notices.some((n) => n.includes("room full"))).toBe(true);
  });

  it("locks a door the server would refuse, and says which and why", async () => {
    // The three refusals that are normal operation, not misconfiguration.
    // Capacity is deliberately absent: a client cannot count people in a room
    // it is not in, so a full room is met on arrival, not seen from outside.
    let handlers!: TransportHandlers;
    const presence = new Presence({}, { transport: (h) => (handlers = h), storage: memoryStorage() });
    presence.connect("grove");
    handlers.onConnect(
      stubConnection({ rooms: ["grove", "gallery", "greenhouse"], closed: ["gallery"], adminOnly: ["greenhouse"] }),
      "abc",
      "token",
    );
    await settle(20);

    expect(presence.canEnter("grove")).toBe(true);
    expect(presence.whyLocked("grove")).toBeNull();
    expect(presence.whyLocked("gallery")).toBe("room closed");
    expect(presence.whyLocked("greenhouse")).toBe("admin only");
    expect(presence.whyLocked("cellar")).toBe('no room "cellar" server-side');
  });

  it("locks nothing while offline or before the room table has arrived", async () => {
    // A world that cannot ask the server is not a world with locked doors:
    // every door has to open, or a dropped socket walls the visitor in.
    let handlers!: TransportHandlers;
    const presence = new Presence({}, { transport: (h) => (handlers = h), storage: memoryStorage() });
    expect(presence.canEnter("anything")).toBe(true);
    presence.connect("grove");
    handlers.onConnect(stubConnection({ rooms: [] }), "abc", "token");
    await settle(20);
    expect(presence.canEnter("anything")).toBe(true);
  });

  it("unlocks a door once the refusal expires, without a reload", async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    let handlers!: TransportHandlers;
    const presence = new Presence(
      {},
      {
        transport: (h) => (handlers = h),
        storage: memoryStorage(),
        setTimer: (fn, ms) => {
          timers.push({ fn, ms });
          return timers.length as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => undefined,
      },
    );
    presence.connect("grove");
    handlers.onConnect(stubConnection({ rooms: ["grove", "einstruct"], refuse: (r) => (r === "einstruct" ? "room full" : null) }), "abc", "token");
    await settle(20);
    presence.join("einstruct");
    await settle(20);
    expect(presence.canEnter("einstruct")).toBe(false);

    const expiry = timers.find((t) => t.ms === REFUSAL_TTL_MS);
    expect(expiry).toBeDefined();
    expiry!.fn();
    expect(presence.canEnter("einstruct")).toBe(true);
  });

  it("does not lock the door when it is the views that failed, not the join", async () => {
    // The subscription is built inside the join's promise chain, so a throw
    // there used to arrive as a refusal. A refusal now locks the room and
    // takes the visitor out of it, so a chat view that will not open must not
    // be able to present itself as "you may not be here".
    const notices: string[] = [];
    const connection = stubConnection({ rooms: ["grove"] });
    // The first builder is the exhibit subscription, taken at connect; the
    // room-scoped views are the one the join takes.
    const realBuilder = connection.subscriptionBuilder.bind(connection);
    let built = 0;
    connection.subscriptionBuilder = () => {
      if (++built > 1) throw new Error("chatHere is missing");
      return realBuilder();
    };
    let handlers!: TransportHandlers;
    const presence = new Presence(
      { onNotice: (m) => notices.push(m) },
      { transport: (h) => (handlers = h), storage: memoryStorage() },
    );
    presence.connect("grove");
    handlers.onConnect(connection, "abc", "token");
    await settle(20);

    expect(presence.joinedRoom).toBe("grove");
    expect(presence.canEnter("grove")).toBe(true);
    expect(connection.leaves).toBe(0);
    expect(notices.some((n) => n.includes("views did not open"))).toBe(true);
    expect(notices.some((n) => n.includes("refused"))).toBe(false);
  });

  it("does not let a dead connection's expiry cut short the new connection's lock", async () => {
    // #dropped clears #refused, but the timers it scheduled keep running. An
    // old one firing after a reconnect would delete a refusal the NEW
    // connection had just recorded, unlocking a door the server had shut.
    const timers: Array<{ fn: () => void; ms: number }> = [];
    let handlers!: TransportHandlers;
    const presence = new Presence(
      {},
      {
        transport: (h) => (handlers = h),
        storage: memoryStorage(),
        setTimer: (fn, ms) => {
          timers.push({ fn, ms });
          return timers.length as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => undefined,
      },
    );
    const full = { rooms: ["grove", "einstruct"], refuse: (r: string) => (r === "einstruct" ? "room full" : null) };
    presence.connect("grove");
    handlers.onConnect(stubConnection(full), "abc", "token");
    await settle(20);
    presence.join("einstruct");
    await settle(20);
    expect(presence.canEnter("einstruct")).toBe(false);

    handlers.onDisconnect(new Error("socket dropped"));
    timers[timers.length - 1]!.fn(); // the reconnect
    handlers.onConnect(stubConnection(full), "abc", "token");
    await settle(20);
    presence.join("einstruct");
    await settle(20);
    expect(presence.canEnter("einstruct")).toBe(false);

    const expiries = timers.filter((t) => t.ms === REFUSAL_TTL_MS);
    expect(expiries).toHaveLength(2);
    expiries[0]!.fn(); // the stale one, from the connection that dropped
    expect(presence.canEnter("einstruct")).toBe(false);
    expiries[1]!.fn(); // this connection's own
    expect(presence.canEnter("einstruct")).toBe(true);
  });

  it("ignores a join that rejects after its own connection died", async () => {
    // A join's promise can settle long after its socket did. Applying that
    // answer to the live connection is worse than a stale lock: a refusal
    // takes the visitor out of presence, so a late rejection for a room they
    // have since left would call `leave` and evict them from the room they
    // are actually standing in.
    const timers: Array<{ fn: () => void; ms: number }> = [];
    let handlers!: TransportHandlers;
    const presence = new Presence(
      {},
      {
        transport: (h) => (handlers = h),
        storage: memoryStorage(),
        setTimer: (fn, ms) => {
          timers.push({ fn, ms });
          return timers.length as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => undefined,
      },
    );
    const first = stubConnection({ rooms: ["grove", "einstruct"], pending: (r) => r === "einstruct" });
    presence.connect("grove");
    handlers.onConnect(first, "abc", "token");
    await settle(20);
    presence.join("einstruct");
    await settle(20);
    expect(first.pendingJoins).toHaveLength(1);

    // The socket dies with that join still in flight, and the visitor comes
    // back and settles into the grove on a new connection.
    handlers.onDisconnect(new Error("socket dropped"));
    timers[timers.length - 1]!.fn();
    const second = stubConnection({ rooms: ["grove", "einstruct"] });
    handlers.onConnect(second, "abc", "token");
    await settle(20);
    presence.join("grove"); // they walked back before the new socket settled
    await settle(20);
    expect(presence.joinedRoom).toBe("grove");

    // Only now does the dead connection answer, about a room they left.
    first.pendingJoins[0]!.reject(new Error("room full"));
    await settle(20);

    expect(presence.joinedRoom).toBe("grove");
    expect(second.leaves).toBe(0);
    expect(presence.canEnter("einstruct")).toBe(true);
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

  it("stops publishing poses after a refused crossing, and leaves nothing frozen behind", async () => {
    const connection = stubConnection({ refuse: (room) => (room === "einstruct" ? "room full" : null) });
    let handlers!: TransportHandlers;
    const presence = new Presence({}, { transport: (h) => (handlers = h), storage: memoryStorage() });
    presence.connect("grove");
    handlers.onConnect(connection, "abc", "token");
    await settle(20);
    presence.sendPose(0, 0, 0, 0, 1000);
    const beforeRefusal = connection.moves;

    presence.join("einstruct");
    await settle(20);
    presence.sendPose(42, 0, -17, 1, 2000);

    // Suppressing the next pose stops the phantom moving; `leave` is what
    // stops it being there at all, by dropping the pose row rather than
    // freezing it at the last position it was seen in the old room.
    expect(connection.moves).toBe(beforeRefusal);
    expect(presence.joinedRoom).toBeNull();
    expect(connection.leaves).toBe(1);
  });

  it("asks again after a reconnect, because a refusal was only that connection's answer", async () => {
    // The room a visitor was refused may have been full, or missing from the
    // room table and added since. Remembering the refusal past the connection
    // that gave it locks them out until they reload the page.
    const timers: Array<{ fn: () => void }> = [];
    let handlers!: TransportHandlers;
    const presence = new Presence(
      {},
      {
        transport: (h) => (handlers = h),
        storage: memoryStorage(),
        setTimer: (fn) => {
          timers.push({ fn });
          return timers.length as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => undefined,
      },
    );
    presence.connect("grove");
    handlers.onConnect(stubConnection({ rooms: ["grove"] }), "abc", "token");
    await settle(20);
    presence.join("terrace");
    await settle(20);
    expect(presence.joinedRoom).toBeNull();

    // The socket drops; the room is added server-side; the client reconnects.
    handlers.onDisconnect(new Error("socket dropped"));
    timers[timers.length - 1]!.fn();
    const second = stubConnection({ rooms: ["grove", "terrace"] });
    handlers.onConnect(second, "abc", "token");
    await settle(20);
    presence.join("terrace");
    await settle(20);
    expect(second.joins).toContain("terrace");
    expect(presence.joinedRoom).toBe("terrace");
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
    // The body walked into the cellar, so the grove is no longer where this
    // visitor is; `leave` drops the pose row rather than freezing it there.
    expect(presence.joinedRoom).toBeNull();
    expect(connection.leaves).toBe(1);
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
      "SELECT * FROM chat_here",
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

  it("gives up on the timeout with null (no answer) while single-player", async () => {
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
    expect(await waiting).toBeNull();
    expect(presence.exhibits()).toEqual([]);
  });
});

describe("reconnection", () => {
  it("opens one pending connection while repeated requests update the desired room", async () => {
    let handlers!: TransportHandlers;
    const transport = vi.fn((h: TransportHandlers) => { handlers = h; });
    const presence = new Presence({}, { transport, storage: memoryStorage() });
    presence.connect("einstruct");
    presence.connect("spectre");
    expect(transport).toHaveBeenCalledOnce();
    const connection = stubConnection({ rooms: ["grove", "einstruct", "spectre"] });
    handlers.onConnect(connection, "abc", "token");
    await settle();
    expect(connection.joins).toEqual(["spectre"]);
    presence.dispose();
  });

  it("rejects a stale connection after a retry and ignores its later errors", async () => {
    const attempts: TransportHandlers[] = [];
    const timers: Array<() => void> = [];
    const storage = memoryStorage();
    const presence = new Presence({}, {
      transport: (handlers) => { attempts.push(handlers); }, storage,
      setTimer: (fn) => { timers.push(fn); return 1 as unknown as ReturnType<typeof setTimeout>; },
      clearTimer() {},
    });
    presence.connect("grove");
    attempts[0]!.onConnectError(new Error("offline"));
    timers[0]!();
    const stale = stubConnection({});
    const disconnect = vi.spyOn(stale, "disconnect");
    attempts[0]!.onConnect(stale, "old", "old-token");
    expect(disconnect).toHaveBeenCalledOnce();
    expect(stale.queries).toEqual([]);
    const current = stubConnection({});
    attempts[1]!.onConnect(current, "new", "new-token");
    await settle();
    attempts[0]!.onDisconnect(new Error("late close"));
    expect(presence.online).toBe(true);
    expect(storage.getItem("orchard.grove.token")).toBe("new-token");
    expect(timers).toHaveLength(1);
    presence.dispose();
  });

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
  it("closes a late connection without joining, storing its token or becoming online", () => {
    let handlers!: TransportHandlers;
    const storage = memoryStorage();
    const status = vi.fn();
    const presence = new Presence({ onStatus: status }, {
      transport: (h) => { handlers = h; }, storage,
    });
    presence.connect("grove");
    presence.dispose();
    expect(handlers.isCurrent?.()).toBe(false);
    const connection = stubConnection({});
    const disconnect = vi.spyOn(connection, "disconnect");
    handlers.onConnect(connection, "late", "late-token");
    handlers.onConnectError(new Error("late error"));
    expect(disconnect).toHaveBeenCalledOnce();
    expect(connection.queries).toEqual([]);
    expect(storage.getItem("orchard.grove.token")).toBeNull();
    expect(presence.online).toBe(false);
    expect(status).toHaveBeenCalledTimes(1);
  });

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
  it("retries a token source that throws before returning a promise", () => {
    const timer = vi.fn(() => 0 as unknown as ReturnType<typeof setTimeout>);
    const presence = new Presence({}, {
      token: () => { throw new Error("token unavailable"); },
      storage: memoryStorage(), setTimer: timer, clearTimer() {},
    });
    expect(() => presence.connect("grove")).not.toThrow();
    expect(presence.status).toBe("failed");
    expect(timer).toHaveBeenCalledOnce();
    presence.dispose();
  });

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

describe("who we are, and what a host can do", () => {
  const connected = async (people: StubVisitor[]) => {
    const connection = stubConnection({ people });
    let handlers!: TransportHandlers;
    const storage = memoryStorage();
    const presence = new Presence({}, { transport: (h) => (handlers = h), storage });
    presence.connect("grove");
    handlers.onConnect(connection, "me", "token");
    await settle(20);
    presence.sync();
    return { presence, connection, storage };
  };

  it("takes our own name and host flag from our row, and leaves us out of the peers", async () => {
    const { presence } = await connected([
      { hex: "me", name: "Manuel", room: "grove", isAdmin: true },
      { hex: "p1", name: "ann", room: "grove", muted: true },
    ]);
    expect(presence.me).toEqual({ name: "Manuel", host: true });
    expect([...presence.peers.keys()]).toEqual(["p1"]);
    expect(presence.peers.get("p1")?.muted).toBe(true);
  });

  it("renames by joining the room we are in, and keeps the name for next time", async () => {
    const { presence, connection, storage } = await connected([{ hex: "me", name: "visitor-1", room: "grove" }]);
    await presence.rename("Manuel");
    expect(connection.joins.at(-1)).toBe("grove");
    expect(connection.names.at(-1)).toBe("Manuel");
    expect(storage.getItem("orchard.grove.name")).toBe("Manuel");
  });

  it("keeps a name given while offline for when it connects", async () => {
    const storage = memoryStorage();
    const presence = new Presence({}, { transport: () => undefined, storage });
    await presence.rename("Manuel");
    expect(storage.getItem("orchard.grove.name")).toBe("Manuel");
  });

  it("sends mute, kick and ban with the identity the server gave", async () => {
    const { presence, connection } = await connected([{ hex: "p1", name: "ann", room: "grove" }]);
    await presence.moderate("p1", { kind: "mute", muted: true });
    await presence.moderate("p1", { kind: "kick" });
    await presence.moderate("p1", { kind: "ban", minutes: 0, network: true, reason: "spam" });
    expect(connection.moderation).toEqual(["mute p1 true", "kick p1", "ban p1 0 true spam"]);
    await expect(presence.moderate("gone", { kind: "kick" })).rejects.toThrow("not here");
  });
});

describe("chat", () => {
  const line = (over: Partial<ChatRow> = {}): ChatRow => ({
    id: 1n,
    room: "grove",
    sender: { toHexString: () => "them" },
    name: "ann",
    text: "hello",
    at: { microsSinceUnixEpoch: 1_700_000_000_000_000n },
    ...over,
  });

  /** Connects, joins, and returns the pieces plus the chat lines heard. */
  const talking = async () => {
    const connection = stubConnection({});
    const heard: ChatLine[] = [];
    let handlers!: TransportHandlers;
    const presence = new Presence(
      { onChat: (l) => heard.push(l) },
      { transport: (h) => (handlers = h), storage: memoryStorage() },
    );
    presence.connect("grove");
    handlers.onConnect(connection, "me", "token");
    await settle(20);
    return { presence, connection, heard };
  };

  it("subscribes to the room's chat view", async () => {
    const { presence, connection } = await talking();
    expect(connection.queries.flat()).toContain("SELECT * FROM chat_here");
    presence.dispose();
  });

  it("hears a line said after the backlog has landed", async () => {
    const { presence, connection, heard } = await talking();
    connection.chatInserts.forEach((cb) => cb(null, line({ text: "good evening" })));
    expect(heard.map((l) => l.text)).toEqual(["good evening"]);
    expect(heard[0]!.name).toBe("ann");
    expect(heard[0]!.mine).toBe(false);
    presence.dispose();
  });

  it("marks our own lines as ours", async () => {
    const { presence, connection, heard } = await talking();
    connection.chatInserts.forEach((cb) =>
      cb(null, line({ sender: { toHexString: () => "me" }, text: "mine" })));
    expect(heard[0]!.mine).toBe(true);
    presence.dispose();
  });

  it("stays silent about the backlog: rows delivered before onApplied are history", async () => {
    const connection = stubConnection({ applyLater: true });
    const heard: ChatLine[] = [];
    let handlers!: TransportHandlers;
    const presence = new Presence(
      { onChat: (l) => heard.push(l) },
      { transport: (h) => (handlers = h), storage: memoryStorage() },
    );
    presence.connect("grove");
    handlers.onConnect(connection, "me", "token");
    await settle(20);
    // The subscription has not been applied yet: these are the day's backlog.
    connection.chatInserts.forEach((cb) => cb(null, line({ text: "said an hour ago" })));
    expect(heard).toEqual([]);
    // Now it applies, and what follows is news.
    connection.applyNow();
    connection.chatInserts.forEach((cb) => cb(null, line({ text: "said now" })));
    expect(heard.map((l) => l.text)).toEqual(["said now"]);
    presence.dispose();
  });

  it("says a line, trimmed", async () => {
    const { presence, connection } = await talking();
    await presence.say("  hello there  ");
    expect(connection.said).toEqual(["hello there"]);
    presence.dispose();
  });

  it("sends nothing for an empty line", async () => {
    const { presence, connection } = await talking();
    await presence.say("   ");
    expect(connection.said).toEqual([]);
    presence.dispose();
  });

  it("refuses to speak when not in a room", async () => {
    const presence = new Presence({}, { transport: () => undefined, storage: memoryStorage() });
    await expect(presence.say("anyone there")).rejects.toThrow(/not in a room/);
    presence.dispose();
  });

  it("passes the module's refusal to the caller, rather than swallowing it", async () => {
    const connection = stubConnection({ refuseSay: () => "slow down" });
    let handlers!: TransportHandlers;
    const presence = new Presence({}, { transport: (h) => (handlers = h), storage: memoryStorage() });
    presence.connect("grove");
    handlers.onConnect(connection, "me", "token");
    await settle(20);
    await expect(presence.say("too fast")).rejects.toThrow(/slow down/);
    presence.dispose();
  });
});
