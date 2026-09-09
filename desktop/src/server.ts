/** Starts the bundled Neftlix server (compiled to JS by the build) on a random loopback port. */
type ServerModule = {
  createApp: (opts: { dataDir: string; webDist?: string; logLevel?: string }) => Promise<{
    listen: (host: string, port: number) => Promise<string>;
    close: () => Promise<void>;
  }>;
};

export type RunningServer = { url: string; close: () => Promise<void> };

export async function startServer(dataDir: string, webDist: string, debug: boolean): Promise<RunningServer> {
  const mod = (await import(new URL('./server/app.js', import.meta.url).href)) as ServerModule;
  const handle = await mod.createApp({ dataDir, webDist, logLevel: debug ? 'info' : 'warn' });
  const url = await handle.listen('127.0.0.1', 0);
  return { url, close: () => handle.close() };
}
