import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './helpers.ts';

test('logout keeps host and username for the next login, status exposes them', async () => {
  const { app, db } = await buildApp();
  db.prepare(`INSERT INTO account (id, host, username, password, status) VALUES (1, 'http://x.example', 'user1', 'secret', 'Active')`).run();

  const before = (await app.inject({ method: 'GET', url: '/api/status' })).json() as { configured: boolean; lastLogin: unknown };
  assert.equal(before.configured, true);
  assert.equal(before.lastLogin, null);

  const out = await app.inject({ method: 'DELETE', url: '/api/setup' });
  assert.equal(out.statusCode, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM account').get() as { n: number }).n, 0);

  const after = (await app.inject({ method: 'GET', url: '/api/status' })).json() as { configured: boolean; lastLogin: { host: string; username: string } | null };
  assert.equal(after.configured, false);
  assert.deepEqual(after.lastLogin, { host: 'http://x.example', username: 'user1' });
  assert.equal(JSON.stringify(after).includes('secret'), false, 'the password must never be exposed');
  await app.close();
});
