import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lanAddresses, loadLanState, PIN_RE, saveLanState, type LanState } from './lan.js';
import { startServer, type RunningServer } from './server.js';
import { createUpdater, type Updater, type UpdaterDeps } from './updater.js';
import { loadWindowState, trackWindowState } from './window-state.js';

const REPO = 'https://github.com/c4rtical/neftlix';
const DEBUG = process.env.NEFTLIX_DEBUG === '1';

let server: RunningServer | null = null;
let win: BrowserWindow | null = null;
let updater: Updater | null = null;
let lan: LanState = { enabled: false, pin: '', secret: '' };
let lanFile = '';
let restarting: Promise<void> | null = null;

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
      {
        label: 'Controlla aggiornamenti…',
        click: async () => {
          if (!updater) return;
          const s = await updater.check();
          if (s.status === 'available' || s.status === 'downloaded') win?.webContents.send('navigate', '/settings');
        },
      },
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(import.meta.dirname, 'preload.cjs'),
      additionalArguments: [`--neftlix-version=${app.getVersion()}`],
    },
  });
  if (state.maximized) win.maximize();
  trackWindowState(win, userData);

  // Everything outside the local server opens in the system browser (and only if it's http/https).
  const origin = new URL(url).origin;
  const isSameOrigin = (target: string): boolean => {
    try {
      return new URL(target).origin === origin;
    } catch {
      return false;
    }
  };
  const openExternalIfWeb = (target: string) => {
    try {
      const proto = new URL(target).protocol;
      if (proto === 'http:' || proto === 'https:') void shell.openExternal(target);
    } catch {
      /* invalid URL: nothing to open */
    }
  };
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternalIfWeb(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!isSameOrigin(target)) {
      event.preventDefault();
      openExternalIfWeb(target);
    }
  });

  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => {
    win = null;
  });
  void win.loadURL(url);
}

/** What the Settings panel shows: switch, PIN and the addresses a TV can type. */
function lanPublicState() {
  return {
    enabled: lan.enabled,
    pin: lan.pin,
    port: server?.port ?? 0,
    addresses: lan.enabled ? lanAddresses() : [],
    restarting: restarting !== null,
  };
}

function launch(dataDir: string, webDist: string) {
  return startServer(dataDir, webDist, DEBUG, log, {
    host: lan.enabled ? '0.0.0.0' : '127.0.0.1',
    lan: { secret: lan.secret, getPin: () => lan.pin },
  });
}

/** Switching "Apri dalla TV" re-binds the server (same port, other host) and reloads the window. */
async function setLanEnabled(enabled: boolean, dataDir: string, webDist: string) {
  if (restarting) await restarting;
  if (lan.enabled === enabled || !server) return lanPublicState();
  restarting = (async () => {
    const old = server;
    server = null;
    lan = { ...lan, enabled };
    saveLanState(lanFile, lan);
    if (old) await old.close().catch(() => {});
    try {
      server = await launch(dataDir, webDist);
    } catch (e) {
      // Could not bind on the LAN (port taken, firewall): fall back to loopback and report it.
      const msg = e instanceof Error ? e.message : String(e);
      log(`lan restart failed (${msg}); back to loopback`);
      lan = { ...lan, enabled: false };
      saveLanState(lanFile, lan);
      server = await launch(dataDir, webDist);
    }
    log(`server on ${server.url} (${server.host})`);
    win?.webContents.reload();
  })();
  try {
    await restarting;
  } finally {
    restarting = null;
  }
  return lanPublicState();
}

async function boot() {
  const userData = app.getPath('userData');
  const dataDir = join(userData, 'data');
  mkdirSync(dataDir, { recursive: true });
  const webDist = join(import.meta.dirname, 'web');
  lanFile = join(userData, 'lan.json');
  lan = loadLanState(lanFile);
  // Persist right away so the generated PIN and secret stay the same across launches.
  try {
    saveLanState(lanFile, lan);
  } catch (e) {
    log(`cannot write lan.json: ${e instanceof Error ? e.message : String(e)}`);
  }
  log(`Neftlix ${app.getVersion()} starting; data: ${dataDir}; lan: ${lan.enabled ? 'on' : 'off'}`);
  try {
    server = await launch(dataDir, webDist);
    log(`server on ${server.url} (${server.host})`);
  } catch (e) {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    log(`server failed: ${msg}`);
    dialog.showErrorBox('Neftlix non riesce ad avviarsi', `${msg}\n\nLog: ${join(userData, 'neftlix.log')}`);
    app.quit();
    return;
  }
  // Windows only, and only in a packaged build: electron-updater drives checkForUpdates/downloadUpdate/
  // quitAndInstall against latest.yml. Everywhere else (macOS, dev) it's never imported.
  let auto: UpdaterDeps['autoUpdater'];
  if (process.platform === 'win32' && app.isPackaged) {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    auto = autoUpdater;
  }
  const upd = createUpdater({
    // NEFTLIX_FAKE_VERSION: dev-only override to exercise the update UI against the real GitHub
    // release without needing an actual older build installed.
    currentVersion: process.env.NEFTLIX_FAKE_VERSION ?? app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    downloadsDir: app.getPath('downloads'),
    log,
    openPath: (p) => shell.openPath(p),
    autoUpdater: auto,
  });
  updater = upd;
  ipcMain.handle('update:get-state', () => upd.getState());
  ipcMain.handle('update:check', () => upd.check());
  ipcMain.handle('update:download', () => upd.download());
  ipcMain.handle('update:install', () => upd.install());
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.handle('lan:get-state', () => lanPublicState());
  ipcMain.handle('lan:set-enabled', (_e, enabled: unknown) => setLanEnabled(enabled === true, dataDir, webDist));
  ipcMain.handle('lan:set-pin', (_e, pin: unknown) => {
    const value = String(pin ?? '').trim();
    if (!PIN_RE.test(value)) throw new Error('Il PIN deve avere da 4 a 8 cifre');
    lan = { ...lan, pin: value };
    saveLanState(lanFile, lan);
    return lanPublicState();
  });
  upd.onState((s) => win?.webContents.send('update:state', s));

  buildMenu(dataDir);
  createWindow(server.url);
  upd.startSchedule();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) {
      if (server) createWindow(server.url);
      return;
    }
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

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting || !server) return;
    quitting = true;
    const s = server;
    server = null;
    event.preventDefault();
    void Promise.race([s.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2000))]).then(() => {
      app.exit(0);
    });
  });
}
