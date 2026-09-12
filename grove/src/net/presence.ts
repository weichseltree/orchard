import {
  FALLBACK_ROOM,
  MOVE_EPSILON_M,
  MOVE_EPSILON_YAW_RAD,
  MOVE_MIN_INTERVAL_MS,
  NAME_KEY,
  SPACETIME_DB,
  SPACETIME_URI,
  TOKEN_KEY,
} from "../config";
import { DbConnection } from "../module_bindings";

// Presence over SpacetimeDB. Four rules shape this file:
//
//  1. Rendering never waits on the network. Every call is fire-and-forget and
//     a failure becomes a notice, not an exception in the frame loop.
//  2. A refusal is final. `room full`, `room closed` and `admin only` are
//     answers, not transient errors: say why, try the grove once, then stop.
//     (Re-calling `join` on refusal starves the event loop at network speed.)
//  3. A dropped socket is transient. Reconnect on capped, jittered backoff and
//     re-join the room the body is actually standing in.
//  4. `move` goes out at 10 Hz and only while moving, plus once on stopping.
//
// Everything the class touches on the connection is in `PresenceConnection`,
// so the tests drive the join-refusal and reconnect paths against a stub
// instead of against maincloud.

export type PresenceStatus = "offline" | "connecting" | "online" | "failed";

/** First backoff step after a dropped connection. */
export const RECONNECT_MIN_MS = 1000;
/** The ceiling: a tab left open overnight still retries twice a minute. */
export const RECONNECT_MAX_MS = 30000;

/**
 * Backoff for reconnect attempt `attempt` (0 = the first retry): 1 s doubling
 * to 30 s, then jittered down by up to half so a server restart does not bring
 * every visitor back in the same millisecond. Pure, so the schedule is a test
 * rather than a claim.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const step = Math.max(0, Math.min(30, Math.floor(attempt)));
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** step);
  return Math.round(base * (0.5 + random() * 0.5));
}

export interface Peer {
  identity: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface Identityish {
  toHexString(): string;
}

interface VisitorRow {
  identity: Identityish;
  name: string;
  room: string;
  online: boolean;
}

interface PoseRow {
  identity: Identityish;
  room: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface TableEvents<Row> {
  iter(): Iterable<Row>;
  onInsert(cb: () => void): void;
  onUpdate?(cb: () => void): void;
  onDelete(cb: () => void): void;
}

interface SubscriptionBuilderish {
  onApplied(cb: () => void): SubscriptionBuilderish;
  onError(cb: () => void): SubscriptionBuilderish;
  subscribe(queries: string[]): { unsubscribe(): void };
}

/** Exactly the surface of the generated `DbConnection` that presence uses. */
export interface PresenceConnection {
  db: {
    visitor: TableEvents<VisitorRow>;
    pose: TableEvents<PoseRow>;
    room: { iter(): Iterable<{ name: string }> };
  };
  reducers: {
    join(params: { name: string; room: string }): Promise<void>;
    move(params: { x: number; y: number; z: number; yaw: number }): Promise<void>;
    leave(params: Record<string, never>): Promise<void>;
  };
  subscriptionBuilder(): SubscriptionBuilderish;
  disconnect(): void;
}

export interface TransportHandlers {
  onConnect(connection: PresenceConnection, identityHex: string, token: string): void;
  onConnectError(error: Error): void;
  onDisconnect(error?: Error): void;
}

/** How a connection is opened. Replaced in tests; the default is maincloud. */
export type PresenceTransport = (handlers: TransportHandlers, token: string | null) => void;

export interface PresenceDeps {
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  transport?: PresenceTransport;
  storage?: Pick<Storage, "getItem" | "setItem">;
}

export interface PresenceCallbacks {
  onStatus?: (status: PresenceStatus, detail?: string) => void;
  onNotice?: (message: string) => void;
  onPeersChanged?: (peers: ReadonlyMap<string, Peer>) => void;
}

