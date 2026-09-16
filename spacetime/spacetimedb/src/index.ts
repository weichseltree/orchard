// orchard: world state for the grove (public) and the greenhouse (admin).
//
// Public tables are what anyone may read: rooms, which trees exist and what
// hangs on them. People (who is here, where they stand, what they say) are
// private tables that a visitor reads through three views, each scoped to the
// room the visitor is standing in (bottom of this file). The rest is private:
// the review queue, rulings, directives, ledger snapshots and the moderation
// tables (bans, reports, guests, throttles, settings), readable by the
// database owner only; the home box writes them with the owner token and the
// flat dashboard reads them with the same identity.
//
// Who may do what:
//
//  - Admin is an identity allowlist, seeded in `init` with whoever publishes.
//    `init` runs as the publisher on the first publish and after a
//    --delete-data republish, so there is no moment when the allowlist is
//    empty and a visitor could claim it.
//  - A visitor connects with a token from the grove's token service
//    (grove/functions/auth), which runs Cloudflare's human check and stamps a
//    keyed hash of the visitor's network address into the token (`ipk`). That
//    hash is what caps how many people one network can bring in at once and
//    what a network-wide ban matches. The gate is the `auth.required` setting
//    (`set_auth`); while it is off, plain anonymous identities still get in.
//  - What a visitor can read of other people (who, where, what they said) is
//    the room they are standing in, and nothing else. `admin_only` on a room
//    keeps people out; the views keep its presence and its chat from being
//    read from outside.
//
// Retention: chat 24 h, reports 90 days, a visitor's row 30 days after they
// were last seen. `sweep` runs every ten minutes and enforces it.
import {
  schema, table, t, SenderError,
  type InferSchema, type ReducerCtx,
} from 'spacetimedb/server';
import { ScheduleAt, Timestamp, type Identity } from 'spacetimedb';

const NAME_MAX = 24;
const CHAT_MAX = 280;
const REASON_MAX = 280;
// What the admin reducers write into public tables. These were once trusted
// because only the operator's home box called them; area admins and linked
// repositories make that untrue, so every visitor-facing string is cleaned
// and every identifier and URL is checked here, not by the caller.
const TITLE_MAX = 200;
const QUESTION_MAX = 400;
const LABEL_MAX = 32;
const URL_MAX = 2048;
const ROOM_CAPACITY_MAX = 200;
const POTENTIAL_MAX = 10;
const EXHIBIT_KINDS = ['clip', 'still', 'master', 'tape', 'planet'] as const;
const AREA_STATES = ['draft', 'live', 'paused'] as const;
const COMMIT_MAX = 64;
/**
 * The licence gate (SANDBOX-TRUST.md §5, ruling 7): a repository renders in
 * the world only under a licence that permits redistribution, named by its
 * SPDX identifier at link time. No licence means all rights reserved, which
 * is not enough to put someone's prose on a wall we serve.
 */
const LICENCES = [
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0',
  'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later',
  'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later',
  'AGPL-3.0-only', 'AGPL-3.0-or-later', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'Unlicense',
] as const;
/** Room and tree names: they are ids in URLs, presence strings and bundle paths. */
const IDENT = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
/**
 * An https URL with a host and nothing a browser would reinterpret. A regex
 * rather than `new URL`, which the module runtime is not promised to have.
 */
const HTTPS_URL = /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:\/[^\s\p{Cc}\p{Cf}]*)?$/u;

const SECOND = 1_000_000n;
const MINUTE = 60n * SECOND;
const HOUR = 60n * MINUTE;
const DAY = 24n * HOUR;

const CHAT_MIN_GAP = 700_000n;          // one message per 0.7 s per visitor
const REPORT_MIN_GAP = 30n * SECOND;     // one report per 30 s per visitor
const KICK_FOR = 10n * MINUTE;           // a kick is a short ban
const BAN_FOREVER = 100n * 365n * DAY;
const CHAT_KEEP = DAY;
// A broadcast is a moment, not a record. It is swept once it expires, and its
// ttl is capped so a cue cannot sit in the table forever waiting to fire at
// somebody who walks in next week.
const BROADCAST_TTL_MAX = 10n * MINUTE;
const BROADCAST_KINDS = ['cue', 'notice'] as const;
const CUE_MAX = 64;
const REPORT_KEEP = 90n * DAY;
const VISITOR_KEEP = 30n * DAY;
const SWEEP_EVERY = 10n * MINUTE;

// The client sends poses at 10 Hz while moving. The bucket lets 20 a second
// through with a burst of 10 for a stalled link catching up; past that a pose
// is dropped silently, never written and never broadcast.
const MOVE_RATE = 20;
const MOVE_BURST = 10;
// Joining is also how a visitor renames themselves, and every join is sent to
// everyone in the room: a burst of 10, then one every two seconds. Walking
// through doorways and fixing a typo in a name never come close.
const JOIN_RATE = 0.5;
const JOIN_BURST = 10;
// Every room of the mansion sits well inside this box; a pose outside it is
// not a visitor walking.
const WORLD_HALF_EXTENT_M = 500;
const WORLD_Y_MIN_M = -50;
const WORLD_Y_MAX_M = 100;

// How many people one network (one IPv4 address, one IPv6 /64) may have in the
// world at once. A school or a carrier NAT is several real people; a script is
// dozens.
const PER_NETWORK_ONLINE = 8;

// The grove's token service. Tokens carry this audience; the issuer list is a
// setting so a preview deployment or a local test can be added without a
// republish.
const DEFAULT_ISSUER = 'https://www.weichseltree.com/auth';
const AUDIENCE = 'orchard-grove';

const admin = table(
  { name: 'admin' },
  { identity: t.identity().primaryKey(), added_at: t.timestamp() }
);

const room = table(
  { name: 'room', public: true },
  {
    name: t.string().primaryKey(),
    title: t.string(),
    admin_only: t.bool(),
    open: t.bool(),
    capacity: t.u32(),
  }
);

const visitor = table(
  { name: 'visitor' },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    room: t.string().index('btree'),
    is_admin: t.bool(),
    online: t.bool(),
    muted: t.bool(),
    last_seen: t.timestamp(),
    last_said: t.timestamp(),
  }
);

const pose = table(
  { name: 'pose' },
  {
    identity: t.identity().primaryKey(),
    room: t.string().index('btree'),
    x: t.f32(), y: t.f32(), z: t.f32(),
    yaw: t.f32(),
    updated_at: t.timestamp(),
  }
);

const chat = table(
  { name: 'chat' },
  {
    id: t.u64().primaryKey().autoInc(),
    room: t.string().index('btree'),
    sender: t.identity(),
    name: t.string(),
    text: t.string(),
    at: t.timestamp(),
  }
);

/**
 * A world event every visitor sees: play a pre-fetched cue, or read a notice.
 *
 * Public, like `room`, `tree` and `exhibit`, and for the same reason -- there
 * is nothing private in an announcement meant for the room, and a public table
 * spares this a per-viewer view that would have to express "my room OR every
 * room" as a join.
 *
 * `cue` names something the client ALREADY HAS. The bytes of an animation are
 * a content-hashed bundle, cached forever; this row is the live trigger that
 * is never cached (PACKAGES.md, AUDIO-STREAM.md §1). The split is the existing
 * rule, not a new one.
 *
 * `expires_at` is load-bearing. A client that subscribes receives every row in
 * the table, so without expiry a visitor arriving at noon would replay every
 * cue fired that morning. The sweep deletes them and the client ignores what
 * it did not see arrive.
 */
