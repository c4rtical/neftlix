import { createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { compareSemver, parseTag, pickAsset, type PickedAsset, type ReleaseAsset } from './versions.js';

export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error';
export type UpdateState = {
  status: UpdateStatus;
  current: string;
  latest?: string;
  progress?: number;
  filePath?: string;
  releaseUrl?: string;
  assetName?: string;
  error?: string;
  checkedAt?: number;
  manual: boolean;
};

export type UpdaterDeps = {
  currentVersion: string;
  platform: NodeJS.Platform;
  packaged: boolean;
  downloadsDir: string;
  log: (line: string) => void;
  openPath: (p: string) => Promise<string>; // shell.openPath
  /** Windows only: electron-updater's autoUpdater, injected so tests/dev never load it. */
  autoUpdater?: {
    checkForUpdates(): Promise<unknown>;
    downloadUpdate(): Promise<unknown>;
    quitAndInstall(): void;
    on(ev: string, cb: (...a: never[]) => void): unknown;
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
  };
};

type GithubRelease = {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
};

type Pending = { resolve: () => void; reject: (e: Error) => void };

const RELEASES_API = 'https://api.github.com/repos/c4rtical/neftlix/releases/latest';
const CHECK_EVERY_MS = 6 * 3600 * 1000;
const FIRST_CHECK_MS = 10_000;
const PROGRESS_THROTTLE_MS = 250; // ~4/s
const CHECK_TIMEOUT_MS = 60_000; // safety net if electron-updater never fires an event
const AUTO_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

export type Updater = {
  getState(): UpdateState;
  onState(cb: (s: UpdateState) => void): () => void;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<void>;
  startSchedule(): void;
};

export function createUpdater(deps: UpdaterDeps): Updater {
  const listeners = new Set<(s: UpdateState) => void>();
  // `manual` starts true unless we're a packaged Windows build with electron-updater injected;
  // it can also flip to true for the rest of this session if electron-updater fails mid-check.
  let manual = deps.platform !== 'win32' || !deps.packaged || !deps.autoUpdater;
  let pickedAsset: PickedAsset | null = null;

  // At most one in-flight check() and one in-flight download() against electron-updater at a
  // time; the persistent listeners below (registered once, not per-call) resolve/reject these.
  let pendingCheck: Pending | null = null;
  let pendingDownload: Pending | null = null;

  let state: UpdateState = {
    status: 'idle',
    current: deps.currentVersion,
    manual,
  };

  function emit() {
    for (const cb of listeners) cb(state);
  }

  function setState(patch: Partial<UpdateState>) {
    state = { ...state, ...patch, manual };
    emit();
  }

  // Registered once (not per check()/download() call) so long-running Windows sessions don't
  // accumulate duplicate listeners on electron-updater's singleton and fire N state transitions
  // per real event.
  if (deps.autoUpdater) {
    const au = deps.autoUpdater;
    // A check that already timed out fell back to the GitHub API: ignore its late events.
    au.on('update-available', ((info: { version: string }) => {
      if (!pendingCheck) return;
      setState({ status: 'available', latest: info.version, checkedAt: Date.now() });
      pendingCheck.resolve();
      pendingCheck = null;
    }) as never);
    au.on('update-not-available', (() => {
      if (!pendingCheck) return;
      setState({ status: 'up-to-date', checkedAt: Date.now() });
      pendingCheck.resolve();
      pendingCheck = null;
    }) as never);
    au.on('download-progress', ((p: { percent: number }) => {
      setState({ status: 'downloading', progress: p.percent });
    }) as never);
    au.on('update-downloaded', (() => {
      setState({ status: 'downloaded' });
      pendingDownload?.resolve();
      pendingDownload = null;
    }) as never);
    au.on('error', ((err: Error) => {
      const e = err instanceof Error ? err : new Error(String(err));
      if (pendingDownload) {
        pendingDownload.reject(e);
        pendingDownload = null;
      } else if (pendingCheck) {
        pendingCheck.reject(e);
        pendingCheck = null;
      }
    }) as never);
  }

  async function fetchLatestRelease(): Promise<GithubRelease | null> {
    const res = await fetch(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'neftlix-desktop' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return null; // no release published yet
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    return (await res.json()) as GithubRelease;
  }

  async function checkViaApi(): Promise<UpdateState> {
    let release: GithubRelease | null;
    try {
      release = await fetchLatestRelease();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      deps.log(`update check failed: ${msg}`);
      setState({ status: 'error', error: 'Impossibile contattare GitHub' });
      return state;
    }
    if (!release) {
      setState({ status: 'up-to-date', checkedAt: Date.now() });
      return state;
    }
    const latest = parseTag(release.tag_name);
    if (!latest) {
      deps.log(`update check: tag "${release.tag_name}" is not semver, ignoring`);
      setState({ status: 'up-to-date', checkedAt: Date.now() });
      return state;
    }
    if (compareSemver(latest, deps.currentVersion) <= 0) {
      setState({ status: 'up-to-date', latest, checkedAt: Date.now() });
      return state;
    }
    pickedAsset = pickAsset(release.assets, deps.platform);
    setState({
      status: 'available',
      latest,
      releaseUrl: release.html_url,
      assetName: pickedAsset?.name,
      checkedAt: Date.now(),
    });
    return state;
  }

  async function check(): Promise<UpdateState> {
    // Never interrupt a download in flight or discard one already completed.
    if (state.status === 'checking' || state.status === 'downloading' || state.status === 'downloaded') return state;
    setState({ status: 'checking' });

    if (deps.autoUpdater && !manual) {
      const au = deps.autoUpdater;
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingCheck = null;
            reject(new Error('timed out waiting for electron-updater'));
          }, CHECK_TIMEOUT_MS);
          timer.unref?.();
          pendingCheck = {
            resolve: () => {
              clearTimeout(timer);
              resolve();
            },
            reject: (e) => {
              clearTimeout(timer);
              reject(e);
            },
          };
          au.checkForUpdates().catch((e: unknown) => {
            pendingCheck = null;
            clearTimeout(timer);
            reject(e instanceof Error ? e : new Error(String(e)));
          });
        });
        return state;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        deps.log(`electron-updater check failed, falling back to GitHub API: ${msg}`);
        manual = true; // fall back to manual mode for the rest of this session
      }
    }

    return checkViaApi();
  }

  async function downloadAuto(): Promise<UpdateState> {
    const au = deps.autoUpdater;
    if (!au) return state;
    // Enter 'downloading' right away so a second click cannot start a second download.
    setState({ status: 'downloading', progress: 0 });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingDownload = null;
          reject(new Error('timed out waiting for electron-updater download'));
        }, AUTO_DOWNLOAD_TIMEOUT_MS);
        timer.unref?.();
        pendingDownload = {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        };
        au.downloadUpdate().catch((e: unknown) => {
          pendingDownload = null;
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      deps.log(`download failed: ${msg}`);
      setState({ status: 'error', error: 'Download interrotto' });
    }
    return state;
  }

  async function downloadManual(): Promise<UpdateState> {
    if (!deps.packaged) {
      setState({ status: 'error', error: "Download disponibile solo nell'app installata" });
      return state;
    }
    if (!pickedAsset) {
      setState({ status: 'error', error: 'Nessun file scaricabile per questa piattaforma' });
      return state;
    }
    const asset = pickedAsset;
    const finalPath = join(deps.downloadsDir, asset.name);
    const tmpPath = `${finalPath}.part`;
    setState({ status: 'downloading', progress: 0 });

    let lastEmit = 0;
    try {
      // A universal dmg is ~230 MB: allow slow links before declaring the download stalled.
      const res = await fetch(asset.url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
      if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
      const total = Number(res.headers.get('content-length') ?? asset.size) || asset.size;
      let received = 0;

      const source = Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>);
      const counter = new PassThrough();
      counter.on('data', (chunk: Buffer) => {
        received += chunk.length;
        const now = Date.now();
        if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
          lastEmit = now;
          const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : undefined;
          setState({ status: 'downloading', progress: pct });
        }
      });

      await pipeline(source, counter, createWriteStream(tmpPath));
      await rename(tmpPath, finalPath);
      setState({ status: 'downloaded', filePath: finalPath, progress: 100 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      deps.log(`download failed: ${msg}`);
      await unlink(tmpPath).catch(() => {});
      setState({ status: 'error', error: 'Download interrotto' });
    }
    return state;
  }

  async function download(): Promise<UpdateState> {
    if (state.status === 'downloading') return state;
    if (state.status !== 'available') return state;
    if (deps.autoUpdater && !manual) return downloadAuto();
    return downloadManual();
  }

  async function install(): Promise<void> {
    if (deps.autoUpdater && !manual) {
      deps.autoUpdater.quitAndInstall();
      return;
    }
    if (state.filePath) await deps.openPath(state.filePath);
  }

  function startSchedule(): void {
    if (!deps.packaged) return;
    const t1 = setTimeout(() => void check(), FIRST_CHECK_MS);
    t1.unref();
    const t2 = setInterval(() => void check(), CHECK_EVERY_MS);
    t2.unref();
  }

  function onState(cb: (s: UpdateState) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  return {
    getState: () => state,
    onState,
    check,
    download,
    install,
    startSchedule,
  };
}
