import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getDesktop, useUpdateState } from '../desktop';

const DISMISS_KEY = 'update.dismissed';

/** Toast shown top-right when a desktop update is available or ready. Renders nothing in a normal browser or in the player. */
export function UpdateBanner() {
  const desktop = getDesktop();
  const state = useUpdateState();
  const loc = useLocation();
  const nav = useNavigate();
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY);
    } catch {
      return null;
    }
  });

  if (!desktop || !state) return null;
  if (loc.pathname.startsWith('/play/')) return null;
  if (state.status !== 'available' && state.status !== 'downloaded') return null;
  if (state.latest && dismissed === state.latest) return null;

  const dismiss = () => {
    if (!state.latest) return;
    try {
      localStorage.setItem(DISMISS_KEY, state.latest);
    } catch {
      /* ignore */
    }
    setDismissed(state.latest);
  };

  const downloaded = state.status === 'downloaded';

  return (
    <div className="update-banner">
      <span>{downloaded ? 'Aggiornamento pronto' : `Neftlix ${state.latest} disponibile`}</span>
      {downloaded ? (
        <button className="btn btn-primary btn-small" data-focus onClick={() => desktop.install()}>
          {state.manual ? 'Apri' : 'Installa'}
        </button>
      ) : (
        <button className="btn btn-primary btn-small" data-focus onClick={() => nav('/settings')}>
          Aggiorna
        </button>
      )}
      <button className="update-banner-close" data-focus aria-label="Chiudi" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
