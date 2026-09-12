import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import { now } from './db.ts';
import { XtreamClient, decodeEpgText } from './xtream.ts';
import { runSync, syncState, ensureEpisodes, ensureMovieDetail, enrichAllSeries, isDiscreetItem, isDiscreetSeries } from './sync.ts';
import { epgState, nowNextFor } from './epg.ts';
import { upcomingMatches } from './matches.ts';
import { getTmdbKey, setTmdbKey, tmdbState, verifyTmdbKey } from './tmdb.ts';
import { MAIN_COMPETITIONS, channelsForFixture, fallbackCategories, fixtureState, getFixturesKey, loadFixtures, setFixturesKey, sportCategoryIds } from './fixtures.ts';
import { profileRow } from './profiles.ts';

type Ctx = {
  db: Db;
  getClient: () => XtreamClient | null;
  setClient: (c: XtreamClient | null) => void;
};

export type Card = {
  type: 'movie' | 'series';
  id: string;
  title: string;
  year: number | null;
  poster: string | null;
  backdrop?: string | null;
  rating: number | null;
  progress?: { position: number; duration: number } | null;
  subtitle?: string | null;
  episodeId?: number | null;
  /** Search results only: the client keeps a term out of its history when every hit is discreet. */
  discreet?: boolean;
};

const MOVIE_CARD_SQL = `m.key AS id, m.title, m.year, m.poster, m.rating, m.backdrop,
  p.position AS p_position, p.duration AS p_duration`;
const movieCardJoin = (profileId: number) => `LEFT JOIN progress p ON p.profile_id = ${profileId} AND p.item_type = 'movie' AND p.item_id = m.key`;
const SERIES_CARD_SQL = `s.id, s.title, s.year, s.poster, s.rating, s.backdrop`;

type MovieRow = { id: string; title: string; year: number | null; poster: string | null; rating: number | null; backdrop: string | null; p_position: number | null; p_duration: number | null };
type SeriesRow = { id: number; title: string; year: number | null; poster: string | null; rating: number | null; backdrop: string | null };

function movieCard(r: MovieRow): Card {
  return {
    type: 'movie',
    id: r.id,
    title: r.title,
    year: r.year,
    poster: r.poster,
    backdrop: r.backdrop,
    rating: r.rating,
    progress: r.p_position && r.p_duration ? { position: r.p_position, duration: r.p_duration } : null,
  };
}

function seriesCard(r: SeriesRow): Card {
  return { type: 'series', id: String(r.id), title: r.title, year: r.year, poster: r.poster, backdrop: r.backdrop, rating: r.rating };
}

function likePattern(q: string): string {
  return `%${q.trim().replace(/[%_]/g, ' ').replace(/\s+/g, '%')}%`;
}

const WATCHED_RATIO = 0.9;

/** Active profile id; the onRequest hook in profiles.ts guarantees it on every non-public /api route. */
const pid = (req: FastifyRequest) => req.profileId as number;

