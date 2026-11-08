/* Safina brain UI: the understood / maybe / not-understood chip under a sentence, and the "learning brain" card on the profile page. */
(function () {
  'use strict';
  const B = window.BRAIN; if (!B) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const css = document.createElement('style');
  css.textContent = '#bchip{display:flex;gap:8px;align-items:flex-start;margin:8px 0 2px;padding:8px 10px;border-radius:12px;font-size:13px;line-height:1.4;background:var(--card,#16161a);border:1px solid var(--ln,#2c2c34);color:var(--tx,#fff)}' +
    '#bchip b{font-weight:700}#bchip .d{flex:0 0 auto;width:10px;height:10px;border-radius:50%;margin-top:4px}#bchip.yes .d{background:#2fb86b}#bchip.maybe .d{background:#e8a93a}#bchip.no .d{background:#e0334a}' +
    '#bchip .u{opacity:.75;font-size:12px}#bchip .ai{opacity:.6;font-size:11px;margin-left:4px}' +
    '#brain button{font:inherit;padding:8px 12px;border-radius:10px;border:1px solid var(--ln,#2c2c34);background:var(--bg,#0b0b0c);color:var(--tx,#fff);margin:8px 8px 0 0}' +
    '#brain button.pri{background:var(--ac,#e0334a);border-color:transparent;color:#fff}#brain .row{display:flex;gap:18px;margin:6px 0;flex-wrap:wrap}#brain .row div{min-width:70px}#brain .row b{display:block;font-size:22px}' +
    '#brain .err{color:#e0334a;font-size:12px;margin-top:6px}';
  document.head.appendChild(css);

  const TEXT = { yes: 'You probably understood this', maybe: 'You may have understood this', no: 'You probably did not understand this' };
  window.SAFINA_CHIP = function (i) {
    try {
      const line = (typeof AR !== 'undefined' && AR[i] && AR[i].t) || '';   // the page's own top-level variables are visible to later scripts
      let el = $('bchip');
      if (!line || !B.state().on) { if (el) el.remove(); return; }
      const pe = $('pEn'); if (!pe) return;
      if (!el) { el = document.createElement('div'); el.id = 'bchip'; pe.after(el); }
      const v = B.lineView(line);
      el.className = v.state;
      el.innerHTML = '<span class="d"></span><div><b>' + TEXT[v.state] + '</b>' + (v.byAI ? '<span class="ai">AI</span>' : '') +
        '<div class="u">' + esc(v.why) + (v.unknown.length ? ' ' + esc(v.unknown.slice(0, 6).join(' · ')) : '') + '</div></div>';
    } catch (_) { /* the chip is a hint only */ }
  };

  function card() {
    let c = $('brain');
    if (!c) {
      const x = $('xp'); if (!x || !x.parentNode) return null;
      c = document.createElement('div'); c.className = 'card'; c.id = 'brain'; x.parentNode.insertBefore(c, x);
    }
    return c;
  }
  const ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  function paint() {
    const c = card(); if (!c) return;
    const s = B.stats(), r = s.report;
    c.innerHTML = '<b>🧠 Your learning brain</b><div class="row"><div><b>' + esc(s.level) + '</b><span class="mu">' + (s.levelEstimated ? 'level (estimated)' : 'level') + '</span></div><div><b>' + s.known + '</b><span class="mu">words you know</span></div><div><b>' + s.learning + '</b><span class="mu">still learning</span></div></div>' +
      '<div class="mu">' + (!s.on ? 'Switched off.' : r ? (r.error ? '' : 'Last look ' + ago(r.at) + ': judged ' + r.lines + ' sentence' + (r.lines === 1 ? '' : 's') + ', added ' + r.cards + ' flashcard' + (r.cards === 1 ? '' : 's') + (r.via ? ' · ' + esc(r.via) : '') + '.') : 'It learns from what you tap, replay and save while you watch.') + '</div>' +
      (r && r.error ? '<div class="err">' + esc(r.error) + '</div>' : '') +
      '<button class="pri" data-b="now"' + (B.isRunning() ? ' disabled' : '') + '>' + (B.isRunning() ? 'Thinking…' : 'Look at what I watched now') + '</button><button data-b="toggle">' + (s.on ? 'Switch off' : 'Switch on') + '</button>';
  }
  document.addEventListener('click', async e => {
    const b = e.target.closest && e.target.closest('#brain [data-b]');
    if (b) {
      if (b.dataset.b === 'toggle') B.setOption('on', !B.state().on);
      else if (b.dataset.b === 'now') { paint(); const r = await B.assess({ force: true }); if (r && r.skipped && window.toast) window.toast('Nothing to look at yet: ' + r.skipped); }
      paint(); return;
    }
    if (e.target.closest && e.target.closest('[data-v="profile"]')) setTimeout(paint, 60);
  });
  B.on(ev => {
    if (ev === 'assessed' || ev === 'assessing' || ev === 'option' || ev === 'reset') { paint(); }
    if ((ev === 'assessed' || ev === 'line' || ev === 'word') && typeof cur === 'number' && cur >= 0) window.SAFINA_CHIP(cur);
  });
  paint();
})();