const broadcast = table(
  { name: 'broadcast', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    /** 'cue' plays a pre-fetched animation; 'notice' is words to read. */
    kind: t.string(),
    /** Which pre-fetched thing to play; empty for a notice. */
    cue: t.string(),
    /** What a visitor reads; may accompany a cue. */
    text: t.string(),
    /** The room it is for; empty means every room. */
    room: t.string().index('btree'),
    at: t.timestamp(),
    expires_at: t.timestamp(),
  }
);

// Pushed by the home box from trees/*.yaml. What a visitor may know about a tree.
const tree = table(
  { name: 'tree', public: true },
  {
    name: t.string().primaryKey(),
    question: t.string(),
    status: t.string(),
    stage: t.string(),
    potential: t.u8(),
    updated_at: t.timestamp(),
  }
);

// What hangs on a tree in the grove. Only approved artefacts are ever hung.
const exhibit = table(
  { name: 'exhibit', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    tree: t.string().index('btree'),
    kind: t.string(),          // clip | still | master | tape | planet
    title: t.string(),
    url: t.string(),           // R2, media.weichseltree.com
    thumb_url: t.string(),
    tape_url: t.string(),      // empty unless walk-inside is available
    hung_at: t.timestamp(),
  }
);

// --- private: the greenhouse ---

const review_item = table(
  { name: 'review_item' },
  {
    id: t.u64().primaryKey().autoInc(),
    tree: t.string().index('btree'),
    thesis: t.string(),
    kind: t.string(),          // styleframe | animatic | cut | still | master
    title: t.string(),
    url: t.string(),
    note: t.string(),
    status: t.string().index('btree'),   // open | approved | changes | rejected
    created_at: t.timestamp(),
  }
);

const ruling = table(
  { name: 'ruling' },
  {
    id: t.u64().primaryKey().autoInc(),
    review_id: t.u64().index('btree'),
    verdict: t.string(),       // approved | changes | rejected | greenlit
    note: t.string(),
    by: t.identity(),
    at: t.timestamp(),
  }
);

const directive = table(
  { name: 'directive' },
  {
    id: t.u64().primaryKey().autoInc(),
    text: t.string(),
    active: t.bool().index('btree'),
    at: t.timestamp(),
  }
);

const snapshot = table(
  { name: 'snapshot' },
  { key: t.string().primaryKey(), json: t.string(), at: t.timestamp() }
);

// --- private: moderation ---

// One ban per identity. `network` is the banned guest's network key when the
// ban covers their whole network, else empty.
const ban = table(
  { name: 'ban' },
  {
    identity: t.identity().primaryKey(),
    network: t.string().index('btree'),
    until: t.timestamp(),
    reason: t.string(),
    by: t.identity(),
    at: t.timestamp(),
  }
);

// --- areas: a linked repository's place in the world, and its admins ---
//
// SANDBOX-TRUST.md §1, ruled 2026-09-16: the area and area_admin tables come
// before any generation. An area is a tree, and its presence room carries the
// tree's name, so `join` knows which area a room belongs to. `state` is the
// kill switch: `draft` admits the host and the area's admins only (every new
// area opens in an admin-only room), `live` everyone, `paused` the host
// alone. `host_paused` is the host's own pause, which an area admin cannot
// resume out of. An area admin is a row here, never an `admin` row: the
// grant is scoped to the area and the host drops it in one call.
const area = table(
  { name: 'area', public: true },
  {
    tree: t.string().primaryKey(),
    repo: t.string(),
    commit: t.string(),
    licence: t.string(),       // an SPDX identifier from LICENCES, checked at link time
    plan: t.string(),          // where the area's plan is served from; empty while it ships in the build
    state: t.string(),         // draft | live | paused
    host_paused: t.bool(),
    linked_by: t.identity(),
    linked_at: t.timestamp(),
    confirmed_at: t.timestamp(),
  }
);

const area_admin = table(
  { name: 'area_admin' },
  {
    id: t.u64().primaryKey().autoInc(),
    tree: t.string().index('btree'),
    identity: t.identity().index('btree'),
    added_by: t.identity(),
    added_at: t.timestamp(),
  }
);

// An area admin's moderation, scoped to their area: a mute and a ban (a kick
// is a short ban) that hold in that area's room and nowhere else, and never
// on an admin of the world. One row per area and identity.
const area_sanction = table(
  { name: 'area_sanction' },
  {
    key: t.string().primaryKey(),      // `<tree>:<identity hex>`
    tree: t.string().index('btree'),
    identity: t.identity().index('btree'),
    muted: t.bool(),
    until: t.timestamp(),              // the ban's end; EPOCH when there is none
    reason: t.string(),
    by: t.identity(),
    at: t.timestamp(),
  }
);

// Which room each online visitor is standing in: one row per online visitor,
// kept in step with `visitor` by join, leave, disconnect and kick. The views
// at the bottom start from the caller's row here.
const whereabouts = table(
  { name: 'whereabouts' },
  { identity: t.identity().primaryKey(), room: t.string().index('btree') }
);

// Open connections. One identity can hold several (two tabs, a phone and a
// headset); a visitor goes offline when the last one closes, not the first.
const connection = table(
  { name: 'connection' },
  {
    id: t.connectionId().primaryKey(),
    identity: t.identity().index('btree'),
    at: t.timestamp(),
  }
);

// A visitor who arrived with a grove token: the network key it carried.
const guest = table(
  { name: 'guest' },
  {
    identity: t.identity().primaryKey(),
    network: t.string().index('btree'),
    seen_at: t.timestamp(),
  }
);

const throttle = table(
  { name: 'throttle' },
  {
    identity: t.identity().primaryKey(),
    move_tokens: t.f64(),
    move_at: t.timestamp(),
    report_at: t.timestamp(),
  }
);

// Its own table rather than columns on `throttle`, so the upgrade only adds.
const join_throttle = table(
  { name: 'join_throttle' },
  { identity: t.identity().primaryKey(), tokens: t.f64(), at: t.timestamp() }
);

const report = table(
  { name: 'report' },
  {
    id: t.u64().primaryKey().autoInc(),
    reporter: t.identity(),
    subject: t.identity().index('btree'),
    subject_name: t.string(),
    room: t.string(),
    reason: t.string(),
    context: t.string(),       // the subject's last lines of chat in that room
    status: t.string().index('btree'),   // open | done
    at: t.timestamp(),
  }
);

// Plain key/value settings: `auth.issuers` (space-separated), `auth.required`.
const setting = table(
  { name: 'setting' },
  { key: t.string().primaryKey(), value: t.string() }
);

const sweep_timer = table(
  { name: 'sweep_timer', scheduled: (): any => sweep },
  { scheduled_id: t.u64().primaryKey().autoInc(), scheduled_at: t.scheduleAt() }
);

