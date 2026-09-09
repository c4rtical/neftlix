// Official football fixtures (date, time, teams, competition) from a sports data API,
// then mapped onto the provider's EPG to find the live channel. Replays never match
// because we only look at programmes that start around the official kick-off.

import type { Db } from './db.ts';
import { now } from './db.ts';

export type Fixture = {
  id: string;
  source: 'football-data' | 'thesportsdb';
  competition: string;
  competitionCode: string;
  home: string;
  away: string;
  start: number; // unix, official kick-off
  status: string; // SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED | POSTPONED ...
  homeCrest?: string | null;
  awayCrest?: string | null;
};

/** Competitions shown on the home "Sport adesso" strip. */
export const MAIN_COMPETITIONS = new Set(['SA', 'CI', 'PL', 'PD', 'BL1', 'CL', 'EL']);

export type FixtureState = { source: string | null; lastRun: number | null; count: number; error: string | null };
export const fixtureState: FixtureState = { source: null, lastRun: null, count: 0, error: null };

const CACHE_TTL = 3 * 3600;
/** After a failed or partial load, try again soon instead of showing a stale/empty calendar for hours. */
const ERROR_TTL = 5 * 60;
let cache: { until: number; items: Fixture[] } | null = null;
let inflight: Promise<Fixture[]> | null = null;

// ---------- football-data.org (official, free key) ----------

const FD_BASE = 'https://api.football-data.org/v4';

type FdMatch = {
  id: number;
  utcDate: string;
  status: string;
  competition: { name: string; code: string };
  homeTeam: { name: string; shortName?: string; crest?: string };
  awayTeam: { name: string; shortName?: string; crest?: string };
};

async function fetchFootballData(key: string, days: number): Promise<Fixture[]> {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date();
  to.setUTCDate(to.getUTCDate() + days);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const res = await fetch(`${FD_BASE}/matches?dateFrom=${iso(from)}&dateTo=${iso(to)}`, {
    headers: { 'X-Auth-Token': key },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 403 || res.status === 400) throw new Error('Chiave football-data.org non valida');
  if (res.status === 429) throw new Error('football-data.org: limite richieste raggiunto, riprova tra un minuto');
  if (!res.ok) throw new Error(`football-data.org HTTP ${res.status}`);
  const data = (await res.json()) as { matches?: FdMatch[] };
  return (data.matches ?? []).map((m) => ({
    id: `fd:${m.id}`,
    source: 'football-data' as const,
    competition: m.competition.name,
    competitionCode: m.competition.code,
    home: m.homeTeam.shortName || m.homeTeam.name,
    away: m.awayTeam.shortName || m.awayTeam.name,
    start: Math.floor(Date.parse(m.utcDate) / 1000),
    status: m.status,
    homeCrest: m.homeTeam.crest ?? null,
    awayCrest: m.awayTeam.crest ?? null,
  }));
}

// ---------- TheSportsDB (keyless fallback, round-based) ----------

const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const TSDB_LEAGUES: { id: string; code: string; name: string }[] = [
  { id: '4332', code: 'SA', name: 'Serie A' },
  { id: '4506', code: 'CI', name: 'Coppa Italia' },
  { id: '4480', code: 'CL', name: 'UEFA Champions League' },
  { id: '4481', code: 'EL', name: 'UEFA Europa League' },
  { id: '4328', code: 'PL', name: 'Premier League' },
  { id: '4335', code: 'PD', name: 'La Liga' },
  { id: '4331', code: 'BL1', name: 'Bundesliga' },
  { id: '4334', code: 'FL1', name: 'Ligue 1' },
];

type TsdbEvent = {
  idEvent: string;
  strHomeTeam: string;
  strAwayTeam: string;
  strTimestamp: string | null;
  dateEvent: string | null;
  strTime: string | null;
  intRound: string | null;
  strSeason: string | null;
  strStatus: string | null;
  strPostponed?: string | null;
  strHomeTeamBadge?: string | null;
  strAwayTeamBadge?: string | null;
};

/** The free tier rejects bursts with HTTP 429: space requests out and retry once. Tests set both to 0. */
export const TSDB_PACING = { gapMs: 1500, retryMs: 5000 };
const TSDB_LIMIT_MSG = 'TheSportsDB: limite richieste del piano gratuito raggiunto. Riprova tra qualche minuto o imposta una chiave football-data.org nelle impostazioni';

class TsdbRateLimited extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastTsdbAt = 0;

/** One paced request. Network/HTTP errors yield null (skip the league); a repeated 429 throws TsdbRateLimited. */
async function tsdb<T>(path: string): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastTsdbAt + TSDB_PACING.gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastTsdbAt = Date.now();
    let res: Response;
    try {
      res = await fetch(`${TSDB_BASE}/${path}`, { signal: AbortSignal.timeout(20_000) });
    } catch {
      return null;
    }
    if (res.status === 429) {
      if (attempt > 0) throw new TsdbRateLimited();
      await sleep(TSDB_PACING.retryMs);
      continue;
    }
    if (!res.ok) return null;
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
}

