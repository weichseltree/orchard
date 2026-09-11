// orchard: world state for the grove (public) and the greenhouse (admin).
//
// Public tables are what every visitor's client subscribes to: rooms, who is
// here, where they stand, what they say, which trees exist and what hangs on
// them. Private tables (review queue, rulings, directives, ledger snapshots)
// are readable by the database owner only; the home box writes them with the
// owner token and the greenhouse client reads them with the same identity.
//
// Reducers enforce guest vs admin. Admin is an identity allowlist; the first
// caller of `bootstrapAdmin` on an empty allowlist becomes admin, so call it
// right after the first publish.
import {
  schema, table, t, SenderError,
  type InferSchema, type ReducerCtx,
} from 'spacetimedb/server';

const NAME_MAX = 24;
const CHAT_MAX = 280;
const CHAT_MIN_GAP_MICROS = 700_000n; // one message per 0.7 s per visitor

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
  { name: 'visitor', public: true },
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
  { name: 'pose', public: true },
  {
    identity: t.identity().primaryKey(),
    room: t.string().index('btree'),
    x: t.f32(), y: t.f32(), z: t.f32(),
    yaw: t.f32(),
    updated_at: t.timestamp(),
  }
);

const chat = table(
  { name: 'chat', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    room: t.string().index('btree'),
    sender: t.identity(),
    name: t.string(),
    text: t.string(),
    at: t.timestamp(),
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
    kind: t.string(),          // clip | still | master | tape
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

const spacetimedb = schema({
  admin, room, visitor, pose, chat, tree, exhibit, review_item, ruling, directive, snapshot,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

function isAdmin(ctx: Ctx): boolean {
  return ctx.db.admin.identity.find(ctx.sender) !== null;
}

function requireAdmin(ctx: Ctx) {
  if (!isAdmin(ctx)) throw new SenderError('admin only');
}

function cleanName(ctx: Ctx, raw: string): string {
  const s = raw.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, NAME_MAX);
  if (s.length >= 2) return s;
  const n = Math.floor(ctx.random() * 9000) + 1000;
  return `visitor-${n}`;
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

export const init = spacetimedb.init(ctx => {
  ctx.db.room.insert({ name: 'grove', title: 'The grove', admin_only: false, open: true, capacity: 24 });
  ctx.db.room.insert({ name: 'greenhouse', title: 'The greenhouse', admin_only: true, open: true, capacity: 4 });
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const v = ctx.db.visitor.identity.find(ctx.sender);
  if (v) ctx.db.visitor.identity.update({ ...v, online: false, last_seen: ctx.timestamp });
  if (ctx.db.pose.identity.find(ctx.sender)) ctx.db.pose.identity.delete(ctx.sender);
});

// --- everyone ---

export const bootstrapAdmin = spacetimedb.reducer(ctx => {
  if ([...ctx.db.admin.iter()].length > 0) throw new SenderError('admin already set');
  ctx.db.admin.insert({ identity: ctx.sender, added_at: ctx.timestamp });
});

export const join = spacetimedb.reducer(
  { name: t.string(), room: t.string() },
  (ctx, { name, room }) => {
    const r = roomOrThrow(ctx, room);
    const here = [...ctx.db.visitor.room.filter(room)].filter(v => v.online && !v.identity.equals(ctx.sender)).length;
    if (here >= r.capacity) throw new SenderError('room full');
    const existing = ctx.db.visitor.identity.find(ctx.sender);
    const row = {
      identity: ctx.sender,
      name: cleanName(ctx, name || existing?.name || ''),
      room,
      is_admin: isAdmin(ctx),
      online: true,
      muted: existing?.muted ?? false,
      last_seen: ctx.timestamp,
      last_said: existing?.last_said ?? ctx.timestamp,
    };
    if (existing) ctx.db.visitor.identity.update(row); else ctx.db.visitor.insert(row);
    const p = ctx.db.pose.identity.find(ctx.sender);
    if (p && p.room !== room) ctx.db.pose.identity.delete(ctx.sender);
  }
);

export const leave = spacetimedb.reducer(ctx => {
  const v = ctx.db.visitor.identity.find(ctx.sender);
  if (v) ctx.db.visitor.identity.update({ ...v, online: false, last_seen: ctx.timestamp });
  if (ctx.db.pose.identity.find(ctx.sender)) ctx.db.pose.identity.delete(ctx.sender);
});

export const move = spacetimedb.reducer(
  { x: t.f32(), y: t.f32(), z: t.f32(), yaw: t.f32() },
  (ctx, { x, y, z, yaw }) => {
    const v = online(ctx);
    const row = { identity: ctx.sender, room: v.room, x, y, z, yaw, updated_at: ctx.timestamp };
    if (ctx.db.pose.identity.find(ctx.sender)) ctx.db.pose.identity.update(row); else ctx.db.pose.insert(row);
  }
);

export const say = spacetimedb.reducer(
  { text: t.string() },
  (ctx, { text }) => {
    const v = online(ctx);
    if (v.muted) throw new SenderError('muted');
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!clean) return;
    if (ctx.timestamp.microsSinceUnixEpoch - v.last_said.microsSinceUnixEpoch < CHAT_MIN_GAP_MICROS) {
      throw new SenderError('slow down');
    }
    ctx.db.chat.insert({ id: 0n, room: v.room, sender: ctx.sender, name: v.name, text: clean, at: ctx.timestamp });
    ctx.db.visitor.identity.update({ ...v, last_said: ctx.timestamp });
  }
);

// --- admin: people and rooms ---

export const setRoom = spacetimedb.reducer(
  { name: t.string(), title: t.string(), admin_only: t.bool(), open: t.bool(), capacity: t.u32() },
  (ctx, { name, title, admin_only, open, capacity }) => {
    requireAdmin(ctx);
    const row = { name, title, admin_only, open, capacity };
    if (ctx.db.room.name.find(name)) ctx.db.room.name.update(row); else ctx.db.room.insert(row);
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

export const kick = spacetimedb.reducer(
  { who: t.identity() },
  (ctx, { who }) => {
    requireAdmin(ctx);
    const v = ctx.db.visitor.identity.find(who);
    if (v) ctx.db.visitor.identity.update({ ...v, online: false, room: '', last_seen: ctx.timestamp });
    if (ctx.db.pose.identity.find(who)) ctx.db.pose.identity.delete(who);
  }
);

export const addAdmin = spacetimedb.reducer(
  { who: t.identity() },
  (ctx, { who }) => {
    requireAdmin(ctx);
    if (!ctx.db.admin.identity.find(who)) ctx.db.admin.insert({ identity: who, added_at: ctx.timestamp });
  }
);

// --- admin: the harvest (written by the home box) ---

export const upsertTree = spacetimedb.reducer(
  { name: t.string(), question: t.string(), status: t.string(), stage: t.string(), potential: t.u8() },
  (ctx, { name, question, status, stage, potential }) => {
    requireAdmin(ctx);
    const row = { name, question, status, stage, potential, updated_at: ctx.timestamp };
    if (ctx.db.tree.name.find(name)) ctx.db.tree.name.update(row); else ctx.db.tree.insert(row);
  }
);

export const hang = spacetimedb.reducer(
  { tree: t.string(), kind: t.string(), title: t.string(), url: t.string(), thumb_url: t.string(), tape_url: t.string() },
  (ctx, { tree, kind, title, url, thumb_url, tape_url }) => {
    requireAdmin(ctx);
    if (!ctx.db.tree.name.find(tree)) throw new SenderError('no such tree');
    ctx.db.exhibit.insert({ id: 0n, tree, kind, title, url, thumb_url, tape_url, hung_at: ctx.timestamp });
  }
);

export const takeDown = spacetimedb.reducer(
  { id: t.u64() },
  (ctx, { id }) => {
    requireAdmin(ctx);
    if (ctx.db.exhibit.id.find(id)) ctx.db.exhibit.id.delete(id);
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
