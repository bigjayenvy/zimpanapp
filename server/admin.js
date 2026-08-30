/* The admin dashboard's data.

   Deliberately narrow about what it can see. This is a personal life-tracking
   app: an admin can find out that someone signed up, whether they are still
   using it, how much they have logged and whether they have given money. An
   admin cannot read a single thing anybody wrote. No activity names, no notes,
   no categories, no amounts — nothing in here selects them, so no bug in a page
   can leak them.

   Two roles. `manager` reads; `superadmin` also writes. The distinction is
   enforced at the route rather than in the page, because a read-only role that
   only hides its buttons is not read-only.

   Timestamps are milliseconds throughout, matching the rest of the schema, so
   every date expression divides by a thousand before MySQL sees it. */

import { query, one, now } from './db.js';

export const ROLES = ['user', 'manager', 'superadmin'];
export const isAdminRole = (role) => role === 'manager' || role === 'superadmin';

const DAY = 24 * 60 * 60 * 1000;

/* Activity, taken from when rows were last written rather than from a counter.

   `last_seen_at` says when someone last synced, but only the most recent time —
   it cannot answer "how many people were active in March". The write timestamps
   on the log itself can, and they mean something stronger anyway: not that the
   app was open, but that something was actually recorded. */
const ACTIVE_DAYS = `
  SELECT d, COUNT(DISTINCT user_id) AS n FROM (
    SELECT user_id, DATE(FROM_UNIXTIME(updated_at / 1000)) AS d
      FROM entries WHERE updated_at >= ?
    UNION ALL
    SELECT user_id, DATE(FROM_UNIXTIME(updated_at / 1000)) AS d
      FROM money_entries WHERE updated_at >= ?
  ) x GROUP BY d ORDER BY d`;

export async function overview() {
  const t = now();
  const since30 = t - 30 * DAY;

  const totals = await one(`
    SELECT
      (SELECT COUNT(*) FROM users)                                          AS users,
      (SELECT COUNT(*) FROM users WHERE last_seen_at >= ?)                  AS active_week,
      (SELECT COUNT(*) FROM users WHERE last_seen_at >= ?)                  AS active_month,
      (SELECT COUNT(*) FROM users WHERE last_seen_at IS NULL)               AS never_synced,
      (SELECT COUNT(*) FROM users WHERE created_at >= ?)                    AS new_month,
      (SELECT COUNT(*) FROM users WHERE donate_clicks > 0)                  AS clickers,
      (SELECT COUNT(*) FROM users WHERE google_sub IS NOT NULL)             AS google,
      (SELECT COUNT(*) FROM entries WHERE deleted = 0)                      AS entries,
      (SELECT COUNT(*) FROM money_entries WHERE deleted = 0)                AS money,
      (SELECT COUNT(DISTINCT user_id) FROM donations)                       AS donors,
      (SELECT COUNT(*) FROM donations)                                      AS donations,
      (SELECT COALESCE(SUM(amount), 0) FROM donations)                      AS donated`,
    [t - 7 * DAY, since30, since30]);

  const signups = await query(`
    SELECT DATE_FORMAT(FROM_UNIXTIME(created_at / 1000), '%Y-%m') AS m, COUNT(*) AS n
      FROM users GROUP BY m ORDER BY m DESC LIMIT 12`);

  const active = await query(ACTIVE_DAYS, [since30, since30]);

  const donations = await query(`
    SELECT DATE_FORMAT(FROM_UNIXTIME(received_at / 1000), '%Y-%m') AS m,
           COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
      FROM donations GROUP BY m ORDER BY m DESC LIMIT 12`);

  const recent = await query(`
    SELECT d.id, d.amount, d.currency, d.received_at, d.note, u.email
      FROM donations d JOIN users u ON u.id = d.user_id
     ORDER BY d.received_at DESC LIMIT 10`);

  return {
    totals,
    // Oldest first for drawing; the queries take the newest so the limit works.
    signups: signups.reverse(),
    active,
    donations: donations.reverse(),
    recent
  };
}

const SORTS = {
  recent: 'u.created_at DESC',
  oldest: 'u.created_at ASC',
  active: 'u.last_seen_at IS NULL, u.last_seen_at DESC',
  quiet: 'u.last_seen_at IS NULL DESC, u.last_seen_at ASC',
  entries: 'entries DESC',
  donated: 'donated DESC, u.created_at DESC',
  email: 'u.email ASC'
};