function tsdbToFixture(e: TsdbEvent, league: { code: string; name: string }): Fixture | null {
  const ts = e.strTimestamp ? Date.parse(e.strTimestamp.endsWith('Z') ? e.strTimestamp : `${e.strTimestamp}Z`) : NaN;
  if (!Number.isFinite(ts)) return null;
  return {
    id: `tsdb:${e.idEvent}`,
    source: 'thesportsdb',
    competition: league.name,
    competitionCode: league.code,
    home: e.strHomeTeam,
    away: e.strAwayTeam,
    start: Math.floor(ts / 1000),
    status: e.strPostponed === 'yes' ? 'POSTPONED' : e.strStatus === 'Match Finished' ? 'FINISHED' : 'SCHEDULED',
    homeCrest: e.strHomeTeamBadge ?? null,
    awayCrest: e.strAwayTeamBadge ?? null,
  };
}

async function fetchTheSportsDb(days: number): Promise<Fixture[]> {
  const from = now() - 86400;
  const to = now() + days * 86400;
  const out: Fixture[] = [];
  const seen = new Set<string>();
  const add = (e: TsdbEvent, league: { code: string; name: string }) => {
    const f = tsdbToFixture(e, league);
    if (f && f.start >= from && f.start <= to && !seen.has(f.id)) {
      seen.add(f.id);
      out.push(f);
    }
  };
  let rateLimited = false;
  // Leagues one after another, on purpose: the free tier rejects parallel bursts.
  for (const league of TSDB_LEAGUES) {
    try {
      const next = await tsdb<{ events: TsdbEvent[] | null }>(`eventsnextleague.php?id=${league.id}`);
      const events = next?.events ?? [];
      for (const e of events) add(e, league);
      // "Next" is capped at 15 events, so complete every round that starts inside the window.
      const rounds = new Map<string, { round: string; season: string }>();
      for (const e of events) {
        const f = tsdbToFixture(e, league);
        if (f && f.start <= to && e.intRound && e.strSeason) rounds.set(`${e.strSeason}/${e.intRound}`, { round: e.intRound, season: e.strSeason });
      }
      for (const r of rounds.values()) {
        const list = await tsdb<{ events: TsdbEvent[] | null }>(`eventsround.php?id=${league.id}&r=${r.round}&s=${encodeURIComponent(r.season)}`);
        for (const e of list?.events ?? []) add(e, league);
      }
    } catch (e) {
      if (!(e instanceof TsdbRateLimited)) throw e;
      rateLimited = true;
      break;
    }
  }
  if (rateLimited) {
    if (out.length === 0) throw new Error(TSDB_LIMIT_MSG);
    fixtureState.error = `${TSDB_LIMIT_MSG} (calendario parziale)`;
  }
  return out;
}

// ---------- Public API ----------

export function getFixturesKey(db: Db): string | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'football_data_key'`).get() as { value: string } | undefined;
  return row?.value || process.env.FOOTBALL_DATA_KEY || null;
}

export function setFixturesKey(db: Db, key: string | null) {
  if (key) db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('football_data_key', ?)`).run(key.trim());
  else db.prepare(`DELETE FROM meta WHERE key = 'football_data_key'`).run();
  cache = null;
}

