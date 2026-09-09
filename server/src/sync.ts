import type { Db } from './db.ts';
import { now } from './db.ts';
import { refreshEpg } from './epg.ts';
import { XtreamClient, flattenEpisodes, type XtreamVodStream, type XtreamSeries, type XtreamCategory, type XtreamLiveStream } from './xtream.ts';

export type SyncState = {
  running: boolean;
  stage: string;
  done: number;
  total: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
};

export const syncState: SyncState = {
  running: false,
  stage: 'idle',
  done: 0,
  total: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

/** Adult categories are hidden from every listing. */
export const ADULT_CATEGORY_RE = /\bxxx\b|adult|porn|erotic|\b18\+|hot\b|for adults/i;

const QUALITY_TAGS = /\b(4K|UHD|2160p|1080p|720p|HDR|HEVC|H\.?265|x265|REMUX|BLURAY|WEB-?DL|HDTS|CAM|ITA|ENG|SUB-?ITA)\b/gi;

export type ParsedTitle = { title: string; year: number | null; label: string | null };

export function parseTitle(raw: string): ParsedTitle {
  let name = raw.replace(/\s+/g, ' ').trim();
  let year: number | null = null;
  const labels = new Set<string>();
  const stripTrailingQuality = () => {
    name = name.replace(/\s*[-–|]?\s*(4K|UHD|HDR|2160p)\s*$/i, (_, tag: string) => {
      labels.add(tag.toUpperCase());
      return '';
    });
  };
  stripTrailingQuality();
  const yearMatch = name.match(/[\(\[]\s*((?:19|20)\d{2})\s*[\)\]]\s*$/);
  if (yearMatch) {
    year = Number(yearMatch[1]);
    name = name.slice(0, yearMatch.index).trim();
  }
  stripTrailingQuality();
  name = name.replace(/[\[\(]([^\]\)]*)[\]\)]/g, (m, inner: string) => {
    if (QUALITY_TAGS.test(inner)) {
      labels.add(inner.toUpperCase().trim());
      QUALITY_TAGS.lastIndex = 0;
      return '';
    }
    QUALITY_TAGS.lastIndex = 0;
    return m;
  });
  stripTrailingQuality();
  name = name.replace(/\s+/g, ' ').replace(/[\s\-–:]+$/, '').trim();
  return { title: name || raw.trim(), year, label: labels.size ? [...labels].join(' ') : null };
}

export function normalizeKey(title: string, year: number | null): string {
  const base = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return year ? `${base} ${year}` : base;
}

function cleanTmdb(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === '0' || s === 'null') return null;
  return s;
}

function toNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function ratingOf(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function backdropOf(v: string[] | string | null | undefined): string | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

type MovieGroup = {
  key: string;
  title: string;
  year: number | null;
  tmdb: string | null;
  poster: string | null;
  rating: number | null;
  added: number;
  categories: Set<string>;
  sources: { stream_id: number; ext: string; category_id: string; label: string | null; added: number }[];
};

/**
 * `known` maps a normalized "title year" (and bare title) to the TMDB key already stored in the DB.
 * Panels sometimes omit `tmdb` for rows they returned it for before; without this, the film would
 * get a new key and lose progress/favorites.
 */
function groupMovies(rows: XtreamVodStream[], known: Map<string, string> = new Map()): Map<string, MovieGroup> {
  const groups = new Map<string, MovieGroup>();
  for (const row of rows) {
    if (!row || !row.name || !row.stream_id) continue;
    if (String(row.is_adult) === '1') continue;
    const parsed = parseTitle(row.name);
    let tmdb = cleanTmdb(row.tmdb ?? row.tmdb_id);
    if (!tmdb) {
      const k = known.get(normalizeKey(parsed.title, parsed.year)) ?? (parsed.year ? undefined : known.get(normalizeKey(parsed.title, null)));
      if (k) tmdb = k.slice('tmdb:'.length);
    }
    const key = tmdb ? `tmdb:${tmdb}` : `name:${normalizeKey(parsed.title, parsed.year)}`;
    const added = toNumber(row.added);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        title: parsed.title,
        year: parsed.year,
        tmdb,
        poster: row.stream_icon || null,
        rating: ratingOf(row.rating),
        added,
        categories: new Set(),
        sources: [],
      };
      groups.set(key, g);
    } else {
      if (!g.poster && row.stream_icon) g.poster = row.stream_icon;
      if (g.rating === null) g.rating = ratingOf(row.rating);
      if (!g.year && parsed.year) g.year = parsed.year;
      if (added > g.added) g.added = added;
    }
    g.categories.add(String(row.category_id));
    g.sources.push({
      stream_id: row.stream_id,
      ext: row.container_extension || 'mp4',
      category_id: String(row.category_id),
      label: parsed.label,
      added,
    });
  }
  mergeNameGroupsIntoTmdb(groups);
  return groups;
}

