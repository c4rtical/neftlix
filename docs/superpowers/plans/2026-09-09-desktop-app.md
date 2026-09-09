# App desktop (Electron) — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un'app Neftlix scaricabile per Windows (.exe) e macOS (.dmg) che avvia il server esistente su 127.0.0.1 e lo mostra in una finestra, pubblicata su GitHub Releases dal tag `v*`.

**Architecture:** Il server Fastify viene estratto in `createApp()` (riusato da CLI/Docker e dall'app). Un nuovo workspace `desktop/` contiene il main process Electron in TypeScript, che importa il server compilato in JS, lo avvia su porta casuale e apre una `BrowserWindow` sull'URL locale. `electron-builder` impacchetta `desktop/dist` (main + server compilato + web build); una GitHub Action lo esegue su macOS e Windows al tag.

**Tech Stack:** Electron 44 (Node 24, Chromium 152), electron-builder 26, TypeScript 5.9 con `rewriteRelativeImportExtensions`, Fastify 5, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-09-desktop-app-design.md`

## Global Constraints

- Il server in sviluppo resta TypeScript nativo (`node src/index.ts`); il pacchetto desktop usa il server compilato in `server/dist` da `tsc -p server/tsconfig.build.json`.
- Server TypeScript: `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUnusedLocals`; import locali con estensione `.ts` (riscritti in `.js` solo dalla build).
- Il desktop ascolta solo su `127.0.0.1`, porta `0` (scelta dal sistema); dati in `app.getPath('userData')/data`.
- Nessuna modifica al codice di `web/`: la finestra carica `http://127.0.0.1:<porta>/`.
- Nessuna firma del codice: `CSC_IDENTITY_AUTO_DISCOVERY=false` in CI, `mac.identity: null`.
- Piattaforme del primo rilascio: macOS dmg universal, Windows nsis x64.
- Testi UI in italiano. Commit `feat:`/`docs:`/`chore:`; ogni commit termina con le due righe di attribuzione della sessione (`Co-Authored-By` e `Claude-Session`).
- Verifica: `npm run check`, `npm test`, `npm run build --workspace=desktop`.
- Dipendenze nuove ammesse: `electron`, `electron-builder` (dev, solo in `desktop/`); `fastify` e `@fastify/static` dichiarate anche in `desktop/package.json` come runtime per l'impacchettamento.

---

## File structure

| File | Responsabilità |
|---|---|
| `server/src/app.ts` (nuovo) | `createApp(opts)`: DB, client, hook password opzionale, rotte, static, timer EPG/fixtures, `listen`, `close`. |
| `server/src/index.ts` | Wrapper CLI: env → `createApp` → `listen`. |
| `server/tsconfig.build.json` (nuovo) | Emissione JS in `server/dist`. |
| `server/test/app.test.ts` (nuovo) | Test di `createApp`. |
| `desktop/package.json`, `desktop/tsconfig.json`, `desktop/electron-builder.yml` | Workspace e packaging. |
| `desktop/src/main.ts` | Ciclo di vita, finestra, menu, log. |
| `desktop/src/server.ts` | Avvio del server compilato su porta casuale. |
| `desktop/src/window-state.ts` | Persistenza posizione/dimensione. |
| `desktop/scripts/prepare.mjs` | Copia `server/dist` e `web/dist` in `desktop/dist`. |
| `desktop/build/icon.png` | Icona 1024×1024. |
| `package.json`, `.gitignore` | Workspace `desktop`, script `desktop` e `desktop:dist`, ignore di `desktop/dist` e `desktop/release`. |
| `.github/workflows/ci.yml`, `.github/workflows/release.yml` | Build desktop in CI; release al tag. |
| `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md` | Sezione Download, changelog, procedura di rilascio. |

---

### Task 1: `createApp` nel server

**Files:**
- Create: `server/src/app.ts`, `server/tsconfig.build.json`, `server/test/app.test.ts`
- Modify: `server/src/index.ts`, `server/package.json`, `.gitignore`

**Interfaces:**
- Produces: `createApp(opts: AppOptions): Promise<AppHandle>` con `AppOptions = { dataDir: string; webDist?: string; password?: string; logLevel?: string }` e `AppHandle = { app: FastifyInstance; listen(host: string, port: number): Promise<string>; close(): Promise<void> }`. `listen` restituisce l'URL effettivo (`http://127.0.0.1:53412`).
- `npm run build --workspace=server` emette `server/dist/**/*.js` con import `.js`.

- [ ] **Step 1: Test di `createApp`**

Crea `server/test/app.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';

function tmpDirs() {
  const root = mkdtempSync(join(tmpdir(), 'neftlix-app-'));
  const webDist = join(root, 'web');
  mkdirSync(webDist);
  writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>Neftlix test</title>');
  return { dataDir: join(root, 'data'), webDist };
}

test('createApp listens on a random loopback port, serves the API and the web build, and closes', async () => {
  const { dataDir, webDist } = tmpDirs();
  const handle = await createApp({ dataDir, webDist, logLevel: 'silent' });
  const url = await handle.listen('127.0.0.1', 0);
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.notEqual(new URL(url).port, '0');

  const status = await fetch(`${url}/api/status`);
  assert.equal(status.status, 200);
  assert.equal((await status.json() as { configured: boolean }).configured, false);

  const index = await fetch(`${url}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Neftlix test/);

  const spa = await fetch(`${url}/settings`);
  assert.equal(spa.status, 200, 'client-side routes fall back to index.html');

  await handle.close();
  await assert.rejects(fetch(`${url}/api/status`), 'the port is released after close');
});

