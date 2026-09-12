import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

const USER_INDEXES = `
CREATE INDEX IF NOT EXISTS progress_updated ON progress(profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS progress_series ON progress(profile_id, series_id);
`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  host TEXT NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  status TEXT,
  exp_date INTEGER,
  max_connections INTEGER,
  last_sync INTEGER
);

CREATE TABLE IF NOT EXISTS category (
  id TEXT NOT NULL,
  kind TEXT NOT NULL,           -- 'movie' | 'series'
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id, kind)
);

-- One row per real movie (deduplicated across provider categories).
CREATE TABLE IF NOT EXISTS movie (
  key TEXT PRIMARY KEY,         -- 'tmdb:123' or 'name:<normalized>'
  title TEXT NOT NULL,
  year INTEGER,
  poster TEXT,
  rating REAL,
  tmdb TEXT,
  added INTEGER NOT NULL DEFAULT 0,
  stream_id INTEGER NOT NULL,   -- currently preferred source
  ext TEXT NOT NULL,
  -- lazily fetched detail
  plot TEXT,
  cast TEXT,
  director TEXT,
  genre TEXT,
  backdrop TEXT,
  duration_secs INTEGER,
  detail_fetched_at INTEGER
);
CREATE INDEX IF NOT EXISTS movie_added ON movie(added DESC);
CREATE INDEX IF NOT EXISTS movie_title ON movie(title);

-- Every provider entry that maps to a movie (alternate sources: other categories, 4K variants).
CREATE TABLE IF NOT EXISTS movie_source (
  stream_id INTEGER PRIMARY KEY,
  movie_key TEXT NOT NULL,
  ext TEXT NOT NULL,
  category_id TEXT,
  label TEXT,                   -- '4K' etc.
  broken INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS movie_source_key ON movie_source(movie_key);

CREATE TABLE IF NOT EXISTS movie_category (
  movie_key TEXT NOT NULL,
  category_id TEXT NOT NULL,
  PRIMARY KEY (movie_key, category_id)
);
CREATE INDEX IF NOT EXISTS movie_category_cat ON movie_category(category_id);

CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  year INTEGER,
  poster TEXT,
  backdrop TEXT,
  plot TEXT,
  cast TEXT,
  director TEXT,
  genre TEXT,
  release_date TEXT,
  rating REAL,
  tmdb TEXT,
  last_modified INTEGER NOT NULL DEFAULT 0,
  category_id TEXT,
  episodes_fetched_at INTEGER,
  episodes_enriched_at INTEGER   -- TMDB fill-in done for the current episode list
);
CREATE INDEX IF NOT EXISTS series_modified ON series(last_modified DESC);
CREATE INDEX IF NOT EXISTS series_cat ON series(category_id);
CREATE INDEX IF NOT EXISTS series_title ON series(title);

CREATE TABLE IF NOT EXISTS episode (
  id INTEGER PRIMARY KEY,
  series_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  num INTEGER NOT NULL,
  title TEXT,
  plot TEXT,
  ext TEXT NOT NULL,
  duration_secs INTEGER,
  image TEXT,
  air_date TEXT,
  added INTEGER
);
CREATE INDEX IF NOT EXISTS episode_series ON episode(series_id, season, num);

-- TMDB responses used to complete episodes (season -1 = the show's season list).
CREATE TABLE IF NOT EXISTS tmdb_season (
  tmdb_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (tmdb_id, season)
);

CREATE TABLE IF NOT EXISTS live_channel (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  logo TEXT,
  category_id TEXT,
  epg_channel_id TEXT,
  num INTEGER NOT NULL DEFAULT 0,
  archive INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS live_channel_cat ON live_channel(category_id, num);
CREATE INDEX IF NOT EXISTS live_channel_name ON live_channel(name);

CREATE TABLE IF NOT EXISTS epg_programme (
  channel_id TEXT NOT NULL,     -- XMLTV channel id == live_channel.epg_channel_id
  start INTEGER NOT NULL,
  stop INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (channel_id, start)
);
CREATE INDEX IF NOT EXISTS epg_stop ON epg_programme(channel_id, stop);

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  profile_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,      -- 'movie' | 'episode'
  item_id TEXT NOT NULL,        -- movie.key or episode.id
  series_id INTEGER,            -- denormalized for episodes
  position INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,
  watched INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, item_type, item_id)
);

CREATE TABLE IF NOT EXISTS watchlist (
  profile_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,      -- 'movie' | 'series'
  item_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, item_type, item_id)
);

CREATE TABLE IF NOT EXISTS favorite (
  profile_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,      -- 'movie' | 'series'
  item_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, item_type, item_id)
);
`;

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  // Run after migrate(): on a pre-profiles database, migrate() is what adds profile_id
  // to `progress`, so these indexes can only be (re)created once that column exists.
  db.exec(USER_INDEXES);
  return db;
}

/** Additive migrations for databases created by older versions. */
function migrate(db: DatabaseSync) {
  const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  // `discreet` (formerly `hidden`): these categories used to be hidden from every listing; they are now browsable
  // but leave no trace (no resume point, no "Continua a guardare", no search history).
  if (!columns('category').includes('discreet')) {
    if (columns('category').includes('hidden')) db.exec('ALTER TABLE category RENAME COLUMN hidden TO discreet');
    else db.exec('ALTER TABLE category ADD COLUMN discreet INTEGER NOT NULL DEFAULT 0');
  }
  if (!columns('progress').includes('profile_id')) migrateProfiles(db);
  if (!columns('series').includes('episodes_enriched_at')) db.exec('ALTER TABLE series ADD COLUMN episodes_enriched_at INTEGER');
}

/** 0.1.0 → profiles: user tables gain profile_id; existing data goes to profile 1 "Principale". */
function migrateProfiles(db: DatabaseSync) {
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const hasData = count('progress') + count('watchlist') + count('favorite') + count('account') > 0;
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE progress_new (
        profile_id INTEGER NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, series_id INTEGER,
        position INTEGER NOT NULL DEFAULT 0, duration INTEGER NOT NULL DEFAULT 0, watched INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL, PRIMARY KEY (profile_id, item_type, item_id));
      CREATE TABLE watchlist_new (
        profile_id INTEGER NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, item_type, item_id));
      CREATE TABLE favorite_new (
        profile_id INTEGER NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, item_type, item_id));
    `);
    if (hasData) db.prepare('INSERT INTO profile (id, name, avatar, created_at) VALUES (1, ?, ?, ?)').run('Principale', 'red', now());
    db.exec(`
      INSERT INTO progress_new (profile_id, item_type, item_id, series_id, position, duration, watched, updated_at)
        SELECT 1, item_type, item_id, series_id, position, duration, watched, updated_at FROM progress;
      INSERT INTO watchlist_new (profile_id, item_type, item_id, created_at) SELECT 1, item_type, item_id, created_at FROM watchlist;
      INSERT INTO favorite_new (profile_id, item_type, item_id, created_at) SELECT 1, item_type, item_id, created_at FROM favorite;
      DROP TABLE progress; DROP TABLE watchlist; DROP TABLE favorite;
      ALTER TABLE progress_new RENAME TO progress;
      ALTER TABLE watchlist_new RENAME TO watchlist;
      ALTER TABLE favorite_new RENAME TO favorite;
    `);
    db.exec(USER_INDEXES);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => Math.floor(Date.now() / 1000);
