// Motorsport sessions (Formula 1, MotoGP) and the main tennis tournaments, from the keyless
// sports APIs already used as football fallbacks, mapped onto the provider's EPG to find the
// channel that broadcasts them. The football-data.org key covers football only, so there is no
// keyed source here.

import type { Db } from './db.ts';
import { now } from './db.ts';
import type { FixtureChannel } from './fixtures.ts';
import { TsdbRateLimited, channelBase, normName, tsdb } from './fixtures.ts';

export type Sport = 'f1' | 'motogp' | 'tennis';
export type Session = 'practice' | 'qualifying' | 'sprintqualifying' | 'sprint' | 'race' | 'tournament';
export type EventStatus = 'SCHEDULED' | 'IN_PLAY' | 'FINISHED' | 'CANCELLED';

export type SportEvent = {
  id: string;
  sport: Sport;
  source: 'espn' | 'thesportsdb';
  /** Italian display name: "GP Spagna", "US Open". */
  title: string;
  /** Name as the source spells it: "Tag Heuer Spanish Grand Prix". */
  name: string;
  session: Session;
  /** "Gara", "Qualifiche", "Prove libere 1", or the tour ("ATP · WTA") for tennis. */
  sessionLabel: string;
  /** Practice number, when the session has one. */
  round?: number;
  start: number;
  stop: number;
  status: EventStatus;
  /** Normalised words that name the venue or tournament in Italian EPG titles. */
  keys: string[];
};

export const SPORT_NAMES: Record<Sport, string> = { f1: 'Formula 1', motogp: 'MotoGP', tennis: 'Tennis' };

export type EventState = { source: string | null; lastRun: number | null; count: number; error: string | null };
export const eventState: EventState = { source: null, lastRun: null, count: 0, error: null };

const CACHE_TTL = 3 * 3600;
const ERROR_TTL = 5 * 60;
let cache: { until: number; items: SportEvent[] } | null = null;
let inflight: Promise<SportEvent[]> | null = null;

// ---------- Venues: how the sources name a Grand Prix vs how Italian EPGs spell it ----------

type Venue = { it: string; en: RegExp; epg: string[] };

