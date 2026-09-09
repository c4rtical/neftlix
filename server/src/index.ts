import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { openDb } from './db.ts';
import { XtreamClient } from './xtream.ts';
import { registerApiRoutes } from './routes.ts';
import { registerStreamRoutes } from './stream.ts';
import { EPG_REFRESH_SECS, epgState, refreshEpg } from './epg.ts';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.NEFTLIX_DATA ?? resolve(here, '../../data');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const WEB_DIST = resolve(here, '../../web/dist');

const db = openDb(resolve(DATA_DIR, 'neftlix.sqlite'));

let client: XtreamClient | null = null;
const account = db.prepare('SELECT host, username, password FROM account WHERE id = 1').get() as
  | { host: string; username: string; password: string }
  | undefined;
if (account) client = new XtreamClient(account);

const ctx = {
  db,
  getClient: () => client,
  setClient: (c: XtreamClient | null) => {
    client = c;
  },
};

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 1024 * 1024,
});

registerApiRoutes(app, ctx);
registerStreamRoutes(app, ctx);

if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, {
    root: WEB_DIST,
    prefix: '/',
    wildcard: false,
    cacheControl: false,
  });
  // Hashed assets can be cached forever; index.html must always be revalidated,
  // otherwise a stale page points at JS files that no longer exist (blank screen).
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/stream/')) return;
    if (req.url.startsWith('/assets/')) reply.header('cache-control', 'public, max-age=31536000, immutable');
    else reply.header('cache-control', 'no-cache');
  });
  // SPA fallback for client-side routes.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/stream/')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
}

// Keep the live-TV guide fresh: on boot when stale, then periodically.
const epgTick = () => {
  const c = ctx.getClient();
  if (!c) return;
  const stale = !epgState.lastRun || Date.now() / 1000 - epgState.lastRun > EPG_REFRESH_SECS - 60;
  const empty = (db.prepare('SELECT COUNT(*) AS n FROM epg_programme WHERE stop > ?').get(Math.floor(Date.now() / 1000)) as { n: number }).n === 0;
  if (stale || empty) void refreshEpg(db, c);
};
setTimeout(epgTick, 3000);
setInterval(epgTick, 30 * 60 * 1000).unref();

app.addHook('onClose', async () => db.close());

await app.listen({ port: PORT, host: HOST });
app.log.info(`data dir: ${DATA_DIR}; web: ${existsSync(WEB_DIST) ? WEB_DIST : 'dev mode (use Vite on :5173)'}`);
