import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Card } from '../types';
import { PosterCard } from './Card';
import { IconChevronLeft, IconChevronRight } from './Icons';

export function Row({ title, items, link, wide = false }: { title: string; items: Card[]; link?: string; wide?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // scroll-snap rests the first card at the container's left padding, not at 0.
    const cs = getComputedStyle(el);
    const start = parseFloat(cs.paddingLeft) || 0;
    const end = el.scrollWidth - el.clientWidth - (parseFloat(cs.paddingRight) || 0);
    setCanLeft(el.scrollLeft > start + 2);
    setCanRight(el.scrollLeft < end - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [update, items.length]);

  // One "page" = the visible width minus one card, so the last card you saw stays as a landmark.
  const page = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('.card');
    const step = Math.max(el.clientWidth - (card?.offsetWidth ?? 0), el.clientWidth / 2);
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

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
      <div className="row-body">
        <div className="row-scroll" ref={scrollRef}>
          {items.map((c) => (
            <PosterCard key={`${c.type}-${c.id}-${c.episodeId ?? ''}`} card={c} wide={wide} />
          ))}
        </div>
        {canLeft && (
          <button type="button" className="row-arrow row-arrow-left" tabIndex={-1} aria-label="Indietro" onClick={() => page(-1)}>
            <IconChevronLeft />
          </button>
        )}
        {canRight && (
          <button type="button" className="row-arrow row-arrow-right" tabIndex={-1} aria-label="Avanti" onClick={() => page(1)}>
            <IconChevronRight />
          </button>
        )}
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
