import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import { TSDB_PACING, fixtureState, loadFixtures } from '../src/fixtures.ts';

type Ev = { idEvent: string; strHomeTeam: string; strAwayTeam: string; strTimestamp: string; intRound: string; strSeason: string };

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString().replace(/\.\d{3}Z$/, '');
const ev = (id: string, round: string, hours: number): Ev => ({ idEvent: id, strHomeTeam: `H${id}`, strAwayTeam: `A${id}`, strTimestamp: inHours(hours), intRound: round, strSeason: '2026-2027' });

type Handler = (url: string) => { status: number; body?: unknown };

/** Replaces global fetch; records every URL and the maximum number of in-flight requests. */
function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    const r = handler(url);
    return new Response(r.body === undefined ? 'error code: 1015' : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { calls, max: () => maxInFlight };
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  TSDB_PACING.gapMs = 0;
  TSDB_PACING.retryMs = 0;
  delete process.env.FOOTBALL_DATA_KEY;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('retries once after a 429 and then succeeds', async () => {
  let first = true;
  const f = fakeFetch((url) => {
    if (first) {
      first = false;
      return { status: 429 };
    }
    if (url.includes('eventsnextleague.php?id=4332')) return { status: 200, body: { events: [ev('1', '3', 5)] } };
    if (url.includes('eventsround.php?id=4332')) return { status: 200, body: { events: [ev('1', '3', 5)] } };
    return { status: 200, body: { events: null } };
  });
  const items = await loadFixtures(openDb(':memory:'), 7, true);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'tsdb:1');
  assert.equal(fixtureState.error, null);
  assert.equal(f.calls.filter((u) => u.includes('eventsnextleague.php?id=4332')).length, 2);
});

test('a persistent 429 surfaces an error instead of an empty calendar', async () => {
  fakeFetch(() => ({ status: 429 }));
  const items = await loadFixtures(openDb(':memory:'), 7, true);
  assert.deepEqual(items, []);
  assert.equal(fixtureState.count, 0);
  assert.match(fixtureState.error ?? '', /limite richieste/);
});

test('a 429 after some leagues keeps the partial calendar and reports it', async () => {
  fakeFetch((url) => {
    if (url.includes('eventsnextleague.php?id=4332')) return { status: 200, body: { events: [ev('1', '3', 5)] } };
    if (url.includes('eventsround.php?id=4332')) return { status: 200, body: { events: [ev('1', '3', 5), ev('2', '3', 6)] } };
    return { status: 429 };
  });
  const items = await loadFixtures(openDb(':memory:'), 7, true);
  assert.deepEqual(items.map((i) => i.id), ['tsdb:1', 'tsdb:2']);
  assert.match(fixtureState.error ?? '', /parziale/);
});

test('fetches every round inside the window, sequentially, without duplicates', async () => {
  const f = fakeFetch((url) => {
    if (url.includes('eventsnextleague.php?id=4332')) return { status: 200, body: { events: [ev('1', '3', 5), ev('3', '4', 100), ev('9', '9', 24 * 30)] } };
    if (url.includes('eventsround.php?id=4332&r=3')) return { status: 200, body: { events: [ev('1', '3', 5), ev('2', '3', 6)] } };
    if (url.includes('eventsround.php?id=4332&r=4')) return { status: 200, body: { events: [ev('3', '4', 100), ev('4', '4', 101)] } };
    return { status: 200, body: { events: null } };
  });
  const items = await loadFixtures(openDb(':memory:'), 7, true);
  assert.deepEqual(items.map((i) => i.id), ['tsdb:1', 'tsdb:2', 'tsdb:3', 'tsdb:4']);
  assert.equal(f.max(), 1, 'requests must not overlap');
  assert.equal(f.calls.filter((u) => u.includes('r=9')).length, 0, 'rounds outside the window are not fetched');
});