export const defaultTransport: PresenceTransport = (handlers, token) => {
  const builder = DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(SPACETIME_DB)
    .onConnect((connection, identity, newToken) => {
      handlers.onConnect(
        connection as unknown as PresenceConnection,
        identity.toHexString(),
        newToken,
      );
    })
    .onConnectError((_ctx, error) => handlers.onConnectError(error))
    .onDisconnect((_ctx, error) => handlers.onDisconnect(error));
  if (token) builder.withToken(token);
  builder.build();
};

export class Presence {
  readonly peers = new Map<string, Peer>();
  status: PresenceStatus = "offline";
  /** The room the server thinks we are in; null while disconnected. */
  joinedRoom: string | null = null;

  #callbacks: PresenceCallbacks;
  #connection: PresenceConnection | null = null;
  #identityHex = "";
  #subscription: { unsubscribe(): void } | null = null;
  #dirty = false;
  #wantRoom: string | null = null;
  #joining = false;
  /** Reused: a pose goes out ten times a second and must not allocate. */
  #lastSent = { x: Number.NaN, y: 0, z: 0, yaw: 0, at: Number.NEGATIVE_INFINITY };
  #pendingStop = false;
  #disposed = false;
  #attempt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Rooms the server refused this session: asked for again only on request. */
  #refused = new Set<string>();
  #transport: PresenceTransport;
  #random: () => number;
  #setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  #clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  #storage: Pick<Storage, "getItem" | "setItem"> | null;

  constructor(callbacks: PresenceCallbacks = {}, deps: PresenceDeps = {}) {
    this.#callbacks = callbacks;
    this.#transport = deps.transport ?? defaultTransport;
    this.#random = deps.random ?? Math.random;
    this.#setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.#clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));
    this.#storage = deps.storage ?? safeStorage();
  }

  get identityHex(): string {
    return this.#identityHex;
  }

  get online(): boolean {
    return this.status === "online";
  }

  /** Number of visitors in this room including you, as the HUD shows it. */
  get here(): number {
    return this.online ? this.peers.size + 1 : 1;
  }

  /** How many reconnects have been attempted since the last good connection. */
  get reconnectAttempts(): number {
    return this.#attempt;
  }

  get name(): string {
    return this.#storage?.getItem(NAME_KEY) ?? "";
  }

  set name(value: string) {
    this.#storage?.setItem(NAME_KEY, value);
  }

  /**
   * Opens the connection and keeps it open. Never throws and never blocks: a
   * failure sets the status to "failed", leaves the notice up and retries on
   * backoff while the world carries on single-player.
   */
  connect(room: string): void {
    this.#wantRoom = room;
    this.#open();
  }

  /**
   * Joins a room by name. A room the module does not have, or refuses, is not
   * retried: the reason goes to the HUD, the grove is tried once, and that is
   * the end of it until the visitor asks again by crossing a doorway.
   */
  join(room: string): void {
    this.#wantRoom = room;
    this.#pump();
  }

