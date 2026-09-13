import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import { TSDB_PACING } from '../src/fixtures.ts';
import { channelsForEvent, espnF1ToEvents, espnTennisToEvents, eventState, loadEvents, parseTsdbSession, resetEventsCache, tsdbToEvent } from '../src/events.ts';
import type { SportEvent } from '../src/events.ts';

const T = 1_800_000_000; // a fixed instant, seconds
const iso = (unix: number) => new Date(unix * 1000).toISOString();
const tsdbTs = (unix: number) => iso(unix).replace(/\.\d{3}Z$/, '');

test('parses TheSportsDB session names, drops tests and MotoGP Q2', () => {
  assert.deepEqual(parseTsdbSession('San Marino Free Practice 1'), { session: 'practice', label: 'Prove libere 1', round: 1 });
  assert.deepEqual(parseTsdbSession('Austria Practice'), { session: 'practice', label: 'Prove libere' });
  assert.deepEqual(parseTsdbSession('San Marino Qualifying 1'), { session: 'qualifying', label: 'Qualifiche' });
  assert.equal(parseTsdbSession('San Marino Qualifying 2'), null);
  assert.deepEqual(parseTsdbSession('Spanish Grand Prix Qualifying'), { session: 'qualifying', label: 'Qualifiche' });
  assert.deepEqual(parseTsdbSession('Chinese Grand Prix Sprint Qualifying'), { session: 'sprintqualifying', label: 'Sprint Shootout' });
  assert.deepEqual(parseTsdbSession('Chinese Grand Prix Sprint'), { session: 'sprint', label: 'Sprint' });
  assert.deepEqual(parseTsdbSession('Austria Sprint Race'), { session: 'sprint', label: 'Sprint' });
  assert.deepEqual(parseTsdbSession('Austria GP'), { session: 'race', label: 'Gara' });
  assert.deepEqual(parseTsdbSession('Spanish Grand Prix'), { session: 'race', label: 'Gara' });
  assert.equal(parseTsdbSession('Bahrain Testing 1 Day 2'), null);
  assert.equal(parseTsdbSession('Valencia Test'), null);
});

test('TheSportsDB events get an Italian GP title and EPG keys', () => {
  const ev = tsdbToEvent('motogp', { idEvent: '1', strEvent: 'San Marino GP', strTimestamp: tsdbTs(T), intRound: '14', strSeason: '2026', strStatus: '' })!;
  assert.equal(ev.title, 'GP San Marino');
  assert.equal(ev.session, 'race');
  assert.equal(ev.start, T);
  assert.equal(ev.stop, T + 75 * 60);
  assert.ok(ev.keys.includes('misano') && ev.keys.includes('san marino'));
  const f1 = tsdbToEvent('f1', { idEvent: '2', strEvent: 'Azerbaijan Grand Prix Practice 2', strTimestamp: tsdbTs(T), intRound: '15', strSeason: '2026', strStatus: 'FT' })!;
  assert.equal(f1.title, 'GP Azerbaijan');
  assert.equal(f1.status, 'FINISHED');
  assert.equal(f1.round, 2);
  // Unknown venue: the name minus the session, its words as keys.
  const other = tsdbToEvent('f1', { idEvent: '3', strEvent: 'Atlantis Grand Prix', strTimestamp: tsdbTs(T), intRound: '1', strSeason: '2026', strStatus: '' })!;
  assert.equal(other.title, 'Atlantis');
  assert.deepEqual(other.keys, ['atlantis']);
});

test('ESPN F1 weekends become one event per session, sponsor stripped from the title', () => {
  const items = espnF1ToEvents({
    events: [
      {
        id: '600057443',
        name: 'Tag Heuer Spanish Grand Prix',
        competitions: [
          { date: iso(T - 2 * 86400), type: { abbreviation: 'FP1' }, status: { type: { state: 'post' } } },
          { date: iso(T - 86400), type: { abbreviation: 'Qual' }, status: { type: { state: 'post' } } },
          { date: iso(T), type: { abbreviation: 'Race' }, status: { type: { state: 'in' } } },
        ],
      },
    ],
  });
  assert.deepEqual(
    items.map((e) => [e.title, e.session, e.sessionLabel, e.status]),
    [
      ['GP Spagna', 'practice', 'Prove libere 1', 'FINISHED'],
      ['GP Spagna', 'qualifying', 'Qualifiche', 'FINISHED'],
      ['GP Spagna', 'race', 'Gara', 'IN_PLAY'],
    ],
  );
  assert.equal(items[2].stop, T + 120 * 60);
});

