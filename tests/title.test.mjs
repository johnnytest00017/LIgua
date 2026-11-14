import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { clean } = require('../www/safina-title.js');

test('Anna\'s Archive style names keep only the title', () => {
  const n = "The Art of War -- Sun Tzu -- 2009 -- Penguin Classics -- 9780140455519 -- 3f2a9c8e1b7d4a6f90c2e5d8b1a47c36 -- Anna’s Archive.epub";
  assert.equal(clean(n), 'The Art of War');
});
test('site tags, hashes and ISBNs are dropped', () => {
  assert.equal(clean('Dune_(Z-Library).pdf'), 'Dune');
  assert.equal(clean('Pride and Prejudice [isbn 9780141439518].epub'), 'Pride and Prejudice');
  assert.equal(clean('Kalila wa Dimna - Ibn al-Muqaffa - 3f2a9c8e1b7d4a6f90c2e5d8b1a47c36 - Anna\'s Archive.pdf'), 'Kalila wa Dimna');
  assert.equal(clean('Some Book - 9780140455519'), 'Some Book');
});
test('ordinary titles are left alone, including dashes and real words like Retail', () => {
  assert.equal(clean('Harry Potter - The Philosopher\'s Stone.epub'), "Harry Potter - The Philosopher's Stone");
  assert.equal(clean('Retail Therapy'), 'Retail Therapy');
  assert.equal(clean('1984'), '1984');
  assert.equal(clean('J.K. Rowling Stories'), 'J.K. Rowling Stories');
});
test('film release names become a plain title', () => {
  assert.equal(clean('Movie.Name.2019.1080p.BluRay.x264-GROUP.mkv'), 'Movie Name 2019');
  assert.equal(clean('the_big_bang_theory_s01e01_720p.mp4'), 'the big bang theory s01e01');
});
test('long titles are cut at a word, never above the limit', () => {
  const long = 'A very long title that just keeps going and going without any metadata at all so it must be shortened properly';
  const r = clean(long);
  assert.ok(r.length <= 60, r);
  assert.ok(r.endsWith('…'));
  assert.ok(!/\s…$/.test(r));
  const noSpace = 'x'.repeat(300);
  assert.ok(clean(noSpace).length <= 60);
});
test('a title that is entirely junk or empty still gives something to show', () => {
  assert.equal(clean(''), 'Untitled');
  assert.equal(clean(null), 'Untitled');
  assert.ok(clean("Anna's Archive.epub").length > 0);
  assert.equal(typeof clean({}), 'string');
});
test('Arabic titles survive', () => {
  assert.equal(clean('كليلة ودمنة -- ابن المقفع -- 2010 -- دار -- 9789771234567 -- Anna’s Archive.pdf'), 'كليلة ودمنة');
});