const spacetimedb = schema({
  admin, room, visitor, pose, chat, broadcast, tree, exhibit, review_item, ruling, directive, snapshot,
  ban, whereabouts, connection, guest, throttle, join_throttle, report, setting, sweep_timer,
  area, area_admin, area_sanction,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const EPOCH = new Timestamp(0n);

function micros(ts: Timestamp): bigint {
  return ts.microsSinceUnixEpoch;
}

function isAdminIdentity(ctx: Ctx, who: Identity): boolean {
  return ctx.db.admin.identity.find(who) !== null;
}

function isAdmin(ctx: Ctx): boolean {
  return isAdminIdentity(ctx, ctx.sender);
}

function requireAdmin(ctx: Ctx) {
  if (!isAdmin(ctx)) throw new SenderError('admin only');
}

/** At most `max` code points, so a cut never leaves half a surrogate pair. */
function clip(s: string, max: number): string {
  const points = Array.from(s);
  return points.length > max ? points.slice(0, max).join('') : s;
}

/**
 * Text a person typed, made safe to show another person: no control
 * characters, no invisible formatting (bidi overrides, zero-width spaces)
 * except the joiner inside emoji, whitespace collapsed.
 */
function cleanText(raw: string, max: number): string {
  const visible = raw.replace(/\p{Cf}/gu, c => (c === '‍' ? c : ''));
  return clip(visible.replace(/[\s\p{Cc}]+/gu, ' ').trim(), max);
}

function cleanName(ctx: Ctx, raw: string): string {
  const s = clip(raw.replace(/[^\p{L}\p{N} _.-]/gu, '').trim(), NAME_MAX).trim();
  if (s.length >= 2) return s;
  const n = Math.floor(ctx.random() * 9000) + 1000;
  return `visitor-${n}`;
}

function requireIdent(value: string, what: string): string {
  if (!IDENT.test(value)) {
    throw new SenderError(`${what} must be lowercase letters, digits and . _ -, at most 64`);
  }
  return value;
}

/** Visitor-facing text that must say something: cleaned, then refused if nothing is left. */
function requireText(raw: string, max: number, what: string): string {
  const clean = cleanText(raw, max);
  if (!clean) throw new SenderError(`${what} is empty`);
  return clean;
}

/** `optional` lets an empty string through as empty; anything else must be an https URL. */
function checkUrl(raw: string, what: string, optional: boolean): string {
  const s = raw.trim();
  if (s === '' && optional) return '';
  if (s.length > URL_MAX || !HTTPS_URL.test(s)) throw new SenderError(`${what} must be an https URL`);
  return s;
}

function roomOrThrow(ctx: Ctx, name: string) {
  const r = ctx.db.room.name.find(name);
  if (!r) throw new SenderError('no such room');
  if (!r.open) throw new SenderError('room closed');
  if (r.admin_only && !isAdmin(ctx)) throw new SenderError('admin only');
  return r;
}

function online(ctx: Ctx) {
  const v = ctx.db.visitor.identity.find(ctx.sender);
  if (!v || !v.online) throw new SenderError('join first');
  return v;
}

function authSettings(ctx: Ctx): { issuers: string[]; required: boolean } {
  const issuers = ctx.db.setting.key.find('auth.issuers')?.value.split(/\s+/).filter(Boolean);
  return {
    issuers: issuers && issuers.length > 0 ? issuers : [DEFAULT_ISSUER],
    required: ctx.db.setting.key.find('auth.required')?.value === 'true',
  };
}

function putSetting(ctx: Ctx, key: string, value: string) {
  if (ctx.db.setting.key.find(key)) ctx.db.setting.key.update({ key, value });
  else ctx.db.setting.insert({ key, value });
}

/** The network key from the caller's token, when the token is one of ours. */
function groveNetwork(ctx: Ctx): string | null {
  const jwt = ctx.senderAuth.jwt;
  if (!jwt) return null;
  if (!authSettings(ctx).issuers.includes(jwt.issuer)) return null;
  if (!jwt.audience.includes(AUDIENCE)) return null;
  const ipk = jwt.fullPayload['ipk'];
  return typeof ipk === 'string' ? ipk.slice(0, 64) : '';
}

function activeBan(ctx: Ctx, who: Identity) {
  const now = micros(ctx.timestamp);
  const own = ctx.db.ban.identity.find(who);
  if (own && micros(own.until) > now) return own;
  const network = ctx.db.guest.identity.find(who)?.network;
  if (!network) return null;
  for (const b of ctx.db.ban.network.filter(network)) {
    if (micros(b.until) > now) return b;
  }
  return null;
}

function onlineFromNetwork(ctx: Ctx, network: string): number {
  let n = 0;
  for (const g of ctx.db.guest.network.filter(network)) {
    if (g.identity.equals(ctx.sender)) continue;
    if (ctx.db.visitor.identity.find(g.identity)?.online) n++;
  }
  return n;
}

function setWhereabouts(ctx: Ctx, who: Identity, room: string | null) {
  const here = ctx.db.whereabouts.identity.find(who);
  if (room === null) {
    if (here) ctx.db.whereabouts.identity.delete(who);
  } else if (here) {
    if (here.room !== room) ctx.db.whereabouts.identity.update({ identity: who, room });
  } else {
    ctx.db.whereabouts.insert({ identity: who, room });
  }
}

function noteConnection(ctx: Ctx) {
  const id = ctx.connectionId;
  if (id && !ctx.db.connection.id.find(id)) ctx.db.connection.insert({ id, identity: ctx.sender, at: ctx.timestamp });
}

/** Out of the world now: offline, out of every room, no pose. */
function dropFromWorld(ctx: Ctx, who: Identity) {
  const v = ctx.db.visitor.identity.find(who);
  if (v) ctx.db.visitor.identity.update({ ...v, online: false, room: '', last_seen: ctx.timestamp });
  if (ctx.db.pose.identity.find(who)) ctx.db.pose.identity.delete(who);
  setWhereabouts(ctx, who, null);
}

function putBan(ctx: Ctx, who: Identity, forMicros: bigint, reason: string, wholeNetwork: boolean, keepLonger: boolean) {
  if (isAdminIdentity(ctx, who)) throw new SenderError('an admin cannot be banned; remove them from the allowlist first');
  const until = new Timestamp(micros(ctx.timestamp) + forMicros);
  const existing = ctx.db.ban.identity.find(who);
  if (existing && keepLonger && micros(existing.until) >= micros(until)) return;
  const network = wholeNetwork ? (ctx.db.guest.identity.find(who)?.network ?? '') : '';
  const row = { identity: who, network, until, reason: cleanText(reason, REASON_MAX), by: ctx.sender, at: ctx.timestamp };
  if (existing) ctx.db.ban.identity.update(row); else ctx.db.ban.insert(row);
}

function areaOrThrow(ctx: Ctx, tree: string) {
  const a = ctx.db.area.tree.find(tree);
  if (!a) throw new SenderError('no such area');
  return a;
}

function isAreaAdmin(ctx: Ctx, tree: string, who: Identity): boolean {
  for (const r of ctx.db.area_admin.tree.filter(tree)) if (r.identity.equals(who)) return true;
  return false;
}

/** The host first, an admin of this area second, nobody else; and the area must exist. */
function requireAreaAdmin(ctx: Ctx, tree: string) {
  areaOrThrow(ctx, tree);
  if (isAdmin(ctx) || isAreaAdmin(ctx, tree, ctx.sender)) return;
  throw new SenderError('admin of this area only');
}

function sanctionKey(tree: string, who: Identity): string {
  return `${tree}:${who.toHexString()}`;
}

function activeAreaBan(ctx: Ctx, tree: string, who: Identity) {
  const s = ctx.db.area_sanction.key.find(sanctionKey(tree, who));
  return s && micros(s.until) > micros(ctx.timestamp) ? s : null;
}

function areaMuted(ctx: Ctx, tree: string, who: Identity): boolean {
  return ctx.db.area_sanction.key.find(sanctionKey(tree, who))?.muted ?? false;
}

/**
 * Writes an area's sanction row for a visitor, keeping whatever the patch
 * leaves out; a row that neither mutes nor bans any more is dropped. An
 * admin of the world is never sanctioned in an area: the scope is the
 * whole point of the grant.
 */
function putAreaSanction(ctx: Ctx, tree: string, who: Identity, patch: { muted?: boolean; until?: Timestamp; reason?: string }) {
  if (isAdminIdentity(ctx, who)) throw new SenderError('an admin of the world cannot be sanctioned in an area');
  const key = sanctionKey(tree, who);
  const existing = ctx.db.area_sanction.key.find(key);
  const row = {
    key, tree, identity: who,
    muted: patch.muted ?? existing?.muted ?? false,
    until: patch.until ?? existing?.until ?? EPOCH,
    reason: patch.reason !== undefined ? cleanText(patch.reason, REASON_MAX) : (existing?.reason ?? ''),
    by: ctx.sender,
    at: ctx.timestamp,
  };
  if (!row.muted && micros(row.until) <= micros(ctx.timestamp)) {
    if (existing) ctx.db.area_sanction.key.delete(key);
    return;
  }
  if (existing) ctx.db.area_sanction.key.update(row); else ctx.db.area_sanction.insert(row);
}

/** Out of the area's room now, if that is where they stand; the rest of the world is not this admin's. */
function dropFromArea(ctx: Ctx, tree: string, who: Identity) {
  if (ctx.db.whereabouts.identity.find(who)?.room === tree) dropFromWorld(ctx, who);
}

/**
 * A pause or an unlink is a kill switch: whoever stands in the area's room
 * is put out of the world now, the host excepted, so nobody keeps seeing
 * what the switch withdrew. They may rejoin elsewhere at once.
 */
function evictArea(ctx: Ctx, tree: string) {
  for (const w of [...ctx.db.whereabouts.room.filter(tree)]) {
    if (!isAdminIdentity(ctx, w.identity)) dropFromWorld(ctx, w.identity);
  }
}

/** An admin acted, so the area is maintained (SANDBOX-TRUST.md §1.4: confirmation ages). */
function confirmArea(ctx: Ctx, tree: string) {
  const a = ctx.db.area.tree.find(tree);
  if (a) ctx.db.area.tree.update({ ...a, confirmed_at: ctx.timestamp });
}

function throttleRow(ctx: Ctx) {
  return ctx.db.throttle.identity.find(ctx.sender)
    ?? { identity: ctx.sender, move_tokens: MOVE_BURST, move_at: EPOCH, report_at: EPOCH };
}

function putThrottle(ctx: Ctx, row: ReturnType<typeof throttleRow>) {
  if (ctx.db.throttle.identity.find(ctx.sender)) ctx.db.throttle.identity.update(row);
  else ctx.db.throttle.insert(row);
}

/** Takes a token from the caller's pose bucket; false when it is empty. */
function spendMove(ctx: Ctx): boolean {
  const row = throttleRow(ctx);
  const elapsed = Number(micros(ctx.timestamp) - micros(row.move_at)) / 1e6;
  const tokens = Math.min(MOVE_BURST, row.move_tokens + Math.max(0, elapsed) * MOVE_RATE);
  // An empty bucket writes nothing: the refill is recomputed from the same
  // stored state next time, which is the same as having written it.
  if (tokens < 1) return false;
  putThrottle(ctx, { ...row, move_tokens: tokens - 1, move_at: ctx.timestamp });
  return true;
}

/** Takes a token from the caller's join bucket; false when it is empty. */
function spendJoin(ctx: Ctx): boolean {
  const row = ctx.db.join_throttle.identity.find(ctx.sender);
  const elapsed = row ? Number(micros(ctx.timestamp) - micros(row.at)) / 1e6 : 0;
  const tokens = row ? Math.min(JOIN_BURST, row.tokens + Math.max(0, elapsed) * JOIN_RATE) : JOIN_BURST;
  if (tokens < 1) return false;
  const next = { identity: ctx.sender, tokens: tokens - 1, at: ctx.timestamp };
  if (row) ctx.db.join_throttle.identity.update(next); else ctx.db.join_throttle.insert(next);
  return true;
}

function wrapAngle(a: number): number {
  const w = a % (Math.PI * 2);
  return w > Math.PI ? w - Math.PI * 2 : w < -Math.PI ? w + Math.PI * 2 : w;
}

function ensureSweep(ctx: Ctx) {
  if (!ctx.db.sweep_timer.iter().next().done) return;
  ctx.db.sweep_timer.insert({ scheduled_id: 0n, scheduled_at: ScheduleAt.interval(SWEEP_EVERY) });
}

/** Deletes what the retention rules say is past keeping. */
function sweepNowImpl(ctx: Ctx) {
  const now = micros(ctx.timestamp);
  for (const c of [...ctx.db.chat.iter()]) {
    if (now - micros(c.at) > CHAT_KEEP) ctx.db.chat.id.delete(c.id);
  }
  for (const r of [...ctx.db.report.iter()]) {
    if (now - micros(r.at) > REPORT_KEEP) ctx.db.report.id.delete(r.id);
  }
  // An expired broadcast is gone, not kept: the table is what a joining client
  // replays, so anything past its moment must not still be in it.
  for (const b of [...ctx.db.broadcast.iter()]) {
    if (micros(b.expires_at) <= now) ctx.db.broadcast.id.delete(b.id);
  }
  for (const b of [...ctx.db.ban.iter()]) {
    if (micros(b.until) <= now) ctx.db.ban.identity.delete(b.identity);
  }
  for (const s of [...ctx.db.area_sanction.iter()]) {
    if (!s.muted && micros(s.until) <= now) ctx.db.area_sanction.key.delete(s.key);
  }
  for (const v of [...ctx.db.visitor.iter()]) {
    if (v.online || now - micros(v.last_seen) <= VISITOR_KEEP) continue;
    ctx.db.visitor.identity.delete(v.identity);
    if (ctx.db.pose.identity.find(v.identity)) ctx.db.pose.identity.delete(v.identity);
  }
  // Guests and throttles outlive nobody: gone with the visitor row, or after
  // the same 30 days for a guest who connected and never joined.
  for (const g of [...ctx.db.guest.iter()]) {
    if (!ctx.db.visitor.identity.find(g.identity) && now - micros(g.seen_at) > VISITOR_KEEP) {
      ctx.db.guest.identity.delete(g.identity);
    }
  }
  // A connection the server never saw close (a crash, a restart) must not keep
  // a visitor online for ever.
  for (const c of [...ctx.db.connection.iter()]) {
    if (now - micros(c.at) > DAY) ctx.db.connection.id.delete(c.id);
  }
  for (const w of [...ctx.db.whereabouts.iter()]) {
    if (!ctx.db.visitor.identity.find(w.identity)?.online) ctx.db.whereabouts.identity.delete(w.identity);
  }
  for (const th of [...ctx.db.throttle.iter()]) {
    if (!ctx.db.visitor.identity.find(th.identity)) ctx.db.throttle.identity.delete(th.identity);
  }
  for (const j of [...ctx.db.join_throttle.iter()]) {
    if (!ctx.db.visitor.identity.find(j.identity)?.online) ctx.db.join_throttle.identity.delete(j.identity);
  }
}

/**
 * Every room a visitor can stand in, and what it is called.
 *
 * This is the server half of the client's mansion.json: each room there names
 * the presence room it joins, and joining one that is missing here is refused,
 * so a visitor walking in sees nobody and is seen by nobody. `init` seeds
 * these on a first publish and after a --delete-data republish; on a database
 * that is already live a new room is added with `set_room`, which is why
 * `pnpm check:rooms` compares this list against both mansion.json and the
 * live table before a deploy ships a room that exists on one side only.
 */
const SEED_ROOMS: ReadonlyArray<{
  name: string; title: string; admin_only: boolean; capacity: number;
}> = [
  { name: 'grove', title: 'The grove', admin_only: false, capacity: 24 },
  { name: 'greenhouse', title: 'The greenhouse', admin_only: true, capacity: 4 },
  { name: 'einstruct', title: 'The einstruct room', admin_only: false, capacity: 24 },
  { name: 'world-engine', title: 'The world-engine room', admin_only: false, capacity: 24 },
  { name: 'phototroph', title: 'The phototroph room', admin_only: false, capacity: 24 },
  { name: 'orangery', title: 'The orangery', admin_only: false, capacity: 24 },
  { name: 'gallery', title: 'The gallery', admin_only: false, capacity: 24 },
  { name: 'orrery', title: 'The Orrery', admin_only: false, capacity: 24 },
  { name: 'terrace', title: 'The Horizon Terrace', admin_only: false, capacity: 24 },
  { name: 'parterre', title: 'The Meridian Garden', admin_only: false, capacity: 24 },
  { name: 'orchard-west', title: 'The Western Grove', admin_only: false, capacity: 24 },
  { name: 'orchard-south', title: 'The Far Grove', admin_only: false, capacity: 24 },
  { name: 'orchard-east', title: 'The Eastern Grove', admin_only: false, capacity: 24 },
  { name: 'arcedit', title: 'arcedit', admin_only: false, capacity: 24 },
];

export const init = spacetimedb.init(ctx => {
  if (!ctx.db.admin.identity.find(ctx.sender)) ctx.db.admin.insert({ identity: ctx.sender, added_at: ctx.timestamp });
  for (const room of SEED_ROOMS) ctx.db.room.insert({ ...room, open: true });
  ensureSweep(ctx);
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  ensureSweep(ctx);
  // Admins pass with whatever token they hold: the CLI's, on the home box.
  if (isAdmin(ctx)) {
    noteConnection(ctx);
    return;
  }
  const network = groveNetwork(ctx);
  if (network === null && authSettings(ctx).required) throw new SenderError('connect through the grove');
  noteConnection(ctx);
  if (network === null) return;
  const row = { identity: ctx.sender, network, seen_at: ctx.timestamp };
  if (ctx.db.guest.identity.find(ctx.sender)) ctx.db.guest.identity.update(row); else ctx.db.guest.insert(row);
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  if (ctx.connectionId && ctx.db.connection.id.find(ctx.connectionId)) ctx.db.connection.id.delete(ctx.connectionId);
  // Another tab of the same visitor is still open: they are still here.
  if (!ctx.db.connection.identity.filter(ctx.sender).next().done) return;
  const v = ctx.db.visitor.identity.find(ctx.sender);
  if (v) ctx.db.visitor.identity.update({ ...v, online: false, last_seen: ctx.timestamp });
  if (ctx.db.pose.identity.find(ctx.sender)) ctx.db.pose.identity.delete(ctx.sender);
  setWhereabouts(ctx, ctx.sender, null);
});

// --- everyone ---

export const join = spacetimedb.reducer(
  { name: t.string(), room: t.string() },
  (ctx, { name, room }) => {
    const r = roomOrThrow(ctx, room);
    const admin = isAdmin(ctx);
    if (!admin) {
      if (activeBan(ctx, ctx.sender)) throw new SenderError('banned');
      const a = ctx.db.area.tree.find(room);
      if (a) {
        if (activeAreaBan(ctx, room, ctx.sender)) throw new SenderError('banned from this area');
        if (a.host_paused || a.state === 'paused') throw new SenderError('this area is paused');
        if (a.state === 'draft' && !isAreaAdmin(ctx, room, ctx.sender)) throw new SenderError('this area is not open yet');
      }
      if (!spendJoin(ctx)) throw new SenderError('slow down');
      const network = ctx.db.guest.identity.find(ctx.sender)?.network;
      if (network && onlineFromNetwork(ctx, network) >= PER_NETWORK_ONLINE) {
        throw new SenderError('too many visitors from your network');
      }
      const here = [...ctx.db.visitor.room.filter(room)].filter(v => v.online && !v.identity.equals(ctx.sender)).length;
      if (here >= r.capacity) throw new SenderError('room full');
    }
    const existing = ctx.db.visitor.identity.find(ctx.sender);
    const row = {
      identity: ctx.sender,
      name: cleanName(ctx, name || existing?.name || ''),
      room,
      is_admin: admin,
      online: true,
      muted: existing?.muted ?? false,
      last_seen: ctx.timestamp,
      last_said: existing?.last_said ?? ctx.timestamp,
    };
    if (existing) ctx.db.visitor.identity.update(row); else ctx.db.visitor.insert(row);
    setWhereabouts(ctx, ctx.sender, room);
    const p = ctx.db.pose.identity.find(ctx.sender);
    if (p && p.room !== room) ctx.db.pose.identity.delete(ctx.sender);
  }
);

export const leave = spacetimedb.reducer(ctx => {
  // A tab closing says goodbye; the visitor stays while another tab is open.
  for (const c of ctx.db.connection.identity.filter(ctx.sender)) {
    if (!ctx.connectionId || !c.id.isEqual(ctx.connectionId)) return;
  }
  const v = ctx.db.visitor.identity.find(ctx.sender);
  if (v) ctx.db.visitor.identity.update({ ...v, online: false, last_seen: ctx.timestamp });
  if (ctx.db.pose.identity.find(ctx.sender)) ctx.db.pose.identity.delete(ctx.sender);
  setWhereabouts(ctx, ctx.sender, null);
});

export const move = spacetimedb.reducer(
  { x: t.f32(), y: t.f32(), z: t.f32(), yaw: t.f32() },
  (ctx, { x, y, z, yaw }) => {
    const v = online(ctx);
    if (![x, y, z, yaw].every(Number.isFinite)) throw new SenderError('bad pose');
    if (Math.abs(x) > WORLD_HALF_EXTENT_M || Math.abs(z) > WORLD_HALF_EXTENT_M || y < WORLD_Y_MIN_M || y > WORLD_Y_MAX_M) {
      throw new SenderError('pose outside the world');
    }
    if (!spendMove(ctx)) return;
    const row = { identity: ctx.sender, room: v.room, x, y, z, yaw: wrapAngle(yaw), updated_at: ctx.timestamp };
    if (ctx.db.pose.identity.find(ctx.sender)) ctx.db.pose.identity.update(row); else ctx.db.pose.insert(row);
  }
);

export const say = spacetimedb.reducer(
  { text: t.string() },
  (ctx, { text }) => {
    const v = online(ctx);
    if (v.muted || areaMuted(ctx, v.room, ctx.sender)) throw new SenderError('muted');
    const clean = cleanText(text, CHAT_MAX);
    if (!clean) return;
    if (micros(ctx.timestamp) - micros(v.last_said) < CHAT_MIN_GAP) {
      throw new SenderError('slow down');
    }
    ctx.db.chat.insert({ id: 0n, room: v.room, sender: ctx.sender, name: v.name, text: clean, at: ctx.timestamp });
    ctx.db.visitor.identity.update({ ...v, last_said: ctx.timestamp });
  }
);

/** A visitor flags another for the admin. Kept 90 days, with their last lines of chat. */
export const reportVisitor = spacetimedb.reducer(
  { who: t.identity(), reason: t.string() },
  (ctx, { who, reason }) => {
    const me = online(ctx);
    if (who.equals(ctx.sender)) throw new SenderError('that is you');
    const subject = ctx.db.visitor.identity.find(who);
    if (!subject) throw new SenderError('no such visitor');
    const th = throttleRow(ctx);
    if (micros(ctx.timestamp) - micros(th.report_at) < REPORT_MIN_GAP) {
      throw new SenderError('one report every 30 seconds');
    }
    const lines = [...ctx.db.chat.room.filter(me.room)]
      .filter(c => c.sender.equals(who))
      .sort((a, b) => (micros(a.at) < micros(b.at) ? -1 : 1))
      .slice(-5)
      .map(c => `${c.name}: ${c.text}`);
    ctx.db.report.insert({
      id: 0n,
      reporter: ctx.sender,
      subject: who,
      subject_name: subject.name,
      room: me.room,
      reason: cleanText(reason, REASON_MAX),
      context: lines.join('\n'),
      status: 'open',
      at: ctx.timestamp,
    });
    putThrottle(ctx, { ...th, report_at: ctx.timestamp });
  }
);

// --- admin: people and rooms ---

export const setRoom = spacetimedb.reducer(
  { name: t.string(), title: t.string(), admin_only: t.bool(), open: t.bool(), capacity: t.u32() },
  (ctx, { name, title, admin_only, open, capacity }) => {
    requireAdmin(ctx);
    requireIdent(name, 'room name');
    // A room shut to everyone is `open: false`, not capacity 0, which would
    // refuse every join with "room full" and say nothing true about why.
    if (capacity < 1 || capacity > ROOM_CAPACITY_MAX) {
      throw new SenderError(`capacity must be 1 to ${ROOM_CAPACITY_MAX}`);
    }
    const row = { name, title: requireText(title, TITLE_MAX, 'room title'), admin_only, open, capacity };
    if (ctx.db.room.name.find(name)) ctx.db.room.name.update(row); else ctx.db.room.insert(row);
  }
);

/**
 * Fire a world event. Admin only, like every other thing that changes the
 * world out from under a visitor.
 *
 * `ttl_seconds` is how long this stays live for someone who arrives late; it
 * is clamped rather than refused, because a caller asking for an hour wants
 * the longest allowed, not an error. A room that does not exist IS refused --
 * a cue aimed at nowhere is a silent no-op, and silence is the one failure
 * that never gets noticed.
 */
export const sendBroadcast = spacetimedb.reducer(
  { kind: t.string(), cue: t.string(), text: t.string(), room: t.string(), ttl_seconds: t.u32() },
  (ctx, { kind, cue, text, room, ttl_seconds }) => {
    requireAdmin(ctx);
    if (!(BROADCAST_KINDS as readonly string[]).includes(kind)) {
      throw new SenderError(`kind must be one of ${BROADCAST_KINDS.join(', ')}`);
    }
    // Empty means every room; anything else must be a room that exists.
    if (room && !ctx.db.room.name.find(room)) throw new SenderError('no such room');
    const cleanCue = clip(cue.trim(), CUE_MAX);
    if (kind === 'cue' && !cleanCue) throw new SenderError('a cue names what to play');
    const cleaned = cleanText(text, CHAT_MAX);
    if (kind === 'notice' && !cleaned) throw new SenderError('a notice carries words');
    const asked = ttl_seconds > 0 ? BigInt(ttl_seconds) * SECOND : BROADCAST_TTL_MAX;
    const ttl = asked > BROADCAST_TTL_MAX ? BROADCAST_TTL_MAX : asked;
    ctx.db.broadcast.insert({
      id: 0n, kind, cue: cleanCue, text: cleaned, room,
      at: ctx.timestamp,
      expires_at: new Timestamp(micros(ctx.timestamp) + ttl),
    });
  }
);

export const mute = spacetimedb.reducer(
  { who: t.identity(), muted: t.bool() },
  (ctx, { who, muted }) => {
    requireAdmin(ctx);
    const v = ctx.db.visitor.identity.find(who);
    if (v) ctx.db.visitor.identity.update({ ...v, muted });
  }
);

/** Out now, and back in no sooner than ten minutes. A longer ban stays as it is. */
export const kick = spacetimedb.reducer(
  { who: t.identity() },
  (ctx, { who }) => {
    requireAdmin(ctx);
    putBan(ctx, who, KICK_FOR, 'kicked', false, true);
    dropFromWorld(ctx, who);
  }
);

/** `minutes` 0 is for good; `network` bans every identity from the same network too. */
export const banVisitor = spacetimedb.reducer(
  { who: t.identity(), minutes: t.u32(), reason: t.string(), network: t.bool() },
  (ctx, { who, minutes, reason, network }) => {
    requireAdmin(ctx);
    putBan(ctx, who, minutes === 0 ? BAN_FOREVER : BigInt(minutes) * MINUTE, reason, network, false);
    dropFromWorld(ctx, who);
  }
);

export const unban = spacetimedb.reducer(
  { who: t.identity() },
  (ctx, { who }) => {
    requireAdmin(ctx);
    if (ctx.db.ban.identity.find(who)) ctx.db.ban.identity.delete(who);
  }
);

export const resolveReport = spacetimedb.reducer(
  { id: t.u64() },
  (ctx, { id }) => {
    requireAdmin(ctx);
    const r = ctx.db.report.id.find(id);
    if (r) ctx.db.report.id.update({ ...r, status: 'done' });
  }
);

export const addAdmin = spacetimedb.reducer(
  { who: t.identity() },
  (ctx, { who }) => {
    requireAdmin(ctx);
    if (!ctx.db.admin.identity.find(who)) ctx.db.admin.insert({ identity: who, added_at: ctx.timestamp });
  }
);

/**
 * The undo of `add_admin`, which until now had none: a mistaken grant was
 * permanent short of a --delete-data republish. Any admin may remove any
 * other, as any admin may add one.
 *
 * The last admin cannot be removed. `init` only seeds the allowlist on a
 * first publish, so a database with no admin left could never be administered
 * again from inside the module -- not its rooms, not its bans, not this.
 */
export const removeAdmin = spacetimedb.reducer(
  { who: t.identity() },
  (ctx, { who }) => {
    requireAdmin(ctx);
    if (!ctx.db.admin.identity.find(who)) throw new SenderError('not an admin');
    let admins = 0;
    for (const _ of ctx.db.admin.iter()) admins++;
    if (admins <= 1) throw new SenderError('the last admin cannot be removed');
    ctx.db.admin.identity.delete(who);
  }
);

/**
 * The token gate. `issuers` are the token services whose tokens count as a
 * grove visitor's; `required` turns anonymous connections away.
 */
export const setAuth = spacetimedb.reducer(
  { issuers: t.array(t.string()), required: t.bool() },
  (ctx, { issuers, required }) => {
    requireAdmin(ctx);
    const list = issuers.map(s => s.trim()).filter(Boolean);
    if (list.some(s => /\s/.test(s))) throw new SenderError('an issuer is a URL, no spaces');
    putSetting(ctx, 'auth.issuers', list.join(' '));
    putSetting(ctx, 'auth.required', String(required));
  }
);

export const sweep = spacetimedb.reducer(
  { timer: sweep_timer.rowType },
  ctx => {
    if (!ctx.senderAuth.isInternal) throw new SenderError('the scheduler runs this; admins call sweep_now');
    sweepNowImpl(ctx);
  }
);

export const sweepNow = spacetimedb.reducer(ctx => {
  requireAdmin(ctx);
  ensureSweep(ctx);
  sweepNowImpl(ctx);
});

// --- admin: the harvest (written by the home box) ---

export const upsertTree = spacetimedb.reducer(
  { name: t.string(), question: t.string(), status: t.string(), stage: t.string(), potential: t.u8() },
  (ctx, { name, question, status, stage, potential }) => {
    requireAdmin(ctx);
    requireIdent(name, 'tree name');
    if (potential > POTENTIAL_MAX) throw new SenderError(`potential must be 0 to ${POTENTIAL_MAX}`);
    const row = {
      name,
      question: cleanText(question, QUESTION_MAX),
      status: requireText(status, LABEL_MAX, 'status'),
      stage: requireText(stage, LABEL_MAX, 'stage'),
      potential,
      updated_at: ctx.timestamp,
    };
    if (ctx.db.tree.name.find(name)) ctx.db.tree.name.update(row); else ctx.db.tree.insert(row);
  }
);

export const removeTree = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    requireAdmin(ctx);
    // A linked area is not removed by the way: unlinking it is a ruling of its own (SANDBOX-TRUST.md §1.4).
    if (ctx.db.area.tree.find(name)) throw new SenderError('unlink the area first');
    for (const e of [...ctx.db.exhibit.tree.filter(name)]) ctx.db.exhibit.id.delete(e.id);
    if (ctx.db.tree.name.find(name)) ctx.db.tree.name.delete(name);
  }
);

