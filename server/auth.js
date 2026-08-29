/* Passwords and sessions, both on Node's crypto — no bcrypt dependency.

   Passwords use scrypt, which is memory-hard and deliberately slow. The stored
   string carries its own parameters so the cost can be raised later without
   invalidating existing hashes.

   Sessions are opaque random tokens. Only the SHA-256 of a token is stored, so
   a leaked database still does not hand over usable sessions. */

import crypto from 'node:crypto';
import { query, one, now } from './db.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, key] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(key, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length,
      { N: Number(N), r: Number(r), p: Number(p) });
    // Constant-time: a length-sensitive compare would leak information.
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = now() + SESSION_MS;
  await query('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    [tokenHash(token), userId, now(), expiresAt]);
  return { token, expiresAt };
}

export async function userForToken(token) {
  if (!token) return null;
  const row = await one(`
    SELECT u.id, u.email, u.currency, u.role, u.kind, u.last_seen_at, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`, [tokenHash(token)]);
  if (!row) return null;
  if (Number(row.expires_at) < now()) { await destroySession(token); return null; }
  // role rides along on every authenticated request, so the admin routes never
  // need a second query to find out whether they are allowed to answer.
  return {
    id: row.id, email: row.email, currency: row.currency,
    /* Rides along on every authenticated request for the same reason role
       does: the team routes decide on it, and none of them should need a
       second query to find out which product the caller belongs to. */
    role: row.role || 'user', kind: row.kind || 'personal', lastSeenAt: row.last_seen_at
  };
}

export async function destroySession(token) {
  if (token) await query('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);
}

export async function purgeExpiredSessions() {
  await query('DELETE FROM sessions WHERE expires_at < ?', [now()]);
}

/* ── request plumbing ── */

export function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

export const COOKIE = 'zimpan_session';

export function setSessionCookie(res, token, expiresAt, secure) {
  res.setHeader('Set-Cookie', [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Expires=${new Date(expiresAt).toUTCString()}`
  ].filter(Boolean).join('; '));
}

export function clearSessionCookie(res, secure) {
  res.setHeader('Set-Cookie', [
    `${COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ].filter(Boolean).join('; '));
}

/* Fixed-window limiter, in memory. Passenger may run more than one worker, in
   which case each holds its own counter and the effective limit multiplies —
   acceptable for Stellar's process ceiling, but it belongs in the database if
   this ever scales out. */
const hits = new Map();

/* Returns { ok } or { ok: false, retryAfterMs } so callers can tell the user
   how long to wait rather than leaving them guessing. */
export function rateLimit({ key, limit, windowMs }) {
  const t = now();
  const rec = hits.get(key);
  if (!rec || t > rec.reset) { hits.set(key, { count: 1, reset: t + windowMs }); return { ok: true }; }
  if (rec.count >= limit) return { ok: false, retryAfterMs: Math.max(0, rec.reset - t) };
  rec.count += 1;
  return { ok: true };
}

export function retryLabel(ms) {
  const minutes = Math.ceil(ms / 60000);
  if (minutes <= 1) return 'in a minute';
  if (minutes < 60) return `in ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? 'in an hour' : `in ${hours} hours`;
}

// Keeps the limiter map from growing without bound on a long-running process.
setInterval(() => {
  const t = now();
  for (const [k, v] of hits) if (t > v.reset) hits.delete(k);
  purgeExpiredSessions().catch((err) => console.error('[zimpan] session purge failed', err));
}, 10 * 60 * 1000).unref();
