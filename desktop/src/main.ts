import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, type RunningServer } from './server.js';
import { createUpdater, type Updater, type UpdaterDeps } from './updater.js';
import { loadWindowState, trackWindowState } from './window-state.js';

const REPO = 'https://github.com/c4rtical/neftlix';
const DEBUG = process.env.NEFTLIX_DEBUG === '1';

let server: RunningServer | null = null;
let win: BrowserWindow | null = null;
let updater: Updater | null = null;

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

async function boot() {
  const userData = app.getPath('userData');
  const dataDir = join(userData, 'data');
  mkdirSync(dataDir, { recursive: true });
  const webDist = join(import.meta.dirname, 'web');
  log(`Neftlix ${app.getVersion()} starting; data: ${dataDir}`);
  try {
    server = await startServer(dataDir, webDist, DEBUG, log);
    log(`server on ${server.url}`);
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
