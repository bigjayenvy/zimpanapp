/* Delta sync.

   Pull:  everything touched since the client's watermark, tombstones included.
   Push:  last-write-wins upserts.

   MySQL has no `ON CONFLICT ... WHERE`, so each column guards itself with
   IF(VALUES(updated_at) >= updated_at, new, old). The ordering is load-bearing:
   MySQL evaluates ON DUPLICATE KEY UPDATE assignments left to right and later
   expressions observe columns already assigned in the same statement, so
   updated_at is assigned LAST. Move it up and every guard compares against the
   incoming value, always passes, and stale writes silently win.

   Validation rejects the whole request rather than dropping bad rows quietly —
   a sync endpoint that silently discards data is worse than one that errors. */

import { query, one, transaction, now } from './db.js';
import { membershipFor } from './teams.js';

class Invalid extends Error {}
const fail = (msg) => { throw new Invalid(msg); };

const str = (v, field, max, { allowEmpty = false } = {}) => {
  if (typeof v !== 'string') fail(`${field} must be a string`);
  const t = v.trim();
  if (!allowEmpty && !t) fail(`${field} must not be empty`);
  if (t.length > max) fail(`${field} must be ${max} characters or fewer`);
  return t;
};
const int = (v, field, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) fail(`${field} must be a whole number`);
  if (n < min || n > max) fail(`${field} must be between ${min} and ${max}`);
  return n;
};
/* Money, unlike minutes, is not a whole number. Anything finer than the minor
   unit is rounded rather than refused — a stray third decimal is not worth
   blocking a whole sync over. */
const cash = (v, field, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) fail(`${field} must be a number`);
  if (n < 0 || n > max) fail(`${field} must be between 0 and ${max}`);
  return Math.round(n * 100) / 100;
};
const bool = (v) => (v ? 1 : 0);
const isoDate = (v, field) => {
  const s = str(v, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(`${field} must look like YYYY-MM-DD`);
  return s;
};
const color = (v, field) => {
  const s = str(v, field, 32);
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) fail(`${field} must be a #rrggbb colour`);
  return s;
};
const stamp = (v, field) => int(v ?? now(), field, 0, 4102444800000);
const list = (v, field) => {
  if (v == null) return [];
  if (!Array.isArray(v)) fail(`${field} must be an array`);
  if (v.length > 5000) fail(`${field} carries too many rows in one request (max 5000)`);
  return v;
};

export const CURRENCIES = ['PHP', 'AED', 'USD', 'EUR', 'SGD', 'HKD'];
// Kept in step with TODO_STATUSES in app.js, which owns the labels and colours.
export const TODO_STATUSES = ['pending', 'doing', 'review', 'done', 'stuck'];

/* ── pull ── */

