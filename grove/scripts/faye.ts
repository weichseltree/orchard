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
// Local by default; the live world only with --live (ruled by Manuel,
// 2026-09-16). Faye joins as an admin, and an admin bypasses the ban check,
// the join throttle, the per-network cap and room capacity
// (spacetime/spacetimedb/src/index.ts, `join`). Live, that admin is her OWN
// identity -- made once with --new-identity, granted with `add_admin`, revoked
// with `remove_admin` -- and never the CLI's publisher token (src/faye/local.ts).
//
//   pnpm tsx scripts/faye.ts --uri wss://maincloud.spacetimedb.com --live \
//     --token-file ~/.config/orchard/faye.token --new-identity   # once
//   pnpm tsx scripts/faye.ts --uri wss://maincloud.spacetimedb.com --live \
//     --token-file ~/.config/orchard/faye.token                  # the service
//
// She reads expdash's feed for what the LANES did, and any number of
// `--feed-url` feeds for what a RUN declares about itself (src/faye/feeds.ts).
// Against the LogSwarm emulator that is its RTDB path and the emulator's owner
// token, which is why the token comes from a file and never from the argv:
//
//   pnpm tsx scripts/faye.ts --db orchard --cli-config <scratch>/stdb/cli.toml \
//     --feed-url 'http://localhost:6104/feeds/<project>/planet/live.json?ns=demo-logswarm-default-rtdb' \
//     --feed-token-file ~/.config/orchard/logswarm-feed.token
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Identity } from "spacetimedb";
import { DbConnection } from "../src/module_bindings";
import { connectionPolicy } from "../src/faye/local";
import { fitToRoom, readFeed, type TreeTitles } from "../src/faye/events";
import {
  NEW_WATCH, feedRequest, feedTimeoutMs, planFeeds, takeReadings,
  type FeedSource, type Watch,
} from "../src/faye/feeds";
import { replyTo } from "../src/faye/reply";
import { Speaker, TURN_POSE_HZ, isNewLine, onDisconnectAction } from "../src/faye/listen";
import { FAYE_NAME, FAYE_ROOM } from "../src/faye/names";

const { values: args } = parseArgs({
  options: {
    uri: { type: "string", default: "ws://127.0.0.1:3000" },
    db: { type: "string", default: "orchard" },
    "cli-config": { type: "string", default: "" },
    /** The public world. Required for any server that is not this machine. */
    live: { type: "boolean", default: false },
    /** Faye's own identity token, one line. Required live; mode 600. */
    "token-file": { type: "string", default: "" },
    /** Make that identity: connect with none, write its token, print it, exit. */
    "new-identity": { type: "boolean", default: false },
    /** Where she stands, metres: "x,y,z". Eye height, not the floor. */
    at: { type: "string", default: "0,1.6,6" },
    /** Seconds per full turn on the spot; 0 stands still. */
    turn: { type: "string", default: "24" },
    /** One line on arrival. Empty says nothing. */
    say: { type: "string", default: "" },
    /** expdash's feed: both boxes at once (src/faye/events.ts says why). Empty drops it. */
    "status-url": { type: "string", default: "http://localhost:8686/api/status" },
    /**
     * A second feed of what runs declare about themselves, in the same shape:
     * `logswarm/announce/1` (src/faye/feeds.ts). Repeatable. Read beside
     * expdash's, never instead of it.
     */
    "feed-url": { type: "string", multiple: true, default: [] },
    /**
     * A bearer token for those feeds, one line, mode 600. None means no
     * header. One token for every `--feed-url` and never for `--status-url`:
     * pair them per feed only when a second origin needs a different one.
     */
    "feed-token-file": { type: "string", default: "" },
    /** Seconds between polls; 0 leaves her silent about the compute. */
    poll: { type: "string", default: "30" },
    /** Where trees/*.yaml live, for the label a visitor reads rather than the tree identity. */
    trees: { type: "string", default: "../trees" },
  },
});

const URI = args.uri;
const DB = args.db;
// Who she is and where she may stand (src/faye/local.ts): the public world
// only with --live, and there only with her own identity, never a CLI's.
const policy = connectionPolicy({
  uri: URI,
  live: args.live ?? false,
  cliConfig: args["cli-config"] ?? "",
  tokenFile: args["token-file"] ?? "",
  home: homedir(),
});
if (!args["new-identity"] && !policy.ok) {
  console.error(`faye: ${policy.reason}`);
  process.exit(2);
}
if (args["new-identity"] && !args["token-file"]) {
  console.error("faye: --new-identity needs --token-file, where the new identity's token is written");
  process.exit(2);
}