const GRANDS_PRIX: Venue[] = [
  { it: 'Australia', en: /australia/i, epg: ['australia', 'melbourne', 'phillip island'] },
  { it: 'Cina', en: /chin/i, epg: ['cina', 'shanghai'] },
  { it: 'Giappone', en: /japan/i, epg: ['giappone', 'suzuka', 'motegi'] },
  { it: 'Bahrain', en: /bahrain|sakhir/i, epg: ['bahrain', 'sakhir'] },
  { it: 'Arabia Saudita', en: /saudi/i, epg: ['arabia saudita', 'jeddah', 'gedda'] },
  { it: 'Miami', en: /miami/i, epg: ['miami'] },
  { it: 'Imola', en: /emilia|imola/i, epg: ['emilia romagna', 'imola'] },
  { it: 'Monaco', en: /monaco/i, epg: ['monaco', 'montecarlo', 'monte carlo'] },
  { it: 'Spagna', en: /spanish|spain|madrid|jerez/i, epg: ['spagna', 'madrid', 'jerez'] },
  { it: 'Barcellona', en: /barcelona|catalu/i, epg: ['barcellona', 'catalogna', 'catalunya', 'montmelo'] },
  { it: 'Canada', en: /canad/i, epg: ['canada', 'montreal'] },
  { it: 'Austria', en: /austria|styria/i, epg: ['austria', 'stiria', 'spielberg'] },
  { it: 'Gran Bretagna', en: /british|britain|silverstone/i, epg: ['gran bretagna', 'silverstone', 'inghilterra'] },
  { it: 'Ungheria', en: /hungar/i, epg: ['ungheria', 'budapest', 'hungaroring', 'balaton'] },
  { it: 'Belgio', en: /belgi/i, epg: ['belgio', 'spa'] },
  { it: 'Olanda', en: /dutch|netherlands/i, epg: ['olanda', 'zandvoort', 'assen', 'paesi bassi'] },
  { it: 'Italia', en: /italian|italy|mugello|monza/i, epg: ['italia', 'monza', 'mugello'] },
  { it: 'Azerbaijan', en: /azerbaijan/i, epg: ['azerbaijan', 'azerbaigian', 'baku'] },
  { it: 'Singapore', en: /singapore/i, epg: ['singapore'] },
  { it: 'Stati Uniti', en: /united states|\busa\b|americas|austin/i, epg: ['stati uniti', 'usa', 'austin', 'americhe', 'texas'] },
  { it: 'Messico', en: /mexic/i, epg: ['messico', 'mexico'] },
  { it: 'Brasile', en: /brazil|paulo/i, epg: ['brasile', 'san paolo', 'interlagos'] },
  { it: 'Las Vegas', en: /vegas/i, epg: ['las vegas'] },
  { it: 'Qatar', en: /qatar/i, epg: ['qatar', 'lusail', 'losail'] },
  { it: 'Abu Dhabi', en: /abu dhabi/i, epg: ['abu dhabi', 'yas marina'] },
  { it: 'Thailandia', en: /thai/i, epg: ['thailandia', 'buriram'] },
  { it: 'Argentina', en: /argentin/i, epg: ['argentina', 'termas'] },
  { it: 'Francia', en: /france|french|le mans/i, epg: ['francia', 'le mans'] },
  { it: 'Germania', en: /german|sachsenring/i, epg: ['germania', 'sachsenring'] },
  { it: 'Repubblica Ceca', en: /czech|brno/i, epg: ['repubblica ceca', 'brno', 'cechia'] },
  { it: 'Aragona', en: /aragon/i, epg: ['aragona', 'aragon', 'motorland'] },
  { it: 'San Marino', en: /san marino|misano|rimini/i, epg: ['san marino', 'misano', 'rimini'] },
  { it: 'Indonesia', en: /indonesia|mandalika/i, epg: ['indonesia', 'mandalika'] },
  { it: 'Malesia', en: /malaysia|sepang/i, epg: ['malesia', 'malaysia', 'sepang'] },
  { it: 'Portogallo', en: /portug|portimao|algarve/i, epg: ['portogallo', 'portimao', 'algarve'] },
  { it: 'Valencia', en: /valencia/i, epg: ['valencia', 'comunita valenciana'] },
  { it: 'India', en: /\bindia/i, epg: ['india', 'buddh'] },
  { it: 'Kazakistan', en: /kazakh/i, epg: ['kazakistan', 'kazakhstan'] },
];

// Only the main tournaments: the four Slams (ESPN flags them `major`), Masters 1000 and WTA 1000, the Finals, team cups.
const TOURNAMENTS: Venue[] = [
  { it: 'Australian Open', en: /australian open/i, epg: ['australian open', 'melbourne'] },
  { it: 'Roland Garros', en: /roland garros|french open/i, epg: ['roland garros', 'parigi', 'paris'] },
  { it: 'Wimbledon', en: /wimbledon/i, epg: ['wimbledon'] },
  { it: 'US Open', en: /\bus open/i, epg: ['us open'] },
  { it: 'Indian Wells', en: /indian wells/i, epg: ['indian wells'] },
  { it: 'Miami', en: /miami/i, epg: ['miami'] },
  { it: 'Montecarlo', en: /monte.?carlo/i, epg: ['montecarlo', 'monte carlo'] },
  { it: 'Madrid', en: /madrid/i, epg: ['madrid'] },
  { it: 'Roma', en: /rome|roma|internazionali/i, epg: ['roma', 'internazionali'] },
  { it: 'Canada', en: /canad|national bank|toronto|montreal/i, epg: ['canada', 'toronto', 'montreal'] },
  { it: 'Cincinnati', en: /cincinnati/i, epg: ['cincinnati'] },
  { it: 'Pechino', en: /china open|beijing/i, epg: ['pechino', 'beijing', 'china open'] },
  { it: 'Wuhan', en: /wuhan/i, epg: ['wuhan'] },
  { it: 'Shanghai', en: /shanghai/i, epg: ['shanghai', 'shangai'] },
  { it: 'Parigi Bercy', en: /paris/i, epg: ['parigi', 'paris', 'bercy'] },
  { it: 'Dubai', en: /dubai/i, epg: ['dubai'] },
  { it: 'Doha', en: /doha|qatar/i, epg: ['doha', 'qatar'] },
  { it: 'ATP Finals', en: /atp finals|nitto/i, epg: ['atp finals', 'finals', 'torino'] },
  { it: 'WTA Finals', en: /wta finals/i, epg: ['wta finals', 'finals'] },
  { it: 'Laver Cup', en: /laver cup/i, epg: ['laver cup'] },
  { it: 'Coppa Davis', en: /davis cup/i, epg: ['coppa davis', 'davis'] },
  { it: 'Billie Jean King Cup', en: /billie jean king/i, epg: ['billie jean king', 'bjk'] },
  { it: 'United Cup', en: /united cup/i, epg: ['united cup'] },
];

