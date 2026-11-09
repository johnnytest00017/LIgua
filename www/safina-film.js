/* Safina film preparation.
 *
 *   Arabic SRT  ->  translator draft (on-phone or API)  ->  AI pass (reads the Arabic AND the draft, fixes it, gives each word's
 *   meaning in its line)  ->  saved as a translated SRT on the phone  ->  shown to the user.
 *
 * It runs once per film. The result is kept in the phone's own database, keyed by the subtitle text, so opening the film again
 * (or after an update) restores it instantly and nothing is translated twice. The library cards show a progress bar while it runs.
 * Works in the browser and, with a stub database, under node for the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SafinaFilm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- small helpers */
  function hash(str, seed) { let h = seed >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
  function filmKey(cues) {
    let a = '', n = 0;
    for (const c of cues) { const t = String(c.t || '').trim(); if (!t) continue; a += (Math.round((c.s || 0) * 10)) + '|' + t + '\n'; n++; }
    return 'f' + n + '-' + hash(a, 2166136261) + hash(a, 5381);
  }
  const tcode = t => { t = Math.max(0, +t || 0); const ms = Math.round((t % 1) * 1000), s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600); const p = (n, w) => String(n).padStart(w || 2, '0'); return p(h) + ':' + p(m) + ':' + p(s) + ',' + p(ms, 3); };
  function toSrt(lines) {
    return lines.map((l, i) => (i + 1) + '\n' + tcode(l.s) + ' --> ' + tcode(l.e) + '\n' + l.t + (l.tr ? '\n' + l.tr : '')).join('\n\n') + '\n';
  }

  /* a tiny key-value store: IndexedDB when there is one, memory otherwise (tests, private mode) */
  function makeDb(name, idb) {
    const mem = { films: new Map(), map: new Map() };
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res, rej) => {
        if (!idb) return rej(new Error('no indexedDB'));
        const r = idb.open(name, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('films', { keyPath: 'key' }); r.result.createObjectStore('map', { keyPath: 'videoId' }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      }).catch(e => { dbp = null; throw e; });
      return dbp;
    }
    async function op(store, mode, fn) {
      let db; try { db = await open(); } catch (_) { return fn(null, mem[store]); }
      return new Promise((res, rej) => {
        const t = db.transaction([store], mode); let out;
        t.oncomplete = () => res(out && typeof out === 'object' && 'result' in out ? out.result : out);
        t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted'));
        try { out = fn(t.objectStore(store), null); } catch (e) { try { t.abort(); } catch (_) { /* ignore */ } rej(e); }
      });
    }
    const wrap = (store, mode, fnReal, fnMem) => op(store, mode, (os, m) => os ? fnReal(os) : fnMem(m));
    return {
      get: (store, key) => wrap(store, 'readonly', os => os.get(key), m => m.get(key)),
      put: (store, rec) => wrap(store, 'readwrite', os => os.put(rec), m => { m.set(rec.key || rec.videoId, rec); return rec; }),
      all: store => wrap(store, 'readonly', os => os.getAll(), m => [...m.values()])
    };
  }

  /* ---------------------------------------------------------------- the manager */
  function create(deps) {
    const SAI = deps.SAI, tokens = deps.tokens || (t => String(t).split(/\s+/).filter(Boolean));
    const db = deps.db || makeDb('safina-film', deps.indexedDB);
    const now = deps.now || Date.now, frame = deps.frame || (() => new Promise(r => setTimeout(r, 0)));
    const wantWords = deps.wantWords || (() => true), WORD_CAP = deps.wordCap || 600;
    const jobs = new Map(), listeners = new Set(), restored = new Set();
    const T = deps.trace || { begin() {}, end() {}, crumb() {} };

    const planLines = cues => { const seen = new Set(), out = []; for (const c of cues) { const t = String(c.t || '').trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t); } } return out; };
    function planWords(cues) {
      const seen = new Set(), out = [];
      for (const c of cues) {
        const s = String(c.t || '').trim(); if (!s) continue;
        let toks = []; try { toks = tokens(s) || []; } catch (_) { toks = []; }
        for (const w of toks) { if (seen.has(w)) continue; seen.add(w); out.push({ w, s }); }
      }
      return out.slice(0, WORD_CAP);
    }
    const aiOn = () => { try { return !!SAI.aiAvailable(); } catch (_) { return false; } };
    const lineDone = (t, upgrade) => { const e = SAI.cached(t); return !!e && (!upgrade || e.refined); };

    function emit(job, patch) {
      Object.assign(job.progress, patch);
      const p = job.progress; p.pct = p.total ? Math.min(100, Math.floor(p.done / p.total * 100)) : (p.phase === 'done' ? 100 : 0);
      job.subs.forEach(f => { try { f(p, job); } catch (_) { /* a listener must not break the job */ } });
      listeners.forEach(f => { try { f(job.key, p, job); } catch (_) { /* ignore */ } });
    }

    /* what a saved film contributes back to the working cache */
    async function restore(key) {
      if (restored.has(key)) return null;
      const rec = await db.get('films', key); if (!rec) return null;
      SAI.seed((rec.lines || []).filter(l => l.tr).map(l => ({ text: l.t, entry: { t: l.tr, d: l.d || '', m: l.m || '', refined: !!l.r, via: l.via || 'saved', draft: '' } })));
      SAI.seedWords((rec.words || []).map(w => ({ w: w.w, s: w.s, entry: { gloss: w.g, lemma: w.l || w.w, d: w.d || '', pos: w.p || '', root: '', note: '', refined: true, via: 'saved' } })));
      restored.add(key); return rec;
    }

    /* how much is still to do for this film */
    async function need(cues) {
      const key = filmKey(cues); await restore(key);
      const on = aiOn(), lines = planLines(cues), words = wantWords() && on ? planWords(cues) : [];
      return { key, lines: lines.filter(t => !lineDone(t, on)).length, words: words.filter(x => !SAI.cachedWord(x.w, x.s)).length, totalLines: lines.length, totalWords: words.length };
    }

    function build(cues, title, key) {
      const seen = new Set(), lines = [];
      for (const c of cues) {
        const t = String(c.t || '').trim(); if (!t) continue;
        const e = SAI.cached(t);
        lines.push({ s: c.s, e: c.e, t, tr: e ? e.t : '', d: e ? e.d || '' : '', m: e ? e.m || '' : '', r: !!(e && e.refined), via: e ? e.via || '' : '' });
      }
      const words = [];
      for (const x of planWords(cues)) { const e = SAI.cachedWord(x.w, x.s); if (e && !seen.has(x.w)) { seen.add(x.w); words.push({ w: x.w, s: x.s, g: e.gloss, l: e.lemma, p: e.pos, d: e.d || '' }); } }
      const translated = lines.filter(l => l.tr).length, refined = lines.filter(l => l.r).length;
      return { key, title: title || '', at: now(), total: lines.length, translated, refined, words, lines, state: translated === lines.length ? (refined === lines.length || !aiOn() ? 'done' : 'draft') : 'partial', srt: toSrt(lines) };
    }

    /* the whole pipeline for one film; joins a job that is already running for the same film */
    function ensure(cues, opts) {
      opts = opts || {};
      const key = filmKey(cues);
      let job = jobs.get(key);
      if (job) { if (opts.onProgress) { job.subs.add(opts.onProgress); try { opts.onProgress(job.progress, job); } catch (_) { /* ignore */ } } return job.promise; }
      job = { key, title: opts.title || '', abort: new AbortController(), subs: new Set(opts.onProgress ? [opts.onProgress] : []), progress: { phase: 'lines', state: 'running', done: 0, total: 0, ld: 0, lt: 0, wd: 0, wt: 0, err: '', pct: 0 } };
      jobs.set(key, job);
      job.promise = (async () => {
        const sig = job.abort.signal; let err = '';
        T.begin('film', 'preparing ' + (job.title || 'a film'));
        try {
          await restore(key);
          const on = aiOn(), lines = planLines(cues), lt = lines.length;
          const words = wantWords() && on ? planWords(cues) : [], wt = words.length;
          let ld = lines.filter(t => lineDone(t, on)).length, wd = words.filter(x => SAI.cachedWord(x.w, x.s)).length;
          emit(job, { state: 'running', phase: 'lines', ld, lt, wd, wt, done: ld + wd, total: lt + wt, err: '' });
          const bsize = deps.batch || (SAI.state && SAI.state().mtMode === 'local' ? 6 : 10);
          const need = lines.filter(t => !lineDone(t, on));
          let empty = 0, failed = false;
          const pass = async list => {
            for (let at = 0; at < list.length && !sig.aborted; at += bsize) {
              const part = list.slice(at, at + bsize);
              await SAI.prefetch(part, { max: part.length, persist: true, upgrade: true, onError: e => { err = (e && e.message) || String(e); } });
              const ok = part.filter(t => lineDone(t, on)).length;
              empty = ok ? 0 : empty + 1;
              ld = lines.filter(t => lineDone(t, on)).length;
              emit(job, { ld, done: ld + wd });
              if (empty >= 2) return false;
              await frame();
            }
            return true;
          };
          if (need.length) {
            const ok = await pass(need);
            if (ok && !sig.aborted) { const left = lines.filter(t => !lineDone(t, on)); if (left.length) await pass(left); }
            ld = lines.filter(t => lineDone(t, on)).length;
            failed = !sig.aborted && ld < lt && empty >= 2;
          }
          if (failed && !lines.some(t => SAI.cached(t))) throw new Error(err || 'Nothing could be translated.');
          if (!sig.aborted && words.length && !failed) {
            emit(job, { phase: 'words' });
            const r = await SAI.prepareWords(words, { signal: sig, onProgress: () => { wd = words.filter(x => SAI.cachedWord(x.w, x.s)).length; emit(job, { wd, done: ld + wd }); } });
            wd = words.filter(x => SAI.cachedWord(x.w, x.s)).length;
            if (r.error && r.done < r.total && !err) err = r.error;
          }
          emit(job, { phase: 'saving', ld, wd, done: ld + wd });
          try { SAI.flush(); } catch (_) { /* ignore */ }
          const rec = build(cues, job.title, key);
          if (rec.translated) await db.put('films', rec);
          const missing = lt - ld;
          emit(job, { phase: 'done', state: sig.aborted ? 'stopped' : (missing > 0 ? 'partial' : rec.state), ld, wd, done: ld + wd, err: missing > 0 && !sig.aborted ? (err || missing + ' lines could not be translated') : err, saved: rec.translated });
          return rec;
        } catch (e) {
          emit(job, { state: 'error', phase: 'done', err: (e && e.message) || String(e) });
          return null;
        } finally { jobs.delete(key); T.end('film'); }
      })();
      return job.promise;
    }

    return {
      key: filmKey, planLines, planWords, need, ensure, restore, build, toSrt,
      get: key => db.get('films', key), allFilms: () => db.all('films'),
      mapGet: id => db.get('map', id), mapPut: rec => db.put('map', rec),
      running: key => jobs.get(key) || null, stop: key => { const j = jobs.get(key); if (j) j.abort.abort(); },
      onProgress: f => { listeners.add(f); return () => listeners.delete(f); },
      exportSrt: async key => { const r = await db.get('films', key); return r ? r.srt : ''; }
    };
  }

  return { create, filmKey, toSrt, makeDb };
});

