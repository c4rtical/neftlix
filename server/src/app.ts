import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { openDb } from './db.ts';
import { XtreamClient } from './xtream.ts';
import { registerApiRoutes } from './routes.ts';
import { registerProfileRoutes } from './profiles.ts';
import { registerStreamRoutes } from './stream.ts';
import { registerLan, type LanOptions } from './lan.ts';
import { EPG_REFRESH_SECS, epgState, refreshEpg } from './epg.ts';
import { loadFixtures } from './fixtures.ts';

export type AppOptions = {
  /** Directory of the SQLite database (created if missing). */
  dataDir: string;
  /** Built web app to serve at `/`; when missing, only the API and streams are served (Vite dev mode). */
  webDist?: string;
  /** Optional HTTP basic-auth password protecting every route. */
  password?: string;
  /** Fastify/pino log level, default 'info'. */
  logLevel?: string;
  /** "Apri dalla TV": clients that are not on loopback must enter this PIN once (cookie). */
  lan?: LanOptions;
};

export type AppHandle = {
  app: FastifyInstance;
  /** Starts listening and returns the effective URL, e.g. http://127.0.0.1:53412 (port 0 picks a free one). */
  listen: (host: string, port: number) => Promise<string>;
  /** Stops timers, closes the HTTP server and the database. */
  close: () => Promise<void>;
};

const EPG_TICK_MS = 30 * 60 * 1000;

export async function createApp(opts: AppOptions): Promise<AppHandle> {
  const db = openDb(resolve(opts.dataDir, 'neftlix.sqlite'));

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
    logger: { level: opts.logLevel ?? 'info' },
    bodyLimit: 1024 * 1024,
  });

  // Optional password: protects every route (API, streams and the web app itself).
  const password = opts.password?.trim();
  if (password) {
    const expected = Buffer.from(password);
    app.addHook('onRequest', async (req, reply) => {
      const header = req.headers.authorization ?? '';
      let ok = false;
      if (header.startsWith('Basic ')) {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const given = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
        ok = given.length === expected.length && timingSafeEqual(given, expected);
      }
      if (!ok) {
        reply.header('www-authenticate', 'Basic realm="Neftlix", charset="UTF-8"');
        return reply.code(401).send({ error: 'Password richiesta' });
      }
    });
    app.log.info('password protection enabled');
  }

  // Before the profile guard: a TV without the LAN cookie must see the PIN page, not NO_PROFILE.
  if (opts.lan) registerLan(app, opts.lan);
  registerProfileRoutes(app, db);
  registerApiRoutes(app, ctx);
  registerStreamRoutes(app, ctx);

  const webDist = opts.webDist && existsSync(opts.webDist) ? opts.webDist : null;
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
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

  // Keep the live-TV guide fresh: on boot when stale, then periodically. Warm the fixtures
  // cache too, so the first user to open Home or Sport doesn't wait for the paced fetch.
  const epgTick = () => {
    const c = ctx.getClient();
    if (!c) return;
    const stale = !epgState.lastRun || Date.now() / 1000 - epgState.lastRun > EPG_REFRESH_SECS - 60;
    const empty = (db.prepare('SELECT COUNT(*) AS n FROM epg_programme WHERE stop > ?').get(Math.floor(Date.now() / 1000)) as { n: number }).n === 0;
    if (stale || empty) void refreshEpg(db, c);
    void loadFixtures(db, 14).catch(() => {});
  };
  const bootTimer = setTimeout(epgTick, 3000);
  const periodicTimer = setInterval(epgTick, EPG_TICK_MS);
  bootTimer.unref();
  periodicTimer.unref();

  app.addHook('onClose', async () => db.close());

  return {
    app,
    listen: async (host, port) => {
      await app.listen({ port, host });
      const address = app.server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      app.log.info(`data dir: ${opts.dataDir}; web: ${webDist ?? 'dev mode (use Vite on :5173)'}`);
      return `http://${host}:${actualPort}`;
    },
    close: async () => {
      clearTimeout(bootTimer);
      clearInterval(periodicTimer);
      // Drop keep-alive sockets too: otherwise a browser tab can keep sending requests on an
      // old connection after the database has been closed (seen when the desktop app re-binds
      // the server for "Apri dalla TV").
      app.server.closeAllConnections();
      await app.close();
    },
  };
}
