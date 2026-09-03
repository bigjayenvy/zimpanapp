/* MySQL / MariaDB via mysql2 — pure JavaScript, so nothing has to compile at
   install time on Windows or on Namecheap.

   Local development talks to XAMPP's MariaDB; production talks to the MySQL
   database cPanel provisions. Same dialect either side, so there is no second
   code path to keep honest. */

import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));

// Node reads server/.env natively; absent in production, where cPanel supplies
// real environment variables instead.
try { process.loadEnvFile(join(HERE, '.env')); } catch { /* no .env — use the environment */ }

const CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'zimpan',
  // Stellar caps concurrent processes hard, so stay modest and let requests
  // queue rather than opening connections the plan will refuse.
  connectionLimit: Number(process.env.DB_POOL) || 5,
  waitForConnections: true,
  charset: 'utf8mb4_general_ci',
  // Keeps BIGINT updated_at values as JS numbers; they are ms timestamps, well
  // inside the safe integer range.
  supportBigNumbers: true,
  bigNumberStrings: false
};

export const pool = mysql.createPool(CONFIG);

export const now = () => Date.now();

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/* Runs fn against a dedicated connection inside a transaction, rolling back on
   any throw. The connection is always returned to the pool. */
export async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch { /* connection already gone */ }
    throw err;
  } finally {
    conn.release();
  }
}

/* Applies schema.sql. CREATE DATABASE is attempted only when the configured
   database is missing — on shared hosting the database is made in cPanel and
   the account usually lacks the privilege, so a failure there is not fatal. */
