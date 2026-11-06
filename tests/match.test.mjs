import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const SM = createRequire(import.meta.url)('../www/safina-match.js');

const ep = (name) => { const p = SM.parseName(name); return [p.season, p.episode]; };
const E = (id, name, lang) => ({ id, name, path: name, lang: lang || null });
const flat = tree => tree.seasons.flatMap(s => s.episodes);
const find = (tree, season, episode) => flat(tree).find(e => e.season === season && e.episode === episode);

/* ------------------------------------------------------------------ filename formats */
test('every format required by the brief is recognised', () => {
  const cases = [
    ['Show.S01E02.mkv', [1, 2]],
    ['Show S01 E02.mkv', [1, 2]],
    ['Show.Season.1.Episode.2.mkv', [1, 2]],
    ['Show Season 1 Episode 2.mkv', [1, 2]],
    ['Show.1x02.mkv', [1, 2]],
    ['Show 1x2.mkv', [1, 2]],
    ['Show.E02.mkv', [null, 2]],
    ['Show.Ep.2.mkv', [null, 2]],
    ['Show Episode 2.mkv', [null, 2]],
    ['Episode 2.mkv', [null, 2]],
    ['Show.S1E2.mkv', [1, 2]],
    ['Show.S01-E02.mkv', [1, 2]],
    ['Show 2nd Season Episode 3.mkv', [2, 3]]
  ];
  for (const [name, want] of cases) assert.deepEqual(ep(name), want, name);
});

test('release tags, resolutions, brackets and many dots do not disturb parsing', () => {
  assert.deepEqual(ep('Show.S01E02.1080p.WEB-DL.x264-GRP.mkv'), [1, 2]);
  assert.deepEqual(ep('[Group] Show - S02E10 [1080p][AR].mkv'), [2, 10]);
  const p = SM.parseName('The.Show.Name.2019.S03E04.720p.BluRay.mkv');
  assert.deepEqual([p.season, p.episode], [3, 4]);
  assert.equal(p.series, 'The Show Name');
});

test('series title is extracted without destroying meaningful words', () => {
  assert.equal(SM.parseName('Avatar.The.Last.Airbender.S01E01.1080p.WEB-DL.mkv').series, 'Avatar The Last Airbender');
  assert.equal(SM.parseName('Avatar The Last Airbender 1x03.mkv').series, 'Avatar The Last Airbender');
});

test('resolutions and films are never mistaken for episodes', () => {
  for (const n of ['Movie.1920x1080.mkv', 'Great.Film.2019.1080p.mkv', 'Seven.Samurai.1954.mkv', 'Episode.Of.Doom.2020.mkv']) {
    assert.equal(SM.parseName(n).isEpisode, false, n);
  }
});

test('multi-episode files keep the first episode and expose the end', () => {
  const p = SM.parseName('Show.S01E02E03.mkv');
  assert.deepEqual([p.season, p.episode, p.episodeEnd], [1, 2, 3]);
});

test('subtitle language comes from the filename tag and does not leak into the title', () => {
  const a = SM.parseName('Show.S01E02.ar.srt'), b = SM.parseName('Show.S01E02.eng.srt'), c = SM.parseName('Show.S01E02.v2.ar.sdh.srt');
  assert.equal(a.lang, 'ar'); assert.equal(b.lang, 'en'); assert.equal(c.lang, 'ar');
  assert.equal(a.series, 'Show'); assert.equal(c.series, 'Show');
});

test('season comes from a folder only when the folder really says so', () => {
  const a = SM.parseName('Season 2/Show.E05.mkv');
  assert.deepEqual([a.season, a.episode, a.seasonSource], [2, 5, 'folder']);
  const b = SM.parseName('Holiday Videos/Show.E05.mkv');
  assert.equal(b.season, null);
});

test('language detection by script', () => {
  assert.equal(SM.detectLanguage('مرحبا بكم في هذا البرنامج الجميل جدا'), 'ar');
  assert.equal(SM.detectLanguage('Welcome to this very nice program'), 'en');
  assert.equal(SM.detectLanguage('12 -> 34'), null);
});

/* ------------------------------------------------------------------ matching */
test('same episode number in different seasons is never merged', () => {
  const t = SM.buildTree([
    E('v1', 'Show.S01E02.mkv'), E('s1', 'Show.S01E02.ar.srt', 'ar'),
    E('v2', 'Show.S02E02.mkv'), E('s2', 'Show.S02E02.ar.srt', 'ar')
  ], { type: 'tv' });
  assert.equal(t.seasons.length, 2);
  const a = find(t, 1, 2), b = find(t, 2, 2);
  assert.equal(a.status, 'matched'); assert.equal(b.status, 'matched');
  assert.equal(a.subs[0].id, 's1'); assert.equal(b.subs[0].id, 's2');
});

