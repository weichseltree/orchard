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
import type { ExhibitRow } from "../world/exhibits";

// Presence over SpacetimeDB. Five rules shape this file:
//
//  1. Rendering never waits on the network. Every call is fire-and-forget and
//     a failure becomes a notice, not an exception in the frame loop.
//  2. A refusal is final. `room full`, `room closed` and `admin only` are
//     answers, not transient errors: say why, try the grove once, then stop.
//     (Re-calling `join` on refusal starves the event loop at network speed.)
//  3. A dropped socket is transient. Reconnect on capped, jittered backoff and
//     re-join the room the body is actually standing in.
//  4. `move` goes out at 10 Hz and only while moving, plus once on stopping.
//  5. What arrives is not trusted. The server scopes who we can see to our
//     room (the `people_here` and `poses_here` views) and refuses impossible
//     poses, but a pose that is not a finite number is still skipped here,
//     because one NaN would park a capsule nowhere for good.
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
  /** An admin of the orchard. Only the server can set this; names can be anything. */
  host: boolean;
  /** Muted by a host: their chat is refused. */
  muted: boolean;
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
  isAdmin: boolean;
  muted: boolean;
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
    /** The people online in our room: a view the server scopes to us. */
    peopleHere: TableEvents<VisitorRow>;
    /** Their poses: likewise. */
    posesHere: TableEvents<PoseRow>;
    room: { iter(): Iterable<{ name: string }> };
    exhibit: { iter(): Iterable<ExhibitRow> };
  };
  reducers: {
    join(params: { name: string; room: string }): Promise<void>;
    move(params: { x: number; y: number; z: number; yaw: number }): Promise<void>;
    leave(params: Record<string, never>): Promise<void>;
    reportVisitor(params: { who: Identityish; reason: string }): Promise<void>;
    mute(params: { who: Identityish; muted: boolean }): Promise<void>;
    kick(params: { who: Identityish }): Promise<void>;
    banVisitor(params: { who: Identityish; minutes: number; reason: string; network: boolean }): Promise<void>;
  };
  subscriptionBuilder(): SubscriptionBuilderish;
  disconnect(): void;
}

/** Who we are, as the server has it: the cleaned name and whether we are a host. */
export interface Me {
  name: string;
  host: boolean;
}

/** What a host can do to someone. The server refuses all of it from anyone else. */
export type Moderation =
  | { kind: "mute"; muted: boolean }
  | { kind: "kick" }
  | { kind: "ban"; minutes: number; network: boolean; reason: string };

export interface TransportHandlers {
  /** A deferred transport must not open a socket for an abandoned attempt. */
  isCurrent?(): boolean;
  onConnect(connection: PresenceConnection, identityHex: string, token: string): void;
  onConnectError(error: Error): void;
  onDisconnect(error?: Error): void;
}

/** How a connection is opened. Replaced in tests; the default is maincloud. */
export type PresenceTransport = (handlers: TransportHandlers, token: string | null) => void;

/**
 * Where the token to connect with comes from, when the grove's token service
 * is in use (auth.ts). Absent, the anonymous identity SpacetimeDB handed out
 * last time is reused from storage. `fresh` is set on every retry, so a token
 * the server stopped accepting is replaced rather than offered forever. A
 * source that resolves null means "no token service here": presence then
 * behaves as if it had none.
 */
export type TokenSource = (fresh: boolean) => Promise<string | null>;

export interface PresenceDeps {
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  transport?: PresenceTransport;
  storage?: Pick<Storage, "getItem" | "setItem">;
  token?: TokenSource;
}

export interface PresenceCallbacks {
  onStatus?: (status: PresenceStatus, detail?: string) => void;
  onNotice?: (message: string) => void;
  onPeersChanged?: (peers: ReadonlyMap<string, Peer>) => void;
}