/* Counts and dates only. Every column here is metadata about an account; not
   one of them is content. `days` is how many distinct dates carry an entry,
   which is the honest measure of a habit — a hundred entries on one afternoon
   is not the same as a hundred across a month. */
export async function users({ q = '', sort = 'recent', limit = 50, offset = 0 }) {
  const order = SORTS[sort] || SORTS.recent;
  /* Interpolated rather than bound. LIMIT and OFFSET are the two placeholders
     prepared statements handle inconsistently across MySQL and MariaDB, and
     these are integers this file clamps itself — there is no user string
     anywhere near them. */
  const take = Math.min(200, Math.max(1, Math.floor(Number(limit)) || 50));
  const skip = Math.max(0, Math.floor(Number(offset)) || 0);
  const like = `%${q}%`;
  /* Searching by team name as well as by address: an admin looking into a
     subscription has the team's name off a PayPal note far more often than
     they have the email of whoever owns it. */
  const where = q ? 'WHERE (u.email LIKE ? OR t.name LIKE ?)' : '';
  const params = q ? [like, like] : [];

  const rows = await query(`
    SELECT u.id, u.email, u.role, u.kind, u.created_at, u.last_seen_at,
           u.donate_clicks, u.donated_click_at,
           u.google_sub IS NOT NULL AS google,
           u.password_hash IS NOT NULL AS has_password,
           tm.role AS team_role, t.id AS team_id, t.name AS team_name, t.plan AS team_plan,
           (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND e.deleted = 0)        AS entries,
           (SELECT COUNT(DISTINCT e.date) FROM entries e WHERE e.user_id = u.id AND e.deleted = 0) AS days,
           (SELECT COUNT(*) FROM money_entries m WHERE m.user_id = u.id AND m.deleted = 0)  AS money,
           (SELECT COUNT(*) FROM donations d WHERE d.user_id = u.id)                        AS donations,
           (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.user_id = u.id)      AS donated
      FROM users u
      LEFT JOIN team_members tm ON tm.user_id = u.id
      LEFT JOIN teams t ON t.id = tm.team_id
      ${where}
     ORDER BY ${order}
     LIMIT ${take} OFFSET ${skip}`, params);

  const count = await one(`
    SELECT COUNT(*) AS n FROM users u
    LEFT JOIN team_members tm ON tm.user_id = u.id
    LEFT JOIN teams t ON t.id = tm.team_id
    ${where}`, params);
  return { rows, total: Number(count.n) };
}

export async function donationsFor(userId) {
  return query(`
    SELECT d.id, d.amount, d.currency, d.received_at, d.note, a.email AS recorded_by
      FROM donations d LEFT JOIN users a ON a.id = d.recorded_by
     WHERE d.user_id = ? ORDER BY d.received_at DESC`, [userId]);
}

/* Promotion and demotion both live here, and both refuse to touch the account
   doing the asking. An admin who can demote themselves can lock the last
   superadmin out of the dashboard with one misplaced click, and there is no way
   back in from the outside. */
