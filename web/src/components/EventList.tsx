import { useNavigate } from 'react-router-dom';
import { formatTime } from '../api';
import type { SportEventItem } from '../types';
import { dayLabel } from './MatchList';

const SPORT_TAG: Record<SportEventItem['sport'], string> = { f1: 'F1', motogp: 'MotoGP', tennis: 'Tennis' };
const SPORT_NAME: Record<SportEventItem['sport'], string> = { f1: 'Formula 1', motogp: 'MotoGP', tennis: 'Tennis' };

function shortDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

export function EventRow({ e }: { e: SportEventItem }) {
  const nav = useNavigate();
  const play = (id: number) => nav(`/play/live/${id}`);
  const primary = e.channels[0];
  const tournament = e.session === 'tournament';
  const at = Math.floor(Date.now() / 1000);
  const open = () => primary && play(primary.id);
  return (
    <div
      className={`match event ${e.live ? 'match-live' : ''} ${primary ? 'match-clickable' : ''}`}
      data-focus={primary ? '' : undefined}
      tabIndex={primary ? 0 : undefined}
      onClick={primary ? open : undefined}
      onKeyDown={(ev) => primary && ev.key === 'Enter' && ev.target === ev.currentTarget && open()}
      title={primary ? `Guarda su ${primary.name}` : undefined}
    >
      <div className="match-time">
        {e.live ? <span className="epg-badge">In onda</span> : tournament ? <span className="match-tag">{e.start <= at ? 'In corso' : `dal ${shortDate(e.start)}`}</span> : formatTime(e.start)}
        {tournament && <span className="match-tag">fino al {shortDate(e.stop)}</span>}
      </div>
      <div className="match-body">
        <div className="match-title">
          <span className={`event-sport event-sport-${e.sport}`}>{SPORT_TAG[e.sport]}</span>
          <span>{e.title}</span>
          {!tournament && <span className="muted"> · {e.sessionLabel}</span>}
        </div>
        <div className="muted small">{tournament ? `${e.sessionLabel}${e.name !== e.title ? ` · ${e.name}` : ''}` : SPORT_NAME[e.sport]}</div>
      </div>
      <div className="match-channels" onClick={(ev) => ev.stopPropagation()}>
        {e.channels.map((c) => (
          <button key={c.id} className="btn btn-small match-channel" data-focus onClick={() => play(c.id)} title={`Guarda su ${c.name}`}>
            {c.logo && <img src={c.logo} alt="" />}
            <span>{c.name}</span>
          </button>
        ))}
        {e.channels.length === 0 && <span className="muted small">Canale non in guida</span>}
      </div>
    </div>
  );
}

/** Sessions and tournaments grouped by day; a tournament in progress sits under today. */
export function EventList({ items }: { items: SportEventItem[] }) {
  if (items.length === 0) return <div className="muted">Nessun evento in programma.</div>;
  const at = Math.floor(Date.now() / 1000);
  const groups = new Map<string, SportEventItem[]>();
  for (const e of items) {
    const k = dayLabel(e.session === 'tournament' ? Math.max(e.start, at) : e.start);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return (
    <div className="matches">
      {[...groups.entries()].map(([day, es]) => (
        <section key={day} className="match-day">
          <h3>{day}</h3>
          {es.map((e) => (
            <EventRow key={e.key} e={e} />
          ))}
        </section>
      ))}
    </div>
  );
}
