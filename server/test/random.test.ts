import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, createAndSelect } from './helpers.ts';

function seed(db: import('../src/db.ts').Db) {
  db.exec(`INSERT INTO category (id, kind, name, position, discreet) VALUES
    ('1', 'movie', 'Azione', 0, 0), ('9', 'movie', 'Riservata', 1, 1), ('2', 'series', 'Drama', 0, 0), ('8', 'series', 'Riservata', 1, 1)`);
  db.exec(`INSERT INTO movie (key, title, stream_id, ext, added) VALUES
    ('tmdb:1', 'Film A', 10, 'mp4', 1), ('tmdb:2', 'Film X', 11, 'mp4', 2), ('tmdb:3', 'Film Both', 12, 'mp4', 3), ('name:orphan', 'Orphan', 13, 'mp4', 4)`);
  db.exec(`INSERT INTO movie_category (movie_key, category_id) VALUES ('tmdb:1', '1'), ('tmdb:2', '9'), ('tmdb:3', '1'), ('tmdb:3', '9')`);
  db.exec(`INSERT INTO series (id, title, category_id) VALUES (7, 'Serie S', '2'), (8, 'Serie X', '8')`);
}

const TRIES = 40;

test('random: "Tutti" never lands on a purely discreet title, and respects the chosen category (discreet categories shown)', async () => {
  const { app, db } = await buildApp();
  seed(db);
  const a = await createAndSelect(app, 'A');
  const as = { headers: { cookie: a.cookie } };
  await app.inject({ method: 'PATCH', url: `/api/profiles/${a.id}`, payload: { showDiscreet: true }, ...as });
  const pick = async (url: string) => {
    const r = await app.inject({ method: 'GET', url, ...as });
    assert.equal(r.statusCode, 200);
    return r.json() as { type: string; id: string };
  };

  const all = new Set<string>();
  for (let i = 0; i < TRIES; i++) {
    const c = await pick('/api/random?kind=movie');
    assert.equal(c.type, 'movie');
    all.add(c.id);
  }
  assert.ok(!all.has('tmdb:2'), 'discreet-only movie must never be drawn from "Tutti"');
  assert.ok(all.has('tmdb:1') || all.has('tmdb:3') || all.has('name:orphan'));

  for (let i = 0; i < TRIES; i++) {
    const c = await pick('/api/random?kind=movie&category=9');
    assert.ok(['tmdb:2', 'tmdb:3'].includes(c.id), `inside a discreet category it draws from it (got ${c.id})`);
  }
  for (let i = 0; i < TRIES; i++) assert.equal((await pick('/api/random?kind=movie&category=1')).id.startsWith('tmdb:'), true);

  for (let i = 0; i < TRIES; i++) {
    const c = await pick('/api/random?kind=series');
    assert.equal(c.type, 'series');
    assert.equal(c.id, '7');
  }
  for (let i = 0; i < TRIES; i++) assert.equal((await pick('/api/random?kind=series&category=8')).id, '8');
  await app.close();
});

test('random: 404 when nothing matches', async () => {
  const { app } = await buildApp();
  const a = await createAndSelect(app, 'A');
  const r = await app.inject({ method: 'GET', url: '/api/random?kind=movie', headers: { cookie: a.cookie } });
  assert.equal(r.statusCode, 404);
  await app.close();
});

test('favorites random: a movie plays as a movie, a series lands on one of its episodes, empty list is 404', async () => {
  const { app, db } = await buildApp();
  seed(db);
  db.exec(`INSERT INTO episode (id, series_id, season, num, ext) VALUES (700, 7, 1, 1, 'mp4'), (701, 7, 1, 2, 'mp4'), (702, 7, 2, 1, 'mp4')`);
  const a = await createAndSelect(app, 'A');
  const as = { headers: { cookie: a.cookie } };
  const pick = async (url: string) => {
    const r = await app.inject({ method: 'GET', url, ...as });
    assert.equal(r.statusCode, 200);
    return r.json() as { type: string; id: string; seriesId?: string };
  };

  assert.equal((await app.inject({ method: 'GET', url: '/api/favorites/random', ...as })).statusCode, 404);

  await app.inject({ method: 'POST', url: '/api/favorites', payload: { type: 'movie', id: 'tmdb:2' }, ...as });
  for (let i = 0; i < 10; i++) assert.deepEqual(await pick('/api/favorites/random'), { type: 'movie', id: 'tmdb:2' });

  await app.inject({ method: 'DELETE', url: '/api/favorites/movie/tmdb:2', ...as });
  await app.inject({ method: 'POST', url: '/api/favorites', payload: { type: 'series', id: '7' }, ...as });
  const seen = new Set<string>();
  for (let i = 0; i < TRIES; i++) {
    const c = await pick('/api/favorites/random');
    assert.equal(c.type, 'episode');
    assert.equal(c.seriesId, '7');
    seen.add(c.id);
  }
  assert.ok(seen.size > 1, 'draws across the episodes, not always the same one');
  for (const id of seen) assert.ok(['700', '701', '702'].includes(id));

  // The watchlist has its own draw.
  assert.equal((await app.inject({ method: 'GET', url: '/api/favorites/random?tab=watchlist', ...as })).statusCode, 404);
  await app.inject({ method: 'POST', url: '/api/watchlist', payload: { type: 'movie', id: 'tmdb:1' }, ...as });
  assert.deepEqual(await pick('/api/favorites/random?tab=watchlist'), { type: 'movie', id: 'tmdb:1' });
  await app.close();
});
