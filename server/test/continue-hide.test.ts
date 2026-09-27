import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, createAndSelect } from './helpers.ts';

function seed(db: import('../src/db.ts').Db, profileId: number) {
  db.exec(`INSERT INTO movie (key, title, stream_id, ext, added) VALUES ('tmdb:1', 'Film A', 10, 'mp4', 1), ('tmdb:2', 'Film B', 11, 'mp4', 2)`);
  db.exec(`INSERT INTO series (id, title) VALUES (7, 'Serie S')`);
  db.exec(`INSERT INTO episode (id, series_id, season, num, ext) VALUES (700, 7, 1, 1, 'mp4'), (701, 7, 1, 2, 'mp4')`);
  db.exec(`INSERT INTO progress (profile_id, item_type, item_id, series_id, position, duration, watched, updated_at) VALUES
    (${profileId}, 'movie', 'tmdb:1', NULL, 600, 6000, 0, 100),
    (${profileId}, 'movie', 'tmdb:2', NULL, 600, 6000, 0, 101),
    (${profileId}, 'episode', '700', 7, 2500, 2600, 1, 102)`);
}

async function continueRow(app: Awaited<ReturnType<typeof buildApp>>['app'], cookie: string) {
  const r = await app.inject({ method: 'GET', url: '/api/home', headers: { cookie } });
  const row = (r.json() as { rows: { key: string; items: { type: string; id: string }[] }[] }).rows.find((x) => x.key === 'continue');
  return (row?.items ?? []).map((c) => `${c.type}:${c.id}`);
}

test('continue: hiding a movie or a series drops it from the row but keeps its progress', async () => {
  const { app, db } = await buildApp();
  const a = await createAndSelect(app, 'A');
  seed(db, a.id);
  assert.deepEqual(await continueRow(app, a.cookie), ['series:7', 'movie:tmdb:2', 'movie:tmdb:1']);

  const hide = (type: string, id: string) =>
    app.inject({ method: 'POST', url: '/api/continue/hide', payload: { type, id }, headers: { cookie: a.cookie } });
  assert.equal((await hide('movie', 'tmdb:1')).statusCode, 200);
  assert.equal((await hide('series', '7')).statusCode, 200);
  assert.equal((await hide('episode', '700')).statusCode, 400);
  assert.deepEqual(await continueRow(app, a.cookie), ['movie:tmdb:2']);

  // Resume point and watched episodes are untouched.
  const p = db.prepare(`SELECT COUNT(*) AS n FROM progress WHERE profile_id = ?`).get(a.id) as { n: number };
  assert.equal(p.n, 3);

  // Other profiles are not affected.
  const b = await createAndSelect(app, 'B');
  db.exec(`INSERT INTO progress (profile_id, item_type, item_id, position, duration, watched, updated_at) VALUES (${b.id}, 'movie', 'tmdb:1', 600, 6000, 0, 100)`);
  assert.deepEqual(await continueRow(app, b.cookie), ['movie:tmdb:1']);
  await app.close();
});

test('continue: watching again brings a hidden title back', async () => {
  const { app, db } = await buildApp();
  const a = await createAndSelect(app, 'A');
  seed(db, a.id);
  const as = { headers: { cookie: a.cookie } };
  await app.inject({ method: 'POST', url: '/api/continue/hide', payload: { type: 'movie', id: 'tmdb:1' }, ...as });
  await app.inject({ method: 'POST', url: '/api/continue/hide', payload: { type: 'series', id: '7' }, ...as });
  db.exec(`UPDATE continue_hidden SET hidden_at = 200`);

  await app.inject({ method: 'POST', url: '/api/progress', payload: { type: 'movie', id: 'tmdb:1', position: 900, duration: 6000 }, ...as });
  await app.inject({ method: 'POST', url: '/api/progress', payload: { type: 'episode', id: 701, position: 60, duration: 2600 }, ...as });
  const row = await continueRow(app, a.cookie);
  assert.ok(row.includes('movie:tmdb:1'));
  assert.ok(row.includes('series:7'));
  await app.close();
});

test('continue: deleting a profile drops its hidden entries', async () => {
  const { app, db } = await buildApp();
  const a = await createAndSelect(app, 'A');
  await createAndSelect(app, 'B');
  seed(db, a.id);
  await app.inject({ method: 'POST', url: '/api/continue/hide', payload: { type: 'movie', id: 'tmdb:1' }, headers: { cookie: a.cookie } });
  await app.inject({ method: 'DELETE', url: `/api/profiles/${a.id}`, headers: { cookie: a.cookie } });
  const n = db.prepare(`SELECT COUNT(*) AS n FROM continue_hidden`).get() as { n: number };
  assert.equal(n.n, 0);
  await app.close();
});
