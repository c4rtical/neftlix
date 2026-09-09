/** Starts the bundled Neftlix server (compiled to JS by the build), preferring the loopback port from a
 * previous launch so the web app's localStorage (search history, "Da guardare", etc.) survives restarts —
 * localStorage is keyed by origin, and origin includes the port. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type ServerModule = {
  createApp: (opts: { dataDir: string; webDist?: string; logLevel?: string }) => Promise<{
    listen: (host: string, port: number) => Promise<string>;
    close: () => Promise<void>;
  }>;
};

export type RunningServer = { url: string; close: () => Promise<void> };

function readSavedPort(portFile: string): number | null {
  try {
    const raw = JSON.parse(readFileSync(portFile, 'utf8')) as { port?: unknown };
    if (typeof raw.port === 'number' && Number.isInteger(raw.port) && raw.port >= 1024 && raw.port <= 65535) {
      return raw.port;
    }
  } catch {
    /* first run or unreadable: no saved port */
  }
  return null;
}

export async function startServer(
  dataDir: string,
  webDist: string,
  debug: boolean,
  log: (line: string) => void = () => {},
): Promise<RunningServer> {
  const mod = (await import(new URL('./server/app.js', import.meta.url).href)) as ServerModule;
  // dataDir is `<userData>/data`, so its parent is userData.
  const portFile = join(dirname(dataDir), 'port.json');
  const savedPort = readSavedPort(portFile);
  const opts = { dataDir, webDist, logLevel: debug ? 'info' : 'warn' };

  let handle = await mod.createApp(opts);
  let url: string;
  if (savedPort !== null) {
    try {
      url = await handle.listen('127.0.0.1', savedPort);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`saved port ${savedPort} unavailable (${msg}); falling back to a random port`);
      // A failed listen() may leave the Fastify instance unusable; close it and build a fresh one
      // rather than risk reusing it (it also releases the db handle/timers createApp already set up).
      await handle.close().catch(() => {});
      handle = await mod.createApp(opts);
      url = await handle.listen('127.0.0.1', 0);
    }
  } else {
    url = await handle.listen('127.0.0.1', 0);
  }

  const effectivePort = Number(new URL(url).port);
  try {
    writeFileSync(portFile, JSON.stringify({ port: effectivePort }));
  } catch {
    /* not fatal: next launch just falls back to a random port again */
  }
  log(`server listening on port ${effectivePort}`);

  return { url, close: () => handle.close() };
}