test('matched, missing subtitle and missing media are told apart', () => {
  const t = SM.buildTree([
    E('v1', 'Show.S01E01.mkv'), E('s1', 'Show.S01E01.ar.srt', 'ar'),
    E('v2', 'Show.S01E02.mkv'),
    E('s3', 'Show.S01E03.ar.srt', 'ar')
  ], { type: 'tv' });
  assert.equal(find(t, 1, 1).status, 'matched');
  assert.equal(find(t, 1, 2).status, 'missing-subtitle');
  assert.equal(find(t, 1, 3).status, 'missing-media');
});

test('Arabic and English subtitles for one episode both attach (different languages are not a conflict)', () => {
  const t = SM.buildTree([
    E('v', 'Show.S01E02.mkv'), E('a', 'Show.S01E02.ar.srt', 'ar'), E('e', 'Show.S01E02.en.srt', 'en')
  ], { type: 'tv' });
  const n = find(t, 1, 2);
  assert.equal(n.status, 'matched');
  assert.deepEqual(n.subs.map(s => s.lang).sort(), ['ar', 'en']);
});

test('two subtitles of the same language are reported as ambiguous, never auto-picked', () => {
  const entries = [
    E('v', 'Show.S01E02.mkv'),
    E('a1', 'Show.S01E02.ar.srt', 'ar'), E('a2', 'Show.S01E02.v2.ar.srt', 'ar')
  ];
  const t = SM.buildTree(entries, { type: 'tv' });
  const n = find(t, 1, 2);
  assert.equal(n.status, 'ambiguous');
  assert.equal(n.subs.length, 0);
  assert.equal(n.conflicts.length, 1);
  assert.deepEqual(n.conflicts[0].candidates.map(c => c.id).sort(), ['a1', 'a2']);
  // the user resolves it explicitly
  const key = n.key + '|sub|ar';
  const t2 = SM.buildTree(entries, { type: 'tv', choices: { [key]: 'a2' } });
  const n2 = find(t2, 1, 2);
  assert.equal(n2.status, 'matched');
  assert.equal(n2.subs[0].id, 'a2');
});

test('two videos for one episode are flagged as duplicates', () => {
  const t = SM.buildTree([E('v1', 'Show.S01E02.720p.mkv'), E('v2', 'Show.S01E02.1080p.mkv'), E('a', 'Show.S01E02.ar.srt', 'ar')], { type: 'tv' });
  assert.equal(find(t, 1, 2).status, 'duplicate');
});

test('missing season is not guessed: it goes to review', () => {
  const t = SM.buildTree([E('v', 'Show.E02.mkv'), E('a', 'Show.E02.ar.srt', 'ar')], { type: 'tv' });
  const grp = t.seasons.find(s => s.season === null);
  assert.ok(grp, 'there must be a "Season unknown" group');
  assert.equal(grp.episodes[0].status, 'review');
});

test('a missing season is inferred only when the evidence is unique, and is still flagged for review', () => {
  const t = SM.buildTree([E('v1', 'Show.S03E02.mkv'), E('a', 'Show.E02.ar.srt', 'ar')], { type: 'tv' });
  const n = find(t, 3, 2);
  assert.ok(n, 'subtitle without a season joins the only season that has episode 2');
  assert.equal(n.status, 'review');
  // ...but if episode 2 exists in two seasons the file is NOT placed anywhere
  const t2 = SM.buildTree([E('v1', 'Show.S01E02.mkv'), E('v2', 'Show.S02E02.mkv'), E('a', 'Show.E02.ar.srt', 'ar')], { type: 'tv' });
  assert.equal(find(t2, 1, 2).subs.length, 0);
  assert.equal(find(t2, 2, 2).subs.length, 0);
  assert.ok(t2.seasons.find(s => s.season === null), 'unplaced subtitle must stay in "Season unknown"');
});

test('a manual override moves a file and the tree recomputes', () => {
  const entries = [E('v', 'Show.E02.mkv'), E('a', 'Show.E02.ar.srt', 'ar')];
  const t = SM.buildTree(entries, { type: 'tv', overrides: { v: { season: 4 }, a: { season: 4 } } });
  assert.equal(find(t, 4, 2).status, 'matched');
});

