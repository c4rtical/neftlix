import { Link } from 'react-router-dom';
import type { Card } from '../types';
import { PosterCard } from './Card';

export function Row({ title, items, link, wide = false }: { title: string; items: Card[]; link?: string; wide?: boolean }) {
  if (!items.length) return null;
  return (
    <section className="row">
      <div className="row-head">
        <h2>{title}</h2>
        {link && (
          <Link to={link} className="row-more" data-focus>
            Vedi tutti ›
          </Link>
        )}
      </div>
      <div className="row-scroll">
        {items.map((c) => (
          <PosterCard key={`${c.type}-${c.id}-${c.episodeId ?? ''}`} card={c} wide={wide} />
        ))}
      </div>
    </section>
  );
}

export function Grid({ items }: { items: Card[] }) {
  return (
    <div className="grid">
      {items.map((c) => (
        <PosterCard key={`${c.type}-${c.id}`} card={c} />
      ))}
    </div>
  );
}
