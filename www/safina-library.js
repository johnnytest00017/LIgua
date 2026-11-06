/* Safina library: real import (file picker -> tree review -> IndexedDB), library tiles, show detail, playback.
 * Uses globals from index.html: parseSrt, decodeBuf, toast, nav, playLoaded, LIBD, lib.
 * Uses SafinaMatch (parsing + matching) and SafinaTree (tree HTML). */
(function () {
  'use strict';
  const SM = window.SafinaMatch, ST = window.SafinaTree;
  const el = id => document.getElementById(id);
  const esc = s => ST.esc(s);
  const pad = n => String(n).padStart(2, '0');
  if (!SM || !ST) { console.error('safina-match.js / safina-tree.js did not load'); return; }

  /* ---------------------------------------------------------------- storage */
  let dbp = null;
  function getDb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('IndexedDB is not available in this WebView'));
      const r = indexedDB.open('safina', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('items', { keyPath: 'id' });
        d.createObjectStore('files', { keyPath: 'id' }).createIndex('item', 'itemId');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('Could not open the library database'));
    }).catch(e => { dbp = null; throw e; });
    return dbp;
  }
  async function dbOp(stores, mode, fn) {
    const db = await getDb();
    return new Promise((res, rej) => {
      const t = db.transaction(stores, mode);
      let out;
      t.oncomplete = () => res(out && typeof out === 'object' && 'result' in out ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Database transaction aborted'));
      try { out = fn(t); } catch (e) { try { t.abort(); } catch (_) {} rej(e); }
    });
  }
  const friendly = e => {
    if (e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''))) return 'Not enough free storage on this phone for these files.';
    return (e && e.message) ? e.message : String(e);
  };
  const allItems = () => dbOp(['items'], 'readonly', t => t.objectStore('items').getAll());
  const getItem = id => dbOp(['items'], 'readonly', t => t.objectStore('items').get(id));
  const putItem = it => dbOp(['items'], 'readwrite', t => t.objectStore('items').put(it));
  const getFile = id => dbOp(['files'], 'readonly', t => t.objectStore('files').get(id));
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  async function putFile(itemId, role, file, written, lang) {
    const id = itemId + '/' + rid();
    await dbOp(['files'], 'readwrite', t => t.objectStore('files').put({ id, itemId, role, name: file.name, lang: lang || null, size: file.size, blob: file }));
    written.push(id);
    return id;
  }
  const delFiles = ids => ids.length ? dbOp(['files'], 'readwrite', t => { const s = t.objectStore('files'); ids.forEach(i => s.delete(i)); }) : Promise.resolve();
  const delItemFiles = itemId => dbOp(['files'], 'readwrite', t => {
    const s = t.objectStore('files'), req = s.index('item').openKeyCursor(IDBKeyRange.only(itemId));
    req.onsuccess = () => { const c = req.result; if (c) { s.delete(c.primaryKey); c.continue(); } };
  });

  /* ---------------------------------------------------------------- import state */
  const S = { entries: new Map(), overrides: {}, choices: {}, sel: new Map(), open: new Map(), busy: false, tree: null, fixedTitle: null };

  async function readEntry(file) {
    const e = { id: [file.name, file.size, file.lastModified].join('|'), name: file.name, path: file.webkitRelativePath || file.name, size: file.size, file, kind: SM.fileKind(file.name), lang: null, error: null };
    if (!file.size) { e.error = 'File is empty (0 bytes)'; return e; }
    try {
      if (e.kind === 'subtitle') {
        const cues = parseSrt(decodeBuf(await file.arrayBuffer()));
        if (!cues.length) e.error = 'No subtitle cues found. Is this a valid .srt/.vtt file?';
        else e.lang = SM.detectLanguage(cues.map(c => c.t).join(' '));
      } else {
        await file.slice(0, 2048).arrayBuffer();        // proves the picker really gave us readable bytes
      }
    } catch (err) {
      e.error = 'Could not read this file (' + (err && err.message ? err.message : err) + '). Pick it again from the file chooser.';
    }
    return e;
  }

  function status(msg, warn) {
    const s = el('safina-status');
    s.textContent = msg;
    s.className = 'mu' + (warn ? ' safina-import-warning' : '');
  }

  function treeEntries() {
    return [...S.entries.values()].filter(e => !e.error && (e.kind === 'video' || e.kind === 'subtitle'))
      .map(e => ({ id: e.id, name: e.name, path: e.path, lang: e.lang, size: e.size }));
  }
  function ignoredList() {
    const out = [];
    S.entries.forEach(e => {
      if (e.error) out.push({ name: e.name, reason: e.error });
      else if (e.kind === 'other') out.push({ name: e.name, reason: 'Unsupported file type' });
      else if (e.kind === 'book' || e.kind === 'comic') out.push({ name: e.name, reason: 'Books and comics cannot be imported yet' });
    });
    return out;
  }
  function currentTitle(tree) { return el('safina-import-title').value.trim() || (tree && tree.seriesTitle) || ''; }

  function render() {
    const box = el('safina-tree'), type = el('safina-import-type').value;
    if (!S.entries.size) {
      box.innerHTML = '';
      el('safina-pick-count').textContent = '';
      status('Choose your video and subtitle files. You can pick them in several rounds.');
      updateGo();
      return;
    }
    const tree = SM.buildTree(treeEntries(), { type, overrides: S.overrides, choices: S.choices });
    S.tree = tree;
    box.innerHTML = ST.render(tree, { sel: S.sel, open: S.open, title: currentTitle(tree) || 'Untitled', ignored: ignoredList() });
    el('safina-pick-count').textContent = S.entries.size + ' file' + (S.entries.size === 1 ? '' : 's');
    const n = ST.selection(tree, S.sel).length, total = ST.allNodes(tree).length;
    const extras = [...S.entries.values()].filter(e => !e.error && (e.kind === 'image' || e.kind === 'text')).length;
    status(n + ' of ' + total + ' ' + (type === 'tv' ? 'episode' : 'movie') + (total === 1 ? '' : 's') + ' selected' + (extras ? ' · ' + extras + ' cover/description file(s) will be attached' : '') + '.', false);
    updateGo();
  }
  function updateGo() {
    const n = S.tree && S.entries.size ? ST.selection(S.tree, S.sel).length : 0;
    const b = el('safina-import-go');
    b.disabled = S.busy || n === 0;
    b.textContent = S.busy ? 'Importing…' : (n ? 'Import ' + n + ' selected' : 'Import');
    el('safina-pick-btn').disabled = S.busy;
    el('safina-clear-btn').disabled = S.busy;
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) { status('No files were selected.', true); return; }
    let k = 0;
    for (const f of files) {
      k++;
      status('Reading file ' + k + ' of ' + files.length + ': ' + f.name);
      const e = await readEntry(f);
      S.entries.set(e.id, e);
    }
    render();
  }

  /* ---------------------------------------------------------------- tree interactions */
  function onTreeClick(ev) {
    const t = ev.target.closest('button');
    if (!t) return;
    const tree = S.tree;
    if (t.dataset.toggle) {
      S.open.set(t.dataset.toggle, t.getAttribute('aria-expanded') !== 'true');
      render();
    } else if (t.dataset.quick && tree) {
      ST.allNodes(tree).forEach(nd => {
        const on = t.dataset.quick === 'all' ? true : t.dataset.quick === 'none' ? false : (nd.status === 'matched' || nd.status === 'missing-subtitle');
        S.sel.set(nd.key, on && ST.isSelectable(nd));
      });
      render();
    } else if (t.dataset.applySeason && tree) {
      const n = parseInt(el('safina-season-fix').value, 10);
      if (!(n >= 1 && n <= 99)) { status('Enter a season number between 1 and 99.', true); return; }
      const grp = tree.seasons.find(s => s.season == null);
      if (grp) grp.episodes.forEach(e => e.videos.concat(e.subs).forEach(i => { S.overrides[i.id] = Object.assign({}, S.overrides[i.id], { season: n }); }));
      S.sel.clear();
      render();
    } else if (t.dataset.place) {
      const id = t.dataset.place, q = a => el('safina-tree').querySelector('[data-place-' + a + '="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
      const ep = parseInt(q('episode').value, 10), se = parseInt(q('season').value, 10);
      if (!(ep >= 1)) { status('Enter an episode number to place this file.', true); return; }
      S.overrides[id] = Object.assign({}, S.overrides[id], { episode: ep }, se >= 1 ? { season: se } : {});
      render();
    }
  }
  function onTreeChange(ev) {
    const t = ev.target;
    if (t.dataset.pick) { S.sel.set(t.dataset.pick, t.checked); render(); }
    else if (t.dataset.choice) {
      if (t.value) S.choices[t.dataset.choice] = t.value; else delete S.choices[t.dataset.choice];
      render();
    }
  }

  /* ---------------------------------------------------------------- import */
  async function runImport() {
    if (S.busy || !S.tree) return;
    const tree = S.tree, type = el('safina-import-type').value;
    const nodes = ST.selection(tree, S.sel);
    if (!nodes.length) { status('Nothing is selected to import.', true); return; }
    const title = currentTitle(tree);
    if (!title) { status('Enter a title for this ' + (type === 'tv' ? 'show' : 'movie') + '.', true); el('safina-import-title').focus(); return; }
    S.busy = true; updateGo();
    const written = [], replaced = [];
    let item = null, isNew = false;
    try {
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) {}
      const norm = SM.norm(title);
      item = (await allItems()).find(i => i.type === type && i.norm === norm);
      if (!item) { isNew = true; item = { id: 'it' + rid(), type, title, norm, createdAt: Date.now(), episodes: {}, movies: [] }; }
      let n = 0;
      for (const nd of nodes) {
        n++;
        const v = S.entries.get(nd.videos[0].id);
        status('Importing ' + n + ' of ' + nodes.length + ': ' + v.name + ' (' + Math.round(v.size / 1048576) + ' MB)…');
        const videoId = await putFile(item.id, 'video', v.file, written);
        const subs = [];
        for (const s of nd.subs) {
          const se = S.entries.get(s.id);
          subs.push({ id: await putFile(item.id, 'subtitle', se.file, written, s.lang), lang: s.lang || 'und', name: s.name });
        }
        const rec = { key: nd.key, season: nd.isMovie ? null : nd.season, episode: nd.isMovie ? null : nd.episode, videoId, videoName: v.name, subs };
        if (type === 'tv') {
          const old = item.episodes[nd.key];
          if (old) replaced.push(old.videoId, ...old.subs.map(s => s.id));
          item.episodes[nd.key] = rec;
        } else {
          item.movies = item.movies.filter(m => m.key !== nd.key);
          item.movies.push(rec);
        }
      }
      // optional cover + description from the same selection
      const imgs = [...S.entries.values()].filter(e => !e.error && e.kind === 'image');
      const cover = imgs.find(e => /cover|poster|folder|thumb|artwork/i.test(e.name)) || (imgs.length === 1 ? imgs[0] : null);
      if (cover) {
        if (item.posterId) replaced.push(item.posterId);
        item.posterId = await putFile(item.id, 'image', cover.file, written);
      }
      const txt = [...S.entries.values()].find(e => !e.error && e.kind === 'text');
      if (txt) { try { item.description = (await txt.file.text()).trim().slice(0, 4000); } catch (_) {} }
      await putItem(item);
      await delFiles(replaced.filter(i => !written.includes(i)));
      toast('Imported ' + nodes.length + (type === 'tv' ? ' episode' : ' movie') + (nodes.length === 1 ? '' : 's') + ' into "' + title + '"');
      resetImport();
      closeSheets();
      await refreshLibrary();
    } catch (e) {
      try { await delFiles(written); } catch (_) {}
      status('Import failed: ' + friendly(e) + ' Nothing was added to your library.', true);
    } finally {
      S.busy = false; updateGo();
    }
  }
  function resetImport() {
    S.entries.clear(); S.overrides = {}; S.choices = {}; S.sel.clear(); S.open.clear(); S.tree = null;
    el('safina-import-files').value = '';
    render();
  }

  /* ---------------------------------------------------------------- library tiles */
  const posterUrls = [];
  async function refreshLibrary() {
    const items = (await allItems()).sort((a, b) => a.createdAt - b.createdAt);
    posterUrls.splice(0).forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
    const movies = [], shows = [];
    for (const it of items) {
      let poster = null;
      if (it.posterId) { const f = await getFile(it.posterId); if (f) { poster = URL.createObjectURL(f.blob); posterUrls.push(poster); } }
      const recs = it.type === 'tv' ? Object.values(it.episodes) : it.movies;
      const has = l => recs.some(r => r.subs.some(s => s.lang === l));
      const base = { poster, ar: has('ar'), en: has('en') };
      if (it.type === 'tv') shows.push(Object.assign({ title: it.title, sub: recs.length + ' episode' + (recs.length === 1 ? '' : 's'), open: () => openShow(it.id) }, base));
      else it.movies.forEach(m => movies.push(Object.assign({}, base, { title: it.movies.length > 1 ? SM.parseName(m.videoName).series || m.videoName : it.title, sub: '', ar: m.subs.some(s => s.lang === 'ar'), en: m.subs.some(s => s.lang === 'en'), open: () => playStored(m, it.title, '') })));
    }
    LIBD.movies = movies; LIBD.shows = shows;
    lib();
  }

  /* ---------------------------------------------------------------- playback */
  async function playStored(rec, title, sub) {
    try {
      toast('Loading…');
      const vf = await getFile(rec.videoId);
      if (!vf) throw new Error('the video file is missing from app storage - import it again');
      let A = [], E = [];
      for (const s of rec.subs) {
        const sf = await getFile(s.id);
        if (!sf) continue;
        const cues = parseSrt(decodeBuf(await sf.blob.arrayBuffer()));
        const l = s.lang && s.lang !== 'und' ? s.lang : SM.detectLanguage(cues.map(c => c.t).join(' '));
        if (l === 'ar' && !A.length) A = cues; else if (l === 'en' && !E.length) E = cues;
      }
      closeSheets();
      playLoaded({ video: URL.createObjectURL(vf.blob), A, E, title, sub });
    } catch (e) { toast('Could not play: ' + friendly(e)); }
  }

  /* ---------------------------------------------------------------- show detail (read-only tree) */
  const showCtx = { id: null, recs: new Map(), item: null };
  async function openShow(id) {
    const item = await getItem(id);
    if (!item) { toast('That show is no longer in your library.'); refreshLibrary(); return; }
    showCtx.id = id; showCtx.item = item; showCtx.recs = new Map();
    const bySeason = new Map();
    Object.values(item.episodes).forEach(r => {
      showCtx.recs.set(r.key, r);
      const k = r.season == null ? '?' : r.season;
      if (!bySeason.has(k)) bySeason.set(k, []);
      bySeason.get(k).push({ key: r.key, season: r.season, episode: r.episode, videos: [{ id: r.videoId, name: r.videoName }], subs: r.subs, notes: [], conflicts: [], status: r.subs.length ? 'matched' : 'missing-subtitle' });
    });
    const seasons = [...bySeason.entries()].map(([k, eps]) => ({ season: k === '?' ? null : k, label: k === '?' ? 'Season unknown' : 'Season ' + pad(k), episodes: eps.sort((a, b) => a.episode - b.episode) }))
      .sort((a, b) => (a.season == null) - (b.season == null) || a.season - b.season);
    const tree = { type: 'tv', series: item.title, seasons, counts: {}, unparsed: [], foreign: [] };
    const panel = el('safina-show-panel');
    panel.innerHTML =
      '<div class="safina-add-title"><div><h2>' + esc(item.title) + '</h2><div class="mu">' + Object.keys(item.episodes).length + ' episodes in your library</div></div><button type="button" id="safina-show-close" aria-label="Close">✕</button></div>' +
      (item.description ? '<p class="mu safina-desc">' + esc(item.description) + '</p>' : '') +
      '<div id="safina-show-tree"></div>' +
      '<div class="safina-import-actions"><button type="button" id="safina-show-remove">Remove from library</button><button type="button" class="pri" id="safina-show-add">Add episodes</button></div>';
    const open = new Map();
    const draw = () => { el('safina-show-tree').innerHTML = ST.render(tree, { readOnly: true, playable: true, open, title: item.title }); };
    draw();
    el('safina-show-tree').onclick = ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.toggle) { open.set(b.dataset.toggle, b.getAttribute('aria-expanded') !== 'true'); draw(); }
      else if (b.dataset.play) {
        const r = showCtx.recs.get(b.dataset.play);
        playStored(r, item.title, r.season != null ? 'S' + pad(r.season) + 'E' + pad(r.episode) : '');
      }
    };
    el('safina-show-close').onclick = closeSheets;
    el('safina-show-add').onclick = () => { closeSheets(); openImport({ type: 'tv', title: item.title }); };
    el('safina-show-remove').onclick = async () => {
      if (!confirm('Remove "' + item.title + '" and its imported files from Safina? Your original files on the phone are not touched.')) return;
      try { await delItemFiles(item.id); await dbOp(['items'], 'readwrite', t => t.objectStore('items').delete(item.id)); closeSheets(); await refreshLibrary(); toast('Removed'); }
      catch (e) { toast('Could not remove: ' + friendly(e)); }
    };
    el('safina-show-sheet').classList.add('open');
  }

  /* ---------------------------------------------------------------- sheets */
  function closeSheets() { document.querySelectorAll('.safina-sheet.open').forEach(s => s.classList.remove('open')); }
  function openImport(opts) {
    opts = opts || {};
    if (opts.type) el('safina-import-type').value = opts.type;
    if (opts.title != null) el('safina-import-title').value = opts.title;
    el('safina-add-sheet').classList.add('open');
    render();
  }
  window.openImport = openImport;
  window.refreshSafinaLibrary = refreshLibrary;

  el('safina-add').addEventListener('click', () => openImport());
  el('safina-add-close').addEventListener('click', closeSheets);
  el('safina-import-cancel').addEventListener('click', closeSheets);
  document.querySelectorAll('.safina-sheet').forEach(s => s.addEventListener('click', e => { if (e.target === s) closeSheets(); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });
  el('safina-pick-btn').addEventListener('click', () => el('safina-import-files').click());
  el('safina-import-files').addEventListener('change', async e => {
    try { await addFiles(e.target.files); } catch (err) { status('Could not read the selected files: ' + friendly(err), true); }
    e.target.value = '';                       // allows picking the same file again later
  });
  el('safina-clear-btn').addEventListener('click', resetImport);
  el('safina-import-type').addEventListener('change', () => { S.sel.clear(); S.choices = {}; render(); });
  el('safina-import-title').addEventListener('input', () => { if (S.tree) el('safina-tree').querySelector('.troot .tl') && (el('safina-tree').querySelector('.troot .tl').textContent = currentTitle(S.tree) || 'Untitled'); });
  el('safina-tree').addEventListener('click', onTreeClick);
  el('safina-tree').addEventListener('change', onTreeChange);
  el('safina-import-go').addEventListener('click', runImport);

  render();
  refreshLibrary().catch(e => { console.error(e); toast('Library could not be loaded: ' + friendly(e)); });
})();
