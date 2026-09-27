import { useNavigate } from 'react-router-dom';
import type { Card as CardT } from '../types';
import { IconClose } from './Icons';

export function cardHref(c: CardT): string {
  if (c.type === 'movie') return `/movie/${encodeURIComponent(c.id)}`;
  return `/series/${c.id}`;
}

export function ProgressBar({ progress }: { progress?: CardT['progress'] }) {
  if (!progress || !progress.duration) return null;
  const pct = Math.min(100, Math.round((progress.position / progress.duration) * 100));
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** `onRemove` adds a × button (and the Delete key) to take the card out of its row, e.g. "Continua a guardare". */
export function PosterCard({ card, wide = false, onRemove }: { card: CardT; wide?: boolean; onRemove?: (card: CardT) => void }) {
  const nav = useNavigate();
  const open = () => {
    if (card.episodeId) nav(`/play/episode/${card.episodeId}`);
    else nav(cardHref(card));
  };
  const img = wide ? card.backdrop || card.poster : card.poster;
  return (
    <div
      className={`card ${wide ? 'card-wide' : ''}`}
      data-focus
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter') open();
        else if (onRemove && e.key === 'Delete') onRemove(card);
      }}
      title={card.title}
    >
      <div className="card-img">
        {img ? <img src={img} alt="" loading="lazy" /> : <div className="card-placeholder">{card.title}</div>}
        {card.type === 'series' && <span className="badge">Serie</span>}
        <ProgressBar progress={card.progress} />
        {onRemove && (
          <button
            type="button"
            className="card-remove"
            tabIndex={-1}
            aria-label="Rimuovi da Continua a guardare"
            title="Rimuovi da Continua a guardare"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(card);
            }}
          >
            <IconClose />
          </button>
        )}
      </div>
      <div className="card-meta">
        <div className="card-title">{card.title}</div>
        <div className="card-sub">
          {card.subtitle ?? [card.year, card.rating ? `★ ${card.rating.toFixed(1)}` : null].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  );
}
