export type Progress = { position: number; duration: number } | null;

export type Card = {
  type: 'movie' | 'series';
  id: string;
  title: string;
  year: number | null;
  poster: string | null;
  backdrop?: string | null;
  rating: number | null;
  progress?: Progress;
  subtitle?: string | null;
  episodeId?: number | null;
};

export type HomeRow = { key: string; title: string; items: Card[]; link?: string };

export type Category = { id: string; name: string; count: number };

export type SyncState = {
  running: boolean;
  stage: string;
  done: number;
  total: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
};

export type Status = {
  configured: boolean;
  account: { host: string; username: string; status: string; exp_date: number | null; max_connections: number | null; last_sync: number | null } | null;
  sync: SyncState;
  epg?: { running: boolean; lastRun: number | null; programmes: number; error: string | null };
  fixtures?: { source: string | null; lastRun: number | null; count: number; error: string | null; hasKey: boolean };
  counts: { movies: number; series: number };
};

export type MovieDetail = {
  id: string;
  key: string;
  title: string;
  year: number | null;
  poster: string | null;
  backdrop: string | null;
  rating: number | null;
  plot: string | null;
  cast: string | null;
  director: string | null;
  genre: string | null;
  duration_secs: number | null;
  stream_id: number;
  ext: string;
  sources: { stream_id: number; ext: string; label: string | null; broken: number }[];
  categories: { id: string; name: string }[];
  progress: { position: number; duration: number; watched: number } | null;
  favorite: boolean;
};

export type Episode = {
  id: number;
  series_id: number;
  season: number;
  num: number;
  title: string | null;
  plot: string | null;
  ext: string;
  duration_secs: number | null;
  image: string | null;
  air_date: string | null;
  progress: Progress;
  watched: boolean;
};

export type NextUp = { episodeId: number; season: number; num: number; title: string | null; position: number; duration: number; image: string | null } | null;

export type SeriesDetail = {
  id: string;
  title: string;
  year: number | null;
  poster: string | null;
  backdrop: string | null;
  plot: string | null;
  cast: string | null;
  director: string | null;
  genre: string | null;
  release_date: string | null;
  rating: number | null;
  category: { id: string; name: string } | null;
  favorite: boolean;
  nextEpisode: NextUp;
  seasons: { season: number; episodes: Episode[] }[];
};

export type Programme = { title: string; description: string | null; start: number; stop: number } | null;

export type LiveChannel = {
  id: number;
  name: string;
  logo: string | null;
  category_id: string | null;
  category_name: string | null;
  archive: number;
  now?: Programme;
  next?: Programme;
};

export type LiveChannelDetail = LiveChannel & {
  epg_channel_id: string | null;
  sport?: boolean;
  prev: { id: number; name: string; logo: string | null } | null;
  next: { id: number; name: string; logo: string | null } | null;
};

export type Match = {
  key: string;
  title: string;
  home: string;
  away: string;
  competition: string | null;
  start: number;
  stop: number;
  live: boolean;
  replay: boolean;
  status?: string;
  competitionCode?: string;
  homeCrest?: string | null;
  awayCrest?: string | null;
  channels: { id: number; name: string; logo: string | null }[];
  fallback?: { label: string; categoryId: string } | null;
};

export type EpgItem = { title: string; description: string; start: number | null; end: number | null; nowPlaying: boolean };

export type EpisodeDetail = {
  id: number;
  series_id: number;
  season: number;
  num: number;
  title: string | null;
  ext: string;
  duration_secs: number | null;
  series: { id: string; title: string; poster: string | null; backdrop: string | null };
  progress: { position: number; duration: number; watched: number } | null;
  next: { id: number; season: number; num: number; title: string | null } | null;
};
