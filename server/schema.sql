-- ZIMPAN schema (MySQL / MariaDB). Re-run safe.
--
-- Two conventions carry the sync model:
--   updated_at  ms since epoch. Conflicts resolve last-write-wins by
--               comparing it, so it is a BIGINT, not a TIMESTAMP.
--   deleted     soft delete. A row removed on one device has to stay
--               visible to the others as a tombstone, or the next pull
--               would happily resurrect it.
--
-- Dates are CHAR(10) rather than DATE on purpose: the driver converts DATE
-- into a JS Date in the local timezone, which can shift the day either side
-- of midnight. The app stores 'YYYY-MM-DD' and wants it back verbatim.

-- password_hash is nullable: an account created through Google has no password
-- at all. google_sub is Google's stable subject id, which never changes even if
-- the user renames their email, so it is the real identity key. MySQL permits
-- many NULLs in a UNIQUE index, so password-only accounts coexist fine.
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NULL,
  google_sub    VARCHAR(64)  NULL,
  display_name  VARCHAR(120) NULL,
  currency      VARCHAR(8)   NOT NULL DEFAULT 'PHP',
  -- Optional. Only used to scale the calorie-burn estimate; blank falls back
  -- to an average build.
  weight_kg     SMALLINT UNSIGNED NULL,
  -- The hour the day is treated as over, minutes since midnight. Gap review
  -- walks from 6am to here looking for unlogged stretches; null falls back to
  -- 10pm, which is what the flow assumed before anyone could say otherwise.
  sleep_min     SMALLINT UNSIGNED NULL,
  -- Steps walked, keyed by date: {"2026-08-16": {"v": 5300, "t": 1755300000000}}.
  -- A column rather than a table because the map is small, always read whole,
  -- and merged per date on the client using the per-date stamp — which is what
  -- lets two devices each record a different day without either winning.
  steps_json    JSON         NULL,
  -- The food-estimate cache, keyed by a hash of the meal text. Synced so a
  -- meal refined on one device is not re-sent to the AI from another. Merged
  -- by a per-entry stamp, the same way steps_json is.
  ai_cache_json JSON         NULL,
  -- Which trackers the user asked to be prompted about:
  -- {"time": true, "money": true, "steps": false, "meals": false}. A column
  -- rather than a table for the same reason steps_json is one: four booleans
  -- read and written whole, only ever by their owner.
  tracks_json   JSON         NULL,
  -- A timer that is still running. It is not an entry yet — it becomes one
  -- only when it is stopped — but it lives here rather than on the device so
  -- locking the phone, reloading, or opening the web app does not lose it.
  -- The activity is deliberately absent: this flow names the entry on stop.
  timer_start   BIGINT       NULL,
  timer_cat     VARCHAR(60)  NULL,
  -- What the running timer is called. Kept beside its start and category so a
  -- timer started on one device carries its name to the others.
  timer_activity VARCHAR(200) NULL,
  -- 'user', 'manager' or 'superadmin'. Managers read the admin dashboard,
  -- superadmins also write to it. Everyone else never sees it exists.
  role          VARCHAR(16)  NOT NULL DEFAULT 'user',
  -- Touched when a device syncs, which is the closest thing to "opened the
  -- app" the server ever sees. Null for an account that has never synced.
  last_seen_at  BIGINT       NULL,
  -- Clicking Donate is not donating, and the two are counted separately on
  -- purpose: this is interest, the donations table is money.
  donate_clicks INT UNSIGNED NOT NULL DEFAULT 0,
  donated_click_at BIGINT    NULL,
  created_at    BIGINT       NOT NULL,
  updated_at    BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_google (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64)     NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  created_at BIGINT       NOT NULL,
  expires_at BIGINT       NOT NULL,
  PRIMARY KEY (token_hash),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expiry (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Only the SHA-256 of a reset token is stored, so a leaked database cannot be
-- used to seize accounts. Tokens are single-use and short-lived; used_at is
-- kept rather than deleted so a replayed link can be told apart from a
-- fabricated one.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash CHAR(64)     NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  created_at BIGINT       NOT NULL,
  expires_at BIGINT       NOT NULL,
  used_at    BIGINT       NULL,
  PRIMARY KEY (token_hash),
  KEY idx_resets_user (user_id),
  KEY idx_resets_expiry (expires_at),
  CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Categories and purposes are keyed by name because that is what the entries
-- reference, and what the user actually types.
CREATE TABLE IF NOT EXISTS categories (
  user_id    INT UNSIGNED NOT NULL,
  name       VARCHAR(60)  NOT NULL,
  color      VARCHAR(32)  NOT NULL,
  position   INT          NOT NULL DEFAULT 0,
  updated_at BIGINT       NOT NULL,
  deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, name),
  CONSTRAINT fk_categories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purposes (
  user_id    INT UNSIGNED NOT NULL,
  name       VARCHAR(60)  NOT NULL,
  color      VARCHAR(32)  NOT NULL,
  position   INT          NOT NULL DEFAULT 0,
  updated_at BIGINT       NOT NULL,
  deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, name),
  CONSTRAINT fk_purposes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- id is client-generated (the app already mints 'm1723...' style ids), so a
-- device can create rows offline without asking the server for a key.
CREATE TABLE IF NOT EXISTS entries (
  user_id    INT UNSIGNED      NOT NULL,
  id         VARCHAR(64)       NOT NULL,
  date       CHAR(10)          NOT NULL,
  activity   VARCHAR(200)      NOT NULL,
  category   VARCHAR(60)       NOT NULL,
  from_min   SMALLINT UNSIGNED NOT NULL,
  to_min     SMALLINT UNSIGNED NOT NULL,
  -- Free text the app asks for after certain entries: what kind of workout it
  -- was, what was eaten. Always optional.
  note       VARCHAR(500)      NULL,
  updated_at BIGINT            NOT NULL,
  deleted    TINYINT(1)        NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  KEY idx_entries_date (user_id, date),
  KEY idx_entries_updated (user_id, updated_at),
  CONSTRAINT fk_entries_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS money_entries (
  user_id    INT UNSIGNED NOT NULL,
  id         VARCHAR(64)  NOT NULL,
  date       CHAR(10)     NOT NULL,
  activity   VARCHAR(200) NOT NULL,
  purpose    VARCHAR(60)  NOT NULL,
  -- DECIMAL, not a float: money needs exact arithmetic, and every currency the
  -- app offers has a two-place minor unit.
  amount_in  DECIMAL(15,2) NOT NULL DEFAULT 0,
  amount_out DECIMAL(15,2) NOT NULL DEFAULT 0,
  -- Whether this spend is held outside the running balance. The default is 0
  -- because most spending does come out of what came in; the flag records the
  -- exception — a reimbursable expense, money drawn from savings — so a row
  -- written before this column existed keeps counting, which is what it did.
  off_budget TINYINT(1)   NOT NULL DEFAULT 0,
  note       VARCHAR(500) NULL,
  updated_at BIGINT       NOT NULL,
  deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  KEY idx_money_date (user_id, date),
  KEY idx_money_updated (user_id, updated_at),
  CONSTRAINT fk_money_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Recorded by hand from the payment provider's statement, because the donate
-- link is a plain PayPal checkout that reports nothing back. `recorded_by` is
-- kept so an entered figure can always be traced to whoever entered it, and
-- survives that admin being removed.
CREATE TABLE IF NOT EXISTS donations (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED  NOT NULL,
  amount      DECIMAL(15,2) NOT NULL,
  currency    VARCHAR(8)    NOT NULL DEFAULT 'PHP',
  -- When the money arrived, which is not when someone got round to typing it in.
  received_at BIGINT        NOT NULL,
  note        VARCHAR(255)  NULL,
  recorded_by INT UNSIGNED  NULL,
  created_at  BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_donations_user (user_id),
  KEY idx_donations_received (received_at),
  CONSTRAINT fk_donations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_donations_admin FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
