import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpdater, type UpdaterDeps } from '../src/updater.ts';

/** electron-updater stand-in: records calls and lets the test fire its events. */
function fakeAutoUpdater() {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  const calls: string[] = [];
  const au: NonNullable<UpdaterDeps['autoUpdater']> & { emit(ev: string, ...a: unknown[]): void } = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on(ev, cb) {
      handlers.set(ev, cb as (...a: unknown[]) => void);
      return au;
    },
    async checkForUpdates() {
      calls.push('check');
    },
    async downloadUpdate() {
      calls.push('download');
    },
    quitAndInstall() {
      calls.push('install');
    },
    emit(ev, ...a) {
      handlers.get(ev)?.(...a);
    },
  };
  return { au, calls };
}

function windowsDeps(au: UpdaterDeps['autoUpdater']): UpdaterDeps {
  return {
    currentVersion: '0.4.0',
    platform: 'win32',
    packaged: true,
    downloadsDir: '/tmp',
    log: () => {},
    openPath: async () => '',
    autoUpdater: au,
  };
}

test('Windows: an update found by electron-updater carries the installer name and the release page, so the UI can offer the download', async () => {
  const { au, calls } = fakeAutoUpdater();
  const upd = createUpdater(windowsDeps(au));
  const checking = upd.check();
  assert.equal(upd.getState().status, 'checking');
  au.emit('update-available', { version: '0.5.1', path: 'Neftlix-Setup-0.5.1.exe', files: [{ url: 'Neftlix-Setup-0.5.1.exe' }] });
  const s = await checking;
  assert.deepEqual(calls, ['check']);
  assert.equal(s.status, 'available');
  assert.equal(s.latest, '0.5.1');
  assert.equal(s.manual, false);
  assert.equal(s.assetName, 'Neftlix-Setup-0.5.1.exe');
  assert.equal(s.releaseUrl, 'https://github.com/c4rtical/neftlix/releases/tag/v0.5.1');

  // The download then goes through electron-updater, and install hands over to it.
  const downloading = upd.download();
  assert.equal(upd.getState().status, 'downloading');
  au.emit('download-progress', { percent: 40 });
  assert.equal(upd.getState().progress, 40);
  au.emit('update-downloaded', {});
  assert.equal((await downloading).status, 'downloaded');
  await upd.install();
  assert.deepEqual(calls, ['check', 'download', 'install']);
});

test('Windows: when electron-updater reports nothing new the state says up to date', async () => {
  const { au } = fakeAutoUpdater();
  const upd = createUpdater(windowsDeps(au));
  const checking = upd.check();
  au.emit('update-not-available', {});
  const s = await checking;
  assert.equal(s.status, 'up-to-date');
  assert.equal(s.manual, false);
});
