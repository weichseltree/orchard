// Faye: an agent standing in the local grove as a visitor.
//
// The grove draws every presence peer as a capsule with a name sprite, and
// appends " · host" when the peer is an admin (src/net/avatars.ts). So an
// agent does not need a new avatar kind, a new table or a client change to be
// SEEN in the world -- it needs an identity the module calls admin, and the
// three reducers every visitor uses: join, move, say.
//
//   spacetime start --data-dir <scratch>/stdb/data --listen-addr 127.0.0.1:3000
//   spacetime --config-path <scratch>/stdb/cli.toml publish -s local -p <copy of ../spacetime/spacetimedb> orchard --yes
//   pnpm tsx scripts/faye.ts --db orchard --cli-config <scratch>/stdb/cli.toml
//
// LOCAL ONLY, and it refuses anything else. Faye joins as an admin, and an
// admin bypasses the ban check, the join throttle, the per-network cap and the
// room capacity (spacetime/spacetimedb/src/index.ts, `join`). That is the
// right identity for a host standing in their own world and the wrong one to
// point at maincloud, where it would be a real host appearing unannounced.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Identity } from "spacetimedb";
import { DbConnection } from "../src/module_bindings";
import { isLoopback } from "../src/faye/local";
import {
  EMPTY_CURSOR, accumulate, announce, peerIsSilent, readFeed,
  type Cursor, type TreeTitles,
} from "../src/faye/events";
import { EMPTY_STATE, replyTo, type FayeState } from "../src/faye/reply";

const { values: args } = parseArgs({
  options: {
    uri: { type: "string", default: "ws://127.0.0.1:3000" },
    db: { type: "string", default: "orchard" },
    "cli-config": { type: "string", default: "" },
    room: { type: "string", default: "grove" },
    // NAME_MAX is 24 and `cleanName` clips silently, so a longer name is
    // truncated rather than refused: "The Great Admin Spirit Faye" (27) would
    // stand in the room as "The Great Admin Spirit F". This one is 23.
    name: { type: "string", default: "Great Admin Spirit Faye" },
    /** Where she stands, metres: "x,y,z". Eye height, not the floor. */
    at: { type: "string", default: "0,1.6,6" },
    /** Seconds per full turn on the spot; 0 stands still. */
    turn: { type: "string", default: "24" },
    /** One line on arrival. Empty says nothing. */
    say: { type: "string", default: "" },
    /** expdash's feed: both boxes at once (src/faye/events.ts says why). */
    "status-url": { type: "string", default: "http://localhost:8686/api/status" },
    /** Seconds between polls; 0 leaves her silent about the compute. */
    poll: { type: "string", default: "30" },
    /** Where trees/*.yaml live, for the label a visitor reads rather than the tree identity. */
    trees: { type: "string", default: "../trees" },
  },
});

const URI = args.uri;
const DB = args.db;
if (!isLoopback(URI)) {
  console.error(`faye joins as an admin and moves under her own power: local servers only (got ${URI})`);
  process.exit(2);
}
if (!args["cli-config"]) {
  console.error("--cli-config is required: the LOCAL cli.toml whose token init made admin");
  console.error("(never ~/.config/spacetime/cli.toml -- that token is maincloud's admin)");
  process.exit(2);
}

// The module's own limits. Breaking any of them is a thrown reducer, not a
// silent clamp, so they are read from the module rather than guessed.
const MOVE_RATE = 20;          // tokens per second, burst 10
const TICK_HZ = 10;            // half the rate: a spirit never spends its burst
const WORLD_HALF_EXTENT_M = 500;
const WORLD_Y_MIN_M = -50;
const WORLD_Y_MAX_M = 100;
const CHAT_MIN_GAP_MS = 700;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function publisherToken(path: string): string {
  const match = /spacetimedb_token\s*=\s*"([^"]+)"/.exec(readFileSync(path, "utf8"));
  if (!match?.[1]) throw new Error(`no spacetimedb_token in ${path}`);
  return match[1];
}

function parseAt(raw: string): { x: number; y: number; z: number } {
  const parts = raw.split(",").map((n) => Number(n.trim()));
  if (parts.length !== 3 || !parts.every((n) => Number.isFinite(n))) {
    throw new Error(`--at wants "x,y,z", got ${JSON.stringify(raw)}`);
  }
  const [x, y, z] = parts as [number, number, number];
  if (Math.abs(x) > WORLD_HALF_EXTENT_M || Math.abs(z) > WORLD_HALF_EXTENT_M) {
    throw new Error(`--at is outside the world: |x| and |z| must be <= ${WORLD_HALF_EXTENT_M}`);
  }
  if (y < WORLD_Y_MIN_M || y > WORLD_Y_MAX_M) {
    throw new Error(`--at y must be between ${WORLD_Y_MIN_M} and ${WORLD_Y_MAX_M}`);
  }
  return { x, y, z };
}

