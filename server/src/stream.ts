import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';
import { PLAYER_USER_AGENT, type XtreamClient } from './xtream.ts';

type Ctx = { db: Db; getClient: () => XtreamClient | null };

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

const EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  mov: 'video/quicktime',
};

function looksLikeVideo(res: Response): boolean {
  if (res.status !== 200 && res.status !== 206) return false;
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  if (ct.startsWith('video/') || ct.startsWith('audio/') || ct === 'application/octet-stream') return true;
  if (ct.startsWith('text/html')) return false;
  // Some edges send no/odd content-type; trust a real content-length.
  return Number(res.headers.get('content-length') ?? 0) > 1024;
}

async function openUpstream(url: string, req: FastifyRequest): Promise<Response> {
  const headers: Record<string, string> = { 'User-Agent': PLAYER_USER_AGENT };
  const range = req.headers.range;
  if (range) headers.Range = String(range);
  return fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
}

async function pipeUpstream(res: Response, reply: FastifyReply, ext: string) {
  reply.code(res.status);
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v) reply.header(h, v);
  }
  const ct = res.headers.get('content-type');
  if (!ct || ct === 'application/octet-stream') reply.header('content-type', EXT_MIME[ext] ?? 'video/mp4');
  // Some panels send a non-standard Accept-Ranges value; browsers need the literal "bytes".
  reply.header('accept-ranges', 'bytes');
  reply.header('cache-control', 'no-store');
  if (!res.body) return reply.send();
  const body = Readable.fromWeb(res.body as never);
  return reply.send(body);
}

// ---- Live TV (HLS) ----
// Playlists reference segments on the provider's edge servers, which browsers cannot fetch
// directly (CORS, User-Agent checks). We rewrite every URI to go through this server and sign
// it so the proxy cannot be used to fetch arbitrary URLs.
const SECRET = randomBytes(32);
const sign = (url: string) => createHmac('sha256', SECRET).update(url).digest('hex').slice(0, 32);
const proxied = (kind: 'pl' | 'seg', url: string) => `/stream/live/${kind}?u=${encodeURIComponent(url)}&s=${sign(url)}`;

function verifyParams(req: FastifyRequest): string | null {
  const { u, s } = req.query as { u?: string; s?: string };
  if (!u || !s) return null;
  const expected = sign(u);
  if (expected.length !== s.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null;
  return u;
}

function rewritePlaylist(text: string, baseUrl: string): string {
  const out: string[] = [];
  let nextIsPlaylist = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      if (line.startsWith('#EXT-X-STREAM-INF')) nextIsPlaylist = true;
      // Keys / init segments carry URIs inside attributes.
      out.push(line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${proxied('seg', new URL(uri, baseUrl).toString())}"`));
      continue;
    }
    const abs = new URL(line, baseUrl).toString();
    const isPlaylist = nextIsPlaylist || /\.m3u8(\?|$)/i.test(abs);
    out.push(proxied(isPlaylist ? 'pl' : 'seg', abs));
    nextIsPlaylist = false;
  }
  return out.join('\n') + '\n';
}

