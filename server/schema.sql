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
  -- Which product this account belongs to: 'personal' or 'work'. Decided at
  -- sign-up and never changed.
  kind          VARCHAR(16)  NOT NULL DEFAULT 'personal',
  -- Touched when a device syncs, which is the closest thing to "opened the
  -- app" the server ever sees. Null for an account that has never synced.
  last_seen_at  BIGINT       NULL,
  -- Clicking Donate is not donating, and the two are counted separately on
  -- purpose: this is interest, the donations table is money.
  donate_clicks INT UNSIGNED NOT NULL DEFAULT 0,
  donated_click_at BIGINT    NULL,
  created_at    BIGINT       NOT NULL,
  updated_at    BIGINT       NOT NULL,
  -- The server's clock on the last push that touched any of the settings above.
  -- See the note by `categories`: this is what a pull is measured against.
  server_at     BIGINT       NOT NULL DEFAULT 0,
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

-- server_at is the server's own clock, written on every push, and it is what
-- "what changed since" is measured against. updated_at stays the client's, and
-- stays the thing conflicts are resolved on — an edit made offline yesterday
-- must still lose to one made online today.
--
-- They were the same column, and that was a silent way to lose rows: a device
-- whose clock ran a few minutes behind the server wrote rows already older than
-- another device's watermark, and that device never asked for anything that old
-- again. The rows sat on the server, delivered to nobody.

-- Categories and purposes are keyed by name because that is what the entries
-- reference, and what the user actually types.
CREATE TABLE IF NOT EXISTS categories (
  user_id    INT UNSIGNED NOT NULL,
  name       VARCHAR(60)  NOT NULL,
  color      VARCHAR(32)  NOT NULL,
  position   INT          NOT NULL DEFAULT 0,
  updated_at BIGINT       NOT NULL,
  server_at  BIGINT       NOT NULL DEFAULT 0,
  deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, name),
  KEY idx_categories_server (user_id, server_at),
  CONSTRAINT fk_categories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purposes (
  user_id    INT UNSIGNED NOT NULL,
  name       VARCHAR(60)  NOT NULL,
  color      VARCHAR(32)  NOT NULL,
  position   INT          NOT NULL DEFAULT 0,
  updated_at BIGINT       NOT NULL,
  server_at  BIGINT       NOT NULL DEFAULT 0,
  deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, name),
  KEY idx_purposes_server (user_id, server_at),
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
  server_at  BIGINT            NOT NULL DEFAULT 0,
  deleted    TINYINT(1)        NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  KEY idx_entries_date (user_id, date),
  KEY idx_entries_updated (user_id, updated_at),
  KEY idx_entries_server (user_id, server_at),
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
  server_at  BIGINT       NOT NULL DEFAULT 0,
  deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  KEY idx_money_date (user_id, date),
  KEY idx_money_updated (user_id, updated_at),
  KEY idx_money_server (user_id, server_at),
  CONSTRAINT fk_money_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The to-do pad. A note is a line of text and a status and nothing else: no
