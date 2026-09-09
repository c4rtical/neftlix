import Fastify from 'fastify';
import { openDb } from '../src/db.ts';
import { registerProfileRoutes } from '../src/profiles.ts';
import { registerApiRoutes } from '../src/routes.ts';

/** Fastify app on an in-memory DB, no provider configured. Call `app.close()` when done. */
export async function buildApp() {
  const db = openDb(':memory:');
  const app = Fastify({ logger: false });
  registerProfileRoutes(app, db);
  registerApiRoutes(app, { db, getClient: () => null, setClient: () => {} });
  await app.ready();
  return { app, db };
}

/** Creates a profile through the API and returns the cookie header to act as it. */
export async function createAndSelect(app: Awaited<ReturnType<typeof buildApp>>['app'], name: string) {
  const created = await app.inject({ method: 'POST', url: '/api/profiles', payload: { name, avatar: 'blue' } });
  const id = (created.json() as { id: number }).id;
  const selected = await app.inject({ method: 'POST', url: `/api/profiles/${id}/select` });
  const cookie = selected.headers['set-cookie'] as string;
  return { id, cookie: cookie.split(';')[0] };
}