  /**
   * Offers a pose. Sends at most every 100 ms, and only when the visitor has
   * actually moved — plus one last message when they stop, so nobody is left
   * standing a step behind where they really are.
   */
  sendPose(x: number, y: number, z: number, yaw: number, now: number = performance.now()): void {
    const connection = this.#connection;
    if (!connection || this.status !== "online" || !this.joinedRoom) return;
    const last = this.#lastSent;
    const moved =
      Number.isNaN(last.x) ||
      Math.abs(x - last.x) > MOVE_EPSILON_M ||
      Math.abs(y - last.y) > MOVE_EPSILON_M ||
      Math.abs(z - last.z) > MOVE_EPSILON_M ||
      Math.abs(angleDelta(yaw, last.yaw)) > MOVE_EPSILON_YAW_RAD;
    if (!moved && !this.#pendingStop) return;
    if (now - last.at < MOVE_MIN_INTERVAL_MS) {
      this.#pendingStop = this.#pendingStop || moved;
      return;
    }
    this.#pendingStop = moved;
    last.x = x;
    last.y = y;
    last.z = z;
    last.yaw = yaw;
    last.at = now;
    connection.reducers.move({ x, y, z, yaw }).catch(() => {
      // A refused move is not worth a notice per frame; the socket dropping is
      // what matters and onDisconnect reports that.
    });
  }

  /** Rebuilds the peer list when a table changed. Called once per frame. */
  sync(): boolean {
    if (!this.#dirty || !this.#connection) return false;
    this.#dirty = false;
    const connection = this.#connection;
    const room = this.joinedRoom;
    const seen = new Set<string>();
    if (room) {
      for (const visitor of connection.db.visitor.iter()) {
        if (visitor.room !== room || !visitor.online) continue;
        const hex = visitor.identity.toHexString();
        if (hex === this.#identityHex) continue;
        seen.add(hex);
        const existing = this.peers.get(hex);
        if (existing) existing.name = visitor.name;
        else this.peers.set(hex, { identity: hex, name: visitor.name, x: 0, y: 0, z: 0, yaw: 0 });
      }
      for (const pose of connection.db.pose.iter()) {
        const hex = pose.identity.toHexString();
        const peer = this.peers.get(hex);
        if (!peer || pose.room !== room) continue;
        peer.x = pose.x;
        peer.y = pose.y;
        peer.z = pose.z;
        peer.yaw = pose.yaw;
      }
    }
    for (const hex of [...this.peers.keys()]) if (!seen.has(hex)) this.peers.delete(hex);
    this.#callbacks.onPeersChanged?.(this.peers);
    return true;
  }

  /** The rooms the server knows about, for the doorway check and the HUD. */
  knownRooms(): string[] {
    const connection = this.#connection;
    if (!connection || this.status !== "online") return [];
    return [...connection.db.room.iter()].map((room) => room.name);
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#retryTimer !== null) this.#clearTimer(this.#retryTimer);
    this.#retryTimer = null;
    const connection = this.#connection;
    this.#subscription?.unsubscribe();
    this.#subscription = null;
    if (connection && this.status === "online") {
      connection.reducers.leave({}).catch(() => undefined);
      connection.disconnect();
    }
    this.#connection = null;
    this.peers.clear();
  }

  #open(): void {
    if (this.#connection || this.#disposed) return;
    if (this.#retryTimer !== null) {
      this.#clearTimer(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#setStatus("connecting");
    let token: string | null = null;
    try {
      token = this.#storage?.getItem(TOKEN_KEY) ?? null;
    } catch {
      // A locked-down browser: a fresh anonymous identity each visit is fine.
    }
    try {
      this.#transport(
        {
          onConnect: (connection, identityHex, newToken) => {
            this.#connection = connection;
            this.#identityHex = identityHex;
            this.#attempt = 0;
            try {
              this.#storage?.setItem(TOKEN_KEY, newToken);
            } catch {
              // Not fatal; the identity is then per-session.
            }
            this.#setStatus("online");
            this.#watchTables(connection);
            this.#resetPose();
            this.#pump();
          },
          onConnectError: (error) => this.#dropped(error.message),
          onDisconnect: (error) => this.#dropped(error?.message ?? "the connection closed"),
        },
        token,
      );
    } catch (error) {
      this.#dropped(error instanceof Error ? error.message : String(error));
    }
  }

  /** One place for "the socket is gone": forget it, say so, retry on backoff. */
  #dropped(detail: string): void {
    this.#connection = null;
    this.#subscription = null;
    this.joinedRoom = null;
    this.#joining = false;
    if (this.peers.size > 0) {
      this.peers.clear();
      this.#callbacks.onPeersChanged?.(this.peers);
    }
    this.#setStatus("failed", detail);
    if (this.#disposed || this.#retryTimer !== null) return;
    const delay = reconnectDelay(this.#attempt, this.#random);
    this.#attempt++;
    this.#retryTimer = this.#setTimer(() => {
      this.#retryTimer = null;
      this.#open();
    }, delay);
  }

  /** Asks for `#wantRoom` if it is askable, exactly once per answer. */
  #pump(): void {
    const connection = this.#connection;
    const want = this.#wantRoom;
    if (!connection || this.status !== "online" || this.#joining || !want) return;
    if (want === this.joinedRoom) return;
    if (this.#refused.has(want)) return;
    if (!this.#roomExists(connection, want)) {
      this.#refuse(want, `no room "${want}" server-side`);
      return;
    }
    this.#joining = true;
    connection.reducers
      .join({ name: this.name, room: want })
      .then(() => {
        this.joinedRoom = want;
        this.#subscribe(connection, want);
        this.#resetPose(); // the first pose of a new room always goes out
      })
      .catch((error: unknown) => {
        // "room full", "room closed", "admin only": an answer, not a hiccup.
        this.#refuse(want, message(error));
      })
      .finally(() => {
        this.#joining = false;
        // #wantRoom is only ever left ahead of joinedRoom by a *new* request,
        // so this cannot loop on a refusal.
        this.#pump();
      });
  }

  /**
   * Records a refusal, says why, and falls back to the grove once. Never
   * re-asks for the refused room by itself.
   */
  #refuse(room: string, reason: string): void {
    this.#refused.add(room);
    this.#wantRoom = this.joinedRoom;
    const notice = `presence: "${room}" refused (${reason})`;
    this.#callbacks.onNotice?.(notice);
    console.info(`[presence] ${notice}`);
    if (room !== FALLBACK_ROOM && this.joinedRoom === null && !this.#refused.has(FALLBACK_ROOM)) {
      this.#callbacks.onNotice?.(`presence: falling back to "${FALLBACK_ROOM}"`);
      this.#wantRoom = FALLBACK_ROOM;
      this.#pump();
    }
  }

  /** The next pose is unconditional: a new room, or a new connection. */
  #resetPose(): void {
    this.#lastSent.x = Number.NaN;
    this.#lastSent.at = Number.NEGATIVE_INFINITY;
    this.#pendingStop = false;
  }

  #roomExists(connection: PresenceConnection, room: string): boolean {
    const rooms = [...connection.db.room.iter()];
    // Before the room table has arrived there is nothing to check against;
    // let the reducer be the authority and report its refusal.
    if (rooms.length === 0) return true;
    return rooms.some((r) => r.name === room);
  }

