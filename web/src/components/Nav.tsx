import { NavLink, useLocation } from 'react-router-dom';

const items = [
  { to: '/', label: 'Home', icon: '⌂' },
  { to: '/movies', label: 'Film', icon: '🎬' },
  { to: '/series', label: 'Serie TV', icon: '📺' },
  { to: '/live', label: 'Sport', icon: '⚽' },
  { to: '/tv', label: 'TV', icon: '📡' },
  { to: '/search', label: 'Cerca', icon: '⌕' },
  { to: '/favorites', label: 'Preferiti', icon: '♥' },
  { to: '/settings', label: 'Impostazioni', icon: '⚙' },
];

export function Nav() {
  const loc = useLocation();
  if (loc.pathname.startsWith('/play/')) return null;
  return (
    <nav className="nav">
      <NavLink to="/" className="nav-logo" data-focus title="Home" aria-label="Home">
        <img src="/logo.svg" alt="Neftlix" />
      </NavLink>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} data-focus>
          <span className="nav-icon">{it.icon}</span>
          <span className="nav-label">{it.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
