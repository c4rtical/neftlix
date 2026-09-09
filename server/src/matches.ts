import type { Db } from './db.ts';
import { now } from './db.ts';

export type MatchChannel = { id: number; name: string; logo: string | null };
export type Match = {
  key: string;
  title: string;
  home: string;
  away: string;
  competition: string | null;
  start: number;
  stop: number;
  live: boolean;    // airing right now
  replay: boolean;  // same fixture already aired earlier in the window
  channels: MatchChannel[];
};

const SPORT_CATEGORY_RE = /sport|calcio|dazn|eurosport|football|soccer|campionato|serie [ab]\b|champions|europa league|conference/i;
// Channels whose EPG is never football.
const NON_FOOTBALL_CHANNEL_RE = /nba|f1|motogp|tennis|golf|aci ?sport|caccia|pesca|bike|equ|wwe|ufc|nfl|padel|rugby|basket|arena|legend|max\b/i;
// Titles that follow the "A - B" shape but are not matches.
const NON_MATCH_RE = /\b(ep\.?|stag\.?|episodio|puntata|f1|motogp|moto[23]|gara|prove|qualifiche|highlights|magazine|show|rubrica|speciale|story|legend|best of|replica|memory|inside|today|insider|preview|review|studio|club|talk|report|news|mondiali di|wrc|superbike|nascar|indycar|ryder|masters|open)\b/i;
const LIVE_PREFIX_RE = /^\s*(live|diretta)\s*[:\-–]\s*/i;

function cleanTeam(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^[\s:.-]+|[\s:.-]+$/g, '').trim();
}

function looksLikeTeam(s: string): boolean {
  if (s.length < 3 || s.length > 32) return false;
  if (!/[a-zà-ÿ]/i.test(s)) return false;
  if (/\d{4}/.test(s)) return false; // years: "Spagna 2013 - F1"
  if (NON_MATCH_RE.test(s)) return false;
  return true;
}

export function parseMatchTitle(raw: string): { home: string; away: string; competition: string | null; liveTag: boolean } | null {
  let title = raw.replace(/\s+/g, ' ').trim();
  const liveTag = LIVE_PREFIX_RE.test(title);
  title = title.replace(LIVE_PREFIX_RE, '');
  if (NON_MATCH_RE.test(title)) return null;
  // "Serie A: Juventus - Milan" → competition + teams. Keep only the last "prefix:" segment.
  let competition: string | null = null;
  const colon = title.lastIndexOf(': ');
  if (colon > 0) {
    competition = title.slice(0, colon).trim() || null;
    title = title.slice(colon + 2).trim();
  }
  const parts = title.split(/\s+[-–—]\s+|\s+vs\.?\s+/i);
  if (parts.length !== 2) return null;
  const home = cleanTeam(parts[0]);
  const away = cleanTeam(parts[1]);
  if (!looksLikeTeam(home) || !looksLikeTeam(away)) return null;
  return { home, away, competition, liveTag };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Football matches found in the EPG of sport channels, grouped per event with every channel that carries it. */
export function upcomingMatches(db: Db, days = 7, from = now()): Match[] {
  const cats = (db.prepare(`SELECT id, name FROM category WHERE kind = 'live'`).all() as { id: string; name: string }[])
    .filter((c) => SPORT_CATEGORY_RE.test(c.name))
    .map((c) => c.id);
  if (cats.length === 0) return [];

  const rows = db
    .prepare(
      `SELECT p.title, p.start, p.stop, l.id AS channel_id, l.name AS channel_name, l.logo
       FROM epg_programme p
       JOIN live_channel l ON l.epg_channel_id = p.channel_id
       WHERE l.category_id IN (SELECT value FROM json_each(?))
         AND p.stop > ? AND p.start < ?
         AND (p.title LIKE '% - %' OR p.title LIKE '% vs %' OR p.title LIKE '% – %')
       ORDER BY p.start, l.num`,
    )
    .all(JSON.stringify(cats), from - 3 * 3600, from + days * 86400) as {
    title: string;
    start: number;
    stop: number;
    channel_id: number;
    channel_name: string;
    logo: string | null;
  }[];

  const events = new Map<string, Match>();
  for (const r of rows) {
    if (NON_FOOTBALL_CHANNEL_RE.test(r.channel_name)) continue;
    const parsed = parseMatchTitle(r.title);
    if (!parsed) continue;
    // Same match within 30 minutes on different channels = same event.
    const slot = Math.round(r.start / 1800);
    const key = `${norm(parsed.home)}|${norm(parsed.away)}|${slot}`;
    let ev = events.get(key);
    if (!ev) {
      ev = {
        key,
        title: `${parsed.home} - ${parsed.away}`,
        home: parsed.home,
        away: parsed.away,
        competition: parsed.competition,
        start: r.start,
        stop: r.stop,
        live: r.start <= from && r.stop > from,
        replay: false,
        channels: [],
      };
      events.set(key, ev);
    }
    if (!ev.competition && parsed.competition) ev.competition = parsed.competition;
    if (r.start < ev.start) ev.start = r.start;
    if (r.stop > ev.stop) ev.stop = r.stop;
    // Provider duplicates channels across groups and quality variants (HD/FHD/4K/SAT): keep one per base name.
    const base = channelBaseName(r.channel_name);
    if (!ev.channels.some((c) => channelBaseName(c.name) === base)) {
      ev.channels.push({ id: r.channel_id, name: r.channel_name, logo: r.logo });
    }
  }
  const list = [...events.values()].sort((a, b) => a.start - b.start);
  // Later airings of a fixture already seen are replays.
  const seen = new Set<string>();
  for (const ev of list) {
    const fixture = `${norm(ev.home)}|${norm(ev.away)}`;
    if (seen.has(fixture)) ev.replay = true;
    else seen.add(fixture);
  }
  return list;
}

function channelBaseName(name: string): string {
  return norm(name.replace(/\b(HD|FHD|UHD|4K|SAT|HEVC|H265|\+|SD|HQ)\b/gi, ''));
}
