import { NavLink, useLocation } from 'react-router-dom';
import { IconFilm, IconHeart, IconHome, IconSearch, IconSeries, IconSettings, IconSport, IconTv } from './Icons';
import { AVATARS, type Profile } from '../types';
import { initialOf } from '../pages/Profiles';

const items = [
  { to: '/', label: 'Home', icon: <IconHome /> },
  { to: '/movies', label: 'Film', icon: <IconFilm /> },
  { to: '/series', label: 'Serie TV', icon: <IconSeries /> },
  { to: '/live', label: 'Sport', icon: <IconSport /> },
  { to: '/tv', label: 'TV', icon: <IconTv /> },
  { to: '/search', label: 'Cerca', icon: <IconSearch /> },
  { to: '/favorites', label: 'Preferiti', icon: <IconHeart /> },
  { to: '/settings', label: 'Impostazioni', icon: <IconSettings /> },
];

export function Nav({ profile, updateAvailable }: { profile: Profile; updateAvailable?: boolean }) {
  const loc = useLocation();
  if (loc.pathname.startsWith('/play/') || loc.pathname.startsWith('/profiles')) return null;
  return (
    <nav className="nav">
      <NavLink to="/" className="nav-logo" data-focus title="Home" aria-label="Home">
        <img src="/logo.svg" alt="Neftlix" />
      </NavLink>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} data-focus>
          <span className="nav-icon">
            {it.icon}
            {it.to === '/settings' && updateAvailable && <span className="nav-badge" />}
          </span>
          <span className="nav-label">{it.label}</span>
        </NavLink>
      ))}
      <NavLink to="/profiles" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} data-focus title="Cambia profilo">
        <span className="nav-avatar" style={{ background: AVATARS[profile.avatar] }}>
          {initialOf(profile.name)}
        </span>
        <span className="nav-label">{profile.name}</span>
      </NavLink>
    </nav>
  );
}
