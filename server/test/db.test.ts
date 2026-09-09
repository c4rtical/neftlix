import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.ts';

const OLD_SCHEMA = `
CREATE TABLE account (id INTEGER PRIMARY KEY CHECK (id = 1), host TEXT NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL,
  status TEXT, exp_date INTEGER, max_connections INTEGER, last_sync INTEGER);
CREATE TABLE progress (item_type TEXT NOT NULL, item_id TEXT NOT NULL, series_id INTEGER, position INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0, watched INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (item_type, item_id));
CREATE TABLE watchlist (item_type TEXT NOT NULL, item_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (item_type, item_id));
CREATE TABLE favorite (item_type TEXT NOT NULL, item_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (item_type, item_id));
`;

function tmpDbPath() {
  return join(mkdtempSync(join(tmpdir(), 'neftlix-test-')), 'neftlix.sqlite');
}

function seedOldDb(path: string, withData: boolean) {
  const raw = new DatabaseSync(path);
  raw.exec(OLD_SCHEMA);
  if (withData) {
    raw.exec(`INSERT INTO account (id, host, username, password) VALUES (1, 'http://x', 'u', 'p')`);
    raw.exec(`INSERT INTO progress (item_type, item_id, position, duration, watched, updated_at) VALUES ('movie', 'tmdb:1', 100, 1000, 0, 5)`);
    raw.exec(`INSERT INTO watchlist (item_type, item_id, created_at) VALUES ('series', '7', 6)`);
    raw.exec(`INSERT INTO favorite (item_type, item_id, created_at) VALUES ('movie', 'tmdb:2', 7)`);
  }
  raw.close();
}

test('migrates an old database: creates profile 1 and assigns existing rows to it', () => {
  const path = tmpDbPath();
  seedOldDb(path, true);
  const db = openDb(path);
  const profiles = db.prepare('SELECT id, name, avatar FROM profile').all() as { id: number; name: string; avatar: string }[];
  assert.deepEqual(profiles, [{ id: 1, name: 'Principale', avatar: 'red' }]);
  assert.deepEqual(db.prepare('SELECT profile_id, item_id, position FROM progress').all(), [{ profile_id: 1, item_id: 'tmdb:1', position: 100 }]);
  assert.deepEqual(db.prepare('SELECT profile_id, item_id FROM watchlist').all(), [{ profile_id: 1, item_id: '7' }]);
  assert.deepEqual(db.prepare('SELECT profile_id, item_id FROM favorite').all(), [{ profile_id: 1, item_id: 'tmdb:2' }]);
  db.close();
});

test('migrates an old empty database without creating a profile', () => {
  const path = tmpDbPath();
  seedOldDb(path, false);
  const db = openDb(path);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM profile').get() as { n: number }).n, 0);
  const cols = (db.prepare('PRAGMA table_info(favorite)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes('profile_id'));
  db.close();
});

test('a fresh database has no profiles and the new schema', () => {
  const db = openDb(tmpDbPath());
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM profile').get() as { n: number }).n, 0);
  const cols = (db.prepare('PRAGMA table_info(progress)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes('profile_id'));
  db.close();
});

test('migration is idempotent', () => {
  const path = tmpDbPath();
  seedOldDb(path, true);
  openDb(path).close();
  const db = openDb(path);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM profile').get() as { n: number }).n, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM progress').get() as { n: number }).n, 1);
  db.close();
});
