import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { Card } from '../types';
import { PosterCard } from '../components/Card';

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

export function Favorites() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'watchlist' ? 'watchlist' : 'favorites';
  const [items, setItems] = useState<Card[] | null>(null);
  const nav = useNavigate();

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
        <div className="grid">
          {items.map((c) => (
            <RemovableCard key={`${c.type}-${c.id}`} card={c} onRemove={() => remove(c)} />
          ))}
        </div>
      )}
    </div>
  );
}
