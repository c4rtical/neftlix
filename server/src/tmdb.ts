import type { Db } from './db.ts';
import { now } from './db.ts';

/**
 * Fills in episode titles, stills, plots and air dates that the provider left empty, using TMDB.
 *
 * Providers often ship a series with only "Show S01 E07" as the episode title and no picture:
 * they never looked the episodes up, or did it for the first season only. Since the series
 * carries a TMDB id, we can complete the missing fields ourselves. The risk is attaching the
 * wrong metadata to an episode, which is worse than showing none; so a series is enriched only
 * when its numbering provably lines up with TMDB's (see `planEnrichment`), and existing provider
 * titles are cross-checked against TMDB's before anything is written.
 *
 * Needs a free TMDB API key (Settings, or `TMDB_API_KEY`). Without one nothing happens.
 */

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w300';
const SEASON_TTL = 7 * 24 * 3600;

export type TmdbState = { lastError: string | null; enriched: number; lastRun: number | null };
export const tmdbState: TmdbState = { lastError: null, enriched: 0, lastRun: null };

// ---------- Key ----------

export function getTmdbKey(db: Db): string | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'tmdb_key'`).get() as { value: string } | undefined;
  return row?.value || process.env.TMDB_API_KEY || null;
}

export function setTmdbKey(db: Db, key: string | null) {
  if (key) db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('tmdb_key', ?)`).run(key.trim());
  else db.prepare(`DELETE FROM meta WHERE key = 'tmdb_key'`).run();
  // Every series gets another chance at enrichment with the new key (or none with no key).
  db.prepare('UPDATE series SET episodes_enriched_at = NULL').run();
  db.prepare('DELETE FROM tmdb_season').run();
  tmdbState.lastError = null;
}

// ---------- Planning (pure, tested) ----------

export type ProviderEpisode = { id: number; season: number; num: number; title: string | null };
export type TmdbSeasonMeta = { season_number: number; episode_count: number };
export type Mapping = { id: number; tmdbSeason: number; tmdbEpisode: number };

/** "Episodio 7", "Episode 7", "Show S01 E07", "S01E07", "" — a title that carries no information. */
export function isGenericTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  const t = title.trim();
  if (!t) return true;
  if (/^(episodio|episode|ep\.?)\s*\d+$/i.test(t)) return true;
  if (/\bS\d{1,2}\s*E\d{1,3}\b/i.test(t)) return true;
  return false;
}

/**
 * Decides which provider episode corresponds to which TMDB episode, or nothing when the two
 * numberings cannot be matched with confidence. Two shapes are recognised:
 *
 *  - Seasons: provider season N is TMDB season N. Every provider season must exist on TMDB and
 *    every episode number must fall within TMDB's count for that season; one season that does
 *    not fit means the provider numbers the show differently (arcs instead of seasons, say) and
 *    the whole series is left alone. A season with fewer episodes than TMDB is fine: the
 *    provider may not have uploaded them all yet.
 *  - Flat: the provider put the whole show in one season numbered 1..N, and N is exactly TMDB's
 *    total over all regular seasons (absolute numbering, common for long anime). Episode k maps
 *    to the k-th episode in TMDB season order.
 *
 * Season 0 (specials) is never touched: providers use it for anything.
 */