test('tennis keeps Slams and the main tournaments once, with both tours', () => {
  const us = { id: '189-2026', name: 'US Open', date: iso(T - 5 * 86400), endDate: iso(T + 9 * 86400), major: true, status: { type: { state: 'in' } } };
  const items = espnTennisToEvents([
    {
      tour: 'ATP',
      data: { events: [us, { id: '315-2026', name: 'Rolex Shanghai Masters', date: iso(T + 20 * 86400), endDate: iso(T + 32 * 86400), major: false }, { id: '441-2026', name: 'Chengdu Open', date: iso(T), endDate: iso(T + 7 * 86400), major: false }] },
    },
    { tour: 'WTA', data: { events: [us, { id: '1024-2026', name: 'Caldas da Rainha Ladies Open', date: iso(T), endDate: iso(T + 7 * 86400), major: false }] } },
  ]);
  assert.deepEqual(
    items.map((e) => [e.title, e.sessionLabel, e.status]),
    [
      ['US Open', 'ATP · WTA', 'IN_PLAY'],
      ['Shanghai', 'ATP', 'SCHEDULED'],
    ],
  );
  assert.equal(items[0].session, 'tournament');
});

// ---------- EPG matching ----------

function seedDb() {
  const db = openDb(':memory:');
  const cat = db.prepare(`INSERT INTO category (id, kind, name, position) VALUES (?, 'live', ?, 0)`);
  cat.run('505', 'Sport Skynet');
  cat.run('900', 'Italia');
  const ch = db.prepare(`INSERT INTO live_channel (id, name, logo, category_id, epg_channel_id, num) VALUES (?, ?, NULL, ?, ?, ?)`);
  const prog = db.prepare(`INSERT INTO epg_programme (channel_id, start, stop, title) VALUES (?, ?, ?, ?)`);
  let n = 0;
  const channel = (id: number, name: string, epg: string, cat = '505') => ch.run(id, name, cat, epg, ++n);
  const air = (epg: string, start: number, title: string, minutes = 120) => prog.run(epg, start, start + minutes * 60, title);
  return { db, channel, air };
}

const race = (sport: 'f1' | 'motogp', title: string, keys: string[], start: number, session: SportEvent['session'] = 'race', round?: number): SportEvent => ({
  id: `${sport}:${session}`,
  sport,
  source: 'espn',
  title,
  name: title,
  session,
  sessionLabel: session,
  round,
  start,
  stop: start + 7200,
  status: 'SCHEDULED',
  keys,
});

test('F1 race: finds the session on F1 channels and on generic channels that name the GP, skips MotoGP, support series and studio shows', () => {
  const { db, channel, air } = seedDb();
  channel(1, 'Sky Sport F1 HD', 'SkySportF1.it');
  channel(2, 'Sky Sport F1 FHD', 'SkySportF1.it');
  channel(3, 'Sky Sport Uno HD', 'SkySportUno.it');
  channel(4, 'TV8 HD', 'TV8.it', '900');
  channel(5, 'Sky Sport MotoGP HD', 'SkySportMotoGP.it');
  channel(6, 'RSI La2 HD', 'RSILa2.ch', '900');
  channel(7, 'Sky Sport Arena HD', 'SkySportArena.it');
  const f1 = T;
  air('SkySportF1.it', f1, 'LIVE: GP Spagna: Gara');
  air('SkySportUno.it', f1 - 10 * 60, 'LIVE: Formula 1: GP Spagna: Gara');
  air('TV8.it', f1 - 5 * 60, 'GP Madrid: Gara'); // generic channel, names the GP with the city
  air('SkySportMotoGP.it', f1 - 20 * 60, 'LIVE: MotoGP: GP San Marino e Riviera di Rimini: Gara');
  air('RSILa2.ch', f1 - 25 * 60, 'Moto3: GP San Marino e Riviera di Rimini: Gara');
  air('SkySportArena.it', f1 + 5 * 60, 'Madrid: Feature Race'); // F2
  air('SkySportF1.it', f1 - 90 * 60, 'F1 Paddock Live Pre Gara');
  const ev = race('f1', 'GP Spagna', ['spagna', 'madrid', 'jerez'], f1);
  const found = channelsForEvent(db, ev, f1 - 3600);
  assert.deepEqual(
    found.map((c) => c.name),
    ['Sky Sport F1 HD', 'Sky Sport Uno HD', 'TV8 HD'],
  );
  // The same guide, seen from the MotoGP race an hour earlier, only yields the MotoGP channel.
  const moto = race('motogp', 'GP San Marino', ['san marino', 'misano', 'rimini'], f1 - 20 * 60);
  assert.deepEqual(
    channelsForEvent(db, moto, f1 - 3600).map((c) => c.name),
    ['Sky Sport MotoGP HD'],
  );
});

