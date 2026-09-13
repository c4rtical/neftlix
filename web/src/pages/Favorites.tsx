import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { Card } from '../types';
import { PosterCard } from '../components/Card';
import { IconDice, IconChevronRight } from '../components/Icons';

type Tab = 'favorites' | 'watchlist';

function RemovableCard({ card, onRemove }: { card: Card; onRemove: () => void }) {
  return (
    <div className="removable">
      <PosterCard card={card} />
      <button className="remove-btn" data-focus onClick={onRemove} title="Rimuovi" aria-label={`Rimuovi ${card.title}`}>
        ✕
      </button>
    </div>
  );
}

// Movies first, then series; a group without titles is not shown at all.
function groups(items: Card[]) {
  return (
    [
      { type: 'movie', label: 'Film', items: items.filter((c) => c.type === 'movie') },
      { type: 'series', label: 'Serie TV', items: items.filter((c) => c.type === 'series') },
    ] as const
  ).filter((g) => g.items.length > 0);
}

// Which groups the user folded away, remembered per tab.
function collapsedKey(tab: Tab) {
  return `fav-collapsed:${tab}`;
}
function loadCollapsed(tab: Tab): Set<string> {
  try {
    const raw = localStorage.getItem(collapsedKey(tab));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function Favorites() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'watchlist' ? 'watchlist' : 'favorites';
  const [items, setItems] = useState<Card[] | null>(null);
  const nav = useNavigate();
  const [rolling, setRolling] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(tab));

  useEffect(() => {
    setCollapsed(loadCollapsed(tab));
  }, [tab]);

  const toggle = (type: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      try {
        localStorage.setItem(collapsedKey(tab), JSON.stringify([...next]));
      } catch {
        /* storage unavailable: the state still lives for this visit */
      }
      return next;
    });
  };

  useEffect(() => {
    let alive = true;
    setItems(null);
    (tab === 'favorites' ? api.favorites() : api.watchlist()).then((r) => alive && setItems(r.items));
    return () => {
      alive = false;
    };
  }, [tab]);

  const remove = async (c: Card) => {
    if (tab === 'favorites') await api.removeFavorite(c.type, c.id);
    else await api.removeWatchlist(c.type, c.id);
    setItems((prev) => prev?.filter((x) => !(x.type === c.type && x.id === c.id)) ?? null);
  };

  // "Random": play something from this list right away; a series goes through one of its episodes.
  const roll = async () => {
    if (rolling) return;
    setRolling(true);
    try {
      const r = await api.favoritesRandom(tab);
      nav(`/play/${r.type}/${encodeURIComponent(r.id)}`);
    } catch {
      setRolling(false);
    }
  };

  return (
    <div className="page">
      <div className="browse-head">
        <h2>{tab === 'favorites' ? 'I tuoi preferiti' : 'Da guardare'}</h2>
        <div className="tabs">
          <button className={`chip ${tab === 'favorites' ? 'active' : ''}`} data-focus onClick={() => setParams({}, { replace: true })}>
            Preferiti
          </button>
          <button className={`chip ${tab === 'watchlist' ? 'active' : ''}`} data-focus onClick={() => setParams({ tab: 'watchlist' }, { replace: true })}>
            Da guardare
          </button>
          {items && items.length > 0 && (
            <button className="chip chip-random" data-focus onClick={() => void roll()} disabled={rolling} title="Riproduci qualcosa a caso da questa lista">
              <IconDice width={16} height={16} /> Random
            </button>
          )}
        </div>
        <span className="muted">{items ? `${items.length} titoli` : ''}</span>
      </div>
      {!items ? (
        <div className="muted">Caricamento…</div>
      ) : items.length === 0 ? (
        <div className="muted">
          {tab === 'favorites' ? 'Nessun preferito. Apri un titolo e premi ♡.' : 'Lista vuota. Apri un titolo e premi "+ Da guardare".'}{' '}
          <button className="link-btn" data-focus onClick={() => nav('/movies')}>
            Sfoglia i film ›
          </button>
        </div>
      ) : (
        groups(items).map((g) => (
          <section key={g.type} className={`fav-group ${collapsed.has(g.type) ? 'collapsed' : ''}`}>
            <button
              className="collapsible-toggle fav-group-toggle"
              data-focus
              onClick={() => toggle(g.type)}
              aria-expanded={!collapsed.has(g.type)}
              title={collapsed.has(g.type) ? 'Mostra' : 'Nascondi'}
            >
              <IconChevronRight className="chev" />
              <h3>
                {g.label} <span className="fav-group-count">{g.items.length}</span>
              </h3>
            </button>
            {!collapsed.has(g.type) && (
              <div className="grid">
                {g.items.map((c) => (
                  <RemovableCard key={`${c.type}-${c.id}`} card={c} onRemove={() => remove(c)} />
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
