import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { Card } from '../types';
import { Row } from '../components/Row';

export function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [result, setResult] = useState<{ movies: Card[]; series: Card[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (input !== q) setParams(input ? { q: input } : {}, { replace: true });
    }, 250);
    return () => window.clearTimeout(t);
  }, [input, q, setParams]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResult(null);
      return;
    }
    let alive = true;
    setBusy(true);
    api
      .search(q)
      .then((r) => alive && setResult(r))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [q]);

  return (
    <div className="page page-search">
      <input className="search-input" data-focus autoFocus placeholder="Cerca film e serie…" value={input} onChange={(e) => setInput(e.target.value)} />
      {busy && <div className="muted">Ricerca…</div>}
      {result && (
        <>
          <Row title={`Film (${result.movies.length})`} items={result.movies} />
          <Row title={`Serie TV (${result.series.length})`} items={result.series} />
          {result.movies.length + result.series.length === 0 && <div className="muted">Nessun risultato per “{q}”.</div>}
        </>
      )}
    </div>
  );
}