const NAME_STOPWORDS = new Set(['grand', 'prix', 'gp', 'open', 'the', 'and', 'race', 'sprint', 'practice', 'qualifying', 'free']);

/** Fallback keys for a venue we do not know: the significant words of its name. */
function nameKeys(name: string): string[] {
  return normName(name)
    .split(' ')
    .filter((t) => t.length >= 4 && !NAME_STOPWORDS.has(t));
}

function venueFor(name: string, table: Venue[]): Venue | null {
  return table.find((v) => v.en.test(name)) ?? null;
}

// ---------- Sessions ----------

const SESSION_LABELS: Record<Exclude<Session, 'practice' | 'tournament'>, string> = {
  qualifying: 'Qualifiche',
  sprintqualifying: 'Sprint Shootout',
  sprint: 'Sprint',
  race: 'Gara',
};

/** Minutes a session keeps a live badge after its start. */
const DURATION: Record<Session, Record<Sport, number>> = {
  practice: { f1: 60, motogp: 60, tennis: 0 },
  qualifying: { f1: 60, motogp: 60, tennis: 0 },
  sprintqualifying: { f1: 45, motogp: 45, tennis: 0 },
  sprint: { f1: 45, motogp: 45, tennis: 0 },
  race: { f1: 120, motogp: 75, tennis: 0 },
  tournament: { f1: 0, motogp: 0, tennis: 0 },
};

type ParsedSession = { session: Session; label: string; round?: number };

/**
 * Session named by a TheSportsDB event ("San Marino Free Practice 1", "Spanish Grand Prix Qualifying",
 * "Austria Sprint Race", "Austria GP", "Spanish Grand Prix"). Tests and MotoGP's Q2 (shown together
 * with Q1 as "Qualifiche") are dropped.
 */
export function parseTsdbSession(name: string): ParsedSession | null {
  const n = name.toLowerCase().trim();
  if (/\btest\b|shakedown/.test(n)) return null;
  let m = /(?:free )?practice ?(\d)?$|\bfp ?(\d)$/.exec(n);
  if (m) {
    const k = m[1] ?? m[2];
    return k ? { session: 'practice', label: `Prove libere ${k}`, round: Number(k) } : { session: 'practice', label: 'Prove libere' };
  }
  if (/sprint (qualifying|shootout)$/.test(n)) return { session: 'sprintqualifying', label: SESSION_LABELS.sprintqualifying };
  m = /qualifying ?(\d)?$/.exec(n);
  if (m) return m[1] === '2' ? null : { session: 'qualifying', label: SESSION_LABELS.qualifying };
  if (/\bsprint( race)?$/.test(n)) return { session: 'sprint', label: SESSION_LABELS.sprint };
  if (/grand prix$|\bgp$|\brace$/.test(n)) return { session: 'race', label: SESSION_LABELS.race };
  return null;
}