export const defaultTransport: PresenceTransport = (handlers, token) => {
  // The single-player demo never needs the network SDK. Production starts
  // loading it at the same connection request, alongside room/media loading.
  void import("../module_bindings").then(({ DbConnection }) => {
    if (handlers.isCurrent?.() === false) return;
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
  }).catch((error: unknown) => {
    if (handlers.isCurrent?.() !== false) {
      handlers.onConnectError(error instanceof Error ? error : new Error(String(error)));
    }
  });
};

export class Presence {
  readonly peers = new Map<string, Peer>();
  /** Ourselves, from our own row in the room's view; null until it arrives. */
  me: Me | null = null;
  status: PresenceStatus = "offline";
  /** The room the server thinks we are in; null while disconnected. */
  joinedRoom: string | null = null;

  #callbacks: PresenceCallbacks;
  #connection: PresenceConnection | null = null;
  #identityHex = "";
  #subscription: { unsubscribe(): void } | null = null;
  #exhibitSubscription: { unsubscribe(): void } | null = null;
  #exhibitsApplied = false;
  #exhibitWaiters: Array<() => void> = [];
  #dirty = false;
  #wantRoom: string | null = null;
  #joining = false;
  /** Stop publishing poses while the body is in a room whose next crossing was refused. */
  #poseSuppressed = false;
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
  #tokenSource: TokenSource | null;
  /** A token, transport module or socket is still opening. */
  #opening = false;
  #connectionGeneration = 0;
  /** This connection runs on an anonymous identity whose token is ours to keep. */
  #anonymous = true;