export const hang = spacetimedb.reducer(
  { tree: t.string(), kind: t.string(), title: t.string(), url: t.string(), thumb_url: t.string(), tape_url: t.string() },
  (ctx, { tree, kind, title, url, thumb_url, tape_url }) => {
    requireAdmin(ctx);
    if (!ctx.db.tree.name.find(tree)) throw new SenderError('no such tree');
    if (!(EXHIBIT_KINDS as readonly string[]).includes(kind)) {
      throw new SenderError(`kind must be one of ${EXHIBIT_KINDS.join(', ')}`);
    }
    ctx.db.exhibit.insert({
      id: 0n,
      tree,
      kind,
      title: requireText(title, TITLE_MAX, 'title'),
      url: checkUrl(url, 'url', false),
      thumb_url: checkUrl(thumb_url, 'thumb_url', true),
      tape_url: checkUrl(tape_url, 'tape_url', true),
      hung_at: ctx.timestamp,
    });
  }
);

export const takeDown = spacetimedb.reducer(
  { id: t.u64() },
  (ctx, { id }) => {
    requireAdmin(ctx);
    if (ctx.db.exhibit.id.find(id)) ctx.db.exhibit.id.delete(id);
  }
);

// --- areas (SANDBOX-TRUST.md §1; every reducer checks the host first and the area's membership second) ---