test('sessions are told apart by their word in the title, practice also by number', () => {
  const { db, channel, air } = seedDb();
  channel(1, 'Sky Sport F1 HD', 'SkySportF1.it');
  air('SkySportF1.it', T, 'GP Austria: Qualifiche', 60);
  air('SkySportF1.it', T + 10 * 60, 'GP Austria: Sprint', 60);
  air('SkySportF1.it', T + 20 * 60, 'GP Austria: Prove Libere 2', 60);
  const keys = ['austria', 'spielberg'];
  assert.equal(channelsForEvent(db, race('f1', 'GP Austria', keys, T, 'qualifying'), T - 3600)[0]?.programme, 'GP Austria: Qualifiche');
  assert.equal(channelsForEvent(db, race('f1', 'GP Austria', keys, T, 'sprint'), T - 3600)[0]?.programme, 'GP Austria: Sprint');
  assert.equal(channelsForEvent(db, race('f1', 'GP Austria', keys, T, 'practice', 2), T - 3600)[0]?.programme, 'GP Austria: Prove Libere 2');
  assert.equal(channelsForEvent(db, race('f1', 'GP Austria', keys, T, 'practice', 1), T - 3600).length, 0);
  assert.equal(channelsForEvent(db, race('f1', 'GP Austria', keys, T, 'race'), T - 3600).length, 0);
});

test('a generic channel that names neither sport nor GP is accepted only within 15 minutes', () => {
  const { db, channel, air } = seedDb();
  channel(1, 'TV8 HD', 'TV8.it', '900');
  air('TV8.it', T + 25 * 60, 'Gara');
  const ev = race('f1', 'GP Spagna', ['spagna'], T);
  assert.equal(channelsForEvent(db, ev, T).length, 0);
  air('TV8.it', T + 10 * 60, 'LIVE: Gara');
  assert.equal(channelsForEvent(db, ev, T).length, 1);
});

test('tennis: channels airing the tournament now or in the next 24 hours, not the snooker or the F1 with the same city', () => {
  const { db, channel, air } = seedDb();
  channel(1, 'Sky Sport Tennis HD', 'SkySportTennis.it');
  channel(2, 'Sky Sport Tennis FHD', 'SkySportTennis.it');
  channel(3, 'Supertennis HD', 'SuperTennis.it');
  channel(4, 'Eurosport 1 HD', 'Eurosport1.it');
  channel(5, 'Sky Sport F1 HD', 'SkySportF1.it');
  channel(6, 'Sky Sport Uno HD', 'SkySportUno.it');
  const at = T;
  air('SkySportTennis.it', at - 3600, 'US Open', 240);
  air('SuperTennis.it', at + 5 * 3600, 'Tennis: US Open', 180);
  air('Eurosport1.it', at + 3600, 'Snooker: English Open', 120);
  air('SkySportF1.it', at + 2 * 3600, 'GP Madrid: Gara', 120);
  air('SkySportUno.it', at + 30 * 3600, 'US Open', 120); // beyond 24 h
  air('SkySportUno.it', at - 5 * 3600, 'Tennis Us Open The Insider 2026 Ep.14', 30); // over already
  const us: SportEvent = { id: 't', sport: 'tennis', source: 'espn', title: 'US Open', name: 'US Open', session: 'tournament', sessionLabel: 'ATP · WTA', start: at - 5 * 86400, stop: at + 8 * 86400, status: 'IN_PLAY', keys: ['us open'] };
  assert.deepEqual(
    channelsForEvent(db, us, at).map((c) => [c.name, c.start <= at]),
    [
      ['Sky Sport Tennis HD', true],
      ['Supertennis HD', false],
    ],
  );
  const madrid: SportEvent = { ...us, id: 'm', title: 'Madrid', keys: ['madrid'], start: at - 86400 };
  assert.equal(channelsForEvent(db, madrid, at).length, 0);
  // Before the tournament starts (more than 6 hours) nothing is looked up.
  assert.equal(channelsForEvent(db, { ...us, start: at + 86400 }, at).length, 0);
});

// ---------- Loading ----------

