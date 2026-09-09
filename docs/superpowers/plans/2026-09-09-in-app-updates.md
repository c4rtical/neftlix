# Aggiornamenti in-app — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'app desktop avvisa quando su GitHub esiste una versione nuova e la installa (Windows) o scarica e apre il dmg (macOS non firmato), da un pannello in Impostazioni e da un banner.

**Architecture:** Un modulo `updater.ts` nel main process tiene uno `UpdateState` e lo pubblica via IPC; un preload CommonJS espone `window.neftlixDesktop` con `contextBridge`; il web, se il bridge esiste, mostra pannello e banner. Windows usa `electron-updater` (legge `latest.yml` della release), macOS usa l'API GitHub e scarica il `.dmg`.

**Tech Stack:** Electron 44, electron-updater 6.8, TypeScript 5.9, React 18, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-09-in-app-updates-design.md` — leggerla per intero: definisce `UpdateState`, il contratto del bridge, i testi UI e i casi limite.

## Global Constraints

- Il web non importa nulla di Electron e non cambia comportamento nel browser normale (`getDesktop()` → `null`: nessun pannello, nessun banner, nessun pallino).
- `sandbox: true` e `contextIsolation: true` restano: il preload è CommonJS (`preload.cts` → `dist/preload.cjs`) e usa solo `contextBridge`/`ipcRenderer`.
- Nessun download automatico. Controllo programmato solo con `app.isPackaged`.
- Windows: `electron-updater` con `autoDownload: false`, `autoInstallOnAppQuit: false`. macOS: API GitHub + download del dmg in `app.getPath('downloads')` + `shell.openPath`.
- Contratto del bridge (esatto): `window.neftlixDesktop = { version: string; platform: string; getState(): Promise<UpdateState>; check(): Promise<UpdateState>; download(): Promise<UpdateState>; install(): Promise<void>; quit(): void; onState(cb: (s: UpdateState) => void): () => void }`.
- `UpdateState = { status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error'; current: string; latest?: string; progress?: number; filePath?: string; releaseUrl?: string; assetName?: string; error?: string; checkedAt?: number; manual: boolean }`.
- Testi UI in italiano. Dipendenza nuova ammessa: `electron-updater` (runtime, in `desktop/package.json`). Commit con le due righe di attribuzione della sessione.
- Verifica: `npm run check`, `npm test`, `npm run build --workspace=desktop`.

---

### Task 1: Lato desktop (updater, preload, IPC, test)

**Files:**
- Create: `desktop/src/versions.ts`, `desktop/src/updater.ts`, `desktop/src/preload.cts`, `desktop/tsconfig.preload.json`, `desktop/test/versions.test.ts`
- Modify: `desktop/src/main.ts`, `desktop/package.json`, `package.json` (radice, script `test`)

**Interfaces:**
- Produces: `window.neftlixDesktop` come da Global Constraints; canali IPC `update:get-state`, `update:check`, `update:download`, `update:install`, `app:quit`; evento `update:state` main → renderer.

- [ ] **Step 1: Test del modulo puro**

`desktop/test/versions.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSemver, parseTag, pickAsset } from '../src/versions.ts';

test('parseTag accepts v-prefixed and bare semver, rejects the rest', () => {
  assert.equal(parseTag('v0.2.0'), '0.2.0');
  assert.equal(parseTag('0.2.0'), '0.2.0');
  assert.equal(parseTag('release-1'), null);
  assert.equal(parseTag('v1.2'), null);
});

test('compareSemver orders numerically', () => {
  assert.ok(compareSemver('0.2.0', '0.1.0') > 0);
  assert.ok(compareSemver('0.10.0', '0.9.9') > 0);
  assert.ok(compareSemver('1.0.0', '0.99.99') > 0);
  assert.equal(compareSemver('0.2.0', '0.2.0'), 0);
  assert.ok(compareSemver('0.1.0', '0.2.0') < 0);
});

const assets = [
  { name: 'Neftlix-0.2.0-universal.dmg', browser_download_url: 'https://x/mac.dmg', size: 10 },
  { name: 'Neftlix-0.2.0-universal.dmg.blockmap', browser_download_url: 'https://x/mac.blockmap', size: 1 },
  { name: 'Neftlix-Setup-0.2.0.exe', browser_download_url: 'https://x/win.exe', size: 20 },
  { name: 'latest.yml', browser_download_url: 'https://x/latest.yml', size: 1 },
];

test('pickAsset chooses the installer for the platform', () => {
  assert.deepEqual(pickAsset(assets, 'darwin'), { name: 'Neftlix-0.2.0-universal.dmg', url: 'https://x/mac.dmg', size: 10 });
  assert.deepEqual(pickAsset(assets, 'win32'), { name: 'Neftlix-Setup-0.2.0.exe', url: 'https://x/win.exe', size: 20 });
  assert.equal(pickAsset(assets, 'linux'), null);
  assert.equal(pickAsset([], 'darwin'), null);
});
```

Script in `desktop/package.json`: `"test": "node --test --no-warnings=ExperimentalWarning 'test/**/*.test.ts'"`. Radice: `"test": "npm run test --workspace=server && npm run test --workspace=desktop"`. Aggiungi `"test"` a `include` di `desktop/tsconfig.json` solo se il typecheck non si rompe per `rootDir` (altrimenti lascia `src` e non includere i test nel typecheck; il test gira comunque con Node).

Run: `npm test --workspace=desktop` → FAIL (modulo mancante).

- [ ] **Step 2: `desktop/src/versions.ts`**

```ts
export type ReleaseAsset = { name: string; browser_download_url: string; size: number };
export type PickedAsset = { name: string; url: string; size: number };

export function parseTag(tag: string): string | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  return m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : null;
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function pickAsset(assets: ReleaseAsset[], platform: NodeJS.Platform): PickedAsset | null {
  const match = (re: RegExp) => assets.find((a) => re.test(a.name));
  const found = platform === 'darwin' ? (match(/-universal\.dmg$/) ?? match(/\.dmg$/)) : platform === 'win32' ? match(/^Neftlix-Setup-.*\.exe$/) : undefined;
  return found ? { name: found.name, url: found.browser_download_url, size: found.size } : null;
}
```

Run: `npm test --workspace=desktop` → PASS.

- [ ] **Step 3: `desktop/src/updater.ts`**

Implementa `createUpdater(opts)` come da spec. Struttura:

```ts
import { createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { compareSemver, parseTag, pickAsset, type PickedAsset } from './versions.js';

export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error';
export type UpdateState = { status: UpdateStatus; current: string; latest?: string; progress?: number; filePath?: string; releaseUrl?: string; assetName?: string; error?: string; checkedAt?: number; manual: boolean };

export type UpdaterDeps = {
  currentVersion: string;
  platform: NodeJS.Platform;
  packaged: boolean;
  downloadsDir: string;
  log: (line: string) => void;
  openPath: (p: string) => Promise<string>;            // shell.openPath
  /** Windows only: electron-updater's autoUpdater, injected so tests/dev never load it. */
  autoUpdater?: { checkForUpdates(): Promise<unknown>; downloadUpdate(): Promise<unknown>; quitAndInstall(): void; on(ev: string, cb: (...a: never[]) => void): unknown; autoDownload: boolean; autoInstallOnAppQuit: boolean };
};

const RELEASES_API = 'https://api.github.com/repos/c4rtical/neftlix/releases/latest';
const CHECK_EVERY_MS = 6 * 3600 * 1000;
const FIRST_CHECK_MS = 10_000;
```

- `manual = platform !== 'win32' || !packaged || !deps.autoUpdater`.
- `check()`: stato `checking`; `fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'neftlix-desktop' }, signal: AbortSignal.timeout(15_000) })`; 404 → `up-to-date` (nessuna release pubblicata); `tag_name` → `parseTag`; se `null` → `up-to-date` + log; confronto con `current`; `available` con `latest`, `releaseUrl: html_url`, `assetName`/asset privato; `checkedAt: Date.now()`. Su Windows con `autoUpdater`: prima `autoUpdater.checkForUpdates()` (eventi `update-available` / `update-not-available` / `error` → stato); se lancia, ricadi sull'API in modalità manuale (`manual = true` per questa sessione).
- `download()`: se non `available` → ritorna stato; Windows automatico → `autoUpdater.downloadUpdate()` con `download-progress` (`percent`) → `downloaded`; altrimenti se `!packaged` → `error: 'Download disponibile solo nell\'app installata'` mantenendo `releaseUrl`; altrimenti stream dell'asset con `fetch` → `Readable.fromWeb(res.body)` → `createWriteStream(tmp)` misurando i byte per il `progress` (throttle degli eventi a ~4/s), `rename(tmp, final)` → `downloaded` con `filePath`; su errore `unlink(tmp)` e `error: 'Download interrotto'`.
- `install()`: Windows automatico → `autoUpdater.quitAndInstall()`; altrimenti `await openPath(filePath)`.
- `startSchedule()`: solo se `packaged`; `setTimeout(check, FIRST_CHECK_MS)` + `setInterval(check, CHECK_EVERY_MS)`, entrambi `unref()`.
- `onState(cb)` con set di listener; ogni transizione chiama `emit()`.

- [ ] **Step 4: Preload e tsconfig**

`desktop/src/preload.cts`:

```ts
import { contextBridge, ipcRenderer } from 'electron';

const versionArg = process.argv.find((a) => a.startsWith('--neftlix-version='));
const version = versionArg ? versionArg.slice('--neftlix-version='.length) : '';

contextBridge.exposeInMainWorld('neftlixDesktop', {
  version,
  platform: process.platform,
  getState: () => ipcRenderer.invoke('update:get-state'),
  check: () => ipcRenderer.invoke('update:check'),
  download: () => ipcRenderer.invoke('update:download'),
  install: () => ipcRenderer.invoke('update:install'),
  quit: () => ipcRenderer.send('app:quit'),
  onState: (cb: (s: unknown) => void) => {
    const handler = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('update:state', handler);
    return () => ipcRenderer.off('update:state', handler);
  },
});
```

`desktop/tsconfig.preload.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node10",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "files": ["src/preload.cts"]
}
```

`desktop/package.json`: `"build:main": "tsc -p . && tsc -p tsconfig.preload.json"`, `"check": "tsc --noEmit -p . && tsc --noEmit -p tsconfig.preload.json"`; dipendenza `"electron-updater": "^6.8.0"`. Verifica che `tsc -p .` non includa `preload.cts` (l'`include: ["src"]` con estensione `.cts` lo includerebbe: aggiungi `"exclude": ["src/preload.cts"]` a `desktop/tsconfig.json`). Output atteso: `dist/preload.cjs`.

- [ ] **Step 5: `desktop/src/main.ts`**

- `import { ipcMain } from 'electron'` (aggiungi a import esistente) e `import { createUpdater } from './updater.js'`.
- In `boot()`, dopo l'avvio del server: costruisci `updater = createUpdater({ currentVersion: process.env.NEFTLIX_FAKE_VERSION ?? app.getVersion(), platform: process.platform, packaged: app.isPackaged, downloadsDir: app.getPath('downloads'), log, openPath: (p) => shell.openPath(p), autoUpdater: process.platform === 'win32' && app.isPackaged ? (await import('electron-updater')).autoUpdater : undefined })`. Con `autoUpdater` presente: `autoDownload = false`, `autoInstallOnAppQuit = false`.
- `ipcMain.handle('update:get-state', () => updater.getState())`, `'update:check'` → `updater.check()`, `'update:download'` → `updater.download()`, `'update:install'` → `updater.install()`; `ipcMain.on('app:quit', () => app.quit())`.
- `updater.onState((s) => win?.webContents.send('update:state', s))`.
- `createWindow`: `webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: join(import.meta.dirname, 'preload.cjs'), additionalArguments: [`--neftlix-version=${app.getVersion()}`] }`.
- Menu Aiuto: prima voce `{ label: 'Controlla aggiornamenti…', click: async () => { const s = await updater.check(); if (s.status === 'available' || s.status === 'downloaded') win?.webContents.send('navigate', '/settings'); } }` — e nel preload esponi anche `onNavigate(cb)` su canale `navigate` (aggiungilo al bridge: `onNavigate(cb: (path: string) => void): () => void`).
- `updater.startSchedule()` dopo `createWindow`.
- `NEFTLIX_FAKE_VERSION` è solo per provare la UI: documentalo con un commento.

- [ ] **Step 6: Verifica**

`npm run check && npm test && npm run build --workspace=desktop`; poi `ls desktop/dist/preload.cjs desktop/dist/updater.js`. Avvio di prova: da `desktop/`, `NEFTLIX_DEBUG=1 NEFTLIX_FAKE_VERSION=0.0.1 npx electron . --user-data-dir=/tmp/neftlix-upd &`; dopo 8 s, nel log deve comparire l'avvio del server; poi apri la finestra DevTools non serve: usa `curl` su nulla — la verifica del bridge la fa il Task 2 nel web. Chiudi l'app (solo il processo `electron` avviato da te; l'utente ha `Neftlix.app` aperta).

- [ ] **Step 7: Commit**

`git add desktop/src desktop/test desktop/tsconfig.json desktop/tsconfig.preload.json desktop/package.json package.json package-lock.json` → `feat(desktop): in-app update checks with electron-updater (Windows) and guided dmg download (macOS)`.

---

### Task 2: Lato web (bridge, banner, pannello Impostazioni, pallino) + documentazione

**Files:**
- Create: `web/src/desktop.ts`, `web/src/components/UpdateBanner.tsx`
- Modify: `web/src/App.tsx`, `web/src/components/Nav.tsx`, `web/src/pages/Settings.tsx`, `web/src/styles.css`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`

**Interfaces:**
- Consumes: `window.neftlixDesktop` (contratto in Global Constraints, più `onNavigate(cb)`), `UpdateState`.
- Non committare: lascia le modifiche nel working tree (il coordinatore committa insieme al Task 1).

- [ ] **Step 1: `web/src/desktop.ts`**

Tipi `UpdateState`, `NeftlixDesktop` (con `quit()` e `onNavigate`), `getDesktop()`, e hook:

```ts
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const d = getDesktop();
    if (!d) return;
    let alive = true;
    d.getState().then((s) => alive && setState(s)).catch(() => {});
    const off = d.onState((s) => alive && setState(s));
    return () => { alive = false; off(); };
  }, []);
  return state;
}
```

- [ ] **Step 2: `UpdateBanner`**

Componente montato in `App` sotto `<Nav />`, fuori da `<Routes>`; non renderizza nulla se `getDesktop()` è `null`, se `loc.pathname` inizia con `/play/`, se lo stato non è `available`/`downloaded`, o se `localStorage['update.dismissed'] === state.latest`. Testo: "Neftlix {latest} disponibile" → pulsante "Aggiorna" (`nav('/settings')`); con `downloaded`: "Aggiornamento pronto" → "Installa" (`manual=false`) / "Apri" (`manual=true`) che chiama `install()`. Pulsante "×" che salva il dismiss. CSS `.update-banner` fisso in alto a destra, sopra la Nav (z-index 20), stile coerente con `.banner`.

Ascolta anche `onNavigate` (dal menu Aiuto) in `App`: `nav(path)`.

- [ ] **Step 3: Settings — pannello "App desktop"**

Solo se `getDesktop()`; primo pannello. Righe: "Versione" `{d.version}`; "Stato" secondo `state.status` (idle: "—"; checking: "Controllo in corso…"; up-to-date: "Aggiornata" + "controllata alle HH:MM"; available: "Nuova versione {latest} disponibile"; downloading: "Download {progress}%"; downloaded: "Pronto da installare"; error: `Errore: {error}`). Pulsanti: `check()` ("Controlla aggiornamenti") sempre, disabilitato in checking/downloading; `download()` ("Scarica {latest}") se available e `assetName` presente, altrimenti link "Apri la pagina della release" (`releaseUrl`, `target=_blank`); barra `<progress>` in downloading; `install()` ("Installa e riavvia" se `!manual`, "Apri il file scaricato" se `manual`) in downloaded, più, se `manual`, testo "Trascina Neftlix nella cartella Applicazioni sostituendo la versione attuale, poi riapri l'app." e pulsante "Esci da Neftlix" → `quit()`. Link "Note di rilascio" → `releaseUrl` quando presente.

- [ ] **Step 4: Nav — pallino**

`Nav` riceve `updateAvailable: boolean` da `App` (`state?.status === 'available' || state?.status === 'downloaded'`); sull'item Impostazioni aggiunge `<span className="nav-badge" />` (pallino rosso 8 px in alto a destra dell'icona, CSS `.nav-badge`).

- [ ] **Step 5: Documentazione**

README, sezione Download: aggiungi "The app checks GitHub Releases for updates: on Windows it installs them in one click, on macOS it downloads the new dmg and opens it (until the app is signed)." CHANGELOG, Added: "In-app updates for the desktop app (Windows one-click, macOS guided download)." CONTRIBUTING, Releasing: dopo il passo della bozza: "Publishing the draft is what makes installed apps see the update."

- [ ] **Step 6: Verifica**

`npm run check` (web). Nel browser normale (http://localhost:5173) Impostazioni non mostra il pannello e non c'è banner. Poi, se il Task 1 è già committato, `cd desktop && npm run build && NEFTLIX_DEBUG=1 NEFTLIX_FAKE_VERSION=0.0.1 npx electron . --user-data-dir=/tmp/neftlix-upd` (finestra dev dell'app): in Impostazioni compare "App desktop", "Controlla aggiornamenti" porta a `available` se su GitHub esiste una release pubblicata, oppure a "Aggiornata"/errore se non c'è ancora (documenta l'esito). Chiudi solo il processo `electron` che hai avviato.

Non committare: riporta i file modificati.

---

## Self-review

- Spec coperta: versions/updater/preload/IPC/menu/schedule (T1); bridge web, banner, pannello, pallino, docs (T2). Casi limite: 404 senza release, tag non semver, asset mancante → link release, download in dev → errore con link, download interrotto → `.part` rimosso.
- Nomi coerenti: canali IPC `update:get-state|check|download|install`, `app:quit`, `navigate`; `UpdateState` identico in `desktop/src/updater.ts` e `web/src/desktop.ts`; `manual`, `assetName`, `releaseUrl`, `filePath`, `progress`.