/**
 * The host links a repository as an area, under a licence that permits
 * redistribution; relinking updates its repo, commit and licence and keeps
 * its state.
 */
export const linkArea = spacetimedb.reducer(
  { tree: t.string(), repo: t.string(), commit: t.string(), licence: t.string() },
  (ctx, { tree, repo, commit, licence }) => {
    requireAdmin(ctx);
    requireIdent(tree, 'tree');
    if (!ctx.db.tree.name.find(tree)) throw new SenderError('no such tree');
    if (!(LICENCES as readonly string[]).includes(licence)) {
      throw new SenderError(`licence must be one that permits redistribution: ${LICENCES.join(', ')}`);
    }
    const existing = ctx.db.area.tree.find(tree);
    const clean = { repo: checkUrl(repo, 'repo', true), commit: cleanText(commit, COMMIT_MAX), licence };
    if (existing) {
      ctx.db.area.tree.update({ ...existing, ...clean, confirmed_at: ctx.timestamp });
      return;
    }
    ctx.db.area.insert({
      tree, ...clean, plan: '', state: 'draft', host_paused: false,
      linked_by: ctx.sender, linked_at: ctx.timestamp, confirmed_at: ctx.timestamp,
    });
  }
);

/**
 * Unlinking takes the area's admins and sanctions with it and closes its
 * room: the room row stays, shut, so `join` keeps refusing it and the client
 * keeps its door locked; whoever stands in it is put out. The tree row stays.
 */
