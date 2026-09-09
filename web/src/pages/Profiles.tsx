import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { AVATARS, AVATAR_KEYS, type Profile } from '../types';

const MAX_PROFILES = 5;

type Draft = { id: number | null; name: string; avatar: string };

export const initialOf = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

export function Profiles({ current, onDone }: { current: Profile | null; onDone: () => void }) {
  const [items, setItems] = useState<Profile[] | null>(null);
  const [params] = useSearchParams();
  const [manage, setManage] = useState(params.get('manage') === '1');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const newDraft = (): Draft => ({ id: null, name: '', avatar: AVATAR_KEYS[(items?.length ?? 0) % AVATAR_KEYS.length] });

  const load = useCallback(async () => {
    try {
      const r = await api.profiles();
      setItems(r.items);
      if (r.items.length === 0) setDraft({ id: null, name: '', avatar: AVATAR_KEYS[0] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const select = async (p: Profile) => {
    setBusy(true);
    setError(null);
    try {
      await api.selectProfile(p.id);
      onDone();
      nav('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      if (draft.id === null) {
        const created = await api.createProfile({ name: draft.name, avatar: draft.avatar });
        if ((items?.length ?? 0) === 0) {
          await api.selectProfile(created.id);
          onDone();
          nav('/');
          return;
        }
      } else {
        await api.updateProfile(draft.id, { name: draft.name, avatar: draft.avatar });
        if (current?.id === draft.id) onDone();
      }
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft || draft.id === null) return;
    if (!confirm(`Eliminare il profilo "${draft.name}"? Progressi, preferiti e lista "Da guardare" di questo profilo andranno persi.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteProfile(draft.id);
      const wasCurrent = current?.id === draft.id;
      setDraft(null);
      await load();
      if (wasCurrent) onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    } finally {
      setBusy(false);
    }
  };

  if (!items) return <div className="profiles"><p className="muted">Caricamento…</p></div>;

  if (draft) {
    const isNew = draft.id === null;
    return (
      <div className="profiles">
        <form className="profile-form" onSubmit={save}>
          <img className="setup-logo" src="/logo.svg" alt="Neftlix" />
          <h1>{isNew ? (items.length === 0 ? 'Crea il tuo profilo' : 'Nuovo profilo') : 'Modifica profilo'}</h1>
          <div className="profile-preview">
            <span className="profile-avatar" style={{ background: AVATARS[draft.avatar] }}>{initialOf(draft.name)}</span>
          </div>
          <label>
            Nome
            <input data-focus autoFocus value={draft.name} maxLength={20} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
          </label>
          <div className="avatar-picker" role="radiogroup" aria-label="Colore">
            {AVATAR_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                data-focus
                role="radio"
                aria-checked={draft.avatar === k}
                className={`avatar-dot ${draft.avatar === k ? 'selected' : ''}`}
                style={{ background: AVATARS[k] }}
                onClick={() => setDraft({ ...draft, avatar: k })}
                aria-label={k}
              />
            ))}
          </div>
          {error && <div className="error">{error}</div>}
          <div className="profile-form-actions">
            <button className="btn btn-primary" data-focus type="submit" disabled={busy || !draft.name.trim()}>
              {isNew ? 'Crea' : 'Salva'}
            </button>
            {items.length > 0 && (
              <button className="btn" data-focus type="button" onClick={() => setDraft(null)} disabled={busy}>
                Annulla
              </button>
            )}
            {!isNew && (
              <button className="btn btn-danger" data-focus type="button" onClick={remove} disabled={busy}>
                Elimina profilo
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="profiles">
      <img className="setup-logo" src="/logo.svg" alt="Neftlix" />
      <h1>{manage ? 'Gestisci profili' : 'Chi sta guardando?'}</h1>
      <div className="profile-grid">
        {items.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className={`profile-tile ${manage ? 'editing' : ''} ${current?.id === p.id ? 'current' : ''}`}
            data-focus
            autoFocus={i === 0}
            disabled={busy}
            onClick={() => (manage ? setDraft({ id: p.id, name: p.name, avatar: p.avatar }) : void select(p))}
          >
            <span className="profile-avatar" style={{ background: AVATARS[p.avatar] }}>
              {initialOf(p.name)}
              {manage && <span className="profile-edit-badge" aria-hidden="true">✎</span>}
            </span>
            <span className="profile-name">{p.name}</span>
          </button>
        ))}
        {items.length < MAX_PROFILES && (
          <button type="button" className="profile-tile add" data-focus disabled={busy} onClick={() => setDraft(newDraft())}>
            <span className="profile-avatar">+</span>
            <span className="profile-name">Aggiungi profilo</span>
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      <button className="btn btn-ghost" data-focus type="button" onClick={() => setManage((m) => !m)}>
        {manage ? 'Fine' : 'Gestisci profili'}
      </button>
    </div>
  );
}