export function planEnrichment(episodes: ProviderEpisode[], seasons: TmdbSeasonMeta[]): Mapping[] {
  const tmdb = new Map<number, number>();
  for (const s of seasons) if (s.season_number >= 1 && s.episode_count > 0) tmdb.set(s.season_number, s.episode_count);
  if (tmdb.size === 0) return [];

  const bySeason = new Map<number, ProviderEpisode[]>();
  for (const e of episodes) {
    if (e.season < 1) continue;
    const list = bySeason.get(e.season) ?? [];
    list.push(e);
    bySeason.set(e.season, list);
  }
  if (bySeason.size === 0) return [];

  // Flat shape: one provider season, contiguous 1..N, N = TMDB total, and more than TMDB season 1 alone.
  if (bySeason.size === 1) {
    const [season, list] = [...bySeason.entries()][0];
    const nums = list.map((e) => e.num).sort((a, b) => a - b);
    const contiguous = nums.every((n, i) => n === i + 1);
    const total = [...tmdb.values()].reduce((a, b) => a + b, 0);
    const first = tmdb.get(1) ?? 0;
    if (season === 1 && contiguous && nums.length === total && total > first) {
      const order = [...tmdb.entries()].sort((a, b) => a[0] - b[0]);
      const out: Mapping[] = [];
      for (const e of list) {
        let k = e.num;
        for (const [s, count] of order) {
          if (k <= count) {
            out.push({ id: e.id, tmdbSeason: s, tmdbEpisode: k });
            break;
          }
          k -= count;
        }
      }
      return out;
    }
  }

  const out: Mapping[] = [];
  for (const [season, list] of bySeason) {
    const count = tmdb.get(season);
    if (!count) return [];
    if (!list.every((e) => e.num >= 1 && e.num <= count)) return [];
    for (const e of list) out.push({ id: e.id, tmdbSeason: season, tmdbEpisode: e.num });
  }
  return out;
}

/** Loose title comparison: case, accents, punctuation and spacing are ignored. */
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Provider titles that are real names are compared with TMDB's at the planned position. With at
 * least three comparable titles and fewer than half matching, the numbering is not what we
 * assumed and the whole series is left alone.
 */
export function crossCheck(pairs: { provider: string | null; tmdb: string | null }[]): boolean {
  let comparable = 0;
  let matches = 0;
  for (const p of pairs) {
    if (isGenericTitle(p.provider) || !p.tmdb) continue;
    comparable++;
    if (normalizeTitle(p.provider!) === normalizeTitle(p.tmdb)) matches++;
  }
  if (comparable < 3) return true;
  return matches / comparable >= 0.5;
}

// ---------- TMDB fetching (cached in the database) ----------

type TmdbEpisode = { episode_number: number; name: string | null; overview: string | null; still_path: string | null; air_date: string | null };
type TmdbSeason = { episodes: TmdbEpisode[] };

async function tmdbGet<T>(key: string, path: string): Promise<T> {
  const url = new URL(`${API}${path}`);
  url.searchParams.set('api_key', key);
  url.searchParams.set('language', 'it-IT');
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 401) throw new Error('chiave TMDB non valida');
  if (res.status === 404) throw new Error(`TMDB: ${path} non trovato`);
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** `season` -1 holds the show-level season list; n >= 0 holds season n's episodes. */
function cached<T>(db: Db, tmdbId: string, season: number): T | null {
  const row = db.prepare('SELECT json, fetched_at FROM tmdb_season WHERE tmdb_id = ? AND season = ?').get(tmdbId, season) as
    | { json: string; fetched_at: number }
    | undefined;
  if (!row || now() - row.fetched_at > SEASON_TTL) return null;
  return JSON.parse(row.json) as T;
}

function store(db: Db, tmdbId: string, season: number, value: unknown) {
  db.prepare('INSERT OR REPLACE INTO tmdb_season (tmdb_id, season, fetched_at, json) VALUES (?, ?, ?, ?)').run(tmdbId, season, now(), JSON.stringify(value));
}

async function seasonList(db: Db, key: string, tmdbId: string): Promise<TmdbSeasonMeta[]> {
  const hit = cached<TmdbSeasonMeta[]>(db, tmdbId, -1);
  if (hit) return hit;
  const show = await tmdbGet<{ seasons?: TmdbSeasonMeta[] }>(key, `/tv/${tmdbId}`);
  const list = (show.seasons ?? []).map((s) => ({ season_number: Number(s.season_number), episode_count: Number(s.episode_count) }));
  store(db, tmdbId, -1, list);
  return list;
}

async function seasonEpisodes(db: Db, key: string, tmdbId: string, season: number): Promise<TmdbEpisode[]> {
  const hit = cached<TmdbEpisode[]>(db, tmdbId, season);
  if (hit) return hit;
  const s = await tmdbGet<TmdbSeason>(key, `/tv/${tmdbId}/season/${season}`);
  const list = (s.episodes ?? []).map((e) => ({
    episode_number: Number(e.episode_number),
    name: e.name || null,
    overview: e.overview || null,
    still_path: e.still_path || null,
    air_date: e.air_date || null,
  }));
  store(db, tmdbId, season, list);
  return list;
}