export async function setRole(actorId, targetEmail, role) {
  if (!ROLES.includes(role)) throw new Error('Unknown role.');
  const target = await one('SELECT id, email, role FROM users WHERE email = ?', [String(targetEmail).trim().toLowerCase()]);
  if (!target) throw new Error('No account with that address.');
  if (Number(target.id) === Number(actorId)) throw new Error('You cannot change your own role.');

  /* The last superadmin cannot be demoted. Nothing else in the system can
     create one — the seed only runs for the configured address — so losing the
     last one means editing the database by hand to get back in. */
  if (target.role === 'superadmin' && role !== 'superadmin') {
    const left = await one("SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin'");
    if (Number(left.n) <= 1) throw new Error('That is the only superadmin left. Promote another one first.');
  }

  await query('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [role, now(), target.id]);
  return { email: target.email, role };
}

/* ── deleting an account ──

   The only irreversible thing in this file, so it is the most guarded. Every
   row a person owns is removed with them: entries, money, categories,
   purposes, sessions, donations and team membership all cascade from the users
   row, so there is nothing left behind and nothing to sweep up later.

   Four refusals, each for something that cannot be undone by clicking again:

   - Yourself. Deleting the account you are signed in as ends the session that
     was doing it, mid-request.
   - Any superadmin. Nothing in the system creates one except the seed for the
     configured address, so removing one can mean editing the database by hand
     to get back in. Demote it first and the intent is at least deliberate.
   - The owner of a team that still has other people in it. Their membership
     would cascade away and leave a team nobody owns, with members still
     logging into it. Move ownership or clear the team first.
   - A mismatched confirmation. The caller has to send the address as well as
     the id, and they have to agree. An id alone is one wrong row in a table;
     an address is a thing you have to have read.

   A team whose last member is being deleted goes with them, since a team with
   nobody in it is not something anyone can reach or repair. */
export async function deleteAccount(actorId, targetId, confirmEmail) {
  const id = Number(targetId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('No such account.');
  if (id === Number(actorId)) throw new Error('You cannot delete the account you are signed in as.');

  const target = await one('SELECT id, email, role FROM users WHERE id = ?', [id]);
  if (!target) throw new Error('No such account.');

  const typed = String(confirmEmail || '').trim().toLowerCase();
  if (!typed || typed !== String(target.email).toLowerCase()) {
    throw new Error('Type the account’s email address to confirm.');
  }
  if (target.role === 'superadmin') {
    throw new Error('That is a superadmin. Change the role to user first, so deleting it is a decision of its own.');
  }

  const member = await one('SELECT team_id AS teamId, role FROM team_members WHERE user_id = ?', [id]);
  let teamRemoved = null;
  if (member) {
    const left = await one('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?', [member.teamId]);
    const others = Number(left.n) - 1;
    if (member.role === 'super' && others > 0) {
      throw new Error(`They own a team with ${others} other ${others === 1 ? 'person' : 'people'} in it. Move ownership or remove the others first.`);
    }
    if (others === 0) teamRemoved = member.teamId;
  }

  /* The users row first: everything of theirs hangs off it by ON DELETE
     CASCADE, so one statement takes the lot. The team, if it is being emptied,
     goes after — its own projects and invitations cascade from it. */
  await query('DELETE FROM users WHERE id = ?', [id]);
  if (teamRemoved) await query('DELETE FROM teams WHERE id = ?', [teamRemoved]);

  return { email: target.email, teamRemoved: !!teamRemoved };
}

export async function addDonation(actorId, { email, amount, currency, receivedAt, note }) {
  const user = await one('SELECT id, email FROM users WHERE email = ?', [String(email || '').trim().toLowerCase()]);
  if (!user) throw new Error('No account with that address.');

  const value = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(value) || value <= 0) throw new Error('Amount must be a positive number.');
  if (value > 1e9) throw new Error('That amount is not plausible.');

  const when = Number(receivedAt) || now();
  // A gift cannot have arrived before the app existed or after tomorrow.
  if (when < 1600000000000 || when > now() + DAY) throw new Error('That date is out of range.');

  const res = await query(
    'INSERT INTO donations (user_id, amount, currency, received_at, note, recorded_by, created_at) VALUES (?,?,?,?,?,?,?)',
    [user.id, value, String(currency || 'PHP').slice(0, 8), when, note ? String(note).slice(0, 255) : null, actorId, now()]);
  return { id: res.insertId, email: user.email, amount: value };
}

export async function removeDonation(id) {
  const res = await query('DELETE FROM donations WHERE id = ?', [Number(id)]);
  if (!res.affectedRows) throw new Error('No such donation.');
}

/* Interest, not money. Recorded because it is the one signal the app has that
   somebody considered giving — the donate link is a plain checkout that reports
   nothing back, so a click is as close as this gets without a payment
   integration. Counted separately from donations everywhere it is shown. */
export async function noteDonateClick(userId) {
  await query('UPDATE users SET donate_clicks = donate_clicks + 1, donated_click_at = ? WHERE id = ?', [now(), userId]);
}

/* Called on sync, which is the closest the server gets to "the app is open".
   Written at most once every few minutes: a device syncing after every
   keystroke would otherwise turn one row into a write-hot spot for no extra
   information. */
const SEEN_EVERY = 5 * 60 * 1000;

export async function touchSeen(userId, lastSeen) {
  const t = now();
  if (lastSeen && t - Number(lastSeen) < SEEN_EVERY) return;
  await query('UPDATE users SET last_seen_at = ? WHERE id = ?', [t, userId]);
}
