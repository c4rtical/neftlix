import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, createAndSelect } from './helpers.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.ts';
import { isDiscreetItem, isDiscreetSeries, purgeDiscreetProgress } from '../src/sync.ts';

function seed(db: import('../src/db.ts').Db) {
  db.exec(`INSERT INTO category (id, kind, name, position, discreet) VALUES
    ('1', 'movie', 'Azione', 0, 0), ('9', 'movie', 'Riservata', 1, 1), ('2', 'series', 'Drama', 0, 0), ('8', 'series', 'Riservata', 1, 1)`);
  db.exec(`INSERT INTO movie (key, title, stream_id, ext, added) VALUES
    ('tmdb:1', 'Film A', 10, 'mp4', 1), ('tmdb:2', 'Film X', 11, 'mp4', 2), ('tmdb:3', 'Film Both', 12, 'mp4', 3), ('name:orphan', 'Orphan', 13, 'mp4', 4)`);
  db.exec(`INSERT INTO movie_category (movie_key, category_id) VALUES ('tmdb:1', '1'), ('tmdb:2', '9'), ('tmdb:3', '1'), ('tmdb:3', '9')`);
  db.exec(`INSERT INTO series (id, title, category_id) VALUES (7, 'Serie S', '2'), (8, 'Serie X', '8')`);
  db.exec(`INSERT INTO episode (id, series_id, season, num, ext) VALUES (700, 7, 1, 1, 'mp4'), (800, 8, 1, 1, 'mp4')`);
}

test('isDiscreetItem: only items whose every category is discreet count as discreet', async () => {
  const { app, db } = await buildApp();
  seed(db);
  assert.equal(isDiscreetItem(db, 'movie', 'tmdb:1'), false);
  assert.equal(isDiscreetItem(db, 'movie', 'tmdb:2'), true);
  assert.equal(isDiscreetItem(db, 'movie', 'tmdb:3'), false);
  assert.equal(isDiscreetItem(db, 'movie', 'name:orphan'), false);
  assert.equal(isDiscreetItem(db, 'episode', '700'), false);
  assert.equal(isDiscreetItem(db, 'episode', '800'), true);
  assert.equal(isDiscreetSeries(db, 7), false);
  assert.equal(isDiscreetSeries(db, 8), true);
  await app.close();
});

test('playback progress is not recorded for movies and episodes of discreet categories', async () => {
  const { app, db } = await buildApp();
  seed(db);
  const a = await createAndSelect(app, 'A');
  const as = { headers: { cookie: a.cookie } };
  const post = (payload: object) => app.inject({ method: 'POST', url: '/api/progress', payload, ...as });

  const r = await post({ type: 'movie', id: 'tmdb:2', position: 600, duration: 1000 });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true, watched: false, tracked: false });
  await post({ type: 'episode', id: 800, position: 600, duration: 1000 });
  await post({ type: 'movie', id: 'tmdb:1', position: 600, duration: 1000 });
  await post({ type: 'movie', id: 'tmdb:3', position: 600, duration: 1000 });

  const rows = db.prepare('SELECT item_type, item_id FROM progress ORDER BY item_id').all() as { item_type: string; item_id: string }[];
  assert.deepEqual(rows.map((x) => `${x.item_type}:${x.item_id}`), ['movie:tmdb:1', 'movie:tmdb:3']);

  const movie = (await app.inject({ method: 'GET', url: '/api/movies/tmdb:2', ...as })).json() as { progress: unknown };
  assert.equal(movie.progress, null);
  const series = (await app.inject({ method: 'GET', url: '/api/series/8', ...as })).json() as { nextEpisode: { position: number } };
  assert.equal(series.nextEpisode.position, 0);

  const home = (await app.inject({ method: 'GET', url: '/api/home', ...as })).json() as { rows: { key: string; items: { id: string }[] }[] };
  const cont = home.rows.find((x) => x.key === 'continue');
  assert.deepEqual(cont?.items.map((i) => i.id).sort(), ['tmdb:1', 'tmdb:3']);
  await app.close();
});

test('purgeDiscreetProgress drops old resume points of discreet items and keeps everything else', async () => {
  const { app, db } = await buildApp();
  seed(db);
  const ins = db.prepare(`INSERT INTO progress (profile_id, item_type, item_id, series_id, position, duration, watched, updated_at) VALUES (1, ?, ?, ?, 100, 1000, ?, 1)`);
  ins.run('movie', 'tmdb:1', null, 0);
  ins.run('movie', 'tmdb:2', null, 0);
  ins.run('movie', 'tmdb:3', null, 0);
  ins.run('episode', '700', 7, 0);
  ins.run('episode', '800', 8, 0);
  assert.equal(purgeDiscreetProgress(db), 2);
  const rows = db.prepare('SELECT item_type, item_id FROM progress ORDER BY item_id').all() as { item_type: string; item_id: string }[];
  assert.deepEqual(rows.map((x) => `${x.item_type}:${x.item_id}`), ['episode:700', 'movie:tmdb:1', 'movie:tmdb:3']);
  assert.equal(purgeDiscreetProgress(db), 0);
  await app.close();
});

test('discreet categories are browsable; search flags their hits so the client keeps them out of its history', async () => {
  const { app, db } = await buildApp();
  seed(db);
  const a = await createAndSelect(app, 'A');
  const as = { headers: { cookie: a.cookie } };

  const cats = (await app.inject({ method: 'GET', url: '/api/categories', ...as })).json() as { id: string }[];
  assert.deepEqual(cats.map((c) => c.id), ['1', '9']);
  const seriesCats = (await app.inject({ method: 'GET', url: '/api/categories?kind=series', ...as })).json() as { id: string }[];
  assert.deepEqual(seriesCats.map((c) => c.id), ['2', '8']);
  const all = (await app.inject({ method: 'GET', url: '/api/movies', ...as })).json() as { total: number };
  assert.equal(all.total, 4);
  const inCat = (await app.inject({ method: 'GET', url: '/api/movies?category=9', ...as })).json() as { items: { id: string }[] };
  assert.deepEqual(inCat.items.map((m) => m.id).sort(), ['tmdb:2', 'tmdb:3']);

  const search = (await app.inject({ method: 'GET', url: '/api/search?q=Film', ...as })).json() as { movies: { id: string; discreet: boolean }[] };
  assert.deepEqual(Object.fromEntries(search.movies.map((m) => [m.id, m.discreet])), { 'tmdb:1': false, 'tmdb:2': true, 'tmdb:3': false });
  const searchX = (await app.inject({ method: 'GET', url: '/api/search?q=Serie X', ...as })).json() as { series: { id: string; discreet: boolean }[] };
  assert.deepEqual(searchX.series.map((s) => [s.id, s.discreet]), [['8', true]]);
  await app.close();
});

test('migration renames category.hidden to category.discreet and keeps its values', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'neftlix-discreet-')), 'db.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE category (id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (id, kind));
           INSERT INTO category VALUES ('9', 'movie', 'Riservata', 0, 1), ('1', 'movie', 'Azione', 1, 0)`);
  db.close();
  const migrated = openDb(path);
  const cols = (migrated.prepare('PRAGMA table_info(category)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes('discreet') && !cols.includes('hidden'));
  assert.deepEqual(migrated.prepare('SELECT id, discreet FROM category ORDER BY id').all().map((r) => ({ ...(r as object) })), [{ id: '1', discreet: 0 }, { id: '9', discreet: 1 }]);
});
