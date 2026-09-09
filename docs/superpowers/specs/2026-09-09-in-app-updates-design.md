# Aggiornamenti in-app (desktop) — design

Data: 2026-09-09. Stato: approvato in chat (Windows automatico, macOS semi-automatico finché l'app non è firmata).

## Obiettivo

Chi ha installato l'app desktop deve sapere quando esce una versione nuova e aggiornarla senza cercare la pagina delle release: notifica dentro l'app, pulsante "Aggiorna". Su Windows l'aggiornamento è completo (scarica, installa, riavvia). Su macOS, finché l'app non è firmata, l'app scarica il `.dmg` e lo apre; l'utente trascina Neftlix in Applicazioni. Quando arriverà la firma, macOS userà lo stesso percorso di Windows senza modifiche al web.

Fuori scope: firma/notarizzazione; aggiornamenti del server self-hosted (Docker/npm) — lì resta `git pull`/`docker pull`.

## Decisioni

- **Fonte unica: GitHub Releases** del repo `c4rtical/neftlix`. `electron-builder` con `publish: github` carica già `latest.yml` (Windows) e `latest-mac.yml` accanto agli installer; l'API pubblica `GET https://api.github.com/repos/c4rtical/neftlix/releases/latest` non richiede chiave (60 richieste/ora per IP, ne servono 4 al giorno). Le release in **bozza non contano**: l'aggiornamento parte quando la release viene pubblicata.
- **Windows: `electron-updater`** (`autoDownload: false`, `autoInstallOnAppQuit: false`): `checkForUpdates` → `downloadUpdate` con progresso → `quitAndInstall`. Funziona con installer NSIS non firmati.
- **macOS non firmato: percorso manuale guidato.** Controllo via API GitHub, confronto semver con `app.getVersion()`, download del `.dmg` in `~/Downloads` con progresso, poi `shell.openPath(dmg)` e istruzioni. Non si usa `electron-updater` su macOS finché `mac.identity` è `null` (Squirrel.Mac rifiuta app non firmate).
- **Un solo stato condiviso** tra main e renderer: `UpdateState = { status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error'; current: string; latest?: string; progress?: number; filePath?: string; releaseUrl?: string; assetName?: string; error?: string; checkedAt?: number; manual: boolean }` (`manual: true` su macOS non firmato = "scarica e apri", `false` = "installa e riavvia").
- **Ponte renderer ↔ main con `contextBridge`** (preload CommonJS perché `sandbox: true`): `window.neftlixDesktop = { version, platform, getState(), check(), download(), install(), onState(cb) → unsubscribe }`. Il web non importa nulla di Electron: usa `window.neftlixDesktop` solo se esiste.
- **Pianificazione**: controllo 10 s dopo l'avvio e poi ogni 6 ore; mai in modalità sviluppo (`!app.isPackaged`) tranne che su richiesta esplicita, dove il download è disabilitato e si offre il link alla release.
- **Nessun download automatico**: l'utente decide con "Scarica".

## Struttura

```
desktop/
  src/updater.ts        stato, controllo (GitHub API / electron-updater), download, install; emette 'state'
  src/versions.ts       puro: parseTag('v0.2.0') → '0.2.0', compareSemver(a, b), pickAsset(assets, platform, arch)
  src/preload.cts       contextBridge + ipcRenderer (compilato a CommonJS in dist/preload.cjs)
  src/main.ts           registra IPC (update:get-state, update:check, update:download, update:install), inoltra 'state' alla finestra, avvia la pianificazione, aggiunge "Controlla aggiornamenti…" al menu Aiuto
  tsconfig.preload.json module commonjs, rootDir src, files ["src/preload.cts"], outDir dist
  test/versions.test.ts node:test sul modulo puro
web/src/
  desktop.ts            tipi NeftlixDesktop/UpdateState + getDesktop(): NeftlixDesktop | null
  components/UpdateBanner.tsx  toast in alto a destra quando status è 'available' o 'downloaded' (chiudibile per versione)
  pages/Settings.tsx    pannello "App desktop" (solo se getDesktop() esiste)
  components/Nav.tsx    pallino sull'icona Impostazioni quando c'è un aggiornamento
```

### `desktop/src/versions.ts`

- `parseTag(tag: string): string | null` — accetta `v0.2.0` e `0.2.0`, rifiuta altro.
- `compareSemver(a: string, b: string): number` — numerico su major.minor.patch, pre-release ignorate (non le usiamo).
- `pickAsset(assets: { name: string; browser_download_url: string; size: number }[], platform: NodeJS.Platform): { name; url; size } | null` — mac: nome che termina con `-universal.dmg` (fallback: qualunque `.dmg`); win: `Neftlix-Setup-*.exe`.

### `desktop/src/updater.ts`

```ts
export type UpdateState = …;
export function createUpdater(opts: { currentVersion: string; platform: NodeJS.Platform; packaged: boolean; downloadsDir: string; log: (l: string) => void }): {
  getState(): UpdateState;
  onState(cb: (s: UpdateState) => void): () => void;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<void>;
  startSchedule(): void;   // 10 s poi ogni 6 h, solo se packaged
}
```

- `check()`: `fetch` dell'API GitHub con `Accept: application/vnd.github+json`, timeout 15 s. Se `compareSemver(latest, current) > 0` → `available` con `latest`, `releaseUrl` (`html_url`) e asset scelto; altrimenti `up-to-date`. Su Windows packaged si usa `electron-updater` (`autoUpdater.checkForUpdates()`), che legge `latest.yml`; se fallisce si ricade sull'API GitHub in modalità manuale (link alla release).
- `download()`: Windows → `autoUpdater.downloadUpdate()` con `download-progress` → `progress` 0–100 → `downloaded`. macOS → stream dell'asset in `downloadsDir/<name>` (file temporaneo `.part`, rinominato alla fine) con progresso calcolato su `content-length`/`size` → `downloaded` con `filePath`.
- `install()`: Windows → `autoUpdater.quitAndInstall()`. macOS → `shell.openPath(filePath)` (monta il dmg) e restituisce; il web mostra le istruzioni.
- Errori: `status: 'error'` con messaggio breve in italiano ("Impossibile contattare GitHub", "Download interrotto"); un nuovo `check()` riparte da `checking`.
- In sviluppo (`packaged: false`): `check()` funziona (utile per provare la UI), `download()` imposta `error` "Download disponibile solo nell'app installata" e lascia `releaseUrl`.

### Preload (`desktop/src/preload.cts`)

```ts
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('neftlixDesktop', {
  version: process.env.NEFTLIX_VERSION,   // impostato dal main in webPreferences.additionalArguments o via ipc sync
  platform: process.platform,
  getState: () => ipcRenderer.invoke('update:get-state'),
  check: () => ipcRenderer.invoke('update:check'),
  download: () => ipcRenderer.invoke('update:download'),
  install: () => ipcRenderer.invoke('update:install'),
  onState: (cb) => { const h = (_e, s) => cb(s); ipcRenderer.on('update:state', h); return () => ipcRenderer.off('update:state', h); },
});
```

La versione si passa con `webPreferences.additionalArguments: ['--neftlix-version=X']` letta in preload da `process.argv`, oppure con un `ipcRenderer.sendSync('app:version')`: scegliere la prima (nessun round trip).

### `desktop/src/main.ts`

- `webPreferences.preload = join(import.meta.dirname, 'preload.cjs')`, `sandbox: true` resta.
- `ipcMain.handle` per i quattro canali; `updater.onState(s => win?.webContents.send('update:state', s))`.
- Menu Aiuto: "Controlla aggiornamenti…" → `updater.check()` e, se disponibile, porta la finestra su `/settings`.
- `startSchedule()` dopo `createWindow`.

### Web

- `web/src/desktop.ts`:
  ```ts
  export type UpdateState = …;
  export type NeftlixDesktop = { version: string; platform: string; getState(): Promise<UpdateState>; check(): Promise<UpdateState>; download(): Promise<UpdateState>; install(): Promise<void>; onState(cb: (s: UpdateState) => void): () => void };
  export const getDesktop = (): NeftlixDesktop | null => (window as unknown as { neftlixDesktop?: NeftlixDesktop }).neftlixDesktop ?? null;
  export function useUpdateState(): UpdateState | null  // hook: getState() al mount + onState
  ```
- `UpdateBanner`: montato in `App` (fuori da `Routes`, non nel player). Testo: "Neftlix {latest} disponibile" con pulsante "Aggiorna" → `/settings`; "×" nasconde per quella versione (`localStorage` `update.dismissed=<latest>`). Con `downloaded`: "Aggiornamento pronto" → "Installa" (Windows) / "Apri" (macOS).
- Settings, pannello "App desktop" (primo pannello quando presente): riga "Versione {version}", riga stato ("Ultimo controllo alle …", "Nuova versione X disponibile", "Download 42%", "Pronto da installare", errore). Pulsanti secondo lo stato: "Controlla aggiornamenti" (idle/up-to-date/error), "Scarica {latest}" (available), barra di avanzamento (downloading), "Installa e riavvia" (downloaded, `manual=false`) oppure "Apri il file scaricato" + testo "Trascina Neftlix nella cartella Applicazioni sostituendo la versione attuale, poi riapri l'app." + pulsante "Esci da Neftlix" (`window.close()` non basta: aggiungere `quit()` al bridge → `app.quit()`). Link "Note di rilascio" → `releaseUrl` (si apre nel browser grazie al guard esistente).
- `Nav`: prop `updateAvailable: boolean` → classe `has-badge` sull'icona Impostazioni (pallino rosso).
- Il web non deve cambiare comportamento nel browser normale: `getDesktop()` è `null`, nessun pannello, nessun banner.

## Errori e casi limite

- Offline: `check()` → `error` "Impossibile contattare GitHub"; la pianificazione riprova al giro successivo, il banner non compare.
- Release più recente senza asset per la piattaforma (es. Windows fallito in CI): `available` con `releaseUrl` ma senza asset → il pulsante "Scarica" diventa "Apri la pagina della release".
- Download interrotto: file `.part` cancellato, `error`.
- Versione locale maggiore della remota (build di sviluppo): `up-to-date`.
- Tag non semver: ignorato → `up-to-date` con log.

## Test

- `desktop/test/versions.test.ts` (`node --test`): parseTag, compareSemver (0.1.0 < 0.2.0 < 1.0.0, uguali → 0), pickAsset per mac/win e assenza asset. Script `test` nel workspace desktop; il root `npm test` esegue server e desktop.
- Web: typecheck; verifica manuale nel browser che nessun pannello/banner compaia senza bridge.
- Desktop manuale: `NEFTLIX_DEBUG=1` app di sviluppo → Impostazioni → "Controlla aggiornamenti" → con `NEFTLIX_FAKE_VERSION=0.0.1` (env letta dal main per il solo test, default `app.getVersion()`) lo stato diventa `available` contro la release reale su GitHub (o `error` se nessuna release pubblicata: accettabile prima del primo rilascio, va documentato).

## Rilascio

Nessun cambiamento in CI: `latest.yml`/`latest-mac.yml` vengono già caricati. Nel CONTRIBUTING: "pubblicare la bozza rende l'aggiornamento visibile alle app installate".