const ESPN_F1_TYPES: Record<string, ParsedSession> = {
  FP1: { session: 'practice', label: 'Prove libere 1', round: 1 },
  FP2: { session: 'practice', label: 'Prove libere 2', round: 2 },
  FP3: { session: 'practice', label: 'Prove libere 3', round: 3 },
  Qual: { session: 'qualifying', label: SESSION_LABELS.qualifying },
  SS: { session: 'sprintqualifying', label: SESSION_LABELS.sprintqualifying },
  SR: { session: 'sprint', label: SESSION_LABELS.sprint },
  Race: { session: 'race', label: SESSION_LABELS.race },
};

function motorEvent(sport: 'f1' | 'motogp', source: SportEvent['source'], id: string, name: string, p: ParsedSession, start: number, status: EventStatus): SportEvent {
  const venue = venueFor(name, GRANDS_PRIX);
  const title = venue ? `GP ${venue.it}` : name.replace(/\s*(free )?practice.*$|\s*sprint.*$|\s*qualifying.*$|\s*grand prix$|\s*\bgp$|\s*\brace$/i, '').trim();
  return {
    id,
    sport,
    source,
    title,
    name,
    session: p.session,
    sessionLabel: p.label,
    round: p.round,
    start,
    stop: start + DURATION[p.session][sport] * 60,
    status,
    keys: venue ? venue.epg : nameKeys(title),
  };
}

// ---------- ESPN (F1 sessions, tennis tournaments) ----------

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

function espnState(type: { name?: string; state?: string } | undefined): EventStatus {
  if ((type?.name ?? '').includes('CANCEL')) return 'CANCELLED';
  if (type?.state === 'in') return 'IN_PLAY';
  if (type?.state === 'post') return 'FINISHED';
  return 'SCHEDULED';
}

const ymd = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10).replace(/-/g, '');

