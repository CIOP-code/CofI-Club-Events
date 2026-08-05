-- Campus Events Database Schema
-- Run: wrangler d1 execute club-events-db --file=schema.sql

-- Entities table (clubs, departments, offices, and other campus organizations)
CREATE TABLE IF NOT EXISTS entities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE,
  type          TEXT    NOT NULL DEFAULT 'club' CHECK (type IN ('club', 'department', 'office', 'organization')),
  password_hash TEXT    NOT NULL,
  salt          TEXT    NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Locations table (campus locations for events)
CREATE TABLE IF NOT EXISTS locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT    NOT NULL,
  description    TEXT,
  location_id    INTEGER,
  start_datetime TEXT    NOT NULL,
  end_datetime   TEXT    NOT NULL,
  entity_id      INTEGER NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
);

-- Admin table (single row, id always 1) — the College of Idaho Admin account
CREATE TABLE IF NOT EXISTS admin (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL
);

-- Notes:
-- - Entity logos are not stored; display a Font Awesome icon and initial instead.
-- - Events reference a campus location (locations table). The UI allows selecting or creating locations.
-- - `type` categorizes entities as a student club, a college department, an office, or another
--   organization (e.g. ASCI), so the UI can group/filter them.

-- Migration from the previous "clubs are the top-level entity, run by Senate" schema:
--   ALTER TABLE clubs RENAME TO entities;
--   ALTER TABLE entities ADD COLUMN type TEXT NOT NULL DEFAULT 'club' CHECK (type IN ('club', 'department', 'office', 'organization'));
--   ALTER TABLE events RENAME COLUMN club_id TO entity_id;
