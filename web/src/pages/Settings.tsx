import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Status } from '../types';
import { getDesktop, useUpdateState } from '../desktop';

function fmtDate(unix: number | null | undefined) {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString('it-IT');
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** "App desktop" panel: only rendered inside the Electron app, where `window.neftlixDesktop` exists. */
function DesktopUpdatePanel() {
  const desktop = getDesktop();
  const state = useUpdateState();
  if (!desktop) return null;

  const statusText = (() => {
    if (!state) return '—';
    switch (state.status) {
      case 'idle':
        return '—';
      case 'checking':
        return 'Controllo in corso…';
      case 'up-to-date':
        return `Aggiornata${state.checkedAt ? ` · controllata alle ${fmtTime(state.checkedAt)}` : ''}`;
      case 'available':
        return `Nuova versione ${state.latest} disponibile`;
      case 'downloading':
        return `Download ${state.progress ?? 0}%`;
      case 'downloaded':
        return 'Pronto da installare';
      case 'error':
        return `Errore: ${state.error}`;
      default:
        return '—';
    }
  })();

  const busy = state?.status === 'checking' || state?.status === 'downloading';

  return (
    <section className="panel">
      <h3>App desktop</h3>
      <dl>
        <dt>Versione</dt>
        <dd>{desktop.version}</dd>
        <dt>Stato</dt>
        <dd>{statusText}</dd>
      </dl>
      {state?.status === 'downloading' && <progress className="update-progress" value={state.progress ?? 0} max={100} />}
      <div className="panel-actions">
        <button className="btn" data-focus onClick={() => desktop.check()} disabled={busy}>
          Controlla aggiornamenti
        </button>
        {state?.status === 'available' &&
          (state.assetName || !state.manual ? (
            <button className="btn btn-primary" data-focus onClick={() => desktop.download()}>
              Scarica {state.latest}
            </button>
          ) : (
            state.releaseUrl && (
              <a className="btn btn-primary" data-focus href={state.releaseUrl} target="_blank" rel="noreferrer">
                Apri la pagina della release
              </a>
            )
          ))}
        {state?.status === 'downloaded' && (
          <button className="btn btn-primary" data-focus onClick={() => desktop.install()}>
            {state.manual ? 'Apri il file scaricato' : 'Installa e riavvia'}
          </button>
        )}
        {state?.status === 'downloaded' && state.manual && (
          <button className="btn btn-danger" data-focus onClick={() => desktop.quit()}>
            Esci da Neftlix
          </button>
        )}
      </div>
      {state?.status === 'downloaded' && state.manual && (
        <p className="muted small">
          {desktop.platform === 'darwin'
            ? "Trascina Neftlix nella cartella Applicazioni sostituendo la versione attuale, poi riapri l'app."
            : "Segui le istruzioni dell'installer, poi riapri l'app."}
        </p>
      )}
      {state?.releaseUrl && (
        <p className="muted small">
          <a href={state.releaseUrl} target="_blank" rel="noreferrer">
            Note di rilascio
          </a>
        </p>
      )}
    </section>
  );
}

export function Settings({ status, onChanged }: { status: Status; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [fdKey, setFdKey] = useState('');
  const [fdMsg, setFdMsg] = useState<string | null>(null);
  const [tmdbKey, setTmdbKey] = useState('');
  const [tmdbMsg, setTmdbMsg] = useState<string | null>(null);
  const tmdb = status.tmdb;
  const a = status.account;
  const s = status.sync;
  const fx = status.fixtures;

  const saveKey = async () => {
    setBusy(true);
    setFdMsg(null);
    try {
      const r = await api.setFixturesKey(fdKey);
      setFdMsg(r.error ? `Errore: ${r.error}` : `Ok: ${r.count} partite da ${r.source}`);
      setFdKey('');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const saveTmdbKey = async () => {
    setBusy(true);
    setTmdbMsg(null);
    try {
      const r = await api.setTmdbKey(tmdbKey);
      setTmdbMsg(r.hasKey ? 'Chiave salvata: gli episodi vengono completati alla prossima apertura di ogni serie.' : 'Chiave rimossa.');
      setTmdbKey('');
      onChanged();
    } catch (e) {
      setTmdbMsg(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    try {
      await api.sync();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (!confirm('Uscire dall\'account del provider? La password verrà rimossa da questo server; catalogo, profili, progressi e preferiti restano salvati e potrai rientrare con la sola password.')) return;
    setBusy(true);
    try {
      await api.logout();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await api.deselectProfile();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const setShowDiscreet = async (showDiscreet: boolean) => {
    if (!status.profile) return;
    setBusy(true);
    try {
      await api.updateProfile(status.profile.id, { showDiscreet });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-settings">
      <h2>Impostazioni</h2>
      <DesktopUpdatePanel />
      <section className="panel">
        <h3>Profili</h3>
        <dl>
          <dt>Profilo attivo</dt>
          <dd>{status.profile?.name ?? '—'}</dd>
          <dt>Profili</dt>
          <dd>{status.profiles} su 5</dd>
        </dl>
        <div className="panel-actions">
          <Link className="btn" data-focus to="/profiles?manage=1">
            Gestisci profili
          </Link>
          <button className="btn" data-focus onClick={signOut} disabled={busy}>
            Esci dal profilo
          </button>
        </div>
        <p className="muted small">Uscendo dal profilo questo dispositivo torna alla schermata "Chi sta guardando?".</p>
      </section>
      <section className="panel">
        <h3>Categorie riservate</h3>
        <dl>
          <dt>Profilo {status.profile?.name ?? ''}</dt>
          <dd>{status.profile?.showDiscreet ? 'Visibili' : 'Nascoste'}</dd>
        </dl>
        <div className="panel-actions">
          <button className="btn" data-focus onClick={() => setShowDiscreet(!status.profile?.showDiscreet)} disabled={busy || !status.profile}>
            {status.profile?.showDiscreet ? 'Nascondi' : 'Mostra'}
          </button>
        </div>
        <p className="muted small">
          Le categorie riservate del provider (contenuti per adulti) e i loro titoli sono nascosti da Film, Serie TV, Live TV, ricerca, home e "Random". La
          scelta vale solo per questo profilo: gli altri restano come sono. Anche quando sono visibili, questi titoli non lasciano tracce: niente "Continua a
          guardare" né cronologia delle ricerche.
        </p>
      </section>
      <section className="panel">
        <h3>Provider</h3>
        <dl>
          <dt>Host</dt>
          <dd>{a?.host}</dd>
          <dt>Utente</dt>
          <dd>{a?.username}</dd>
          <dt>Stato</dt>
          <dd>{a?.status}</dd>
          <dt>Scadenza</dt>
          <dd>{fmtDate(a?.exp_date)}</dd>
          <dt>Connessioni max</dt>
          <dd>{a?.max_connections ?? '—'}</dd>
        </dl>
        <div className="panel-actions">
          <button className="btn btn-danger" data-focus onClick={logout} disabled={busy}>
            Log out
          </button>
        </div>
        <p className="muted small">Esce dall'account del provider su questo server. Per rientrare basterà la password: host e username restano compilati.</p>
      </section>
      <section className="panel">
        <h3>Catalogo</h3>
        <dl>
          <dt>Film</dt>
          <dd>{status.counts.movies.toLocaleString('it-IT')}</dd>
          <dt>Serie</dt>
          <dd>{status.counts.series.toLocaleString('it-IT')}</dd>
          <dt>Ultima sincronizzazione</dt>
          <dd>{fmtDate(a?.last_sync)}</dd>
          <dt>Stato</dt>
          <dd>
            {s.running ? `In corso: ${s.stage} ${s.total ? `${s.done}/${s.total}` : ''}` : s.error ? `Errore: ${s.error}` : s.stage === 'done' ? 'Completata' : 'Inattiva'}
          </dd>
        </dl>
        <button className="btn btn-primary" data-focus onClick={sync} disabled={busy || s.running}>
          {s.running ? 'Sincronizzazione…' : 'Sincronizza ora'}
        </button>
      </section>
      <section className="panel">
        <h3>Calendario partite</h3>
        <dl>
          <dt>Sorgente</dt>
          <dd>{fx?.source ?? '—'}{fx?.error ? ` · errore: ${fx.error}` : ''}</dd>
          <dt>Partite in cache</dt>
          <dd>{fx?.count ?? 0}</dd>
          <dt>Motori e tennis</dt>
          <dd>
            {status.events?.source ? `${status.events.count} eventi da ${status.events.source}` : '—'}
            {status.events?.error ? ` · errore: ${status.events.error}` : ''}
          </dd>
          <dt>Guida TV (EPG)</dt>
          <dd>{status.epg?.programmes ? `${status.epg.programmes.toLocaleString('it-IT')} programmi, aggiornata ${fmtDate(status.epg.lastRun)}` : 'non disponibile'}</dd>
        </dl>
        <p className="muted small">
          Senza chiave vengono usati i dati gratuiti di TheSportsDB, con ESPN come riserva se TheSportsDB non risponde (Serie A, Coppa Italia, Champions, Europa League,
          Premier, Liga, Bundesliga, Ligue 1). Con una chiave gratuita di football-data.org (registrazione su football-data.org/client/register) il calendario è più
          completo e aggiornato. Formula 1, MotoGP e i principali tornei di tennis arrivano sempre da ESPN e TheSportsDB, senza chiave: la chiave riguarda solo il
          calcio.
        </p>
        <div className="keyrow">
          <input data-focus type="password" placeholder={fx?.hasKey ? 'Chiave impostata: incolla per sostituire, vuoto per rimuovere' : 'Chiave API football-data.org'} value={fdKey} onChange={(e) => setFdKey(e.target.value)} />
          <button className="btn" data-focus onClick={saveKey} disabled={busy}>
            Salva
          </button>
        </div>
        {fdMsg && <p className="muted small">{fdMsg}</p>}
      </section>
      <section className="panel">
        <h3>Episodi: titoli e anteprime</h3>
        <dl>
          <dt>Chiave TMDB</dt>
          <dd>{tmdb?.hasKey ? 'impostata' : 'non impostata'}{tmdb?.lastError ? ` · errore: ${tmdb.lastError}` : ''}</dd>
          <dt>Episodi completati</dt>
          <dd>{tmdb?.enriched ?? 0}{tmdb?.lastRun ? `, ultimo ${fmtDate(tmdb.lastRun)}` : ''}</dd>
          <dt>Passata sul catalogo</dt>
          <dd>
            {tmdb?.bulk?.running
              ? `In corso: ${tmdb.bulk.done}/${tmdb.bulk.total} serie`
              : tmdb?.bulk?.error
                ? `Interrotta: ${tmdb.bulk.error}`
                : tmdb?.bulk?.finishedAt
                  ? `Completata ${fmtDate(tmdb.bulk.finishedAt)}`
                  : tmdb?.hasKey
                    ? 'In attesa'
                    : '—'}
          </dd>
        </dl>
        <p className="muted small">
          Alcuni provider lasciano gli episodi senza titolo, anteprima o trama ("Serie S01 E07"). Con una chiave gratuita di TMDB (registrazione su
          themoviedb.org/settings/api) i campi mancanti vengono completati da TMDB, solo quando la numerazione della serie coincide con la sua. I dati del provider,
          quando ci sono, non vengono mai sovrascritti. Con la chiave impostata, dopo ogni sincronizzazione una passata in background completa tutto il catalogo
          (una richiesta al provider per serie, con calma: qualche ora la prima volta).
        </p>
        <div className="keyrow">
          <input data-focus type="password" placeholder={tmdb?.hasKey ? 'Chiave impostata: incolla per sostituire, vuoto per rimuovere' : 'Chiave API TMDB (v3)'} value={tmdbKey} onChange={(e) => setTmdbKey(e.target.value)} />
          <button className="btn" data-focus onClick={saveTmdbKey} disabled={busy}>
            Salva
          </button>
        </div>
        {tmdbMsg && <p className="muted small">{tmdbMsg}</p>}
      </section>
      <section className="panel">
        <h3>Comandi da tastiera</h3>
        <p className="muted small">Frecce: naviga · Invio: apri · Esc / Backspace: indietro · Nel player: ←/→ ±10s, ↑/↓ volume, PageUp/PageDown cambio canale, spazio play/pausa, M muto, N prossimo episodio, F schermo intero.</p>
      </section>
    </div>
  );
}
