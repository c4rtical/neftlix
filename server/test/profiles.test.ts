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
