import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { Card } from '../types';
import { Row } from '../components/Row';
import { IconSearch } from '../components/Icons';

const historyKey = (profileId: number) => `search.history.${profileId}`;
const HISTORY_MAX = 10;

function loadHistory(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveHistory(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function Search({ profileId }: { profileId: number }) {
  const key = historyKey(profileId);
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [result, setResult] = useState<{ movies: Card[]; series: Card[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadHistory(key));

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (input !== q) setParams(input ? { q: input } : {}, { replace: true });
    }, 250);
    return () => window.clearTimeout(t);
  }, [input, q, setParams]);

  useEffect(() => {
    setInput(q);
  }, [q]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResult(null);
      return;
    }
    let alive = true;
    setBusy(true);
    api
      .search(q)
      .then((r) => {
        if (!alive) return;
        setResult(r);
        // Discreet titles are searchable but leave no trace: a term that only finds those is not kept in the history.
        if ([...r.movies, ...r.series].some((c) => !c.discreet)) remember(q.trim());
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const remember = (term: string) => {
    setHistory((prev) => {
      const next = [term, ...prev.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, HISTORY_MAX);
      saveHistory(key, next);
      return next;
    });
  };

  const forget = (term: string) => {
    setHistory((prev) => {
      const next = prev.filter((x) => x !== term);
      saveHistory(key, next);
      return next;
    });
  };

  const clearAll = () => {
    setHistory([]);
    saveHistory(key, []);
  };

  const showHistory = q.trim().length < 2 && history.length > 0;

  return (
    <div className="page page-search">
      <input className="search-input" data-focus autoFocus placeholder="Cerca film e serie…" value={input} onChange={(e) => setInput(e.target.value)} />
      {showHistory && (
        <div className="search-history">
          <div className="search-history-head">
            <h3>Ricerche recenti</h3>
            <button className="link-btn" data-focus onClick={clearAll}>
              Cancella tutto
            </button>
          </div>
          {history.map((term) => (
            <div key={term} className="history-item">
              <button className="history-term" data-focus onClick={() => setParams({ q: term }, { replace: true })}>
                <IconSearch />
                <span>{term}</span>
              </button>
              <button className="history-remove" data-focus onClick={() => forget(term)} title="Rimuovi dalla cronologia" aria-label={`Rimuovi ${term}`}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
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
