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

  for (const table of ['entries', 'money_entries']) {
    const [c] = await pool.query(
      'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [CONFIG.database, table, 'note']);
    if (!c.length) await pool.query(`ALTER TABLE ${table} ADD COLUMN note VARCHAR(500) NULL AFTER activity`);
  }
}