export async function changesSince(userId, since) {
  const [entries, money, categories, purposes, todos, user] = await Promise.all([
    query(`SELECT id, date, activity, category, project_id, from_min, to_min, note, updated_at, deleted
             FROM entries WHERE user_id = ? AND updated_at > ?`, [userId, since]),
    query(`SELECT id, date, activity, purpose, amount_in, amount_out, off_budget, note, updated_at, deleted
             FROM money_entries WHERE user_id = ? AND updated_at > ?`, [userId, since]),
    query(`SELECT name, color, position, updated_at, deleted
             FROM categories WHERE user_id = ? AND updated_at > ?`, [userId, since]),
    query(`SELECT name, color, position, updated_at, deleted
             FROM purposes WHERE user_id = ? AND updated_at > ?`, [userId, since]),
    query(`SELECT id, body, status, blocked, created_at, updated_at, deleted
             FROM todos WHERE user_id = ? AND updated_at > ?`, [userId, since]),
    one(`SELECT currency, weight_kg, sleep_min, steps_json, ai_cache_json, tracks_json,
                timer_start, timer_cat, timer_activity, display_name, updated_at
           FROM users WHERE id = ?`, [userId])
  ]);

  const named = (rows) => rows.map((r) => ({
    name: r.name, color: r.color, position: r.position,
    updatedAt: Number(r.updated_at), deleted: !!r.deleted
  }));

  return {
    entries: entries.map((r) => ({
      id: r.id, date: r.date, activity: r.activity, category: r.category,
      /* Sent only when there is one, like offBudget below: an absent field
         means a personal entry, which is what every row written before teams
         existed was. */
      project: r.project_id || undefined,
      from: r.from_min, to: r.to_min, note: r.note || '',
      updatedAt: Number(r.updated_at), deleted: !!r.deleted
    })),
    money: money.map((r) => ({
      id: r.id, date: r.date, activity: r.activity, purpose: r.purpose,
      in: Number(r.amount_in), out: Number(r.amount_out),
      /* Sent only when true. An absent field means "counts", which is what
         every row written before this column existed meant. */
      offBudget: r.off_budget ? true : undefined,
      note: r.note || '',
      updatedAt: Number(r.updated_at), deleted: !!r.deleted
    })),
    categories: named(categories),
    purposes: named(purposes),
    todos: todos.map((r) => ({
      id: r.id, text: r.body || '', status: r.status || 'pending',
      // Sent only when there is one, like offBudget and project above.
      blocked: r.blocked || undefined,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at), deleted: !!r.deleted
    })),
    currency: user && Number(user.updated_at) > since
      ? { value: user.currency, updatedAt: Number(user.updated_at) }
      : null,
    weightKg: user && Number(user.updated_at) > since
      ? { value: user.weight_kg == null ? null : Number(user.weight_kg), updatedAt: Number(user.updated_at) }
      : null,
    sleepMin: user && Number(user.updated_at) > since
      ? { value: user.sleep_min == null ? null : Number(user.sleep_min), updatedAt: Number(user.updated_at) }
      : null,
    name: user && Number(user.updated_at) > since
      ? { value: user.display_name || '', updatedAt: Number(user.updated_at) }
      : null,
    tracks: user && Number(user.updated_at) > since && user.tracks_json
      ? { value: typeof user.tracks_json === 'string' ? JSON.parse(user.tracks_json) : user.tracks_json,
          updatedAt: Number(user.updated_at) }
      : null,
    /* A timer is a fact about right now, so it is sent whole every time rather
       than filtered by `since`: a device that pulls after the timer started
       has to learn about it even if nothing else on the row has moved. */
    timer: user
      ? { start: user.timer_start == null ? null : Number(user.timer_start),
          category: user.timer_cat || '', activity: user.timer_activity || '',
          updatedAt: Number(user.updated_at) }
      : null,
    /* Sent whole rather than filtered by `since`: the map carries a stamp per
       date and the client merges on those, so it needs every day it has not
       seen, not only the days touched since it last asked. mysql2 hands back
       JSON already parsed on some versions and as a string on others. */
    steps: user && user.steps_json
      ? (typeof user.steps_json === 'string' ? JSON.parse(user.steps_json) : user.steps_json)
      : null,
    /* Sent whole, like steps and for the same reason: each entry carries its
       own stamp and the client merges on those, so it needs every key it has
       not seen rather than only those touched since it last asked. */
    aiCache: user && user.ai_cache_json
      ? (typeof user.ai_cache_json === 'string' ? JSON.parse(user.ai_cache_json) : user.ai_cache_json)
      : null
  };
}

/* ── push ── */

const guard = (col) => `${col} = IF(VALUES(updated_at) >= updated_at, VALUES(${col}), ${col})`;

const UPSERT_ENTRY = `
  INSERT INTO entries (user_id, id, team_id, date, activity, category, project_id, from_min, to_min, note, updated_at, deleted)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  ON DUPLICATE KEY UPDATE
    ${['team_id', 'date', 'activity', 'category', 'project_id', 'from_min', 'to_min', 'note', 'deleted'].map(guard).join(',\n    ')},
    updated_at = GREATEST(updated_at, VALUES(updated_at))`;

const UPSERT_MONEY = `
  INSERT INTO money_entries (user_id, id, date, activity, purpose, amount_in, amount_out, off_budget, note, updated_at, deleted)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)
  ON DUPLICATE KEY UPDATE
    ${['date', 'activity', 'purpose', 'amount_in', 'amount_out', 'off_budget', 'note', 'deleted'].map(guard).join(',\n    ')},
    updated_at = GREATEST(updated_at, VALUES(updated_at))`;

const UPSERT_TODO = `
  INSERT INTO todos (user_id, id, body, status, blocked, created_at, updated_at, deleted)
  VALUES (?,?,?,?,?,?,?,?)
  ON DUPLICATE KEY UPDATE
    ${['body', 'status', 'blocked', 'created_at', 'deleted'].map(guard).join(',\n    ')},
    updated_at = GREATEST(updated_at, VALUES(updated_at))`;

const upsertNamed = (table) => `
  INSERT INTO ${table} (user_id, name, color, position, updated_at, deleted)
  VALUES (?,?,?,?,?,?)
  ON DUPLICATE KEY UPDATE
    ${['color', 'position', 'deleted'].map(guard).join(',\n    ')},
    updated_at = GREATEST(updated_at, VALUES(updated_at))`;

/* Validates everything before touching the database, then applies the lot in a
   single transaction — a request either lands whole or not at all. */