export async function migrate() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    if (err.code !== 'ER_BAD_DB_ERROR') throw err;
    const admin = await mysql.createConnection({ ...CONFIG, database: undefined });
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${CONFIG.database}\`
                       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.end();
  }

  // Comments are stripped before splitting, not filtered after: a leading
  // comment block shares its chunk with the statement that follows it, so
  // skipping chunks that start with '--' would drop that statement too.
  const sql = readFileSync(join(HERE, 'schema.sql'), 'utf8').replace(/^\s*--.*$/gm, '');
  for (const statement of sql.split(';')) {
    const trimmed = statement.trim();
    // multipleStatements stays off, so each DDL statement goes over on its own.
    if (trimmed) await pool.query(trimmed);
  }

  await alterExisting();
  await seedAdmin();
}

/* The first superadmin, created on the boot that first knows about roles.

   Seeded without a password by default: the account is reached through the
   ordinary Forgot Password flow, so no credential is ever written into this
   repository or into a log. That path needs SMTP configured — in production the
   mailer refuses rather than printing reset links — so ADMIN_PASSWORD exists as
   an escape hatch for a server without mail. It is read from the environment
   and never stored anywhere but the hash.

   Only ever promotes; never demotes. Someone who moved the role on to a
   different account should not find it handed back on the next restart. */
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@bigcavestudios.com').trim().toLowerCase();

async function seedAdmin() {
  if (!ADMIN_EMAIL) return;
  const [[row]] = await pool.query('SELECT id, role FROM users WHERE email = ?', [ADMIN_EMAIL]);
  const secret = (process.env.ADMIN_PASSWORD || '').trim();
  /* Imported here rather than at the top of the file: auth.js imports from
     this module, and a static import back would close the cycle at load time.
     By the time this runs, db.js is fully evaluated and the cycle is moot. */
  const hash = secret ? (await import('./auth.js')).hashPassword(secret) : null;
  const t = Date.now();

  if (!row) {
    await pool.query(
      "INSERT INTO users (email, password_hash, role, currency, created_at, updated_at) VALUES (?,?,'superadmin','PHP',?,?)",
      [ADMIN_EMAIL, hash, t, t]);
    console.log(`[zimpan] created superadmin ${ADMIN_EMAIL}${hash ? ' with the password from ADMIN_PASSWORD' : ' with no password — use Forgot Password to set one'}`);
    return;
  }
  if (row.role !== 'superadmin') {
    await pool.query("UPDATE users SET role = 'superadmin', updated_at = ? WHERE id = ?", [t, row.id]);
    console.log(`[zimpan] promoted ${ADMIN_EMAIL} to superadmin`);
  }
  // Only when asked for explicitly, so a stray restart cannot reset a password
  // the owner has since changed from the dashboard.
  if (secret) {
    await pool.query('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, t, row.id]);
    console.log(`[zimpan] reset ${ADMIN_EMAIL} password from ADMIN_PASSWORD`);
  }
}

/* CREATE TABLE IF NOT EXISTS leaves an existing table exactly as it was, so a
   database created before Google sign-in needs the new columns adding by hand.
   Each step checks first and is safe to run on every boot. */
async function alterExisting() {
  const [cols] = await pool.query(
    'SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [CONFIG.database, 'users']);
  const has = (n) => cols.some((c) => c.name === n);

  if (!has('google_sub')) {
    await pool.query('ALTER TABLE users ADD COLUMN google_sub VARCHAR(64) NULL AFTER password_hash');
    await pool.query('ALTER TABLE users ADD UNIQUE KEY uq_users_google (google_sub)');
  }
  if (!has('display_name')) {
    await pool.query('ALTER TABLE users ADD COLUMN display_name VARCHAR(120) NULL AFTER google_sub');
  }
  if (!has('weight_kg')) {
    await pool.query('ALTER TABLE users ADD COLUMN weight_kg SMALLINT UNSIGNED NULL AFTER currency');
  }
  if (!has('steps_json')) {
    await pool.query('ALTER TABLE users ADD COLUMN steps_json JSON NULL AFTER weight_kg');
  }
  if (!has('ai_cache_json')) {
    await pool.query('ALTER TABLE users ADD COLUMN ai_cache_json JSON NULL AFTER steps_json');
  }
  if (!has('sleep_min')) {
    await pool.query('ALTER TABLE users ADD COLUMN sleep_min SMALLINT UNSIGNED NULL AFTER weight_kg');
  }
  if (!has('tracks_json')) {
    await pool.query('ALTER TABLE users ADD COLUMN tracks_json JSON NULL AFTER steps_json');
  }
  // Added together and only ever read together, so one guard covers both.
  if (!has('timer_start')) {
    await pool.query('ALTER TABLE users ADD COLUMN timer_start BIGINT NULL AFTER steps_json');
    await pool.query('ALTER TABLE users ADD COLUMN timer_cat VARCHAR(60) NULL AFTER timer_start');
  }
  if (!has('timer_activity')) {
    await pool.query('ALTER TABLE users ADD COLUMN timer_activity VARCHAR(200) NULL AFTER timer_cat');
  }
  if (!has('role')) {
    await pool.query("ALTER TABLE users ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'user' AFTER steps_json");
  }
  /* Which product this account belongs to. 'personal' for every row that
     already exists, which is what they all are: Zimpan for Teams did not exist
     when they were made, and an account cannot be moved between the two — the
     whole point of the column is that it is decided once, at sign-up. */
  if (!has('kind')) {
    await pool.query("ALTER TABLE users ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'personal' AFTER role");
  }
  if (!has('last_seen_at')) {
    await pool.query('ALTER TABLE users ADD COLUMN last_seen_at BIGINT NULL AFTER role');
  }
  if (!has('donate_clicks')) {
    await pool.query('ALTER TABLE users ADD COLUMN donate_clicks INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_seen_at');
    await pool.query('ALTER TABLE users ADD COLUMN donated_click_at BIGINT NULL AFTER donate_clicks');
  }
  // A Google-only account stores no password, so the column must accept NULL.
  const pw = cols.find((c) => c.name === 'password_hash');
  if (pw && pw.nullable === 'NO') {
    await pool.query('ALTER TABLE users MODIFY password_hash VARCHAR(255) NULL');
  }

  /* Amounts began as BIGINT, which silently forbade cents. Widening to
     DECIMAL(15,2) leaves existing whole values untouched — 23580 becomes
     23580.00, the same number — so there is nothing to convert. */
  const [amounts] = await pool.query(
    'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?)',
    [CONFIG.database, 'money_entries', 'amount_in', 'amount_out']);
  for (const col of amounts) {
    if (/^bigint/i.test(col.type)) {
      await pool.query(`ALTER TABLE money_entries MODIFY ${col.name} DECIMAL(15,2) NOT NULL DEFAULT 0`);
    }
  }

  const [budget] = await pool.query(
    'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [CONFIG.database, 'money_entries', 'off_budget']);
  if (!budget.length) {
    await pool.query('ALTER TABLE money_entries ADD COLUMN off_budget TINYINT(1) NOT NULL DEFAULT 0 AFTER amount_out');
  }

  for (const table of ['entries', 'money_entries']) {
    const [c] = await pool.query(
      'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [CONFIG.database, table, 'note']);
    if (!c.length) await pool.query(`ALTER TABLE ${table} ADD COLUMN note VARCHAR(500) NULL AFTER activity`);
  }

  /* What makes a time entry a team entry: the project it was logged against.

     Nullable, and null on every row that already exists, which is the whole
     migration — a personal entry is one with no project, and that is also
     exactly the rule an admin is held to. An entry an admin may read is an
     entry with a project on it, so the column is the permission.

     team_id rides alongside rather than being looked up through the project,
     so the authorization check is one predicate on the row itself and does not
     depend on a join that could be got wrong. */
  /* The end of a team's trial. Nullable, and null on any team made before this
     existed — teamStatus reads a missing date as "still in the trial" rather
     than as expired, so nobody is cut off by a migration. */
  const [tt] = await pool.query(
    'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [CONFIG.database, 'teams', 'trial_ends_at']);
  if (!tt.length) {
    await pool.query('ALTER TABLE teams ADD COLUMN trial_ends_at BIGINT NULL AFTER seat_cap');
  }

  /* The blog's meta fields, added after the table existed. Nullable and read
     with a fallback to the post's own title and excerpt, so a post written
     before these columns is not suddenly missing its description. */
  const [blogCols] = await pool.query(
    'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [CONFIG.database, 'blog_posts']);
  if (blogCols.length) {
    const hasBlogCol = (n) => blogCols.some((c) => c.name === n);
    if (!hasBlogCol('meta_title')) {
      await pool.query('ALTER TABLE blog_posts ADD COLUMN meta_title VARCHAR(200) NULL AFTER cover_url');
    }
    if (!hasBlogCol('meta_desc')) {
      await pool.query('ALTER TABLE blog_posts ADD COLUMN meta_desc VARCHAR(400) NULL AFTER meta_title');
    }
    if (!hasBlogCol('meta_words')) {
      await pool.query('ALTER TABLE blog_posts ADD COLUMN meta_words VARCHAR(400) NULL AFTER meta_desc');
    }
  }

  /* A ticket's status, added after the table. Whoever last moved it and when
     go alongside it: a status set three weeks ago and never touched since is a
     different thing from one set this morning, and a bare word cannot tell
     them apart. */
  const [tix] = await pool.query(
    'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [CONFIG.database, 'support_tickets']);
  if (tix.length) {
    const hasTix = (n) => tix.some((c) => c.name === n);
    if (!hasTix('status')) {
      await pool.query("ALTER TABLE support_tickets ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'unanswered' AFTER delivered");
      await pool.query('ALTER TABLE support_tickets ADD KEY idx_ticket_status (status)');
    }
    if (!hasTix('status_at')) {
      await pool.query('ALTER TABLE support_tickets ADD COLUMN status_at BIGINT NULL AFTER status');
      await pool.query('ALTER TABLE support_tickets ADD COLUMN status_by VARCHAR(190) NULL AFTER status_at');
    }
  }

  const [proj] = await pool.query(
    'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?)',
    [CONFIG.database, 'entries', 'project_id', 'team_id']);
  const hasEntryCol = (n) => proj.some((c) => c.name === n);
  if (!hasEntryCol('team_id')) {
    await pool.query('ALTER TABLE entries ADD COLUMN team_id VARCHAR(64) NULL AFTER user_id');
  }
  if (!hasEntryCol('project_id')) {
    await pool.query('ALTER TABLE entries ADD COLUMN project_id VARCHAR(64) NULL AFTER category');
    await pool.query('ALTER TABLE entries ADD KEY idx_entries_team (team_id, date)');
  }
}