export function registerApiRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  const accountRow = () =>
    db.prepare('SELECT host, username, status, exp_date, max_connections, last_sync FROM account WHERE id = 1').get() as
      | { host: string; username: string; status: string; exp_date: number | null; max_connections: number | null; last_sync: number | null }
      | undefined;

  const lastLoginRow = (): { host: string; username: string } | null => {
    const row = db.prepare(`SELECT value FROM meta WHERE key = 'last_login'`).get() as { value: string } | undefined;
    if (!row) return null;
    try {
      const v = JSON.parse(row.value) as { host?: unknown; username?: unknown };
      return typeof v.host === 'string' && typeof v.username === 'string' ? { host: v.host, username: v.username } : null;
    } catch {
      return null;
    }
  };

  app.get('/api/status', async (req) => {
    const account = accountRow();
    const counts = {
      movies: (db.prepare('SELECT COUNT(*) AS n FROM movie').get() as { n: number }).n,
      series: (db.prepare('SELECT COUNT(*) AS n FROM series').get() as { n: number }).n,
    };
    const lastLogin = account ? null : lastLoginRow();
    return {
      configured: Boolean(account),
      account: account ?? null,
      lastLogin,
      profile: req.profileId === null ? null : (profileRow(db, req.profileId) ?? null),
      profiles: (db.prepare('SELECT COUNT(*) AS n FROM profile').get() as { n: number }).n,
      sync: syncState,
      epg: epgState,
      fixtures: { ...fixtureState, hasKey: Boolean(getFixturesKey(db)) },
      tmdb: { ...tmdbState, hasKey: Boolean(getTmdbKey(db)) },
      counts,
    };
  });

  app.post('/api/setup', async (req, reply) => {
    const body = (req.body ?? {}) as { host?: string; username?: string; password?: string };
    if (!body.host || !body.username || !body.password) return reply.code(400).send({ error: 'host, username e password sono obbligatori' });
    const client = new XtreamClient({ host: body.host, username: body.username, password: body.password });
    let auth;
    try {
      auth = await client.authenticate();
    } catch (e) {
      return reply.code(401).send({ error: e instanceof Error ? e.message : 'Autenticazione fallita' });
    }
    if (String(auth.user_info.status).toLowerCase() !== 'active') {
      return reply.code(403).send({ error: `Account non attivo (${auth.user_info.status})` });
    }
    db.prepare(`
      INSERT INTO account (id, host, username, password, status, exp_date, max_connections)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET host = excluded.host, username = excluded.username, password = excluded.password,
        status = excluded.status, exp_date = excluded.exp_date, max_connections = excluded.max_connections
    `).run(client.host, client.username, client.password, auth.user_info.status, Number(auth.user_info.exp_date) || null, Number(auth.user_info.max_connections) || null);
    ctx.setClient(client);
    void runSync(db, client);
    return { account: accountRow(), sync: syncState };
  });

  // Log out: forget the credentials but remember host and username so the login page can pre-fill them.
  app.delete('/api/setup', async () => {
    const a = accountRow();
    if (a) {
      db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('last_login', ?)`).run(JSON.stringify({ host: a.host, username: a.username }));
    }
    db.exec('DELETE FROM account');
    ctx.setClient(null);
    return { ok: true };
  });

  app.post('/api/sync', async (_req, reply) => {
    const client = ctx.getClient();
    if (!client) return reply.code(503).send({ error: 'Account non configurato' });
    void runSync(db, client);
    return { sync: syncState };
  });

  app.get('/api/categories', async (req) => {
    const kind = (req.query as { kind?: string }).kind === 'series' ? 'series' : 'movie';
    if (kind === 'movie') {
      return db
        .prepare(`SELECT c.id, c.name, (SELECT COUNT(*) FROM movie_category mc WHERE mc.category_id = c.id) AS count
                  FROM category c WHERE c.kind = 'movie' ORDER BY c.position`)
        .all();
    }
    return db
      .prepare(`SELECT c.id, c.name, (SELECT COUNT(*) FROM series s WHERE s.category_id = c.id) AS count
                FROM category c WHERE c.kind = 'series' ORDER BY c.position`)
      .all();
  });

  app.get('/api/movies', async (req) => {
    const q = req.query as { category?: string; q?: string; sort?: string; offset?: string; limit?: string };
    const limit = Math.min(Number(q.limit) || 60, 200);
    const offset = Number(q.offset) || 0;
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.category) {
      where.push('m.key IN (SELECT movie_key FROM movie_category WHERE category_id = ?)');
      params.push(q.category);
    }
    if (q.q && q.q.trim()) {
      where.push('m.title LIKE ?');
      params.push(likePattern(q.q));
    }
    const order = q.sort === 'title' ? 'm.title COLLATE NOCASE ASC' : q.sort === 'rating' ? 'm.rating DESC NULLS LAST, m.added DESC' : q.sort === 'year' ? 'm.year DESC NULLS LAST, m.added DESC' : 'm.added DESC';
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM movie m ${w}`).get(...(params as never[])) as { n: number }).n;
    const rows = db
      .prepare(`SELECT ${MOVIE_CARD_SQL} FROM movie m ${movieCardJoin(pid(req))} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...(params as never[]), limit, offset) as MovieRow[];
    return { total, items: rows.map(movieCard) };
  });

  app.get('/api/movies/:key', async (req, reply) => {
    const key = decodeURIComponent((req.params as { key: string }).key);
    const client = ctx.getClient();
    if (client) await ensureMovieDetail(db, client, key);
    const m = db.prepare('SELECT * FROM movie WHERE key = ?').get(key) as Record<string, unknown> | undefined;
    if (!m) return reply.code(404).send({ error: 'Film non trovato' });
    const sources = db.prepare('SELECT stream_id, ext, label, category_id, broken FROM movie_source WHERE movie_key = ? ORDER BY (label IS NOT NULL), stream_id DESC').all(key);
    const categories = db
      .prepare(`SELECT c.id, c.name FROM movie_category mc JOIN category c ON c.id = mc.category_id AND c.kind = 'movie' WHERE mc.movie_key = ? ORDER BY c.position`)
      .all(key);
    const progress = db.prepare(`SELECT position, duration, watched FROM progress WHERE profile_id = ? AND item_type = 'movie' AND item_id = ?`).get(pid(req), key) ?? null;
    const favorite = Boolean(db.prepare(`SELECT 1 FROM favorite WHERE profile_id = ? AND item_type = 'movie' AND item_id = ?`).get(pid(req), key));
    const watchlist = Boolean(db.prepare(`SELECT 1 FROM watchlist WHERE profile_id = ? AND item_type = 'movie' AND item_id = ?`).get(pid(req), key));
    return { ...m, id: m.key, sources, categories, progress, favorite, watchlist };
  });

  app.get('/api/series', async (req) => {
    const q = req.query as { category?: string; q?: string; sort?: string; offset?: string; limit?: string };
    const limit = Math.min(Number(q.limit) || 60, 200);
    const offset = Number(q.offset) || 0;
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.category) {
      where.push('s.category_id = ?');
      params.push(q.category);
    }
    if (q.q && q.q.trim()) {
      where.push('s.title LIKE ?');
      params.push(likePattern(q.q));
    }
    const order = q.sort === 'title' ? 's.title COLLATE NOCASE ASC' : q.sort === 'rating' ? 's.rating DESC NULLS LAST, s.last_modified DESC' : q.sort === 'year' ? 's.year DESC NULLS LAST, s.last_modified DESC' : 's.last_modified DESC';
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM series s ${w}`).get(...(params as never[])) as { n: number }).n;
    const rows = db.prepare(`SELECT ${SERIES_CARD_SQL} FROM series s ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...(params as never[]), limit, offset) as SeriesRow[];
    return { total, items: rows.map(seriesCard) };
  });

  app.get('/api/series/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const client = ctx.getClient();
    if (client) {
      try {
        await ensureEpisodes(db, client, id);
      } catch (e) {
        req.log.warn({ id, err: String(e) }, 'episodes fetch failed');
      }
    }
    const s = db.prepare('SELECT * FROM series WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!s) return reply.code(404).send({ error: 'Serie non trovata' });
    const episodes = db
      .prepare(`SELECT e.*, p.position AS p_position, p.duration AS p_duration, p.watched AS p_watched
                FROM episode e LEFT JOIN progress p ON p.profile_id = ? AND p.item_type = 'episode' AND p.item_id = CAST(e.id AS TEXT)
                WHERE e.series_id = ? ORDER BY e.season, e.num`)
      .all(pid(req), id) as (Record<string, unknown> & { season: number; p_position: number | null; p_duration: number | null; p_watched: number | null })[];
    const seasons = new Map<number, unknown[]>();
    for (const e of episodes) {
      const { p_position, p_duration, p_watched, ...rest } = e;
      const list = seasons.get(e.season) ?? [];
      list.push({ ...rest, progress: p_duration ? { position: p_position, duration: p_duration } : null, watched: Boolean(p_watched) });
      seasons.set(e.season, list);
    }
    const category = db.prepare(`SELECT id, name FROM category WHERE kind = 'series' AND id = ?`).get(String(s.category_id)) ?? null;
    const favorite = Boolean(db.prepare(`SELECT 1 FROM favorite WHERE profile_id = ? AND item_type = 'series' AND item_id = ?`).get(pid(req), String(id)));
    const watchlist = Boolean(db.prepare(`SELECT 1 FROM watchlist WHERE profile_id = ? AND item_type = 'series' AND item_id = ?`).get(pid(req), String(id)));
    return {
      ...s,
      id: String(s.id),
      category,
      favorite,
      watchlist,
      nextEpisode: seriesNextUp(db, pid(req), id),
      seasons: [...seasons.entries()].sort((a, b) => a[0] - b[0]).map(([season, eps]) => ({ season, episodes: eps })),
    };
  });

  app.get('/api/episodes/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const e = db.prepare('SELECT * FROM episode WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!e) return reply.code(404).send({ error: 'Episodio non trovato' });
    const s = db.prepare('SELECT id, title, poster, backdrop FROM series WHERE id = ?').get(e.series_id as number) as Record<string, unknown>;
    const progress = db.prepare(`SELECT position, duration, watched FROM progress WHERE profile_id = ? AND item_type = 'episode' AND item_id = ?`).get(pid(req), String(id)) ?? null;
    const next = db
      .prepare(`SELECT id, season, num, title FROM episode WHERE series_id = ? AND (season > ? OR (season = ? AND num > ?)) ORDER BY season, num LIMIT 1`)
      .get(e.series_id as number, e.season as number, e.season as number, e.num as number) ?? null;
    return { ...e, series: { ...s, id: String(s.id) }, progress, next };
  });

  app.get('/api/search', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').trim();
    if (q.length < 2) return { movies: [], series: [] };
    const pat = likePattern(q);
    const movies = db
      .prepare(`SELECT ${MOVIE_CARD_SQL} FROM movie m ${movieCardJoin(pid(req))} WHERE m.title LIKE ?
                ORDER BY (m.title LIKE ? COLLATE NOCASE) DESC, m.rating DESC NULLS LAST, m.added DESC LIMIT 40`)
      .all(pat, `${q}%`) as MovieRow[];
    const series = db
      .prepare(`SELECT ${SERIES_CARD_SQL} FROM series s WHERE s.title LIKE ?
                ORDER BY (s.title LIKE ? COLLATE NOCASE) DESC, s.rating DESC NULLS LAST, s.last_modified DESC LIMIT 40`)
      .all(pat, `${q}%`) as SeriesRow[];
    return {
      movies: movies.map((r) => ({ ...movieCard(r), discreet: isDiscreetItem(db, 'movie', r.id) })),
      series: series.map((r) => ({ ...seriesCard(r), discreet: isDiscreetSeries(db, Number(r.id)) })),
    };
  });

  app.get('/api/home', async (req) => {
    const rows: { key: string; title: string; items: Card[]; link?: string }[] = [];
    const push = (key: string, title: string, items: Card[], link?: string) => {
      if (items.length) rows.push({ key, title, items, link });
    };

    // 1. Adesso
    push('continue', 'Continua a guardare', continueWatching(db, pid(req)));

    // 2. Per te
    push('new-episodes', 'Nuovi episodi delle tue serie', seriesWithNewEpisodes(db, pid(req)));
    push('watchlist', 'Da guardare', watchlistCards(db, pid(req)), '/favorites?tab=watchlist');
    push('favorites', 'I tuoi preferiti', favoriteCards(db, pid(req)), '/favorites');

    // 3. Novità
    const recentMovies = db
      .prepare(`SELECT ${MOVIE_CARD_SQL} FROM movie m ${movieCardJoin(pid(req))} WHERE m.poster IS NOT NULL ORDER BY m.added DESC LIMIT 30`)
      .all() as MovieRow[];
    push('recent-movies', 'Film aggiunti di recente', recentMovies.map(movieCard), '/movies');
    const recentSeries = db.prepare(`SELECT ${SERIES_CARD_SQL} FROM series s WHERE s.poster IS NOT NULL ORDER BY s.last_modified DESC LIMIT 30`).all() as SeriesRow[];
    push('recent-series', 'Serie aggiornate di recente', recentSeries.map(seriesCard), '/series');

    // 4. Scopri
    const currentYear = new Date().getFullYear();
    const topMovies = db
      .prepare(`SELECT ${MOVIE_CARD_SQL} FROM movie m ${movieCardJoin(pid(req))} WHERE m.poster IS NOT NULL AND m.year >= ? AND m.rating >= 6.5
                ORDER BY m.rating DESC, m.added DESC LIMIT 30`)
      .all(currentYear - 2) as MovieRow[];
    push('top-movies', 'Film recenti più votati', topMovies.map(movieCard));
    const topSeries = db
      .prepare(`SELECT ${SERIES_CARD_SQL} FROM series s WHERE s.poster IS NOT NULL AND s.rating >= 7.5 ORDER BY s.rating DESC, s.last_modified DESC LIMIT 30`)
      .all() as SeriesRow[];
    push('top-series', 'Serie più votate', topSeries.map(seriesCard));

    // Three genre rows, rotating daily so the home page changes.
    const preferred = ['Azione', 'Commedia', 'Thriller', 'Animazione', 'Dramma', 'Fantascienza', 'Horror', 'Crime', 'Avventura', 'Fantasy', 'Famiglia', 'Documentario'];
    const cats = db.prepare(`SELECT id, name FROM category WHERE kind = 'movie' ORDER BY position`).all() as { id: string; name: string }[];
    const available = preferred.map((p) => cats.find((c) => c.name.toLowerCase() === p.toLowerCase())).filter(Boolean) as { id: string; name: string }[];
    const dayIndex = Math.floor(Date.now() / 86_400_000);
    const picked = available.length ? [0, 1, 2].map((i) => available[(dayIndex * 3 + i) % available.length]) : [];
    for (const c of picked) {
      const items = db
        .prepare(`SELECT ${MOVIE_CARD_SQL} FROM movie m ${movieCardJoin(pid(req))}
                  WHERE m.poster IS NOT NULL AND m.key IN (SELECT movie_key FROM movie_category WHERE category_id = ?)
                  ORDER BY m.added DESC LIMIT 30`)
        .all(c.id) as MovieRow[];
      push(`cat-${c.id}`, c.name, items.map(movieCard), `/movies?category=${c.id}`);
    }
    return { rows };
  });

  app.post('/api/progress', async (req, reply) => {
    const b = (req.body ?? {}) as { type?: string; id?: string | number; position?: number; duration?: number };
    if ((b.type !== 'movie' && b.type !== 'episode') || b.id === undefined) return reply.code(400).send({ error: 'type e id obbligatori' });
    const position = Math.max(0, Math.floor(Number(b.position) || 0));
    const duration = Math.max(0, Math.floor(Number(b.duration) || 0));
    const id = String(b.id);
    let seriesId: number | null = null;
    if (b.type === 'episode') {
      const e = db.prepare('SELECT series_id FROM episode WHERE id = ?').get(Number(id)) as { series_id: number } | undefined;
      if (!e) return reply.code(404).send({ error: 'Episodio non trovato' });
      seriesId = e.series_id;
    }
    // Discreet categories leave no trace: no resume point, no "Continua a guardare" entry.
    if (isDiscreetItem(db, b.type, id)) return { ok: true, watched: false, tracked: false };
    const prev = db.prepare('SELECT watched FROM progress WHERE profile_id = ? AND item_type = ? AND item_id = ?').get(pid(req), b.type, id) as { watched: number } | undefined;
    const watched = prev?.watched === 1 || (duration > 0 && (position / duration >= WATCHED_RATIO || duration - position < 60)) ? 1 : 0;
    db.prepare(`
      INSERT INTO progress (profile_id, item_type, item_id, series_id, position, duration, watched, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, item_type, item_id) DO UPDATE SET position = excluded.position, duration = excluded.duration,
        watched = excluded.watched, updated_at = excluded.updated_at, series_id = excluded.series_id
    `).run(pid(req), b.type, id, seriesId, position, duration, watched, now());
    if (watched && b.type === 'movie') db.prepare(`DELETE FROM watchlist WHERE profile_id = ? AND item_type = 'movie' AND item_id = ?`).run(pid(req), id);
    return { ok: true, watched: Boolean(watched) };
  });

  app.post('/api/progress/watched', async (req, reply) => {
    const b = (req.body ?? {}) as { type?: string; id?: string | number; watched?: boolean };
    if ((b.type !== 'movie' && b.type !== 'episode') || b.id === undefined) return reply.code(400).send({ error: 'type e id obbligatori' });
    const id = String(b.id);
    if (b.watched === false) {
      db.prepare('DELETE FROM progress WHERE profile_id = ? AND item_type = ? AND item_id = ?').run(pid(req), b.type, id);
      return { ok: true };
    }
    let seriesId: number | null = null;
    if (b.type === 'episode') {
      const e = db.prepare('SELECT series_id FROM episode WHERE id = ?').get(Number(id)) as { series_id: number } | undefined;
      seriesId = e?.series_id ?? null;
    }
    db.prepare(`
      INSERT INTO progress (profile_id, item_type, item_id, series_id, position, duration, watched, updated_at)
      VALUES (?, ?, ?, ?, 0, 0, 1, ?)
      ON CONFLICT(profile_id, item_type, item_id) DO UPDATE SET watched = 1, updated_at = excluded.updated_at
    `).run(pid(req), b.type, id, seriesId, now());
    if (b.type === 'movie') db.prepare(`DELETE FROM watchlist WHERE profile_id = ? AND item_type = 'movie' AND item_id = ?`).run(pid(req), id);
    return { ok: true };
  });

  app.delete('/api/progress/:type/:id', async (req) => {
    const p = req.params as { type: string; id: string };
    db.prepare('DELETE FROM progress WHERE profile_id = ? AND item_type = ? AND item_id = ?').run(pid(req), p.type, decodeURIComponent(p.id));
    return { ok: true };
  });

  // ---- Live TV ----
  const SPORT_RE = /sport|calcio|dazn|eurosport|football|soccer|campionato|serie [ab]\b|champions|europa league|conference|nba|nfl|motor|f1|moto|tennis|golf|ufc|wwe|fight|boxing|rugby|basket|pallamano|volley|ciclismo|cycling/i;

  app.get('/api/live/categories', async (req) => {
    const all = (req.query as { all?: string }).all === '1';
    const rows = db
      .prepare(`SELECT c.id, c.name, (SELECT COUNT(*) FROM live_channel l WHERE l.category_id = c.id) AS count
                FROM category c WHERE c.kind = 'live' ORDER BY c.position`)
      .all() as { id: string; name: string; count: number }[];
    const nonEmpty = rows.filter((r) => r.count > 0);
    return all ? nonEmpty : nonEmpty.filter((r) => SPORT_RE.test(r.name));
  });

  app.get('/api/live/channels', async (req) => {
    const q = req.query as { category?: string; q?: string; sport?: string; sort?: string; limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit) || 200, 1000);
    const order = q.sort === 'title' ? 'l.name COLLATE NOCASE, c.position' : 'c.position, l.num, l.name';
    const offset = Number(q.offset) || 0;
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.category) {
      where.push('l.category_id = ?');
      params.push(q.category);
    } else if (q.sport === '1') {
      const sportCats = (db.prepare(`SELECT id, name FROM category WHERE kind = 'live'`).all() as { id: string; name: string }[])
        .filter((c) => SPORT_RE.test(c.name))
        .map((c) => c.id);
      where.push(`l.category_id IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(sportCats));
    }
    if (q.q && q.q.trim()) {
      where.push('l.name LIKE ?');
      params.push(likePattern(q.q));
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM live_channel l ${w}`).get(...(params as never[])) as { n: number }).n;
    const rows = db
      .prepare(`SELECT l.id, l.name, l.logo, l.category_id, l.archive, l.epg_channel_id, c.name AS category_name
                FROM live_channel l LEFT JOIN category c ON c.kind = 'live' AND c.id = l.category_id
                ${w} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...(params as never[]), limit, offset) as (Record<string, unknown> & { epg_channel_id: string | null })[];
    const at = now();
    const items = rows.map(({ epg_channel_id, ...r }) => ({ ...r, ...nowNextFor(db, epg_channel_id, at) }));
    return { total, items };
  });

  app.get('/api/live/channels/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const ch = db
      .prepare(`SELECT l.id, l.name, l.logo, l.category_id, l.archive, l.epg_channel_id, c.name AS category_name
                FROM live_channel l LEFT JOIN category c ON c.kind = 'live' AND c.id = l.category_id WHERE l.id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!ch) return reply.code(404).send({ error: 'Canale non trovato' });
    const siblings = db
      .prepare(`SELECT id, name, logo FROM live_channel WHERE category_id = ? ORDER BY num, name`)
      .all(String(ch.category_id)) as { id: number; name: string; logo: string | null }[];
    const idx = siblings.findIndex((s) => s.id === id);
    return {
      ...ch,
      sport: SPORT_RE.test(String(ch.category_name ?? '')),
      prev: idx > 0 ? siblings[idx - 1] : siblings[siblings.length - 1] ?? null,
      next: idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : siblings[0] ?? null,
    };
  });

  app.get('/api/live/epg/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const ch = db.prepare('SELECT epg_channel_id FROM live_channel WHERE id = ?').get(id) as { epg_channel_id: string | null } | undefined;
    if (ch?.epg_channel_id) {
      const at = now();
      const rows = db
        .prepare('SELECT title, description, start, stop FROM epg_programme WHERE channel_id = ? AND stop > ? ORDER BY start LIMIT 4')
        .all(ch.epg_channel_id, at) as { title: string; description: string | null; start: number; stop: number }[];
      if (rows.length) {
        return {
          items: rows.map((r) => ({ title: r.title, description: r.description ?? '', start: r.start, end: r.stop, nowPlaying: r.start <= at && r.stop > at })),
        };
      }
    }
    const client = ctx.getClient();
    if (!client) return { items: [] };
    try {
      const r = await client.getShortEpg(id, 4);
      const items = (r.epg_listings ?? []).map((e) => ({
        title: decodeEpgText(e.title),
        description: decodeEpgText(e.description),
        start: Number(e.start_timestamp) || null,
        end: Number(e.stop_timestamp) || null,
        nowPlaying: e.now_playing === 1,
      }));
      return { items };
    } catch {
      return { items: [] };
    }
  });

  // Official fixtures mapped to live channels. `?epg=1` returns the old EPG-only heuristic instead.
  app.get('/api/live/matches', async (req) => {
    const q = req.query as { days?: string; epg?: string; refresh?: string; main?: string };
    const days = Math.min(Math.max(Number(q.days) || 7, 1), 14);
    const onlyMain = q.main === '1';
    if (q.epg === '1') return { items: upcomingMatches(db, days), source: 'epg' };
    const fixtures = await loadFixtures(db, 14, q.refresh === '1');
    const at = now();
    const cats = sportCategoryIds(db);
    const fallback = fallbackCategories(db);
    const items = fixtures
      .filter((f) => f.start >= at - 3 * 3600 && f.start <= at + days * 86400 && f.status !== 'POSTPONED' && f.status !== 'CANCELLED')
      .filter((f) => !onlyMain || MAIN_COMPETITIONS.has(f.competitionCode))
      .map((f) => {
        const channels = channelsForFixture(db, f, cats);
        const live = f.status === 'IN_PLAY' || f.status === 'PAUSED' || (f.start <= at && at < f.start + 2 * 3600 && f.status !== 'FINISHED');
        return {
          key: f.id,
          title: `${f.home} - ${f.away}`,
          home: f.home,
          away: f.away,
          homeCrest: f.homeCrest ?? null,
          awayCrest: f.awayCrest ?? null,
          competition: f.competition,
          competitionCode: f.competitionCode,
          start: f.start,
          stop: f.start + 2 * 3600,
          status: f.status,
          live,
          replay: false,
          channels: channels.map((c) => ({ id: c.id, name: c.name, logo: c.logo })),
          // Serie A without a channel in the guide is almost always on DAZN (no EPG from the provider).
          fallback: channels.length === 0 && f.competitionCode === 'SA' && fallback.length ? { label: 'DAZN', categoryId: fallback[0].id } : null,
        };
      });
    return { items, source: fixtureState.source, error: fixtureState.error, lastRun: fixtureState.lastRun };
  });

  app.post('/api/settings/fixtures-key', async (req) => {
    const b = (req.body ?? {}) as { key?: string };
    setFixturesKey(db, b.key?.trim() || null);
    await loadFixtures(db, 14, true);
    return { ok: true, source: fixtureState.source, error: fixtureState.error, count: fixtureState.count };
  });

  app.post('/api/settings/tmdb-key', async (req, reply) => {
    const b = (req.body ?? {}) as { key?: string };
    const key = b.key?.trim() || null;
    if (key) {
      try {
        await verifyTmdbKey(key);
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
    }
    setTmdbKey(db, key);
    const client = ctx.getClient();
    if (client) void enrichAllSeries(db, client);
    return { ok: true, hasKey: Boolean(getTmdbKey(db)) };
  });

  app.get('/api/watchlist', async (req) => ({ items: watchlistCards(db, pid(req)) }));

  app.post('/api/watchlist', async (req, reply) => {
    const b = (req.body ?? {}) as { type?: string; id?: string };
    if ((b.type !== 'movie' && b.type !== 'series') || !b.id) return reply.code(400).send({ error: 'type e id obbligatori' });
    db.prepare('INSERT OR IGNORE INTO watchlist (profile_id, item_type, item_id, created_at) VALUES (?, ?, ?, ?)').run(pid(req), b.type, String(b.id), now());
    return { ok: true, watchlist: true };
  });

  app.delete('/api/watchlist/:type/:id', async (req) => {
    const p = req.params as { type: string; id: string };
    db.prepare('DELETE FROM watchlist WHERE profile_id = ? AND item_type = ? AND item_id = ?').run(pid(req), p.type, decodeURIComponent(p.id));
    return { ok: true, watchlist: false };
  });

  app.get('/api/favorites', async (req) => ({ items: favoriteCards(db, pid(req)) }));

  app.post('/api/favorites', async (req, reply) => {
    const b = (req.body ?? {}) as { type?: string; id?: string };
    if ((b.type !== 'movie' && b.type !== 'series') || !b.id) return reply.code(400).send({ error: 'type e id obbligatori' });
    db.prepare('INSERT OR IGNORE INTO favorite (profile_id, item_type, item_id, created_at) VALUES (?, ?, ?, ?)').run(pid(req), b.type, String(b.id), now());
    return { ok: true, favorite: true };
  });

  app.delete('/api/favorites/:type/:id', async (req) => {
    const p = req.params as { type: string; id: string };
    db.prepare('DELETE FROM favorite WHERE profile_id = ? AND item_type = ? AND item_id = ?').run(pid(req), p.type, decodeURIComponent(p.id));
    return { ok: true, favorite: false };
  });
}

/** Series the user follows (favorite or started) that the provider updated after the user's last activity on them. */
function seriesWithNewEpisodes(db: Db, profileId: number): Card[] {
  const rows = db
    .prepare(`
      SELECT ${SERIES_CARD_SQL}, s.last_modified,
        (SELECT MAX(p.updated_at) FROM progress p WHERE p.profile_id = ? AND p.item_type = 'episode' AND p.series_id = s.id) AS last_activity,
        (SELECT f.created_at FROM favorite f WHERE f.profile_id = ? AND f.item_type = 'series' AND f.item_id = CAST(s.id AS TEXT)) AS fav_at
      FROM series s
      WHERE (fav_at IS NOT NULL OR last_activity IS NOT NULL)
        AND s.last_modified > COALESCE(last_activity, fav_at)
      ORDER BY s.last_modified DESC LIMIT 20
    `)
    .all(profileId, profileId) as (SeriesRow & { last_modified: number })[];
  return rows.map((r) => {
    const card = seriesCard(r);
    card.subtitle = `Aggiornata ${new Date(r.last_modified * 1000).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}`;
    return card;
  });
}

function favoriteCards(db: Db, profileId: number): Card[] {
  return listCards(db, profileId, 'favorite');
}

function watchlistCards(db: Db, profileId: number): Card[] {
  return listCards(db, profileId, 'watchlist');
}

function listCards(db: Db, profileId: number, table: 'favorite' | 'watchlist'): Card[] {
  const rows = db
    .prepare(`SELECT f.item_type, f.item_id, f.created_at FROM ${table} f WHERE f.profile_id = ? ORDER BY f.created_at DESC LIMIT 100`)
    .all(profileId) as { item_type: 'movie' | 'series'; item_id: string }[];
  const out: Card[] = [];
  for (const f of rows) {
    if (f.item_type === 'movie') {
      const m = db.prepare(`SELECT ${MOVIE_CARD_SQL} FROM movie m ${movieCardJoin(profileId)} WHERE m.key = ?`).get(f.item_id) as MovieRow | undefined;
      if (m) out.push(movieCard(m));
    } else {
      const s = db.prepare(`SELECT ${SERIES_CARD_SQL} FROM series s WHERE s.id = ?`).get(Number(f.item_id)) as SeriesRow | undefined;
      if (s) out.push(seriesCard(s));
    }
  }
  return out;
}

type NextUp = { episodeId: number; season: number; num: number; title: string | null; position: number; duration: number; image: string | null } | null;

/** The episode a user should play next for a series: in-progress one, else the first unwatched after the last watched. */
function seriesNextUp(db: Db, profileId: number, seriesId: number): NextUp {
  const inProgress = db
    .prepare(`
      SELECT e.id, e.season, e.num, e.title, e.image, p.position, p.duration
      FROM progress p JOIN episode e ON e.id = CAST(p.item_id AS INTEGER)
      WHERE p.profile_id = ? AND p.item_type = 'episode' AND p.series_id = ? AND p.watched = 0 AND p.position > 0
      ORDER BY p.updated_at DESC LIMIT 1
    `)
    .get(profileId, seriesId) as { id: number; season: number; num: number; title: string | null; image: string | null; position: number; duration: number } | undefined;
  if (inProgress) return { episodeId: inProgress.id, season: inProgress.season, num: inProgress.num, title: inProgress.title, position: inProgress.position, duration: inProgress.duration, image: inProgress.image };

  const lastWatched = db
    .prepare(`
      SELECT e.season, e.num FROM progress p JOIN episode e ON e.id = CAST(p.item_id AS INTEGER)
      WHERE p.profile_id = ? AND p.item_type = 'episode' AND p.series_id = ? AND p.watched = 1
      ORDER BY e.season DESC, e.num DESC LIMIT 1
    `)
    .get(profileId, seriesId) as { season: number; num: number } | undefined;
  const next = lastWatched
    ? (db
        .prepare(`
          SELECT e.id, e.season, e.num, e.title, e.image FROM episode e
          WHERE e.series_id = ? AND (e.season > ? OR (e.season = ? AND e.num > ?))
            AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.profile_id = ? AND p.item_type = 'episode' AND p.item_id = CAST(e.id AS TEXT) AND p.watched = 1)
          ORDER BY e.season, e.num LIMIT 1
        `)
        .get(seriesId, lastWatched.season, lastWatched.season, lastWatched.num, profileId) as { id: number; season: number; num: number; title: string | null; image: string | null } | undefined)
    : (db.prepare('SELECT id, season, num, title, image FROM episode WHERE series_id = ? ORDER BY season, num LIMIT 1').get(seriesId) as
        | { id: number; season: number; num: number; title: string | null; image: string | null }
        | undefined);
  if (!next) return null;
  return { episodeId: next.id, season: next.season, num: next.num, title: next.title, position: 0, duration: 0, image: next.image };
}

function continueWatching(db: Db, profileId: number): Card[] {
  const out: Card[] = [];
  const movies = db
    .prepare(`
      SELECT ${MOVIE_CARD_SQL}, p.updated_at AS updated_at FROM progress p JOIN movie m ON m.key = p.item_id
      WHERE p.profile_id = ? AND p.item_type = 'movie' AND p.watched = 0 AND p.position > 30
      ORDER BY p.updated_at DESC LIMIT 20
    `)
    .all(profileId) as (MovieRow & { updated_at: number })[];
  const seriesIds = db
    .prepare(`
      SELECT p.series_id, MAX(p.updated_at) AS updated_at FROM progress p
      WHERE p.profile_id = ? AND p.item_type = 'episode' AND p.series_id IS NOT NULL
      GROUP BY p.series_id ORDER BY updated_at DESC LIMIT 20
    `)
    .all(profileId) as { series_id: number; updated_at: number }[];

  const merged: { updated_at: number; card: Card }[] = movies.map((m) => ({ updated_at: m.updated_at, card: movieCard(m) }));
  for (const s of seriesIds) {
    const next = seriesNextUp(db, profileId, s.series_id);
    if (!next) continue;
    const row = db.prepare(`SELECT ${SERIES_CARD_SQL} FROM series s WHERE s.id = ?`).get(s.series_id) as SeriesRow | undefined;
    if (!row) continue;
    const card = seriesCard(row);
    card.episodeId = next.episodeId;
    card.subtitle = `S${next.season} E${next.num}${next.title ? ` · ${next.title}` : ''}`;
    card.progress = next.duration ? { position: next.position, duration: next.duration } : null;
    merged.push({ updated_at: s.updated_at, card });
  }
  merged.sort((a, b) => b.updated_at - a.updated_at);
  for (const m of merged.slice(0, 20)) out.push(m.card);
  return out;
}
