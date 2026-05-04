-- Club Events Database Schema
-- Run: wrangler d1 execute club-events-db --file=schema.sql

-- Clubs table
CREATE TABLE IF NOT EXISTS clubs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  logo_key   TEXT,
  password_hash TEXT NOT NULL,
  salt       TEXT    NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT    NOT NULL,
  description    TEXT,
  poster_key     TEXT,
  start_datetime TEXT    NOT NULL,
  end_datetime   TEXT    NOT NULL,
  club_id        INTEGER NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

-- Admin table (single row, id always 1)
CREATE TABLE IF NOT EXISTS admin (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL
);

-- Sample clubs (passwords are 'password123' hashed – run setup endpoint to use env-based admin)
-- INSERT INTO clubs (name, logo_key, password_hash, salt) VALUES ...
-- Sample events will be added through the UI
