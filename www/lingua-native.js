/* Lingua native backend: replaces server.py inside the Android/iOS app.
   - /api/status, /api/library, /api/ai are answered by this file (no server needed)
   - media folder is read through the LinguaStorage native plugin
   - phone Back button navigates inside the app */
(function () {
  'use strict';
  var cap = window.Capacitor;
  var NATIVE = !!(cap && cap.isNativePlatform && cap.isNativePlatform());

  // service worker: hosted PWA only, never inside the native app
  if ('serviceWorker' in navigator) {
    if (NATIVE) {
      navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); }).catch(function () {});
    } else if (location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }
  if (!NATIVE) return;

  function plug(n) { return (cap.Plugins && cap.Plugins[n]) || cap.registerPlugin(n); }
  function note(t) { try { if (window.toast) window.toast(t); } catch (e) {} }

  /* ---------------- Back button ---------------- */
  function G(id) { return document.getElementById(id); }
  function lpBack() {
    var sh = document.querySelector('.sheet');
    if (sh) { sh.remove(); return true; }
    var d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return true; }
    var C = G('cinema');
    if (C && C.classList.contains('pfs')) { C.classList.remove('pfs'); return true; }
    var watch = G('watch');
    if (watch && watch.classList.contains('show')) {
      if (C && C.classList.contains('open')) { closePanel(); return true; }
      nav('library'); return true;
    }
    var se = G('search');
    if (se && se.classList.contains('show')) {
      if (P !== null) { G('bk').click(); return true; }   // video -> feed -> platforms
      nav('library'); return true;
    }
    var ca = G('cards');
    if (ca && ca.classList.contains('show')) {
      var hub = G('pane-hub');
      if (hub && hub.style.display === 'none') { pane('hub'); return true; }
      nav('library'); return true;
    }
    var pr = G('profile');
    if (pr && pr.classList.contains('show')) { nav('library'); return true; }
    return false;   // already on the home screen
  }
  window.lpBack = lpBack;
  try {
    var AppP = plug('App');
    AppP.addListener('backButton', function () {
      var handled = false;
      try { handled = lpBack(); } catch (e) { handled = false; }
      if (!handled) AppP.exitApp();
    });
    AppP.addListener('resume', function () { if (window.lpRescan) window.lpRescan(); });
  } catch (e) { console.warn('App plugin missing', e); }

  /* ---------------- Media library (port of server.py scan_*) ---------------- */
  var ROOT_DEFAULT = '/storage/emulated/0/Media';
  function root() { try { return (localStorage.getItem('lp_media_root') || ROOT_DEFAULT).replace(/\/+$/, ''); } catch (e) { return ROOT_DEFAULT; } }
  var VID = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v']);
  var SUBX = new Set(['.srt', '.vtt']);
  var IMGX = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  var AR = new Set(['ar', 'ara', 'arabic', 'عربي', 'العربية']);
  var EN = new Set(['en', 'eng', 'english']);
  var POSTER = ['poster', 'cover', 'folder', 'thumb', 'thumbnail'];
  var BACKDROP = ['backdrop', 'background', 'banner', 'fanart'];
  var INFO = ['info.txt', 'description.txt', 'about.txt'];

  function ext(n) { var i = n.lastIndexOf('.'); return i > 0 ? n.slice(i).toLowerCase() : ''; }
  function stem(n) { var i = n.lastIndexOf('.'); return i > 0 ? n.slice(0, i) : n; }
  function base(r) { return r.slice(r.lastIndexOf('/') + 1); }
  function dirOf(r) { var i = r.lastIndexOf('/'); return i < 0 ? '' : r.slice(0, i); }
  function withExt(r, e) { var i = r.lastIndexOf('.'); return (i > 0 && i > r.lastIndexOf('/') ? r.slice(0, i) : r) + e; }
  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  function enc(s) { return encodeURIComponent(s).replace(/[!'()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }); }
  function urlOf(rel) { return cap.convertFileSrc(root() + '/' + rel.split('/').map(enc).join('/')); }
  function cmpPath(a, b) {
    var x = a.split('/'), y = b.split('/'), n = Math.min(x.length, y.length);
    for (var i = 0; i < n; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; }
    return x.length - y.length;
  }

  var all = [], set = Object.create(null), kids = new Map(), txt = Object.create(null);
  function build(list) {
    all = list.slice().sort(cmpPath); set = Object.create(null); kids = new Map(); txt = Object.create(null);
    all.forEach(function (r) {
      set[r] = 1;
      var p = r.split('/'), d = '';
      for (var i = 0; i < p.length; i++) {
        var isDir = i < p.length - 1, k = kids.get(d);
        if (!k) { k = new Map(); kids.set(d, k); }
        if (!k.has(p[i]) || isDir) k.set(p[i], isDir);
        d = d ? d + '/' + p[i] : p[i];
      }
    });
  }
  function entries(dirRel) {
    var k = kids.get(dirRel); if (!k) return [];
    var out = []; k.forEach(function (isDir, name) { out.push({ name: name, isDir: isDir }); });
    return out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  }
  function filesIn(folder, exts) {
    var pre = folder + '/';
    return all.filter(function (r) { return r.indexOf(pre) === 0 && exts.has(ext(r)); });
  }

  function lang(name) {
    var st = stem(name).toLowerCase();
    var hit = null;
    AR.forEach(function (a) { if (!hit && /[^\x00-\x7f]/.test(a) && st.indexOf(a) >= 0) hit = 'ar'; });
    if (hit) return hit;
    var t = st.match(/[a-z]+/g) || [];
    for (var i = 0; i < t.length; i++) { if (AR.has(t[i])) return 'ar'; if (EN.has(t[i])) return 'en'; }
    return null;
  }
  function epOf(name) {
    var s = stem(name);
    var m = /s(\d{1,3})e(\d{1,3})/i.exec(s) || /\b(\d{1,2})x(\d{1,3})\b/i.exec(s);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
    m = /^\s*(\d{1,3})(?!\d)/.exec(s) || /(?:episode|ep)[\s._-]*(\d{1,3})/i.exec(s) || /(\d{1,3})(?![\s\S]*\d)/.exec(s);
    return m ? [null, parseInt(m[1], 10)] : [null, null];
  }
  function trimSep(s) { return s.replace(/^[ \-–—·]+|[ \-–—·]+$/g, ''); }
  function epName(fname, show, ep) {
    var s = stem(fname);
    s = s.replace(/\bs\d{1,3}e\d{1,3}\b|\b\d{1,2}x\d{1,3}\b|\b(?:episode|ep)[\s._-]*\d{1,3}\b/gi, ' ');
    s = s.replace(/[._]+/g, ' ');
    s = s.replace(/^\s*\d{1,3}(?!\d)[\s\-–—·.)_]*/, '');
    s = s.replace(/\b(?:2160p|1080p|720p|480p|x264|x265|h264|hevc|web[- ]?dl|webrip|bluray|brrip|hdtv)\b.*$/i, '');
    s = trimSep(s.replace(/\s+/g, ' ').trim());
    if (s.toLowerCase().indexOf(show.toLowerCase()) === 0) s = trimSep(s.slice(show.length));
    return (!s || /^\d+$/.test(s)) ? 'Episode ' + ep : s;
  }
  function pick(subs) {
    var out = { ar: '', en: '' };
    subs.forEach(function (s) {
      var l = lang(base(s));
      if (l && !out[l]) {
        out[l] = urlOf(s);
        if (l === 'ar') {
          var d = dirOf(s), lx = (d ? d + '/' : '') + stem(base(s)) + '.lingua.json';
          if (set[lx]) out.lx = urlOf(lx);
        }
      }
    });
    return out;
  }
  function parseInfo(t, title) {
    t = t.trim();
    var m = /^\s*(?:title|name)\s*[: ：]\s*(.+?)\s*$/im.exec(t);
    var d = /(?:^|\n)\s*(?:description|desc|overview|plot)\s*[:：]\s*([\s\S]+)$/i.exec(t);
    if (m || d) return [m ? m[1] : title, d ? norm(d[1]) : ''];
    if (!t) return [title, ''];
    var lines = t.split(/\r\n|\r|\n/);
    return [(lines[0].trim() || title), norm(lines.slice(1).join(' '))];
  }
  function catalogue(folder, title) {
    var out = { title: title, desc: '', poster: '', backdrop: '' };
    var k = kids.get(folder); if (!k) return out;
    var items = Object.create(null), imgs = Object.create(null);
    k.forEach(function (isDir, name) {
      if (isDir) return;
      items[name.toLowerCase()] = folder + '/' + name;
      if (IMGX.has(ext(name))) imgs[stem(name).toLowerCase()] = folder + '/' + name;
    });
    var p = null, b = null, i;
    for (i = 0; i < POSTER.length; i++) if (imgs[POSTER[i]]) { p = imgs[POSTER[i]]; break; }
    if (!p) {
      var ks = Object.keys(imgs).sort();
      for (i = 0; i < ks.length; i++) if (BACKDROP.indexOf(ks[i]) < 0) { p = imgs[ks[i]]; break; }
    }
    for (i = 0; i < BACKDROP.length; i++) if (imgs[BACKDROP[i]]) { b = imgs[BACKDROP[i]]; break; }
    if (p) out.poster = urlOf(p);
    if (b) out.backdrop = urlOf(b);
    for (i = 0; i < INFO.length; i++) if (items[INFO[i]]) {
      var r = parseInfo(txt[items[INFO[i]]] || '', title); out.title = r[0]; out.desc = r[1]; break;
    }
    return out;
  }
  function looseCatalogue(rel, sib) {
    var nm = base(rel), st = stem(nm).toLowerCase();
    var out = { title: stem(nm), desc: '', poster: '', backdrop: '' };
    var IE = ['.jpg', '.jpeg', '.png', '.webp'];
    for (var i = 0; i < IE.length; i++) if (sib[st + IE[i]]) { out.poster = urlOf(sib[st + IE[i]]); break; }
    if (sib[st + '.txt']) { var r = parseInfo(txt[sib[st + '.txt']] || '', stem(nm)); out.title = r[0]; out.desc = r[1]; }
    return out;
  }
  function scanMovies() {
    var res = [], R = 'Movies';
    if (!kids.has(R)) return res;
    var ent = entries(R), sib = Object.create(null);
    ent.forEach(function (e) { if (!e.isDir) sib[e.name.toLowerCase()] = R + '/' + e.name; });
    ent.forEach(function (e) {
      var rel = R + '/' + e.name, vids, subs, cat;
      if (e.isDir) vids = filesIn(rel, VID); else vids = VID.has(ext(e.name)) ? [rel] : [];
      if (!vids.length) return;
      if (e.isDir) {
        subs = filesIn(rel + '/Subtitles', SUBX); if (!subs.length) subs = filesIn(rel, SUBX);
        cat = catalogue(rel, e.name);
      } else { subs = []; cat = looseCatalogue(rel, sib); }
      res.push(Object.assign({}, cat, { video: urlOf(vids[0]) }, pick(subs)));
    });
    return res;
  }
  function scanShows() {
    var res = [], R = 'TV Shows';
    if (!kids.has(R)) return res;
    entries(R).forEach(function (se) {
      if (!se.isDir) return;
      var show = R + '/' + se.name, cat = catalogue(show, se.name);
      var sdirs = entries(show).filter(function (x) { return x.isDir; }).map(function (x) { return show + '/' + x.name; });
      if (!sdirs.length) sdirs = [show];
      var seasons = Object.create(null);
      sdirs.forEach(function (sd) {
        var m = /(\d{1,3})/.exec(base(sd));
        var season = (m && sd !== show) ? parseInt(m[1], 10) : 1;
        var vids = filesIn(sd + '/Video', VID); if (!vids.length) vids = filesIn(sd, VID);
        var subs = filesIn(sd + '/Subtitles', SUBX); if (!subs.length) subs = filesIn(sd, SUBX);
        var idx = Object.create(null);
        subs.forEach(function (sb) {
          var r = epOf(base(sb)), s = r[0], ep = r[1];
          if (ep !== null && (s === null || s === season)) (idx[ep] = idx[ep] || []).push(sb);
        });
        vids.forEach(function (v) {
          var r = epOf(base(v)), s = r[0], ep = r[1];
          if (ep === null) return;
          var th = null, ex = ['.jpg', '.jpeg', '.png', '.webp'];
          for (var i = 0; i < ex.length; i++) if (set[withExt(v, ex[i])]) { th = withExt(v, ex[i]); break; }
          var tx = withExt(v, '.txt');
          var key = s || season;
          (seasons[key] = seasons[key] || []).push(Object.assign({
            ep: ep, name: epName(base(v), se.name, ep), video: urlOf(v),
            thumb: th ? urlOf(th) : '', desc: set[tx] ? norm(txt[tx] || '').slice(0, 400) : ''
          }, pick(idx[ep] || [])));
        });
      });
      var keys = Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; });
      if (!keys.length) return;
      var ss = keys.map(function (n) { return { n: n, eps: seasons[n].sort(function (a, b) { return a.ep - b.ep; }) }; });
      var allep = [].concat.apply([], ss.map(function (z) { return z.eps; }));
      res.push(Object.assign({}, cat, {
        ar: allep.some(function (x) { return x.ar; }) ? 1 : 0,
        en: allep.some(function (x) { return x.en; }) ? 1 : 0,
        sub: ss.length + ' season' + (ss.length === 1 ? '' : 's') + ' · ' + allep.length + ' ep',
        seasons: ss
      }));
    });
    return res;
  }

  function decodeText(buf) {
    try { if (typeof decodeBuf === 'function') return decodeBuf(buf); } catch (e) {}
    return new TextDecoder('utf-8').decode(buf);
  }
  async function preloadTxt() {
    var list = all.filter(function (r) { return ext(r) === '.txt'; }), i = 0;
    async function worker() {
      while (i < list.length) {
        var r = list[i++];
        try { var res = await fetch(urlOf(r)); txt[r] = res.ok ? decodeText(await res.arrayBuffer()) : ''; } catch (e) { txt[r] = ''; }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  }

  var asked = false, inflight = null;
  function askAccess(LS) {
    if (asked) return; asked = true;
    setTimeout(function () {
      if (confirm('Lingua needs "All files access" to read your Media folder (Movies / TV Shows).\n\nOpen settings and switch it on?')) LS.requestAccess();
    }, 800);
  }
  async function library() {
    var LS = plug('LinguaStorage');
    var acc = await LS.hasAccess();
    if (!acc.granted) { askAccess(LS); return { movies: [], shows: [] }; }
    var w = await LS.walk({ path: root() });
    if (!w.exists) { note('Media folder not found: ' + root()); return { movies: [], shows: [] }; }
    build(w.files || []);
    await preloadTxt();
    return { movies: scanMovies(), shows: scanShows() };
  }
  window.lpRescan = function () {
    return fetch('/api/library').then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.movies) { LIBD = j; lib(); }
    }).catch(function () {});
  };

  /* ---------------- AI (your own key, cloud provider) ---------------- */
  function aiCfg() { try { var c = JSON.parse(localStorage.getItem('aiCfg') || 'null'); return c && c.key ? c : null; } catch (e) { return null; } }
  window.lpAiReady = function () { return !!aiCfg(); };
  var MODELS = { gemini: 'gemini-2.5-flash', anthropic: 'claude-haiku-4-5-20251001', openai: 'gpt-4o-mini' };
  async function aiText(prompt, wantJson) {
    var c = aiCfg(); if (!c) throw new Error('no_ai');
    var model = c.model || MODELS[c.provider], r, d;
    if (c.provider === 'gemini') {
      var body = { contents: [{ parts: [{ text: prompt }] }] };
      if (wantJson) body.generationConfig = { responseMimeType: 'application/json' };
      r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(c.key),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      d = await r.json(); if (!r.ok) throw new Error((d && d.error && d.error.message) || 'Gemini HTTP ' + r.status);
      return ((d.candidates && d.candidates[0] && d.candidates[0].content.parts) || []).map(function (p) { return p.text || ''; }).join('');
    }
    if (c.provider === 'anthropic') {
      r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: model, max_tokens: 800, messages: [{ role: 'user', content: prompt }] }) });
      d = await r.json(); if (!r.ok) throw new Error((d && d.error && d.error.message) || 'Anthropic HTTP ' + r.status);
      return (d.content || []).map(function (p) { return p.text || ''; }).join('');
    }
    var ob = { model: model, messages: [{ role: 'user', content: prompt }] };
    if (wantJson) ob.response_format = { type: 'json_object' };
    r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key }, body: JSON.stringify(ob) });
    d = await r.json(); if (!r.ok) throw new Error((d && d.error && d.error.message) || 'OpenAI HTTP ' + r.status);
    return (d.choices && d.choices[0] && d.choices[0].message.content) || '';
  }

  /* ---------------- /api/* router ---------------- */
  function json(o, code) { return new Response(JSON.stringify(o), { status: code || 200, headers: { 'Content-Type': 'application/json' } }); }
  async function route(p, o) {
    if (p.pathname === '/api/status') return json({ yt: 0, ai: aiCfg() ? 1 : 0, lib: 1 });
    if (p.pathname === '/api/library') {
      if (!inflight) inflight = library().finally(function () { inflight = null; });
      return json(await inflight);
    }
    if (p.pathname === '/api/ai') {
      if (!aiCfg()) return json({ error: 'no_ai' }, 503);
      var pr = ''; try { pr = String(JSON.parse((o && o.body) || '{}').prompt || ''); } catch (e) {}
      try { return json({ text: (await aiText(pr, pr.indexOf('JSON') >= 0)).trim() }); }
      catch (e) { return json({ error: 'ai_failed' }, 502); }
    }
    return json({ error: 'not_configured' }, 501);
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (u, o) {
    var s = typeof u === 'string' ? u : (u && u.url) || '', p;
    try { p = new URL(s, location.href); } catch (e) { return realFetch(u, o); }
    if (p.origin === location.origin && p.pathname.indexOf('/api/') === 0) {
      return route(p, o).catch(function () { return json({ error: 'native_failed' }, 500); });
    }
    return realFetch(u, o);
  };
})();
