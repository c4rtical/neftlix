import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, createAndSelect } from './helpers.ts';

test('profiles: create, list, update, limit', async () => {
  const { app } = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: '  Anna ', avatar: 'blue' } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { id: 1, name: 'Anna', avatar: 'blue' });

  assert.equal((await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: '', avatar: 'blue' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: 'X', avatar: 'nope' } })).statusCode, 400);

  const u = await app.inject({ method: 'PATCH', url: '/api/profiles/1', payload: { name: 'Anna B', avatar: 'green' } });
  assert.deepEqual(u.json(), { id: 1, name: 'Anna B', avatar: 'green' });
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/profiles/99', payload: { name: 'x' } })).statusCode, 404);

  for (const n of ['B', 'C', 'D', 'E']) await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: n, avatar: 'red' } });
  assert.equal((await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: 'F', avatar: 'red' } })).statusCode, 409);

  const list = await app.inject({ method: 'GET', url: '/api/profiles' });
  assert.equal((list.json() as { items: unknown[] }).items.length, 5);
  assert.equal((list.json() as { current: number | null }).current, null);
  await app.close();
});

test('select sets the cookie; status reports the active profile; deselect clears it', async () => {
  const { app } = await buildApp();
  const { id, cookie } = await createAndSelect(app, 'Anna');
  assert.match(cookie, /^neftlix_profile=1$/);

  const sel = await app.inject({ method: 'POST', url: `/api/profiles/${id}/select` });
  assert.match(sel.headers['set-cookie'] as string, /HttpOnly/);
  assert.match(sel.headers['set-cookie'] as string, /SameSite=Lax/);
  assert.equal((await app.inject({ method: 'POST', url: '/api/profiles/99/select' })).statusCode, 404);

  const status = await app.inject({ method: 'GET', url: '/api/status', headers: { cookie } });
  assert.deepEqual((status.json() as { profile: unknown }).profile, { id: 1, name: 'Anna', avatar: 'blue' });
  assert.equal((status.json() as { profiles: number }).profiles, 1);

  const noCookie = await app.inject({ method: 'GET', url: '/api/status' });
  assert.equal((noCookie.json() as { profile: unknown }).profile, null);

  const de = await app.inject({ method: 'POST', url: '/api/profiles/deselect', headers: { cookie } });
  assert.match(de.headers['set-cookie'] as string, /Max-Age=0/);
  await app.close();
});

test('protected API requires a valid profile cookie', async () => {
  const { app } = await buildApp();
  const r = await app.inject({ method: 'GET', url: '/api/favorites' });
  assert.equal(r.statusCode, 401);
  assert.deepEqual(r.json(), { error: 'Profilo non selezionato', code: 'NO_PROFILE' });

  const stale = await app.inject({ method: 'GET', url: '/api/favorites', headers: { cookie: 'neftlix_profile=42' } });
  assert.equal(stale.statusCode, 401);

  assert.equal((await app.inject({ method: 'GET', url: '/api/status' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/profiles' })).statusCode, 200);

  const { cookie } = await createAndSelect(app, 'Anna');
  assert.equal((await app.inject({ method: 'GET', url: '/api/favorites', headers: { cookie } })).statusCode, 200);
  await app.close();
});

test('deleting a profile clears its cookie', async () => {
  const { app, db } = await buildApp();
  const { id, cookie } = await createAndSelect(app, 'Anna');
  const del = await app.inject({ method: 'DELETE', url: `/api/profiles/${id}`, headers: { cookie } });
  assert.equal(del.statusCode, 200);
  assert.match(del.headers['set-cookie'] as string, /Max-Age=0/);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM profile').get() as { n: number }).n, 0);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/profiles/99' })).statusCode, 404);
  await app.close();
});

function seedCatalog(db: import('../src/db.ts').Db) {
  db.exec(`INSERT INTO movie (key, title, stream_id, ext, added) VALUES ('tmdb:1', 'Film A', 10, 'mp4', 1), ('tmdb:2', 'Film B', 11, 'mp4', 2)`);
  db.exec(`INSERT INTO series (id, title) VALUES (7, 'Serie S')`);
  db.exec(`INSERT INTO episode (id, series_id, season, num, ext) VALUES (700, 7, 1, 1, 'mp4'), (701, 7, 1, 2, 'mp4')`);
}

