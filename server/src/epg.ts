import type { Db } from './db.ts';
import { now } from './db.ts';
import { PLAYER_USER_AGENT, type XtreamClient } from './xtream.ts';

export type EpgState = { running: boolean; lastRun: number | null; programmes: number; error: string | null };
export const epgState: EpgState = { running: false, lastRun: null, programmes: 0, error: null };

export const EPG_REFRESH_SECS = 6 * 3600;

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** XMLTV time: "20260908121000 +0200" → unix seconds. */
export function parseXmltvTime(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2})(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec, sign, oh, om] = m;
  let t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec ?? 0)) / 1000;
  if (sign) {
    const off = (Number(oh) * 60 + Number(om)) * 60;
    t -= sign === '+' ? off : -off;
  }
  return Math.floor(t);
}

export type Programme = { channel: string; start: number; stop: number; title: string; description: string | null };

/** Minimal XMLTV parser: only <programme> elements with title/desc children. */
export function parseXmltv(xml: string): Programme[] {
  const out: Programme[] = [];
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const body = m[2];
    const get = (name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
    const start = parseXmltvTime(get('start'));
    const stop = parseXmltvTime(get('stop'));
    const channel = get('channel');
    if (!channel || start === null || stop === null || stop <= start) continue;
    const title = decodeXml(body.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? '');
    if (!title) continue;
    const desc = body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/)?.[1];
    out.push({ channel: decodeXml(channel), start, stop, title, description: desc ? decodeXml(desc) : null });
  }
  return out;
}

export async function refreshEpg(db: Db, client: XtreamClient): Promise<void> {
  if (epgState.running) return;
  epgState.running = true;
  epgState.error = null;
  try {
    const url = `${client.host}/xmltv.php?username=${encodeURIComponent(client.username)}&password=${encodeURIComponent(client.password)}`;
    const res = await fetch(url, { headers: { 'User-Agent': PLAYER_USER_AGENT }, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`xmltv HTTP ${res.status}`);
    const xml = await res.text();
    const programmes = parseXmltv(xml);
    if (programmes.length === 0) throw new Error('EPG vuota');
    const cutoff = now() - 12 * 3600;
    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM epg_programme');
      const ins = db.prepare('INSERT OR REPLACE INTO epg_programme (channel_id, start, stop, title, description) VALUES (?, ?, ?, ?, ?)');
      let n = 0;
      for (const p of programmes) {
        if (p.stop < cutoff) continue;
        ins.run(p.channel, p.start, p.stop, p.title, p.description);
        n++;
      }
      db.exec('COMMIT');
      epgState.programmes = n;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    epgState.lastRun = now();
  } catch (e) {
    epgState.error = e instanceof Error ? e.message : String(e);
  } finally {
    epgState.running = false;
  }
}

export type NowNext = { title: string; description: string | null; start: number; stop: number } | null;

export function nowNextFor(db: Db, epgChannelId: string | null, at = now()): { now: NowNext; next: NowNext } {
  if (!epgChannelId) return { now: null, next: null };
  const cur = db
    .prepare('SELECT title, description, start, stop FROM epg_programme WHERE channel_id = ? AND start <= ? AND stop > ? ORDER BY start DESC LIMIT 1')
    .get(epgChannelId, at, at) as NowNext | undefined;
  const nxt = db
    .prepare('SELECT title, description, start, stop FROM epg_programme WHERE channel_id = ? AND start > ? ORDER BY start LIMIT 1')
    .get(epgChannelId, at) as NowNext | undefined;
  return { now: cur ?? null, next: nxt ?? null };
}
