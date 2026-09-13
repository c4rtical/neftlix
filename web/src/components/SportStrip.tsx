import { Link, useNavigate } from 'react-router-dom';
import { formatTime } from '../api';

/** What the strip needs to know about a match or a sport session: both API shapes fit. */
export type StripItem = { key: string; title: string; start: number; live: boolean; channels: { id: number; name: string }[] };

/** Slim contextual bar: matches and sessions live now or about to start, one click to the channel. */
export function SportStrip({ items }: { items: StripItem[] }) {
  const nav = useNavigate();
  return (
    <div className="sport-strip">
      <span className="sport-strip-label">Sport adesso</span>
      {items.map((m) => {
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
      <Link to="/live?tab=events" className="row-more" data-focus>
        Motori e tennis ›
      </Link>
    </div>
  );
}
