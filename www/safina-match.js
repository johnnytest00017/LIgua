/* Safina filename parser + media/subtitle matcher.
 * Pure and deterministic. Loads as a classic <script> (window.SafinaMatch) and as a CommonJS module in Node tests.
 * Nothing here guesses silently: anything not uniquely identifiable is reported with a status and a reason. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SafinaMatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VIDEO = /\.(mp4|mkv|avi|mov|webm|m4v|ts|wmv|flv)$/i;
  const SUB = /\.(srt|vtt)$/i;
  const IMAGE = /\.(jpe?g|png|webp|gif)$/i;
  const TEXT = /\.txt$/i;
  const BOOK = /\.(pdf|epub)$/i;
  const COMIC = /\.(cbz|cbr|zip)$/i;

  function fileKind(name) {
    if (VIDEO.test(name)) return 'video';
    if (SUB.test(name)) return 'subtitle';
    if (IMAGE.test(name)) return 'image';
    if (TEXT.test(name)) return 'text';
    if (BOOK.test(name)) return 'book';
    if (COMIC.test(name)) return 'comic';
    return 'other';
  }

  const baseName = p => String(p).replace(/\\/g, '/').split('/').pop();
  const dirParts = p => String(p).replace(/\\/g, '/').split('/').slice(0, -1).filter(Boolean);
  const stripExt = n => n.replace(/\.[A-Za-z0-9]{1,5}$/, '');

  const LANGS = { ar: 'ar', ara: 'ar', arabic: 'ar', en: 'en', eng: 'en', english: 'en' };
  const LANG_TAIL = /[ ._\-\[(]+(ar|ara|arabic|en|eng|english)(?:[ ._\-](?:hi|sdh|cc|forced))?[\])]*$/i;

  const TAG_CUT = /(?:^|\s)(?:480p|576p|720p|1080p|1440p|2160p|4k|uhd|bluray|blu ray|bdrip|brrip|webrip|web dl|webdl|web|hdtv|dvdrip|hdrip|x264|x265|h264|h265|hevc|avc|aac|ac3|dts|ddp5|10bit|remux|proper|repack|extended|unrated|multi|dual)(?=\s|$)/i;

  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();

  function cleanTitle(s) {
    let t = String(s || '').replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ');
    const cut = t.search(TAG_CUT);
    if (cut > 0) t = t.slice(0, cut);
    t = t.replace(/\s+(?:19|20)\d{2}\s*$/, '');                 // trailing year, only after other words
    return t.replace(/[\s\-–—:,;]+$/g, '').replace(/^[\s\-–—:,;]+/, '').replace(/\s+/g, ' ').trim();
  }

  // season, episode patterns in priority order; each returns [season|null, episode, index, endEpisode|null]
  const PATTERNS = [
    // S01E02, S1E2, S01 E02, S01-E02, S01.E02, S01E02E03, S01E02-E03 (multi-episode needs an explicit E)
    [/(?<![a-z0-9])s(\d{1,2})\s*[-x ]?\s*e(?:p)?\s*(\d{1,3})(?:\s*-?\s*e(\d{1,3}))?(?![0-9])/i, m => [+m[1], +m[2], m[3] ? +m[3] : null]],
    // Season 1 Episode 2 / Season 1 Ep 2 / Season 1 E2
    [/(?<![a-z0-9])season\s*(\d{1,2})\s*[-,]?\s*(?:episode|ep|e)\s*(\d{1,3})(?![0-9])/i, m => [+m[1], +m[2], null]],
    // 2nd Season Episode 3
    [/(?<![a-z0-9])(\d{1,2})(?:st|nd|rd|th)\s+season\s+(?:episode|ep|e)\s*(\d{1,3})(?![0-9])/i, m => [+m[1], +m[2], null]],
    // 1x02 / 1x2 (never resolutions such as 1920x1080: the lookbehind forbids a digit before the first number)
    [/(?<![a-z0-9])(\d{1,2})x(\d{1,3})(?![a-z0-9])/i, m => [+m[1], +m[2], null]],
    // Episode 2 / Ep 2 / Ep.2 / E02 (season unknown)
    [/(?<![a-z0-9])(?:episodes?|ep)\s*(\d{1,3})(?![a-z0-9])/i, m => [null, +m[1], null]],
    [/(?<![a-z0-9])e(\d{1,3})(?![a-z0-9])/i, m => [null, +m[1], null]]
  ];
  const SEASON_ONLY = /(?<![a-z0-9])season\s*(\d{1,2})(?![0-9])/i;

  function seasonFromFolders(path) {
    const dirs = dirParts(path);
    for (let i = dirs.length - 1; i >= 0; i--) {
      const d = dirs[i].trim();
      let m = d.match(/^season[\s._\-]*(\d{1,2})$/i) || d.match(/^s(\d{1,2})$/i) || d.match(/^series[\s._\-]*(\d{1,2})$/i);
      if (m) return +m[1];
    }
    return null;
  }

  function parseName(nameOrPath) {
    const raw = String(nameOrPath);
    const file = baseName(raw);
    const kind = fileKind(file);
    let stem = stripExt(file);
    let lang = null;
    if (kind === 'subtitle') {
      // strip up to two trailing language/flag tags (".ar.sdh.srt")
      for (let k = 0; k < 2; k++) {
        const m = stem.match(LANG_TAIL);
        if (!m) break;
        if (!lang) lang = LANGS[m[1].toLowerCase()];
        stem = stem.slice(0, m.index);
      }
    }
    const text = stem.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
    let season = null, episode = null, episodeEnd = null, idx = -1;
    for (const [re, pick] of PATTERNS) {
      const m = re.exec(text);
      if (m) { [season, episode, episodeEnd] = pick(m); idx = m.index; break; }
    }
    let seasonSource = season != null ? 'name' : null;
    if (episode == null) {
      const so = SEASON_ONLY.exec(text);
      if (so) { season = +so[1]; idx = so.index; seasonSource = 'name'; }
    }
    if (season == null && episode != null) {
      const f = seasonFromFolders(raw);
      if (f != null) { season = f; seasonSource = 'folder'; }
    }
    const series = cleanTitle(idx >= 0 ? text.slice(0, idx) : text);
    return {
      raw, file, kind, lang, series, seriesKey: norm(series),
      season, episode, episodeEnd, seasonSource,
      isEpisode: episode != null,
      titleKey: norm(cleanTitle(text))
    };
  }

  // Arabic vs Latin script, from subtitle text
  function detectLanguage(text) {
    const sample = String(text || '').replace(/<[^>]+>|\d+|[:\->,.]/g, ' ').slice(0, 20000);
    const ar = (sample.match(/[؀-ۿ]/g) || []).length;
    const la = (sample.match(/[A-Za-z]/g) || []).length;
    if (ar + la < 10) return null;
    return ar >= la ? 'ar' : 'en';
  }

  const compat = (a, b) => !a || !b || a === b || a.includes(b) || b.includes(a);

  function dominantSeries(parsed) {
    const c = new Map();
    parsed.forEach(p => { if (p.seriesKey) c.set(p.seriesKey, (c.get(p.seriesKey) || 0) + 1); });
    let best = '', n = 0;
    [...c.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([k, v]) => { if (v > n) { best = k; n = v; } });
    return best;
  }

  const STATUS_ORDER = ['matched', 'missing-subtitle', 'missing-media', 'ambiguous', 'duplicate', 'review'];
  function tally(list) {
    const c = {};
    STATUS_ORDER.forEach(k => { const n = list.filter(x => x.status === k).length; if (n) c[k] = n; });
    return c;
  }

  const pad = n => String(n).padStart(2, '0');

  /**
   * entries: [{id, name, path?, lang?}]   (lang = language detected from content, optional)
   * opts:    {type:'tv'|'movie', overrides:{[id]:{season,episode}}, choices:{[choiceKey]:id}}
   */
  function buildTree(entries, opts) {
    opts = opts || {};
    const overrides = opts.overrides || {};
    const choices = opts.choices || {};
    const items = entries.map(e => {
      const p = parseName(e.path || e.name);
      const o = overrides[e.id];
      if (o) {
        if (o.season !== undefined) { p.season = o.season; p.seasonSource = o.season == null ? null : 'user'; }
        if (o.episode !== undefined) { p.episode = o.episode; p.isEpisode = o.episode != null; }
      }
      return { id: e.id, name: e.name, size: e.size, kind: p.kind, p, lang: e.lang || p.lang || null };
    });
    // Determinism: the tree must not depend on the order the picker returned the files in.
    // Plain code-unit comparison (not localeCompare) so every device gives the same result.
    items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const videos = items.filter(i => i.kind === 'video');
    const subs = items.filter(i => i.kind === 'subtitle');
    const others = items.filter(i => !['video', 'subtitle'].includes(i.kind));
    return opts.type === 'movie' ? movieTree(videos, subs, others, choices) : tvTree(videos, subs, others, choices);
  }

  function tvTree(videos, subs, others, choices) {
    const eps = [...videos, ...subs];
    const dom = dominantSeries(eps.map(i => i.p).filter(p => p.isEpisode));
    const foreign = [], unparsed = [], pool = [];
    eps.forEach(i => {
      if (!i.p.isEpisode) unparsed.push({ item: i, reason: i.p.season != null ? 'Season pack / no episode number' : 'No season or episode number found' });
      else if (!compat(i.p.seriesKey, dom)) foreign.push({ item: i, reason: 'Filename names a different series: "' + i.p.series + '"' });
      else pool.push(i);
    });

    const knownSeasonsFor = new Map();            // episode number -> Set(seasons)
    pool.forEach(i => {
      if (i.p.season == null) return;
      if (!knownSeasonsFor.has(i.p.episode)) knownSeasonsFor.set(i.p.episode, new Set());
      knownSeasonsFor.get(i.p.episode).add(i.p.season);
    });

    const nodes = new Map();
    const node = (season, episode) => {
      const key = (season == null ? '?' : season) + ':' + episode;
      if (!nodes.has(key)) nodes.set(key, { key, season, episode, videos: [], subs: [], notes: [], inferred: false });
      return nodes.get(key);
    };
    pool.forEach(i => {
      let s = i.p.season, inferred = false;
      const n0 = [];
      if (s == null) {
        const cand = knownSeasonsFor.get(i.p.episode);
        if (cand && cand.size === 1) { s = [...cand][0]; inferred = true; }
        else if (cand && cand.size > 1) n0.push('Episode ' + i.p.episode + ' exists in seasons ' + [...cand].sort((a, b) => a - b).join(', ') + ' - choose the season');
      }
      const nd = node(s, i.p.episode);
      if (inferred) { nd.inferred = true; nd.notes.push('Season taken from other files with the same episode number: ' + i.name); }
      n0.forEach(t => nd.notes.push(t));
      (i.kind === 'video' ? nd.videos : nd.subs).push(i);
    });

    const list = [...nodes.values()];
    list.forEach(nd => {
      // user choices resolve duplicates / ambiguity explicitly
      const vChoice = choices[nd.key + '|video'];
      if (nd.videos.length > 1 && vChoice != null) {
        const pick = nd.videos.find(v => v.id === vChoice);
        if (pick) { nd.unusedVideos = nd.videos.filter(v => v !== pick); nd.videos = [pick]; }
      }
      const byLang = new Map();
      nd.subs.forEach(s => { const l = s.lang || 'und'; if (!byLang.has(l)) byLang.set(l, []); byLang.get(l).push(s); });
      const kept = [], conflicts = [];
      [...byLang.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([lang, arr]) => {
        if (arr.length === 1) { kept.push(arr[0]); return; }
        const pick = arr.find(s => s.id === choices[nd.key + '|sub|' + lang]);
        if (pick) { kept.push(pick); (nd.unusedSubs = nd.unusedSubs || []).push(...arr.filter(s => s !== pick)); }
        else { conflicts.push({ lang, candidates: arr }); }
      });
      nd.subs = kept; nd.conflicts = conflicts;
      nd.videos.sort((a, b) => a.name.localeCompare(b.name));
      nd.subs.sort((a, b) => a.name.localeCompare(b.name));

      if (nd.season == null) { nd.status = 'review'; nd.notes.push('Season unknown - not guessed'); }
      else if (nd.videos.length > 1) { nd.status = 'duplicate'; nd.notes.push(nd.videos.length + ' video files for this episode'); }
      else if (conflicts.length) { nd.status = 'ambiguous'; conflicts.forEach(c => nd.notes.push(c.candidates.length + ' ' + (c.lang === 'und' ? '' : c.lang.toUpperCase() + ' ') + 'subtitles for this episode')); }
      else if (nd.inferred) nd.status = 'review';
      else if (!nd.videos.length) nd.status = 'missing-media';
      else if (!nd.subs.length) nd.status = 'missing-subtitle';
      else nd.status = 'matched';
      if (nd.status === 'review' && !nd.videos.length && nd.season != null) nd.notes.push('No video for this episode');
    });

    const bySeason = new Map();
    list.forEach(nd => {
      const k = nd.season == null ? '?' : nd.season;
      if (!bySeason.has(k)) bySeason.set(k, []);
      bySeason.get(k).push(nd);
    });
    const seasons = [...bySeason.entries()].map(([k, arr]) => ({
      season: k === '?' ? null : k,
      label: k === '?' ? 'Season unknown' : 'Season ' + pad(k),
      episodes: arr.sort((a, b) => a.episode - b.episode)
    })).sort((a, b) => (a.season == null) - (b.season == null) || (a.season - b.season));

    const counts = tally(list);
    const names = eps.filter(i => i.p.isEpisode && i.p.seriesKey === dom && i.p.series).map(i => i.p.series).sort();
    return { type: 'tv', series: dom, seriesTitle: names[0] || '', seasons, unparsed, foreign, others, counts };
  }

  function movieTree(videos, subs, others, choices) {
    const movies = videos.map(v => ({ key: 'm:' + v.id, video: v, subs: [], notes: [] }));
    const unmatched = [];
    subs.forEach(s => {
      const sk = s.p.titleKey;
      const hits = movies.filter(m => m.video.p.titleKey === sk || (sk && m.video.p.titleKey.startsWith(sk)) || (sk && sk.startsWith(m.video.p.titleKey) && m.video.p.titleKey));
      if (hits.length === 1) hits[0].subs.push(s);
      else if (!hits.length && movies.length === 1 && compat(s.p.titleKey, movies[0].video.p.titleKey)) movies[0].subs.push(s);
      else unmatched.push({ item: s, reason: hits.length > 1 ? 'Matches several movies' : 'No video with a matching title' });
    });
    movies.forEach(m => {
      const byLang = new Map();
      m.subs.forEach(s => { const l = s.lang || 'und'; if (!byLang.has(l)) byLang.set(l, []); byLang.get(l).push(s); });
      const kept = []; m.conflicts = [];
      [...byLang.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([lang, arr]) => {
        if (arr.length === 1) kept.push(arr[0]);
        else {
          const pick = arr.find(s => s.id === choices[m.key + '|sub|' + lang]);
          if (pick) kept.push(pick); else m.conflicts.push({ lang, candidates: arr });
        }
      });
      m.subs = kept;
      m.status = m.conflicts.length ? 'ambiguous' : !m.subs.length ? 'missing-subtitle' : 'matched';
      if (m.conflicts.length) m.notes.push('Several subtitles of the same language');
    });
    movies.sort((a, b) => a.video.name.localeCompare(b.video.name));
    const counts = tally(movies);
    return { type: 'movie', seriesTitle: movies.length === 1 ? movies[0].video.p.series : '', movies, unmatched, others, counts, unparsed: [], foreign: [], seasons: [] };
  }

  return { parseName, fileKind, detectLanguage, buildTree, norm, seasonFromFolders };
});
