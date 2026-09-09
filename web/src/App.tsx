import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import type { Status } from './types';
import { Nav } from './components/Nav';
import { Setup } from './pages/Setup';
import { Home } from './pages/Home';
import { Browse } from './pages/Browse';
import { Live } from './pages/Live';
import { MovieDetail } from './pages/MovieDetail';
import { SeriesDetail } from './pages/SeriesDetail';
import { Player } from './pages/Player';
import { Search } from './pages/Search';
import { Favorites } from './pages/Favorites';
import { Settings } from './pages/Settings';
import { installSpatialNavigation } from './spatial';

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  const loc = useLocation();

  const refresh = useCallback(() => {
    api
      .status()
      .then(setStatus)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(refresh, [refresh]);

  // Poll while a sync is running so the UI updates when the catalog lands.
  useEffect(() => {
    if (!status?.sync.running) return;
    const t = window.setInterval(refresh, 2000);
    return () => window.clearInterval(t);
  }, [status?.sync.running, refresh]);

  useEffect(() => installSpatialNavigation(() => (window.history.length > 1 ? nav(-1) : nav('/'))), [nav]);

  // Scroll to top on route change (except player).
  useEffect(() => {
    if (!loc.pathname.startsWith('/play/')) window.scrollTo({ top: 0 });
  }, [loc.pathname]);

  if (error) return <div className="page error">Server non raggiungibile: {error}</div>;
  if (!status) return <div className="page muted">Avvio…</div>;
  if (!status.configured) return <Setup onDone={refresh} />;

  return (
    <div className="app">
      <Nav />
      <main className="main">
        <Routes>
          <Route path="/" element={<Home status={status} />} />
          <Route path="/movies" element={<Browse kind="movie" />} />
          <Route path="/series" element={<Browse kind="series" />} />
          <Route path="/live" element={<Live mode="sport" />} />
          <Route path="/tv" element={<Live mode="tv" />} />
          <Route path="/movie/:key" element={<MovieDetail />} />
          <Route path="/series/:id" element={<SeriesDetail />} />
          <Route path="/play/:type/:id" element={<Player />} />
          <Route path="/search" element={<Search />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/settings" element={<Settings status={status} onChanged={refresh} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