test('createApp with a password requires HTTP basic auth on every route', async () => {
  const { dataDir, webDist } = tmpDirs();
  const handle = await createApp({ dataDir, webDist, password: 'segreto', logLevel: 'silent' });
  const url = await handle.listen('127.0.0.1', 0);
  assert.equal((await fetch(`${url}/api/status`)).status, 401);
  const ok = await fetch(`${url}/api/status`, { headers: { authorization: `Basic ${Buffer.from('x:segreto').toString('base64')}` } });
  assert.equal(ok.status, 200);
  await handle.close();
});
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `npm test`
Expected: FAIL, `Cannot find module '../src/app.ts'`.

- [ ] **Step 3: Scrivi `server/src/app.ts`**

```ts
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
      await app.close();
    },
  };
}
```

- [ ] **Step 4: Riduci `server/src/index.ts` al wrapper CLI**

Sostituisci l'intero file con:

```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.ts';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.NEFTLIX_DATA ?? resolve(here, '../../data');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const WEB_DIST = resolve(here, '../../web/dist');

const handle = await createApp({
  dataDir: DATA_DIR,
  webDist: WEB_DIST,
  password: process.env.NEFTLIX_PASSWORD,
  logLevel: process.env.LOG_LEVEL,
});
await handle.listen(HOST, PORT);
```

- [ ] **Step 5: Build config e script**

Crea `server/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "allowImportingTsExtensions": false,
    "rewriteRelativeImportExtensions": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

In `server/package.json` aggiungi lo script `"build": "tsc -p tsconfig.build.json"`. In `.gitignore` aggiungi la riga `server/dist/`.

- [ ] **Step 6: Verifica**

Run: `npm test && npm run check && npm run build --workspace=server && ls server/dist/app.js server/dist/index.js && grep -n "from './db.js'" server/dist/app.js | head -1`
Expected: tutti i test PASS (i due nuovi compresi), typecheck pulito, `server/dist` contiene i `.js` con import riscritti in `.js`.

Run anche lo smoke test del CLI: `PORT=8798 NEFTLIX_DATA=/tmp/neftlix-t1 node --no-warnings=ExperimentalWarning server/src/index.ts & sleep 3; curl -sf http://localhost:8798/api/status >/dev/null && echo OK; kill %1`
Expected: `OK`.

