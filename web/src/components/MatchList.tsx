import { useNavigate } from 'react-router-dom';
import { formatTime } from '../api';
import type { Match } from '../types';

function dayLabel(unix: number): string {
  const d = new Date(unix * 1000);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Oggi';
  if (same(d, tomorrow)) return 'Domani';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function MatchRow({ m }: { m: Match }) {
  const nav = useNavigate();
  const play = (id: number) => nav(`/play/live/${id}`);
  // Whole row is clickable: first channel, else the fallback category.
  const primary = m.channels[0];
  const openPrimary = () => {
    if (primary) play(primary.id);
    else if (m.fallback) nav(`/live?category=${m.fallback.categoryId}`);
  };
  const clickable = Boolean(primary || m.fallback);
  return (
    <div
      className={`match ${m.live ? 'match-live' : ''} ${m.replay ? 'match-replay' : ''} ${clickable ? 'match-clickable' : ''}`}
      data-focus={clickable ? '' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? openPrimary : undefined}
      onKeyDown={(e) => clickable && e.key === 'Enter' && e.target === e.currentTarget && openPrimary()}
      title={primary ? `Guarda su ${primary.name}` : undefined}
    >
      <div className="match-time">
        {m.live ? <span className="epg-badge">In onda</span> : formatTime(m.start)}
        {m.replay && <span className="match-tag">Replica</span>}
      </div>
      <div className="match-body">
        <div className="match-title">
          {m.homeCrest && <img className="crest" src={m.homeCrest} alt="" loading="lazy" />}
          <span>{m.home}</span> <span className="muted">–</span> <span>{m.away}</span>
          {m.awayCrest && <img className="crest" src={m.awayCrest} alt="" loading="lazy" />}
        </div>
        {m.competition && <div className="muted small">{m.competition}</div>}
      </div>
      <div className="match-channels" onClick={(e) => e.stopPropagation()}>
        {m.channels.map((c) => (
          <button key={c.id} className="btn btn-small match-channel" data-focus onClick={() => play(c.id)} title={`Guarda su ${c.name}`}>
            {c.logo && <img src={c.logo} alt="" />}
            <span>{c.name}</span>
          </button>
        ))}
        {m.channels.length === 0 && m.fallback && (
          <button className="btn btn-small match-channel match-fallback" data-focus onClick={() => nav(`/live?category=${m.fallback!.categoryId}`)} title="Canale non indicato nella guida: apri la categoria">
            {m.fallback.label} ›
          </button>
        )}
        {m.channels.length === 0 && !m.fallback && <span className="muted small">Canale non in guida</span>}
      </div>
    </div>
  );
}

export function MatchList({ items, compact = false, hideReplays = false }: { items: Match[]; compact?: boolean; hideReplays?: boolean }) {
  const list = hideReplays ? items.filter((m) => !m.replay) : items;
  if (list.length === 0) return <div className="muted">Nessuna partita in programma.</div>;
  if (compact) {
    return (
      <div className="matches matches-compact">
        {list.map((m) => (
          <MatchRow key={m.key} m={m} />
        ))}
      </div>
    );
  }
  const groups = new Map<string, Match[]>();
  for (const m of list) {
    const k = dayLabel(m.start);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return (
    <div className="matches">
      {[...groups.entries()].map(([day, ms]) => (
        <section key={day} className="match-day">
          <h3>{day}</h3>
          {ms.map((m) => (
            <MatchRow key={m.key} m={m} />
          ))}
        </section>
      ))}
    </div>
  );
}
