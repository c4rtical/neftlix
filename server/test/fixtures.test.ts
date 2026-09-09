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

test('concurrent cold-cache calls share one in-flight run instead of doubling requests', async () => {
  const league = (url: string) => {
    if (url.includes('eventsnextleague.php?id=4332')) return { status: 200, body: { events: [ev('1', '3', 5)] } };
    if (url.includes('eventsround.php?id=4332')) return { status: 200, body: { events: [ev('1', '3', 5)] } };
    return { status: 200, body: { events: null } };
  };

  // Learn how many calls one pass makes.
  const solo = fakeFetch(league);
  const soloItems = await loadFixtures(openDb(':memory:'), 7, true);
  assert.equal(soloItems.length, 1);
  const callsPerPass = solo.calls.length;

  // Two concurrent cold-cache callers must join the same in-flight run.
  const f = fakeFetch(league);
  const db = openDb(':memory:');
  const [a, b] = await Promise.all([loadFixtures(db, 7, true), loadFixtures(db, 7, true)]);
  assert.equal(f.calls.length, callsPerPass, 'the second concurrent call must not repeat the paced loop');
  assert.equal(a, b, 'both callers get the same result array');
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

const espnEvent = (id: string, hours: number, state: 'pre' | 'in' | 'post', name = 'STATUS_SCHEDULED', home = 'Napoli', away = 'AC Milan') => ({
  id,
  date: new Date(Date.now() + hours * 3600_000).toISOString(),
  status: { type: { name, state } },
  competitions: [
    {
      competitors: [
        { homeAway: 'home', team: { displayName: home, logo: 'https://a.espncdn.com/h.png' } },
        { homeAway: 'away', team: { displayName: away, logo: 'https://a.espncdn.com/a.png' } },
      ],
    },
  ],
});

test('falls back to ESPN when TheSportsDB is rate-limited, mapping statuses and leagues', async () => {
  const f = fakeFetch((url) => {
    if (url.includes('thesportsdb.com')) return { status: 429 };
    if (url.includes('espn.com') && url.includes('/ita.1/')) {
      return {
        status: 200,
        body: {
          events: [
            espnEvent('1', 5, 'pre'),
            espnEvent('2', -1, 'in', 'STATUS_SECOND_HALF', 'Inter', 'Juventus'),
            espnEvent('3', -3, 'post', 'STATUS_FULL_TIME', 'Roma', 'Lazio'),
            espnEvent('4', 30, 'pre', 'STATUS_POSTPONED', 'Genoa', 'Pisa'),
          ],
        },
      };
    }
    if (url.includes('espn.com') && url.includes('/uefa.champions/')) return { status: 200, body: { events: [espnEvent('5', 8, 'pre', 'STATUS_SCHEDULED', 'Barcelona', 'Feyenoord Rotterdam')] } };
    if (url.includes('espn.com')) return { status: 200, body: { events: [] } };
    return { status: 404 };
  });
  const items = await loadFixtures(openDb(':memory:'), 7, true);
  assert.deepEqual(
    items.map((i) => [i.id, i.competitionCode, i.status]),
    [
      ['espn:3', 'SA', 'FINISHED'],
      ['espn:2', 'SA', 'IN_PLAY'],
      ['espn:1', 'SA', 'SCHEDULED'],
      ['espn:5', 'CL', 'SCHEDULED'],
      ['espn:4', 'SA', 'POSTPONED'],
    ],
  );
  const first = items.find((i) => i.id === 'espn:1')!;
  assert.equal(first.source, 'espn');
  assert.equal(first.home, 'Napoli');
  assert.equal(first.away, 'AC Milan');
  assert.equal(first.competition, 'Serie A');
  assert.equal(first.homeCrest, 'https://a.espncdn.com/h.png');
  assert.match(fixtureState.source ?? '', /ESPN/);
  assert.equal(fixtureState.error, null);
  assert.equal(f.calls.filter((u) => u.includes('espn.com')).length, 8, 'one scoreboard request per league');
});

test('uses ESPN when TheSportsDB answers but has no events', async () => {
  fakeFetch((url) => {
    if (url.includes('thesportsdb.com')) return { status: 200, body: { events: null } };
    if (url.includes('espn.com') && url.includes('/eng.1/')) return { status: 200, body: { events: [espnEvent('9', 4, 'pre', 'STATUS_SCHEDULED', 'Arsenal', 'Chelsea')] } };
    if (url.includes('espn.com')) return { status: 200, body: { events: [] } };
    return { status: 404 };
  });
  const items = await loadFixtures(openDb(':memory:'), 7, true);
  assert.deepEqual(items.map((i) => [i.id, i.competitionCode]), [['espn:9', 'PL']]);
  assert.match(fixtureState.source ?? '', /ESPN/);
});

test('reports both sources when TheSportsDB and ESPN fail', async () => {
  fakeFetch((url) => (url.includes('espn.com') ? { status: 503 } : { status: 429 }));
  const items = await loadFixtures(openDb(':memory:'), 7, true);
  assert.deepEqual(items, []);
  assert.match(fixtureState.error ?? '', /limite richieste/);
  assert.match(fixtureState.error ?? '', /ESPN/);
});
