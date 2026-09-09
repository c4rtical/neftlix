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
