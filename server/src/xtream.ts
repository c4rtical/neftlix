// Minimal Xtream Codes API client. Pure fetch, no Android/browser assumptions.
// Field names follow the real panel responses documented in docs/xtream-findings.md.

export const PLAYER_USER_AGENT = 'okhttp/4.12.0';

export type XtreamCredentials = {
  host: string;
  username: string;
  password: string;
};

export type XtreamUserInfo = {
  username: string;
  status: string;
  exp_date: string | null;
  is_trial: string;
  active_cons: string | number;
  max_connections: string | number;
  allowed_output_formats: string[];
};

export type XtreamCategory = {
  category_id: string;
  category_name: string;
  parent_id: number | string;
};

export type XtreamVodStream = {
  num: number;
  name: string;
  stream_id: number;
  stream_icon: string | null;
  rating: string | number | null;
  rating_5based: string | number | null;
  tmdb?: string | number | null;
  tmdb_id?: string | number | null;
  trailer?: string | null;
  added: string | number;
  is_adult: number | string;
  category_id: string;
  category_ids?: number[];
  container_extension: string;
};

export type XtreamSeries = {
  num: number;
  name: string;
  series_id: number;
  cover: string | null;
  plot: string | null;
  cast: string | null;
  director: string | null;
  genre: string | null;
  releaseDate?: string | null;
  release_date?: string | null;
  last_modified: string | number;
  rating: string | number | null;
  rating_5based: string | number | null;
  backdrop_path: string[] | string | null;
  youtube_trailer: string | null;
  tmdb?: string | number | null;
  episode_run_time: string | number | null;
  category_id: string;
  category_ids?: number[];
};

export type XtreamEpisode = {
  id: string | number;
  episode_num: number | string;
  title: string;
  container_extension: string;
  season: number | string;
  added?: string | number;
  info?: {
    air_date?: string;
    plot?: string;
    duration_secs?: number;
    duration?: string;
    movie_image?: string;
    rating?: number | string;
  } | unknown[];
};

export type XtreamSeason = {
  name: string;
  season_number: number | string;
  episode_count: number | string;
  air_date?: string;
  overview?: string;
  cover?: string;
  cover_tmdb?: string;
};

export type XtreamSeriesInfo = {
  seasons: XtreamSeason[];
  info: XtreamSeries & { tmdb?: string };
  episodes: Record<string, XtreamEpisode[]> | XtreamEpisode[][];
};

export type XtreamVodInfo = {
  info: {
    tmdb_id?: string | number;
    name?: string;
    description?: string;
    plot?: string;
    cast?: string;
    actors?: string;
    director?: string;
    genre?: string;
    releasedate?: string;
    release_date?: string;
    youtube_trailer?: string;
    backdrop_path?: string[] | string;
    duration_secs?: number;
    duration?: string;
    rating?: string | number;
    cover_big?: string;
    movie_image?: string;
  };
  movie_data: {
    stream_id: number;
    name: string;
    container_extension: string;
    category_id: string;
  };
};

export type XtreamLiveStream = {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string | null;
  epg_channel_id: string | null;
  added: string | number;
  is_adult: number | string;
  category_id: string;
  category_ids?: number[];
  tv_archive: number | string;
  tv_archive_duration: number | string;
  direct_source?: string;
};

/** Titles/descriptions are base64-encoded by the panel. */
export type XtreamEpgEntry = {
  id: string;
  epg_id: string;
  title: string;
  lang: string;
  start: string;
  end: string;
  description: string;
  channel_id: string;
  start_timestamp: string;
  stop_timestamp: string;
  now_playing?: number;
  has_archive?: number;
};

export function decodeEpgText(b64: string | null | undefined): string {
  if (!b64) return '';
  try {
    return Buffer.from(b64, 'base64').toString('utf8').trim();
  } catch {
    return '';
  }
}

export function normalizeHost(raw: string): string {
  let host = raw.trim();
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
  return host.replace(/\/+$/, '');
}

export class XtreamClient {
  readonly host: string;
  readonly username: string;
  readonly password: string;

  constructor(creds: XtreamCredentials) {
    this.host = normalizeHost(creds.host);
    this.username = creds.username;
    this.password = creds.password;
  }

  private apiUrl(action?: string, params: Record<string, string | number> = {}): string {
    const url = new URL(`${this.host}/player_api.php`);
    url.searchParams.set('username', this.username);
    url.searchParams.set('password', this.password);
    if (action) url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    return url.toString();
  }

  private async getJson<T>(action?: string, params?: Record<string, string | number>, timeoutMs = 120_000): Promise<T> {
    const res = await fetch(this.apiUrl(action, params), {
      headers: { 'User-Agent': PLAYER_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Xtream ${action ?? 'auth'} failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async authenticate(): Promise<{ user_info: XtreamUserInfo; server_info: Record<string, unknown> }> {
    const data = await this.getJson<{ user_info?: XtreamUserInfo; server_info?: Record<string, unknown> }>(undefined, undefined, 20_000);
    if (!data.user_info || String((data.user_info as unknown as { auth?: number }).auth ?? 1) === '0') {
      throw new Error('Credenziali non valide');
    }
    return { user_info: data.user_info, server_info: data.server_info ?? {} };
  }

  getVodCategories() {
    return this.getJson<XtreamCategory[]>('get_vod_categories');
  }

  getSeriesCategories() {
    return this.getJson<XtreamCategory[]>('get_series_categories');
  }

  getVodStreams() {
    return this.getJson<XtreamVodStream[]>('get_vod_streams', undefined, 300_000);
  }

  getSeries() {
    return this.getJson<XtreamSeries[]>('get_series', undefined, 300_000);
  }

  getSeriesInfo(seriesId: number) {
    return this.getJson<XtreamSeriesInfo>('get_series_info', { series_id: seriesId }, 30_000);
  }

  getVodInfo(streamId: number) {
    return this.getJson<XtreamVodInfo>('get_vod_info', { vod_id: streamId }, 30_000);
  }

  getLiveCategories() {
    return this.getJson<XtreamCategory[]>('get_live_categories');
  }

  getLiveStreams() {
    return this.getJson<XtreamLiveStream[]>('get_live_streams', undefined, 120_000);
  }

  getShortEpg(streamId: number, limit = 4) {
    return this.getJson<{ epg_listings?: XtreamEpgEntry[] }>('get_short_epg', { stream_id: streamId, limit }, 15_000);
  }

  liveUrl(streamId: number, format: 'm3u8' | 'ts' = 'm3u8'): string {
    return `${this.host}/live/${this.username}/${this.password}/${streamId}.${format}`;
  }

  movieUrl(streamId: number, ext: string): string {
    return `${this.host}/movie/${this.username}/${this.password}/${streamId}.${ext || 'mp4'}`;
  }

  episodeUrl(episodeId: number | string, ext: string): string {
    return `${this.host}/series/${this.username}/${this.password}/${episodeId}.${ext || 'mp4'}`;
  }
}

/** Some panels return `episodes` as an object keyed by season, others as an array of arrays. */
export function flattenEpisodes(info: XtreamSeriesInfo): XtreamEpisode[] {
  const eps = info.episodes;
  if (!eps) return [];
  if (Array.isArray(eps)) return eps.flat();
  return Object.values(eps).flat();
}