test('favorites, watchlist and progress are isolated per profile', async () => {
  const { app, db } = await buildApp();
  seedCatalog(db);
  const a = await createAndSelect(app, 'A');
  const b = await createAndSelect(app, 'B');
  const as = (cookie: string) => ({ headers: { cookie } });

  await app.inject({ method: 'POST', url: '/api/favorites', payload: { type: 'movie', id: 'tmdb:1' }, ...as(a.cookie) });
  await app.inject({ method: 'POST', url: '/api/watchlist', payload: { type: 'series', id: '7' }, ...as(a.cookie) });
  await app.inject({ method: 'POST', url: '/api/progress', payload: { type: 'movie', id: 'tmdb:2', position: 100, duration: 1000 }, ...as(a.cookie) });
  await app.inject({ method: 'POST', url: '/api/progress', payload: { type: 'episode', id: 700, position: 50, duration: 1000 }, ...as(a.cookie) });

  const favA = (await app.inject({ method: 'GET', url: '/api/favorites', ...as(a.cookie) })).json() as { items: { id: string }[] };
  const favB = (await app.inject({ method: 'GET', url: '/api/favorites', ...as(b.cookie) })).json() as { items: { id: string }[] };
  assert.deepEqual(favA.items.map((i) => i.id), ['tmdb:1']);
  assert.deepEqual(favB.items, []);

  const wlB = (await app.inject({ method: 'GET', url: '/api/watchlist', ...as(b.cookie) })).json() as { items: unknown[] };
  assert.deepEqual(wlB.items, []);

  const movieA = (await app.inject({ method: 'GET', url: '/api/movies/tmdb:2', ...as(a.cookie) })).json() as { progress: { position: number } | null };
  const movieB = (await app.inject({ method: 'GET', url: '/api/movies/tmdb:2', ...as(b.cookie) })).json() as { progress: unknown; favorite: boolean };
  assert.equal(movieA.progress?.position, 100);
  assert.equal(movieB.progress, null);

  const detailA = (await app.inject({ method: 'GET', url: '/api/movies/tmdb:1', ...as(a.cookie) })).json() as { favorite: boolean };
  const detailB = (await app.inject({ method: 'GET', url: '/api/movies/tmdb:1', ...as(b.cookie) })).json() as { favorite: boolean };
  assert.equal(detailA.favorite, true);
  assert.equal(detailB.favorite, false);

  const seriesB = (await app.inject({ method: 'GET', url: '/api/series/7', ...as(b.cookie) })).json() as { watchlist: boolean; nextEpisode: { episodeId: number } };
  assert.equal(seriesB.watchlist, false);
  assert.equal(seriesB.nextEpisode.episodeId, 700);
  const seriesA = (await app.inject({ method: 'GET', url: '/api/series/7', ...as(a.cookie) })).json() as { watchlist: boolean; nextEpisode: { episodeId: number; position: number } };
  assert.equal(seriesA.watchlist, true);
  assert.equal(seriesA.nextEpisode.position, 50);

  const homeA = (await app.inject({ method: 'GET', url: '/api/home', ...as(a.cookie) })).json() as { rows: { key: string; items: { id: string }[] }[] };
  const homeB = (await app.inject({ method: 'GET', url: '/api/home', ...as(b.cookie) })).json() as { rows: { key: string }[] };
  const cont = homeA.rows.find((r) => r.key === 'continue');
  assert.ok(cont && cont.items.some((i) => i.id === 'tmdb:2') && cont.items.some((i) => i.id === '7'));
  assert.equal(homeB.rows.find((r) => r.key === 'continue'), undefined);
  assert.equal(homeB.rows.find((r) => r.key === 'favorites'), undefined);

  const searchB = (await app.inject({ method: 'GET', url: '/api/search?q=Film', ...as(b.cookie) })).json() as { movies: { id: string; progress: unknown }[] };
  assert.equal(searchB.movies.find((m) => m.id === 'tmdb:2')?.progress, null);
  await app.close();
});

test('deleting a profile removes only its data', async () => {
  const { app, db } = await buildApp();
  seedCatalog(db);
  const a = await createAndSelect(app, 'A');
  const b = await createAndSelect(app, 'B');
  await app.inject({ method: 'POST', url: '/api/favorites', payload: { type: 'movie', id: 'tmdb:1' }, headers: { cookie: a.cookie } });
  await app.inject({ method: 'POST', url: '/api/favorites', payload: { type: 'movie', id: 'tmdb:1' }, headers: { cookie: b.cookie } });
  await app.inject({ method: 'DELETE', url: `/api/profiles/${a.id}`, headers: { cookie: a.cookie } });
  assert.deepEqual(
    db.prepare('SELECT profile_id FROM favorite').all().map((r) => ({ ...(r as object) })),
    [{ profile_id: b.id }],
  );
  await app.close();
});
