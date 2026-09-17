import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Fastify from 'fastify';
import { registerStreamRoutes } from '../src/stream.ts';

type Upstream = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/** A fake Xtream edge plus a proxy pointed at it; the proxy's timeouts are shortened for the tests. */
async function setup(upstream: Upstream, timeouts: { headersMs: number; idleMs: number }) {
  const edge = http.createServer(upstream);
  await new Promise<void>((r) => edge.listen(0, '127.0.0.1', r));
  const edgeUrl = `http://127.0.0.1:${(edge.address() as { port: number }).port}/ep.mp4`;
  const db = { prepare: () => ({ get: (id: number) => ({ id, ext: 'mp4' }) }) };
  const client = { episodeUrl: () => edgeUrl };
  const app = Fastify({ logger: false });
  registerStreamRoutes(app, { db, getClient: () => client } as never, timeouts);
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const close = async () => {
    await app.close();
    edge.closeAllConnections();
    await new Promise((r) => edge.close(r));
  };
  return { url, close };
}

test('a progressive stream keeps flowing well past the headers timeout', async () => {
  const CHUNKS = 40;
  const CHUNK = Buffer.alloc(1000, 1);
  const { url, close } = await setup((_, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(CHUNKS * CHUNK.length) });
    let sent = 0;
    const t = setInterval(() => {
      res.write(CHUNK);
      if (++sent === CHUNKS) {
        clearInterval(t);
        res.end();
      }
    }, 50);
  }, { headersMs: 300, idleMs: 5000 });
  try {
    const res = await fetch(`${url}/stream/episode/1`);
    assert.equal(res.status, 200);
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.length, CHUNKS * CHUNK.length, 'the whole 2 s stream arrives although the headers timeout is 300 ms');
  } finally {
    await close();
  }
});

test('an upstream that goes silent mid-stream is cut after the idle timeout, releasing the upstream request', async () => {
  let upstreamClosed = false;
  const { url, close } = await setup((req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '1000000' });
    res.write(Buffer.alloc(3000));
    req.on('close', () => {
      upstreamClosed = true;
    });
    // ...and then nothing, forever.
  }, { headersMs: 300, idleMs: 300 });
  try {
    const t0 = Date.now();
    const res = await fetch(`${url}/stream/episode/1`);
    assert.equal(res.status, 200);
    await assert.rejects(res.arrayBuffer(), 'the proxied body ends with an error, so the browser re-requests with a Range');
    assert.ok(Date.now() - t0 < 3000, 'well before any 30 s default');
    for (let i = 0; i < 20 && !upstreamClosed; i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(upstreamClosed, 'the upstream connection is aborted too');
  } finally {
    await close();
  }
});

test('a slow client (backpressure) is not mistaken for a silent upstream', async () => {
  const TOTAL = 48 * 1024 * 1024; // enough to fill every socket buffer on loopback
  const CHUNK = Buffer.alloc(256 * 1024, 7);
  let sent = 0;
  const { url, close } = await setup((_, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(TOTAL) });
    const pump = () => {
      while (sent < TOTAL) {
        sent += CHUNK.length;
        if (!res.write(CHUNK)) return void res.once('drain', pump);
      }
      res.end();
    };
    pump();
  }, { headersMs: 300, idleMs: 300 });
  try {
    const res = await fetch(`${url}/stream/episode/1`);
    assert.equal(res.status, 200);
    // Do not touch the body for longer than the idle timeout, like a browser whose buffer is full.
    await new Promise((r) => setTimeout(r, 900));
    assert.ok(sent < TOTAL, `the edge was held back by backpressure (sent ${sent} of ${TOTAL})`);
    let got = 0;
    for await (const c of res.body as AsyncIterable<Uint8Array>) got += c.length;
    assert.equal(got, TOTAL);
  } finally {
    await close();
  }
});

test('an upstream that never answers yields 502 after the headers timeout', async () => {
  const { url, close } = await setup(() => {
    /* never respond */
  }, { headersMs: 200, idleMs: 5000 });
  try {
    const t0 = Date.now();
    const res = await fetch(`${url}/stream/episode/1`);
    assert.equal(res.status, 502);
    assert.ok(Date.now() - t0 < 2000);
  } finally {
    await close();
  }
});