async function servePlaylist(url: string, reply: FastifyReply, log: FastifyRequest['log']) {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': PLAYER_USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    return reply.code(502).send({ error: `Errore provider: ${String(e)}` });
  }
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  const body = await res.text().catch(() => '');
  if (!res.ok || !body.startsWith('#EXTM3U')) {
    log.warn({ status: res.status, ct, url: url.replace(/\/live\/[^/]+\/[^/]+\//, '/live/U/P/') }, 'live playlist unavailable');
    const hint = res.status === 407 || res.status === 403 || res.status === 429 ? ' Canale non disponibile o limite connessioni raggiunto.' : '';
    return reply.code(502).send({ error: `Canale non disponibile (HTTP ${res.status}).${hint}` });
  }
  reply.header('content-type', 'application/vnd.apple.mpegurl');
  reply.header('cache-control', 'no-store');
  return reply.send(rewritePlaylist(body, res.url || url));
}

export function registerStreamRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/stream/live/:id/index.m3u8', async (req, reply) => {
    const client = ctx.getClient();
    if (!client) return reply.code(503).send({ error: 'Account non configurato' });
    const id = Number((req.params as { id: string }).id);
    if (!ctx.db.prepare('SELECT 1 FROM live_channel WHERE id = ?').get(id)) return reply.code(404).send({ error: 'Canale non trovato' });
    return servePlaylist(client.liveUrl(id, 'm3u8'), reply, req.log);
  });

  app.get('/stream/live/pl', async (req, reply) => {
    const url = verifyParams(req);
    if (!url) return reply.code(403).send({ error: 'URL non firmato' });
    return servePlaylist(url, reply, req.log);
  });

  app.get('/stream/live/seg', async (req, reply) => {
    const url = verifyParams(req);
    if (!url) return reply.code(403).send({ error: 'URL non firmato' });
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': PLAYER_USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      return reply.code(502).send({ error: `Errore provider: ${String(e)}` });
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return reply.code(502).send({ error: `Segmento non disponibile (HTTP ${res.status})` });
    }
    reply.code(200);
    reply.header('content-type', res.headers.get('content-type') || 'video/mp2t');
    const len = res.headers.get('content-length');
    if (len) reply.header('content-length', len);
    reply.header('cache-control', 'no-store');
    return reply.send(res.body ? Readable.fromWeb(res.body as never) : undefined);
  });

  // Raw MPEG-TS passthrough (for native clients that prefer it over HLS).
  app.get('/stream/live/:id.ts', async (req, reply) => {
    const client = ctx.getClient();
    if (!client) return reply.code(503).send({ error: 'Account non configurato' });
    const id = Number((req.params as { id: string }).id);
    let res: Response;
    try {
      res = await fetch(client.liveUrl(id, 'ts'), { headers: { 'User-Agent': PLAYER_USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      return reply.code(502).send({ error: `Errore provider: ${String(e)}` });
    }
    if (!looksLikeVideo(res)) {
      await res.body?.cancel().catch(() => {});
      return reply.code(502).send({ error: `Canale non disponibile (HTTP ${res.status})` });
    }
    reply.code(200);
    reply.header('content-type', 'video/mp2t');
    reply.header('cache-control', 'no-store');
    return reply.send(Readable.fromWeb(res.body as never));
  });

  // Movie: try preferred source, then alternates; flag dead ones.
  app.get('/stream/movie/:key', async (req, reply) => {
    const client = ctx.getClient();
    if (!client) return reply.code(503).send({ error: 'Account non configurato' });
    const key = decodeURIComponent((req.params as { key: string }).key);
    const movie = ctx.db.prepare('SELECT stream_id, ext FROM movie WHERE key = ?').get(key) as { stream_id: number; ext: string } | undefined;
    if (!movie) return reply.code(404).send({ error: 'Film non trovato' });

    const sources = ctx.db
      .prepare(
        `SELECT stream_id, ext FROM movie_source WHERE movie_key = ? AND broken = 0
         ORDER BY (stream_id = ?) DESC, (label IS NOT NULL), stream_id DESC`,
      )
      .all(key, movie.stream_id) as { stream_id: number; ext: string }[];
    if (sources.length === 0) sources.push(movie);

    for (const src of sources) {
      let res: Response;
      try {
        res = await openUpstream(client.movieUrl(src.stream_id, src.ext), req);
      } catch (e) {
        req.log.warn({ stream_id: src.stream_id, err: String(e) }, 'upstream error');
        continue;
      }
      if (looksLikeVideo(res)) {
        if (src.stream_id !== movie.stream_id) {
          ctx.db.prepare('UPDATE movie SET stream_id = ?, ext = ? WHERE key = ?').run(src.stream_id, src.ext, key);
        }
        return pipeUpstream(res, reply, src.ext);
      }
      req.log.warn({ stream_id: src.stream_id, status: res.status, ct: res.headers.get('content-type') }, 'dead source');
      await res.body?.cancel().catch(() => {});
      if (res.status === 200 || res.status === 404 || res.status === 461) {
        ctx.db.prepare('UPDATE movie_source SET broken = 1 WHERE stream_id = ?').run(src.stream_id);
      } else if (res.status === 429 || res.status === 403 || res.status === 509) {
        // Connection limit or auth problem: not the source's fault.
        return reply.code(res.status).send({ error: `Provider ha rifiutato lo stream (HTTP ${res.status}). Connessioni massime raggiunte?` });
      }
    }
    return reply.code(502).send({ error: 'Nessuna sorgente funzionante per questo film' });
  });

  app.get('/stream/episode/:id', async (req, reply) => {
    const client = ctx.getClient();
    if (!client) return reply.code(503).send({ error: 'Account non configurato' });
    const id = Number((req.params as { id: string }).id);
    const ep = ctx.db.prepare('SELECT id, ext FROM episode WHERE id = ?').get(id) as { id: number; ext: string } | undefined;
    if (!ep) return reply.code(404).send({ error: 'Episodio non trovato' });
    let res: Response;
    try {
      res = await openUpstream(client.episodeUrl(ep.id, ep.ext), req);
    } catch (e) {
      return reply.code(502).send({ error: `Errore provider: ${String(e)}` });
    }
    if (!looksLikeVideo(res)) {
      await res.body?.cancel().catch(() => {});
      return reply.code(502).send({ error: `Provider non ha restituito video (HTTP ${res.status})` });
    }
    return pipeUpstream(res, reply, ep.ext);
  });
}