async function espn<T>(path: string): Promise<T> {
  const res = await fetch(`${ESPN_BASE}/${path}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  return (await res.json()) as T;
}

type EspnF1Event = {
  id: string;
  name?: string;
  shortName?: string;
  competitions?: { id?: string; date?: string; type?: { abbreviation?: string }; status?: { type?: { name?: string; state?: string } } }[];
};

export function espnF1ToEvents(data: { events?: EspnF1Event[] }): SportEvent[] {
  const out: SportEvent[] = [];
  for (const e of data.events ?? []) {
    const name = e.name ?? e.shortName ?? '';
    for (const c of e.competitions ?? []) {
      const p = ESPN_F1_TYPES[c.type?.abbreviation ?? ''];
      const ts = Date.parse(c.date ?? '');
      if (!p || !name || !Number.isFinite(ts)) continue;
      out.push(motorEvent('f1', 'espn', `espn:f1:${e.id}:${c.type?.abbreviation}`, name, p, Math.floor(ts / 1000), espnState(c.status?.type)));
    }
  }
  return out;
}

async function fetchEspnF1(from: number, to: number): Promise<SportEvent[]> {
  return espnF1ToEvents(await espn<{ events?: EspnF1Event[] }>(`racing/f1/scoreboard?dates=${ymd(from)}-${ymd(to)}`));
}

type EspnTennisEvent = {
  id: string;
  name?: string;
  shortName?: string;
  date?: string;
  endDate?: string;
  major?: boolean;
  status?: { type?: { name?: string; state?: string } };
};

/** Tournaments of both tours, one entry each, only the main ones. */
export function espnTennisToEvents(tours: { tour: 'ATP' | 'WTA'; data: { events?: EspnTennisEvent[] } }[]): SportEvent[] {
  const byId = new Map<string, { e: EspnTennisEvent; tours: string[] }>();
  for (const { tour, data } of tours) {
    for (const e of data.events ?? []) {
      const cur = byId.get(e.id);
      if (cur) cur.tours.push(tour);
      else byId.set(e.id, { e, tours: [tour] });
    }
  }
  const out: SportEvent[] = [];
  for (const { e, tours } of byId.values()) {
    const name = e.name ?? e.shortName ?? '';
    const venue = venueFor(name, TOURNAMENTS);
    if (!venue && !e.major) continue;
    const start = Date.parse(e.date ?? '');
    const stop = Date.parse(e.endDate ?? '');
    if (!name || !Number.isFinite(start) || !Number.isFinite(stop)) continue;
    out.push({
      id: `espn:tennis:${e.id}`,
      sport: 'tennis',
      source: 'espn',
      title: venue?.it ?? name,
      name,
      session: 'tournament',
      sessionLabel: tours.join(' · '),
      start: Math.floor(start / 1000),
      stop: Math.floor(stop / 1000),
      status: espnState(e.status?.type),
      keys: venue ? venue.epg : nameKeys(name),
    });
  }
  return out;
}

async function fetchEspnTennis(from: number, to: number): Promise<SportEvent[]> {
  const range = `dates=${ymd(from)}-${ymd(to)}`;
  const [atp, wta] = await Promise.all([espn<{ events?: EspnTennisEvent[] }>(`tennis/atp/scoreboard?${range}`), espn<{ events?: EspnTennisEvent[] }>(`tennis/wta/scoreboard?${range}`)]);
  return espnTennisToEvents([
    { tour: 'ATP', data: atp },
    { tour: 'WTA', data: wta },
  ]);
}

// ---------- TheSportsDB (MotoGP; F1 when ESPN fails) ----------

const TSDB_LEAGUES: Record<'f1' | 'motogp', string> = { f1: '4370', motogp: '4407' };
const TSDB_LIMIT_MSG = 'TheSportsDB: limite richieste del piano gratuito raggiunto, riprova tra qualche minuto';

type TsdbEv = { idEvent: string; strEvent: string; strTimestamp: string | null; intRound: string | null; strSeason: string | null; strStatus: string | null; strPostponed?: string | null };

const tsdbTs = (e: TsdbEv) => (e.strTimestamp ? Date.parse(e.strTimestamp.endsWith('Z') ? e.strTimestamp : `${e.strTimestamp}Z`) : NaN);

export function tsdbToEvent(sport: 'f1' | 'motogp', e: TsdbEv): SportEvent | null {
  const ts = tsdbTs(e);
  const p = parseTsdbSession(e.strEvent ?? '');
  if (!p || !Number.isFinite(ts)) return null;
  const status: EventStatus = e.strPostponed === 'yes' ? 'CANCELLED' : e.strStatus === 'FT' || e.strStatus === 'Match Finished' ? 'FINISHED' : 'SCHEDULED';
  return motorEvent(sport, 'thesportsdb', `tsdb:${e.idEvent}`, e.strEvent, p, Math.floor(ts / 1000), status);
}

/**
 * Every session of the rounds (race weekends) that touch the window. "Next" and "past" are capped
 * and only list the sessions still to come or just finished, so each round is completed with a
 * per-round call. Requests are sequential: the free tier rejects bursts.
 */
async function fetchTsdb(sport: 'f1' | 'motogp', from: number, to: number): Promise<SportEvent[]> {
  const league = TSDB_LEAGUES[sport];
  const next = await tsdb<{ events: TsdbEv[] | null }>(`eventsnextleague.php?id=${league}`);
  const past = await tsdb<{ events: TsdbEv[] | null }>(`eventspastleague.php?id=${league}`);
  const seed = [...(next?.events ?? []), ...(past?.events ?? [])];
  const rounds = new Map<string, { round: string; season: string }>();
  for (const e of seed) {
    const ts = tsdbTs(e) / 1000;
    if (Number.isFinite(ts) && ts >= from - 3 * 86400 && ts <= to && e.intRound && e.strSeason) rounds.set(`${e.strSeason}/${e.intRound}`, { round: e.intRound, season: e.strSeason });
  }
  const all = [...seed];
  for (const r of rounds.values()) {
    const list = await tsdb<{ events: TsdbEv[] | null }>(`eventsround.php?id=${league}&r=${r.round}&s=${encodeURIComponent(r.season)}`);
    all.push(...(list?.events ?? []));
  }
  const out: SportEvent[] = [];
  const seen = new Set<string>();
  for (const e of all) {
    const ev = tsdbToEvent(sport, e);
    if (ev && ev.start >= from && ev.start <= to && !seen.has(ev.id)) {
      seen.add(ev.id);
      out.push(ev);
    }
  }
  return out;
}

// ---------- Public API ----------

const msg = (e: unknown) => (e instanceof TsdbRateLimited ? TSDB_LIMIT_MSG : e instanceof Error ? e.message : String(e));

export async function loadEvents(days = 7, force = false): Promise<SportEvent[]> {
  if (!force && cache && now() < cache.until) return cache.items;
  if (inflight) return inflight;
  const run = async (): Promise<SportEvent[]> => {
    const from = now() - 86400;
    const to = now() + days * 86400;
    const errors: string[] = [];
    const sources = new Set<string>();
    const items: SportEvent[] = [];
    // ESPN calls run together; TheSportsDB calls stay sequential (MotoGP first, then F1 only as fallback).
    const espnF1 = fetchEspnF1(from, to).then(
      (r) => ({ ok: true as const, r }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    const tennis = fetchEspnTennis(from, to).then(
      (r) => {
        items.push(...r);
        sources.add('ESPN');
      },
      (e: unknown) => errors.push(`tennis: ${msg(e)}`),
    );
    try {
      items.push(...(await fetchTsdb('motogp', from, to)));
      sources.add('TheSportsDB');
    } catch (e) {
      errors.push(`MotoGP: ${msg(e)}`);
    }
    const f1 = await espnF1;
    if (f1.ok) {
      items.push(...f1.r);
      sources.add('ESPN');
    } else {
      try {
        items.push(...(await fetchTsdb('f1', from, to)));
        sources.add('TheSportsDB');
        errors.push(`F1: ${msg(f1.e)} (usato TheSportsDB)`);
      } catch (e) {
        errors.push(`F1: ${msg(f1.e)} · ${msg(e)}`);
      }
    }
    await tennis;
    items.sort((a, b) => a.start - b.start);
    eventState.error = errors.length ? errors.join(' · ') : null;
    eventState.source = sources.size ? `${[...sources].join(' + ')} (senza chiave)` : null;
    eventState.lastRun = now();
    eventState.count = items.length;
    cache = { until: now() + (errors.length ? ERROR_TTL : CACHE_TTL), items };
    return items;
  };
  inflight = run();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Tests only. */
export function resetEventsCache() {
  cache = null;
}

// ---------- Event → EPG channel matching ----------

// Support classes, studio shows and replays that share the weekend's titles.
const MOTOR_NOISE_RE = /moto ?[23]\b|moto ?e\b|formula ?[23]\b|\bf[23]\b|academy|feature race|paddock|pre gara|post gara|\bshow\b|magazine|highlights|replica|differita|sintesi|studio|talent|insider|rubrica|speciale|story|preview|review|warm ?up|griglia/;
const F1_RE = /\bf1\b|formula 1\b|formula uno|formula one/;
const MOTOGP_RE = /motogp|moto gp/;

const TENNIS_SIGNAL_RE = /tennis|\batp\b|\bwta\b|slam|masters|\bopen\b|finals|davis|supertennis|eurosport|sky sport uno|sky sport arena/;
const TENNIS_NOISE_RE = /\bgp\b|gran premio|\bgara\b|qualifiche|motogp|formula|sprint|snooker|golf|darts|freccette|biliardo|magazine|highlights|insider|\bshow\b|story|replica|differita|rubrica/;

function hasKey(t: string, keys: string[]): boolean {
  const padded = ` ${t} `;
  return keys.some((k) => padded.includes(` ${k} `));
}

/** The title names a Grand Prix other than the event's ("GP Madrid: Gara" while looking for Misano). */
function namesOtherVenue(t: string, keys: string[]): boolean {
  return GRANDS_PRIX.some((v) => !v.epg.some((k) => keys.includes(k)) && hasKey(t, v.epg));
}

function sessionInTitle(session: Session, t: string, round?: number): boolean {
  switch (session) {
    case 'race':
      return /\bgara\b|\brace\b/.test(t) && !/sprint/.test(t);
    case 'sprint':
      return /\bsprint\b/.test(t) && !/qualif|shootout/.test(t);
    case 'sprintqualifying':
      return /shootout|sprint qualif|qualifiche sprint/.test(t);
    case 'qualifying':
      return /qualif/.test(t) && !/sprint|shootout/.test(t);
    case 'practice': {
      if (!/\bprove\b|\blibere\b|\bpractice\b|\bfp ?\d\b/.test(t) || /qualif|\bgara\b|sprint/.test(t)) return false;
      const m = /(?:libere|practice|fp) ?(\d)\b/.exec(t);
      return !m || round === undefined || Number(m[1]) === round;
    }
    default:
      return false;
  }
}

function sportSignal(t: string, channel: string): Sport | null {
  const s = `${t} ${channel}`;
  if (MOTOGP_RE.test(s)) return 'motogp';
  if (F1_RE.test(s)) return 'f1';
  return null;
}

type Row = { title: string; start: number; stop: number; id: number; name: string; logo: string | null };

function rowsBetween(db: Db, from: number, to: number): Row[] {
  return db
    .prepare(
      `SELECT p.title, p.start, p.stop, l.id, l.name, l.logo
       FROM epg_programme p JOIN live_channel l ON l.epg_channel_id = p.channel_id
       WHERE p.start BETWEEN ? AND ?
       ORDER BY l.num`,
    )
    .all(from, to) as Row[];
}

function dedupe(rows: Row[]): FixtureChannel[] {
  const out: FixtureChannel[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const base = channelBase(r.name);
    if (seen.has(base)) continue;
    seen.add(base);
    out.push({ id: r.id, name: r.name, logo: r.logo, programme: r.title, start: r.start });
  }
  return out;
}

/**
 * Motorsport: programmes starting within [-30 min, +40 min] of the session whose title names the
 * session ("Gara", "Qualifiche", "Sprint", "Prove libere 2"). The title or channel must not point
 * at the other sport nor at another Grand Prix; a title that names neither sport (TV8, RSI…) is
 * accepted only if it names the Grand Prix or starts within 15 minutes of the official time.
 * Tennis: programmes of the next 24 hours, during the tournament, whose title names it.
 */
export function channelsForEvent(db: Db, ev: SportEvent, at = now()): FixtureChannel[] {
  if (ev.sport === 'tennis') {
    if (at < ev.start - 6 * 3600 || at > ev.stop) return [];
    const rows = rowsBetween(db, at - 6 * 3600, Math.min(ev.stop, at + 24 * 3600)).filter((r) => {
      if (r.stop <= at) return false;
      const t = normName(r.title);
      if (!hasKey(t, ev.keys) || TENNIS_NOISE_RE.test(t)) return false;
      return TENNIS_SIGNAL_RE.test(`${t} ${normName(r.name)}`);
    });
    rows.sort((a, b) => a.start - b.start);
    return dedupe(rows);
  }
  const rows = rowsBetween(db, ev.start - 30 * 60, ev.start + 40 * 60).filter((r) => {
    const t = normName(r.title);
    if (MOTOR_NOISE_RE.test(t) || !sessionInTitle(ev.session, t, ev.round)) return false;
    const signal = sportSignal(t, normName(r.name));
    if (signal && signal !== ev.sport) return false;
    if (hasKey(t, ev.keys)) return true;
    if (namesOtherVenue(t, ev.keys)) return false;
    return signal === ev.sport || Math.abs(r.start - ev.start) <= 15 * 60;
  });
  return dedupe(rows);
}
