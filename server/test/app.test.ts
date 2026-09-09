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
