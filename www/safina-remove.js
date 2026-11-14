/* Safina remove: take a film, show, book or comic out of the library.
 *   SAFINA_RM.ask({title,text,ok})   a small dark confirm sheet (resolves true / false)
 *   SAFINA_RM.remove(kind, tile)     kind is "MOVIE" | "TV" | "BOOK" | "COMIC"; tile is the library item object
 * Books and comics carry their own tile.remove(). Films and shows live in the library database (IndexedDB "safina",
 * written by safina-library.js), so this reads it the same way the library does: the library lists items by creation time,
 * one tile per show and one tile per movie, and the tile is matched by its position in that list.
 * The files you imported from your phone are never touched, only the copies Safina keeps. */
(function () {
  'use strict';
  var DB = 'safina';

  /* ---------- the confirm sheet ---------- */
  var css = '#sr{position:fixed;inset:0;z-index:100000;display:none;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.6);font-family:"Plus Jakarta Sans",system-ui,sans-serif}' +
    '#sr.on{display:flex}' +
    '#sr .p{width:min(100%,520px);box-sizing:border-box;background:#121316;color:#f1f1f3;border:1px solid rgba(255,255,255,.08);border-bottom:0;border-radius:26px 26px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom,0px))}' +
    '#sr h3{margin:0 0 8px;font:800 19px/1.25 "Plus Jakarta Sans",system-ui,sans-serif;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}' +
    '#sr p{margin:0 0 20px;font-size:14px;line-height:1.5;color:#a3a6af}' +
    '#sr .r{display:flex;gap:10px}#sr button{flex:1;height:50px;border:0;border-radius:999px;font:800 15px "Plus Jakarta Sans",system-ui,sans-serif;background:#25262b;color:#fff}' +
    '#sr button.d{background:var(--ac,#e11d2e);color:var(--on,#fff)}';
  var sheet, resolve;
  function build() {
    if (sheet || typeof document === 'undefined') return sheet;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    sheet = document.createElement('div'); sheet.id = 'sr'; sheet.setAttribute('role', 'alertdialog'); sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML = '<div class="p"><h3 id="sr-t"></h3><p id="sr-x"></p><div class="r"><button id="sr-n">Cancel</button><button id="sr-y" class="d">Remove</button></div></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) done(false); });
    sheet.querySelector('#sr-n').onclick = function () { done(false); };
    sheet.querySelector('#sr-y').onclick = function () { done(true); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheet.classList.contains('on')) done(false); });
    return sheet;
  }
  function done(v) { if (!sheet) return; sheet.classList.remove('on'); var r = resolve; resolve = null; if (r) r(v); }
  function ask(o) {
    o = o || {};
    var s = build();
    if (!s) return Promise.resolve(typeof confirm === 'function' ? confirm((o.title || '') + '\n' + (o.text || '')) : false);
    if (resolve) done(false);
    s.querySelector('#sr-t').textContent = o.title || 'Remove this?';
    s.querySelector('#sr-x').textContent = o.text || '';
    s.querySelector('#sr-y').textContent = o.ok || 'Remove';
    s.classList.add('on');
    return new Promise(function (r) { resolve = r; setTimeout(function () { var b = s.querySelector('#sr-n'); if (b) b.focus(); }, 30); });
  }

  /* ---------- the library database (same shape safina-library.js creates) ---------- */
  var dbp = null;
  function getDb() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('Storage is not available here'));
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' }).createIndex('item', 'itemId');
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('Could not open the library')); };
    }).catch(function (e) { dbp = null; throw e; });
    return dbp;
  }
  function tx(stores, mode, fn) {
    return getDb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(stores, mode), out;
        t.oncomplete = function () { res(out && typeof out === 'object' && 'result' in out ? out.result : out); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error || new Error('The change was cancelled')); };
        try { out = fn(t); } catch (e) { try { t.abort(); } catch (_) { /* already finished */ } rej(e); }
      });
    });
  }
  function dropItemFiles(t, itemId) {
    var s = t.objectStore('files'), req = s.index('item').openKeyCursor(IDBKeyRange.only(itemId));
    req.onsuccess = function () { var c = req.result; if (c) { s.delete(c.primaryKey); c.continue(); } };
  }

  /* find the stored item (and movie) behind a library tile */
  function locate(kind, tile) {
    return tx(['items'], 'readonly', function (t) { return t.objectStore('items').getAll(); }).then(function (all) {
      var items = (all || []).slice().sort(function (a, b) { return a.createdAt - b.createdAt; }), slots = [];
      items.forEach(function (it) {
        if (kind === 'TV') { if (it.type === 'tv') slots.push({ it: it }); }
        else if (it.type !== 'tv') (it.movies || []).forEach(function (m) { slots.push({ it: it, m: m }); });
      });
      // LIBD is a top-level const in the page, so it is not a property of window
      var L = (typeof LIBD !== 'undefined') ? LIBD : (window.LIBD || {});
      var arr = (kind === 'TV' ? L.shows : L.movies) || [];
      var i = arr.indexOf(tile);
      if (i < 0 || arr.length !== slots.length) throw new Error('The library changed, please try again');
      return slots[i];
    });
  }
  function removeStored(kind, tile) {
    return locate(kind, tile).then(function (hit) {
      var it = hit.it, m = hit.m;
      if (kind === 'MOVIE' && it.movies && it.movies.length > 1) {
        // one film out of a folder of films: drop just its own files and keep the rest of the item
        var ids = [m.videoId].concat((m.subs || []).map(function (s) { return s.id; })).filter(Boolean);
        it.movies = it.movies.filter(function (x) { return x.key !== m.key; });
        return tx(['items', 'files'], 'readwrite', function (t) {
          var f = t.objectStore('files'); ids.forEach(function (id) { f.delete(id); });
          t.objectStore('items').put(it);
        });
      }
      return tx(['items', 'files'], 'readwrite', function (t) { dropItemFiles(t, it.id); t.objectStore('items').delete(it.id); });
    }).then(function () {
      if (typeof window.refreshSafinaLibrary === 'function') return window.refreshSafinaLibrary();
    });
  }

  function say(t) { try { if (typeof toast === 'function') toast(t); } catch (_) { /* no toast */ } }

  function remove(kind, tile) {
    if (!tile) return Promise.resolve(false);
    var name = (window.SafinaTitle ? window.SafinaTitle.clean(tile.title) : String(tile.title || 'this'));
    var what = kind === 'BOOK' ? 'book' : kind === 'COMIC' ? 'comic' : kind === 'TV' ? 'show' : 'film';
    return ask({
      title: 'Remove “' + name + '”?',
      text: kind === 'BOOK' || kind === 'COMIC'
        ? 'This ' + what + ' will be taken out of your library, along with your place in it. The original file on your phone is not touched.'
        : 'This ' + what + ' and the copies Safina kept of its files will be taken out of your library. The original files on your phone are not touched.',
      ok: 'Remove'
    }).then(function (yes) {
      if (!yes) return false;
      return Promise.resolve(typeof tile.remove === 'function' ? tile.remove() : removeStored(kind, tile))
        .then(function () { say('Removed'); return true; })
        .catch(function (e) { say('Could not remove: ' + ((e && e.message) || e)); return false; });
    });
  }

  window.SAFINA_RM = { ask: ask, remove: remove };
})();
