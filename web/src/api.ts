import type { Card, Category, EpgItem, EpisodeDetail, HomeRow, LiveChannel, LiveChannelDetail, Match, MovieDetail, SeriesDetail, Status } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  status: () => request<Status>('/api/status'),
  setup: (body: { host: string; username: string; password: string }) => request<{ account: Status['account'] }>('/api/setup', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<{ ok: true }>('/api/setup', { method: 'DELETE' }),
  sync: () => request<{ sync: Status['sync'] }>('/api/sync', { method: 'POST' }),
  home: () => request<{ rows: HomeRow[] }>('/api/home'),
  categories: (kind: 'movie' | 'series') => request<Category[]>(`/api/categories${qs({ kind })}`),
  movies: (p: { category?: string; q?: string; sort?: string; offset?: number; limit?: number }) => request<{ total: number; items: Card[] }>(`/api/movies${qs(p)}`),
  series: (p: { category?: string; q?: string; sort?: string; offset?: number; limit?: number }) => request<{ total: number; items: Card[] }>(`/api/series${qs(p)}`),
  movie: (key: string) => request<MovieDetail>(`/api/movies/${encodeURIComponent(key)}`),
  seriesDetail: (id: string) => request<SeriesDetail>(`/api/series/${id}`),
  episode: (id: string | number) => request<EpisodeDetail>(`/api/episodes/${id}`),
  search: (q: string) => request<{ movies: Card[]; series: Card[] }>(`/api/search${qs({ q })}`),
  liveCategories: (all = false) => request<Category[]>(`/api/live/categories${qs({ all: all ? '1' : undefined })}`),
  liveChannels: (p: { category?: string; q?: string; sport?: '1'; sort?: string; limit?: number; offset?: number }) => request<{ total: number; items: LiveChannel[] }>(`/api/live/channels${qs(p)}`),
  liveChannel: (id: string | number) => request<LiveChannelDetail>(`/api/live/channels/${id}`),
  liveEpg: (id: string | number) => request<{ items: EpgItem[] }>(`/api/live/epg/${id}`),
  liveMatches: (days = 7, main = false) => request<{ items: Match[]; source?: string | null; error?: string | null }>(`/api/live/matches${qs({ days, main: main ? '1' : undefined })}`),
  setFixturesKey: (key: string) => request<{ ok: true; source: string | null; error: string | null; count: number }>('/api/settings/fixtures-key', { method: 'POST', body: JSON.stringify({ key }) }),
  favorites: () => request<{ items: Card[] }>('/api/favorites'),
  addFavorite: (type: 'movie' | 'series', id: string) => request<{ favorite: boolean }>('/api/favorites', { method: 'POST', body: JSON.stringify({ type, id }) }),
  removeFavorite: (type: 'movie' | 'series', id: string) => request<{ favorite: boolean }>(`/api/favorites/${type}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  progress: (type: 'movie' | 'episode', id: string | number, position: number, duration: number) =>
    request<{ ok: true; watched: boolean }>('/api/progress', { method: 'POST', body: JSON.stringify({ type, id, position, duration }) }),
  setWatched: (type: 'movie' | 'episode', id: string | number, watched: boolean) =>
    request<{ ok: true }>('/api/progress/watched', { method: 'POST', body: JSON.stringify({ type, id, watched }) }),
  clearProgress: (type: 'movie' | 'episode', id: string | number) => request<{ ok: true }>(`/api/progress/${type}/${encodeURIComponent(String(id))}`, { method: 'DELETE' }),
};

/** Use sendBeacon so the last position survives tab close / navigation. */
export function beaconProgress(type: 'movie' | 'episode', id: string | number, position: number, duration: number) {
  const body = JSON.stringify({ type, id, position, duration });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/progress', new Blob([body], { type: 'application/json' }));
  } else {
    void api.progress(type, id, position, duration);
  }
}

export const streamUrl = (type: 'movie' | 'episode' | 'live', id: string | number) =>
  type === 'live' ? `/stream/live/${id}/index.m3u8` : `/stream/${type}/${encodeURIComponent(String(id))}`;

export function formatTime(unix: number | null | undefined): string {
  if (!unix) return '';
  return new Date(unix * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(secs: number | null | undefined): string {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
