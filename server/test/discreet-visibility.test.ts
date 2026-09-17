import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildApp, createAndSelect } from './helpers.ts';
import { openDb } from '../src/db.ts';

function seed(db: import('../src/db.ts').Db) {
  db.exec(`INSERT INTO category (id, kind, name, position, discreet) VALUES
    ('1', 'movie', 'Azione', 0, 0), ('9', 'movie', 'Riservata', 1, 1), ('2', 'series', 'Drama', 0, 0), ('8', 'series', 'Riservata', 1, 1),
    ('3', 'live', 'Sport', 0, 0), ('5', 'live', 'Riservata', 1, 1)`);
  db.exec(`INSERT INTO movie (key, title, stream_id, ext, added, poster, rating, year) VALUES
    ('tmdb:1', 'Film A', 10, 'mp4', 1, 'p', 8, 2026), ('tmdb:2', 'Film X', 11, 'mp4', 2, 'p', 9, 2026), ('tmdb:3', 'Film Both', 12, 'mp4', 3, 'p', 8, 2026), ('name:orphan', 'Orphan', 13, 'mp4', 4, 'p', 8, 2026)`);
  db.exec(`INSERT INTO movie_category (movie_key, category_id) VALUES ('tmdb:1', '1'), ('tmdb:2', '9'), ('tmdb:3', '1'), ('tmdb:3', '9')`);
  db.exec(`INSERT INTO series (id, title, category_id, poster, rating) VALUES (7, 'Serie S', '2', 'p', 8), (8, 'Serie X', '8', 'p', 9)`);
  db.exec(`INSERT INTO episode (id, series_id, season, num, ext) VALUES (700, 7, 1, 1, 'mp4'), (800, 8, 1, 1, 'mp4')`);
  db.exec(`INSERT INTO live_channel (id, name, category_id, num) VALUES (30, 'Sky Sport', '3', 1), (50, 'Canale X', '5', 2)`);
}

const get = async (app: Awaited<ReturnType<typeof buildApp>>['app'], url: string, cookie: string) => {
  const r = await app.inject({ method: 'GET', url, headers: { cookie } });
  assert.equal(r.statusCode, 200, `${url} -> ${r.statusCode}`);
  return r.json();
};

test('profiles start with discreet categories hidden; PATCH toggles them and status reports it', async () => {
  const { app } = await buildApp();
  const a = await createAndSelect(app, 'A');
  const status = (await get(app, '/api/status', a.cookie)) as { profile: { showDiscreet: boolean } };
  assert.equal(status.profile.showDiscreet, false);

  const bad = await app.inject({ method: 'PATCH', url: `/api/profiles/${a.id}`, payload: { showDiscreet: 'yes' }, headers: { cookie: a.cookie } });
  assert.equal(bad.statusCode, 400);

  const on = await app.inject({ method: 'PATCH', url: `/api/profiles/${a.id}`, payload: { showDiscreet: true }, headers: { cookie: a.cookie } });
  assert.equal(on.statusCode, 200);
  assert.equal((on.json() as { showDiscreet: boolean }).showDiscreet, true);
  assert.equal(((await get(app, '/api/status', a.cookie)) as { profile: { showDiscreet: boolean } }).profile.showDiscreet, true);

  const list = (await get(app, '/api/profiles', a.cookie)) as { items: { id: number; showDiscreet: boolean }[] };
  assert.equal(list.items.find((p) => p.id === a.id)?.showDiscreet, true);
  await app.close();
});

test('with discreet categories hidden, discreet-only titles and categories are left out of every catalogue listing', async () => {
  const { app, db } = await buildApp();
  seed(db);
  const a = await createAndSelect(app, 'A');
  const c = a.cookie;

  assert.deepEqual(((await get(app, '/api/categories', c)) as { id: string }[]).map((x) => x.id), ['1']);
  assert.deepEqual(((await get(app, '/api/categories?kind=series', c)) as { id: string }[]).map((x) => x.id), ['2']);
  assert.deepEqual(((await get(app, '/api/live/categories?all=1', c)) as { id: string }[]).map((x) => x.id), ['3']);

  const movies = (await get(app, '/api/movies', c)) as { total: number; items: { id: string }[] };
  assert.equal(movies.total, 3);
  assert.deepEqual(movies.items.map((m) => m.id).sort(), ['name:orphan', 'tmdb:1', 'tmdb:3']);
  // Asking for the discreet category by id yields only the titles that also live elsewhere.
  const inCat = (await get(app, '/api/movies?category=9', c)) as { total: number; items: { id: string }[] };
  assert.deepEqual(inCat.items.map((m) => m.id), ['tmdb:3']);
  assert.equal(inCat.total, 1);

  const series = (await get(app, '/api/series', c)) as { total: number; items: { id: string }[] };
  assert.deepEqual(series.items.map((s) => s.id), ['7']);
  assert.equal(series.total, 1);
  assert.equal(((await get(app, '/api/series?category=8', c)) as { total: number }).total, 0);

  const search = (await get(app, '/api/search?q=Film', c)) as { movies: { id: string }[] };
  assert.deepEqual(search.movies.map((m) => m.id).sort(), ['tmdb:1', 'tmdb:3']);
  const searchX = (await get(app, '/api/search?q=Serie', c)) as { series: { id: string }[] };
  assert.deepEqual(searchX.series.map((s) => s.id), ['7']);

  const home = (await get(app, '/api/home', c)) as { rows: { key: string; items: { id: string }[] }[] };
  for (const row of home.rows) {
    for (const item of row.items) assert.notEqual(`${row.key}:${item.id}`, `${row.key}:tmdb:2`, `home row ${row.key} exposes a discreet movie`);
    for (const item of row.items) assert.notEqual(`${row.key}:${item.id}`, `${row.key}:8`, `home row ${row.key} exposes a discreet series`);
  }
  assert.ok(home.rows.find((r) => r.key === 'recent-movies')?.items.some((i) => i.id === 'tmdb:3'));

  const live = (await get(app, '/api/live/channels?all=1', c)) as { total: number; items: { id: number }[] };
  assert.deepEqual(live.items.map((l) => l.id), [30]);
  assert.equal(live.total, 1);
  assert.equal((await app.inject({ method: 'GET', url: '/api/live/channels?category=5', headers: { cookie: c } })).json().total, 0);

  const random = await app.inject({ method: 'GET', url: '/api/random?kind=series&category=8', headers: { cookie: c } });
  assert.equal(random.statusCode, 404);
  for (let i = 0; i < 30; i++) {
    const m = (await get(app, '/api/random?kind=movie&category=9', c)) as { id: string };
    assert.equal(m.id, 'tmdb:3');
  }
  await app.close();
});

