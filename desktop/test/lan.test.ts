import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePin, lanAddresses, loadLanState, PIN_RE, saveLanState } from '../src/lan.ts';

test('generatePin gives 6 digits', () => {
  for (let i = 0; i < 50; i++) assert.match(generatePin(), /^[0-9]{6}$/);
  assert.ok(PIN_RE.test('1234') && PIN_RE.test('12345678') && !PIN_RE.test('123') && !PIN_RE.test('12a4'));
});

test('lan state round-trips and repairs a broken file', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'neftlix-lan-')), 'lan.json');
  const fresh = loadLanState(file);
  assert.equal(fresh.enabled, false);
  assert.match(fresh.pin, /^[0-9]{6}$/);
  assert.equal(fresh.secret.length, 64);

  saveLanState(file, { enabled: true, pin: '4321', secret: fresh.secret });
  const back = loadLanState(file);
  assert.deepEqual(back, { enabled: true, pin: '4321', secret: fresh.secret });

  saveLanState(file, { enabled: true, pin: 'abc', secret: 'short' } as never);
  const repaired = loadLanState(file);
  assert.equal(repaired.enabled, true);
  assert.match(repaired.pin, /^[0-9]{6}$/);
  assert.equal(repaired.secret.length, 64);
});

test('lanAddresses keeps reachable IPv4 only, private ranges first', () => {
  const addrs = lanAddresses({
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    en0: [
      { family: 'IPv6', internal: false, address: 'fe80::1' },
      { family: 'IPv4', internal: false, address: '192.168.1.20' },
    ],
    en1: [{ family: 'IPv4', internal: false, address: '169.254.10.1' }],
    utun0: [{ family: 'IPv4', internal: false, address: '100.64.0.5' }],
    bridge: [{ family: 4, internal: false, address: '10.0.0.3' }],
  });
  assert.deepEqual(addrs, ['10.0.0.3', '192.168.1.20', '100.64.0.5']);
});
