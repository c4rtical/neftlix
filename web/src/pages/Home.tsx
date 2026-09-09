import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Card, HomeRow, Match, Status } from '../types';
import { Row } from '../components/Row';
import { SportStrip } from '../components/SportStrip';
import { cardHref } from '../components/Card';
import { focusFirst } from '../spatial';

function Hero({ card }: { card: Card }) {
  const nav = useNavigate();
  const img = card.backdrop || card.poster;
  const play = () => (card.episodeId ? nav(`/play/episode/${card.episodeId}`) : nav(cardHref(card)));
  return (
    <div className="hero" style={img ? { backgroundImage: `url(${img})` } : undefined}>
      <div className="hero-shade" />
      <div className="hero-body">
        <div className="hero-kicker">{card.progress ? 'Continua a guardare' : 'In evidenza'}</div>
        <h1>{card.title}</h1>
        <div className="muted">{card.subtitle ?? [card.year, card.rating ? `★ ${card.rating.toFixed(1)}` : null].filter(Boolean).join(' · ')}</div>
        <div className="hero-actions">
          <button className="btn btn-primary" data-focus onClick={play}>
            ▶ {card.progress ? 'Riprendi' : 'Apri'}
          </button>
          <button className="btn" data-focus onClick={() => nav(cardHref(card))}>
            Dettagli
          </button>
        </div>
      </div>
    </div>
  );
}

export function Home({ status }: { status: Status }) {
  const [rows, setRows] = useState<HomeRow[] | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .liveMatches(1, true)
        .then((r) => {
          if (!alive) return;
          const at = Math.floor(Date.now() / 1000);
          // Only what matters right now: live, or kicking off within 3 hours.
          const soon = r.items.filter((m) => m.channels.length > 0 && m.start >= at - 2 * 3600 && m.start <= at + 3 * 3600);
          soon.sort((a, b) => Number(b.live) - Number(a.live) || a.start - b.start);
          setMatches(soon.slice(0, 3));
        })
        .catch(() => {});
    load();
    const t = window.setInterval(load, 120_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [status.sync.finishedAt]);

  useEffect(() => {
    let alive = true;
    api
      .home()
      .then((r) => alive && setRows(r.rows))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [status.sync.finishedAt]);

  useEffect(() => {
    if (rows && !document.activeElement?.hasAttribute('data-focus')) focusFirst(document.querySelector('.page') ?? document);
  }, [rows]);

  if (error) return <div className="page error">{error}</div>;
  if (!rows) return <div className="page muted">Caricamento…</div>;

  const hero = rows.find((r) => r.key === 'continue')?.items[0] ?? rows.find((r) => r.key === 'top-movies')?.items[0] ?? rows[0]?.items[0];
  const syncing = status.sync.running;

  return (
    <div className="page page-home">
      {syncing && (
        <div className="banner">
          Sincronizzazione catalogo: {status.sync.stage} {status.sync.total ? `${status.sync.done}/${status.sync.total}` : ''}
        </div>
      )}
      {hero && <Hero card={hero} />}
      {matches.length > 0 && <SportStrip matches={matches} />}
      {rows.map((r) => (
        <Row key={r.key} title={r.title} items={r.items} link={r.link} wide={r.key === 'continue'} />
      ))}
      {rows.length === 0 && !syncing && <div className="muted">Catalogo vuoto. Avvia una sincronizzazione dalle impostazioni.</div>}
    </div>
  );
}
