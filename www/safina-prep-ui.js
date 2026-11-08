/* Safina "get the subtitles ready" screen.
 * The work itself is done by SAFINA_FILM (translate the whole film once, save it). This file only shows it while the film opens.
 * A film that was already prepared (in the background after import, or on an earlier visit) opens straight away with no screen. */
(function () {
  'use strict';
  const SAI = window.SAI, FILM = window.SAFINA_FILM;
  if (!SAI || !FILM) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
  const WORDS_KEY = 'safina.prep.words';
  const wantWords = () => lsGet(WORDS_KEY, '1') !== '0';

  const css = document.createElement('style');
  css.textContent = '#sp{position:fixed;inset:0;z-index:99900;display:none;align-items:center;justify-content:center;background:rgba(8,8,10,.94);color:#fff;font-family:system-ui,sans-serif;padding:12px;overflow:auto;-webkit-user-select:none;user-select:none}#sp.on{display:flex}' +
    '#sp .c{width:min(440px,100%);text-align:center}#sp b.t{font-size:17px;display:block;margin-bottom:4px}#sp .m{opacity:.7;font-size:12.5px;line-height:1.45}' +
    '#sp .r{margin:12px 0 0;text-align:left;font-size:12.5px}#sp .r div.l{display:flex;justify-content:space-between;margin-bottom:4px}' +
    '#sp .bar{height:8px;border-radius:99px;background:rgba(255,255,255,.14);overflow:hidden}#sp .bar i{display:block;height:100%;width:0;background:#ff293b;border-radius:99px;transition:width .2s}#sp .bar i.ok{background:#2fb86b}' +
    '#sp .row{display:flex;gap:8px;margin-top:14px}#sp button{flex:1;padding:11px 8px;border-radius:11px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:#fff;font:600 13.5px system-ui,sans-serif}#sp button.p{background:#ff293b;border-color:#ff293b}' +
    '#sp label{display:flex;gap:8px;align-items:center;justify-content:center;margin-top:12px;font-size:12.5px;opacity:.9}#sp .e{color:#ff8a8a;font-size:12.5px;margin-top:10px}#sp .ok{color:#6fe3a0}';
  document.head.appendChild(css);

  let box = null;
  const st = { key: '', view: null, guard: false, cues: null, off: null };
  function overlay() {
    if (box && box.isConnected) return box;
    if (!document.body) return null;
    box = document.createElement('div'); box.id = 'sp'; document.body.appendChild(box);
    box.addEventListener('click', e => { e.stopPropagation(); const a = e.target.closest('[data-sp]'); if (a) act(a.dataset.sp); });
    box.addEventListener('change', e => { if (e.target.id === 'sp-words') lsSet(WORDS_KEY, e.target.checked ? '1' : '0'); });
    box.addEventListener('pointerdown', e => e.stopPropagation());
    return box;
  }
  const vid = () => $('v');
  const guard = () => { if (st.guard) { try { vid().pause(); } catch (_) { /* ignore */ } } };
  /* hold: the page must not translate on its own while the film is being prepared (it would fight the batches) */
  function hold(on, pause) {
    window.SAFINA_PREP_BUSY = on;
    const v = vid(); if (!v) return;
    if (on && pause) { st.guard = true; v.pause(); v.addEventListener('play', guard); }
    if (!on) { st.guard = false; v.removeEventListener('play', guard); }
  }
  function release() { hold(false); if (box) box.classList.remove('on'); st.view = null; if (st.off) { st.off(); st.off = null; } try { if (typeof cur === 'number' && cur >= 0) show(cur); } catch (_) { /* nothing on screen yet */ } }

  function paint(p) {
    const b = overlay(); if (!b) return; b.classList.add('on'); st.view = p.state;
    const bar = (d, n, ok) => '<div class="bar"><i class="' + (ok ? 'ok' : '') + '" style="width:' + (n ? Math.min(100, Math.round(d / n * 100)) : 100) + '%"></i></div>';
    let h = '<div class="c">';
    if (p.state === 'running') {
      h += '<b class="t">Getting your subtitles ready</b><div class="m">Translating the whole film once: translator first, then the AI checks every line against the Arabic. It is saved, so this happens only once. You can stop at any time.</div>' +
        '<div class="r"><div class="l"><span>Translating the lines</span><span>' + p.ld + ' / ' + p.lt + '</span></div>' + bar(p.ld, p.lt, p.ld >= p.lt) + '</div>' +
        (p.wt ? '<div class="r"><div class="l"><span>Meaning of each word in its line</span><span>' + p.wd + ' / ' + p.wt + '</span></div>' + bar(p.wd, p.wt, p.wd >= p.wt) + '</div>' : '') +
        '<label><input type="checkbox" id="sp-words"' + (wantWords() ? ' checked' : '') + '> Also prepare each word (uses more AI)</label>' +
        '<div class="row"><button data-sp="stop">Stop</button><button data-sp="watch">Watch now</button></div><div class="m" style="margin-top:8px">“Watch now” starts the film and keeps preparing in the background, which can make it stutter. The film’s card in the library shows the progress.</div>';
    } else if (p.state === 'error') {
      h += '<b class="t">Could not finish</b><div class="m">' + p.ld + ' of ' + p.lt + ' lines are saved.</div><div class="e">' + esc(p.err || 'Nothing could be translated.') + '</div>' +
        '<div class="row"><button data-sp="settings">AI &amp; downloads</button><button data-sp="again">Try again</button><button class="p" data-sp="watch">Watch anyway</button></div>';
    } else {
      const full = p.ld >= p.lt;
      h += '<b class="t ' + (full ? 'ok' : '') + '">' + (full ? '✓ Translation finished and saved' : 'Translation saved (not every line)') + '</b><div class="m">' + p.ld + ' line' + (p.ld === 1 ? '' : 's') + (p.wd ? ' and ' + p.wd + ' word meanings' : '') + ' are saved on this phone as a translated subtitle file. It will not be translated again.</div>' +
        '<div class="r"><div class="l"><span>Lines</span><span>' + p.ld + ' / ' + p.lt + '</span></div>' + bar(p.ld, p.lt, full) + '</div>' + (p.wt ? '<div class="r"><div class="l"><span>Words</span><span>' + p.wd + ' / ' + p.wt + '</span></div>' + bar(p.wd, p.wt, p.wd >= p.wt) + '</div>' : '') +
        (p.err ? '<div class="e">' + esc(p.err) + '</div>' : '') + '<div class="row"><button data-sp="copy">Copy the translated SRT</button><button class="p" data-sp="watch">Start watching</button></div><div id="sp-msg" class="m" style="margin-top:8px"></div>';
    }
    b.innerHTML = h + '</div>';
  }

  async function act(a) {
    if (a === 'watch') { release(); try { vid().play().catch(() => {}); } catch (_) { /* ignore */ } }
    else if (a === 'stop') { FILM.stop(st.key); release(); }
    else if (a === 'again') run();
    else if (a === 'settings') { try { window.SafinaUI.open(); } catch (_) { /* no settings */ } }
    else if (a === 'copy') {
      const m = $('sp-msg'); const t = await FILM.exportSrt(st.key);
      try { await navigator.clipboard.writeText(t); if (m) m.textContent = 'Copied. Paste it into a text file and save it as .srt.'; } catch (_) { if (m) m.textContent = 'Could not copy.'; }
    }
  }

  function run() {
    hold(true, true);
    if (st.off) st.off();
    let first = true;
    FILM.ensure(st.cues, { title: typeof curTitle === 'string' ? curTitle : '', onProgress: p => {
      if (p.state === 'running') { if (first || st.view !== 'running' || true) paint(p); first = false; }
      else if (p.phase === 'done') paint(p);
    } }).then(rec => { /* the last progress event already painted the result */ }).catch(() => { /* ensure never rejects */ });
  }

  /* called when a film or a subtitle file has just been loaded */
  async function offer() {
    try {
      if (!AR || !AR.length) { release(); return; }
      const cues = AR.map(c => ({ s: c.s, e: c.e, t: c.t })); st.cues = cues;
      const key = FILM.key(cues);
      if (st.key === key && st.view) return;
      st.key = key;
      const job = FILM.running(key);
      const n = job ? null : await FILM.need(cues);            // restores the saved translation into the working cache
      if (!job && !n.lines && !n.words) { release(); return; } // already prepared: play straight away, nothing to show
      run();
    } catch (e) { release(); }
  }
  window.SAFINA_PREP = { offer, run, release };
})();
