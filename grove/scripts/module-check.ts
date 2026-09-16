// Checks the orchard module's security rules against a LOCAL SpacetimeDB with
// several visitors connected at once. It kicks, bans and floods, so it refuses
// to talk to maincloud.
//
//   spacetime start --data-dir <scratch> --listen-addr 127.0.0.1:3000
//   spacetime publish -s local -p ../spacetime/spacetimedb orchard-check
//   wrangler pages dev <dir holding functions/ and a .dev.vars> --port 8788
//   pnpm tsx scripts/module-check.ts --db orchard-check --cli-config <the publisher's cli.toml>
//
// The token service is optional (--auth ''); without it the per-network checks
// are skipped. Admin steps go through the `spacetime` CLI and a connection
// holding the publisher's token, which `init` made admin. Exits 1 on the
// first broken rule.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Identity } from "spacetimedb";
import { DbConnection } from "../src/module_bindings";

const { values: args } = parseArgs({
  options: {
    uri: { type: "string", default: "ws://127.0.0.1:3000" },
    db: { type: "string", default: "orchard-check" },
    "cli-config": { type: "string", default: "" },
    auth: { type: "string", default: "http://127.0.0.1:8788/auth" },
  },
});
const URI = args.uri;
const DB = args.db;
const CLI_CONFIG = args["cli-config"];
const AUTH = args.auth.replace(/\/+$/, "");
if (/maincloud|spacetimedb\.com/.test(URI)) {
  console.error("module-check kicks, bans and floods: local servers only");
  process.exit(2);
}

interface Visitor {
  conn: DbConnection;
  hex: string;
  identity: Identity;
  token: string;
}

let failures = 0;
function check(what: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cli(...rest: string[]): { ok: boolean; out: string } {
  const base = CLI_CONFIG ? ["--config-path", CLI_CONFIG] : [];
  const r = spawnSync("spacetime", [...base, ...rest], { encoding: "utf8" });
  const out = `${r.stdout}${r.stderr}`.replace(/WARNING: This command is UNSTABLE[^\n]*\n?/g, "").trim();
  return { ok: r.status === 0, out };
}

const admin = (reducer: string, ...json: string[]) => cli("call", "-s", "local", DB, reducer, ...json);

function publisherToken(): string {
  const text = readFileSync(CLI_CONFIG, "utf8");
  const m = /spacetimedb_token\s*=\s*"([^"]+)"/.exec(text);
  if (!m?.[1]) throw new Error(`no spacetimedb_token in ${CLI_CONFIG}`);
  return m[1];
}

async function groveToken(ip: string): Promise<string> {
  const r = await fetch(`${AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: "{}",
  });
  if (!r.ok) throw new Error(`token service: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { token: string }).token;
}

function connect(token?: string): Promise<Visitor> {
  return new Promise((resolve, reject) => {
    // A connection the module refuses in clientConnected arrives as a
    // disconnect, not as a connect error.
    const timer = setTimeout(() => reject(new Error("no answer in 10 s")), 10_000);
    const builder = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnect((conn, identity, token) => {
        clearTimeout(timer);
        resolve({ conn, hex: identity.toHexString(), identity, token });
      })
      .onConnectError((_ctx, error) => {
        clearTimeout(timer);
        reject(error);
      })
      .onDisconnect((_ctx, error) => {
        clearTimeout(timer);
        reject(error ?? new Error("disconnected"));
      });
    if (token) builder.withToken(token);
    builder.build();
  });
}

function subscribe(v: Visitor, queries: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    v.conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject(new Error(String((ctx as { event?: unknown }).event ?? "subscription failed"))))
      .subscribe(queries);
  });
}

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const names = (v: Visitor) => [...v.conn.db.peopleHere.iter()].map((r) => r.name).sort();