export async function loadFixtures(db: Db, days = 7, force = false): Promise<Fixture[]> {
  if (!force && cache && now() < cache.until) return cache.items;
  // Two cold-cache callers (e.g. Home's sport strip and the Sport page) must share one paced
  // run instead of doubling the request rate; a `force` caller while one is in flight just joins it.
  if (inflight) return inflight;
  const run = async (): Promise<Fixture[]> => {
    const key = getFixturesKey(db);
    let items: Fixture[] = [];
    fixtureState.error = null;
    try {
      if (key) {
        items = await fetchFootballData(key, days);
        fixtureState.source = 'football-data.org';
      } else {
        items = await fetchTheSportsDb(days);
        fixtureState.source = 'TheSportsDB (senza chiave)';
      }
    } catch (e) {
      const keyError = e instanceof Error ? e.message : String(e);
      fixtureState.error = keyError;
      if (key) {
        // Key problem: fall back so the page still works.
        try {
          items = await fetchTheSportsDb(days);
          fixtureState.source = 'TheSportsDB (fallback)';
          // fetchTheSportsDb may have overwritten fixtureState.error with a partial-calendar
          // message; keep the key error too, so the user still sees why the key failed.
          const partial = fixtureState.error !== keyError ? fixtureState.error : null;
          fixtureState.error = `${keyError}${partial ? ` · ${partial}` : ''}`;
        } catch {
          /* keep error */
        }
      }
    }
    items.sort((a, b) => a.start - b.start);
    cache = { until: now() + (fixtureState.error ? ERROR_TTL : CACHE_TTL), items };
    fixtureState.lastRun = now();
    fixtureState.count = items.length;
    return items;
  };
  inflight = run();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

// ---------- Fixture → EPG channel matching ----------

const STOPWORDS = new Set(['fc', 'ac', 'as', 'ssc', 'us', 'cf', 'sc', 'afc', 'cfc', 'ss', 'sv', 'vfb', 'vfl', 'rb', 'tsg', 'sd', 'ud', 'rcd', 'club', 'calcio', 'de', 'di', 'the', 'city', 'united', 'town', 'real', 'athletic', 'atletico', 'sporting', 'olympique', 'stade', 'racing', 'deportivo', 'football', 'hotspur', 'wanderers', 'albion', 'rovers', 'cp', 'sk', 'fk', 'bk', 'if', 'osc', 'ogc']);

// Italian EPG spellings for foreign clubs, and short names for Italian ones.
const ALIASES: Record<string, string[]> = {
  barcelona: ['barcellona'],
  'bayern munchen': ['bayern', 'monaco'],
  bayern: ['monaco'],
  'paris saint germain': ['psg', 'paris'],
  psg: ['paris'],
  internazionale: ['inter'],
  inter: ['internazionale'],
  'manchester city': ['man city', 'city'],
  'manchester united': ['man utd', 'man united', 'united'],
  tottenham: ['spurs'],
  'sporting cp': ['sporting lisbona', 'sporting'],
  stuttgart: ['stoccarda'],
  koln: ['colonia'],
  'borussia monchengladbach': ['gladbach', 'monchengladbach'],
  'borussia dortmund': ['dortmund'],
  'atletico madrid': ['atletico'],
  'athletic bilbao': ['bilbao', 'athletic'],
  'bayer leverkusen': ['leverkusen'],
  'eintracht frankfurt': ['francoforte', 'frankfurt'],
  'red bull salzburg': ['salisburgo', 'salzburg'],
  marseille: ['marsiglia'],
  lyon: ['lione'],
  'club brugge': ['bruges', 'brugge'],
  benfica: ['benfica'],
  porto: ['porto'],
  napoli: ['napoli'],
  juventus: ['juve'],
  roma: ['roma'],
  lazio: ['lazio'],
  milan: ['milan'],
  atalanta: ['atalanta'],
  fiorentina: ['fiorentina'],
  hellas: ['verona'],
  'hellas verona': ['verona', 'hellas'],
  psv: ['psv', 'eindhoven'],
  ajax: ['ajax'],
  feyenoord: ['feyenoord'],
  celtic: ['celtic'],
  rangers: ['rangers'],
  galatasaray: ['galatasaray'],
  fenerbahce: ['fenerbahce'],
  'dinamo zagreb': ['dinamo zagabria', 'zagabria'],
  'crvena zvezda': ['stella rossa'],
  'slovan bratislava': ['slovan'],
  'sparta praha': ['sparta praga', 'sparta'],
  'slavia praha': ['slavia praga', 'slavia'],
  'shakhtar donetsk': ['shakhtar'],
  'young boys': ['young boys'],
  monaco: ['monaco'],
  sevilla: ['siviglia'],
  'real sociedad': ['real sociedad', 'sociedad'],
  villarreal: ['villarreal'],
  girona: ['girona'],
  lille: ['lilla', 'lille'],
  brest: ['brest'],
  'aston villa': ['aston villa', 'villa'],
  liverpool: ['liverpool'],
  arsenal: ['arsenal'],
  chelsea: ['chelsea'],
  newcastle: ['newcastle'],
  'nottingham forest': ['nottingham', 'forest'],
  'west ham': ['west ham'],
  'union saint gilloise': ['union sg', 'union saint gilloise', 'union'],
  bodo: ['bodo glimt', 'bodo'],
  'bodo glimt': ['bodo'],
  qarabag: ['qarabag'],
  kairat: ['kairat'],
  pafos: ['pafos'],
  copenhagen: ['copenaghen', 'kobenhavn'],
  olympiakos: ['olympiacos', 'olympiakos'],
  'olympiacos piraeus': ['olympiacos', 'olympiakos'],
};

export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Significant tokens used to recognise a team inside an EPG title. */
export function teamKeys(name: string): string[] {
  const n = normName(name);
  const keys = new Set<string>();
  keys.add(n);
  const tokens = n.split(' ').filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  for (const t of tokens) keys.add(t);
  for (const [k, aliases] of Object.entries(ALIASES)) {
    if (n === k || n.includes(k) || tokens.includes(k)) for (const a of aliases) keys.add(a);
  }
  return [...keys].filter((k) => k.length >= 3);
}

function titleHasTeam(title: string, keys: string[]): boolean {
  const t = ` ${normName(title)} `;
  return keys.some((k) => t.includes(` ${k} `) || t.includes(` ${k}`) && k.length >= 5);
}

const SPORT_CATEGORY_RE = /sport|calcio|dazn|eurosport|football|soccer|campionato|serie [ab]\b|champions|europa league|conference/i;

export type FixtureChannel = { id: number; name: string; logo: string | null; programme: string; start: number };

function channelBase(name: string): string {
  return normName(name.replace(/\b(HD|FHD|UHD|4K|SAT|HEVC|H265|\+|SD|HQ)\b/gi, ''));
}

/** Programmes on sport channels starting within [-25 min, +40 min] of kick-off whose title names both teams. */
export function channelsForFixture(db: Db, f: Fixture, sportCatIds: string[]): FixtureChannel[] {
  const rows = db
    .prepare(
      `SELECT p.title, p.start, l.id, l.name, l.logo
       FROM epg_programme p JOIN live_channel l ON l.epg_channel_id = p.channel_id
       WHERE l.category_id IN (SELECT value FROM json_each(?)) AND p.start BETWEEN ? AND ?
       ORDER BY l.num`,
    )
    .all(JSON.stringify(sportCatIds), f.start - 25 * 60, f.start + 40 * 60) as { title: string; start: number; id: number; name: string; logo: string | null }[];
  const hk = teamKeys(f.home);
  const ak = teamKeys(f.away);
  const out: FixtureChannel[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!titleHasTeam(r.title, hk) || !titleHasTeam(r.title, ak)) continue;
    const base = channelBase(r.name);
    if (seen.has(base)) continue;
    seen.add(base);
    out.push({ id: r.id, name: r.name, logo: r.logo, programme: r.title, start: r.start });
  }
  return out;
}

export function sportCategoryIds(db: Db): string[] {
  return (db.prepare(`SELECT id, name FROM category WHERE kind = 'live'`).all() as { id: string; name: string }[])
    .filter((c) => SPORT_CATEGORY_RE.test(c.name))
    .map((c) => c.id);
}

/** Live categories that likely carry Serie A when the EPG cannot tell us the channel (DAZN has no guide). */
export function fallbackCategories(db: Db): { id: string; name: string }[] {
  return (db.prepare(`SELECT id, name FROM category WHERE kind = 'live' ORDER BY position`).all() as { id: string; name: string }[]).filter((c) => /dazn/i.test(c.name));
}