- [ ] **Step 7: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/tsconfig.build.json server/test/app.test.ts server/package.json .gitignore
git commit -m "refactor(server): createApp() with listen/close; JS build for packaging"
```

---

### Task 2: Workspace `desktop/` con Electron

**Files:**
- Create: `desktop/package.json`, `desktop/tsconfig.json`, `desktop/electron-builder.yml`, `desktop/scripts/prepare.mjs`, `desktop/src/main.ts`, `desktop/src/server.ts`, `desktop/src/window-state.ts`, `desktop/build/icon.png`
- Modify: `package.json` (radice), `.gitignore`

**Interfaces:**
- Consumes: `server/dist/app.js` (`createApp`) e `web/dist`.
- Produces: `npm run desktop` (radice) avvia l'app in sviluppo; `npm run desktop:dist` produce il pacchetto in `desktop/release/`.

- [ ] **Step 1: `desktop/package.json`**

```json
{
  "name": "@neftlix/desktop",
  "private": true,
  "version": "0.1.0",
  "description": "Neftlix desktop app",
  "type": "module",
  "main": "dist/main.js",
  "author": "c4rtical",
  "license": "MIT",
  "scripts": {
    "build:server": "npm run build --workspace=server --prefix ..",
    "build:web": "npm run build --workspace=web --prefix ..",
    "build:main": "tsc -p .",
    "prepare:dist": "node scripts/prepare.mjs",
    "build": "npm run build:server && npm run build:web && npm run build:main && npm run prepare:dist",
    "check": "tsc --noEmit -p .",
    "dev": "npm run build && cross-env-shell NEFTLIX_DEBUG=1 electron .",
    "dist": "npm run build && electron-builder --publish never",
    "release": "npm run build && electron-builder --publish always"
  },
  "dependencies": {
    "@fastify/static": "^8.0.0",
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "electron": "^44.3.0",
    "electron-builder": "^26.0.0",
    "typescript": "^5.8.0"
  }
}
```

Nota: `cross-env-shell` non è una dipendenza; sostituisci lo script `dev` con `"dev": "npm run build && electron ."` e leggi `NEFTLIX_DEBUG` solo se l'utente la esporta. Nessuna dipendenza extra.

`desktop/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src"]
}
```

(`DOM` serve solo per il tipo `URL`/`fetch` usato in main; `types: ["node"]` con `@types/node` hoistato dalla radice.)

- [ ] **Step 2: `desktop/src/server.ts`**

```ts
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
```

- [ ] **Step 3: `desktop/src/window-state.ts`**

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';

export type WindowState = { x?: number; y?: number; width: number; height: number; maximized: boolean };

const DEFAULT: WindowState = { width: 1280, height: 800, maximized: false };

export function loadWindowState(userData: string): WindowState {
  try {
    const raw = JSON.parse(readFileSync(join(userData, 'window.json'), 'utf8')) as Partial<WindowState>;
    if (typeof raw.width === 'number' && typeof raw.height === 'number') return { ...DEFAULT, ...raw };
  } catch {
    /* first run or unreadable: defaults */
  }
  return DEFAULT;
}

/** Saves bounds on resize/move/close (debounced) so the next launch opens where the user left it. */
export function trackWindowState(win: BrowserWindow, userData: string) {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    const maximized = win.isMaximized();
    const b = maximized ? win.getNormalBounds() : win.getBounds();
    const state: WindowState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized };
    try {
      writeFileSync(join(userData, 'window.json'), JSON.stringify(state));
    } catch {
      /* not fatal */
    }
  };
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 300);
  };
  win.on('resize', debounced);
  win.on('move', debounced);
  win.on('maximize', debounced);
  win.on('unmaximize', debounced);
  win.on('close', save);
}
```

- [ ] **Step 4: `desktop/src/main.ts`**

