import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, formatTime } from '../api';
import type { Category, LiveChannel, Match } from '../types';
import { MatchList } from '../components/MatchList';
import { BrowseHeader, CategorySidebar } from '../components/BrowseHeader';

function ChannelCard({ ch, at }: { ch: LiveChannel; at: number }) {
  const nav = useNavigate();
  const open = () => nav(`/play/live/${ch.id}`);
  const now = ch.now ?? null;
  const pct = now ? Math.min(100, Math.max(0, Math.round(((at - now.start) / (now.stop - now.start)) * 100))) : 0;
  const tip = now ? `${ch.name}\nIn onda: ${now.title} (${formatTime(now.start)}–${formatTime(now.stop)})${ch.next ? `\nA seguire: ${ch.next.title} (${formatTime(ch.next.start)})` : ''}` : ch.name;
  return (
    <div className="channel" data-focus tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()} title={tip}>
      <div className="channel-logo">{ch.logo ? <img src={ch.logo} alt="" loading="lazy" /> : <span>{ch.name.slice(0, 2)}</span>}</div>
      <div className="channel-name">{ch.name}</div>
      {now ? (
        <div className="channel-now">
          <div className="channel-now-title">{now.title}</div>
          <div className="channel-now-bar">
            <div className="channel-now-fill" style={{ width: `${pct}%` }} />
          </div>
          {ch.next && <div className="channel-next muted">{formatTime(ch.next.start)} · {ch.next.title}</div>}
        </div>
      ) : (
        ch.category_name && <div className="channel-cat muted">{ch.category_name}</div>
      )}
    </div>
  );
}

export function Live({ mode = 'sport' }: { mode?: 'sport' | 'tv' }) {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  const all = mode === 'tv';
  const tab = mode === 'sport' && params.get('tab') === 'matches' ? 'matches' : 'channels';
  const q = params.get('q') ?? '';
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [matchSource, setMatchSource] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [onlyWithChannel, setOnlyWithChannel] = useState(false);

  useEffect(() => {
    if (tab !== 'matches') return;
    let alive = true;
    setMatches(null);
    api.liveMatches(7).then((r) => {
      if (!alive) return;
      setMatches(r.items);
      setMatchSource(r.source ?? null);
      setMatchError(r.error ?? null);
    });
    return () => {
      alive = false;
    };
  }, [tab]);
  const [qInput, setQInput] = useState(q);
  const [cats, setCats] = useState<Category[]>([]);
  const [items, setItems] = useState<LiveChannel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [at, setAt] = useState(() => Math.floor(Date.now() / 1000));
  const [catFilter, setCatFilter] = useState('');
  const sort = params.get('sort') === 'title' ? 'title' : 'num';

  useEffect(() => {
    setCats([]);
    setItems([]);
    api.liveCategories(all).then(setCats);
  }, [all]);

  // Reload the list every 2 minutes so "now playing" stays current.
  useEffect(() => {
    let alive = true;
    const load = (first: boolean) => {
      if (first) setLoading(true);
      return api
        .liveChannels({ category: category || undefined, q: q || undefined, sport: !all && !category ? '1' : undefined, sort, limit: 600 })
        .then((r) => {
          if (!alive) return;
          setItems(r.items);
          setTotal(r.total);
          setAt(Math.floor(Date.now() / 1000));
        })
        .finally(() => alive && first && setLoading(false));
    };
    void load(true);
    const t = window.setInterval(() => void load(false), 120_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [category, q, all, sort]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (qInput.trim() !== q) setParam('q', qInput.trim());
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'category' || k === 'all') next.delete('q');
    if (k === 'all') next.delete('category');
    if (k === 'tab') {
      next.delete('category');
      next.delete('q');
    }
    setParams(next, { replace: true });
    if (k !== 'q') setQInput('');
  };

  const current = cats.find((c) => c.id === category);
  const visibleCats = catFilter ? cats.filter((c) => c.name.toLowerCase().includes(catFilter.toLowerCase())) : cats;
  const kindLabel = all ? 'canali TV' : 'canali sport';

  return (
    <div className="page page-browse">
      <CategorySidebar
        title={all ? 'TV live' : 'Sport'}
        filter={catFilter}
        onFilter={setCatFilter}
        showFilter={tab === 'channels' && cats.length > 15}
        head={
          !all ? (
            <div className="tabs">
              <button className={`chip ${tab === 'channels' ? 'active' : ''}`} data-focus onClick={() => setParam('tab', '')}>
                Canali
              </button>
              <button className={`chip ${tab === 'matches' ? 'active' : ''}`} data-focus onClick={() => setParam('tab', 'matches')}>
                Partite
              </button>
            </div>
          ) : undefined
        }
      >
        {tab === 'matches' ? (
          <>
            <p className="muted small">Calendario ufficiale{matchSource ? ` (${matchSource})` : ''}, abbinato ai canali tramite la guida TV. Clic sulla partita per guardare.</p>
            {matchError && <p className="error small">{matchError}</p>}
            <label className="muted small check">
              <input type="checkbox" checked={onlyWithChannel} onChange={(e) => setOnlyWithChannel(e.target.checked)} /> Solo con canale trovato
            </label>
          </>
        ) : (
          <>
            <button className={`cat ${!category ? 'active' : ''}`} data-focus onClick={() => setParam('category', '')}>
              {all ? 'Tutti' : 'Tutto lo sport'}
            </button>
            {visibleCats.map((c) => (
              <button key={c.id} className={`cat ${c.id === category ? 'active' : ''}`} data-focus onClick={() => setParam('category', c.id)}>
                <span>{c.name}</span> <span className="cat-count">{c.count}</span>
              </button>
            ))}
          </>
        )}
      </CategorySidebar>
      {tab === 'matches' ? (
        <div className="browse-main">
          <div className="browse-head">
            <h2>Partite della settimana</h2>
          </div>
          {matches === null ? <div className="muted">Caricamento…</div> : <MatchList items={onlyWithChannel ? matches.filter((m) => m.channels.length > 0 || m.fallback) : matches} />}
        </div>
      ) : (
      <div className="browse-main">
        <BrowseHeader
          title={current?.name ?? (all ? 'Tutti i canali' : 'Sport in diretta')}
          placeholder={current ? `Cerca in ${current.name}…` : `Cerca tra tutti i ${kindLabel}…`}
          query={qInput}
          onQuery={setQInput}
          sorts={[
            { id: 'num', label: 'Ordine canale' },
            { id: 'title', label: 'A-Z' },
          ]}
          sort={sort}
          onSort={(id) => setParam('sort', id)}
          count={total}
          countLabel="canali"
        />
        {loading && items.length === 0 ? (
          <div className="muted">Caricamento…</div>
        ) : items.length === 0 ? (
          <div className="muted">Nessun canale.</div>
        ) : (
          <div className="channels">
            {items.map((ch) => (
              <ChannelCard key={ch.id} ch={ch} at={at} />
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