/**
 * The WebSocket checks go to --uri, but every admin call and SQL read goes
 * through the CLI's `-s local`, which the CLI config resolves on its own. If
 * the two disagree, the kicks, bans and floods below land on whatever server
 * `local` names -- and a fresh CLI config names 127.0.0.1:3000, which on a box
 * shared by several sessions may be somebody else's scratch database. So
 * refuse to start unless `local` is the server --uri points at.
 */
function requireCliMatchesUri(): void {
  const host = new URL(URI.replace(/^ws/, "http")).host;
  const listing = cli("server", "list").out;
  const local = listing.split("\n").find((line) => /\slocal\s*$/.test(line));
  if (!local || !local.includes(host)) {
    console.error(
      `module-check: the CLI's "local" server is not ${host}, so admin calls would go elsewhere.\n` +
        `  ${local?.trim() ?? "no local server in the CLI config"}\n` +
        `  fix: spacetime --config-path <cli.toml> server edit local --url http://${host}`,
    );
    process.exit(2);
  }
}

async function main(): Promise<void> {
  requireCliMatchesUri();
  // --- the admin allowlist is the publisher, from init ---
  const admins = cli("sql", "-s", "local", DB, "SELECT * FROM admin");
  const me = cli("login", "show");
  const myHex = /[0-9a-f]{64}/.exec(me.out)?.[0] ?? "?";
  check("init made the publisher admin", admins.out.includes(myHex), myHex.slice(0, 12));

  // --- per-room visibility ---
  const ann = await connect();
  const bob = await connect();
  const cat = await connect();
  await ann.conn.reducers.join({ name: "ann", room: "grove" });
  await bob.conn.reducers.join({ name: "bob", room: "einstruct" });
  await cat.conn.reducers.join({ name: "cat", room: "grove" });
  await subscribe(ann, ["SELECT * FROM people_here", "SELECT * FROM poses_here", "SELECT * FROM chat_here"]);
  await sleep(200);
  check("a visitor sees the people in their own room", JSON.stringify(names(ann)) === '["ann","cat"]', names(ann).join(","));

  await bob.conn.reducers.move({ x: 1, y: 0, z: -12, yaw: 0 });
  await cat.conn.reducers.move({ x: 2, y: 0, z: 3, yaw: 0 });
  await sleep(200);
  const poseOwners = [...ann.conn.db.posesHere.iter()].map((p) => p.identity.toHexString());
  check("...and only their poses", poseOwners.includes(cat.hex) && !poseOwners.includes(bob.hex));

  await sleep(750); // nobody speaks within 0.7 s of arriving
  await bob.conn.reducers.say({ text: "a secret in einstruct" });
  await sleep(750);
  await cat.conn.reducers.say({ text: "hi\u202Eevil\u200Bx\n\tthere" });
  await sleep(200);
  const heard = [...ann.conn.db.chatHere.iter()].map((c) => c.text);
  check("...and only what was said there", heard.length === 1, heard.join(" | "));
  check("chat is stripped of bidi overrides, zero-width and control characters", heard[0] === "hievilx there", JSON.stringify(heard[0]));

  await bob.conn.reducers.join({ name: "bob", room: "grove" });
  await sleep(200);
  check("walking into the room makes a visitor visible", names(ann).includes("bob"));
  await bob.conn.reducers.join({ name: "bob", room: "einstruct" });
  await sleep(200);
  check("...and walking out hides them again", !names(ann).includes("bob"));

  const outsider = cli("sql", "-s", "local", "--anonymous", DB, "SELECT * FROM visitor");
  check("the visitor table itself is closed to everyone but the owner", !outsider.ok && !/"ann"|"bob"|"cat"/.test(outsider.out));
  const peek = cli("sql", "-s", "local", "--anonymous", DB, "SELECT * FROM chat");
  check("...and so is the chat table", !peek.ok);

  // --- one visitor, two tabs ---
  const dave = await connect();
  const daveTab = await connect(dave.token);
  check("a second tab is the same visitor", daveTab.hex === dave.hex);
  await dave.conn.reducers.join({ name: "dave", room: "grove" });
  await sleep(200);
  daveTab.conn.disconnect();
  await sleep(300);
  check("closing one tab does not take a visitor offline", names(ann).includes("dave"));
  const daveTab2 = await connect(dave.token);
  await daveTab2.conn.reducers.leave({});
  await sleep(300);
  check("...nor does that tab saying goodbye", names(ann).includes("dave"));
  daveTab2.conn.disconnect();
  dave.conn.disconnect();
  await sleep(300);
  check("closing the last one does", !names(ann).includes("dave"));

  // --- the greenhouse is closed, and invisible from outside ---
  check("a guest cannot join the greenhouse", (await refusal(ann.conn.reducers.join({ name: "ann", room: "greenhouse" })))
    .includes("admin only"));
  const boss = await connect(publisherToken());
  await boss.conn.reducers.join({ name: "Manuel", room: "greenhouse" });
  await sleep(200);
  check("nobody outside sees who is in the greenhouse", !names(ann).includes("Manuel"));

  // --- poses ---
  check("a pose that is not a number is refused", (await refusal(cat.conn.reducers.move({ x: Number.NaN, y: 0, z: 0, yaw: 0 })))
    .includes("bad pose"));
  check("a pose outside the world is refused", (await refusal(cat.conn.reducers.move({ x: 1e6, y: 0, z: 0, yaw: 0 })))
    .includes("outside the world"));
  let updates = 0;
  const count = (_ctx: unknown, row: { identity: { toHexString(): string } }) => {
    if (row.identity.toHexString() === cat.hex) updates++;
  };
  ann.conn.db.posesHere.onUpdate((ctx, _old, row) => count(ctx, row));
  ann.conn.db.posesHere.onInsert(count);
  await sleep(1200); // let the bucket refill after the moves above
  const flood = Array.from({ length: 80 }, (_, i) => cat.conn.reducers.move({ x: i * 0.01, y: 0, z: 3, yaw: 0 }));
  await Promise.allSettled(flood);
  await sleep(800);
  check("a flood of 80 poses reaches others as at most a burst", updates <= 16, `${updates} broadcast`);

  // --- reports ---
  const r1 = await refusal(ann.conn.reducers.reportVisitor({ who: cat.identity, reason: "spamming the room" }));
  check("a visitor can report another", r1 === "", r1);
  const reports = cli("sql", "-s", "local", DB, "SELECT subject_name, reason, context FROM report");
  check("...and the report keeps their last lines of chat", reports.out.includes("cat: hievilx there"), reports.out.split("\n").slice(-1)[0]);
  check("reports are rate limited", (await refusal(ann.conn.reducers.reportVisitor({ who: cat.identity, reason: "again" })))
    .includes("30 seconds"));
  check("reports are private", !cli("sql", "-s", "local", "--anonymous", DB, "SELECT * FROM report").ok);

  // --- joining is renaming, and it is rate-limited like poses ---
  const joins: string[] = [];
  for (let i = 0; i < 14; i++) joins.push(await refusal(cat.conn.reducers.join({ name: `cat${i}`, room: "grove" })));
  check("a burst of joins and renames goes through", joins.slice(0, 8).every((a) => a === ""), joins.slice(0, 8).filter(Boolean).join(","));
  check("...a flood of them is cut off", joins.some((a) => a.includes("slow down")), `${joins.filter((a) => a.includes("slow down")).length} of 14 refused`);

  // --- kick and ban ---
  admin("kick", JSON.stringify(`0x${cat.hex}`));
  await sleep(200);
  check("a kick takes the visitor out of the room", !names(ann).includes("cat"));
  check("...and they cannot walk straight back in", (await refusal(cat.conn.reducers.join({ name: "cat", room: "grove" })))
    .includes("banned"));
  admin("ban_visitor", JSON.stringify(`0x${bob.hex}`), "0", '"test"', "false");
  check("a ban holds", (await refusal(bob.conn.reducers.join({ name: "bob", room: "grove" }))).includes("banned"));
  admin("unban", JSON.stringify(`0x${bob.hex}`));
  check("an unban lifts it", (await refusal(bob.conn.reducers.join({ name: "bob", room: "grove" }))) === "");
  check("an admin cannot be banned by mistake", admin("ban_visitor", JSON.stringify(`0x${boss.hex}`), "0", '"x"', "false").out.includes("cannot be banned"));

  // --- the scheduled sweep is not a public door ---
  check("a guest cannot run the sweep", (await refusal(ann.conn.reducers.sweepNow({}))).includes("admin only"));

  // --- what admins write into public tables is checked, not trusted ---
  // These reducers were safe while only the operator's home box called them.
  // Area admins and linked repositories end that, so the module cleans and
  // checks every visitor-facing string itself.
  const url = '"https://media.weichseltree.com/abc/still.png"';
  admin("upsert_tree", '"probe"', '"Does it hold?"', '"active"', '"thesis"', "5");
  check("hang takes a planet, the kind the Orrery's worlds hang as (#20)", admin("hang", '"probe"', '"planet"', '"t"', '"https://media.weichseltree.com/abc/bundle.json"', '""', '""').ok);
  check("hang refuses an exhibit kind the grove cannot show", admin("hang", '"probe"', '"splat"', '"t"', url, '""', '""').out.includes("kind must be one of"));
  check("hang refuses a media URL that is not https", admin("hang", '"probe"', '"still"', '"t"', '"javascript:alert(1)"', '""', '""').out.includes("url must be an https URL"));
  check("hang refuses a title that is only invisible characters", admin("hang", '"probe"', '"still"', '"\\u202e\\u200b"', url, '""', '""').out.includes("title is empty"));
  admin("hang", '"probe"', '"still"', '"evil\\u202etxt.exe"', url, '""', '""');
  const titles = cli("sql", "-s", "local", DB, "SELECT title FROM exhibit WHERE tree = 'probe'").out;
  check("...and strips a bidi override from one it keeps", titles.includes("eviltxt.exe") && !titles.includes("\u202e"));
  check("set_room refuses a room name that is not an id", admin("set_room", '"Bad Name"', '"T"', "false", "true", "24").out.includes("room name must be"));
  check("set_room refuses capacity 0, which would say 'room full' when it means shut", admin("set_room", '"shut"', '"T"', "false", "true", "0").out.includes("capacity must be"));
  check("upsert_tree refuses a potential above the scale", admin("upsert_tree", '"probe"', '"q"', '"active"', '"thesis"', "11").out.includes("potential must be"));

  // --- an admin can be removed, but never the last one ---
  check("a guest cannot remove an admin", (await refusal(ann.conn.reducers.removeAdmin({ who: boss.identity }))).includes("admin only"));
  check("remove_admin refuses someone who is not an admin", admin("remove_admin", JSON.stringify(`0x${ann.hex}`)).out.includes("not an admin"));
  admin("add_admin", JSON.stringify(`0x${ann.hex}`));
  check("remove_admin takes back a grant", admin("remove_admin", JSON.stringify(`0x${ann.hex}`)).ok && !cli("sql", "-s", "local", DB, "SELECT * FROM admin").out.includes(ann.hex));
  check("the last admin cannot be removed", admin("remove_admin", JSON.stringify(`0x${myHex}`)).out.includes("the last admin cannot be removed"));

  // --- areas: a linked repository's admins rule inside it, and nowhere else (SANDBOX-TRUST.md §1) ---
  const hex = (v: Visitor) => JSON.stringify(`0x${v.hex}`);
  admin("set_room", '"probe"', '"probe"', "false", "true", "24");
  check("a guest cannot link an area", (await refusal(ann.conn.reducers.linkArea({ tree: "probe", repo: "", commit: "", licence: "MIT" }))).includes("admin only"));
  check("an area must be a tree the database knows", admin("link_area", '"nosuch"', '""', '""', '"MIT"').out.includes("no such tree"));
  check("the licence gate: no redistributable licence, no link", admin("link_area", '"probe"', '""', '""', '"proprietary"').out.includes("licence must be")
    && admin("link_area", '"probe"', '""', '""', '""').out.includes("licence must be"));
  check("the host links an area", admin("link_area", '"probe"', '"https://example.com/probe.git"', '"abc1234"', '"MIT"').ok
    && cli("sql", "-s", "local", DB, "SELECT state FROM area WHERE tree = 'probe'").out.includes("draft"));
  check("a new area opens in an admin-only room: a visitor is turned away while it is a draft",
    (await refusal(bob.conn.reducers.join({ name: "bob", room: "probe" }))).includes("not open yet"));
  check("a guest cannot make themselves an area admin", (await refusal(ann.conn.reducers.addAreaAdmin({ tree: "probe", who: ann.identity }))).includes("admin of this area only"));
  admin("add_area_admin", '"probe"', hex(ann));
  check("...but the host can, and the area admin gets into the draft", (await refusal(ann.conn.reducers.join({ name: "ann", room: "probe" }))) === "");
  check("an area admin cannot open the area to the public", (await refusal(ann.conn.reducers.setAreaState({ tree: "probe", state: "live" }))).includes("host's call"));
  admin("set_area_state", '"probe"', '"live"');
  check("the host opens it, and a visitor gets in", (await refusal(bob.conn.reducers.join({ name: "bob", room: "probe" }))) === "");
  await ann.conn.reducers.areaMute({ tree: "probe", who: bob.identity, muted: true });
  check("an area admin's mute holds in the area", (await refusal(bob.conn.reducers.say({ text: "hello" }))).includes("muted"));
  await bob.conn.reducers.join({ name: "bob", room: "grove" });
  await sleep(1200);
  check("...and nowhere else", (await refusal(bob.conn.reducers.say({ text: "hello" }))) === "");
  await ann.conn.reducers.areaMute({ tree: "probe", who: bob.identity, muted: false });
  await ann.conn.reducers.areaBan({ tree: "probe", who: bob.identity, minutes: 0, reason: "test" });
  check("an area admin's ban keeps a visitor out of the area", (await refusal(bob.conn.reducers.join({ name: "bob", room: "probe" }))).includes("banned from this area"));
  check("...and out of nothing else", (await refusal(bob.conn.reducers.join({ name: "bob", room: "einstruct" }))) === "");
  await ann.conn.reducers.areaUnban({ tree: "probe", who: bob.identity });
  check("an area unban lifts it", (await refusal(bob.conn.reducers.join({ name: "bob", room: "probe" }))) === "");
  await ann.conn.reducers.areaKick({ tree: "probe", who: bob.identity });
  await sleep(200);
  check("an area kick takes the visitor out of the area's room", !names(ann).includes("bob"));
  check("an area admin cannot touch an admin of the world", (await refusal(ann.conn.reducers.areaBan({ tree: "probe", who: boss.identity, minutes: 0, reason: "x" }))).includes("cannot be sanctioned"));
  admin("upsert_tree", '"probe2"', '"q"', '"active"', '"thesis"', "5");
  admin("link_area", '"probe2"', '""', '""', '"MIT"');
  check("an area admin has no say in another area", (await refusal(ann.conn.reducers.setAreaState({ tree: "probe2", state: "paused" }))).includes("admin of this area only"));
  check("an area admin can pause their own area", (await refusal(ann.conn.reducers.setAreaState({ tree: "probe", state: "paused" }))) === "");
  const eve = await connect();
  check("...and nobody gets in while it is paused", (await refusal(eve.conn.reducers.join({ name: "eve", room: "probe" }))).includes("paused"));
  await ann.conn.reducers.setAreaState({ tree: "probe", state: "live" });
  admin("host_pause_area", '"probe"', "true");
  check("an area admin cannot resume out of a host pause", (await refusal(ann.conn.reducers.setAreaState({ tree: "probe", state: "live" }))).includes("paused by the host"));
  check("the area table is readable, its admins and sanctions are not",
    cli("sql", "-s", "local", "--anonymous", DB, "SELECT tree FROM area").ok
    && !cli("sql", "-s", "local", "--anonymous", DB, "SELECT * FROM area_admin").ok
    && !cli("sql", "-s", "local", "--anonymous", DB, "SELECT * FROM area_sanction").ok);
  admin("host_pause_area", '"probe"', "false");
  admin("set_area_state", '"probe"', '"live"');
  await eve.conn.reducers.join({ name: "eve", room: "probe" });
  await sleep(200);
  const standing = () => cli("sql", "-s", "local", DB, "SELECT * FROM whereabouts WHERE room = 'probe'").out;
  check("a visitor stands in the live area", standing().includes(eve.hex));
  await ann.conn.reducers.setAreaState({ tree: "probe", state: "paused" });
  await sleep(300);
  check("a pause puts whoever stands in the area out", !standing().includes(eve.hex));
  check("remove_tree refuses a tree whose area is linked", admin("remove_tree", '"probe"').out.includes("unlink the area first"));
  admin("unlink_area", '"probe"');
  check("unlinking takes the area's admins with it", !cli("sql", "-s", "local", DB, "SELECT * FROM area_admin WHERE tree = 'probe'").out.includes(ann.hex));
  check("...and shuts its room, so it is not an ordinary room afterwards", (await refusal(eve.conn.reducers.join({ name: "eve", room: "probe" }))).includes("room closed"));

  // --- the token gate and the per-network cap ---
  if (!AUTH) {
    console.log("skip  per-network checks (no --auth)");
  } else {
    admin("set_auth", JSON.stringify([AUTH]), "false");
    const home: Visitor[] = [];
    for (let i = 0; i < 9; i++) home.push(await connect(await groveToken("198.51.100.20")));
    const answers: string[] = [];
    for (const [i, v] of home.entries()) answers.push(await refusal(v.conn.reducers.join({ name: `home${i}`, room: "einstruct" })));
    check("eight people from one network get in", answers.slice(0, 8).every((a) => a === ""), answers.slice(0, 8).filter(Boolean).join(","));
    check("...the ninth is turned away", (answers[8] ?? "").includes("too many visitors from your network"), answers[8]);
    const away = await connect(await groveToken("203.0.113.99"));
    check("someone on another network still gets in", (await refusal(away.conn.reducers.join({ name: "away", room: "einstruct" }))) === "");

    admin("ban_visitor", JSON.stringify(`0x${home[0]!.hex}`), "60", '"network test"', "true");
    const again = await connect(await groveToken("198.51.100.20"));
    check("a network ban turns away a fresh identity from that network", (await refusal(again.conn.reducers.join({ name: "again", room: "einstruct" })))
      .includes("banned"));

    admin("set_auth", JSON.stringify([AUTH]), "true");
    const anonymous = await refusal(connect().then((v) => v.conn.reducers.join({ name: "anon", room: "grove" })));
    check("with the gate on, an anonymous visitor is refused", anonymous !== "", anonymous.slice(0, 60));
    const fresh = await connect(await groveToken("192.0.2.1"));
    check("...and a visitor with a grove token gets in", (await refusal(fresh.conn.reducers.join({ name: "fresh", room: "grove" }))) === "");
    check("...and the admin CLI still works", admin("sweep_now").ok);
    admin("set_auth", JSON.stringify([AUTH]), "false");
  }

  console.log(failures === 0 ? "\nevery rule held" : `\n${failures} rule(s) broken`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