test('files of another series are set aside instead of being matched', () => {
  const t = SM.buildTree([
    E('v1', 'Alpha.Show.S01E01.mkv'), E('v2', 'Alpha.Show.S01E02.mkv'), E('a1', 'Alpha.Show.S01E01.ar.srt', 'ar'),
    E('x', 'Totally.Different.S01E01.ar.srt', 'ar')
  ], { type: 'tv' });
  assert.equal(t.foreign.length, 1);
  assert.equal(t.foreign[0].item.id, 'x');
  assert.equal(find(t, 1, 1).subs.length, 1);
  assert.equal(find(t, 1, 1).subs[0].id, 'a1');
});

test('files with no episode information are listed, not dropped or guessed', () => {
  const t = SM.buildTree([E('v1', 'Show.S01E01.mkv'), E('x', 'Making.Of.Documentary.mkv')], { type: 'tv' });
  assert.equal(t.unparsed.length, 1);
  assert.equal(t.unparsed[0].item.id, 'x');
});

test('misleading filenames: shared words and release tags do not create matches', () => {
  const t = SM.buildTree([
    E('v1', 'Show.S01E01.1080p.WEB-DL.mkv'),
    E('a', 'Show.S01E05.1080p.WEB-DL.ar.srt', 'ar')      // same tags, different episode
  ], { type: 'tv' });
  assert.equal(find(t, 1, 1).subs.length, 0);
  assert.equal(find(t, 1, 5).status, 'missing-media');
});

test('movies: subtitle joins the video with the same title, otherwise it is reported as unmatched', () => {
  const t = SM.buildTree([
    E('v', 'Great.Film.2019.1080p.mkv'),
    E('a', 'Great.Film.2019.1080p.ar.srt', 'ar'), E('e', 'Great.Film.2019.1080p.en.srt', 'en'),
  ], { type: 'movie' });
  assert.equal(t.movies.length, 1);
  assert.equal(t.movies[0].status, 'matched');
  assert.equal(t.movies[0].subs.length, 2);

  const t2 = SM.buildTree([
    E('v1', 'Alpha.Film.2019.mkv'), E('v2', 'Beta.Film.2020.mkv'), E('a', 'Gamma.Film.2018.ar.srt', 'ar')
  ], { type: 'movie' });
  assert.equal(t2.unmatched.length, 1);
  assert.equal(t2.movies.every(m => m.status === 'missing-subtitle'), true);
});

test('output is deterministic: input order does not change the tree', () => {
  const entries = [
    E('v1', 'Show.S01E01.mkv'), E('v2', 'Show.S01E02.mkv'), E('v3', 'Show.S02E01.mkv'),
    E('a1', 'Show.S01E01.ar.srt', 'ar'), E('a2', 'Show.S01E02.ar.srt', 'ar'), E('a3', 'Show.S01E02.v2.ar.srt', 'ar'),
    E('e1', 'Show.S01E01.en.srt', 'en'), E('x', 'Show.E09.ar.srt', 'ar')
  ];
  const ref = JSON.stringify(SM.buildTree(entries, { type: 'tv' }));
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 25; k++) {
    const shuffled = entries.map(e => [rnd(), e]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    assert.equal(JSON.stringify(SM.buildTree(shuffled, { type: 'tv' })), ref);
  }
});

test('the Avatar scenario from the screenshots: every episode with a uniquely named subtitle matches', () => {
  const t = SM.buildTree([
    E('v1', 'Avatar.The.Last.Airbender.S01E01.1080p.WEB-DL.mkv'),
    E('v2', 'Avatar.The.Last.Airbender.S01E02.1080p.WEB-DL.mkv'),
    E('v3', 'Avatar The Last Airbender 1x03.mkv'),
    E('v4', 'Avatar.The.Last.Airbender.S02E01.mkv'),
    E('a1', 'Avatar.The.Last.Airbender.S01E01.ar.srt', 'ar'),
    E('a2', 'Avatar.The.Last.Airbender.S01E02.ar.srt', 'ar'),
    E('a3', 'Avatar Season 1 Episode 3.ar.srt', 'ar'),
    E('a4', 'Avatar.The.Last.Airbender.S02E01.ar.srt', 'ar')
  ], { type: 'tv' });
  assert.equal(t.counts.matched, 4, JSON.stringify(t.counts));
  assert.equal(t.unparsed.length, 0);
});
