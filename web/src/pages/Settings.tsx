import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Status } from '../types';

function fmtDate(unix: number | null | undefined) {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString('it-IT');
}

export function Settings({ status, onChanged }: { status: Status; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [fdKey, setFdKey] = useState('');
  const [fdMsg, setFdMsg] = useState<string | null>(null);
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

  return (
    <div className="page page-settings">
      <h2>Impostazioni</h2>
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
          <dt>Guida TV (EPG)</dt>
          <dd>{status.epg?.programmes ? `${status.epg.programmes.toLocaleString('it-IT')} programmi, aggiornata ${fmtDate(status.epg.lastRun)}` : 'non disponibile'}</dd>
        </dl>
        <p className="muted small">
          Senza chiave vengono usati i dati gratuiti di TheSportsDB, con ESPN come riserva se TheSportsDB non risponde (Serie A, Coppa Italia, Champions, Europa League,
          Premier, Liga, Bundesliga, Ligue 1). Con una chiave gratuita di football-data.org (registrazione su football-data.org/client/register) il calendario è più
          completo e aggiornato.
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
        <h3>Comandi da tastiera / telecomando</h3>
        <p className="muted small">Frecce: naviga · Invio: apri · Esc / Backspace: indietro · Nel player: ←/→ ±10s, ↑/↓ ±60s, spazio play/pausa, N prossimo episodio, F schermo intero.</p>
      </section>
    </div>
  );
}
