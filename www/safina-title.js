/* Safina title cleaner: turns messy file names into short, readable titles.
 *   "The Art of War -- Sun Tzu -- 2009 -- Penguin -- 9780140455519 -- 3f2a9c…32hex -- Anna's Archive.epub"  ->  "The Art of War"
 *   "Dune_(Z-Library).pdf"                                                                                    ->  "Dune"
 *   "Movie.Name.2019.1080p.BluRay.x264-GROUP.mkv"                                                              ->  "Movie Name 2019"
 * It never throws, never returns an empty string, and never returns more than `max` characters.
 * Used for display only, so the original file is never renamed. */
(function (root) {
  'use strict';
  var MAX = 60;
  var EXT = /\.(epub|pdf|txt|docx?|html?|md|cbz|cbr|zip|mkv|mp4|m4v|avi|mov|webm|srt|vtt|ass|ssa)$/i;
  var JUNK_WORD = /(anna['’]?s[\s_-]*archive|z-?lib(?:rary)?|libgen|\bb-?ok\b|\b1lib\b|\bisbn\b|\bmd5\b)/i;
  var JUNK_BRACKET = /(anna['’]?s[\s_-]*archive|z-?lib(?:rary)?|libgen|\bb-?ok\b|\b1lib\b|\bisbn\b|\bmd5\b|retail|true[\s_-]*pdf|\bocr(?:ed)?\b|\bedition\b|\bed\.)/i;
  var HASH = /\b[a-f0-9]{20,}\b/i;
  var LONG_NUM = /\b(?:97[89][\d-]{9,14}|\d{10,13}[\dXx]?)\b/;
  // release tags in film file names: stop reading the title at the first of these
  var RELEASE = /[\s._-](?:2160p|1080p|720p|480p|4k|uhd|blu-?ray|bdrip|brrip|web-?dl|webrip|hdtv|dvdrip|hdrip|x26[45]|h\.?26[45]|hevc|xvid|aac|ac3|dts|remux|proper|repack|extended|unrated)\b/i;

  function cut(t, max) {
    if (t.length <= max) return t;
    var s = t.slice(0, max - 1), i = s.lastIndexOf(' ');
    if (i >= Math.floor(max * 0.5)) s = s.slice(0, i);
    return s.replace(/[\s\-–—,;:|.(\[]+$/, '') + '…';
  }

  function clean(input, max) {
    max = max > 4 ? max : MAX;
    var raw = input == null ? '' : String(input);
    try {
      var t = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(EXT, '').trim();
      // "A -- B -- C" is how Anna's Archive and similar sites join fields: the title is the first field
      if (/\s--\s/.test(t)) {
        var f = t.split(/\s--\s/).map(function (x) { return x.trim(); }).filter(Boolean);
        if (f.length) t = f[0];
      } else if (/\s[-–—]\s.*\s[-–—]\s/.test(t) && (JUNK_WORD.test(t) || HASH.test(t) || LONG_NUM.test(t))) {
        var g = t.split(/\s[-–—]\s/).map(function (x) { return x.trim(); }).filter(Boolean);
        if (g.length) t = g[0];
      }
      // dots / underscores used as spaces (not decimals, not initials like "J.K.")
      if (!/\s/.test(t) && /[._]/.test(t)) t = t.replace(/[._]+/g, ' ');
      t = t.replace(/_+/g, ' ');
      // bracketed junk: "(Z-Library)", "[isbn 978…]", "(2nd Edition, Retail)"
      t = t.replace(/\s*[\[(][^\])]*[\])]/g, function (m) { return JUNK_BRACKET.test(m) || HASH.test(m) || LONG_NUM.test(m) ? '' : m; });
      // anything after a hash, an ISBN, or a known site name is metadata
      var m1 = t.search(HASH); if (m1 > 0) t = t.slice(0, m1);
      var m2 = t.search(LONG_NUM); if (m2 > 0) t = t.slice(0, m2);
      var m3 = t.search(new RegExp('[\\s\\-–—,;:|]*' + JUNK_WORD.source, 'i')); if (m3 > 0) t = t.slice(0, m3);
      var m4 = t.search(RELEASE); if (m4 > 0) t = t.slice(0, m4);
      t = t.replace(/\s+/g, ' ').replace(/^[\s\-–—,;:|._(\[]+|[\s\-–—,;:|._)\]]+$/g, '');
      if (!t) t = raw.replace(EXT, '').replace(/[\s._-]+/g, ' ').trim();
      if (!t) return 'Untitled';
      return cut(t, max);
    } catch (_) {
      return cut(raw.trim() || 'Untitled', max);
    }
  }

  var api = { clean: clean, MAX: MAX };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SafinaTitle = api;
})(typeof window !== 'undefined' ? window : globalThis);
