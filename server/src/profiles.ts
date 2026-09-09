import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Db } from './db.ts';
import { now } from './db.ts';

export const AVATARS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'teal', 'pink'] as const;
export type Profile = { id: number; name: string; avatar: string };

const MAX_PROFILES = 5;
const NAME_MAX = 20;
const COOKIE = 'neftlix_profile';
const COOKIE_MAX_AGE = 365 * 24 * 3600;
/** API paths usable without a profile (exact match or prefix + '/'). */
const PUBLIC = ['/api/status', '/api/setup', '/api/sync', '/api/profiles', '/api/settings'];

declare module 'fastify' {
  interface FastifyRequest {
    profileId: number | null;
  }
}

export function readProfileCookie(header: string | undefined): number | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== COOKIE) continue;
    const n = Number(part.slice(eq + 1).trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

export function profileRow(db: Db, id: number): Profile | undefined {
  return db.prepare('SELECT id, name, avatar FROM profile WHERE id = ?').get(id) as Profile | undefined;
}

function isPublic(path: string) {
  return PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));
}

function setProfileCookie(reply: FastifyReply, id: number | null) {
  const value = id === null ? `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` : `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
  reply.header('set-cookie', value);
}

function validate(body: { name?: unknown; avatar?: unknown }, partial: boolean): { name?: string; avatar?: string } | string {
  const out: { name?: string; avatar?: string } = {};
  if (body.name !== undefined || !partial) {
    const name = String(body.name ?? '').trim();
    if (!name) return 'Il nome è obbligatorio';
    if (name.length > NAME_MAX) return `Il nome può avere al massimo ${NAME_MAX} caratteri`;
    out.name = name;
  }
  if (body.avatar !== undefined || !partial) {
    const avatar = String(body.avatar ?? '');
    if (!(AVATARS as readonly string[]).includes(avatar)) return 'Avatar non valido';
    out.avatar = avatar;
  }
  return out;
}

export function registerProfileRoutes(app: FastifyInstance, db: Db) {
  app.decorateRequest('profileId', null);

  app.addHook('onRequest', async (req, reply) => {
    const id = readProfileCookie(req.headers.cookie);
    req.profileId = id !== null && profileRow(db, id) ? id : null;
    const path = req.url.split('?')[0];
    if (path.startsWith('/api/') && req.profileId === null && !isPublic(path)) {
      return reply.code(401).send({ error: 'Profilo non selezionato', code: 'NO_PROFILE' });
    }
  });

  app.get('/api/profiles', async (req) => ({
    items: db.prepare('SELECT id, name, avatar FROM profile ORDER BY id').all() as Profile[],
    current: req.profileId,
  }));

  app.post('/api/profiles', async (req, reply) => {
    const v = validate((req.body ?? {}) as { name?: unknown; avatar?: unknown }, false);
    if (typeof v === 'string') return reply.code(400).send({ error: v });
    const n = (db.prepare('SELECT COUNT(*) AS n FROM profile').get() as { n: number }).n;
    if (n >= MAX_PROFILES) return reply.code(409).send({ error: `Puoi avere al massimo ${MAX_PROFILES} profili` });
    const r = db.prepare('INSERT INTO profile (name, avatar, created_at) VALUES (?, ?, ?)').run(v.name!, v.avatar!, now());
    return profileRow(db, Number(r.lastInsertRowid));
  });

  app.patch('/api/profiles/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!profileRow(db, id)) return reply.code(404).send({ error: 'Profilo non trovato' });
    const v = validate((req.body ?? {}) as { name?: unknown; avatar?: unknown }, true);
    if (typeof v === 'string') return reply.code(400).send({ error: v });
    if (v.name !== undefined) db.prepare('UPDATE profile SET name = ? WHERE id = ?').run(v.name, id);
    if (v.avatar !== undefined) db.prepare('UPDATE profile SET avatar = ? WHERE id = ?').run(v.avatar, id);
    return profileRow(db, id);
  });

  app.delete('/api/profiles/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!profileRow(db, id)) return reply.code(404).send({ error: 'Profilo non trovato' });
    db.exec('BEGIN');
    try {
      for (const t of ['progress', 'watchlist', 'favorite']) db.prepare(`DELETE FROM ${t} WHERE profile_id = ?`).run(id);
      db.prepare('DELETE FROM profile WHERE id = ?').run(id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    if (req.profileId === id) setProfileCookie(reply, null);
    return { ok: true };
  });

  app.post('/api/profiles/deselect', async (_req, reply) => {
    setProfileCookie(reply, null);
    return { ok: true };
  });

  app.post('/api/profiles/:id/select', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const p = profileRow(db, id);
    if (!p) return reply.code(404).send({ error: 'Profilo non trovato' });
    setProfileCookie(reply, id);
    return p;
  });
}