// The module's own limits. Breaking any of them is a thrown reducer, not a
// silent clamp, so they are read from the module rather than guessed.
const WORLD_HALF_EXTENT_M = 500;
const WORLD_Y_MIN_M = -50;
const WORLD_Y_MAX_M = 100;
const CHAT_MIN_GAP_MS = 700;

/** Whether the socket has come up, and whether she is walking out on purpose. */
const life = { connected: false, leaving: false };

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

/**
 * A secret's first line, from a file nobody but her user may read. Both the
 * identity token and a feed's bearer token come this way: a token on a command
 * line is in every `ps` on the box.
 */
function secretFirstLine(path: string): string {
  const mode = statSync(path).mode & 0o077;
  if (mode !== 0) throw new Error(`${path} is readable by others (mode ${(statSync(path).mode & 0o777).toString(8)}); chmod 600 it`);
  const token = readFileSync(path, "utf8").split("\n")[0]?.trim() ?? "";
  if (!token) throw new Error(`no token in ${path}`);
  return token;
}

function connect(token: string | null): Promise<{ conn: DbConnection; hex: string; identity: Identity; token: string }> {
  return new Promise((resolve, reject) => {
    // A connection the module refuses in clientConnected arrives as a
    // disconnect, not as a connect error (module-check.ts says so).
    const timer = setTimeout(() => reject(new Error("no answer in 10 s")), 10_000);
    const builder = DbConnection.builder().withUri(URI).withDatabaseName(DB);
    // No token means the server mints a new identity and hands its token back.
    (token ? builder.withToken(token) : builder)
      .onConnect((conn, identity, issued) => {
        clearTimeout(timer);
        life.connected = true;
        resolve({ conn, hex: identity.toHexString(), identity, token: issued });
      })
      .onConnectError((_ctx, error) => {
        clearTimeout(timer);
        reject(error);
      })
      .onDisconnect((_ctx, error) => {
        clearTimeout(timer);
        // src/faye/listen.ts: a drop after connecting must end the process,
        // or the unit stays "active" with her capsule gone from the room.
        const action = onDisconnectAction(life);
        if (action === "reject") {
          reject(error ?? new Error("disconnected"));
        } else if (action === "exit-failed") {
          console.error(`faye: lost the connection (${error instanceof Error ? error.message : "closed"}); exiting for a restart`);
          process.exit(1);
        }
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

  if (args["new-identity"]) {
    // Made over HTTP, not by connecting: the live module refuses any connection
    // that is neither admin nor carrying a grove-issued token ("connect through
    // the grove"), so an identity minted by connecting would be refused before
    // it could ever be made admin. `POST /v1/identity` creates one without
    // touching the database at all.
    const path = args["token-file"] ?? "";
    const http = URI.replace(/^ws(s?):/, "http$1:").replace(/\/+$/, "");
    const response = await fetch(`${http}/v1/identity`, { method: "POST" });
    if (!response.ok) throw new Error(`${http}/v1/identity answered ${response.status}`);
    const made = (await response.json()) as { identity?: string; token?: string };
    if (!made.identity || !made.token) throw new Error("the identity endpoint returned no identity or token");
    // `wx`: never overwrite. An identity that has been made admin and then
    // replaced by accident is a host nobody can remove without knowing it.
    writeFileSync(path, `${made.token}\n`, { mode: 0o600, flag: "wx" });
    console.log(`faye: new identity ${made.identity}, token written to ${path}`);
    console.log(`faye: make it a host with: spacetime call -s maincloud ${DB} add_admin '"0x${made.identity}"'`);
    return;
  }

  // Both secrets and the feed plan are read BEFORE she connects: a mode-644
  // token file must not throw after she is standing in the room, where the
  // exit skips `leave` and her capsule lingers until the socket times out.
  const bearer = args["feed-token-file"] ? secretFirstLine(args["feed-token-file"]) : "";
  const sources = planFeeds(args["status-url"] ?? "", args["feed-url"] ?? []);
  const pollSeconds = Number(args.poll);
  if (!Number.isFinite(pollSeconds) || pollSeconds < 0) throw new Error("--poll wants seconds");

  const token = policy.ok && policy.token === "token-file" ? secretFirstLine(args["token-file"] ?? "") : publisherToken(args["cli-config"] ?? "");
  const { conn, hex, identity } = await connect(token);
  console.log(`faye: connected to ${DB} at ${URI} as ${hex.slice(0, 16)}…`);

  // The two views the grove itself watches, scoped by the server to the room
  // we are in. Faye sees exactly what any visitor sees -- no more.
  await subscribe(conn, ["SELECT * FROM people_here", "SELECT * FROM poses_here", "SELECT * FROM chat_here"]);

  const titles = readTreeTitles(args.trees);
  if (titles.size > 0) console.log(`faye: ${titles.size} tree label(s) loaded from ${args.trees}`);

  // What she has taken in of the feeds, and so what she can tell a visitor.
  // Declared here because the chat handler below reads it, and updated by the
  // poll loop. It lives only as long as she stands here: a spirit that
  // remembered across restarts would announce a backlog on arrival.
  // `takeReadings` (src/faye/feeds.ts) holds the whole of that behaviour, and
  // its tests.
  let watch: Watch = NEW_WATCH;

  // Everything she says goes through one queue (src/faye/listen.ts).
  // Every line she says goes through the room's length, not just the ones
  // `announce` built: her replies and the peer notices are written here and
  // can run long too, and the module would clip any of them at 280 silently
  // and mid-word (src/faye/events.ts, `fitToRoom`).
  const speaker = new Speaker((text) => conn.reducers.say({ text: fitToRoom(text) }), {
    gapMs: CHAT_MIN_GAP_MS + 200,
    // Monotonic: a wall clock stepped forward by NTP would end a gap early.
    now: () => performance.now(),
    sleep,
    onRefused: (text, error) => {
      console.warn(`faye: "${text}" refused (${error instanceof Error ? error.message : String(error)})`);
    },
    onDropped: (text) => console.warn(`faye: too many lines waiting; not saying "${text}"`),
  });
  // Her row's `last_seen` as it stood before THIS run's join. A restart after a
  // crash reuses the identity and the module may not have seen the old socket
  // close, so a row can already be in the view; its `last_seen` would let
  // through lines that run already answered. The cut is the first `last_seen`
  // that differs from it -- which is the join's own commit, visible as soon as
  // the join's rows land, rather than when its acknowledgement is processed.
  let before: bigint | null | undefined;

  // Every line already in the room when she arrives is history; she hears
  // only what is said after her own join, by the module's clock
  // (src/faye/listen.ts). Listening does not wait on the compute feed: with
  // no feed she still answers, and says she has not heard from it. Registered
  // BEFORE `join`: a line said between the join and a later registration --
  // the greeting's wait alone is 0.9 s -- would be inserted with no handler
  // and never replayed. Until this run's join is in the view, nothing is new.
  const ownLastSeen = (): bigint | null => {
    for (const person of conn.db.peopleHere.iter()) {
      if (person.identity.isEqual(identity)) return person.lastSeen.microsSinceUnixEpoch;
    }
    return null;
  };
  const joinedAt = (): bigint | null => {
    if (before === undefined) return null; // not asked to join yet
    const seen = ownLastSeen();
    return seen === null || seen === before ? null : seen;
  };
  conn.db.chatHere.onInsert((_ctx, row) => {
    if (life.leaving) return;
    const line = { sender: row.sender.toHexString(), atMicros: row.at.microsSinceUnixEpoch };
    if (!isNewLine(line, hex, joinedAt())) return;
    // What the poll loop last left her knowing, read fresh on every line.
    const answer = replyTo(row.text, watch.known, titles);
    if (!answer) return;
    console.log(`faye: ${row.name} said "${row.text}" -> "${answer}"`);
    void speaker.say(answer, { droppable: true });
  });

  // Her name and room are constants, not flags (src/faye/names.ts): the client
  // recognises her by the one and sends visitors to the other.
  before = ownLastSeen();
  // The speaker is held from BEFORE the join until its acknowledgement and the
  // hold after it: the handler is live, and a reply to a line said while the
  // join is in flight must not go out inside the gap `join` just stamped.
  const joining = conn.reducers.join({ name: FAYE_NAME, room: FAYE_ROOM });
  speaker.holdUntil(joining.then(() => speaker.heldUntilGap(performance.now())));
  await joining;
  console.log(`faye: standing in "${FAYE_ROOM}" as "${FAYE_NAME}"`);

  // Queued, not awaited: replies may already be waiting ahead of it, and the
  // pose, the poll and the signal handlers below must not wait on them. A
  // refused greeting is logged and never costs Faye her presence.
  if (args.say) void speaker.say(args.say);

  const startedAt = Date.now();
  // Standing on the spot, turning slowly: a presence, not a pacing NPC.
  // Nothing here pretends to walk -- the body has no collision and no
  // navigation, and a capsule sliding through a wall reads as a bug.
  const sendPose = () => {
    if (life.leaving) return;
    const yaw = turnSeconds > 0
      ? ((Date.now() - startedAt) / 1000 / turnSeconds) * Math.PI * 2
      : 0;
    conn.reducers.move({ x: at.x, y: at.y, z: at.z, yaw: wrapAngle(yaw) }).catch((error: unknown) => {
      console.warn(`faye: move refused (${error instanceof Error ? error.message : String(error)})`);
    });
  };
  sendPose();
  // Standing still is one pose; turning is a stream, at a rate maincloud is
  // not paying for around the clock (TURN_POSE_HZ says why).
  const timer = turnSeconds > 0 ? setInterval(sendPose, 1000 / TURN_POSE_HZ) : null;

  // Which feeds, and in which order (src/faye/feeds.ts says why expdash leads).
  if (sources.length === 0) console.log("faye: no compute feed; she will say she has not heard from it");

  const timeoutMs = feedTimeoutMs(pollSeconds);

  /** One feed's document, or null when it did not answer. Never spoken about. */
  const fetchFeed = async (source: FeedSource): Promise<unknown> => {
    try {
      const response = await fetch(source.url, feedRequest(source.lanes ? "" : bearer, timeoutMs));
      if (!response.ok) throw new Error(`${response.status}`);
      return await response.json();
    } catch (error) {
      // A feed being down is not Faye's news to break. She goes on standing;
      // the room is never told the plumbing failed.
      console.warn(`faye: no feed from ${source.name} (${error instanceof Error ? error.message : String(error)})`);
      return null;
    }
  };

  const pollOnce = async (): Promise<void> => {
    if (life.leaving) return;
    // Every feed at once, each with its own timeout: a stalled feed costs this
    // poll that timeout and no more, and never a run of polls in which she
    // stands there saying nothing.
    const docs = await Promise.all(sources.map(fetchFeed));
    if (life.leaving) return;

    const polled = takeReadings(watch, sources.map((source, index) => ({
      feed: source.name,
      lanes: source.lanes,
      reading: docs[index] === null ? null : readFeed(docs[index]),
    })), titles);
    watch = polled.state;
    for (const note of polled.notes) console.log(`faye: ${note}`);

    for (const text of polled.lines) {
      if (life.leaving) return;
      await speaker.say(text);
    }
  };

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  if (pollSeconds > 0 && sources.length > 0) {
    // One poll at a time. Each can queue announcements that take 0.9 s apiece
    // to say; with a short --poll, overlapping polls would pile them up behind
    // one another faster than she can speak, with every reply behind them.
    let polling = false;
    const pollAlone = async (): Promise<void> => {
      if (polling) return;
      polling = true;
      try {
        await pollOnce();
      } finally {
        polling = false;
      }
    };
    void pollAlone();
    pollTimer = setInterval(() => void pollAlone(), pollSeconds * 1000);
    console.log(`faye: watching ${sources.map((source) => source.name).join(", ")} every ${pollSeconds}s`);
  }

  console.log("faye: listening — say her name in the room");

  const farewell = async (signal: string) => {
    if (life.leaving) return;
    life.leaving = true;
    if (timer !== null) clearInterval(timer);
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


function wrapAngle(angle: number): number {
  const wrapped = angle % (Math.PI * 2);
  return wrapped > Math.PI ? wrapped - Math.PI * 2 : wrapped;
}

main().catch((error: unknown) => {
  console.error(`faye: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