```ts
import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, type RunningServer } from './server.js';
import { loadWindowState, trackWindowState } from './window-state.js';

const REPO = 'https://github.com/c4rtical/neftlix';
const DEBUG = process.env.NEFTLIX_DEBUG === '1';

let server: RunningServer | null = null;
let win: BrowserWindow | null = null;

function log(line: string) {
  const msg = `${new Date().toISOString()} ${line}`;
  console.log(msg);
  try {
    appendFileSync(join(app.getPath('userData'), 'neftlix.log'), `${msg}\n`);
  } catch {
    /* ignore */
  }
}

function buildMenu(dataDir: string) {
  const isMac = process.platform === 'darwin';
  const help: MenuItemConstructorOptions = {
    role: 'help',
    label: 'Aiuto',
    submenu: [
      { label: 'Neftlix su GitHub', click: () => void shell.openExternal(REPO) },
      { label: 'Segnala un problema', click: () => void shell.openExternal(`${REPO}/issues/new/choose`) },
      { label: 'Apri la cartella dei dati', click: () => void shell.openPath(dataDir) },
      { type: 'separator' },
      { label: `Versione ${app.getVersion()}`, enabled: false },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const, label: 'Neftlix' }] : []),
    { role: 'editMenu', label: 'Modifica' },
    {
      label: 'Visualizza',
      submenu: [
        { role: 'reload', label: 'Ricarica' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom normale' },
        { role: 'zoomIn', label: 'Ingrandisci' },
        { role: 'zoomOut', label: 'Riduci' },
        ...(DEBUG ? [{ type: 'separator' as const }, { role: 'toggleDevTools' as const }] : []),
      ],
    },
    { role: 'windowMenu', label: 'Finestra' },
    help,
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(url: string) {
  const userData = app.getPath('userData');
  const state = loadWindowState(userData);
  win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 960,
    minHeight: 600,
    title: 'Neftlix',
    backgroundColor: '#0b0b0f',
    autoHideMenuBar: process.platform !== 'darwin',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (state.maximized) win.maximize();
  trackWindowState(win, userData);

  // Everything outside the local server opens in the system browser.
  const origin = new URL(url).origin;
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(origin)) {
      event.preventDefault();
      void shell.openExternal(target);
    }
  });

  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => {
    win = null;
  });
  void win.loadURL(url);
}

async function boot() {
  const userData = app.getPath('userData');
  const dataDir = join(userData, 'data');
  mkdirSync(dataDir, { recursive: true });
  const webDist = join(import.meta.dirname, 'web');
  log(`Neftlix ${app.getVersion()} starting; data: ${dataDir}`);
  try {
    server = await startServer(dataDir, webDist, DEBUG);
    log(`server on ${server.url}`);
  } catch (e) {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    log(`server failed: ${msg}`);
    dialog.showErrorBox('Neftlix non riesce ad avviarsi', `${msg}\n\nLog: ${join(userData, 'neftlix.log')}`);
    app.quit();
    return;
  }
  buildMenu(dataDir);
  createWindow(server.url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(boot);

  app.on('activate', () => {
    // macOS: clicking the Dock icon with no window open re-creates it.
    if (BrowserWindow.getAllWindows().length === 0 && server) createWindow(server.url);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (server) {
      const s = server;
      server = null;
      void s.close().catch(() => {});
    }
  });
}
```

- [ ] **Step 5: `desktop/scripts/prepare.mjs`**

```js
// Assembles desktop/dist for electron-builder: compiled server + web build + version stamp.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const dist = resolve(here, '../dist');
const serverDist = join(root, 'server/dist');
const webDist = join(root, 'web/dist');

for (const [name, dir] of [['server', serverDist], ['web', webDist]]) {
  if (!existsSync(join(dir, name === 'server' ? 'app.js' : 'index.html'))) {
    console.error(`missing ${dir}: run the ${name} build first`);
    process.exit(1);
  }
}

rmSync(join(dist, 'server'), { recursive: true, force: true });
rmSync(join(dist, 'web'), { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(serverDist, join(dist, 'server'), { recursive: true });
cpSync(webDist, join(dist, 'web'), { recursive: true });

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const desktopPkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8'));
if (desktopPkg.version !== version) {
  console.error(`version mismatch: root ${version}, desktop ${desktopPkg.version}. Run: npm version ${version} --workspaces --include-workspace-root --no-git-tag-version`);
  process.exit(1);
}
writeFileSync(join(dist, 'version.json'), JSON.stringify({ version }));
console.log(`desktop/dist ready (v${version})`);
```