/** The same film often appears with a TMDB id in one category and without in another: fold the latter into the former. */
function mergeNameGroupsIntoTmdb(groups: Map<string, MovieGroup>) {
  const byTitle = new Map<string, MovieGroup[]>();
  for (const g of groups.values()) {
    if (!g.tmdb) continue;
    const t = normalizeKey(g.title, null);
    byTitle.set(t, [...(byTitle.get(t) ?? []), g]);
  }
  for (const [key, g] of [...groups.entries()]) {
    if (g.tmdb) continue;
    const candidates = byTitle.get(normalizeKey(g.title, null));
    if (!candidates) continue;
    const target = candidates.find((c) => !g.year || !c.year || c.year === g.year) ?? (candidates.length === 1 ? candidates[0] : null);
    if (!target) continue;
    for (const c of g.categories) target.categories.add(c);
    target.sources.push(...g.sources);
    if (!target.poster && g.poster) target.poster = g.poster;
    if (target.rating === null) target.rating = g.rating;
    if (g.added > target.added) target.added = g.added;
    groups.delete(key);
  }
}

/** Preferred source order: plain HD first, then 4K; newer provider ids first (older duplicates are often dead). */
function orderSources(sources: MovieGroup['sources']) {
  return [...sources].sort((a, b) => {
    const a4k = a.label ? 1 : 0;
    const b4k = b.label ? 1 : 0;
    if (a4k !== b4k) return a4k - b4k;
    return b.stream_id - a.stream_id;
  });
}

export async function runSync(db: Db, client: XtreamClient): Promise<void> {
  if (syncState.running) return;
  Object.assign(syncState, { running: true, stage: 'categorie', done: 0, total: 0, startedAt: now(), finishedAt: null, error: null });
  try {
    const [vodCats, seriesCats, liveCats] = await Promise.all([
      client.getVodCategories(),
      client.getSeriesCategories(),
      client.getLiveCategories().catch(() => [] as XtreamCategory[]),
    ]);
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM category').run();
      const ins = db.prepare('INSERT OR REPLACE INTO category (id, kind, name, position, hidden) VALUES (?, ?, ?, ?, ?)');
      const hidden = (name: string) => (ADULT_CATEGORY_RE.test(name) ? 1 : 0);
      vodCats.forEach((c, i) => ins.run(String(c.category_id), 'movie', c.category_name, i, hidden(c.category_name)));
      seriesCats.forEach((c, i) => ins.run(String(c.category_id), 'series', c.category_name, i, hidden(c.category_name)));
      liveCats.forEach((c, i) => ins.run(String(c.category_id), 'live', c.category_name, i, hidden(c.category_name)));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    if (liveCats.length) {
      syncState.stage = 'canali live';
      try {
        importLive(db, await client.getLiveStreams());
      } catch (e) {
        // Live TV is optional: a panel without it must not break the VOD sync.
        console.warn('live sync failed:', e instanceof Error ? e.message : e);
      }
    }

    syncState.stage = 'film (download)';
    const vod = await client.getVodStreams();
    syncState.stage = 'film (import)';
    importMovies(db, vod);

    syncState.stage = 'serie (download)';
    const series = await client.getSeries();
    syncState.stage = 'serie (import)';
    importSeries(db, series);

    db.prepare('UPDATE account SET last_sync = ? WHERE id = 1').run(now());
    syncState.stage = 'done';
    void refreshEpg(db, client);
  } catch (e) {
    syncState.error = e instanceof Error ? e.message : String(e);
    syncState.stage = 'error';
  } finally {
    syncState.running = false;
    syncState.finishedAt = now();
  }
}