  #watchTables(connection: PresenceConnection): void {
    const touch = (): void => {
      this.#dirty = true;
    };
    connection.db.visitor.onInsert(touch);
    connection.db.visitor.onUpdate?.(touch);
    connection.db.visitor.onDelete(touch);
    connection.db.pose.onInsert(touch);
    connection.db.pose.onUpdate?.(touch);
    connection.db.pose.onDelete(touch);
  }

  #subscribe(connection: PresenceConnection, room: string): void {
    const previous = this.#subscription;
    const escaped = room.replace(/'/g, "''");
    // Subscribe before unsubscribing, so the client cache never empties
    // between two rooms (SpacetimeDB best practice).
    this.#subscription = connection
      .subscriptionBuilder()
      .onApplied(() => {
        this.#dirty = true;
        previous?.unsubscribe();
      })
      .onError(() => {
        this.#callbacks.onNotice?.("presence: the room subscription failed");
        previous?.unsubscribe();
      })
      .subscribe([
        `SELECT * FROM visitor WHERE room = '${escaped}'`,
        `SELECT * FROM pose WHERE room = '${escaped}'`,
        "SELECT * FROM room",
      ]);
  }

  #setStatus(status: PresenceStatus, detail?: string): void {
    this.status = status;
    this.#callbacks.onStatus?.(status, detail);
  }
}

function safeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
