# App desktop (Electron) — design

Data: 2026-09-09. Stato: approvato in chat.

## Obiettivo

Chi non è "smanettone" deve poter usare Neftlix con un download e un doppio clic, su Windows e macOS, senza Node, terminale o Docker. Nessun server pubblico: come oggi, ogni byte di video va dal PC dell'utente al suo provider. Il dominio, quando ci sarà, ospiterà solo una pagina di download.

Fuori scope per il primo rilascio: firma del codice e notarizzazione (gli utenti vedranno gli avvisi "sviluppatore non identificato" / SmartScreen, documentati nel README), aggiornamento automatico, Linux (l'AppImage si aggiunge alla matrice CI quando serve), condivisione in LAN dall'app (aprire Neftlix dalla TV: possibile in seguito con un interruttore in Impostazioni), icona nella barra di sistema.

## Decisioni

- **Electron** (44.x, Node 24, Chromium 152): riusa il server Node e il web così come sono. Verificato: `node:sqlite` funziona nel Node di Electron. Tauri scartato: avrebbe richiesto Node come binario sidecar per piattaforma.
- **Server in-process**: il main process di Electron avvia Fastify direttamente (stessa memoria, un solo processo, nessun IPC). Alternativa scartata: processo figlio con `ELECTRON_RUN_AS_NODE` (più isolamento, ma porta, log e riavvii da gestire a mano senza un beneficio reale oggi).
- **Server compilato in JavaScript** per il pacchetto: `tsc` con `rewriteRelativeImportExtensions` riscrive gli import `.ts` in `.js`. In sviluppo il server continua a girare come TypeScript nativo. Motivo: non dipendere dal type stripping dentro un asar.
- **La finestra carica `http://127.0.0.1:<porta casuale>/`**, servito da Fastify (API, stream proxy e `web/dist` statico). Nessun `file://`, nessuna modifica al web: i path `/api` e `/stream` restano assoluti.
- **Dati in `app.getPath('userData')/data`** (`~/Library/Application Support/Neftlix/data` su macOS, `%APPDATA%\Neftlix\data` su Windows). Stesso SQLite e stesse migrazioni della versione server.
- **Solo loopback**: il server ascolta su `127.0.0.1`, porta scelta dal sistema. Nessuna password: il server non è raggiungibile da fuori.
- **Versione unica**: `desktop/package.json` prende la versione dal `package.json` di radice al build; il tag git `vX.Y.Z` crea la release.

## Struttura

```
desktop/
  package.json            workspace @neftlix/desktop: electron, electron-builder (dev); fastify, @fastify/static (runtime)
  tsconfig.json           compila src/ → dist/ (ESM, NodeNext)
  electron-builder.yml    appId it.neftlix.app, productName Neftlix, files dist/**, mac dmg universal, win nsis x64
  src/main.ts             ciclo di vita dell'app, finestra, menu
  src/server.ts           avvia createApp dal server compilato, sceglie porta, espone url
  src/window-state.ts     ricorda posizione/dimensione finestra in userData/window.json
  scripts/prepare.mjs     copia server/dist → desktop/dist/server e web/dist → desktop/dist/web, scrive desktop/dist/version.json
  build/icon.png          icona 1024×1024 (da web/public/icon-512.png se non ne esiste una migliore)
server/
  src/app.ts              NUOVO: createApp({ dataDir, webDist, logger }) → { app, listen(host, port) → url, close() }
  src/index.ts            diventa il wrapper CLI: legge le env e chiama createApp (comportamento invariato)
  tsconfig.build.json     emit JS in server/dist con rewriteRelativeImportExtensions
```

### `server/src/app.ts`

Estrae da `index.ts` tutto ciò che non è lettura di env: apertura DB, client Xtream, hook password (opzionale, passato come `password?: string`), rotte, static, EPG tick, hook di chiusura. Firma:

```ts
export type AppOptions = { dataDir: string; webDist?: string; password?: string; logLevel?: string };
export async function createApp(opts: AppOptions): Promise<{ app: FastifyInstance; listen: (host: string, port: number) => Promise<string>; close: () => Promise<void> }>;
```

`listen` restituisce l'URL effettivo (`http://127.0.0.1:53412`), utile con porta 0. `close` ferma i timer dell'EPG e chiude Fastify e il DB. `index.ts` resta l'entrypoint per `npm start`, Docker e CI: `createApp` + `listen(HOST, PORT)`.

### `desktop/src/main.ts`

- `app.requestSingleInstanceLock()`: una seconda istanza porta in primo piano la finestra esistente.
- `whenReady` → `startServer()` → `createWindow(url)`.
- Finestra: 1280×800 iniziale, minimo 960×600, `backgroundColor #0b0b0f`, titolo "Neftlix", `autoHideMenuBar` su Windows, `contextIsolation: true`, `nodeIntegration: false` (la pagina è web normale, non serve preload).
- Link esterni (`target=_blank` o navigazione fuori dall'origine locale) → `shell.openExternal`; la finestra non può navigare fuori dal server locale.
- Menu: su macOS il menu standard (Neftlix / Modifica / Visualizza / Finestra / Aiuto); su Windows lo stesso menu nascosto (Alt lo mostra). "Aiuto" → "Sito GitHub", "Segnala un problema", "Cartella dei dati", "Versione X.Y.Z".
- `F11` / `Ctrl+Cmd+F` schermo intero (oltre al tasto F del player, che chiede il fullscreen dell'elemento video).
- Su macOS chiudere la finestra non chiude l'app (clic sul Dock la riapre); su Windows sì. `before-quit` → `server.close()`.
- Errore di avvio del server → `dialog.showErrorBox` con il messaggio e il percorso del log, poi `app.quit()`.
- Log: `console` del main process più `userData/neftlix.log` (append, semplice) per i bug report.

### `desktop/src/server.ts`

```ts
import { createApp } from './server/app.js';   // server compilato copiato da prepare.mjs
export async function startServer(dataDir: string, webDist: string): Promise<{ url: string; close: () => Promise<void> }>
```
Porta 0 su `127.0.0.1`; logger Fastify a livello `warn` in produzione, `info` con `NEFTLIX_DEBUG=1`.

### Build e rilascio

Script in `desktop/package.json`:

- `build:server` → `tsc -p ../server/tsconfig.build.json`
- `build:web` → `npm run build --workspace=web` (dalla radice)
- `prepare:dist` → `node scripts/prepare.mjs` (copia + version.json)
- `build` → `tsc -p .` + i tre sopra, in ordine
- `dev` → `build` + `electron .` (con `NEFTLIX_DEBUG=1`)
- `dist` → `build` + `electron-builder --publish never`
- `release` → `build` + `electron-builder --publish always` (usato in CI)

Radice: `npm run desktop` → `npm run dev --workspace=desktop`; `npm run desktop:dist`.

`electron-builder.yml`: `files: ["dist/**/*", "package.json"]`, `asar: true`, `npmRebuild: false`, `mac: { target: [{ target: dmg, arch: [universal] }], category: public.app-category.entertainment, hardenedRuntime: false, identity: null }`, `win: { target: [{ target: nsis, arch: [x64] }] }`, `nsis: { oneClick: false, allowToChangeInstallationDirectory: true }`, `publish: { provider: github, owner: c4rtical, repo: neftlix }`. `CSC_IDENTITY_AUTO_DISCOVERY=false` in CI finché non c'è la firma.

`.github/workflows/release.yml`: trigger `push: tags: ['v*']`; matrix `macos-latest` e `windows-latest`; Node 24; `npm ci`; `npm run release --workspace=desktop` con `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`; permessi `contents: write`. electron-builder crea la GitHub Release in bozza al primo artefatto e la completa con gli altri; la release va pubblicata a mano da GitHub (così si può scrivere il changelog). Il job `check` esistente resta.

Il workflow CI esistente aggiunge `npm run build --workspace=desktop` (senza packaging) per accorgersi di rotture.

### README

Sezione **Download** subito dopo gli screenshot: link alla pagina Releases, cosa scaricare per Windows e macOS, e i due avvisi degli installer non firmati:

- macOS: "Neftlix è danneggiato / sviluppatore non identificato" → `xattr -cr /Applications/Neftlix.app` oppure clic destro → Apri.
- Windows: SmartScreen "editore sconosciuto" → "Ulteriori informazioni" → "Esegui comunque".

La sezione "Quick start" con `npm start` e Docker resta per chi si ospita il server (TV e altri dispositivi in LAN).

## Gestione errori

- Porta non disponibile: impossibile con porta 0.
- DB bloccato da un'altra istanza: prevenuto dal single instance lock.
- `web/dist` mancante nel pacchetto: `createApp` lo segnala e il main mostra l'errore (bug di build, non caso utente).
- Provider http su una pagina http: nessun mixed content, la finestra è `http://127.0.0.1`.

## Test

- `server/test/app.test.ts`: `createApp` con `dataDir` temporaneo e `webDist` fittizio, `listen('127.0.0.1', 0)` restituisce un URL con porta > 0, `GET /api/status` risponde 200, `close()` chiude senza errori; con `password` impostata `GET /api/status` senza header risponde 401.
- `npm run check` estende il typecheck a `desktop/`.
- CI: `npm run build --workspace=desktop` compila main, server e web e prepara `dist/`.
- Manuale (prima del commit finale): `npm run desktop` apre la finestra sul picker/setup; il player riproduce un film; chiudere e riaprire ricorda dimensione finestra e profilo; `npm run desktop:dist` produce un `.dmg` su questo Mac che si apre con `xattr -cr`.

## Fuori dal primo rilascio, in ordine di valore

1. Aggiornamento automatico (electron-updater; su macOS richiede la firma).
2. Firma e notarizzazione (Apple Developer 99 $/anno; certificato Windows).
3. Interruttore "Rendi disponibile in LAN" per aprire l'app dalla TV.
4. Linux AppImage nella matrice.
