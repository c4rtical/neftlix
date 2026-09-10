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
  lan: {
    getState: () => ipcRenderer.invoke('lan:get-state'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('lan:set-enabled', enabled),
    setPin: (pin: string) => ipcRenderer.invoke('lan:set-pin', pin),
  },
  onState: (cb: (s: unknown) => void) => {
    const handler = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('update:state', handler);
    return () => ipcRenderer.off('update:state', handler);
  },
  onNavigate: (cb: (path: string) => void) => {
    const handler = (_e: unknown, path: string) => cb(path);
    ipcRenderer.on('navigate', handler);
    return () => ipcRenderer.off('navigate', handler);
  },
});