function connect(token: string): Promise<{ conn: DbConnection; hex: string; identity: Identity }> {
  return new Promise((resolve, reject) => {
    // A connection the module refuses in clientConnected arrives as a
    // disconnect, not as a connect error (module-check.ts says so).
    const timer = setTimeout(() => reject(new Error("no answer in 10 s")), 10_000);
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .withToken(token)
      .onConnect((conn, identity) => {
        clearTimeout(timer);
        resolve({ conn, hex: identity.toHexString(), identity });
      })
      .onConnectError((_ctx, error) => {
        clearTimeout(timer);
        reject(error);
      })
      .onDisconnect((_ctx, error) => {
        clearTimeout(timer);
        reject(error ?? new Error("disconnected"));
      })
      .build();
  });
}

function subscribe(conn: DbConnection, queries: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject(new Error(String((ctx as { event?: unknown }).event ?? "subscription failed"))))
      .subscribe(queries);
  });
}

async function main(): Promise<void> {
  const at = parseAt(args.at);
  const turnSeconds = Number(args.turn);
  if (!Number.isFinite(turnSeconds) || turnSeconds < 0) throw new Error("--turn wants a number of seconds");

  const { conn, hex, identity } = await connect(publisherToken(args["cli-config"]));
  console.log(`faye: connected to ${DB} at ${URI} as ${hex.slice(0, 16)}…`);

  // The two views the grove itself watches, scoped by the server to the room
  // we are in. Faye sees exactly what any visitor sees -- no more.
  await subscribe(conn, ["SELECT * FROM people_here", "SELECT * FROM poses_here", "SELECT * FROM chat_here"]);

  await conn.reducers.join({ name: args.name, room: args.room });
  console.log(`faye: standing in "${args.room}" as "${args.name}"`);
  if (args.name.length > 24) {
    console.warn(`faye: the module clips names at 24 characters, so this shows as "${args.name.slice(0, 24)}"`);
  }

  if (args.say) {
    // `join` stamps last_said with the join time, so the first line is inside
    // CHAT_MIN_GAP (0.7 s) and comes back "slow down". Wait it out -- and a
    // refused greeting must never cost Faye her presence, which is the point
    // of standing here at all.
    await sleep(CHAT_MIN_GAP_MS + 200);
    await conn.reducers.say({ text: args.say }).catch((error: unknown) => {
      console.warn(`faye: greeting refused (${error instanceof Error ? error.message : String(error)})`);
    });
  }

  const titles = readTreeTitles(args.trees);
  if (titles.size > 0) console.log(`faye: ${titles.size} tree label(s) loaded from ${args.trees}`);

  let leaving = false;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (leaving) return;
    // Standing on the spot, turning slowly: a presence, not a pacing NPC.
    // Nothing here pretends to walk -- the body has no collision and no
    // navigation, and a capsule sliding through a wall reads as a bug.
    const yaw = turnSeconds > 0
      ? ((Date.now() - startedAt) / 1000 / turnSeconds) * Math.PI * 2
      : 0;
    conn.reducers.move({ x: at.x, y: at.y, z: at.z, yaw: wrapAngle(yaw) }).catch((error: unknown) => {
      console.warn(`faye: move refused (${error instanceof Error ? error.message : String(error)})`);
    });
  }, 1000 / Math.min(TICK_HZ, MOVE_RATE));

  // What she knows, for answering a visitor who speaks to her. Updated by the
  // poll loop; read by the chat handler.
  let known: FayeState = EMPTY_STATE;

  // Every line already in the room when she arrives is history. Answering it
  // would have her walk in replying to a conversation that finished hours ago,
  // so the subscription's initial rows are skipped and only what is said from
  // now on is heard.
  let listening = false;
  conn.db.chatHere.onInsert((_ctx, row) => {
    if (!listening || leaving) return;
    // Her own lines come back through the same view; answering them is a loop.
    if (row.sender.isEqual(identity)) return;
    const answer = replyTo(row.text, known, titles);
    if (!answer) return;
    console.log(`faye: ${row.name} said "${row.text}" -> "${answer}"`);
    void (async () => {
      // The gap is per speaker, and an announcement may have just used it.
      await sleep(CHAT_MIN_GAP_MS + 200);
      await conn.reducers.say({ text: answer }).catch((error: unknown) => {
        console.warn(`faye: reply refused (${error instanceof Error ? error.message : String(error)})`);
      });
    })();
  });

  // What she has taken in of the compute, and what she has already said about
  // the peer. Both live only as long as she stands here: a spirit that
  // remembers across restarts would announce a backlog on arrival.
  let cursor: Cursor = EMPTY_CURSOR;
  let peerWasSilent: boolean | null = null;
  let firstPoll = true;
  const pollSeconds = Number(args.poll);
  if (!Number.isFinite(pollSeconds) || pollSeconds < 0) throw new Error("--poll wants seconds");

  const pollOnce = async (): Promise<void> => {
    if (leaving) return;
    let doc: unknown;
    try {
      const response = await fetch(args["status-url"], { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status}`);
      doc = await response.json();
    } catch (error) {
      // The dashboard being down is not Faye's news to break. She goes on
      // standing; the room is never told the plumbing failed.
      console.warn(`faye: no feed (${error instanceof Error ? error.message : String(error)})`);
      return;
    }
    const reading = readFeed(doc);
    const taken = accumulate(cursor, reading.events);
    cursor = taken.cursor;
    if (taken.rebaselined) console.log("faye: the feed restarted its numbering; re-baselined");

    // The first poll is a baseline, not news: everything in the feed happened
    // before she arrived, and a spirit who walks in reciting the last hour is
    // not informing anyone.
    known = {
      hosts: reading.hosts,
      mirror: reading.mirror,
      seenByType: countBy(taken.fresh.map((e) => e.type), known.seenByType),
      runningByTree: runningByTree(doc),
      hasFeed: true,
    };

    if (firstPoll) {
      firstPoll = false;
      peerWasSilent = peerIsSilent(reading.mirror);
      listening = true;
      console.log(`faye: baseline taken at ${reading.events.length} event(s); watching ${reading.hosts.join(", ")}`);
      console.log("faye: listening — say her name in the room");
      return;
    }

    const lines = announce(taken.fresh, titles).map((a) => a.text);

    // The peer going quiet or coming back is worth one line each way, never
    // one per poll. This is the mirror's freshness, not any job's age.
    const silentNow = peerIsSilent(reading.mirror);
    if (peerWasSilent !== null && silentNow !== peerWasSilent && reading.mirror) {
      lines.push(silentNow
        ? `${reading.mirror.peer} has stopped reporting.`
        : `${reading.mirror.peer} is reporting again.`);
    }
    peerWasSilent = silentNow;

    for (const text of lines) {
      if (leaving) return;
      await conn.reducers.say({ text }).catch((error: unknown) => {
        console.warn(`faye: line refused (${error instanceof Error ? error.message : String(error)})`);
      });
      // CHAT_MIN_GAP is 0.7 s per speaker; crowding it throws "slow down".
      await sleep(CHAT_MIN_GAP_MS + 200);
    }
  };

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  if (pollSeconds > 0) {
    void pollOnce();
    pollTimer = setInterval(() => void pollOnce(), pollSeconds * 1000);
    console.log(`faye: watching the compute every ${pollSeconds}s`);
  }

  const farewell = async (signal: string) => {
    if (leaving) return;
    leaving = true;
    clearInterval(timer);
    if (pollTimer !== null) clearInterval(pollTimer);
    // Without this the capsule stands there until the connection times out.
    try {
      await conn.reducers.leave({});
    } catch {
      // Already gone is the same outcome.
    }
    conn.disconnect();
    console.log(`\nfaye: left the grove (${signal})`);
    process.exit(0);
  };
  process.on("SIGINT", () => void farewell("SIGINT"));
  process.on("SIGTERM", () => void farewell("SIGTERM"));
  console.log("faye: ctrl-c to leave");
}

/**
 * Tree identity to the label a person reads, from `trees/*.yaml`. The compute
 * feed carries the IDENTITY (`spectre`), which the rename ruling keeps because
 * it is inside the bytes every bundle id hashes; a visitor is told the title
 * (`coarsen`). Read with a regex rather than a YAML dependency: only the two
 * top-level scalars are wanted, and a manifest this reader cannot parse simply
 * contributes no label.
 */
function readTreeTitles(dir: string): TreeTitles {
  const titles = new Map<string, string>();
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
  } catch {
    return titles;
  }
  for (const file of files) {
    try {
      const text = readFileSync(join(dir, file), "utf8");
      const name = /^name:[ \t]*(\S.*?)[ \t]*$/m.exec(text)?.[1];
      const title = /^title:[ \t]*(\S.*?)[ \t]*$/m.exec(text)?.[1];
      if (name && title && title !== name) titles.set(unquote(name), unquote(title));
    } catch {
      // A manifest that will not read is a tree shown by its name. Not fatal.
    }
  }
  return titles;
}

function unquote(raw: string): string {
  return raw.replace(/^['"]|['"]$/g, "");
}

/** Running counts per tree identity, straight off the feed's experiments. */
function runningByTree(doc: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const root = doc as { experiments?: unknown };
  if (!Array.isArray(root?.experiments)) return out;
  for (const raw of root.experiments) {
    const e = raw as { status?: unknown; repo?: unknown };
    if (e?.status !== "running") continue;
    const repo = typeof e.repo === "string" && e.repo ? e.repo : "";
    if (!repo) continue;
    out.set(repo, (out.get(repo) ?? 0) + 1);
  }
  return out;
}

function countBy(values: readonly string[], into: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map(into);
  for (const v of values) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
}

function wrapAngle(angle: number): number {
  const wrapped = angle % (Math.PI * 2);
  return wrapped > Math.PI ? wrapped - Math.PI * 2 : wrapped;
}

main().catch((error: unknown) => {
  console.error(`faye: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
