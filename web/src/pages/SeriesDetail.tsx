import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatDuration } from '../api';
import type { Episode, SeriesDetail as SeriesT } from '../types';
import { ProgressBar } from '../components/Card';
import { focusFirst } from '../spatial';

function EpisodeRow({ ep, onWatched }: { ep: Episode; onWatched: (ep: Episode, watched: boolean) => void }) {
  const nav = useNavigate();
  return (
    <div className={`episode ${ep.watched ? 'watched' : ''}`}>
      <div className="episode-thumb" data-focus tabIndex={0} onClick={() => nav(`/play/episode/${ep.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/play/episode/${ep.id}`)}>
        {ep.image ? <img src={ep.image} alt="" loading="lazy" /> : <div className="episode-thumb-empty">{ep.num}</div>}
        <span className="episode-play">▶</span>
        <ProgressBar progress={ep.progress} />
      </div>
      <div className="episode-body">
        <div className="episode-title">
          <span className="episode-num">{ep.num}.</span> {ep.title ?? `Episodio ${ep.num}`}
          {ep.watched && <span className="tag">Visto</span>}
        </div>
        <div className="muted small">{[formatDuration(ep.duration_secs), ep.air_date].filter(Boolean).join(' · ')}</div>
        {ep.plot && <div className="episode-plot muted">{ep.plot}</div>}
      </div>
      <button className="btn btn-small" data-focus onClick={() => onWatched(ep, !ep.watched)} title={ep.watched ? 'Segna come non visto' : 'Segna come visto'}>
        {ep.watched ? '✓' : '○'}
      </button>
    </div>
  );
}

export function SeriesDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [s, setS] = useState<SeriesT | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setS(null);
    api
      .seriesDetail(id)
      .then((d) => {
        setS(d);
        setSeason(d.nextEpisode?.season ?? d.seasons[0]?.season ?? null);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [id]);

  useEffect(() => {
    if (s) focusFirst(document.querySelector('.detail-actions') ?? document);
  }, [s]);

  if (error) return <div className="page error">{error}</div>;
  if (!s) return <div className="page muted">Caricamento…</div>;

  const toggleFav = async () => {
    const r = s.favorite ? await api.removeFavorite('series', s.id) : await api.addFavorite('series', s.id);
    setS({ ...s, favorite: r.favorite });
  };

  const setWatched = async (ep: Episode, watched: boolean) => {
    await api.setWatched('episode', ep.id, watched);
    setS({
      ...s,
      seasons: s.seasons.map((se) => ({
        ...se,
        episodes: se.episodes.map((e) => (e.id === ep.id ? { ...e, watched, progress: watched ? e.progress : null } : e)),
      })),
    });
  };

  const markSeasonWatched = async (seasonNum: number) => {
    const eps = s.seasons.find((x) => x.season === seasonNum)?.episodes ?? [];
    await Promise.all(eps.filter((e) => !e.watched).map((e) => api.setWatched('episode', e.id, true)));
    setS({ ...s, seasons: s.seasons.map((se) => (se.season === seasonNum ? { ...se, episodes: se.episodes.map((e) => ({ ...e, watched: true })) } : se)) });
  };

  const next = s.nextEpisode;
  const bg = s.backdrop || s.poster;
  const current = s.seasons.find((x) => x.season === season) ?? s.seasons[0];
  const totalEps = s.seasons.reduce((n, x) => n + x.episodes.length, 0);

  return (
    <div className="page detail" style={bg ? { backgroundImage: `url(${bg})` } : undefined}>
      <div className="detail-shade" />
      <div className="detail-body">
        {s.poster && <img className="detail-poster" src={s.poster} alt="" />}
        <div className="detail-text">
          <h1>{s.title}</h1>
          <div className="detail-facts muted">
            {[s.year, s.rating ? `★ ${s.rating.toFixed(1)}` : null, s.genre, `${s.seasons.length} stagioni · ${totalEps} episodi`].filter(Boolean).join(' · ')}
          </div>
          <div className="detail-actions">
            {next && (
              <button className="btn btn-primary" data-focus onClick={() => nav(`/play/episode/${next.episodeId}`)}>
                ▶ {next.position > 0 ? 'Riprendi' : 'Guarda'} S{next.season} E{next.num}
              </button>
            )}
            <button className="btn" data-focus onClick={toggleFav}>
              {s.favorite ? '♥ Nei preferiti' : '♡ Preferiti'}
            </button>
          </div>
          {s.plot && <p className="detail-plot">{s.plot}</p>}
          {s.cast && (
            <p className="muted small">
              <b>Cast:</b> {s.cast}
            </p>
          )}
        </div>
      </div>

      {s.seasons.length === 0 ? (
        <div className="muted">Nessun episodio disponibile dal provider.</div>
      ) : (
        <div className="seasons">
          <div className="season-tabs">
            {s.seasons.map((se) => (
              <button key={se.season} className={`chip ${se.season === current?.season ? 'active' : ''}`} data-focus onClick={() => setSeason(se.season)}>
                Stagione {se.season}
              </button>
            ))}
            {current && (
              <button className="chip chip-ghost" data-focus onClick={() => markSeasonWatched(current.season)}>
                Segna stagione come vista
              </button>
            )}
          </div>
          <div className="episodes">
            {current?.episodes.map((ep) => (
              <EpisodeRow key={ep.id} ep={ep} onWatched={setWatched} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