export async function applyChanges(userId, changes) {
  const c = changes && typeof changes === 'object' ? changes : {};

  /* A tombstone only has to identify the row and say when it died — the client
     drops the body on delete, so the remaining columns are placeholders. They
     are never read: anything holding this row removes it on sight. */
  /* Which team this person is in, and which projects it owns — read from the
     server, never from the request. A client can say which project an hour
     belongs to; it cannot say which team it belongs to, and it cannot name a
     project that is not its team's. Both would be a way to write a row into
     somebody else's records. */
  const membership = await membershipFor(userId);
  const teamId = membership ? membership.teamId : null;
  const ownProjects = teamId
    ? new Set((await query('SELECT id FROM team_projects WHERE team_id = ? AND deleted = 0', [teamId])).map((r) => r.id))
    : new Set();

  const projectOf = (e, at) => {
    const p = e.project == null ? '' : String(e.project).trim();
    if (!p) return null;
    if (!teamId) throw new Invalid(`${at}.project: you are not in a team.`);
    if (!ownProjects.has(p)) throw new Invalid(`${at}.project: no such project on your team.`);
    return p;
  };

  const entries = list(c.entries, 'entries').map((e, i) => {
    const at = `entries[${i}]`;
    const id = str(e.id, `${at}.id`, 64);
    const when = stamp(e.updatedAt, `${at}.updatedAt`);
    if (e.deleted) return [userId, id, null, '1970-01-01', '', '', null, 0, 0, null, when, 1];
    const project = projectOf(e, at);
    return [userId, id, project ? teamId : null, isoDate(e.date, `${at}.date`),
      str(e.activity, `${at}.activity`, 200, { allowEmpty: true }),
      str(e.category, `${at}.category`, 60),
      project,
      int(e.from, `${at}.from`, 0, 1440), int(e.to, `${at}.to`, 0, 1440),
      str(e.note ?? '', `${at}.note`, 500, { allowEmpty: true }),
      when, 0];
  });

  const money = list(c.money, 'money').map((e, i) => {
    const at = `money[${i}]`;
    const id = str(e.id, `${at}.id`, 64);
    const when = stamp(e.updatedAt, `${at}.updatedAt`);
    if (e.deleted) return [userId, id, '1970-01-01', '', '', 0, 0, 0, null, when, 1];
    return [userId, id, isoDate(e.date, `${at}.date`),
      str(e.activity, `${at}.activity`, 200, { allowEmpty: true }),
      str(e.purpose, `${at}.purpose`, 60),
      cash(e.in ?? 0, `${at}.in`, 1e12), cash(e.out ?? 0, `${at}.out`, 1e12),
      e.offBudget ? 1 : 0,
      str(e.note ?? '', `${at}.note`, 500, { allowEmpty: true }),
      when, 0];
  });

  /* A note carries its own text and nothing else. The status is checked against
     the list rather than stored as sent: it is the one field the server reads
     back to every device, and an unknown value would paint a chip with no
     colour and no label on all of them. */
  const todos = list(c.todos, 'todos').map((t, i) => {
    const at = `todos[${i}]`;
    const id = str(t.id, `${at}.id`, 64);
    const when = stamp(t.updatedAt, `${at}.updatedAt`);
    if (t.deleted) return [userId, id, '', 'pending', null, 0, when, 1];
    const status = str(t.status ?? 'pending', `${at}.status`, 16);
    if (!TODO_STATUSES.includes(status)) fail(`${at}.status must be one of ${TODO_STATUSES.join(', ')}`);
    const blocked = t.blocked == null || t.blocked === ''
      ? null : str(t.blocked, `${at}.blocked`, 500);
    return [userId, id,
      str(t.text ?? '', `${at}.text`, 500, { allowEmpty: true }),
      status, blocked,
      stamp(t.createdAt, `${at}.createdAt`),
      when, 0];
  });

  const named = (key) => list(c[key], key).map((r, i) => {
    const at = `${key}[${i}]`;
    const name = str(r.name, `${at}.name`, 60);
    const when = stamp(r.updatedAt, `${at}.updatedAt`);
    if (r.deleted) return [userId, name, '#000000', 0, when, 1];
    return [userId, name, color(r.color, `${at}.color`),
      int(r.position ?? 0, `${at}.position`, 0, 10000), when, 0];
  });
  const categories = named('categories');
  const purposes = named('purposes');

  let currency = null;
  if (c.currency && typeof c.currency === 'object') {
    const value = str(c.currency.value, 'currency.value', 8);
    if (!CURRENCIES.includes(value)) fail(`currency.value must be one of ${CURRENCIES.join(', ')}`);
    currency = [value, stamp(c.currency.updatedAt, 'currency.updatedAt')];
  }

  /* Steps arrive as {date: {v, t}}. Validated key by key — this is the one
     payload the client can grow without bound, and a map of junk would be
     stored verbatim and handed back to every device. */
  let steps = null;
  if (c.steps && typeof c.steps === 'object' && !Array.isArray(c.steps)) {
    const clean = {};
    const keys = Object.keys(c.steps);
    if (keys.length > 3660) fail('steps carries more days than a decade');
    for (const key of keys) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) fail(`steps key ${key} is not a date`);
      const row = c.steps[key];
      if (!row || typeof row !== 'object') fail(`steps.${key} is not an object`);
      clean[key] = {
        v: int(row.v, `steps.${key}.v`, 0, 200000),
        t: stamp(row.t, `steps.${key}.t`)
      };
    }
    steps = clean;
  }

  /* The food cache: {textKey: {kcal, protein, carbs, fat, items, at}}. Like
     steps it is client-grown, so it is validated key by key and rebuilt rather
     than stored as sent — an unknown shape would otherwise be handed back to
     every device forever. Numbers are clamped, not trusted; items is a short
     list of {name, kcal}; anything else on the object is dropped. */
  let aiCache = null;
  if (c.aiCache && typeof c.aiCache === 'object' && !Array.isArray(c.aiCache)) {
    const clean = {};
    const keys = Object.keys(c.aiCache);
    if (keys.length > 400) fail('aiCache carries more meals than the ceiling');
    for (const key of keys) {
      if (typeof key !== 'string' || key.length > 64) fail('aiCache key is not a short string');
      const row = c.aiCache[key];
      if (!row || typeof row !== 'object') fail(`aiCache.${key} is not an object`);
      const items = Array.isArray(row.items)
        ? row.items.slice(0, 40).map((it, i) => ({
          name: str((it && it.name) ?? '', `aiCache.${key}.items[${i}].name`, 80, { allowEmpty: true }),
          kcal: int((it && it.kcal) ?? 0, `aiCache.${key}.items[${i}].kcal`, 0, 100000)
        }))
        : [];
      clean[key] = {
        kcal: int(row.kcal ?? 0, `aiCache.${key}.kcal`, 0, 100000),
        protein: int(row.protein ?? 0, `aiCache.${key}.protein`, 0, 100000),
        carbs: int(row.carbs ?? 0, `aiCache.${key}.carbs`, 0, 100000),
        fat: int(row.fat ?? 0, `aiCache.${key}.fat`, 0, 100000),
        items,
        at: stamp(row.at, `aiCache.${key}.at`)
      };
    }
    aiCache = clean;
  }

  let weight = null;
  if (c.weightKg && typeof c.weightKg === 'object') {
    const raw = c.weightKg.value;
    // Null clears it, which is how "prefer not to say" is expressed.
    const value = raw == null || raw === '' ? null : int(raw, 'weightKg.value', 20, 400);
    weight = [value, stamp(c.weightKg.updatedAt, 'weightKg.updatedAt')];
  }

  // Minutes since midnight, so 1439 is the last legal value. Null clears it
  // and puts the day's end back to the 10pm default.
  let sleep = null;
  if (c.sleepMin && typeof c.sleepMin === 'object') {
    const raw = c.sleepMin.value;
    const value = raw == null || raw === '' ? null : int(raw, 'sleepMin.value', 0, 1439);
    sleep = [value, stamp(c.sleepMin.updatedAt, 'sleepMin.updatedAt')];
  }

  let name = null;
  if (c.name && typeof c.name === 'object') {
    const raw = c.name.value;
    const value = raw == null || raw === '' ? null : str(raw, 'name.value', 120);
    name = [value, stamp(c.name.updatedAt, 'name.updatedAt')];
  }

  /* Four known booleans, rebuilt rather than stored as sent: an unknown key
     here would be handed back to every device forever. */
  let tracks = null;
  if (c.tracks && typeof c.tracks === 'object' && c.tracks.value && typeof c.tracks.value === 'object') {
    const v = c.tracks.value;
    tracks = [JSON.stringify({
      time: !!v.time, money: !!v.money, steps: !!v.steps, meals: !!v.meals
    }), stamp(c.tracks.updatedAt, 'tracks.updatedAt')];
  }

  /* The running timer. `start` null means it was stopped, which is a write
     worth making — that is how the other devices find out. */
  let timer = null;
  if (c.timer && typeof c.timer === 'object') {
    const raw = c.timer.start;
    const start = raw == null || raw === '' ? null : stamp(raw, 'timer.start');
    const cat = c.timer.category == null || c.timer.category === ''
      ? null : str(c.timer.category, 'timer.category', 60);
    const act = c.timer.activity == null || c.timer.activity === ''
      ? null : str(c.timer.activity, 'timer.activity', 200);
    timer = [start, cat, act, stamp(c.timer.updatedAt, 'timer.updatedAt')];
  }

  await transaction(async (conn) => {
    const run = async (sql, rows) => { for (const r of rows) await conn.execute(sql, r); };
    await run(UPSERT_ENTRY, entries);
    await run(UPSERT_MONEY, money);
    await run(upsertNamed('categories'), categories);
    await run(upsertNamed('purposes'), purposes);
    await run(UPSERT_TODO, todos);
    if (currency) {
      await conn.execute('UPDATE users SET currency = ?, updated_at = ? WHERE id = ? AND updated_at <= ?',
        [currency[0], currency[1], userId, currency[1]]);
    }
    if (weight) {
      await conn.execute('UPDATE users SET weight_kg = ?, updated_at = ? WHERE id = ? AND updated_at <= ?',
        [weight[0], weight[1], userId, weight[1]]);
    }
    if (sleep) {
      await conn.execute('UPDATE users SET sleep_min = ?, updated_at = ? WHERE id = ? AND updated_at <= ?',
        [sleep[0], sleep[1], userId, sleep[1]]);
    }
    if (name) {
      await conn.execute('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ? AND updated_at <= ?',
        [name[0], name[1], userId, name[1]]);
    }
    if (tracks) {
      await conn.execute('UPDATE users SET tracks_json = ?, updated_at = ? WHERE id = ? AND updated_at <= ?',
        [tracks[0], tracks[1], userId, tracks[1]]);
    }
    if (timer) {
      await conn.execute('UPDATE users SET timer_start = ?, timer_cat = ?, timer_activity = ?, updated_at = ? WHERE id = ? AND updated_at <= ?',
        [timer[0], timer[1], timer[2], timer[3], userId, timer[3]]);
    }
    /* Merged here rather than overwritten. A device only sends the days it
       knows about, so writing its map wholesale would erase any day recorded
       on another device that this one has not pulled yet — and with the outbox
       already clear, nothing would ever push it back. Locked for the read so
       two devices pushing at once cannot each merge onto the same stale copy. */
    /* Merged, not overwritten, exactly like steps: a device only knows the
       meals it refined, so writing its map wholesale would drop estimates made
       on another device. Newer stamp wins; the read is locked so two pushes
       cannot each merge onto the same stale copy. */
    if (aiCache) {
      const [[row]] = await conn.execute('SELECT ai_cache_json FROM users WHERE id = ? FOR UPDATE', [userId]);
      const held = row && row.ai_cache_json
        ? (typeof row.ai_cache_json === 'string' ? JSON.parse(row.ai_cache_json) : row.ai_cache_json)
        : {};
      const merged = Object.assign({}, held);
      for (const [key, incoming] of Object.entries(aiCache)) {
        const mine = merged[key];
        if (!mine || Number(incoming.at) > Number(mine.at)) merged[key] = incoming;
      }
      // Cap server-side too, oldest first, so the row cannot grow forever.
      const ks = Object.keys(merged);
      if (ks.length > 400) {
        ks.sort((a, b) => (merged[a].at || 0) - (merged[b].at || 0))
          .slice(0, ks.length - 400).forEach((k) => { delete merged[k]; });
      }
      await conn.execute('UPDATE users SET ai_cache_json = ?, updated_at = GREATEST(updated_at, ?) WHERE id = ?',
        [JSON.stringify(merged), Date.now(), userId]);
    }
    if (steps) {
      const [[row]] = await conn.execute('SELECT steps_json FROM users WHERE id = ? FOR UPDATE', [userId]);
      const held = row && row.steps_json
        ? (typeof row.steps_json === 'string' ? JSON.parse(row.steps_json) : row.steps_json)
        : {};
      const merged = Object.assign({}, held);
      for (const [date, incoming] of Object.entries(steps)) {
        const mine = merged[date];
        // Ties keep what is already stored; there is nothing to choose between them.
        if (!mine || Number(incoming.t) > Number(mine.t)) merged[date] = incoming;
      }
      await conn.execute('UPDATE users SET steps_json = ?, updated_at = GREATEST(updated_at, ?) WHERE id = ?',
        [JSON.stringify(merged), Date.now(), userId]);
    }
  });

  return { entries: entries.length, money: money.length, categories: categories.length, purposes: purposes.length, todos: todos.length };
}

export { Invalid };