- [ ] **Step 6: `desktop/electron-builder.yml` e icona**

```yaml
appId: it.neftlix.app
productName: Neftlix
copyright: MIT — c4rtical
directories:
  output: release
  buildResources: build
files:
  - dist/**/*
  - package.json
asar: true
asarUnpack:
  - dist/web/**
npmRebuild: false
mac:
  category: public.app-category.entertainment
  target:
    - target: dmg
      arch: [universal]
  identity: null
  hardenedRuntime: false
  gatekeeperAssess: false
win:
  target:
    - target: nsis
      arch: [x64]
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  perMachine: false
publish:
  provider: github
  owner: c4rtical
  repo: neftlix
  releaseType: draft
```

Icona: `mkdir -p desktop/build && sips -z 1024 1024 web/public/icon-512.png --out desktop/build/icon.png` (electron-builder genera `.icns` e `.ico` da questo PNG).

- [ ] **Step 7: Radice e gitignore**

`package.json` (radice): `"workspaces": ["server", "web", "desktop"]`; script `"desktop": "npm run dev --workspace=desktop"` e `"desktop:dist": "npm run dist --workspace=desktop"`; in `check` aggiungi `&& npm run check --workspace=desktop`.

`.gitignore`: aggiungi `desktop/dist/` e `desktop/release/`.

Poi `npm install` (scarica Electron, ~100 MB).

- [ ] **Step 8: Verifica build e avvio**

Run: `npm run check && npm run build --workspace=desktop && ls desktop/dist/main.js desktop/dist/server/app.js desktop/dist/web/index.html desktop/dist/version.json`
Expected: typecheck pulito, tutti i file presenti.

