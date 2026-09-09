import { useState, type FormEvent } from 'react';
import { api } from '../api';

export function Setup({ onDone }: { onDone: () => void }) {
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setup({ host, username, password });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup">
      <form className="setup-card" onSubmit={submit}>
        <img className="setup-logo" src="/logo.svg" alt="Neftlix" />
        <h1>Collega il tuo provider</h1>
        <p className="muted">Inserisci i dati Xtream Codes che ti ha fornito il tuo provider. Restano solo su questo dispositivo.</p>
        <label>
          Host / URL
          <input data-focus value={host} onChange={(e) => setHost(e.target.value)} placeholder="http://esempio.com:8080" autoFocus required />
        </label>
        <label>
          Username
          <input data-focus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Password
          <input data-focus type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" data-focus type="submit" disabled={busy}>
          {busy ? 'Verifica in corso…' : 'Accedi'}
        </button>
      </form>
    </div>
  );
}
