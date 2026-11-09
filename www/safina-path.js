/* Safina: the top status bar (profile, language, streak, points) and the learning path.
 * "Start learning" opens a path of lessons. Lessons are grouped into units by where you met the words (the film or series),
 * with a unit at the top for words you are losing. Each lesson is a short run of exercises built from the AI's sentences.
 * The thinking stays in safina-brain.js; this file draws and collects answers. */
(function () {
  'use strict';
  const B = window.BRAIN, SAI = window.SAI;
  if (!B) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* storage blocked */ } };
  const toast = m => { try { (window.toast || (() => {}))(m); } catch (_) { /* ignore */ } };
  const learnLang = () => (SAI ? SAI.lang().learn : 'ar');
  const LESSON = 5;

  /* ------------------------------------------------------------------ points (XP) */
  const XP_KEY = 'safina.xp.v1';
  const today = () => new Date().toISOString().slice(0, 10);
  function xpState() { try { const o = JSON.parse(lsGet(XP_KEY, 'null')); if (o && typeof o.total === 'number') return o; } catch (_) { /* fresh */ } return { total: 0, days: {} }; }
  const XP = {
    total: () => xpState().total,
    today: () => xpState().days[today()] || 0,
    add(n) {
      n = Math.max(0, Math.round(n)); if (!n) return 0;
      const s = xpState(); s.total += n; s.days[today()] = (s.days[today()] || 0) + n;
      const keys = Object.keys(s.days).sort(); while (keys.length > 60) delete s.days[keys.shift()];
      lsSet(XP_KEY, JSON.stringify(s)); paintBar(); return n;
    }
  };

  /* ------------------------------------------------------------------ top bar */
  const css = document.createElement('style');
  css.textContent = 'header{display:flex;align-items:center;gap:10px}#sb{margin-left:auto;display:flex;align-items:center;gap:6px;font:700 14px "Plus Jakarta Sans",system-ui,sans-serif;color:var(--tx)}' +
    '#sb button{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 9px;border-radius:999px;border:1px solid var(--ln,#2c2c34);background:var(--card,#16161a);color:inherit;font:inherit;cursor:pointer}#sb button:active{transform:scale(.96)}' +
    '#sb .av{width:32px;padding:0;justify-content:center}#sb svg{width:17px;height:17px;flex:0 0 17px}#sb .fl{color:#ff9a1f}#sb .xp{color:var(--ac,#ff293b)}#sb .lgc{letter-spacing:.04em}' +
    '#lp{position:fixed;inset:0;z-index:99991;background:var(--bg,#0b0b0c);color:var(--tx,#fff);display:none;flex-direction:column;font-family:"Plus Jakarta Sans",system-ui,sans-serif}#lp.on{display:flex}' +
    '#lp .top{display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 8px}#lp .x{border:0;background:none;color:inherit;font-size:24px;padding:2px 8px;opacity:.7}' +
    '#lp .pb{flex:1;height:14px;border-radius:99px;background:var(--ln,#2c2c34);overflow:hidden}#lp .pb i{display:block;height:100%;width:0;background:var(--ac,#ff293b);border-radius:99px;transition:width .3s}' +
    '#lp .scroll{flex:1;overflow:auto;padding:4px 16px 30px;max-width:560px;width:100%;margin:0 auto}' +
    '#lp .ban{position:sticky;top:0;z-index:2;border-radius:18px;padding:14px 16px;background:var(--ac,#ff293b);color:#fff;margin:10px 0 18px;box-shadow:0 4px 0 rgba(0,0,0,.28)}#lp .ban small{display:block;opacity:.8;font-weight:700;letter-spacing:.04em;font-size:12px;text-transform:uppercase}#lp .ban b{font-size:19px}' +
    '#lp .nd{position:relative;display:flex;justify-content:center;margin:0 0 22px}#lp .nd button{position:relative;width:76px;height:70px;border-radius:50%;border:0;background:var(--ac,#ff293b);color:#fff;font-size:30px;box-shadow:0 7px 0 rgba(0,0,0,.35);cursor:pointer}#lp .nd button:active{transform:translateY(4px);box-shadow:0 3px 0 rgba(0,0,0,.35)}' +
    '#lp .nd.done button{background:var(--card,#16161a);border:2px solid var(--ac,#ff293b);color:var(--ac,#ff293b)}#lp .nd.idle button{background:var(--card,#16161a);color:var(--mu,#8a8a96);box-shadow:0 7px 0 rgba(0,0,0,.25)}' +
    '#lp .nd.cur button::before{content:"";position:absolute;inset:-9px;border-radius:50%;border:5px solid var(--ln,#2c2c34);border-top-color:var(--ac,#ff293b);transform:rotate(-30deg)}' +
    '#lp .pop{margin:-8px auto 22px;width:min(300px,100%);background:var(--ac,#ff293b);color:#fff;border-radius:16px;padding:14px;text-align:left;position:relative}#lp .pop::before{content:"";position:absolute;top:-8px;left:calc(50% - 8px);border:8px solid transparent;border-top:0;border-bottom-color:var(--ac,#ff293b)}' +
    '#lp .pop b{font-size:17px;display:block}#lp .pop span{opacity:.85;font-size:13.5px}#lp .pop button{display:block;width:100%;margin-top:10px;padding:12px;border-radius:12px;border:0;background:#fff;color:var(--ac,#ff293b);font:800 15px "Plus Jakarta Sans",sans-serif;letter-spacing:.04em;box-shadow:0 3px 0 rgba(0,0,0,.2)}' +
    '#lp .mu{opacity:.65;font-size:13px}#lp .strip{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 4px}#lp .strip button{flex:1;min-width:110px;padding:10px;border-radius:12px;border:1px solid var(--ln,#2c2c34);background:var(--card,#16161a);color:inherit;font:700 13px "Plus Jakarta Sans",sans-serif}' +
    '#lp .q{font-size:22px;font-weight:700;margin:14px 0 10px}#lp .big{background:var(--card,#16161a);border:2px solid var(--ln,#2c2c34);border-radius:24px;padding:22px 14px;text-align:center;margin:8px 0 18px}' +
    '#lp .sent{font-size:28px;line-height:2;direction:rtl}#lp .sent .w{padding:2px 3px;border-radius:6px;cursor:pointer}#lp .sent .w.f{background:rgba(255,41,59,.18)}#lp .sent .gap{display:inline-block;min-width:64px;border-bottom:3px solid var(--mu,#8a8a96)}#lp .sent .gap.fill{border-bottom-color:var(--ac,#ff293b)}' +
    '#lp .opts{display:flex;flex-direction:column;gap:10px}#lp .opts.row{flex-direction:row}#lp .o{flex:1;padding:15px 12px;border-radius:16px;border:2px solid var(--ln,#2c2c34);background:transparent;color:inherit;font:600 16px/1.35 "Plus Jakarta Sans",system-ui,sans-serif;box-shadow:0 3px 0 var(--ln,#2c2c34)}#lp .o.sel{border-color:var(--ac,#ff293b);background:rgba(255,41,59,.1)}#lp .o.ok{border-color:#2fb86b;background:rgba(47,184,107,.14)}#lp .o.no{border-color:#e0334a;background:rgba(224,51,74,.14)}' +
    '#lp .gl{text-align:center;min-height:22px;font-size:14px;opacity:.85;margin:-6px 0 6px}' +
    '#lp .foot{padding:12px 16px calc(env(safe-area-inset-bottom,0px) + 14px);max-width:560px;width:100%;margin:0 auto}#lp .foot.ok{background:rgba(47,184,107,.14)}#lp .foot.no{background:rgba(224,51,74,.14)}#lp .foot b{display:block;font-size:18px;margin-bottom:2px}#lp .foot.ok b{color:#2fb86b}#lp .foot.no b{color:#e0334a}' +
    '#lp .go{width:100%;padding:15px;border-radius:16px;border:0;background:var(--ac,#ff293b);color:#fff;font:800 16px "Plus Jakarta Sans",sans-serif;letter-spacing:.05em;text-transform:uppercase;box-shadow:0 4px 0 rgba(0,0,0,.3)}#lp .go:disabled{background:var(--ln,#2c2c34);color:var(--mu,#8a8a96);box-shadow:none}' +
    '#lp .dif{display:flex;gap:8px;margin-top:8px}#lp .dif button{flex:1;padding:12px 4px;border-radius:14px;border:2px solid var(--ln,#2c2c34);background:var(--card,#16161a);color:inherit;font:700 14px "Plus Jakarta Sans",sans-serif}' +
    '#lp .end{text-align:center;padding:40px 10px}#lp .end h2{margin:6px 0 4px;font-size:26px}#lp .tl{display:flex;gap:8px;justify-content:center;margin:18px 0}#lp .tl div{flex:1;max-width:130px;border:2px solid var(--ln,#2c2c34);border-radius:16px;padding:10px 4px}#lp .tl b{display:block;font-size:22px}';
  document.head.appendChild(css);

  const ICON = {
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
    flame: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>'
  };
  function goTab(v) { const b = document.querySelector('.babagang-nav-item[data-v="' + v + '"]'); if (b) b.click(); }
  function mountBar() {
    const h = document.querySelector('body > header'); if (!h || $('sb')) return;
    const d = document.createElement('div'); d.id = 'sb';
    d.innerHTML = '<button class="av" data-sb="profile" aria-label="Profile">' + ICON.user + '</button><button data-sb="lang" aria-label="Language you are learning"><span class="lgc" id="sb-l"></span></button>' +
      '<button class="fl" data-sb="streak" aria-label="Day streak">' + ICON.flame + '<span id="sb-s">0</span></button><button class="xp" data-sb="xp" aria-label="Points">' + ICON.bolt + '<span id="sb-x">0</span></button>';
    h.appendChild(d);
    d.addEventListener('click', e => {
      const b = e.target.closest('[data-sb]'); if (!b) return; const k = b.dataset.sb;
      if (k === 'profile') goTab('profile');
      else if (k === 'lang') { try { window.SafinaUI.open(); } catch (_) { goTab('profile'); } }
      else if (k === 'streak') toast(streak() + '-day streak. Watch, practise or review a little each day to keep it.');
      else toast(allXp() + ' points · ' + XP.today() + ' from lessons today');
    });
    paintBar();
  }
  /* the same points the profile page shows (10 per saved word, 2 per review, 1 per minute watched) plus lesson points */
  function allXp() { let n = 0; try { n = vocab.length * 10 + vocab.reduce((a, v) => a + v.hist.length, 0) * 2 + Math.round(Object.values(log).reduce((a, d) => a + d.sec, 0) / 60); } catch (_) { /* page not ready */ } return n + XP.total(); }
  function streak() { try { return B.progress().streak || 0; } catch (_) { return 0; } }
  function paintBar() {
    if (!$('sb')) return;
    let code = learnLang(); try { code = String(SAI.lang().learn || code); } catch (_) { /* default */ }
    $('sb-l').textContent = code.slice(0, 3).toUpperCase();
    $('sb-s').textContent = streak(); $('sb-x').textContent = allXp();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBar); else mountBar();
  setTimeout(paintBar, 700); setInterval(paintBar, 10000);
  B.on(ev => { if (ev === 'card' || ev === 'cards' || ev === 'assessed' || ev === 'option' || ev === 'reset') setTimeout(paintBar, 0); });
  document.addEventListener('safina-ai-changed', () => setTimeout(paintBar, 0));

  /* ------------------------------------------------------------------ the path */
  const root = document.createElement('div'); root.id = 'lp';
  root.innerHTML = '<div class="top"><button class="x" data-lp="close" aria-label="Close">✕</button><div class="pb" id="lp-pb" style="display:none"><i></i></div><span class="mu" id="lp-t"></span></div><div class="scroll" id="lp-b"></div><div id="lp-f"></div>';
  document.body.appendChild(root);
  const body = () => $('lp-b'), foot = () => $('lp-f');
  let view = '', S = {}, picked = '';

  function pause() { try { const v = document.getElementById('v'); if (v && !v.paused) v.pause(); } catch (_) { /* no video */ } }
  function open() {
    pause(); view = 'path'; picked = '';
    root.classList.add('on'); document.body.style.overflow = 'hidden';
    drawPath();
    refill(false);
  }
  function close() {
    root.classList.remove('on'); document.body.style.overflow = ''; view = ''; S = {};
    try { speechSynthesis.cancel(); } catch (_) { /* ignore */ }
    try { if (window.render) window.render(); } catch (_) { /* ignore */ }
    paintBar();
  }

  /* what is the best way to group them: by where the person met the words, with the words they are losing first */
  function units() {
    const cards = B.cards(), t = Date.now(), st = {}, src = {};
    try { B.wordTable({ limit: 5000 }).forEach(r => { st[r.key] = r.status; src[r.key] = r.firstSource || ''; }); } catch (_) { /* no words yet */ }
    const map = new Map();
    cards.forEach(c => {
      const k0 = c.targets && c.targets[0];
      const lost = (c.targets || []).some(k => st[k] === 'lost');
      const name = lost ? 'Words to win back' : (src[k0] || c.from || 'Other words');
      if (!map.has(name)) map.set(name, { name, lost, cards: [] });
      map.get(name).cards.push(c);
    });
    const out = Array.from(map.values()).map(u => {
      u.cards.sort((a, b) => (a.stage || 0) - (b.stage || 0) || a.created - b.created);
      u.lessons = []; for (let i = 0; i < u.cards.length; i += LESSON) { const cs = u.cards.slice(i, i + LESSON); u.lessons.push({ cards: cs, due: cs.filter(c => c.due <= t).length }); }
      u.due = u.cards.filter(c => c.due <= t).length; return u;
    });
    out.sort((a, b) => (b.lost - a.lost) || (b.due > 0) - (a.due > 0) || b.cards.length - a.cards.length);
    return out;
  }

  function drawPath() {
    if (view !== 'path') return;
    $('lp-pb').style.display = 'none'; $('lp-t').textContent = ''; foot().innerHTML = '';
    let lvl = ''; try { const l = B.level(); lvl = l && l.level ? l.level + (l.estimated ? '*' : '') : ''; } catch (_) { /* no level */ }
    const us = units(), offs = [0, 38, 62, 38, 0, -38, -62, -38];
    let h = '<div class="strip"><button data-lp="more">✨ New sentences</button><button data-lp="conj">🔤 Conjugation</button><button data-lp="words">📊 Words</button><button data-lp="prog">📈 Progress</button></div>' +
      '<div class="mu" id="lp-msg" style="min-height:18px;margin:2px 2px 0">' + (S.busy ? 'Writing sentences for your level…' : S.err ? '<span style="color:#e0334a">' + esc(S.err) + '</span>' : '') + '</div>';
    if (!us.length) {
      h += '<div class="big" style="margin-top:18px"><b>No lessons yet</b><div class="mu" style="margin-top:6px">Watch something and look up words you do not know. The AI turns them into sentences made of words you know plus one new word. Tap “New sentences” to make some now.</div></div>';
    }
    let firstDue = true;
    us.forEach((u, ui) => {
      h += '<div class="ban"><small>Unit ' + (ui + 1) + (lvl ? ' · ' + esc(lvl) : '') + '</small><b>' + esc(u.name.length > 40 ? u.name.slice(0, 38) + '…' : u.name) + '</b></div>';
      u.lessons.forEach((l, li) => {
        const id = ui + ':' + li, done = !l.due, cur = !done && firstDue; if (cur) firstDue = false;
        h += '<div class="nd ' + (done ? 'done' : cur ? 'cur' : '') + '" style="transform:translateX(' + offs[li % offs.length] + 'px)"><button data-lp="node" data-id="' + id + '" aria-label="Lesson ' + (li + 1) + '">' + (done ? '✓' : '★') + '</button></div>';
        if (picked === id && !done) h += '<div class="pop"><b>' + esc(u.name.length > 28 ? u.name.slice(0, 26) + '…' : u.name) + '</b><span>Lesson ' + (li + 1) + ' of ' + u.lessons.length + ' · ' + l.due + ' sentence' + (l.due === 1 ? '' : 's') + '</span><button data-lp="start" data-id="' + id + '">Start</button></div>';
      });
    });
    body().innerHTML = h;
    S.units = us;
    const cur = body().querySelector('.nd.cur'); if (cur && !S.scrolled) { S.scrolled = true; try { cur.scrollIntoView({ block: 'center' }); } catch (_) { /* old webview */ } }
  }

  async function refill(force) {
    if (S.busy) return;
    const fresh = B.cards().filter(c => !c.reps).length;
    if (!force && fresh >= LESSON) return;
    S.busy = true; S.err = ''; drawPath();
    try {
      try { B.importSentences((window.vocab || []).flatMap(x => x.auto ? [] : x.kind === 'line' ? [{ text: x.lemma, tr: x.tr, src: x.src }] : x.sent ? [{ text: x.sent, word: x.lemma, tr: x.sentTr, src: x.src }] : [])); } catch (_) { /* nothing saved */ }
      const r = await B.prepare({ count: 10 });
      if (r && r.error && !B.cards().length) S.err = r.error;
    } catch (e) { S.err = e.message || 'Could not write sentences'; }
    S.busy = false; if (view === 'path') drawPath();
  }

  /* ------------------------------------------------------------------ a lesson */
  const norm = w => B.norm(String(w).replace(/[^\p{L}\p{M}\p{N}]/gu, ''));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const bare = w => String(w).replace(/[^\p{L}\p{M}\p{N}]/gu, '');

  function startLesson(id) {
    const [ui, li] = id.split(':').map(Number), u = S.units && S.units[ui], l = u && u.lessons[li]; if (!l) return;
    const t = Date.now(), cs = l.cards.filter(c => c.due <= t); if (!cs.length) return;
    const pool = B.cards();
    S = { progress: 0, units: S.units, lesson: cs.map(c => ({ c, tries: 0 })), i: 0, total: cs.length, right: 0, wrong: 0, xp: 0, t00: Date.now(), pool };
    view = 'lesson'; $('lp-pb').style.display = ''; exercise();
  }
  function bar() { const n = S.total + 0; $('lp-pb').firstElementChild.style.width = Math.round(S.progress / n * 100) + '%'; }
  S.progress = 0;

  function mkExercise(c, idx) {
    const toks = c.text.replace(/\s+/g, ' ').trim().split(' ');
    const tgt = c.targets && c.targets[0];
    const gi = tgt ? toks.findIndex(w => norm(w) === tgt) : -1;
    const others = S.pool.filter(x => x.id !== c.id && x.tr).map(x => x.tr);
    const canMeaning = c.tr && new Set(others).size >= 2;
    const wordsPool = Array.from(new Set(S.pool.flatMap(x => x.text.split(' ').map(bare)).filter(w => w && norm(w) !== tgt && w.length > 1)));
    const canFill = gi >= 0 && toks.length >= 3 && wordsPool.length >= 2;
    let type = idx % 2 === 0 ? 'meaning' : 'fill';
    if (type === 'meaning' && !canMeaning) type = 'fill'; if (type === 'fill' && !canFill) type = 'meaning';
    if (type === 'meaning' && !canMeaning) type = 'reveal';
    if (type === 'meaning') {
      const opts = shuffle([c.tr].concat(shuffle(Array.from(new Set(others))).slice(0, 2)));
      return { type, toks, answer: c.tr, opts };
    }
    if (type === 'fill') {
      const ans = bare(toks[gi]);
      const dist = shuffle(wordsPool).slice(0, 2);
      return { type, toks, gi, answer: ans, opts: shuffle([ans].concat(dist)) };
    }
    return { type: 'reveal', toks };
  }

  function sentHtml(ex, c, hide) {
    return ex.toks.map((w, i) => (hide && i === ex.gi) ? '<span class="gap" id="lp-gap">&nbsp;</span>' : '<span class="w" data-w="' + esc(bare(w)) + '" data-k="' + esc(norm(w)) + '">' + esc(w) + '</span>').join(' ');
  }
  function exercise() {
    if (view !== 'lesson') return;
    const it = S.lesson[S.i]; if (!it) return finish();
    const c = it.c; S.ex = mkExercise(c, S.i + it.tries); S.sel = null; S.checked = false; S.t0 = Date.now(); S.tapped = new Set(); S.shown = false;
    const ex = S.ex; bar();
    let h = '';
    if (ex.type === 'meaning') {
      h = '<div class="q">What does this sentence mean?</div><div class="big"><div class="sent" dir="rtl" lang="' + esc(learnLang()) + '">' + sentHtml(ex, c) + '</div></div><div class="gl" id="lp-g">Tap a word to see its meaning.</div>' +
        '<div class="opts">' + ex.opts.map((o, i) => '<button class="o" data-lp="opt" data-i="' + i + '" dir="auto">' + esc(o) + '</button>').join('') + '</div>';
    } else if (ex.type === 'fill') {
      h = '<div class="q">Which word is missing?</div><div class="big"><div class="sent" dir="rtl" lang="' + esc(learnLang()) + '">' + sentHtml(ex, c, true) + '</div>' + (c.tr ? '<div class="mu" style="margin-top:6px" dir="auto">' + esc(c.tr) + '</div>' : '') + '</div>' +
        '<div class="opts row">' + ex.opts.map((o, i) => '<button class="o" data-lp="opt" data-i="' + i + '" dir="auto" lang="' + esc(learnLang()) + '" style="font-size:22px">' + esc(o) + '</button>').join('') + '</div>';
    } else {
      h = '<div class="q">Read the sentence</div><div class="big"><div class="sent" dir="rtl" lang="' + esc(learnLang()) + '">' + sentHtml(ex, c) + '</div></div><div class="gl" id="lp-g">Tap a word you did not know.</div><div id="lp-r"></div>';
    }
    body().innerHTML = h;
    foot().innerHTML = '<div class="foot"><button class="go" data-lp="check" ' + (ex.type === 'reveal' ? '' : 'disabled') + '>' + (ex.type === 'reveal' ? 'Show meaning' : 'Check') + '</button></div>';
    try { if (window.say && S.i === 0) { /* no auto speech: the phone may be silent */ } } catch (_) { /* ignore */ }
  }

  async function tapWord(sp) {
    const k = sp.dataset.k, c = S.lesson[S.i].c; if (!k) return;
    if (S.tapped.has(k)) { S.tapped.delete(k); sp.classList.remove('f'); return; }
    S.tapped.add(k); sp.classList.add('f');
    const g = $('lp-g'); if (!g) return; g.textContent = sp.dataset.w + ' …';
    try { const r = await SAI.lookupWord(sp.dataset.w, c.text); g.textContent = sp.dataset.w + ' = ' + r.gloss + (r.pos ? ' (' + r.pos + ')' : ''); } catch (e) { g.textContent = sp.dataset.w + ': ' + (e.message || 'no meaning available'); }
  }

  async function check() {
    const it = S.lesson[S.i], c = it.c, ex = S.ex; if (S.checked) return;
    if (ex.type === 'reveal') {
      if (S.shown) return; S.shown = true;
      const el = $('lp-r'); el.innerHTML = '<div class="mu" style="text-align:center">Translating…</div>';
      let tr = c.tr; if (!tr) { try { tr = (await SAI.translateLine(c.text)).t; c.tr = tr; } catch (_) { tr = ''; } }
      if (S.lesson[S.i] !== it) return;
      el.innerHTML = '<div class="big" dir="auto" style="font-size:19px">' + esc(tr || 'No translation available right now.') + '</div>' + (c.hint ? '<div class="mu" style="text-align:center">💡 ' + esc(c.hint) + '</div>' : '');
      S.checked = true; return feedback(true, tr || '');
    }
    if (S.sel == null) return;
    S.checked = true;
    const ok = ex.opts[S.sel] === ex.answer;
    body().querySelectorAll('.o').forEach((b, i) => { b.disabled = true; if (ex.opts[i] === ex.answer) b.classList.add('ok'); else if (i === S.sel) b.classList.add('no'); });
    if (ex.type === 'fill') { const g = $('lp-gap'); if (g) { g.textContent = ex.answer; g.classList.add('fill'); } }
    feedback(ok, ex.type === 'fill' ? '' : ex.answer);
  }

  /* the sheet at the bottom: correct or not, and "how difficult was it?" */
  function feedback(ok, answer) {
    const it = S.lesson[S.i], c = it.c, ex = S.ex;
    S.ok = ok;
    const hint = ok && ex.type !== 'reveal' && c.hint ? '<div class="mu">💡 ' + esc(c.hint) + '</div>' : '';
    if (ex.type === 'reveal' || ok) {
      foot().innerHTML = '<div class="foot ' + (ex.type === 'reveal' ? '' : 'ok') + '">' + (ex.type === 'reveal' ? '' : '<b>Correct!</b>') + hint + '<div class="mu" style="margin-top:4px">How difficult was this sentence?</div><div class="dif"><button data-lp="dif" data-q="1">Hard</button><button data-lp="dif" data-q="2">Good</button><button data-lp="dif" data-q="3">Easy</button></div>' +
        (ex.type === 'reveal' ? '<button class="go" data-lp="dif" data-q="0" style="margin-top:10px;background:var(--card,#16161a);color:inherit;box-shadow:none;border:2px solid var(--ln,#2c2c34)">I could not follow it</button>' : '') + '</div>';
    } else {
      foot().innerHTML = '<div class="foot no"><b>Not quite</b><div class="mu" dir="auto">' + (ex.type === 'fill' ? 'Missing word: <span style="font-size:18px">' + esc(ex.answer) + '</span>' : 'Correct answer: ' + esc(answer)) + '</div><div style="height:10px"></div><button class="go" data-lp="dif" data-q="0">Continue</button></div>';
    }
  }

  function rate(q) {
    const it = S.lesson[S.i], c = it.c; if (!it || S.rated) return;
    let out = { learned: [] };
    if (it.tries === 0) { try { out = B.rateCard(c.id, { q, ms: Date.now() - S.t0, tapped: Array.from(S.tapped) }) || out; } catch (e) { toast(e.message); } }
    if (q > 0) { S.right++; S.xp += XP.add(q === 3 ? 4 : q === 2 ? 3 : 2); } else {
      S.wrong++;
      if (it.tries === 0) S.lesson.push({ c, tries: 1 });    // one more go at the end, not rated again
    }
    if (out.learned && out.learned.length) toast('🎉 You now know: ' + out.learned.join(', '));
    S.progress++; S.i++; exercise();
  }

  function finish() {
    const bonus = S.right ? XP.add(10) : 0; S.xp += bonus;
    $('lp-pb').firstElementChild.style.width = '100%';
    const secs = Math.round((Date.now() - S.t00) / 1000), n = S.right + S.wrong, acc = n ? Math.round(S.right / n * 100) : 0;
    body().innerHTML = '<div class="end"><div style="font-size:56px">🎉</div><h2>Lesson complete</h2><div class="mu">Streak: ' + streak() + ' day' + (streak() === 1 ? '' : 's') + '</div>' +
      '<div class="tl"><div><b style="color:var(--ac,#ff293b)">+' + S.xp + '</b><span class="mu">points</span></div><div><b>' + acc + '%</b><span class="mu">right</span></div><div><b>' + (secs >= 60 ? Math.round(secs / 60) + ' min' : secs + ' s') + '</b><span class="mu">time</span></div></div></div>';
    foot().innerHTML = '<div class="foot"><button class="go" data-lp="back">Continue</button></div>';
    paintBar();
  }
  function back() { view = 'path'; S = { busy: false, units: null }; S.progress = 0; drawPath(); }

  /* ------------------------------------------------------------------ events */
  root.addEventListener('click', e => {
    const w = e.target.closest('.sent .w'); if (w && view === 'lesson') return tapWord(w);
    const a = e.target.closest('[data-lp]'); if (!a) return; const k = a.dataset.lp;
    if (k === 'close') { if (view === 'lesson' && S.i > 0 && S.i < S.lesson.length && !confirm('Leave this lesson? Your answers so far are kept.')) return; if (view === 'lesson') { back(); return; } close(); }
    else if (k === 'node') { picked = picked === a.dataset.id ? '' : a.dataset.id; const l = S.units[+a.dataset.id.split(':')[0]].lessons[+a.dataset.id.split(':')[1]]; if (!l.due) { picked = ''; toast('All done here for now. It comes back when it is due.'); } drawPath(); }
    else if (k === 'start') startLesson(a.dataset.id);
    else if (k === 'opt') { if (S.checked) return; S.sel = +a.dataset.i; body().querySelectorAll('.o').forEach((b, i) => b.classList.toggle('sel', i === S.sel)); const g = foot().querySelector('.go'); if (g) g.disabled = false; }
    else if (k === 'check') check();
    else if (k === 'dif') { S.rated = false; rate(+a.dataset.q); }
    else if (k === 'back') back();
    else if (k === 'more') refill(true);
    else if (k === 'conj' || k === 'words' || k === 'prog') { const n = k === 'prog' ? 'progress' : k; close(); try { window.SafinaLearn.open(n); } catch (_) { /* learn screens missing */ } }
  });

  window.SAFINA_XP = XP;
  window.SafinaPath = { open, close, xp: XP, paintBar };
})();