-- dates, no assignee, no ownership beyond the person who wrote it. Client-minted
-- ids and a tombstone column, so it syncs on exactly the terms everything else
-- does — written offline, merged on the stamp, deleted for good on every device.
--
-- `status` is text rather than an ENUM so adding one is a client change instead
-- of a migration, and `created_at` is kept apart from `updated_at` because the
-- pad is ordered by when a note was written: ordering by the edit stamp would
-- shuffle the list under the reader every time a word was typed.
CREATE TABLE IF NOT EXISTS todos (
  user_id    INT UNSIGNED NOT NULL,
  id         VARCHAR(64)  NOT NULL,
  body       VARCHAR(500) NOT NULL,
  status     VARCHAR(16)  NOT NULL DEFAULT 'pending',
  -- Why a note is stuck, asked for when it is marked so. Null on every other
  -- status, and kept rather than cleared when one moves off stuck: a note that
  -- goes back to being blocked is usually blocked on the same thing.
  blocked    VARCHAR(500) NULL,
  created_at BIGINT       NOT NULL,
  updated_at BIGINT       NOT NULL,
  server_at  BIGINT       NOT NULL DEFAULT 0,
  deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  KEY idx_todos_updated (user_id, updated_at),
  KEY idx_todos_server (user_id, server_at),
  CONSTRAINT fk_todos_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

/* ── teams ──

   A team account is a separate login from a personal one, so nothing personal
   exists in this half of the schema to leak: no meals, no sleep, no money. What
   a team holds is hours against projects, and who is allowed to touch them.

   The membership row is the whole authorization story. Every team route reads
   it first and takes the team id from it rather than from the request, so a
   caller cannot name someone else's team and be believed. */
CREATE TABLE IF NOT EXISTS teams (
  id          VARCHAR(64)   NOT NULL,
  name        VARCHAR(120)  NOT NULL,
  -- Set by hand once payment clears; see team_plan in server/teams.js for the
  -- caps. `seat_cap` 0 means the unlimited plan.
  plan        VARCHAR(24)   NOT NULL DEFAULT 'trial',
  seat_cap    SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  -- When the free trial runs out. Null means it never started counting, which
  -- teamStatus reads as still running rather than as over.
  trial_ends_at BIGINT      NULL,
  created_at  BIGINT        NOT NULL,
  updated_at  BIGINT        NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* One row per person per team. `role` is 'super', 'admin' or 'member'.

   A user belongs to at most one team — the UNIQUE key on user_id says so —
   because a work login is a work login. Lifting that later means dropping the
   key and nothing else. */
CREATE TABLE IF NOT EXISTS team_members (
  team_id    VARCHAR(64)  NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  role       VARCHAR(16)  NOT NULL DEFAULT 'member',
  joined_at  BIGINT       NOT NULL,
  updated_at BIGINT       NOT NULL,
  PRIMARY KEY (team_id, user_id),
  UNIQUE KEY uq_team_members_user (user_id),
  KEY idx_team_members_team (team_id, role),
  CONSTRAINT fk_tm_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_tm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* An invitation is an email plus a token, and it is the only way into a team.

   The email is stored lowercased and is unique per team, so inviting the same
   person twice replaces the invitation rather than making a second one that
   both work. */
CREATE TABLE IF NOT EXISTS team_invites (
  id          VARCHAR(64)  NOT NULL,
  team_id     VARCHAR(64)  NOT NULL,
  email       VARCHAR(190) NOT NULL,
  role        VARCHAR(16)  NOT NULL DEFAULT 'member',
  token_hash  CHAR(64)     NOT NULL,
  invited_by  INT UNSIGNED NULL,
  created_at  BIGINT       NOT NULL,
  expires_at  BIGINT       NOT NULL,
  accepted_at BIGINT       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_team_invite_email (team_id, email),
  KEY idx_team_invite_token (token_hash),
  CONSTRAINT fk_ti_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* What hours are logged against. The team's answer to a category.

   Client-minted ids and an updated_at stamp, exactly like entries, so projects
   ride the same last-write-wins sync as everything else and a member who is
   offline still has something to log against. */
CREATE TABLE IF NOT EXISTS team_projects (
  team_id    VARCHAR(64)  NOT NULL,
  id         VARCHAR(64)  NOT NULL,
  name       VARCHAR(120) NOT NULL,
  color      CHAR(7)      NULL,
  position   SMALLINT     NOT NULL DEFAULT 0,
  archived   TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at BIGINT       NOT NULL,
  deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, id),
  KEY idx_projects_updated (team_id, updated_at),
  CONSTRAINT fk_tp_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ── the blog ──

   Posts written in the admin dashboard and read by anyone. The only table in
   this database that holds something meant to be public, which is why it is
   the only one with a slug: every other row is reached by an id nobody types.

   The slug is unique on its own rather than per anything, because it is the
   URL — /blogs/<slug> — and two posts that resolve to one address is not a
   conflict a reader can be asked to resolve.

   body_html is what the editor produced, already sanitised on the way in. It
   is stored rather than re-derived because the sanitiser may get stricter and
   a post that silently changed shape on the next deploy would be worse than
   one that has to be re-saved. body_text is the same content flattened, for
   search and for the excerpt when nobody wrote one. */
CREATE TABLE IF NOT EXISTS blog_posts (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug         VARCHAR(180) NOT NULL,
  title        VARCHAR(200) NOT NULL,
  excerpt      VARCHAR(400) NULL,
  body_html    MEDIUMTEXT   NOT NULL,
  body_text    MEDIUMTEXT   NOT NULL,
  cover_url    VARCHAR(500) NULL,
  meta_title   VARCHAR(200) NULL,
  meta_desc    VARCHAR(400) NULL,
  meta_words   VARCHAR(400) NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'draft',
  author_id    INT UNSIGNED NULL,
  author_name  VARCHAR(120) NULL,
  published_at BIGINT       NULL,
  created_at   BIGINT       NOT NULL,
  updated_at   BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_blog_slug (slug),
  KEY idx_blog_live (status, published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ── support tickets ──

   A message from a person to whoever reads admin@bigcavestudios.com. Stored
   for two reasons only: the reference number has to come from somewhere that
   cannot hand the same one out twice, and the dashboard has to be able to list
   what has come in.

   The conversation itself does not live here. It is email, on both sides —
   which is why there is no reply column and no status: this table would
   otherwise start pretending to be a helpdesk while the actual replies
   happened somewhere it could not see, and a half-tracked ticket is worse than
   an untracked one.

   The id is the reference. AUTO_INCREMENT never reissues a number, including
   after a delete, which a COUNT-based scheme would. */
CREATE TABLE IF NOT EXISTS support_tickets (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ref        VARCHAR(24)  NOT NULL,
  email      VARCHAR(190) NOT NULL,
  user_id    INT UNSIGNED NULL,
  subject    VARCHAR(200) NOT NULL,
  body       TEXT         NOT NULL,
  delivered  TINYINT(1)   NOT NULL DEFAULT 0,
  status     VARCHAR(16)  NOT NULL DEFAULT 'unanswered',
  status_at  BIGINT       NULL,
  status_by  VARCHAR(190) NULL,
  created_at BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_ref (ref),
  KEY idx_ticket_status (status),
  KEY idx_ticket_new (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
