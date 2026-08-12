-- Campus Events Database Schema
-- Run: wrangler d1 execute club-events-db --file=schema.sql

-- Entities table (clubs, departments, offices, and other campus organizations)
CREATE TABLE IF NOT EXISTS entities (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL UNIQUE,
  type                 TEXT    NOT NULL DEFAULT 'club' CHECK (type IN ('club', 'department', 'office', 'organization', 'program')),
  password_hash        TEXT    NOT NULL,
  salt                 TEXT    NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Locations table (campus locations for events)
CREATE TABLE IF NOT EXISTS locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Events table
-- join_url is the only new concept for virtual/hybrid events -- "Virtual" vs "Hybrid" vs
-- in-person is derived, not stored: join_url set + no location_id = Virtual, join_url set +
-- location_id set = Hybrid, no join_url = in-person (regardless of location_id), matching how
-- event_type/format filters are computed in functions/api/events.js rather than needing their
-- own stored column that could drift out of sync with location_id.
CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT    NOT NULL,
  description    TEXT,
  location_id    INTEGER,
  start_datetime TEXT    NOT NULL,
  end_datetime   TEXT    NOT NULL,
  entity_id      INTEGER NOT NULL,
  event_type     TEXT    NOT NULL DEFAULT 'other' CHECK (event_type IN ('meeting', 'social', 'academic', 'athletic', 'fundraiser', 'performance', 'other')),
  join_url       TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
);

-- Admin table (single row, id always 1) — the College of Idaho Admin account
-- reset_token_hash/reset_token_expires back the self-service "Forgot password" flow: a SHA-256
-- hash of a random token (never the raw token itself -- same reasoning as password_hash never
-- being a raw password), cleared again as soon as it's used or superseded by a newer request.
CREATE TABLE IF NOT EXISTS admin (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash        TEXT NOT NULL,
  salt                 TEXT NOT NULL,
  notify_email         TEXT,
  reset_token_hash     TEXT,
  reset_token_expires  DATETIME
);

-- Feedback / bug reports submitted by anyone (public, no login required), reviewed by the admin
-- under Admin -> Roadmap -> Suggestions & Feedback. Deleting a row IS the "handled" action --
-- no separate status column, consistent with how the rest of this app has no soft-delete/archive
-- state anywhere else.
CREATE TABLE IF NOT EXISTS feedback (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category      TEXT    NOT NULL DEFAULT 'suggestion' CHECK (category IN ('bug', 'suggestion', 'other')),
  message       TEXT    NOT NULL,
  contact_email TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Failed login attempts, for rate limiting /api/auth/admin and /api/auth/entity (see
-- functions/utils/rateLimit.js). Rows older than a day are opportunistically deleted on write.
CREATE TABLE IF NOT EXISTS login_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ip           TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(ip, endpoint, attempted_at);

-- Notes:
-- - Entity logos are not stored; display a Font Awesome icon and initial instead.
-- - Events reference a campus location (locations table). The UI allows selecting or creating locations.
-- - `type` categorizes entities as a student club, a college department, an office, or another
--   organization (e.g. ASCI), so the UI can group/filter them.
-- - `must_change_password` is set whenever an entity's password is admin-assigned (new entity, or an
--   admin-triggered reset) and forces that entity to pick their own password before using the app further.
--   The API always sets it explicitly on insert/reset rather than relying on the column default, so it
--   behaves the same on both fresh and migrated databases.

-- Migration from the previous "clubs are the top-level entity, run by Senate" schema:
--   ALTER TABLE clubs RENAME TO entities;
--   ALTER TABLE entities ADD COLUMN type TEXT NOT NULL DEFAULT 'club' CHECK (type IN ('club', 'department', 'office', 'organization'));
--   ALTER TABLE events RENAME COLUMN club_id TO entity_id;

-- Migration to add forced first-login / admin-reset password support to an already-migrated entities table:
--   ALTER TABLE entities ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

-- Migration to add 'program' as a valid entity type to an already-migrated entities table.
-- SQLite can't ALTER a CHECK constraint in place, so this rebuilds the table (safe: it preserves
-- ids, so events.entity_id foreign keys still resolve correctly). foreign_keys must be turned off
-- first: with it on, DROP TABLE performs an implicit DELETE FROM on the dropped table, which fires
-- ON DELETE CASCADE on events and silently wipes every event row. Run each statement in order:
--   PRAGMA foreign_keys=OFF;
--   CREATE TABLE entities_new (
--     id                   INTEGER PRIMARY KEY AUTOINCREMENT,
--     name                 TEXT    NOT NULL UNIQUE,
--     type                 TEXT    NOT NULL DEFAULT 'club' CHECK (type IN ('club', 'department', 'office', 'organization', 'program')),
--     password_hash        TEXT    NOT NULL,
--     salt                 TEXT    NOT NULL,
--     must_change_password INTEGER NOT NULL DEFAULT 0,
--     created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
--   );
--   INSERT INTO entities_new SELECT * FROM entities;
--   DROP TABLE entities;
--   ALTER TABLE entities_new RENAME TO entities;
--   PRAGMA foreign_keys=ON;

-- Migration to add event_type to an already-migrated events table. Unlike the entities.type
-- migration above, this one's a plain ADD COLUMN -- SQLite allows a CHECK constraint on a newly
-- added column as long as it doesn't reference other columns, no table rebuild needed. Existing
-- rows get the DEFAULT ('other') applied automatically.
--   ALTER TABLE events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'other' CHECK (event_type IN ('meeting', 'social', 'academic', 'athletic', 'fundraiser', 'performance', 'other'));

-- Migration to add the feedback tool to an already-migrated database: a nullable notify_email
-- column on the single-row admin table (plain ADD COLUMN, no CHECK, no rebuild needed), plus the
-- new feedback table itself.
--   ALTER TABLE admin ADD COLUMN notify_email TEXT;
--   CREATE TABLE IF NOT EXISTS feedback (
--     id            INTEGER PRIMARY KEY AUTOINCREMENT,
--     category      TEXT    NOT NULL DEFAULT 'suggestion' CHECK (category IN ('bug', 'suggestion', 'other')),
--     message       TEXT    NOT NULL,
--     contact_email TEXT,
--     created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
--   );

-- Migration to add self-service admin password reset to an already-migrated database: two more
-- nullable columns on the single-row admin table, plain ADD COLUMN, no rebuild needed.
--   ALTER TABLE admin ADD COLUMN reset_token_hash TEXT;
--   ALTER TABLE admin ADD COLUMN reset_token_expires DATETIME;

-- Migration to add virtual/hybrid event support to an already-migrated events table. Plain ADD
-- COLUMN, no rebuild needed -- Virtual/Hybrid/in-person is derived from join_url + location_id
-- at query time, not stored.
--   ALTER TABLE events ADD COLUMN join_url TEXT;
