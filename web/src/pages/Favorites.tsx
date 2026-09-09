import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Card } from '../types';
import { Grid } from '../components/Row';

export function Favorites() {
  const [items, setItems] = useState<Card[] | null>(null);
  useEffect(() => {
    api.favorites().then((r) => setItems(r.items));
  }, []);
  return (
    <div className="page">
      <h2>I tuoi preferiti</h2>
      {!items ? <div className="muted">Caricamento…</div> : items.length === 0 ? <div className="muted">Nessun preferito. Aprine uno e premi ♡.</div> : <Grid items={items} />}
    </div>
  );
}