  constructor(callbacks: PresenceCallbacks = {}, deps: PresenceDeps = {}) {
    this.#callbacks = callbacks;
    this.#transport = deps.transport ?? defaultTransport;
    this.#random = deps.random ?? Math.random;
    this.#setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.#clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));
    this.#storage = deps.storage ?? safeStorage();
    this.#tokenSource = deps.token ?? null;
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
    if (!connection || this.status !== "online" || !this.joinedRoom || this.#poseSuppressed) return;
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
      for (const visitor of connection.db.peopleHere.iter()) {
        if (visitor.room !== room || !visitor.online) continue;
        const hex = visitor.identity.toHexString();
        if (hex === this.#identityHex) {
          if (this.me?.name !== visitor.name || this.me?.host !== visitor.isAdmin) {
            this.me = { name: visitor.name, host: visitor.isAdmin };
          }
          continue;
        }
        seen.add(hex);
        const existing = this.peers.get(hex);
        if (existing) {
          existing.name = visitor.name;
          existing.host = visitor.isAdmin;
          existing.muted = visitor.muted;
        } else {
          this.peers.set(hex, {
            identity: hex,
            name: visitor.name,
            host: visitor.isAdmin,
            muted: visitor.muted,
            x: 0,
            y: 0,
            z: 0,
            yaw: 0,
          });
        }
      }
      for (const pose of connection.db.posesHere.iter()) {
        const hex = pose.identity.toHexString();
        const peer = this.peers.get(hex);
        if (!peer || pose.room !== room) continue;
        if (!(Number.isFinite(pose.x) && Number.isFinite(pose.y) && Number.isFinite(pose.z) && Number.isFinite(pose.yaw))) {
          continue;
        }
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

  /**
   * Flags a visitor in our room for the admin, with a reason. Rejects with the
   * server's answer (one report every 30 seconds, and so on).
   */
  report(identityHex: string, reason: string): Promise<void> {
    const connection = this.#connection;
    if (!connection || this.status !== "online") return Promise.reject(new Error("not connected"));
    const row = [...connection.db.peopleHere.iter()].find((v) => v.identity.toHexString() === identityHex);
    if (!row) return Promise.reject(new Error("they are not here any more"));
    return connection.reducers.reportVisitor({ who: row.identity, reason });
  }

  /**
   * Takes a new name. It is kept for the next visit, and when we are in a
   * room it goes to the server now (joining the room we are in is how a name
   * changes); the server cleans it, and `me` shows what it made of it.
   */
  rename(name: string): Promise<void> {
    try {
      this.name = name;
    } catch {
      // Not kept for next time; still sent below.
    }
    const connection = this.#connection;
    const room = this.joinedRoom;
    if (!connection || this.status !== "online" || !room) return Promise.resolve();
    return connection.reducers.join({ name, room }).then(() => {
      this.#dirty = true;
    });
  }

  /** A host's mute, kick or ban of someone in our room. */
  moderate(identityHex: string, action: Moderation): Promise<void> {
    const connection = this.#connection;
    if (!connection || this.status !== "online") return Promise.reject(new Error("not connected"));
    const row = [...connection.db.peopleHere.iter()].find((v) => v.identity.toHexString() === identityHex);
    if (!row) return Promise.reject(new Error("they are not here any more"));
    const who = row.identity;
    if (action.kind === "mute") return connection.reducers.mute({ who, muted: action.muted });
    if (action.kind === "kick") return connection.reducers.kick({ who });
    return connection.reducers.banVisitor({ who, minutes: action.minutes, reason: action.reason, network: action.network });
  }

  /** What hangs where, as the server has it now; empty while single-player. */
  exhibits(): ExhibitRow[] {
    const connection = this.#connection;
    if (!connection || this.status !== "online") return [];
    return [...connection.db.exhibit.iter()];
  }

  /**
   * Resolves with the exhibit table once its subscription has applied, or
   * with null when `timeoutMs` runs out first: the world must not wait on a
   * network that may never answer, and a pinned bundle id is the
   * single-player answer. An empty array is the database saying nothing
   * hangs, which a pinned id must not override (a take-down).
   */
  whenExhibits(timeoutMs: number): Promise<ExhibitRow[] | null> {
    if (this.#exhibitsApplied) return Promise.resolve(this.exhibits());
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        this.#clearTimer(timer);
        resolve(this.#exhibitsApplied ? this.exhibits() : null);
      };
      const timer = this.#setTimer(finish, timeoutMs);
      this.#exhibitWaiters.push(finish);
    });
  }

  /** The rooms the server knows about, for the doorway check and the HUD. */
  knownRooms(): string[] {
    const connection = this.#connection;
    if (!connection || this.status !== "online") return [];
    return [...connection.db.room.iter()].map((room) => room.name);
  }

  dispose(): void {
    this.#disposed = true;
    ++this.#connectionGeneration;
    this.#opening = false;
    if (this.#retryTimer !== null) this.#clearTimer(this.#retryTimer);
    this.#retryTimer = null;
    const connection = this.#connection;
    this.#subscription?.unsubscribe();
    this.#subscription = null;
    this.#exhibitSubscription?.unsubscribe();
    this.#exhibitSubscription = null;
    if (connection && this.status === "online") {
      connection.reducers.leave({}).catch(() => undefined);
      connection.disconnect();
    }
    this.#connection = null;
    this.peers.clear();
  }

  #open(): void {
    if (this.#connection || this.#disposed || this.#opening) return;
    this.#opening = true;
    const generation = ++this.#connectionGeneration;
    if (this.#retryTimer !== null) {
      this.#clearTimer(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#setStatus("connecting");
    const source = this.#tokenSource;
    if (source) {
      let pending: Promise<string | null>;
      try {
        pending = source(this.#attempt > 0);
      } catch (error) {
        this.#dropped(message(error));
        return;
      }
      pending.then(
        (token) => {
          if (this.#disposed || generation !== this.#connectionGeneration) return;
          if (token === null) this.#openAnonymous(generation);
          else this.#openWith(token, false, generation);
        },
        (error: unknown) => {
          if (!this.#disposed && generation === this.#connectionGeneration) this.#dropped(message(error));
        },
      );
      return;
    }
    this.#openAnonymous(generation);
  }

  /** The anonymous identity SpacetimeDB handed out last time, or a new one. */
  #openAnonymous(generation: number): void {
    let token: string | null = null;
    try {
      token = this.#storage?.getItem(TOKEN_KEY) ?? null;
    } catch {
      // A locked-down browser: a fresh anonymous identity each visit is fine.
    }
    this.#openWith(token, true, generation);
  }

  #openWith(token: string | null, anonymous: boolean, generation: number): void {
    this.#anonymous = anonymous;
    const isCurrent = () => !this.#disposed && generation === this.#connectionGeneration;
    try {
      this.#transport(
        {
          isCurrent,
          onConnect: (connection, identityHex, newToken) => {
            if (!isCurrent()) {
              connection.disconnect();
              return;
            }
            this.#opening = false;
            this.#connection = connection;
            this.#identityHex = identityHex;
            this.#attempt = 0;
            // With the token service, the token is auth.ts's to keep; the
            // server only echoes it back.
            if (this.#anonymous) {
              try {
                this.#storage?.setItem(TOKEN_KEY, newToken);
              } catch {
                // Not fatal; the identity is then per-session.
              }
            }
            this.#setStatus("online");
            this.#watchTables(connection);
            this.#subscribeExhibits(connection);
            this.#resetPose();
            this.#pump();
          },
          onConnectError: (error) => { if (isCurrent()) this.#dropped(error.message); },
          onDisconnect: (error) => { if (isCurrent()) this.#dropped(error?.message ?? "the connection closed"); },
        },
        token,
      );
    } catch (error) {
      if (isCurrent()) this.#dropped(message(error));
    }
  }

  /** One place for "the socket is gone": forget it, say so, retry on backoff. */
  #dropped(detail: string): void {
    ++this.#connectionGeneration;
    this.#opening = false;
    this.#connection = null;
    this.me = null;
    this.#subscription = null;
    this.#exhibitSubscription = null;
    this.#exhibitsApplied = false;
    this.joinedRoom = null;
    this.#joining = false;
    this.#poseSuppressed = false;
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
        this.#poseSuppressed = false;
        // Once per connection: the views follow us from room to room.
        if (!this.#subscription) this.#subscribe(connection);
        else this.#dirty = true;
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
    if (this.joinedRoom !== null) this.#poseSuppressed = true;
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
    connection.db.peopleHere.onInsert(touch);
    connection.db.peopleHere.onUpdate?.(touch);
    connection.db.peopleHere.onDelete(touch);
    connection.db.posesHere.onInsert(touch);
    connection.db.posesHere.onUpdate?.(touch);
    connection.db.posesHere.onDelete(touch);
  }

  #subscribeExhibits(connection: PresenceConnection): void {
    this.#exhibitSubscription?.unsubscribe();
    this.#exhibitsApplied = false;
    const applied = (): void => {
      this.#exhibitsApplied = true;
      const waiters = this.#exhibitWaiters;
      this.#exhibitWaiters = [];
      for (const wake of waiters) wake();
    };
    this.#exhibitSubscription = connection
      .subscriptionBuilder()
      .onApplied(applied)
      .onError(() => {
        this.#callbacks.onNotice?.("presence: the exhibit subscription failed");
        applied(); // whoever waits gets the empty table rather than the timeout
      })
      .subscribe(["SELECT * FROM exhibit"]);
  }

  /**
   * The people and poses of whatever room we are in. The server scopes both
   * views to the caller's room and swaps their rows when we walk through a
   * doorway, so this is one subscription for the life of the connection.
   */
  #subscribe(connection: PresenceConnection): void {
    this.#subscription = connection
      .subscriptionBuilder()
      .onApplied(() => {
        this.#dirty = true;
      })
      .onError(() => {
        this.#callbacks.onNotice?.("presence: the room subscription failed");
      })
      .subscribe(["SELECT * FROM people_here", "SELECT * FROM poses_here", "SELECT * FROM room"]);
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
