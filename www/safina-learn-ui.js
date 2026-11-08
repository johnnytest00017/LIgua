/* Safina learning screens: sentence practice, conjugation, the word table and progress.
 * All the thinking is in safina-brain.js; this file only draws and collects answers. */
(function () {
  'use strict';
  const B = window.BRAIN, SAI = window.SAI;
  if (!B) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = (t) => { try { if (typeof window.say === 'function') window.say(t); } catch (_) { /* no speech on this device */ } };
  const toast = m => { try { (window.toast || (() => {}))(m); } catch (_) { /* ignore */ } };
  const learnLang = () => (SAI ? SAI.lang().learn : 'ar');
  const dateStr = ms => ms ? new Date(ms).toISOString().slice(0, 10) : '–';
  const mins = s => s >= 3600 ? (s / 3600).toFixed(1) + ' h' : Math.round(s / 60) + ' min';

  const css = document.createElement('style');
  css.textContent = '#sl{position:fixed;inset:0;z-index:99990;background:var(--bg,#0b0b0c);color:var(--tx,#fff);display:none;flex-direction:column;font-family:system-ui,sans-serif}#sl.on{display:flex}' +
    '#sl header{display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px;border-bottom:1px solid var(--ln,#2c2c34)}#sl header b{flex:1;font-size:17px}' +
    '#sl .x{border:0;background:none;color:inherit;font-size:22px;padding:4px 8px}#sl .body{flex:1;overflow:auto;padding:14px;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 24px);max-width:720px;width:100%;margin:0 auto}' +
    '#sl button,#sl select,#sl input{font:inherit}#sl .b{padding:11px 14px;border-radius:12px;border:1px solid var(--ln,#2c2c34);background:var(--card,#16161a);color:inherit}#sl .b.pri{background:var(--ac,#e0334a);border-color:transparent;color:#fff}' +
    '#sl .row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}#sl .row>.b{flex:1;min-width:80px}#sl .mu{opacity:.65;font-size:13px}#sl .card{background:var(--card,#16161a);border:1px solid var(--ln,#2c2c34);border-radius:16px;padding:16px;margin:10px 0}' +
    '#sl .sent{font-size:26px;line-height:2;text-align:center;padding:6px 0}#sl .sent .w{padding:2px 3px;border-radius:6px;cursor:pointer}#sl .sent .w.t{outline:2px solid var(--ac,#e0334a)}#sl .sent .w.f{background:rgba(224,51,74,.18)}' +
    '#sl .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}#sl .tile{background:var(--card,#16161a);border:1px solid var(--ln,#2c2c34);border-radius:14px;padding:12px}#sl .tile b{display:block;font-size:22px}' +
    '#sl table{width:100%;border-collapse:collapse;font-size:13px}#sl th,#sl td{padding:7px 6px;text-align:left;border-bottom:1px solid var(--ln,#2c2c34);white-space:nowrap}#sl .tw{overflow:auto}' +
    '#sl .bar{display:flex;align-items:flex-end;gap:3px;height:64px}#sl .bar i{flex:1;background:var(--ac,#e0334a);border-radius:3px 3px 0 0;min-height:2px;opacity:.85}' +
    '#sl .chip{display:inline-block;padding:3px 9px;border-radius:99px;font-size:12px;border:1px solid var(--ln,#2c2c34);margin:2px}#sl .st-lost{color:#e0334a}#sl .st-known{color:#2fb86b}#sl .st-learning{color:#e8a93a}' +
    '#sl input[type=text],#sl input[type=date],#sl input[type=number],#sl select{padding:10px;border-radius:10px;border:1px solid var(--ln,#2c2c34);background:var(--bg,#0b0b0c);color:inherit;width:100%}' +
    '#sl .err{color:#e0334a;font-size:13px}#sl .ok{color:#2fb86b}';
  document.head.appendChild(css);

  const root = document.createElement('div'); root.id = 'sl';
  root.innerHTML = '<header><b id="sl-t"></b><button class="x" data-sl="close" aria-label="Close">✕</button></header><div class="body" id="sl-b"></div>';
  document.body.appendChild(root);
  const body = () => $('sl-b');
  let screen = '', st = {};

  function open(name) {
    screen = name; st = {};
    root.classList.add('on'); document.body.style.overflow = 'hidden';
    try { const vv = document.getElementById('v'); if (vv && !vv.paused) vv.pause(); } catch (_) { /* no video yet */ }
    ({ practice, conj, words, progress })[name]();
  }
  function close() { root.classList.remove('on'); document.body.style.overflow = ''; screen = ''; try { speechSynthesis.cancel(); } catch (_) { /* ignore */ } if (window.render) try { window.render(); } catch (_) { /* ignore */ } paintHub(); }
  const head = t => { $('sl-t').textContent = t; };
  const busy = (t) => { body().innerHTML = '<div class="card"><b>' + esc(t) + '</b><div class="mu" style="margin-top:6px">This uses your AI, so it can take a few seconds.</div></div>'; };

  /* ---------------------------------------------------------------- sentence practice */
  function savedSentences() {
    const out = [];
    try { (window.vocab || []).forEach(x => { if (x.auto) return; if (x.kind === 'line') out.push({ text: x.lemma, tr: x.tr, src: x.src }); else if (x.sent) out.push({ text: x.sent, word: x.lemma, tr: x.sentTr, src: x.src }); }); } catch (_) { /* no saved cards */ }
    return out;
  }
  async function practice(more) {
    head('Practice sentences');
    busy('Getting your sentences ready…');
    B.importSentences(savedSentences());
    const r = await B.prepare({ count: 6 });
    if (screen !== 'practice') return;
    st = { q: B.queue(12), i: 0, done: [], err: r && r.error, made: r };
    if (!st.q.length) {
      body().innerHTML = '<div class="card"><b>Nothing to practise right now</b><div class="mu" style="margin:6px 0">Watch something and look up the words you do not know. I turn them into short sentences made of words you know plus one new word, and make them a little harder each time you get them right.</div>' +
        (st.err ? '<div class="err">' + esc(st.err) + '</div>' : '') + '<div class="row"><button class="b pri" data-sl="again">Try to make sentences now</button></div>' +
        ((window.vocab || []).length ? '<div class="row"><button class="b" data-sl="oldrev">Review my saved cards the old way</button></div>' : '') + '</div>';
      return;
    }
    card();
  }
  function card() {
    const c = st.q[st.i];
    if (!c) return summary();
    st.t0 = Date.now(); st.tapped = new Set(); st.shown = false;
    const targets = c.targets;
    const html = B.tokens(c.text).length ? c.text.replace(/\s+/g, ' ').split(' ').map(w => {
      const k = B.norm(w.replace(/[^\p{L}\p{M}\p{N}]/gu, ''));
      return '<span class="w' + (targets.includes(k) ? ' t' : '') + '" data-k="' + esc(k) + '" data-w="' + esc(w.replace(/[^\p{L}\p{M}\p{N}]/gu, '')) + '">' + esc(w) + '</span>';
    }).join(' ') : esc(c.text);
    const stageTxt = ['one new word', 'a new word and a little more', 'a longer sentence', 'a full sentence'][c.stage || 0];
    body().innerHTML = '<div class="mu">' + (st.i + 1) + ' of ' + st.q.length + ' · ' + esc(stageTxt) + (c.src === 'ai' ? ' · written for you' : c.from ? ' · from ' + esc(c.from) : '') + '</div>' +
      '<div class="card"><div class="sent" dir="auto" lang="' + esc(learnLang()) + '" id="sl-s">' + html + '</div><div class="mu" style="text-align:center">Tap any word you did not know.</div>' +
      '<div id="sl-g" class="mu" style="text-align:center;margin-top:8px;min-height:20px"></div></div>' +
      '<div id="sl-r"></div><div class="row"><button class="b" data-sl="say">🔊 Listen</button><button class="b pri" data-sl="reveal">Show meaning</button></div>';
  }
  async function reveal() {
    const c = st.q[st.i]; if (!c || st.shown) return; st.shown = true;
    const el = $('sl-r'); el.innerHTML = '<div class="card"><div id="sl-tr" class="mu">Translating…</div></div>';
    let tr = c.tr;
    if (!tr) { try { tr = (await SAI.translateLine(c.text)).t; c.tr = tr; } catch (e) { tr = ''; } }
    if (st.q[st.i] !== c) return;
    const tg = (c.hint ? '<div class="mu" style="margin-top:6px">💡 ' + esc(c.hint) + '</div>' : '') + (c.met ? '<div class="mu" style="margin-top:6px">You met this word in: <span dir="auto">' + esc(c.met) + '</span></div>' : '');
    el.innerHTML = '<div class="card"><div dir="auto" style="font-size:18px">' + esc(tr || 'No translation available right now.') + '</div>' + tg + '</div>' +
      '<div class="card"><b>How difficult was this sentence?</b><div class="row"><button class="b" data-q="0">Could not follow</button><button class="b" data-q="1">Hard</button><button class="b" data-q="2">Good</button><button class="b" data-q="3">Easy</button></div></div>';
    document.querySelector('#sl .row [data-sl="reveal"]').disabled = true;
  }
  async function tapWord(sp) {
    const k = sp.dataset.k, c = st.q[st.i];
    if (st.tapped.has(k)) { st.tapped.delete(k); sp.classList.remove('f'); return; }
    st.tapped.add(k); sp.classList.add('f');
    const g = $('sl-g'); g.textContent = sp.dataset.w + ' …';
    try { const r = await SAI.lookupWord(sp.dataset.w, c.text); g.textContent = sp.dataset.w + ' = ' + r.gloss + (r.pos ? ' (' + r.pos + ')' : ''); } catch (e) { g.textContent = sp.dataset.w + ': ' + (e.message || 'no meaning available'); }
  }
  function rate(q) {
    const c = st.q[st.i]; if (!c) return;
    let out; try { out = B.rateCard(c.id, { q, ms: Date.now() - st.t0, tapped: Array.from(st.tapped) }); } catch (e) { toast(e.message); return; }
    st.done.push({ q, ms: Date.now() - st.t0 });
    if (out.learned.length) toast('🎉 You now know: ' + out.learned.join(', '));
    st.i++; card();
  }
  function summary() {
    const n = st.done.length, avg = n ? st.done.reduce((a, d) => a + d.q, 0) / n : 0, ms = st.done.reduce((a, d) => a + d.ms, 0);
    body().innerHTML = '<div class="card"><b>Done: ' + n + ' sentence' + (n === 1 ? '' : 's') + '</b><div class="mu" style="margin:6px 0">' + mins(ms / 1000) + ' · average difficulty ' + (avg < 0.75 ? 'hard' : avg < 1.75 ? 'okay' : avg < 2.5 ? 'good' : 'easy') + '</div>' +
      '<div class="row"><button class="b pri" data-sl="again">More sentences</button><button class="b" data-sl="close">Finish</button></div></div>';
  }

  /* ---------------------------------------------------------------- conjugation */
  async function conj() {
    head('Conjugation');
    busy('Writing conjugation drills for you…');
    const r = await B.conjPrepare({});
    if (screen !== 'conj') return;
    st = { q: B.conjNext(8), i: 0, ok: 0, n: 0, err: r && r.error };
    if (!st.q.length) {
      body().innerHTML = '<div class="card"><b>No drills yet</b><div class="mu" style="margin:6px 0">Drills are written by the AI to fit your level.</div>' + (st.err ? '<div class="err">' + esc(st.err) + '</div>' : '') + '<div class="row"><button class="b pri" data-sl="conjmore">Make drills</button></div></div>';
      return;
    }
    drill();
  }
  function drill() {
    const d = st.q[st.i];
    if (!d) return conjSummary();
    st.t0 = Date.now(); st.graded = false;
    body().innerHTML = '<div class="mu">' + (st.i + 1) + ' of ' + st.q.length + '</div><div class="card"><div class="mu">' + esc(d.tense) + ' · ' + esc(d.person) + '</div>' +
      '<div style="font-size:22px;margin:8px 0" dir="auto">' + esc(d.lemma) + ' <span class="mu" style="font-size:14px">' + esc(d.meaning) + '</span></div><div dir="auto" style="font-size:18px;line-height:1.8">' + esc(d.prompt) + '</div>' +
      '<input type="text" id="sl-a" dir="auto" lang="' + esc(learnLang()) + '" autocomplete="off" autocapitalize="off" spellcheck="false" style="margin-top:12px"><div id="sl-f"></div><div class="row"><button class="b pri" data-sl="check">Check</button></div></div>';
    const i = $('sl-a'); if (i) { i.focus(); i.onkeydown = e => { if (e.key === 'Enter') check(); }; }
  }
  async function check() {
    const d = st.q[st.i]; if (!d) return;
    if (st.graded) { st.i++; return drill(); }
    const a = $('sl-a').value; if (!a.trim()) return;
    st.graded = true; const g = B.conjGrade(d.id, a, Date.now() - st.t0); st.n++; if (g.ok) st.ok++;
    $('sl-a').disabled = true;
    $('sl-f').innerHTML = g.ok ? '<div class="ok" style="margin-top:10px"><b>Correct</b>' + (g.marksDiffer ? ' · exact spelling: <span dir="auto">' + esc(g.answer) + '</span>' : '') + '</div>' + (d.note ? '<div class="mu">' + esc(d.note) + '</div>' : '')
      : '<div class="err" style="margin-top:10px"><b>Not quite.</b> Correct: <span dir="auto" style="font-size:18px">' + esc(g.answer) + '</span></div>' + (d.note ? '<div class="mu">' + esc(d.note) + '</div>' : '') + '<div id="sl-why" class="mu" style="margin-top:6px"><a data-sl="why" style="text-decoration:underline">Why?</a></div>';
    document.querySelector('#sl [data-sl="check"]').textContent = st.i + 1 < st.q.length ? 'Next' : 'Finish';
    st.last = { id: d.id, a };
  }
  async function why() {
    const el = $('sl-why'); if (!el || !st.last) return; el.textContent = 'Thinking…';
    const t = await B.conjExplain(st.last.id, st.last.a); el.textContent = t || 'No explanation is available right now.';
  }
  function conjSummary() {
    const s = B.conjStats();
    body().innerHTML = '<div class="card"><b>' + st.ok + ' of ' + st.n + ' correct</b>' +
      (s.rows.length ? '<div class="mu" style="margin:8px 0">By tense</div>' + s.rows.map(r => '<div>' + esc(r.tense) + ': ' + r.acc + '% <span class="mu">(' + r.n + ')</span></div>').join('') : '') +
      '<div class="row"><button class="b pri" data-sl="conj">More drills</button><button class="b" data-sl="close">Finish</button></div></div>';
  }

  /* ---------------------------------------------------------------- word table */
  function words() {
    head('Your words');
    st = { sort: 'lookups', status: '' };
    wordsView();
  }
  function wordsView() {
    const rows = B.wordTable({ sort: st.sort, status: st.status || undefined, limit: 300 }), a = B.wordAverages();
    const opt = (v, t) => '<option value="' + v + '"' + (st.sort === v ? ' selected' : '') + '>' + t + '</option>';
    body().innerHTML = '<div class="tiles"><div class="tile"><b>' + a.learned + '</b><span class="mu">words learned</span></div><div class="tile"><b>' + (a.avgDaysToLearn == null ? '–' : a.avgDaysToLearn) + '</b><span class="mu">average days to learn</span></div><div class="tile"><b>' + (a.avgRepsToEasy == null ? '–' : a.avgRepsToEasy) + '</b><span class="mu">average repetitions until easy</span></div><div class="tile"><b>' + a.lost + '</b><span class="mu">lost words</span></div></div>' +
      '<div class="row"><select data-sl="sort">' + opt('lookups', 'Most looked up') + opt('encounters', 'Most met') + opt('reviews', 'Most reviewed') + opt('daysToLearn', 'Slowest to learn') + opt('repsToEasy', 'Most repetitions') + opt('firstSeen', 'Newest') + opt('word', 'A to Z') + '</select>' +
      '<select data-sl="filter"><option value="">All words</option>' + ['learning', 'known', 'lost', 'new'].map(s => '<option value="' + s + '"' + (st.status === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select><button class="b" data-sl="csv">Copy as table</button></div>' +
      '<div class="tw"><table><tr><th>Word</th><th>Status</th><th>First met</th><th>Met</th><th>Looked up</th><th>Reviews</th><th>Days to learn</th><th>Reps to easy</th></tr>' +
      (rows.length ? rows.map(r => '<tr><td dir="auto">' + esc(r.word) + '</td><td class="st-' + r.status + '">' + r.status + '</td><td>' + esc(dateStr(r.firstSeen)) + (r.firstSource ? ' · ' + esc(r.firstSource.slice(0, 22)) : '') + '</td><td>' + r.encounters + '</td><td>' + r.lookups + '</td><td>' + r.reviews + '</td><td>' + (r.daysToLearn == null ? '–' : r.daysToLearn) + '</td><td>' + (r.repsToEasy == null ? '–' : r.repsToEasy) + '</td></tr>').join('') : '<tr><td colspan="8" class="mu">No words yet. They appear as you watch.</td></tr>') + '</table></div>';
  }
  function csv() {
    const rows = B.wordTable({ sort: st.sort, status: st.status || undefined, limit: 2000 });
    const t = ['word,status,first_met,source,met,looked_up,reviews,days_to_learn,reps_to_easy'].concat(rows.map(r => [r.word, r.status, dateStr(r.firstSeen), r.firstSource, r.encounters, r.lookups, r.reviews, r.daysToLearn == null ? '' : r.daysToLearn, r.repsToEasy == null ? '' : r.repsToEasy].map(x => '"' + String(x).replace(/"/g, '""') + '"').join(','))).join('\n');
    try { navigator.clipboard.writeText(t).then(() => toast('Copied ' + rows.length + ' rows'), () => toast('Could not copy')); } catch (_) { toast('Could not copy'); }
  }

  /* ---------------------------------------------------------------- progress */
  function progress() {
    head('Your progress');
    const p = B.progress(), t = p.totals, s = B.stats(), pr = B.state().profile, cj = B.conjStats();
    const tile = (n, l) => '<div class="tile"><b>' + n + '</b><span class="mu">' + l + '</span></div>';
    const bars = (key, div) => { const mx = Math.max(1, ...p.series.map(d => (d[key] || 0) / div)); return '<div class="bar">' + p.series.map(d => '<i title="' + d.date + '" style="height:' + Math.max(3, (d[key] || 0) / div / mx * 100) + '%"></i>').join('') + '</div>'; };
    const u = p.understanding, cjn = cj.rows.reduce((a, r) => a + r.n, 0), cjok = cj.rows.reduce((a, r) => a + r.ok, 0);
    body().innerHTML =
      '<div class="tiles">' + tile(esc(p.level.level) + (p.level.estimated ? '*' : ''), 'level' + (p.level.estimated ? ' (estimated)' : '')) + tile(p.streak + ' 🔥', 'day streak') + tile(s.known, 'words you know') + tile(s.learning, 'still learning') + tile(p.words.lost, 'lost words') + tile(p.cardsDue, 'sentences due') + '</div>' +
      '<div class="card"><b>Watching</b><div class="tiles" style="margin-top:8px">' + tile(mins(t.watch || 0), 'watched') + tile(t.lines || 0, 'sentences seen') + tile(t.taps || 0, 'words looked up') + tile(t.replays || 0, 'sentences replayed') + tile(t.pauses || 0, 'pauses') + tile(t.pauses ? Math.round((t.pauseSec || 0) / t.pauses) + ' s' : '–', 'average pause') + tile(mins(t.pauseSec || 0), 'time paused') + tile(t.seeks || 0, 'skips and rewinds') + '</div>' +
      '<div class="mu" style="margin-top:10px">Minutes watched, last 14 days</div>' + bars('watch', 60) + '</div>' +
      '<div class="card"><b>Practice</b><div class="tiles" style="margin-top:8px">' + tile(t.reviews || 0, 'sentences practised') + tile(p.retention == null ? '–' : p.retention + '%', 'answered good or easy') + tile(p.avgDifficulty == null ? '–' : p.avgDifficulty + ' / 3', 'average difficulty') + tile(p.avgSecondsPerCard == null ? '–' : p.avgSecondsPerCard + ' s', 'per sentence') + tile(cjn ? Math.round(cjok / cjn * 100) + '%' : '–', 'conjugation right') + tile(p.words.learned, 'words learned') + tile(p.words.avgDaysToLearn == null ? '–' : p.words.avgDaysToLearn + ' d', 'to learn a word') + tile(p.words.avgRepsToEasy == null ? '–' : p.words.avgRepsToEasy, 'reps until easy') + '</div>' +
      '<div class="mu" style="margin-top:10px">Sentences practised, last 14 days</div>' + bars('reviews', 1) + '</div>' +
      (u ? '<div class="card"><b>How much you understand</b><div class="mu" style="margin:6px 0">Over your last ' + u.n + ' judged sentences</div><div class="bar" style="height:22px"><i style="background:#2fb86b;flex:' + u.yes + '"></i><i style="background:#e8a93a;flex:' + u.maybe + '"></i><i style="background:#e0334a;flex:' + u.no + '"></i></div><div class="mu">understood ' + u.yes + ' · maybe ' + u.maybe + ' · not ' + u.no + '</div></div>' : '') +
      (p.levelLog.length ? '<div class="card"><b>Level over time</b><div class="mu" style="margin-top:6px">' + p.levelLog.map(l => dateStr(l[0]) + ' → ' + esc(l[1])).join('<br>') + '</div></div>' : '') +
      '<div class="card"><b>About you</b><div class="mu" style="margin:6px 0">Your birthday and daily goal stay on this phone. The AI only ever gets your age as a number, to pick suitable examples, and only if you leave this on.</div>' +
      '<label class="mu">Birthday</label><input type="date" id="sl-bd" value="' + esc(pr.birthday || '') + '"><label class="mu" style="display:block;margin-top:8px">Daily goal (minutes)</label><input type="number" id="sl-goal" min="0" max="600" value="' + (pr.goalMin || '') + '">' +
      '<label class="mu" style="display:block;margin-top:8px"><input type="checkbox" id="sl-share"' + (pr.shareAge !== false ? ' checked' : '') + ' style="width:auto"> Let the AI know my age</label><div class="row"><button class="b pri" data-sl="saveprofile">Save</button></div><div id="sl-pm" class="mu"></div></div>';
  }
  function saveProfile() {
    try { B.setProfile({ birthday: $('sl-bd').value, goalMin: $('sl-goal').value, shareAge: $('sl-share').checked }); $('sl-pm').textContent = 'Saved.' + (B.ageYears() ? ' Age ' + B.ageYears() + '.' : ''); }
    catch (e) { $('sl-pm').innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }
  }

  /* ---------------------------------------------------------------- events */
  root.addEventListener('click', e => {
    const q = e.target.closest('[data-q]'); if (q && screen === 'practice') return rate(+q.dataset.q);
    const w = e.target.closest('.sent .w'); if (w && screen === 'practice') return tapWord(w);
    const a = e.target.closest('[data-sl]'); if (!a) return;
    const k = a.dataset.sl;
    if (k === 'close') close();
    else if (k === 'say') { const c = st.q && st.q[st.i]; if (c) say(c.text); }
    else if (k === 'reveal') reveal();
    else if (k === 'again') practice();
    else if (k === 'oldrev') { window.__slOldRev = true; close(); const b = document.querySelector('#cards [data-p="rev"]'); if (b) b.click(); window.__slOldRev = false; }
    else if (k === 'check') check();
    else if (k === 'why') why();
    else if (k === 'conj' || k === 'conjmore') conj();
    else if (k === 'csv') csv();
    else if (k === 'saveprofile') saveProfile();
  });
  root.addEventListener('change', e => {
    const t = e.target.closest('[data-sl]'); if (!t || screen !== 'words') return;
    if (t.dataset.sl === 'sort') st.sort = t.value; else if (t.dataset.sl === 'filter') st.status = t.value; else return;
    wordsView();
  });

  /* ---------------------------------------------------------------- the hub on the profile page */
  function paintHub() {
    const c = $('brain'); if (!c || c.querySelector('[data-hub]')) return;
    const due = B.stats().on ? B.progress().cardsDue : 0;
    const h = document.createElement('div'); h.dataset.hub = '1'; h.className = 'hub';
    h.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">' +
      '<button data-open="practice" class="pri" style="margin:0">📝 Practice sentences' + (due ? ' (' + due + ')' : '') + '</button><button data-open="conj" style="margin:0">🔤 Conjugation</button><button data-open="words" style="margin:0">📊 Your words</button><button data-open="progress" style="margin:0">📈 Progress</button></div>';
    c.appendChild(h);
  }
  /* The Cards tab: "Start Learning" is the AI sentence practice (every sentence written by the AI at your level, I+1). */
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#cards [data-p="rev"]');
    if (!b || window.__slOldRev || !B.state().on) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); open('practice');
  }, true);
  function paintDue() {
    const h = $('hdue'); if (!h || !B.state().on) return;
    let n = 0; try { n = B.progress().cardsDue; } catch (_) { /* no brain yet */ }
    const lvl = B.level(); h.textContent = (n ? n + ' AI sentence' + (n === 1 ? '' : 's') + ' due' : 'AI sentences for your level') + (lvl && lvl.level ? ' · ' + lvl.level : '');
  }
  (function wrapRender() {
    if (typeof window.render !== 'function' || window.render.__sl) return;
    const r0 = window.render;
    window.render = function () { const x = r0.apply(this, arguments); try { paintDue(); } catch (_) { /* ignore */ } return x; };
    window.render.__sl = true;
  })();
  B.on(ev => { if (ev === 'card' || ev === 'cards' || ev === 'assessed' || ev === 'option') setTimeout(paintDue, 0); });
  document.addEventListener('click', e => { const o = e.target.closest && e.target.closest('[data-open]'); if (o && (o.dataset.open in { practice: 1, conj: 1, words: 1, progress: 1 })) open(o.dataset.open); });
  setTimeout(paintDue, 600);
  window.SafinaLearn = { open, close, paintHub };
  B.on(ev => { if (ev === 'assessed' || ev === 'option' || ev === 'reset' || ev === 'cards') setTimeout(paintHub, 0); });
  setInterval(paintHub, 1500);
})();