/* ====================================================================================================
 * Browser part: background preparation of every film in the library, and a progress bar on its card.
 * ==================================================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.SAI || !window.SafinaFilm) return;
  const F = window.SafinaFilm, SAI = window.SAI;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
  const MGR = F.create({
    SAI, indexedDB: window.indexedDB, trace: window.SAFINA_TRACE,
    tokens: t => (typeof window.tokens === 'function' ? window.tokens(t) : String(t).split(/\s+/)),
    wantWords: () => lsGet('safina.prep.words', '1') !== '0',
    frame: () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))
  });
  window.SAFINA_FILM = MGR;
  const bgOn = () => lsGet('safina.film.bg', '1') !== '0';

  /* ---- progress per library card ---- */
  const recs = new Map();          // videoId -> { tile, key, state, done, total, err }
  const byKey = new Map();         // film key -> videoId
  function tileState(title) {
    let done = 0, total = 0, n = 0, run = 0, queued = 0, err = '', fin = 0, draft = 0;
    recs.forEach(r => { if (r.tile !== title) return; n++; done += r.done; total += r.total; if (r.state === 'running') run++; else if (r.state === 'queued') queued++; else if (r.state === 'error' || r.state === 'partial') err = r.err || 'paused'; else if (r.state === 'draft') { fin++; draft++; } else fin++; });
    if (!n) return null;
    return { pct: total ? Math.min(100, Math.floor(done / total * 100)) : 0, running: run > 0, queued: queued > 0, err, done: fin === n && !err, draft: draft > 0, n };
  }
  function decorate() {
    const root = document.getElementById('rows'); if (!root) return;
    root.querySelectorAll('.pc').forEach(c => {
      const t = c.querySelector('.pt'), poster = c.querySelector('.poster'); if (!t || !poster) return;
      const s = tileState(t.textContent);
      let bar = poster.querySelector('.fp'), lab = poster.querySelector('.fpl');
      if (!s || (s.done && !s.draft)) {
        if (s && s.done) { if (!lab) { lab = document.createElement('span'); lab.className = 'fpl ok'; poster.appendChild(lab); } lab.textContent = '✓ Translated'; lab.className = 'fpl ok'; }
        else if (lab) lab.remove();
        if (bar) bar.remove(); return;
      }
      if (!bar) { bar = document.createElement('div'); bar.className = 'fp'; bar.innerHTML = '<i></i>'; poster.appendChild(bar); }
      if (!lab) { lab = document.createElement('span'); lab.className = 'fpl'; poster.appendChild(lab); }
      bar.firstChild.style.width = s.pct + '%';
      lab.className = 'fpl' + (s.err ? ' warn' : '');
      lab.textContent = s.err ? '⚠ Paused · ' + s.pct + '%' : s.running ? 'Translating ' + s.pct + '%' : s.queued ? 'Waiting · ' + s.pct + '%' : s.draft ? 'Draft ' + s.pct + '%' : s.pct + '%';
      if (s.err) lab.title = s.err;
    });
  }
  let dec = null; const soon = () => { if (dec) return; dec = setTimeout(() => { dec = null; try { decorate(); } catch (_) { /* ignore */ } }, 150); };
  MGR.onProgress((key, p) => {
    const id = byKey.get(key), r = id && recs.get(id); if (!r) return;
    r.done = p.done; r.total = p.total || r.total; r.state = p.state === 'running' ? 'running' : p.state === 'stopped' ? 'partial' : p.state; r.err = p.err || '';
    soon();
  });
  const css = document.createElement('style');
  css.textContent = '.pc .poster{position:relative;overflow:hidden}.pc .poster .fp{position:absolute;left:0;right:0;bottom:0;height:6px;background:rgba(0,0,0,.55);z-index:3}.pc .poster .fp i{display:block;height:100%;width:0;background:#ff293b;transition:width .25s}' +
    '.pc .poster .fpl{position:absolute;left:8px;bottom:12px;z-index:3;font:600 10.5px system-ui,sans-serif;padding:3px 8px;border-radius:99px;background:rgba(0,0,0,.72);color:#fff}.pc .poster .fpl.ok{color:#6fe3a0}.pc .poster .fpl.warn{color:#ffb86b}';
  document.head.appendChild(css);

  /* ---- read the library's own database (read only; never creates it) ---- */
  async function libItems() {
    if (!window.indexedDB) return [];
    try { if (indexedDB.databases) { const l = await indexedDB.databases(); if (!l.some(d => d.name === 'safina')) return []; } } catch (_) { /* older WebView: rely on the abort below */ }
    return new Promise(res => {
      const r = indexedDB.open('safina');
      r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (_) { /* ignore */ } };
      r.onerror = () => res([]);
      r.onsuccess = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('items') || !d.objectStoreNames.contains('files')) { d.close(); return res([]); }
        const t = d.transaction(['items', 'files'], 'readonly'), items = t.objectStore('items').getAll();
        items.onsuccess = () => res(items.result.map(it => ({ it, getFile: id => new Promise(ok => { const q = d.transaction(['files'], 'readonly').objectStore('files').get(id); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); }) })));
        items.onerror = () => res([]);
      };
    });
  }
  const tileTitle = (it, m) => (it.type === 'tv' ? it.title : (it.movies.length > 1 ? ((window.SafinaMatch && window.SafinaMatch.parseName(m.videoName).series) || m.videoName) : it.title));

  const queue = []; let working = false, scanning = false;
  async function cuesFor(rec, getFile) {
    for (const s of rec.subs || []) {
      if (s.lang && s.lang !== 'ar') continue;
      const f = await getFile(s.id); if (!f || !f.blob) continue;
      const cues = window.parseSrt(window.decodeBuf(await f.blob.arrayBuffer()));
      if (cues.length) return cues;
    }
    return null;
  }
  async function work() {
    if (working) return; working = true;
    try {
      while (queue.length) {
        const q = queue.shift(); const r = recs.get(q.videoId); if (!r) continue;
        if (!bgOn()) { r.state = 'partial'; r.err = 'Background preparation is off'; soon(); continue; }
        try {
          const cues = await cuesFor(q.rec, q.getFile); if (!cues) { r.state = 'partial'; r.err = 'No Arabic subtitles'; continue; }
          const key = MGR.key(cues); byKey.set(key, q.videoId);
          await MGR.ensure(cues, { title: q.tile });
        } catch (e) { r.state = 'error'; r.err = (e && e.message) || String(e); }
        soon();
        await new Promise(res => setTimeout(res, 300));
      }
    } finally { working = false; }
  }
  async function scan() {
    if (scanning || !bgOn()) return; scanning = true;
    try {
      const on = (() => { try { return SAI.aiAvailable(); } catch (_) { return false; } })();
      for (const { it, getFile } of await libItems()) {
        const list = it.type === 'tv' ? Object.values(it.episodes || {}) : (it.movies || []);
        for (const rec of list) {
          if (!(rec.subs || []).some(s => !s.lang || s.lang === 'ar' || s.lang === 'und')) continue;
          const tile = tileTitle(it, rec);
          let m = await MGR.mapGet(rec.videoId), cues = null;
          if (!m) { cues = await cuesFor(rec, getFile); if (!cues) continue; m = { videoId: rec.videoId, key: MGR.key(cues), total: MGR.planLines(cues).length }; await MGR.mapPut(m); }
          byKey.set(m.key, rec.videoId);
          const film = await MGR.get(m.key);
          const complete = film && (film.state === 'done' || (film.state === 'draft' && !on));
          const prev = recs.get(rec.videoId);
          if (prev && (prev.state === 'running' || prev.state === 'queued')) continue;
          recs.set(rec.videoId, { tile, key: m.key, state: complete ? (film.state === 'draft' ? 'draft' : 'done') : 'queued', done: film ? film.translated : 0, total: film ? film.total : m.total, err: '' });
          if (!complete) queue.push({ videoId: rec.videoId, rec, getFile, tile });
        }
      }
    } catch (e) { /* the library is optional */ } finally { scanning = false; soon(); work(); }
  }
  /* nothing heavy in the first seconds after the app opens */
  const bootAt = Date.now();
  let sc = null; const rescan = () => { clearTimeout(sc); sc = setTimeout(scan, Math.max(900, 15000 - (Date.now() - bootAt))); };

  /* the library redraws its cards through lib(): add the bars after every redraw, and look for new films */
  function hook() {
    if (typeof window.lib !== 'function' || window.lib.__film) return !!(window.lib && window.lib.__film);
    const orig = window.lib;
    window.lib = function () { const r = orig.apply(this, arguments); try { decorate(); } catch (_) { /* ignore */ } rescan(); return r; };
    window.lib.__film = true; return true;
  }
  let tries = 0; const iv = setInterval(() => { if (hook() || ++tries > 40) clearInterval(iv); }, 250);
  window.addEventListener('safina-ai-changed', rescan);
  setTimeout(rescan, 15000);
  window.SAFINA_FILM_SCAN = rescan;
})();
