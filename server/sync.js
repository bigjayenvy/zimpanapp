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

export const CURRENCIES = ['PHP', 'AED', 'USD', 'EUR'];

/* ── pull ── */

export async function changesSince(userId, since) {
  const [entries, money, categories, purposes, user] = await Promise.all([
    query(`SELECT id, date, activity, category, from_min, to_min, note, updated_at, deleted
             FROM entries WHERE user_id = ? AND updated_at > ?`, [userId, since]),
    query(`SELECT id, date, activity, purpose, amount_in, amount_out, note, updated_at, deleted
             FROM money_entries WHERE user_id = ? AND updated_at > ?`, [userId, since]),
    query(`SELECT name, color, position, updated_at, deleted
             FROM categories WHERE user_id = ? AND updated_at > ?`, [userId, since]),
    query(`SELECT name, color, position, updated_at, deleted
             FROM purposes WHERE user_id = ? AND updated_at > ?`, [userId, since]),
    one('SELECT currency, updated_at FROM users WHERE id = ?', [userId])
  ]);

  const named = (rows) => rows.map((r) => ({
    name: r.name, color: r.color, position: r.position,
    updatedAt: Number(r.updated_at), deleted: !!r.deleted
  }));

  return {
    entries: entries.map((r) => ({
      id: r.id, date: r.date, activity: r.activity, category: r.category,
      from: r.from_min, to: r.to_min, note: r.note || '',
      updatedAt: Number(r.updated_at), deleted: !!r.deleted
    })),
    money: money.map((r) => ({
      id: r.id, date: r.date, activity: r.activity, purpose: r.purpose,
      in: Number(r.amount_in), out: Number(r.amount_out), note: r.note || '',
      updatedAt: Number(r.updated_at), deleted: !!r.deleted
    })),
    categories: named(categories),
    purposes: named(purposes),
    currency: user && Number(user.updated_at) > since
      ? { value: user.currency, updatedAt: Number(user.updated_at) }
      : null
  };
}

/* ── push ── */

const guard = (col) => `${col} = IF(VALUES(updated_at) >= updated_at, VALUES(${col}), ${col})`;

const UPSERT_ENTRY = `
  INSERT INTO entries (user_id, id, date, activity, category, from_min, to_min, note, updated_at, deleted)
  VALUES (?,?,?,?,?,?,?,?,?,?)
  ON DUPLICATE KEY UPDATE
    ${['date', 'activity', 'category', 'from_min', 'to_min', 'note', 'deleted'].map(guard).join(',\n    ')},
    updated_at = GREATEST(updated_at, VALUES(updated_at))`;

const UPSERT_MONEY = `
  INSERT INTO money_entries (user_id, id, date, activity, purpose, amount_in, amount_out, note, updated_at, deleted)
  VALUES (?,?,?,?,?,?,?,?,?,?)
  ON DUPLICATE KEY UPDATE
    ${['date', 'activity', 'purpose', 'amount_in', 'amount_out', 'note', 'deleted'].map(guard).join(',\n    ')},
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
  const entries = list(c.entries, 'entries').map((e, i) => {
    const at = `entries[${i}]`;
    const id = str(e.id, `${at}.id`, 64);
    const when = stamp(e.updatedAt, `${at}.updatedAt`);
    if (e.deleted) return [userId, id, '1970-01-01', '', '', 0, 0, null, when, 1];
    return [userId, id, isoDate(e.date, `${at}.date`),
      str(e.activity, `${at}.activity`, 200, { allowEmpty: true }),
      str(e.category, `${at}.category`, 60),
      int(e.from, `${at}.from`, 0, 1440), int(e.to, `${at}.to`, 0, 1440),
      str(e.note ?? '', `${at}.note`, 500, { allowEmpty: true }),
      when, 0];
  });

  const money = list(c.money, 'money').map((e, i) => {
    const at = `money[${i}]`;
    const id = str(e.id, `${at}.id`, 64);
    const when = stamp(e.updatedAt, `${at}.updatedAt`);
    if (e.deleted) return [userId, id, '1970-01-01', '', '', 0, 0, null, when, 1];
    return [userId, id, isoDate(e.date, `${at}.date`),
      str(e.activity, `${at}.activity`, 200, { allowEmpty: true }),
      str(e.purpose, `${at}.purpose`, 60),
      int(e.in ?? 0, `${at}.in`, 0, 1e12), int(e.out ?? 0, `${at}.out`, 0, 1e12),
      str(e.note ?? '', `${at}.note`, 500, { allowEmpty: true }),
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

  await transaction(async (conn) => {
    const run = async (sql, rows) => { for (const r of rows) await conn.execute(sql, r); };
    await run(UPSERT_ENTRY, entries);
    await run(UPSERT_MONEY, money);
    await run(upsertNamed('categories'), categories);
    await run(upsertNamed('purposes'), purposes);
    if (currency) {
      await conn.execute('UPDATE users SET currency = ?, updated_at = ? WHERE id = ? AND updated_at <= ?',
        [currency[0], currency[1], userId, currency[1]]);
    }
  });

  return { entries: entries.length, money: money.length, categories: categories.length, purposes: purposes.length };
}

export { Invalid };
