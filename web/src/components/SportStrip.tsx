import { Link, useNavigate } from 'react-router-dom';
import { formatTime } from '../api';
import type { Match } from '../types';

/** Slim contextual bar: matches live now or about to start, one click to the channel. */
export function SportStrip({ matches }: { matches: Match[] }) {
  const nav = useNavigate();
  return (
    <div className="sport-strip">
      <span className="sport-strip-label">Sport adesso</span>
      {matches.map((m) => {
        const ch = m.channels[0];
        return (
          <button key={m.key} className={`sport-chip ${m.live ? 'live' : ''}`} data-focus onClick={() => nav(`/play/live/${ch.id}`)} title={`${m.title} · ${ch.name}`}>
            <span className="sport-chip-time">{m.live ? 'In onda' : formatTime(m.start)}</span>
            <span className="sport-chip-title">{m.title}</span>
            <span className="sport-chip-channel">{ch.name}</span>
          </button>
        );
      })}
      <Link to="/live?tab=matches" className="row-more" data-focus>
        Tutte le partite ›
      </Link>
    </div>
  );
}