export const unlinkArea = spacetimedb.reducer(
  { tree: t.string() },
  (ctx, { tree }) => {
    requireAdmin(ctx);
    areaOrThrow(ctx, tree);
    for (const r of [...ctx.db.area_admin.tree.filter(tree)]) ctx.db.area_admin.id.delete(r.id);
    for (const s of [...ctx.db.area_sanction.tree.filter(tree)]) ctx.db.area_sanction.key.delete(s.key);
    ctx.db.area.tree.delete(tree);
    const room = ctx.db.room.name.find(tree);
    if (room) ctx.db.room.name.update({ ...room, open: false });
    evictArea(ctx, tree);
  }
);

/**
 * The host sets any state. An admin of the area pauses and resumes it, and
 * that is all: opening an area out of `draft` is the host's call, and a host
 * pause is not theirs to lift.
 */
export const setAreaState = spacetimedb.reducer(
  { tree: t.string(), state: t.string() },
  (ctx, { tree, state }) => {
    requireAreaAdmin(ctx, tree);
    const a = areaOrThrow(ctx, tree);
    if (!(AREA_STATES as readonly string[]).includes(state)) {
      throw new SenderError(`state must be one of ${AREA_STATES.join(', ')}`);
    }
    if (!isAdmin(ctx)) {
      if (a.state === 'draft' || state === 'draft') throw new SenderError("opening an area is the host's call");
      if (a.host_paused) throw new SenderError('paused by the host');
    }
    ctx.db.area.tree.update({ ...a, state, confirmed_at: ctx.timestamp });
    if (state === 'paused') evictArea(ctx, tree);
  }
);