type Handler = (url: string) => { status: number; body?: unknown };
function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    await new Promise((r) => setTimeout(r, 1));
    const r = handler(url);
    return new Response(r.body === undefined ? 'error code: 1015' : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return calls;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  TSDB_PACING.gapMs = 0;
  TSDB_PACING.retryMs = 0;
  resetEventsCache();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const soon = (h: number) => Math.floor(Date.now() / 1000) + h * 3600;
const motoRound = [
  { idEvent: 'm1', strEvent: 'Austria Free Practice 1', strTimestamp: tsdbTs(soon(20)), intRound: '15', strSeason: '2026', strStatus: null },
  { idEvent: 'm2', strEvent: 'Austria Qualifying 1', strTimestamp: tsdbTs(soon(44)), intRound: '15', strSeason: '2026', strStatus: null },
  { idEvent: 'm3', strEvent: 'Austria Qualifying 2', strTimestamp: tsdbTs(soon(45)), intRound: '15', strSeason: '2026', strStatus: null },
  { idEvent: 'm4', strEvent: 'Austria Sprint Race', strTimestamp: tsdbTs(soon(48)), intRound: '15', strSeason: '2026', strStatus: '' },
  { idEvent: 'm5', strEvent: 'Austria GP', strTimestamp: tsdbTs(soon(70)), intRound: '15', strSeason: '2026', strStatus: '' },
];
const f1Espn = { events: [{ id: 'gp', name: 'Qatar Airways Azerbaijan Grand Prix', competitions: [{ date: iso(soon(30)), type: { abbreviation: 'Qual' }, status: { type: { state: 'pre' } } }, { date: iso(soon(50)), type: { abbreviation: 'Race' }, status: { type: { state: 'pre' } } }] }] };
const tennisEspn = { events: [{ id: '959-2026', name: 'China Open', date: iso(soon(-24)), endDate: iso(soon(200)), major: false, status: { type: { state: 'in' } } }] };

test('merges ESPN (F1, tennis) and TheSportsDB (MotoGP), completing the MotoGP round with one paced call', async () => {
  const calls = fakeFetch((url) => {
    if (url.includes('racing/f1')) return { status: 200, body: f1Espn };
    if (url.includes('tennis/')) return { status: 200, body: tennisEspn };
    if (url.includes('eventsnextleague.php?id=4407')) return { status: 200, body: { events: [motoRound[0]] } };
    if (url.includes('eventspastleague.php?id=4407')) return { status: 200, body: { events: null } };
    if (url.includes('eventsround.php?id=4407&r=15')) return { status: 200, body: { events: motoRound } };
    return { status: 404, body: {} };
  });
  const items = await loadEvents(7);
  assert.deepEqual(
    items.map((e) => `${e.sport} ${e.title} ${e.sessionLabel}`),
    ['tennis Pechino ATP · WTA', 'motogp GP Austria Prove libere 1', 'f1 GP Azerbaijan Qualifiche', 'motogp GP Austria Qualifiche', 'motogp GP Austria Sprint', 'f1 GP Azerbaijan Gara', 'motogp GP Austria Gara'],
  );
  assert.equal(calls.filter((u) => u.includes('eventsround')).length, 1);
  assert.equal(eventState.error, null);
  assert.equal(eventState.source, 'ESPN + TheSportsDB (senza chiave)');
  assert.equal(eventState.count, 7);
});

test('falls back to TheSportsDB for F1 when ESPN fails, and keeps the other sports when one source breaks', async () => {
  fakeFetch((url) => {
    if (url.includes('racing/f1')) return { status: 500, body: {} };
    if (url.includes('tennis/')) return { status: 503, body: {} };
    if (url.includes('eventsnextleague.php?id=4370')) return { status: 200, body: { events: [{ idEvent: 'f1', strEvent: 'Azerbaijan Grand Prix', strTimestamp: tsdbTs(soon(50)), intRound: '15', strSeason: '2026', strStatus: '' }] } };
    if (url.includes('eventspastleague.php?id=4370')) return { status: 200, body: { events: null } };
    if (url.includes('eventsround.php?id=4370')) return { status: 200, body: { events: [{ idEvent: 'f1q', strEvent: 'Azerbaijan Grand Prix Qualifying', strTimestamp: tsdbTs(soon(30)), intRound: '15', strSeason: '2026', strStatus: '' }] } };
    if (url.includes('id=4407')) return { status: 200, body: { events: null } };
    return { status: 404, body: {} };
  });
  const items = await loadEvents(7);
  assert.deepEqual(
    items.map((e) => `${e.source} ${e.title} ${e.sessionLabel}`),
    ['thesportsdb GP Azerbaijan Qualifiche', 'thesportsdb GP Azerbaijan Gara'],
  );
  assert.match(eventState.error ?? '', /tennis: ESPN HTTP 503/);
  assert.match(eventState.error ?? '', /F1: ESPN HTTP 500 \(usato TheSportsDB\)/);
  assert.equal(eventState.source, 'TheSportsDB (senza chiave)');
});

test('a rate-limited TheSportsDB reports MotoGP as missing without hiding F1 and tennis', async () => {
  fakeFetch((url) => {
    if (url.includes('racing/f1')) return { status: 200, body: f1Espn };
    if (url.includes('tennis/')) return { status: 200, body: tennisEspn };
    return { status: 429 };
  });
  const items = await loadEvents(7);
  assert.deepEqual(items.map((e) => e.sport), ['tennis', 'f1', 'f1']);
  assert.match(eventState.error ?? '', /MotoGP: TheSportsDB: limite richieste/);
});
