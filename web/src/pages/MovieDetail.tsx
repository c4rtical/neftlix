import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatDuration } from '../api';
import type { MovieDetail as MovieT } from '../types';
import { focusFirst } from '../spatial';

export function MovieDetail() {
  const { key = '' } = useParams();
  const nav = useNavigate();
  const [m, setM] = useState<MovieT | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setM(null);
    api
      .movie(decodeURIComponent(key))
      .then(setM)
      .catch((e) => setError(String(e.message ?? e)));
  }, [key]);

  useEffect(() => {
    if (m) focusFirst(document.querySelector('.detail-actions') ?? document);
  }, [m]);

  if (error) return <div className="page error">{error}</div>;
  if (!m) return <div className="page muted">Caricamento…</div>;

  const resume = m.progress && !m.progress.watched && m.progress.position > 30 ? m.progress : null;
  const toggleFav = async () => {
    const r = m.favorite ? await api.removeFavorite('movie', m.id) : await api.addFavorite('movie', m.id);
    setM({ ...m, favorite: r.favorite });
  };
  const toggleWatched = async () => {
    const watched = !(m.progress?.watched === 1);
    await api.setWatched('movie', m.id, watched);
    setM({ ...m, progress: watched ? { position: 0, duration: 0, watched: 1 } : null });
  };

  const bg = m.backdrop || m.poster;
  return (
    <div className="page detail" style={bg ? { backgroundImage: `url(${bg})` } : undefined}>
      <div className="detail-shade" />
      <div className="detail-body">
        {m.poster && <img className="detail-poster" src={m.poster} alt="" />}
        <div className="detail-text">
          <h1>{m.title}</h1>
          <div className="detail-facts muted">
            {[m.year, formatDuration(m.duration_secs), m.rating ? `★ ${m.rating.toFixed(1)}` : null, m.genre].filter(Boolean).join(' · ')}
            {m.progress?.watched === 1 && <span className="tag">Visto</span>}
          </div>
          {resume && (
            <div className="muted">
              Interrotto a {formatDuration(resume.position)} di {formatDuration(resume.duration)}
            </div>
          )}
          <div className="detail-actions">
            <button className="btn btn-primary" data-focus onClick={() => nav(`/play/movie/${encodeURIComponent(m.id)}`)}>
              ▶ {resume ? 'Riprendi' : 'Riproduci'}
            </button>
            {resume && (
              <button className="btn" data-focus onClick={() => nav(`/play/movie/${encodeURIComponent(m.id)}?from=0`)}>
                Dall'inizio
              </button>
            )}
            <button className="btn" data-focus onClick={toggleFav}>
              {m.favorite ? '♥ Nei preferiti' : '♡ Preferiti'}
            </button>
            <button className="btn" data-focus onClick={toggleWatched}>
              {m.progress?.watched === 1 ? 'Segna come non visto' : 'Segna come visto'}
            </button>
          </div>
          {m.plot && <p className="detail-plot">{m.plot}</p>}
          {m.cast && (
            <p className="muted small">
              <b>Cast:</b> {m.cast}
            </p>
          )}
          {m.director && (
            <p className="muted small">
              <b>Regia:</b> {m.director}
            </p>
          )}
          {m.categories.length > 0 && (
            <div className="tags">
              {m.categories.map((c) => (
                <button key={c.id} className="chip" data-focus onClick={() => nav(`/movies?category=${c.id}`)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {m.sources.some((s) => s.label) && (
            <p className="muted small">Versioni disponibili: {[...new Set(m.sources.map((s) => s.label ?? 'HD'))].join(', ')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
