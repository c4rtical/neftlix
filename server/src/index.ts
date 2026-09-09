import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.ts';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.NEFTLIX_DATA ?? resolve(here, '../../data');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const WEB_DIST = resolve(here, '../../web/dist');

const handle = await createApp({
  dataDir: DATA_DIR,
  webDist: WEB_DIST,
  password: process.env.NEFTLIX_PASSWORD,
  logLevel: process.env.LOG_LEVEL,
});
await handle.listen(HOST, PORT);