function importMovies(db: Db, rows: XtreamVodStream[]) {
  const known = new Map<string, string>();
  for (const m of db.prepare('SELECT key, title, year FROM movie WHERE tmdb IS NOT NULL').all() as { key: string; title: string; year: number | null }[]) {
    known.set(normalizeKey(m.title, m.year), m.key);
    if (m.year && !known.has(normalizeKey(m.title, null))) known.set(normalizeKey(m.title, null), m.key);
  }
  const groups = groupMovies(rows, known);
  let withTmdb = 0;
  for (const g of groups.values()) if (g.tmdb) withTmdb++;
  if (known.size && withTmdb < known.size * 0.5) {
    console.warn(`vod sync: TMDB coverage dropped from ${known.size} to ${withTmdb} films; provider response may be degraded`);
  }
  syncState.total = groups.size;
  syncState.done = 0;
  db.exec('BEGIN');
  try {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS seen_movie (key TEXT PRIMARY KEY)');
    db.exec('DELETE FROM seen_movie');
    const seen = db.prepare('INSERT OR IGNORE INTO seen_movie (key) VALUES (?)');
    const upsert = db.prepare(`
      INSERT INTO movie (key, title, year, poster, rating, tmdb, added, stream_id, ext)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        title = excluded.title, year = COALESCE(excluded.year, movie.year), poster = COALESCE(excluded.poster, movie.poster),
        rating = COALESCE(excluded.rating, movie.rating), tmdb = COALESCE(excluded.tmdb, movie.tmdb), added = excluded.added,
        stream_id = CASE
          WHEN EXISTS (SELECT 1 FROM movie_source s WHERE s.stream_id = movie.stream_id AND s.broken = 0) THEN movie.stream_id
          ELSE excluded.stream_id END,
        ext = CASE
          WHEN EXISTS (SELECT 1 FROM movie_source s WHERE s.stream_id = movie.stream_id AND s.broken = 0) THEN movie.ext
          ELSE excluded.ext END
    `);
    const delSources = db.prepare('DELETE FROM movie_source WHERE movie_key = ? AND stream_id NOT IN (SELECT value FROM json_each(?))');
    const insSource = db.prepare(`
      INSERT INTO movie_source (stream_id, movie_key, ext, category_id, label)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(stream_id) DO UPDATE SET movie_key = excluded.movie_key, ext = excluded.ext,
        category_id = excluded.category_id, label = excluded.label
    `);
    const delCats = db.prepare('DELETE FROM movie_category WHERE movie_key = ?');
    const insCat = db.prepare('INSERT OR IGNORE INTO movie_category (movie_key, category_id) VALUES (?, ?)');

    let i = 0;
    for (const g of groups.values()) {
      const ordered = orderSources(g.sources);
      const primary = ordered[0];
      seen.run(g.key);
      upsert.run(g.key, g.title, g.year, g.poster, g.rating, g.tmdb, g.added, primary.stream_id, primary.ext);
      delSources.run(g.key, JSON.stringify(ordered.map((s) => s.stream_id)));
      for (const s of ordered) insSource.run(s.stream_id, g.key, s.ext, s.category_id, s.label);
      delCats.run(g.key);
      for (const c of g.categories) insCat.run(g.key, c);
      if (++i % 1000 === 0) syncState.done = i;
    }
    // Movies that disappeared from the provider.
    db.exec('DELETE FROM movie_source WHERE movie_key NOT IN (SELECT key FROM seen_movie)');
    db.exec('DELETE FROM movie_category WHERE movie_key NOT IN (SELECT key FROM seen_movie)');
    db.exec('DELETE FROM movie WHERE key NOT IN (SELECT key FROM seen_movie)');
    // If the preferred source was deleted or is flagged broken, fall back to the best remaining one.
    db.exec(`
      UPDATE movie SET stream_id = (
        SELECT s.stream_id FROM movie_source s WHERE s.movie_key = movie.key AND s.broken = 0
        ORDER BY (s.label IS NOT NULL), s.stream_id DESC LIMIT 1
      ), ext = (
        SELECT s.ext FROM movie_source s WHERE s.movie_key = movie.key AND s.broken = 0
        ORDER BY (s.label IS NOT NULL), s.stream_id DESC LIMIT 1
      )
      WHERE NOT EXISTS (SELECT 1 FROM movie_source s WHERE s.stream_id = movie.stream_id AND s.broken = 0)
        AND EXISTS (SELECT 1 FROM movie_source s WHERE s.movie_key = movie.key AND s.broken = 0)
    `);
    db.exec('COMMIT');
    syncState.done = groups.size;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function importSeries(db: Db, rows: XtreamSeries[]) {
  syncState.total = rows.length;
  syncState.done = 0;
  db.exec('BEGIN');
  try {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS seen_series (id INTEGER PRIMARY KEY)');
    db.exec('DELETE FROM seen_series');
    const seen = db.prepare('INSERT OR IGNORE INTO seen_series (id) VALUES (?)');
    const upsert = db.prepare(`
      INSERT INTO series (id, title, year, poster, backdrop, plot, cast, director, genre, release_date, rating, tmdb, last_modified, category_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, year = excluded.year, poster = excluded.poster, backdrop = excluded.backdrop,
        plot = excluded.plot, cast = excluded.cast, director = excluded.director, genre = excluded.genre,
        release_date = excluded.release_date, rating = excluded.rating, tmdb = excluded.tmdb,
        category_id = excluded.category_id,
        episodes_fetched_at = CASE WHEN excluded.last_modified > series.last_modified THEN NULL ELSE series.episodes_fetched_at END,
        last_modified = excluded.last_modified
    `);
    let i = 0;
    for (const s of rows) {
      if (!s || !s.series_id || !s.name) continue;
      const parsed = parseTitle(s.name);
      const releaseDate = s.release_date || s.releaseDate || null;
      const year = parsed.year ?? (releaseDate ? Number(releaseDate.slice(0, 4)) || null : null);
      seen.run(s.series_id);
      upsert.run(
        s.series_id,
        parsed.title,
        year,
        s.cover || null,
        backdropOf(s.backdrop_path),
        s.plot || null,
        s.cast || null,
        s.director || null,
        s.genre || null,
        releaseDate,
        ratingOf(s.rating),
        cleanTmdb(s.tmdb),
        toNumber(s.last_modified),
        String(s.category_id),
      );
      if (++i % 500 === 0) syncState.done = i;
    }
    db.exec('DELETE FROM episode WHERE series_id NOT IN (SELECT id FROM seen_series)');
    db.exec('DELETE FROM series WHERE id NOT IN (SELECT id FROM seen_series)');
    db.exec('COMMIT');
    syncState.done = rows.length;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Providers insert fake "channels" like "----Sport----" as visual separators. */
export function isSeparatorChannel(name: string): boolean {
  const n = name.trim();
  return /^[-=#_*~•]{2,}/.test(n) || /^[-=#_*~•\s]+$/.test(n);
}

function importLive(db: Db, rows: XtreamLiveStream[]) {
  syncState.total = rows.length;
  syncState.done = 0;
  db.exec('BEGIN');
  try {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS seen_live (id INTEGER PRIMARY KEY)');
    db.exec('DELETE FROM seen_live');
    const seen = db.prepare('INSERT OR IGNORE INTO seen_live (id) VALUES (?)');
    const upsert = db.prepare(`
      INSERT INTO live_channel (id, name, logo, category_id, epg_channel_id, num, archive)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, logo = excluded.logo, category_id = excluded.category_id,
        epg_channel_id = excluded.epg_channel_id, num = excluded.num, archive = excluded.archive
    `);
    let i = 0;
    for (const r of rows) {
      if (!r || !r.stream_id || !r.name) continue;
      if (String(r.is_adult) === '1') continue;
      if (isSeparatorChannel(r.name)) continue;
      seen.run(r.stream_id);
      upsert.run(
        r.stream_id,
        r.name.replace(/\s+/g, ' ').trim(),
        r.stream_icon || null,
        String(r.category_id),
        r.epg_channel_id || null,
        toNumber(r.num),
        String(r.tv_archive) === '1' ? toNumber(r.tv_archive_duration) || 1 : 0,
      );
      if (++i % 1000 === 0) syncState.done = i;
    }
    db.exec('DELETE FROM live_channel WHERE id NOT IN (SELECT id FROM seen_live)');
    db.exec('COMMIT');
    syncState.done = rows.length;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const EPISODES_TTL = 6 * 3600;

/** Fetch seasons/episodes for a series on demand and cache them. */
export async function ensureEpisodes(db: Db, client: XtreamClient, seriesId: number, force = false): Promise<void> {
  const row = db.prepare('SELECT episodes_fetched_at FROM series WHERE id = ?').get(seriesId) as { episodes_fetched_at: number | null } | undefined;
  if (!row) throw new Error('Serie non trovata');
  if (!force && row.episodes_fetched_at && now() - row.episodes_fetched_at < EPISODES_TTL) return;

  const info = await client.getSeriesInfo(seriesId);
  const episodes = flattenEpisodes(info);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM episode WHERE series_id = ?').run(seriesId);
    const ins = db.prepare(`
      INSERT OR REPLACE INTO episode (id, series_id, season, num, title, plot, ext, duration_secs, image, air_date, added)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of episodes) {
      const info = e.info && !Array.isArray(e.info) ? e.info : {};
      ins.run(
        Number(e.id),
        seriesId,
        toNumber(e.season),
        toNumber(e.episode_num),
        cleanEpisodeTitle(e.title, toNumber(e.season), toNumber(e.episode_num)),
        info.plot || null,
        e.container_extension || 'mp4',
        info.duration_secs ? Math.round(Number(info.duration_secs)) : null,
        info.movie_image || null,
        info.air_date || null,
        e.added ? toNumber(e.added) : null,
      );
    }
    const detail = info.info ?? ({} as Record<string, unknown>);
    db.prepare(`
      UPDATE series SET episodes_fetched_at = ?,
        plot = COALESCE(?, plot), "cast" = COALESCE(?, "cast"), backdrop = COALESCE(?, backdrop)
      WHERE id = ?
    `).run(now(), (detail as { plot?: string }).plot || null, (detail as { cast?: string }).cast || null, backdropOf((detail as { backdrop_path?: string[] }).backdrop_path) || null, seriesId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Provider titles look like "Show (1997) - S01E01 - Episode name". Keep the last meaningful part. */
function cleanEpisodeTitle(raw: string | undefined, season: number, num: number): string {
  if (!raw) return `Episodio ${num}`;
  const parts = raw.split(/\s+-\s+/);
  const tagIdx = parts.findIndex((p) => /^S\d{1,2}E\d{1,3}$/i.test(p.trim()));
  if (tagIdx >= 0 && tagIdx < parts.length - 1) return parts.slice(tagIdx + 1).join(' - ').trim();
  const m = raw.match(/S\d{1,2}E\d{1,3}\s*[-:–]?\s*(.+)$/i);
  if (m && m[1].trim()) return m[1].trim();
  return raw.trim() || `Episodio ${num}`;
}

const DETAIL_TTL = 7 * 24 * 3600;

export async function ensureMovieDetail(db: Db, client: XtreamClient, key: string): Promise<void> {
  const row = db.prepare('SELECT stream_id, detail_fetched_at FROM movie WHERE key = ?').get(key) as
    | { stream_id: number; detail_fetched_at: number | null }
    | undefined;
  if (!row) throw new Error('Film non trovato');
  if (row.detail_fetched_at && now() - row.detail_fetched_at < DETAIL_TTL) return;
  try {
    const info = await client.getVodInfo(row.stream_id);
    const d = info.info ?? {};
    const release = d.releasedate || d.release_date || '';
    const year = /^\d{4}/.test(release) ? Number(release.slice(0, 4)) : null;
    db.prepare(`
      UPDATE movie SET plot = ?, "cast" = ?, director = ?, genre = ?, backdrop = ?, duration_secs = ?,
        year = COALESCE(year, ?), detail_fetched_at = ?
      WHERE key = ?
    `).run(
      d.description || d.plot || null,
      d.cast || d.actors || null,
      d.director || null,
      d.genre || null,
      backdropOf(d.backdrop_path) || null,
      d.duration_secs ? Math.round(Number(d.duration_secs)) : null,
      year,
      now(),
      key,
    );
  } catch {
    // Detail is optional; remember we tried so the page stays fast.
    db.prepare('UPDATE movie SET detail_fetched_at = ? WHERE key = ?').run(now(), key);
  }
}