test('with discreet categories hidden, saved favourites and watchlist keep discreet titles but the home rows hide them', async () => {
  const { app, db } = await buildApp();
  seed(db);
  const a = await createAndSelect(app, 'A');
  const c = a.cookie;
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload, headers: { cookie: c } });
  await post('/api/favorites', { type: 'movie', id: 'tmdb:2' });
  await post('/api/favorites', { type: 'movie', id: 'tmdb:1' });
  await post('/api/watchlist', { type: 'series', id: '8' });
  await post('/api/watchlist', { type: 'series', id: '7' });

  const fav = (await get(app, '/api/favorites', c)) as { items: { id: string }[] };
  assert.deepEqual(fav.items.map((i) => i.id).sort(), ['tmdb:1', 'tmdb:2']);
  const wl = (await get(app, '/api/watchlist', c)) as { items: { id: string }[] };
  assert.deepEqual(wl.items.map((i) => i.id).sort(), ['7', '8']);

  const home = (await get(app, '/api/home', c)) as { rows: { key: string; items: { id: string }[] }[] };
  assert.deepEqual(home.rows.find((r) => r.key === 'favorites')?.items.map((i) => i.id), ['tmdb:1']);
  assert.deepEqual(home.rows.find((r) => r.key === 'watchlist')?.items.map((i) => i.id), ['7']);
  await app.close();
});

test('with discreet categories shown, the profile sees discreet categories and titles as before, per profile', async () => {
  const { app, db } = await buildApp();
  seed(db);
  const a = await createAndSelect(app, 'A');
  const b = await createAndSelect(app, 'B');
  await app.inject({ method: 'PATCH', url: `/api/profiles/${a.id}`, payload: { showDiscreet: true }, headers: { cookie: a.cookie } });

  assert.deepEqual(((await get(app, '/api/categories', a.cookie)) as { id: string }[]).map((x) => x.id), ['1', '9']);
  assert.deepEqual(((await get(app, '/api/categories?kind=series', a.cookie)) as { id: string }[]).map((x) => x.id), ['2', '8']);
  assert.deepEqual(((await get(app, '/api/live/categories?all=1', a.cookie)) as { id: string }[]).map((x) => x.id), ['3', '5']);
  assert.equal(((await get(app, '/api/movies', a.cookie)) as { total: number }).total, 4);
  assert.equal(((await get(app, '/api/series', a.cookie)) as { total: number }).total, 2);
  assert.equal(((await get(app, '/api/live/channels?all=1', a.cookie)) as { total: number }).total, 2);
  const search = (await get(app, '/api/search?q=Film', a.cookie)) as { movies: { id: string; discreet: boolean }[] };
  assert.deepEqual(Object.fromEntries(search.movies.map((m) => [m.id, m.discreet])), { 'tmdb:1': false, 'tmdb:2': true, 'tmdb:3': false });

  // Profile B is untouched.
  assert.equal(((await get(app, '/api/movies', b.cookie)) as { total: number }).total, 3);
  assert.deepEqual(((await get(app, '/api/categories', b.cookie)) as { id: string }[]).map((x) => x.id), ['1']);
  await app.close();
});

test('migration adds profile.showDiscreet (off) to databases created before it', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'neftlix-visibility-')), 'db.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE profile (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, avatar TEXT NOT NULL, created_at INTEGER NOT NULL);
           INSERT INTO profile (name, avatar, created_at) VALUES ('Principale', 'red', 1)`);
  db.close();
  const migrated = openDb(path);
  assert.deepEqual(migrated.prepare('SELECT id, show_discreet FROM profile').all().map((r) => ({ ...(r as object) })), [{ id: 1, show_discreet: 0 }]);
});