// ---------- Applying ----------

export type EnrichResult = { status: 'no-key' | 'no-tmdb' | 'skipped' | 'mismatch' | 'done' | 'error'; filled: number; error?: string };

/**
 * Completes the missing episode fields of one series. Runs once per episode fetch (the flag is
 * cleared when the episodes are re-imported) and only ever fills empty fields, so provider data
 * always wins when present. Never throws: the outcome is returned and kept in `tmdbState`.
 */
export async function enrichSeriesFromTmdb(db: Db, seriesId: number): Promise<EnrichResult> {
  const key = getTmdbKey(db);
  if (!key) return { status: 'no-key', filled: 0 };
  const series = db.prepare('SELECT tmdb, episodes_enriched_at FROM series WHERE id = ?').get(seriesId) as
    | { tmdb: string | null; episodes_enriched_at: number | null }
    | undefined;
  if (!series) return { status: 'skipped', filled: 0 };
  if (series.episodes_enriched_at) return { status: 'skipped', filled: 0 };
  const mark = () => db.prepare('UPDATE series SET episodes_enriched_at = ? WHERE id = ?').run(now(), seriesId);
  if (!series.tmdb || !/^\d+$/.test(series.tmdb)) {
    mark();
    return { status: 'no-tmdb', filled: 0 };
  }

  const episodes = db.prepare('SELECT id, season, num, title, plot, image, air_date FROM episode WHERE series_id = ?').all(seriesId) as (ProviderEpisode & {
    plot: string | null;
    image: string | null;
    air_date: string | null;
  })[];
  const incomplete = episodes.filter((e) => isGenericTitle(e.title) || !e.image || !e.plot);
  if (incomplete.length === 0) {
    mark();
    return { status: 'skipped', filled: 0 };
  }

  try {
    const seasons = await seasonList(db, key, series.tmdb);
    const plan = planEnrichment(episodes, seasons);
    if (plan.length === 0) {
      mark();
      return { status: 'mismatch', filled: 0 };
    }
    const needed = [...new Set(plan.map((m) => m.tmdbSeason))].sort((a, b) => a - b);
    const tmdbEps = new Map<string, TmdbEpisode>();
    for (const s of needed) for (const e of await seasonEpisodes(db, key, series.tmdb, s)) tmdbEps.set(`${s}:${e.episode_number}`, e);

    const byId = new Map(episodes.map((e) => [e.id, e]));
    const pairs = plan.map((m) => ({ provider: byId.get(m.id)?.title ?? null, tmdb: tmdbEps.get(`${m.tmdbSeason}:${m.tmdbEpisode}`)?.name ?? null }));
    if (!crossCheck(pairs)) {
      mark();
      return { status: 'mismatch', filled: 0 };
    }

    const upd = db.prepare(`
      UPDATE episode SET
        title = CASE WHEN ? THEN COALESCE(?, title) ELSE title END,
        image = COALESCE(image, ?),
        plot = COALESCE(plot, ?),
        air_date = COALESCE(air_date, ?)
      WHERE id = ?
    `);
    let filled = 0;
    db.exec('BEGIN');
    try {
      for (const m of plan) {
        const e = byId.get(m.id);
        const t = tmdbEps.get(`${m.tmdbSeason}:${m.tmdbEpisode}`);
        if (!e || !t) continue;
        const generic = isGenericTitle(e.title);
        const gains = (generic && t.name) || (!e.image && t.still_path) || (!e.plot && t.overview) || (!e.air_date && t.air_date);
        if (!gains) continue;
        upd.run(generic ? 1 : 0, t.name, t.still_path ? `${IMG}${t.still_path}` : null, t.overview, t.air_date, e.id);
        filled++;
      }
      mark();
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    tmdbState.enriched += filled;
    tmdbState.lastRun = now();
    tmdbState.lastError = null;
    return { status: 'done', filled };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    tmdbState.lastError = msg;
    return { status: 'error', filled: 0, error: msg };
  }
}

/** Checks a key by asking TMDB for something small. Throws with a readable message when it fails. */
export async function verifyTmdbKey(key: string): Promise<void> {
  await tmdbGet(key, '/configuration');
}
