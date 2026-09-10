import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';

function tmpDirs() {
  const root = mkdtempSync(join(tmpdir(), 'neftlix-app-'));
  const webDist = join(root, 'web');
  mkdirSync(webDist);
  writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>Neftlix test</title>');
  return { dataDir: join(root, 'data'), webDist };
}

test('createApp listens on a random loopback port, serves the API and the web build, and closes', async () => {
  const { dataDir, webDist } = tmpDirs();
  const handle = await createApp({ dataDir, webDist, logLevel: 'silent' });
  const url = await handle.listen('127.0.0.1', 0);
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.notEqual(new URL(url).port, '0');

  const status = await fetch(`${url}/api/status`);
  assert.equal(status.status, 200);
  assert.equal((await status.json() as { configured: boolean }).configured, false);

  const index = await fetch(`${url}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Neftlix test/);

  const spa = await fetch(`${url}/settings`);
  assert.equal(spa.status, 200, 'client-side routes fall back to index.html');

  await handle.close();
  await assert.rejects(fetch(`${url}/api/status`), 'the port is released after close');
});

test('createApp with a password requires HTTP basic auth on every route', async () => {
  const { dataDir, webDist } = tmpDirs();
  const handle = await createApp({ dataDir, webDist, password: 'segreto', logLevel: 'silent' });
  const url = await handle.listen('127.0.0.1', 0);
  assert.equal((await fetch(`${url}/api/status`)).status, 401);
  const ok = await fetch(`${url}/api/status`, { headers: { authorization: `Basic ${Buffer.from('x:segreto').toString('base64')}` } });
  assert.equal(ok.status, 200);
  await handle.close();
});

test('createApp with lan challenges non-loopback clients with a PIN and lets loopback through', async () => {
  const { dataDir, webDist } = tmpDirs();
  let pin = '123456';
  const handle = await createApp({ dataDir, webDist, logLevel: 'silent', lan: { secret: 's3cret', getPin: () => pin } });
  const app = handle.app;
  const tv = { remoteAddress: '192.168.1.50' };

  const local = await app.inject({ method: 'GET', url: '/api/status' });
  assert.equal(local.statusCode, 200, 'loopback is never challenged');

  const page = await app.inject({ method: 'GET', url: '/settings', ...tv });
  assert.equal(page.statusCode, 401);
  assert.match(page.headers['content-type'] as string, /text\/html/);
  assert.match(page.body, /PIN/);

  const api = await app.inject({ method: 'GET', url: '/api/status', ...tv });
  assert.equal(api.statusCode, 401);
  assert.equal(api.json().code, 'LAN_PIN');

  const wrong = await app.inject({ method: 'POST', url: '/api/lan/login', payload: { pin: '000000' }, ...tv });
  assert.equal(wrong.statusCode, 401);

  const ok = await app.inject({ method: 'POST', url: '/api/lan/login', payload: { pin: '123456' }, ...tv });
  assert.equal(ok.statusCode, 200);
  const cookie = (ok.headers['set-cookie'] as string).split(';')[0];
  assert.match(cookie, /^neftlix_lan=[0-9a-f]{64}$/);

  const withCookie = await app.inject({ method: 'GET', url: '/api/status', headers: { cookie }, ...tv });
  assert.equal(withCookie.statusCode, 200, 'the cookie opens the API');
  const pageWithCookie = await app.inject({ method: 'GET', url: '/settings', headers: { cookie }, ...tv });
  assert.match(pageWithCookie.body, /Neftlix test/, 'and the web app');

  pin = '654321';
  const stale = await app.inject({ method: 'GET', url: '/api/status', headers: { cookie }, ...tv });
  assert.equal(stale.statusCode, 401, 'changing the PIN signs every TV out');

  for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/lan/login', payload: { pin: 'nope' }, ...tv });
  const locked = await app.inject({ method: 'POST', url: '/api/lan/login', payload: { pin: '654321' }, ...tv });
  assert.equal(locked.statusCode, 429, 'five wrong PINs lock the address for a while');

  await handle.close();
});
