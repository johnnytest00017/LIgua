/* Safina "get the subtitles ready first".
 * Translating a line on the phone takes real work and, done while the film plays, makes the video and the time bar stutter.
 * So when a film with subtitles is opened, every line (and, if wanted, every word) is translated up front, with a progress bar,
 * and saved on the phone. Playing afterwards only reads what was saved. */
(function () {
  'use strict';
  const SAI = window.SAI;
  if (!SAI) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));   // let the screen paint between jobs
  const WORDS_KEY = 'safina.prep.words', WORD_CAP = 600;

  const css = document.createElement('style');
  css.textContent = '#sp{position:fixed;inset:0;z-index:99900;display:none;align-items:center;justify-content:center;background:rgba(8,8,10,.94);color:#fff;font-family:system-ui,sans-serif;padding:12px;overflow:auto;-webkit-user-select:none;user-select:none}#sp.on{display:flex}' +
    '#sp .c{width:min(440px,100%);text-align:center}#sp b.t{font-size:17px;display:block;margin-bottom:4px}#sp .m{opacity:.7;font-size:12.5px;line-height:1.45}' +
    '#sp .r{margin:12px 0 0;text-align:left;font-size:12.5px}#sp .r div.l{display:flex;justify-content:space-between;margin-bottom:4px}' +
    '#sp .bar{height:8px;border-radius:99px;background:rgba(255,255,255,.14);overflow:hidden}#sp .bar i{display:block;height:100%;width:0;background:#ff293b;border-radius:99px;transition:width .2s}#sp .bar i.ok{background:#2fb86b}' +
    '#sp .row{display:flex;gap:8px;margin-top:14px}#sp button{flex:1;padding:11px 8px;border-radius:11px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:#fff;font:600 13.5px system-ui,sans-serif}#sp button.p{background:#ff293b;border-color:#ff293b}' +
    '#sp label{display:flex;gap:8px;align-items:center;justify-content:center;margin-top:12px;font-size:12.5px;opacity:.9}#sp .e{color:#ff8a8a;font-size:12.5px;margin-top:10px}#sp .ok{color:#6fe3a0}';
  document.head.appendChild(css);

  let box = null;
  function overlay() {
    if (box && box.isConnected) return box;
    if (!document.body) return null;
    box = document.createElement('div'); box.id = 'sp'; document.body.appendChild(box);
    box.addEventListener('click', e => { e.stopPropagation(); const a = e.target.closest('[data-sp]'); if (a) act(a.dataset.sp); });
    box.addEventListener('change', e => { if (e.target.id === 'sp-words') lsSet(WORDS_KEY, e.target.checked ? '1' : '0'); });
    box.addEventListener('pointerdown', e => e.stopPropagation());
    return box;
  }

  const st = { running: false, key: '', abort: null, view: null, guard: false };
  const wantWords = () => lsGet(WORDS_KEY, '1') !== '0';
  const vid = () => $('v');
  const guard = () => { if (st.guard) { try { vid().pause(); } catch (_) { /* ignore */ } } };
  function holdVideo(on) { st.guard = on; window.SAFINA_PREP_BUSY = on; const v = vid(); if (v) { if (on) { v.pause(); v.addEventListener('play', guard); } else v.removeEventListener('play', guard); } }

  function lineList() {
    const out = [], seen = new Set(), n = AR.length, from = Math.max(0, (function () { try { return idxAt(vid().currentTime); } catch (_) { return 0; } })());
    for (let k = 0; k < n; k++) {
      const c = AR[(from + k) % n], t = String(c.t || '').trim();
      if (!t || seen.has(t)) continue; seen.add(t);
      let have = false; try { have = !!findEn(c).trim(); } catch (_) { /* no English file */ }
      if (!have && !SAI.cached(t)) out.push(t);
    }
    return out;
  }
  function wordList() {
    const out = [], seen = new Set();
    for (const c of AR) {
      const t = String(c.t || '').trim(); if (!t) continue;
      let toks = []; try { toks = tokens(t); } catch (_) { toks = []; }
      for (const w of toks) { const k = w; if (seen.has(k)) continue; seen.add(k); out.push({ w, s: t }); if (out.length >= WORD_CAP * 3) return out; }
    }
    return out;
  }
  const pendingWords = () => { const items = wordList(); const todo = items.filter(x => !SAI.cachedWord || !SAI.cachedWord(x.w, x.s)); return todo.slice(0, WORD_CAP); };

  function paint(s) {
    const b = overlay(); if (!b) return;
    st.view = s; b.classList.add('on');
    const bar = (d, n, ok) => '<div class="bar"><i class="' + (ok ? 'ok' : '') + '" style="width:' + (n ? Math.min(100, Math.round(d / n * 100)) : 100) + '%"></i></div>';
    let h = '<div class="c">';
    if (s.state === 'run') {
      h += '<b class="t">Getting your subtitles ready</b><div class="m">Please keep the app open. You can stop at any time; what is done stays saved.</div>' +
        '<div class="r"><div class="l"><span>Translating the lines</span><span>' + s.ld + ' / ' + s.lt + '</span></div>' + bar(s.ld, s.lt, s.ld >= s.lt) + '</div>' +
        (s.wt ? '<div class="r"><div class="l"><span>Word by word</span><span>' + s.wd + ' / ' + s.wt + '</span></div>' + bar(s.wd, s.wt, s.wd >= s.wt) + '</div>' : '') +
        '<label><input type="checkbox" id="sp-words"' + (wantWords() ? ' checked' : '') + '> Also prepare each word (uses more AI)</label>' +
        '<div class="row"><button data-sp="stop">Stop</button><button data-sp="watch">Watch now</button></div><div class="m" style="margin-top:8px">“Watch now” starts the film; whatever is left translates as you watch, which can make it stutter.</div>';
    } else if (s.state === 'done') {
      h += '<b class="t ok">' + (s.lt > s.ld ? 'Translation saved (not every line)' : '✓ Translation finished and saved') + '</b><div class="m">' + s.ld + ' line' + (s.ld === 1 ? '' : 's') + (s.wd ? ' and ' + s.wd + ' word meanings' : '') + ' are saved on this phone. Playing will not slow down now.</div>' +
        '<div class="r"><div class="l"><span>Lines</span><span>' + s.ld + ' / ' + s.lt + '</span></div>' + bar(s.ld, s.lt, s.ld >= s.lt) + '</div>' + (s.wt ? '<div class="r"><div class="l"><span>Words</span><span>' + s.wd + ' / ' + s.wt + '</span></div>' + bar(s.wd, s.wt, s.wd >= s.wt) + '</div>' : '') +
        (s.err ? '<div class="e">' + esc(s.err) + '</div>' : '') + '<div class="row"><button class="p" data-sp="watch">Start watching</button></div>';
    } else if (s.state === 'fail') {
      h += '<b class="t">Could not finish</b><div class="m">' + s.ld + ' of ' + s.lt + ' lines are saved.</div><div class="e">' + esc(s.err) + '</div>' +
        '<div class="row"><button data-sp="settings">AI &amp; downloads</button><button data-sp="go">Try again</button><button class="p" data-sp="watch">Watch anyway</button></div>';
    }
    b.innerHTML = h + '</div>';
  }

  function close() { holdVideo(false); st.running = false; if (box) box.classList.remove('on'); try { if (typeof cur === 'number' && cur >= 0) show(cur); } catch (_) { /* nothing on screen yet */ } }
  function act(a) {
    if (a === 'watch') { if (st.abort) st.abort.abort(); close(); try { vid().play().catch(() => {}); } catch (_) { /* ignore */ } }
    else if (a === 'stop') { if (st.abort) st.abort.abort(); }
    else if (a === 'go') run();
    else if (a === 'settings') { try { window.SafinaUI.open(); } catch (_) { /* no settings */ } }
  }

  async function run() {
    if (st.running && st.view && st.view.state === 'run') return;
    st.running = true; st.abort = new AbortController(); holdVideo(true);
    const sig = st.abort.signal;
    let lines = lineList(), lt = lines.length, ld = 0, wd = 0, wt = 0, err = '', empty = 0;
    paint({ state: 'run', ld, lt, wd, wt });
    const bsize = SAI.state().mtMode === 'local' ? 6 : 10;
    const pass = async list => {
      for (let at = 0; at < list.length && !sig.aborted; at += bsize) {
        const part = list.slice(at, at + bsize);
        await SAI.prefetch(part, { max: part.length, persist: true, onError: e => { err = (e && e.message) || String(e); } });
        const got = part.filter(t => SAI.cached(t)).length;
        ld += got; empty = got ? 0 : empty + 1;
        paint({ state: 'run', ld, lt, wd, wt });
        if (empty >= 2) return false;
        await frame();
      }
      return true;
    };
    const ok = await pass(lines);
    if (ok && !sig.aborted) { const left = lines.filter(t => !SAI.cached(t)); if (left.length) { await pass(left); } }
    ld = lines.filter(t => SAI.cached(t)).length;
    if (!sig.aborted && ld < lt && empty >= 2) { paint({ state: 'fail', ld, lt, err: err || 'Nothing could be translated.' }); st.running = false; return; }
    if (!sig.aborted && wantWords() && SAI.aiAvailable()) {
      const items = pendingWords(); wt = items.length; paint({ state: 'run', ld, lt, wd, wt });
      if (wt) {
        const r = await SAI.prepareWords(items, { signal: sig, onProgress: (d) => { wd = d; paint({ state: 'run', ld, lt, wd, wt }); } });
        wd = r.done; if (r.error && r.done < r.total) err = r.error;
      }
    }
    st.running = false;
    if (sig.aborted) { close(); return; }
    try { SAI.flush(); } catch (_) { /* ignore */ }
    const missing = lt - ld;
    paint({ state: 'done', ld, lt, wd, wt, err: missing > 0 ? missing + ' line' + (missing === 1 ? '' : 's') + ' could not be translated now and will translate as you watch.' + (err ? ' (' + err + ')' : '') : err });
  }

  /* called when a film or a subtitle file has just been loaded */
  function offer() {
    try {
      if (!AR || !AR.length || !overlay()) return;
      const key = AR.length + '|' + AR[0].t + '|' + AR[AR.length - 1].t;
      if (st.running || st.key === key) return;
      st.key = key;
      const lines = lineList(), words = wantWords() && SAI.aiAvailable() ? pendingWords().length : 0;
      if (!lines.length && !words) { try { toast('Translation already saved on this phone'); } catch (_) { /* ignore */ } return; }
      if (!lines.length) { holdVideo(true); return run(); }
      holdVideo(true);
      run();
    } catch (e) { close(); }
  }
  window.SAFINA_PREP = { offer, run, close, state: () => st };
})();
