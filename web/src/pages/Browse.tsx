import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { Card, Category } from '../types';
import { Grid } from '../components/Row';

const PAGE = 60;

const SORTS: { id: string; label: string }[] = [
  { id: 'added', label: 'Recenti' },
  { id: 'rating', label: 'Voto' },
  { id: 'year', label: 'Anno' },
  { id: 'title', label: 'A-Z' },
];

export function Browse({ kind }: { kind: 'movie' | 'series' }) {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'added';
  const q = params.get('q') ?? '';
  const [qInput, setQInput] = useState(q);
  const [cats, setCats] = useState<Category[]>([]);
  const [items, setItems] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const [catFilter, setCatFilter] = useState('');

  useEffect(() => {
    api.categories(kind).then((c) => setCats(c.filter((x) => x.count > 0)));
  }, [kind]);

  const load = async (offset: number) => {
    setLoading(true);
    try {
      const fn = kind === 'movie' ? api.movies : api.series;
      const r = await fn({ category: category || undefined, q: q || undefined, sort, offset, limit: PAGE });
      setTotal(r.total);
      setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setItems([]);
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, category, sort, q]);

  // Debounce the title filter into the URL so back/forward and reloads keep it.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (qInput.trim() !== q) setParam('q', qInput.trim());
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  useEffect(() => {
    setQInput('');
  }, [kind, category]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading && items.length < total) void load(items.length);
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, total, loading]);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'category') next.delete('q');
    setParams(next, { replace: true });
  };

  const visibleCats = catFilter ? cats.filter((c) => c.name.toLowerCase().includes(catFilter.toLowerCase())) : cats;
  const current = cats.find((c) => c.id === category);

  return (
    <div className="page page-browse">
      <aside className="cats">
        <div className="cats-head">
          <h3>{kind === 'movie' ? 'Film' : 'Serie TV'}</h3>
          {cats.length > 15 && <input className="cats-filter" placeholder="Filtra categorie" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} data-focus />}
        </div>
        <div className="cats-list">
          <button className={`cat ${!category ? 'active' : ''}`} data-focus onClick={() => setParam('category', '')}>
            Tutti
          </button>
          {visibleCats.map((c) => (
            <button key={c.id} className={`cat ${c.id === category ? 'active' : ''}`} data-focus onClick={() => setParam('category', c.id)}>
              {c.name} <span className="cat-count">{c.count}</span>
            </button>
          ))}
        </div>
      </aside>
      <div className="browse-main">
        <div className="browse-head">
          <h2>{current?.name ?? (kind === 'movie' ? 'Tutti i film' : 'Tutte le serie')}</h2>
          <input
            className="browse-search"
            data-focus
            type="search"
            placeholder={current ? `Cerca in ${current.name}…` : kind === 'movie' ? 'Cerca tra tutti i film…' : 'Cerca tra tutte le serie…'}
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
          <div className="sorts">
            {SORTS.map((s) => (
              <button key={s.id} className={`chip ${sort === s.id ? 'active' : ''}`} data-focus onClick={() => setParam('sort', s.id)}>
                {s.label}
              </button>
            ))}
            <span className="muted">{total.toLocaleString('it-IT')} titoli</span>
          </div>
        </div>
        <Grid items={items} />
        <div ref={sentinel} className="sentinel">
          {loading ? 'Caricamento…' : ''}
        </div>
      </div>
    </div>
  );
}
