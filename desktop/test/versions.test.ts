import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSemver, parseTag, pickAsset } from '../src/versions.ts';

test('parseTag accepts v-prefixed and bare semver, rejects the rest', () => {
  assert.equal(parseTag('v0.2.0'), '0.2.0');
  assert.equal(parseTag('0.2.0'), '0.2.0');
  assert.equal(parseTag('release-1'), null);
  assert.equal(parseTag('v1.2'), null);
});

test('compareSemver orders numerically', () => {
  assert.ok(compareSemver('0.2.0', '0.1.0') > 0);
  assert.ok(compareSemver('0.10.0', '0.9.9') > 0);
  assert.ok(compareSemver('1.0.0', '0.99.99') > 0);
  assert.equal(compareSemver('0.2.0', '0.2.0'), 0);
  assert.ok(compareSemver('0.1.0', '0.2.0') < 0);
});

const assets = [
  { name: 'Neftlix-0.2.0-universal.dmg', browser_download_url: 'https://x/mac.dmg', size: 10 },
  { name: 'Neftlix-0.2.0-universal.dmg.blockmap', browser_download_url: 'https://x/mac.blockmap', size: 1 },
  { name: 'Neftlix-Setup-0.2.0.exe', browser_download_url: 'https://x/win.exe', size: 20 },
  { name: 'latest.yml', browser_download_url: 'https://x/latest.yml', size: 1 },
];

test('pickAsset chooses the installer for the platform', () => {
  assert.deepEqual(pickAsset(assets, 'darwin'), { name: 'Neftlix-0.2.0-universal.dmg', url: 'https://x/mac.dmg', size: 10 });
  assert.deepEqual(pickAsset(assets, 'win32'), { name: 'Neftlix-Setup-0.2.0.exe', url: 'https://x/win.exe', size: 20 });
  assert.equal(pickAsset(assets, 'linux'), null);
  assert.equal(pickAsset([], 'darwin'), null);
});
