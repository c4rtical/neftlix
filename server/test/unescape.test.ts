import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import { repairEscapedText, unescapeText } from '../src/sync.ts';

test('unescapeText decodes unicode escapes the provider ships with or without the backslash', () => {
  assert.equal(unescapeText('laziale u00e8 in luna'), 'laziale è in luna');
  assert.equal(unescapeText('caff\\u00e8 e perch\\u00e9'), 'caffè e perché');
  assert.equal(unescapeText('u00c8 tardi'), 'È tardi');
  assert.equal(unescapeText('Funu00e9raille'), 'Funéraille');
  assert.equal(unescapeText('u2019'), '’');
  assert.equal(unescapeText('nothing here'), 'nothing here');
  assert.equal(unescapeText('u00 short'), 'u00 short');
  assert.equal(unescapeText(null), null);
  assert.equal(unescapeText(undefined), null);
  assert.equal(unescapeText(''), null);
});

test('repairEscapedText fixes rows already stored and reports how many it touched', () => {
  const db = openDb(':memory:');
  db.exec(`INSERT INTO category (id, kind, name, position, discreet) VALUES ('2', 'series', 'Drama', 0, 0)`);
  db.exec(`INSERT INTO movie (key, title, stream_id, ext, added, plot, "cast") VALUES
    ('tmdb:1', 'Film A', 10, 'mp4', 1, 'laziale u00e8 in luna', 'Ren\\u00e9 Ferretti'), ('tmdb:2', 'Film B', 11, 'mp4', 2, 'pulito', NULL)`);
  db.exec(`INSERT INTO series (id, title, category_id, plot) VALUES (7, 'Serie S', '2', 'Perch\\u00e9 no'), (8, 'Serie T', '2', NULL)`);
  db.exec(`INSERT INTO episode (id, series_id, season, num, ext, title, plot) VALUES (700, 7, 1, 1, 'mp4', 'Caffu00e8', 'u00c8 tardi'), (701, 7, 1, 2, 'mp4', 'Ok', 'ok')`);
  assert.equal(repairEscapedText(db), 3);
  assert.equal((db.prepare('SELECT plot FROM movie WHERE key = ?').get('tmdb:1') as { plot: string }).plot, 'laziale è in luna');
  assert.equal((db.prepare('SELECT "cast" AS c FROM movie WHERE key = ?').get('tmdb:1') as { c: string }).c, 'René Ferretti');
  assert.equal((db.prepare('SELECT plot FROM series WHERE id = 7').get() as { plot: string }).plot, 'Perché no');
  const ep = db.prepare('SELECT title, plot FROM episode WHERE id = 700').get() as { title: string; plot: string };
  assert.deepEqual({ ...ep }, { title: 'Caffè', plot: 'È tardi' });
  assert.equal(repairEscapedText(db), 0);
});