Run: `cd desktop && NEFTLIX_DEBUG=1 npx electron . & sleep 8; ls ~/Library/Application\ Support/Neftlix/ 2>/dev/null || ls ~/Library/Application\ Support/@neftlix/desktop/ 2>/dev/null; grep -n "server on" ~/Library/Application\ Support/*/neftlix.log 2>/dev/null | tail -1; kill %1`
Expected: il log riporta `server on http://127.0.0.1:<porta>`; la finestra si è aperta sul Setup o sul picker profili (verifica visiva: l'app appare nel Dock). Nota: `app.getPath('userData')` usa `productName` dal `package.json`, quindi imposta `"productName": "Neftlix"` nel `desktop/package.json` se la cartella risultasse `@neftlix/desktop`.

Verifica funzionale manuale con l'app aperta: inserisci le credenziali del provider (o seleziona un profilo se i dati esistono), apri un film e controlla che il player parta; chiudi e riapri: la finestra torna dove era.

- [ ] **Step 9: Commit**

```bash
git add desktop package.json .gitignore package-lock.json
git commit -m "feat(desktop): Electron app that runs the bundled server on a local port"
```

---

### Task 3: Packaging locale, CI e release

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Pacchetto locale**

Run: `npm run desktop:dist` (2–5 minuti la prima volta)
Expected: `desktop/release/Neftlix-0.1.0-universal.dmg` (o nome simile) presente. Apri il dmg, trascina l'app in una cartella temporanea, esegui `xattr -cr "<cartella>/Neftlix.app"` e avviala: deve aprirsi la stessa finestra di Step 8 del Task 2. Se l'app non trova `fastify` (errore "Cannot find package 'fastify'" nel log), aggiungi in `electron-builder.yml` la voce `includeSubNodeModules: true` e riprova; se ancora fallisce, riporta BLOCKED con il log.

- [ ] **Step 2: Workflow di release**

Crea `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  desktop:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run release --workspace=desktop
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
```

- [ ] **Step 3: CI esistente**

In `.github/workflows/ci.yml`, job `check`: porta `node-version` a `24`, aggiungi `env: { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' }` a livello di job (evita 100 MB di download inutili), e dopo `- run: npm run build` aggiungi `- run: npm run build --workspace=desktop`.

- [ ] **Step 4: Verifica e commit**

Run: `npm run check && npm test`
Expected: puliti.

```bash
git add .github/workflows/release.yml .github/workflows/ci.yml desktop/electron-builder.yml
git commit -m "ci: build the desktop app in CI and release dmg/exe on v* tags"
```

---

### Task 4: Documentazione e procedura di rilascio

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`

- [ ] **Step 1: README — sezione Download**

Subito dopo il blocco degli screenshot e prima di `## Why`, aggiungi:

```md
## Download

Grab the latest build from [Releases](https://github.com/c4rtical/neftlix/releases/latest):

| | File | First launch |
|---|---|---|
| **Windows** | `Neftlix-Setup-x.y.z.exe` | SmartScreen shows "unknown publisher": click *More info* → *Run anyway*. |
| **macOS** | `Neftlix-x.y.z-universal.dmg` | Drag Neftlix to Applications. Since the app isn't signed yet, macOS says it is "damaged" or from an "unidentified developer": run `xattr -cr /Applications/Neftlix.app` once in Terminal, or right-click → *Open*. |

The app runs the same server described below on your machine (127.0.0.1 only) and keeps its data in your user folder. Your credentials and your video never leave your computer.

Prefer a browser on your TV or phone? Run the server on a PC or NAS instead (next section) and open it from any device on your network.
```

Nella sezione **Features** aggiungi come ultimo punto: `- **Desktop app** for Windows and macOS: double-click, connect your provider, watch. No Node, no terminal.`

Nel **Roadmap** aggiungi: `- [ ] Signed and notarized desktop builds with auto-update` e `- [ ] Linux AppImage`.

- [ ] **Step 2: CHANGELOG**

Sotto `## [Unreleased]` → `### Added`, prima riga:

```md
- Desktop app (Electron) for Windows and macOS: runs the bundled server on 127.0.0.1 and opens it in a window; builds published on GitHub Releases from `v*` tags.
```

- [ ] **Step 3: CONTRIBUTING — rilascio**

In fondo a `CONTRIBUTING.md` aggiungi:

```md
## Releasing

1. Move the `Unreleased` notes in `CHANGELOG.md` under a new version heading.
2. `npm version X.Y.Z --workspaces --include-workspace-root --no-git-tag-version` keeps every package in sync (the desktop build refuses to package on a mismatch).
3. Commit, then `git tag vX.Y.Z && git push origin main vX.Y.Z`.
4. The *Release* workflow builds the macOS dmg and Windows installer and attaches them to a **draft** release: review it on GitHub, paste the changelog, publish.
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md CONTRIBUTING.md
git commit -m "docs: desktop download section, changelog and release procedure"
```

---

## Self-review

- **Copertura spec**: `createApp`/`listen`/`close` e wrapper CLI (T1); workspace desktop, main/server/window-state, prepare, builder config, icona, script radice (T2); packaging locale, release e CI (T3); README Download con avvisi non firmati, changelog, procedura di release con allineamento versioni (T4). Gestione errori: server non avviabile → dialog + quit (T2 main); single instance (T2); web mancante → prepare.mjs fallisce prima del packaging (T2).
- **Placeholder**: nessuno. Lo script `dev` in T2 Step 1 ha una nota correttiva esplicita (niente `cross-env`).
- **Coerenza nomi**: `createApp`, `AppOptions`, `AppHandle`, `startServer`, `RunningServer`, `loadWindowState`, `trackWindowState` usati con gli stessi nomi in T1 e T2; `desktop/dist/server/app.js` e `desktop/dist/web` coerenti tra `prepare.mjs`, `server.ts` (`./server/app.js`) e `main.ts` (`join(import.meta.dirname, 'web')`).
