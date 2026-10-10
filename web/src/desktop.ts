import { useEffect, useState } from 'react';

/** Shared with `desktop/src/updater.ts` — keep in sync. */
export type UpdateState = {
  status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error';
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

export type NeftlixDesktop = {
  version: string;
  platform: string;
  getState(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<void>;
  quit(): void;
  onState(cb: (s: UpdateState) => void): () => void;
  onNavigate(cb: (path: string) => void): () => void;
};

/** Returns the desktop bridge, or null in a normal browser. Nothing else in the web app may render or run without it. */
export function getDesktop(): NeftlixDesktop | null {
  return (window as unknown as { neftlixDesktop?: NeftlixDesktop }).neftlixDesktop ?? null;
}

export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const d = getDesktop();
    if (!d) return;
    let alive = true;
    d.getState()
      .then((s) => alive && setState(s))
      .catch(() => {});
    const off = d.onState((s) => alive && setState(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}
