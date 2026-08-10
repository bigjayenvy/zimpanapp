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
  note       VARCHAR(500) NULL,
  updated_at BIGINT       NOT NULL,
  deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  KEY idx_money_date (user_id, date),
  KEY idx_money_updated (user_id, updated_at),
  CONSTRAINT fk_money_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