export const hostPauseArea = spacetimedb.reducer(
  { tree: t.string(), paused: t.bool() },
  (ctx, { tree, paused }) => {
    requireAdmin(ctx);
    ctx.db.area.tree.update({ ...areaOrThrow(ctx, tree), host_paused: paused });
    if (paused) evictArea(ctx, tree);
  }
);

export const addAreaAdmin = spacetimedb.reducer(
  { tree: t.string(), who: t.identity() },
  (ctx, { tree, who }) => {
    requireAreaAdmin(ctx, tree);
    if (!isAreaAdmin(ctx, tree, who)) {
      ctx.db.area_admin.insert({ id: 0n, tree, identity: who, added_by: ctx.sender, added_at: ctx.timestamp });
    }
    confirmArea(ctx, tree);
  }
);

export const dropAreaAdmin = spacetimedb.reducer(
  { tree: t.string(), who: t.identity() },
  (ctx, { tree, who }) => {
    requireAreaAdmin(ctx, tree);
    for (const r of [...ctx.db.area_admin.tree.filter(tree)]) if (r.identity.equals(who)) ctx.db.area_admin.id.delete(r.id);
    confirmArea(ctx, tree);
  }
);

export const areaMute = spacetimedb.reducer(
  { tree: t.string(), who: t.identity(), muted: t.bool() },
  (ctx, { tree, who, muted }) => {
    requireAreaAdmin(ctx, tree);
    putAreaSanction(ctx, tree, who, { muted });
    confirmArea(ctx, tree);
  }
);

