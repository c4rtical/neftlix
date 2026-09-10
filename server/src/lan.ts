/**
 * "Apri dalla TV": when the desktop app listens on the LAN, every client that is not on loopback
 * must present the `neftlix_lan` cookie, obtained by entering the PIN shown in the app's Settings.
 *
 * - Loopback requests (the Electron window itself) are never challenged.
 * - Page requests without the cookie get a minimal PIN form; API and stream requests get 401 JSON.
 * - The cookie value is an HMAC of the PIN with a per-install secret, so changing the PIN signs
 *   every TV out at once.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type LanOptions = {
  /** Per-install secret used to sign the cookie. */
  secret: string;
  /** Current PIN (read on every request so the desktop can change it without restarting the server). */
  getPin: () => string;
};

export const LAN_COOKIE = 'neftlix_lan';
const COOKIE_MAX_AGE = 365 * 24 * 3600;
const MAX_FAILURES = 5;
const LOCK_MS = 30 * 1000;

export function isLoopback(ip: string | undefined): boolean {
  if (!ip) return false;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('127.');
}

export function lanToken(secret: string, pin: string): string {
  return createHmac('sha256', secret).update(`neftlix-lan-v1:${pin}`).digest('hex');
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return part.slice(eq + 1).trim();
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function wantsPage(req: FastifyRequest): boolean {
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/') || path.startsWith('/stream/')) return false;
  return req.method === 'GET' || req.method === 'HEAD';
}

const PIN_PAGE = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Neftlix — PIN</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0b0f; color: #f2f2f5;
         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
  form { text-align: center; padding: 32px; }
  h1 { color: #e50914; font-size: 40px; margin: 0 0 8px; letter-spacing: .04em; }
  p { color: #9a9aab; margin: 0 0 24px; font-size: 18px; }
  input { font-size: 40px; letter-spacing: .3em; text-align: center; width: 8ch; padding: 10px 0 10px .3em;
          border: 2px solid #3a3a44; border-radius: 8px; background: #17171d; color: #fff; outline: none; }
  input:focus { border-color: #fff; }
  button { display: block; margin: 20px auto 0; font-size: 20px; padding: 12px 32px; border: 0; border-radius: 8px;
           background: #e50914; color: #fff; cursor: pointer; }
  button:focus { outline: 3px solid #fff; outline-offset: 2px; }
  .err { color: #ff6b6b; min-height: 1.4em; margin-top: 14px; font-size: 16px; }
</style>
</head>
<body>
<form id="f" autocomplete="off">
  <h1>NEFTLIX</h1>
  <p>Inserisci il PIN mostrato nelle Impostazioni dell'app</p>
  <input id="pin" name="pin" type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="8" autofocus required aria-label="PIN">
  <button type="submit">Entra</button>
  <div class="err" id="err"></div>
</form>
<script>
  var f = document.getElementById('f'), pin = document.getElementById('pin'), err = document.getElementById('err');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    err.textContent = '';
    fetch('/api/lan/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: pin.value }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) { if (x.ok) location.reload(); else { err.textContent = x.j.error || 'PIN errato'; pin.value = ''; pin.focus(); } })
      .catch(function () { err.textContent = 'Connessione non riuscita'; });
  });
</script>
</body>
</html>`;

export function registerLan(app: FastifyInstance, opts: LanOptions) {
  const failures = new Map<string, { count: number; until: number }>();

  const authorized = (req: FastifyRequest): boolean => {
    if (isLoopback(req.ip)) return true;
    const cookie = readCookie(req.headers.cookie, LAN_COOKIE);
    return cookie !== null && safeEqual(cookie, lanToken(opts.secret, opts.getPin()));
  };

  app.addHook('onRequest', async (req, reply) => {
    if (authorized(req)) return;
    const path = req.url.split('?')[0];
    if (path === '/api/lan/login' && req.method === 'POST') return;
    if (wantsPage(req)) {
      return reply.code(401).header('cache-control', 'no-store').type('text/html; charset=utf-8').send(PIN_PAGE);
    }
    return reply.code(401).send({ error: 'PIN richiesto', code: 'LAN_PIN' });
  });

  app.post('/api/lan/login', async (req, reply: FastifyReply) => {
    const ip = req.ip;
    const nowMs = Date.now();
    const state = failures.get(ip);
    if (state && state.until > nowMs) {
      return reply.code(429).send({ error: 'Troppi tentativi, riprova tra 30 secondi' });
    }
    const given = String((req.body as { pin?: unknown } | null)?.pin ?? '').trim();
    if (!given || !safeEqual(given, opts.getPin())) {
      const count = (state?.count ?? 0) + 1;
      // After MAX_FAILURES wrong PINs the address waits LOCK_MS; the counter restarts afterwards.
      failures.set(ip, count >= MAX_FAILURES ? { count: 0, until: nowMs + LOCK_MS } : { count, until: 0 });
      return reply.code(401).send({ error: 'PIN errato' });
    }
    failures.delete(ip);
    const token = lanToken(opts.secret, given);
    reply.header('set-cookie', `${LAN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`);
    return { ok: true };
  });
}
