import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossCheck, isGenericTitle, planEnrichment, type ProviderEpisode } from '../src/tmdb.ts';
import { cleanEpisodeTitle } from '../src/sync.ts';

const eps = (season: number, n: number, start = 1): ProviderEpisode[] =>
  Array.from({ length: n }, (_, i) => ({ id: season * 1000 + start + i, season, num: start + i, title: null }));

test('generic titles are recognised, real names are not', () => {
  for (const t of [null, '', 'Episodio 7', 'Episode 12', 'Ep. 3', 'Rick and Morty S01 E1', 'S01E01', 'Show - S07E01'])
    assert.equal(isGenericTitle(t), true, String(t));
  for (const t of ['Solaricks', 'Il misterioso combattente', 'Episodio finale']) assert.equal(isGenericTitle(t), false, t);
});

test('cleanEpisodeTitle: names survive, tags without a name become "Episodio N"', () => {
  assert.equal(cleanEpisodeTitle('Show (1997) - S01E01 - Pilot', 1, 1), 'Pilot');
  assert.equal(cleanEpisodeTitle('Rick and Morty S01 E1', 1, 1), 'Episodio 1');
  assert.equal(cleanEpisodeTitle('Dragon Ball Z S01 E291', 1, 291), 'Episodio 291');
  assert.equal(cleanEpisodeTitle('Rick and Morty - S07E01 - Episodio 1', 7, 1), 'Episodio 1');
  assert.equal(cleanEpisodeTitle('Solaricks', 6, 1), 'Solaricks');
  assert.equal(cleanEpisodeTitle(undefined, 2, 4), 'Episodio 4');
});

test('seasons shape: each provider season maps to the same TMDB season when the numbers fit', () => {
  const tmdb = [
    { season_number: 0, episode_count: 36 },
    { season_number: 1, episode_count: 11 },
    { season_number: 2, episode_count: 10 },
  ];
  const plan = planEnrichment([...eps(1, 11), ...eps(2, 10), ...eps(0, 3)], tmdb);
  assert.equal(plan.length, 21);
  assert.deepEqual(plan.find((m) => m.id === 2003), { id: 2003, tmdbSeason: 2, tmdbEpisode: 3 });
  assert.equal(plan.some((m) => m.tmdbSeason === 0), false, 'specials are never mapped');
});

test('seasons shape: one season that does not fit TMDB refuses the whole series', () => {
  const tmdb = [
    { season_number: 1, episode_count: 11 },
    { season_number: 2, episode_count: 10 },
  ];
  assert.equal(planEnrichment([...eps(1, 11), ...eps(2, 12)], tmdb).length, 0, 'more episodes than TMDB');
  // Bleach: the provider splits the show into arcs (17 seasons), TMDB has 2 seasons of 366 and 50.
  const bleach = [
    { season_number: 1, episode_count: 366 },
    { season_number: 2, episode_count: 50 },
  ];
  assert.equal(planEnrichment([...eps(1, 20), ...eps(2, 21), ...eps(3, 22)], bleach).length, 0, 'season missing on TMDB');
});

test('seasons shape: a partial season (not yet fully uploaded) still maps by episode number', () => {
  const plan = planEnrichment(eps(3, 4, 5), [{ season_number: 3, episode_count: 10 }]);
  assert.deepEqual(plan.map((m) => m.tmdbEpisode), [5, 6, 7, 8]);
});

test('flat shape: absolute numbering 1..N with N = TMDB total maps across seasons', () => {
  // Dragon Ball Z on TMDB: 9 seasons, 291 episodes.
  const counts = [39, 35, 33, 32, 26, 29, 25, 34, 38];
  const tmdb = counts.map((c, i) => ({ season_number: i + 1, episode_count: c }));
  const plan = planEnrichment(eps(1, 291), tmdb);
  assert.equal(plan.length, 291);
  const at = (num: number) => plan.find((m) => m.id === 1000 + num)!;
  assert.deepEqual(at(1), { id: 1001, tmdbSeason: 1, tmdbEpisode: 1 });
  assert.deepEqual(at(39), { id: 1039, tmdbSeason: 1, tmdbEpisode: 39 });
  assert.deepEqual(at(40), { id: 1040, tmdbSeason: 2, tmdbEpisode: 1 });
  assert.deepEqual(at(291), { id: 1291, tmdbSeason: 9, tmdbEpisode: 38 });
});

test('flat shape is refused when the count differs from the TMDB total or numbering has holes', () => {
  const tmdb = [
    { season_number: 1, episode_count: 39 },
    { season_number: 2, episode_count: 35 },
  ];
  assert.equal(planEnrichment(eps(1, 70), tmdb).length, 0, 'wrong total');
  const holes = eps(1, 74).filter((e) => e.num !== 10);
  assert.equal(planEnrichment(holes, tmdb).length, 0, 'hole in numbering');
  // Exactly season 1 alone is the seasons shape, not the flat one.
  assert.equal(planEnrichment(eps(1, 39), tmdb).every((m) => m.tmdbSeason === 1), true);
});

test('crossCheck: needs three comparable titles to judge; majority disagreement aborts', () => {
  assert.equal(crossCheck([{ provider: 'Episodio 1', tmdb: 'Pilot' }]), true, 'nothing comparable');
  assert.equal(
    crossCheck([
      { provider: 'Il misterioso combattente', tmdb: 'Il misterioso combattente' },
      { provider: 'Il fratello di Goku!', tmdb: 'Il Fratello di Goku' },
      { provider: "L'invincibile coppia", tmdb: 'L’invincibile coppia' },
      { provider: 'Junior gioca la sua carta', tmdb: 'Qualcos altro' },
    ]),
    true,
  );
  assert.equal(
    crossCheck([
      { provider: 'A', tmdb: 'X' },
      { provider: 'B', tmdb: 'Y' },
      { provider: 'C', tmdb: 'C' },
    ]),
    false,
  );
});