/** Out of the area's room now, and not back in for ten minutes; a longer ban stays as it is. */
export const areaKick = spacetimedb.reducer(
  { tree: t.string(), who: t.identity() },
  (ctx, { tree, who }) => {
    requireAreaAdmin(ctx, tree);
    const until = new Timestamp(micros(ctx.timestamp) + KICK_FOR);
    const longer = activeAreaBan(ctx, tree, who);
    putAreaSanction(ctx, tree, who, { until: longer && micros(longer.until) >= micros(until) ? longer.until : until, reason: 'kicked' });
    dropFromArea(ctx, tree, who);
    confirmArea(ctx, tree);
  }
);

/** `minutes` 0 is for good. The ban holds in this area's room and nowhere else. */
export const areaBan = spacetimedb.reducer(
  { tree: t.string(), who: t.identity(), minutes: t.u32(), reason: t.string() },
  (ctx, { tree, who, minutes, reason }) => {
    requireAreaAdmin(ctx, tree);
    const until = new Timestamp(micros(ctx.timestamp) + (minutes === 0 ? BAN_FOREVER : BigInt(minutes) * MINUTE));
    putAreaSanction(ctx, tree, who, { until, reason });
    dropFromArea(ctx, tree, who);
    confirmArea(ctx, tree);
  }
);

export const areaUnban = spacetimedb.reducer(
  { tree: t.string(), who: t.identity() },
  (ctx, { tree, who }) => {
    requireAreaAdmin(ctx, tree);
    if (ctx.db.area_sanction.key.find(sanctionKey(tree, who))) putAreaSanction(ctx, tree, who, { until: EPOCH, reason: '' });
    confirmArea(ctx, tree);
  }
);

// --- admin: the greenhouse ---

export const submitReview = spacetimedb.reducer(
  { tree: t.string(), thesis: t.string(), kind: t.string(), title: t.string(), url: t.string(), note: t.string() },
  (ctx, { tree, thesis, kind, title, url, note }) => {
    requireAdmin(ctx);
    ctx.db.review_item.insert({ id: 0n, tree, thesis, kind, title, url, note, status: 'open', created_at: ctx.timestamp });
  }
);

export const rule = spacetimedb.reducer(
  { review_id: t.u64(), verdict: t.string(), note: t.string() },
  (ctx, { review_id, verdict, note }) => {
    requireAdmin(ctx);
    const item = ctx.db.review_item.id.find(review_id);
    if (!item) throw new SenderError('no such review item');
    if (!['approved', 'changes', 'rejected', 'greenlit'].includes(verdict)) throw new SenderError('bad verdict');
    ctx.db.ruling.insert({ id: 0n, review_id, verdict, note, by: ctx.sender, at: ctx.timestamp });
    ctx.db.review_item.id.update({ ...item, status: verdict === 'greenlit' ? 'approved' : verdict });
  }
);

export const setDirective = spacetimedb.reducer(
  { text: t.string() },
  (ctx, { text }) => {
    requireAdmin(ctx);
    const clean = text.trim();
    if (!clean) throw new SenderError('empty directive');
    ctx.db.directive.insert({ id: 0n, text: clean, active: true, at: ctx.timestamp });
  }
);

export const retireDirective = spacetimedb.reducer(
  { id: t.u64() },
  (ctx, { id }) => {
    requireAdmin(ctx);
    const d = ctx.db.directive.id.find(id);
    if (d) ctx.db.directive.id.update({ ...d, active: false });
  }
);

export const putSnapshot = spacetimedb.reducer(
  { key: t.string(), json: t.string() },
  (ctx, { key, json }) => {
    requireAdmin(ctx);
    const row = { key, json, at: ctx.timestamp };
    if (ctx.db.snapshot.key.find(key)) ctx.db.snapshot.key.update(row); else ctx.db.snapshot.insert(row);
  }
);

// --- what a visitor can read of other people ---
//
// Only the people online in the room you are online in, where they stand, and
// what was said there. These are query views: SpacetimeDB keeps each viewer's
// copy up to date incrementally, like any subscription, and walking through a
// doorway swaps one room's rows for the next. (Row-level filters cannot say
// this: a filter on `pose` that joins a filtered `visitor` is refused.) The
// owner reads the tables themselves.

export const peopleHere = spacetimedb.view(
  { name: 'people_here', public: true },
  t.array(visitor.rowType),
  ctx => ctx.from.whereabouts
    .where(w => w.identity.eq(ctx.sender))
    .rightSemijoin(ctx.from.visitor, (w, v) => w.room.eq(v.room))
    .where(v => v.online.eq(true))
);

export const posesHere = spacetimedb.view(
  { name: 'poses_here', public: true },
  t.array(pose.rowType),
  ctx => ctx.from.whereabouts
    .where(w => w.identity.eq(ctx.sender))
    .rightSemijoin(ctx.from.pose, (w, p) => w.room.eq(p.room))
);

export const chatHere = spacetimedb.view(
  { name: 'chat_here', public: true },
  t.array(chat.rowType),
  ctx => ctx.from.whereabouts
    .where(w => w.identity.eq(ctx.sender))
    .rightSemijoin(ctx.from.chat, (w, c) => w.room.eq(c.room))
);
