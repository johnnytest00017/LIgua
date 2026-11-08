/* Safina learner brain.
 *
 * It watches what the learner does while watching, works out which words they know, judges whether each sentence was
 * understood, and has the AI (on-phone model or an API account, whichever the AI engine picks) assess the lines and write
 * flashcards at the learner's level.
 *
 * Signals the page sends:
 *   lineShown(text)            a subtitle line was on screen
 *   lineReplayed(text)         the learner went back to it (a hint that it was not understood)
 *   wordTapped(word, text)     the learner looked a word up: strong sign it is not known
 *   saved(word, text)          the learner saved the word to flashcards
 *   reviewed(word, ok)         a flashcard answer
 *
 * What it gives back:
 *   wordP(word)                estimated chance the learner knows the word, 0..1
 *   lineView(text)            { state: 'yes' | 'maybe' | 'no', unknown: [...], why } for one sentence
 *   assess()                   asks the AI to judge recent lines, refine word estimates and propose flashcards
 *   profileText()              a short summary for the AI tutor
 *   rank(lines)                orders sentences by how much practice they would give
 *
 * "yes / maybe / no" follows one rule: missing a word or two usually still means the sentence was understood, missing up to
 * three may still be understood from context, more than that probably was not. The AI refines this per line.
 *
 * Nothing here talks to the network itself. The page gives it an `ai` object (the shared engine), so limits, account
 * switching and the on-phone fallback all work the same as everywhere else in the app.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SafinaBrain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'safina.brain.v1';
  const DAY = 864e5;
  const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ֑-ׇ]/g;   // Arabic and Hebrew marks, tatweel

  const norm = w => String(w || '').normalize('NFC').replace(MARKS, '').toLowerCase().trim();
  const tokens = text => Array.from(String(text || '').matchAll(/[\p{L}\p{M}\p{N}]+/gu), m => ({ w: m[0], k: norm(m[0]) })).filter(t => t.k && !/^\d+$/.test(t.k));
  const lineKey = text => tokens(text).map(t => t.k).join(' ');
  const logit = p => Math.log(p / (1 - p));
  const sigmoid = x => 1 / (1 + Math.exp(-x));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  function create(deps) {
    deps = deps || {};
    const now = deps.now || Date.now;
    const store = deps.store || { get: (k, d) => d, set: () => {} };
    const ai = deps.ai;
    const listeners = [];

    const fresh = () => ({ v: 2, on: true, every: 12, words: {}, lines: {}, order: [], level: '', levelAt: 0, dirty: 0, report: null, cards: [], seq: 0, days: {}, profile: { birthday: '', goalMin: 0, shareAge: true }, conj: { bank: [], seq: 0 }, levelLog: [], cardError: '' });
    let S = Object.assign(fresh(), store.get(KEY, null) || {});
    let saveT = null, running = false, session = new Set();
    const migrate = () => { Object.keys(S.words).forEach(k => { const r = S.words[k]; if (!r.hist) Object.assign(r, { hist: [], srcs: {}, first: 0, src: '', firstTap: 0, streak: 0, ivl: 0, ease: 2.5, due: 0, lastOk: 0, stage: 0, easyAt: 0, lostAt: 0, repsAtEasy: 0, ttl: 0 }); }); };   // records saved by the first version

    const emit = (ev, d) => listeners.forEach(l => { try { l(ev, d); } catch (_) { /* a listener must not break learning */ } });
    const on = f => { listeners.push(f); };
    function save() {
      if (saveT) return;
      saveT = setTimeout(() => { saveT = null; flush(); }, 400);
    }
    function flush() {
      if (saveT) { clearTimeout(saveT); saveT = null; }
      prune();
      store.set(KEY, S);
    }
    function prune() {
      const ks = Object.keys(S.words);
      if (ks.length > 6000) ks.sort((a, b) => (S.words[a].last || 0) - (S.words[b].last || 0)).slice(0, ks.length - 5000).forEach(k => { delete S.words[k]; });
      if (S.order.length > 500) S.order.splice(0, S.order.length - 400).forEach(h => { delete S.lines[h]; });
    }

    const word = (w) => {
      const k = norm(w);
      if (!k) return null;
      const r = S.words[k] || (S.words[k] = { w: String(w), ex: 0, tp: 0, sv: 0, ok: 0, miss: 0, last: 0, tpAt: 0, ai: null });
      if (!r.hist) Object.assign(r, { hist: [], srcs: {}, first: 0, src: '', firstTap: 0, streak: 0, ivl: 0, ease: 2.5, due: 0, lastOk: 0, stage: 0, easyAt: 0, lostAt: 0, repsAtEasy: 0, ttl: 0 });
      return r;
    };

    /* chance the learner knows this word */
    function wordP(w) {
      const r = S.words[norm(w)];
      if (!r) return 0.3;                                     // never seen: more likely unknown than known
      let x = logit(0.3);
      x += Math.min(Math.max(r.ex - r.tp, 0), 8) * 0.22;      // met it again and again without looking it up
      x -= Math.min(r.tp, 3) * 1.5;                           // looked it up
      x -= r.sv ? 0.8 : 0;                                    // chose to save it
      x += Math.min(r.ok, 4) * 1.0;                           // answered it right
      x -= Math.min(r.miss, 3) * 1.4;                         // answered it wrong
      let p = sigmoid(x);
      if (r.lastOk && p > 0.3) {                               // forgetting: what was answered right fades back toward "not sure" as time passes
        const st = Math.max(1, r.ivl || 1) * 3, d = Math.max(0, now() - r.lastOk) / DAY;
        p = 0.3 + (p - 0.3) * Math.exp(-d / st);
      }
      if (r.ai && typeof r.ai.p === 'number') {
        p = 0.55 * r.ai.p + 0.45 * p;
        if (r.tpAt > r.ai.at) p = Math.min(p, 0.35);          // looked it up after the AI's guess: the learner just told us
      }
      return clamp(p, 0.02, 0.98);
    }

    /* ---------------- signals ---------------- */
    function line(text) {
      const k = lineKey(text);
      if (!k) return null;
      if (!S.lines[k]) { S.lines[k] = { t: String(text).trim(), shown: 0, replay: 0, taps: [], at: now(), ai: null }; S.order.push(k); }
      return S.lines[k];
    }
    function lineShown(text, o) {
      const L = line(text), src = (o && o.src) || '';
      if (!L) return;
      const k = lineKey(text);
      if (session.has(k)) return;                             // count a line once per viewing session
      session.add(k);
      L.shown++; L.at = now(); if (src && !L.src) L.src = src;
      tokens(text).forEach(t => {
        const r = word(t.w);
        if (!r.first) { r.first = now(); r.src = src; day('newWords', 1); }
        r.ex++; r.last = now();
        if (src) { r.srcs[src] = (r.srcs[src] || 0) + 1; const ks = Object.keys(r.srcs); if (ks.length > 6) delete r.srcs[ks[0]]; }
      });
      day('lines', 1);
      S.dirty++; save(); emit('line', k);
    }
    function lineReplayed(text) {
      const L = line(text);
      if (!L) return;
      L.replay++; L.ai = null; day('replays', 1); S.dirty++; save(); emit('line', lineKey(text));
    }
    function wordTapped(w, text) {
      const r = word(w);
      if (!r) return;
      r.tp++; r.tpAt = now(); r.last = now(); if (!r.firstTap) r.firstTap = now(); day('taps', 1);
      const L = line(text);
      if (L) { const k = norm(w); if (!L.taps.includes(k)) L.taps.push(k); L.ai = null; }
      S.dirty++; save(); emit('word', norm(w));
      if (L) emit('line', lineKey(text));
    }
    function saved(w, text) { const r = word(w); if (r) { r.sv++; r.tpAt = r.tpAt || now(); save(); emit('word', norm(w)); } if (text) line(text); }
    /* an answer about one word. q: 0 again, 1 hard, 2 good, 3 easy. Keeps the word's own schedule, streak, stage and "became easy" time. */
    function reviewWord(w, q, ms) {
      const r = word(w);
      if (!r) return;
      q = clamp(Math.round(+q || 0), 0, 3);
      r.hist.push([now(), q, ms || 0]); if (r.hist.length > 40) r.hist.shift();
      r.last = now();
      const wasEasy = !!r.easyAt;
      if (q === 0) {
        r.miss++; r.streak = 0; r.ease = Math.max(1.3, (r.ease || 2.5) - 0.2); r.ivl = 0; r.due = now();
        r.stage = Math.max(0, (r.stage || 0) - 1); if (wasEasy) r.lostAt = now();
      } else {
        r.ok++; r.streak = (r.streak || 0) + 1;
        const e = r.ease || 2.5;
        r.ivl = (r.ivl || 0) < 1 ? (q === 3 ? 3 : 1) : Math.round(r.ivl * e * (q === 1 ? 0.8 : q === 3 ? 1.4 : 1) * 10) / 10;
        r.ease = e + (q === 3 ? 0.1 : q === 1 ? -0.1 : 0); r.due = now() + r.ivl * DAY; r.lastOk = now();
        r.stage = Math.min(3, (r.stage || 0) + (q >= 2 ? 1 : 0));
        if (r.lostAt && r.streak >= 2) r.lostAt = 0;
        if (!r.easyAt && r.streak >= 3) { r.easyAt = now(); r.repsAtEasy = r.hist.length; r.ttl = r.easyAt - (r.firstTap || r.first || r.easyAt); day('learned', 1); }
      }
      save(); emit('word', norm(w));
    }
    const reviewed = (w, ok) => reviewWord(w, ok ? 2 : 0);

    /* ---------------- reading the signals ---------------- */
    function lineView(text) {
      const toks = tokens(text), L = S.lines[lineKey(text)];
      if (!toks.length) return { state: 'yes', unknown: [], n: 0, why: '' };
      const tapped = new Set(L ? L.taps : []);
      const seen = new Set(), unknown = [];
      toks.forEach(t => {
        if (seen.has(t.k)) return;
        seen.add(t.k);
        if (tapped.has(t.k) || wordP(t.w) < 0.5) unknown.push(t.w);
      });
      const n = seen.size, u = unknown.length, frac = u / n;
      let state = (u === 0 || (u <= 1 && frac <= 0.15)) ? 'yes' : (u <= 3 && frac <= 0.5) ? 'maybe' : 'no';
      let why = u === 0 ? 'You know every word here.' : u + ' word' + (u > 1 ? 's' : '') + ' you may not know.';
      if (L && L.replay && state !== 'no') { state = state === 'yes' ? 'maybe' : 'no'; why += ' You went back to this line.'; }
      if (L && L.ai && !(L.taps.length && L.ai.at < (lastTap(L) || 0))) { state = L.ai.state; why = L.ai.why || why; }
      return { state, unknown, n, why, byAI: !!(L && L.ai) };
    }
    function lastTap(L) { return Math.max(0, ...L.taps.map(k => (S.words[k] && S.words[k].tpAt) || 0)); }

    function level() {
      if (S.level) return { level: S.level, estimated: false };
      const known = Object.keys(S.words).filter(k => wordP(k) >= 0.7).length;
      return { level: known < 150 ? 'A1' : known < 500 ? 'A2' : known < 1500 ? 'B1' : known < 3500 ? 'B2' : 'C1', estimated: true };
    }
    function stats() {
      const ks = Object.keys(S.words);
      const known = ks.filter(k => wordP(k) >= 0.7).length, learning = ks.filter(k => { const p = wordP(k); return p < 0.7 && p >= 0.35; }).length;
      return { tracked: ks.length, known, learning, level: level().level, levelEstimated: level().estimated, lines: S.order.length, report: S.report, on: S.on };
    }
    function profileText() {
      const lv = level(), ks = Object.keys(S.words);
      const hard = ks.filter(k => S.words[k].tp > 0).sort((a, b) => S.words[b].tp - S.words[a].tp || S.words[b].tpAt - S.words[a].tpAt).slice(0, 12).map(k => S.words[k].w);
      const known = ks.filter(k => wordP(k) >= 0.8).length;
      return 'Learner level: ' + lv.level + (lv.estimated ? ' (estimated)' : '') + '. About ' + known + ' words known.' +
        (hard.length ? ' Recently looked up: ' + hard.join(', ') + '.' : '') + ' Pitch explanations at this level and reuse words they know.';
    }
    /* sentences worth practising first: the ones with the most words the learner does not know yet, never ones they know entirely */
    function rank(list) {
      return list.map((x, i) => {
        const toks = tokens(x.text !== undefined ? x.text : x);
        const seen = new Set(); let gap = 0;
        toks.forEach(t => { if (!seen.has(t.k)) { seen.add(t.k); gap += 1 - wordP(t.w); } });
        return { x, i, score: seen.size ? gap / Math.sqrt(seen.size) : 0 };
      }).sort((a, b) => b.score - a.score || a.i - b.i).map(o => o.x);
    }

    /* ---------------- AI assessment ---------------- */
    const isLocal = tier => !!(deps.isLocal && deps.isLocal(tier || 'heavy'));
    function candidates(force) {
      const small = isLocal('heavy'), cap = small ? 3 : 10;
      const hs = S.order.slice().reverse().filter(h => S.lines[h] && !S.lines[h].ai);
      const hot = hs.filter(h => S.lines[h].taps.length || S.lines[h].replay), cold = hs.filter(h => !hot.includes(h));
      const pick = hot.concat(cold).slice(0, cap);
      const taps = hot.reduce((n, h) => n + S.lines[h].taps.length, 0);
      return (force || pick.length >= Math.min(S.every, cap) || taps >= 2) ? pick : [];
    }
    function buildPrompt(hs) {
      const small = isLocal('heavy'), lv = level();
      const ks = Object.keys(S.words);
      const hard = ks.filter(k => S.words[k].tp > 0).sort((a, b) => S.words[b].tpAt - S.words[a].tpAt).slice(0, small ? 8 : 30).map(k => S.words[k].w);
      const known = ks.filter(k => wordP(k) >= 0.8).sort((a, b) => S.words[b].ex - S.words[a].ex).slice(0, small ? 12 : 60).map(k => S.words[k].w);
      const L = (deps.lang && deps.lang()) || { learn: 'the language', native: 'English' };
      const lines = hs.map((h, i) => ({ i, text: S.lines[h].t, tapped: S.lines[h].taps.map(k => (S.words[k] && S.words[k].w) || k), replayed: S.lines[h].replay > 0, estimate: lineView(S.lines[h].t).state }));
      const data = { learning: L.learnName || L.learn, native: L.nativeName || L.native, level_guess: S.level || (lv.estimated ? lv.level + ' (rough)' : lv.level), known_words: known, struggling_words: hard, lines };
      const age = ageYears(); if (age && S.profile.shareAge !== false) data.learner_age = age;
      return 'Learner data:\n' + JSON.stringify(data) + '\n\n' +
        'Do this:\n' +
        '1. For each line decide "understood": "yes", "maybe" or "no". A learner who misses one to three words can still understand a sentence from context; judge by whether the missing words carry the meaning. Give a short "why" (under 12 words).\n' +
        '2. "key_unknown": up to 3 dictionary forms from that line worth studying. Skip names and very rare words.\n' +
        '3. "words": for words in the lines that are not in known_words or struggling_words, estimate p_known from 0 to 1 for this level.\n' +
        '4. "level": your CEFR estimate (A1 to C2) of this learner.\n' +
        '5. "cards": at most ' + (small ? 3 : 6) + ' flashcards, fitted to the level. A1-A2: mostly type "word" with the sentence it came from. B1 and up: prefer type "line" for sentences with grammar or idioms they missed, and skip simple words. Each card: {"type":"word"|"line","lemma":"dictionary form","word":"form as it appeared","meaning":"short meaning in ' + (L.nativeName || L.native) + ' (for a line: the whole translation)","sentence":"the line it came from","hint":"one short memory hint or grammar note","why":"under 10 words"}.\n' +
        'Reply with JSON only: {"level":"","lines":[{"i":0,"understood":"","why":"","key_unknown":[]}],"words":[{"w":"","p_known":0.5}],"cards":[]}';
    }
    const SYSTEM = 'You are the learning brain of a language-learning app. You judge what a learner understood and decide what they should study next. You reply with JSON only.';

    async function assess(opts) {
      opts = opts || {};
      if (running || !S.on || !ai) return { skipped: running ? 'busy' : 'off' };
      if (deps.ready && !deps.ready()) return { skipped: 'no AI available' };
      const hs = candidates(!!opts.force);
      if (!hs.length) return { skipped: 'not enough new lines yet' };
      running = true; emit('assessing', true);
      try {
        const r = await ai.chat({ system: SYSTEM, messages: [{ r: 'me', t: buildPrompt(hs) }], tier: 'heavy', purpose: 'assess-watching', quiet: true });
        const j = (deps.parseJSON || JSON.parse)(r.text);
        if (!j || typeof j !== 'object' || !Array.isArray(j.lines)) throw new Error('The AI did not return an assessment.');
        const at = now();
        let judged = 0;
        j.lines.forEach(o => {
          const h = hs[+o.i], st = String(o.understood || '').toLowerCase();
          if (!h || !S.lines[h] || !['yes', 'maybe', 'no'].includes(st)) return;
          S.lines[h].ai = { state: st, why: String(o.why || '').slice(0, 90), key: Array.isArray(o.key_unknown) ? o.key_unknown.slice(0, 3).map(String) : [], at };
          judged++;
        });
        (Array.isArray(j.words) ? j.words : []).forEach(o => {
          const w = o && (o.w || o.word), p = Number(o && o.p_known);
          if (!w || !isFinite(p)) return;
          const rec = word(w);
          if (rec) rec.ai = { p: clamp(p, 0.02, 0.98), at };
        });
        const lv = String(j.level || '').toUpperCase().slice(0, 2);
        if (LEVELS.includes(lv)) { if (S.level !== lv) S.levelLog.push([at, lv]); S.level = lv; S.levelAt = at; }
        // lines in this batch the AI skipped are marked as looked at, so the same ones are not sent forever
        hs.forEach(h => { if (S.lines[h] && !S.lines[h].ai) S.lines[h].ai = { state: lineView(S.lines[h].t).state, why: '', key: [], at, soft: true }; });
        let added = 0;
        if (Array.isArray(j.cards) && deps.addCards) {
          const cards = j.cards.filter(c => c && (c.lemma || c.word) && c.meaning).slice(0, small() ? 3 : 6).map(c => ({
            type: c.type === 'line' ? 'line' : 'word', lemma: String(c.lemma || c.word), word: String(c.word || c.lemma),
            meaning: String(c.meaning), sentence: String(c.sentence || ''), hint: String(c.hint || ''), why: String(c.why || ''), level: S.level || ''
          }));
          added = cards.length ? (deps.addCards(cards) || 0) : 0;
        }
        S.dirty = 0;
        S.report = { at, lines: judged, cards: added, level: S.level || level().level, via: r.via && r.via.label || '' };
        flush(); emit('assessed', S.report);
        return S.report;
      } catch (e) {
        S.report = { at: now(), error: String(e && e.message || e) };
        save(); emit('assessed', S.report);
        return S.report;
      } finally { running = false; emit('assessing', false); }
    }
    const small = () => isLocal('heavy');
    /* called by the page after each line: runs the assessment in the background when enough has happened */
    function tick() {
      if (!S.on || running || S.dirty < S.every) return;
      if (S.report && S.report.error && now() - S.report.at < 5 * 60 * 1000) return;   // do not hammer a failing AI
      assess().catch(() => { /* reported through the 'assessed' event */ });
    }

    function setOption(k, v) { if (k === 'on') S.on = !!v; else if (k === 'every') S.every = clamp(+v || 12, 4, 40); save(); emit('option', k); }
    function reset() { S = fresh(); session = new Set(); flush(); emit('reset'); }
    function newSession() { session = new Set(); }

    /* ================================================================== activity, profile */
    const dayKey = () => new Date(now()).toISOString().slice(0, 10);
    function day(k, n) {
      const d = S.days[dayKey()] || (S.days[dayKey()] = {});
      d[k] = (d[k] || 0) + (n == null ? 1 : n);
      const ks = Object.keys(S.days);
      if (ks.length > 400) ks.sort().slice(0, ks.length - 365).forEach(x => { delete S.days[x]; });
      save();
    }
    /* the page reports: track('watch', seconds), track('pauses'), track('pauseSec', s), track('seeks') ... */
    const track = (k, n) => { if (S.on) day(k, n); };

    function ageYears() {
      const b = S.profile && S.profile.birthday;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b || '')) return 0;
      const bd = new Date(b + 'T00:00:00Z'), nd = new Date(now());
      let a = nd.getUTCFullYear() - bd.getUTCFullYear();
      if (nd.getUTCMonth() < bd.getUTCMonth() || (nd.getUTCMonth() === bd.getUTCMonth() && nd.getUTCDate() < bd.getUTCDate())) a--;
      return a >= 3 && a <= 110 ? a : 0;
    }
    function setProfile(o) {
      o = o || {};
      if (o.birthday !== undefined) {
        if (o.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(o.birthday)) throw new Error('Birthday must look like 2001-05-23');
        const keep = S.profile.birthday; S.profile.birthday = o.birthday || '';
        if (o.birthday && !ageYears()) { S.profile.birthday = keep; throw new Error('That birthday does not look right'); }
      }
      if (o.goalMin !== undefined) S.profile.goalMin = clamp(+o.goalMin || 0, 0, 600);
      if (o.shareAge !== undefined) S.profile.shareAge = !!o.shareAge;
      save(); emit('profile');
    }

    /* ================================================================== lost words, the word table, progress */
    function isLost(k) {
      const r = S.words[k];
      return !!r && (r.ok >= 2 || !!r.easyAt) && (!!r.lostAt || wordP(k) < 0.5);
    }
    const lostWords = n => Object.keys(S.words).filter(isLost).sort((a, b) => (S.words[a].due || 0) - (S.words[b].due || 0)).slice(0, n || 50);
    function status(k) {
      const r = S.words[k];
      if (isLost(k)) return 'lost';
      if (r.easyAt) return 'known';
      if (r.tp || r.sv || r.hist.length) return 'learning';
      return wordP(k) >= 0.7 ? 'known' : 'new';
    }
    /* one row per word: where it was first met, how often, how long and how many repetitions it took to become easy */
    function wordTable(o) {
      o = o || {};
      const rows = Object.keys(S.words).map(k => {
        const r = S.words[k], qs = r.hist.map(h => h[1]);
        return {
          word: r.w, key: k, status: status(k), p: Math.round(wordP(k) * 100) / 100, firstSeen: r.first || 0, firstSource: r.src || '',
          sources: Object.keys(r.srcs), encounters: r.ex, lookups: r.tp, saved: r.sv, reviews: r.hist.length,
          avgRating: qs.length ? Math.round(qs.reduce((a, b) => a + b, 0) / qs.length * 100) / 100 : null,
          daysToLearn: r.easyAt ? Math.round(r.ttl / DAY * 10) / 10 : null, repsToEasy: r.easyAt ? r.repsAtEasy : null,
          nextDue: r.due || 0, stage: r.stage || 0
        };
      }).filter(x => !o.status || x.status === o.status);
      const by = o.sort || 'lookups';
      rows.sort((a, b) => (typeof a[by] === 'string' ? String(a[by]).localeCompare(String(b[by])) : (b[by] == null ? -1e9 : b[by]) - (a[by] == null ? -1e9 : a[by])) || a.word.localeCompare(b.word));
      return rows.slice(0, o.limit || 500);
    }
    function wordAverages() {
      const learned = Object.keys(S.words).map(k => S.words[k]).filter(r => r.easyAt);
      const avg = f => learned.length ? Math.round(learned.reduce((a, r) => a + f(r), 0) / learned.length * 10) / 10 : null;
      const lk = Object.keys(S.words).map(k => S.words[k]).filter(r => r.tp);
      return {
        learned: learned.length, avgDaysToLearn: avg(r => r.ttl / DAY), avgRepsToEasy: avg(r => r.repsAtEasy),
        avgEncountersBeforeLookup: lk.length ? Math.round(lk.reduce((a, r) => a + Math.max(0, r.ex - r.tp), 0) / lk.length * 10) / 10 : null,
        lost: Object.keys(S.words).filter(isLost).length
      };
    }
    function progress() {
      const keys = Object.keys(S.days).sort(), sum = {};
      keys.forEach(d => Object.keys(S.days[d]).forEach(k => { sum[k] = (sum[k] || 0) + S.days[d][k]; }));
      const series = []; // last 14 calendar days
      for (let i = 13; i >= 0; i--) { const d = new Date(now() - i * DAY).toISOString().slice(0, 10); series.push(Object.assign({ date: d }, S.days[d] || {})); }
      let streak = 0;
      for (let i = 0; i < 400; i++) {
        const d = S.days[new Date(now() - i * DAY).toISOString().slice(0, 10)];
        if (d && ((d.watch || 0) > 30 || d.reviews || d.conj)) streak++; else if (i > 0) break;
      }
      const recent = S.cards.flatMap(c => c.hist).filter(h => now() - h[0] < 30 * DAY);
      const lines = S.order.map(h => S.lines[h]).filter(l => l && l.ai && !l.ai.soft).slice(-60), cnt = { yes: 0, maybe: 0, no: 0 };
      lines.forEach(l => { cnt[l.ai.state]++; });
      return {
        totals: sum, series, streak, age: ageYears(), level: level(), levelLog: S.levelLog.slice(-12),
        retention: recent.length ? Math.round(recent.filter(h => h[1] >= 2).length / recent.length * 100) : null,
        avgDifficulty: recent.length ? Math.round(recent.reduce((a, h) => a + h[1], 0) / recent.length * 100) / 100 : null,
        avgSecondsPerCard: recent.length ? Math.round(recent.reduce((a, h) => a + (h[2] || 0), 0) / recent.length / 1000) : null,
        understanding: lines.length ? { yes: cnt.yes, maybe: cnt.maybe, no: cnt.no, n: lines.length } : null,
        words: wordAverages(), cardsTotal: S.cards.length, cardsDue: S.cards.filter(c => c.due <= now()).length
      };
    }

    /* ================================================================== sentence flashcards: known words + one new word, getting harder step by step */
    /* stage 0: every other word known, short.  1: one other unknown.  2: two, longer.  3: the real, full sentence from the video. */
    const STAGES = [{ maxOther: 0, maxLen: 7 }, { maxOther: 1, maxLen: 10 }, { maxOther: 2, maxLen: 14 }, { maxOther: 3, maxLen: 22 }];
    const cardOf = id => S.cards.find(c => c.id === id);
    function liveTargets() { const a = new Set(); S.cards.forEach(c => { if (!c.reps || c.ivl < 14) c.targets.forEach(k => a.add(k)); }); return a; }
    /* which words to build the next cards around: lost words first, then ones the learner looked up or saved, then ones the AI flagged */
    function targets(n) {
      const live = liveTargets(), out = new Map();
      const add = (k, why, score) => { if (!S.words[k] || live.has(k)) return; const o = out.get(k); if (!o || o.score < score) out.set(k, { k, why, score }); };
      lostWords(40).forEach(k => add(k, 'you used to know it', 4));
      Object.keys(S.words).forEach(k => {
        const r = S.words[k], p = wordP(k);
        if (r.tp && p < 0.6) add(k, 'you looked it up', 3 + Math.min(1, (r.tpAt || 0) / (now() + 1)));
        else if (r.sv && p < 0.6) add(k, 'you saved it', 2.6);
        else if (r.ex >= 4 && p < 0.45) add(k, 'it keeps coming up', 1.5);
      });
      S.order.slice(-80).forEach(h => { const L = S.lines[h]; if (L && L.ai && L.ai.key) L.ai.key.forEach(w => { const k = norm(w); if (S.words[k] && wordP(k) < 0.6) add(k, 'key word of a line', 2); }); });
      return Array.from(out.values()).sort((a, b) => b.score - a.score).slice(0, n);
    }
    const unknownIn = (text, exceptKey) => { const seen = new Set(); let u = 0; tokens(text).forEach(t => { if (t.k === exceptKey || seen.has(t.k)) return; seen.add(t.k); if (wordP(t.w) < 0.5) u++; }); return u; };
    /* a sentence the learner has already met that fits this target at this stage, so no AI is needed */
    function findLine(k, spec) {
      let best = null;
      S.order.slice().reverse().forEach(h => {
        const L = S.lines[h]; if (!L) return;
        const toks = tokens(L.t); if (toks.length < 3 || toks.length > spec.maxLen || !toks.some(t => t.k === k)) return;
        const u = unknownIn(L.t, k); if (u > spec.maxOther) return;
        const score = u * 10 + toks.length;
        if (!best || score < best.score) best = { text: L.t, src: L.src || '', score };
      });
      return best;
    }
    /* the most recent line where the learner met this word, and which of its other words they understood or not */
    function contextFor(k) {
      for (let i = S.order.length - 1; i >= 0; i--) {
        const L = S.lines[S.order[i]]; if (!L) continue;
        const toks = tokens(L.t); if (!toks.some(t => t.k === k)) continue;
        const seen = new Set(), understood = [], notUnderstood = [];
        toks.forEach(t => { if (t.k === k || seen.has(t.k)) return; seen.add(t.k); ((L.taps || []).includes(t.k) || wordP(t.w) < 0.5 ? notUnderstood : understood).push(t.w); });
        return { text: L.t, src: L.src || '', understood: understood.slice(0, 8), notUnderstood: notUnderstood.slice(0, 8) };
      }
      return null;
    }
    function addCard(o) {
      const key = lineKey(o.text); if (!key || S.cards.some(c => lineKey(c.text) === key)) return null;
      const c = { id: 'c' + (++S.seq), text: String(o.text).trim(), tr: o.tr || '', hint: o.hint || '', targets: o.targets.map(norm), src: o.src || 'video', from: o.from || '', stage: o.stage || 0,
        met: String(o.met || '').slice(0, 300), created: now(), due: now(), ivl: 0, ease: 2.5, reps: 0, hist: [] };
      S.cards.push(c);
      if (S.cards.length > 400) { const gone = S.cards.filter(x => x.ivl >= 30).sort((a, b) => a.due - b.due)[0] || S.cards[0]; S.cards.splice(S.cards.indexOf(gone), 1); }
      return c;
    }
    function checkSentence(text, form, spec) {
      const toks = tokens(text), fk = norm(form);
      if (toks.length < 3 || toks.length > spec.maxLen + 2) return 'wrong length';
      if (!toks.some(t => t.k === fk)) return 'does not contain the word';
      if (unknownIn(text, fk) > spec.maxOther + 1) return 'uses too many words you do not know';
      return '';
    }
    function cardPrompt(need) {
      const small = isLocal('heavy'), L = (deps.lang && deps.lang()) || { learn: 'the language', native: 'English' }, lv = level();
      const ks = Object.keys(S.words);
      const known = ks.filter(k => wordP(k) >= 0.8).sort((a, b) => S.words[b].ex - S.words[a].ex).slice(0, small ? 25 : 80).map(k => S.words[k].w);
      const data = { learning: L.learnName || L.learn, native: L.nativeName || L.native, level: S.level || lv.level, known_words: known,
        items: need.map((t, i) => { const sp = STAGES[S.words[t.k].stage || 0], cx = contextFor(t.k); return { i, target: S.words[t.k].w, why: t.why, other_unknown_words_allowed: sp.maxOther, max_words: sp.maxLen,
          met_in_this_line: cx ? cx.text : '', understood_in_that_line: cx ? cx.understood : [], not_understood_in_that_line: cx ? cx.notUnderstood : [] }; }) };
      const age = ageYears(); if (age && S.profile.shareAge !== false) data.learner_age = age;
      return 'Learner data:\n' + JSON.stringify(data) + '\n\nFor each item write ONE NEW natural sentence in ' + data.learning + ' that uses the target word. Follow the i+1 principle: "i" is what the learner knows now (known_words, plus the words they understood in the line where they met the target), and "+1" is the target word, slightly above their level, so they can work out its meaning from the rest of the sentence. Build the sentence from known_words plus the target; other_unknown_words_allowed is how many other new words you may add. Do not copy met_in_this_line: write a different sentence that shows the target in a fresh context. ' +
        'Keep it at most max_words words, everyday and suitable for the learner\'s age and level. Give "form": the target exactly as it appears in your sentence. Give "meaning": the sentence translated into ' + data.native + ', and "hint": one short memory or grammar tip (under 12 words).\n' +
        'Reply with JSON only: {"cards":[{"i":0,"form":"","text":"","meaning":"","hint":""}]}';
    }
    const CARD_SYSTEM = 'You write sentence flashcards for a language learner, one new word at a time, using words the learner already knows. You reply with JSON only.';
    let preparing = false;
    /* make sure there are enough new cards. The AI writes each sentence (known words + the one new word, i+1), using what the learner
     * met and understood. Sentences from the video are only the fallback when the AI is not available or its sentence does not fit. */
    async function prepare(o) {
      o = o || {};
      if (preparing || !S.on) return { skipped: preparing ? 'busy' : 'off' };
      const want = Math.max(1, o.count || 6) - S.cards.filter(c => !c.reps).length;
      if (want <= 0) return { made: 0, fromLines: 0, fromAI: 0 };
      preparing = true; emit('preparing', true);
      const res = { made: 0, fromLines: 0, fromAI: 0, error: '' };
      try {
        const ts = targets(want * 2), ask = ts.slice(0, want), useAI = !!ai && (!deps.ready || deps.ready());
        const done = new Set();
        if (useAI && ask.length) {
          try {
            const r = await ai.chat({ system: CARD_SYSTEM, messages: [{ r: 'me', t: cardPrompt(ask) }], tier: 'heavy', purpose: 'write-flashcards', quiet: true });
            const j = (deps.parseJSON || JSON.parse)(r.text);
            if (!j || !Array.isArray(j.cards)) throw new Error('The AI did not return flashcards.');
            const weak = [];
            j.cards.forEach(c => {
              const t = ask[+c.i]; if (!t || done.has(t.k) || !c.text || !c.form) return;
              const spec = STAGES[S.words[t.k].stage || 0], bad = checkSentence(String(c.text), String(c.form), spec), cx = contextFor(t.k);
              const card = { text: String(c.text), tr: String(c.meaning || ''), hint: String(c.hint || ''), targets: [t.k], src: 'ai', stage: S.words[t.k].stage || 0, met: cx ? cx.text : '', from: cx ? cx.src : '' };
              if (!bad) { if (addCard(card)) { res.fromAI++; res.made++; done.add(t.k); } }
              else if (bad === 'uses too many words you do not know') weak.push({ t, card, u: unknownIn(card.text, norm(c.form)) });
            });
            /* a learner who knows very little yet cannot get a perfect i+1 sentence: take the closest ones instead of nothing */
            if (!res.fromAI) weak.sort((x, y) => x.u - y.u).slice(0, want).forEach(w => { if (w.u <= STAGES[S.words[w.t.k].stage || 0].maxOther + 3 && addCard(w.card)) { res.fromAI++; res.made++; done.add(w.t.k); } });
            S.cardError = res.fromAI ? '' : 'The AI wrote sentences that did not fit your level, so none were kept. Try again.';
            if (!res.fromAI) res.error = S.cardError;
          } catch (e) { res.error = S.cardError = String(e && e.message || e); }
        }
        /* fallback: a sentence you already met in the video that fits */
        ts.forEach(t => {
          if (res.made >= want || done.has(t.k)) return;
          const spec = STAGES[S.words[t.k].stage || 0], f = findLine(t.k, spec), cx = contextFor(t.k);
          if (f && addCard({ text: f.text, targets: [t.k], src: 'video', from: f.src, stage: S.words[t.k].stage || 0, met: cx ? cx.text : '' })) { res.fromLines++; res.made++; done.add(t.k); }
        });
        if (!useAI && !res.made && ts.length) res.error = S.cardError = 'No AI is available to write new sentences. Add an account or download the on-phone AI.';
        else if (res.made) S.cardError = res.fromAI ? '' : (useAI ? S.cardError : '');
        flush();
      } finally { preparing = false; emit('preparing', false); }
      emit('cards', res);
      return res;
    }
    /* cards for now: words you used to know first, then reviews that are due (most overdue first), then new ones */
    function queue(n) {
      const t = now(), due = S.cards.filter(c => c.due <= t);
      const rank = c => (c.targets.some(isLost) ? 0 : c.reps ? 1 : 2) * 1e13 - (t - c.due);
      return due.sort((a, b) => rank(a) - rank(b)).slice(0, n || 10);
    }
    /* "how difficult was it?" answers the whole sentence. tapped = words the learner marked as not known while reading it. */
    function rateCard(id, o) {
      o = o || {};
      const c = cardOf(id); if (!c) throw new Error('No such card');
      const q = clamp(Math.round(+o.q || 0), 0, 3), tapped = new Set((o.tapped || []).map(norm)), before = new Set(Object.keys(S.words).filter(k => S.words[k].easyAt));
      c.hist.push([now(), q, o.ms || 0]); c.reps++;
      if (q === 0) { c.ivl = 0; c.due = now() + 10 * 60 * 1000; c.ease = Math.max(1.3, c.ease - 0.2); }
      else { c.ivl = c.ivl < 1 ? (q === 3 ? 4 : 1) : Math.round(c.ivl * c.ease * (q === 1 ? 0.8 : q === 3 ? 1.4 : 1)); c.ease += q === 3 ? 0.1 : q === 1 ? -0.1 : 0; c.due = now() + c.ivl * DAY; }
      const seen = new Set();
      tokens(c.text).forEach(t => {
        if (seen.has(t.k)) return; seen.add(t.k);
        const isTarget = c.targets.includes(t.k);
        if (tapped.has(t.k)) { wordTapped(t.w, c.text); reviewWord(t.w, 0, o.ms); }
        else if (isTarget) reviewWord(t.w, q, o.ms);
        else if (q >= 2) { const r = word(t.w); r.ex++; r.last = now(); }
      });
      day('reviews', 1); day('reviewMs', o.ms || 0); day('q' + q, 1);
      const learned = Object.keys(S.words).filter(k => S.words[k].easyAt && !before.has(k)).map(k => S.words[k].w);
      flush(); emit('card', id);
      return { next: c.due, intervalDays: c.ivl, learned };
    }
    const importSentences = list => { let n = 0; (list || []).forEach(x => { const text = x.text || ''; if (!tokens(text).length) return; const t = x.word ? [x.word] : tokens(text).filter(tk => wordP(tk.w) < 0.5).slice(0, 1).map(tk => tk.w); if (!t.length) return; t.forEach(w => word(w)); if (addCard({ text, tr: x.tr || '', targets: t, src: 'saved', from: x.src || '' })) n++; }); if (n) flush(); return n; };

    /* ================================================================== conjugation */
    const CONJ_SYSTEM = 'You write conjugation drills for a language learner. You reply with JSON only.';
    const tensesFor = lv => ({ A1: 'present tense', A2: 'present and simple past', B1: 'present, past, future and imperative', B2: 'all common tenses and moods', C1: 'all tenses and moods including less common ones', C2: 'all tenses and moods including less common ones' }[lv] || 'present tense');
    function conjPrompt(count) {
      const small = isLocal('heavy'), L = (deps.lang && deps.lang()) || { learn: 'the language', native: 'English' }, lv = S.level || level().level;
      const ks = Object.keys(S.words), known = ks.filter(k => wordP(k) >= 0.6).sort((a, b) => S.words[b].ex - S.words[a].ex).slice(0, small ? 25 : 70).map(k => S.words[k].w);
      const weak = conjStats().weakest.slice(0, 5).map(x => x.tense);
      const data = { learning: L.learnName || L.learn, native: L.nativeName || L.native, level: lv, tenses_for_this_level: tensesFor(lv), words_the_learner_knows: known, weakest_tenses: weak,
        already_have: S.conj.bank.slice(-30).map(i => i.lemma + '|' + i.tense + '|' + i.person) };
      const age = ageYears(); if (age && S.profile.shareAge !== false) data.learner_age = age;
      return 'Learner data:\n' + JSON.stringify(data) + '\n\nWrite ' + count + ' conjugation drills. Pick verbs from words_the_learner_knows when possible, otherwise very common verbs for the level. Mix persons and tenses within tenses_for_this_level, lean toward weakest_tenses, and do not repeat already_have. ' +
        'Each drill: {"lemma":"dictionary form","meaning":"in ' + data.native + '","tense":"e.g. past","person":"e.g. he","prompt":"a short instruction or a sentence with ____ where the form goes","answer":"the correct form","accept":["other correct spellings"],"note":"one short rule (under 15 words)"}.\n' +
        'Reply with JSON only: {"drills":[...]}';
    }
    let conjBusy = false;
    async function conjPrepare(o) {
      o = o || {};
      if (conjBusy || !S.on) return { skipped: conjBusy ? 'busy' : 'off' };
      const fresh = S.conj.bank.filter(i => !i.n).length, count = Math.min(12, o.count || 10);
      if (!o.force && fresh >= 6) return { made: 0 };
      if (!ai || (deps.ready && !deps.ready())) return { made: 0, error: 'No AI is available to write drills. Add an account or download the on-phone AI.' };
      conjBusy = true; emit('conj', true);
      try {
        const r = await ai.chat({ system: CONJ_SYSTEM, messages: [{ r: 'me', t: conjPrompt(isLocal('heavy') ? Math.min(count, 5) : count) }], tier: 'heavy', purpose: 'write-conjugation', quiet: true });
        const j = (deps.parseJSON || JSON.parse)(r.text);
        if (!j || !Array.isArray(j.drills)) throw new Error('The AI did not return drills.');
        let made = 0;
        j.drills.forEach(d => {
          if (!d || !d.lemma || !d.answer || !d.tense || !d.person || !d.prompt) return;
          const key = [d.lemma, d.tense, d.person].map(x => norm(x)).join('|');
          if (S.conj.bank.some(i => i.key === key)) return;
          S.conj.bank.push({ id: 'j' + (++S.conj.seq), key, lemma: String(d.lemma), meaning: String(d.meaning || ''), tense: String(d.tense).toLowerCase(), person: String(d.person), prompt: String(d.prompt), answer: String(d.answer).trim(),
            accept: (Array.isArray(d.accept) ? d.accept : []).map(String).slice(0, 4), note: String(d.note || ''), n: 0, ok: 0, miss: 0, due: 0, ivl: 0 });
          made++;
        });
        if (S.conj.bank.length > 200) S.conj.bank.splice(0, S.conj.bank.length - 200);
        flush();
        return { made, via: r.via && r.via.label || '' };
      } catch (e) { return { made: 0, error: String(e && e.message || e) }; }
      finally { conjBusy = false; emit('conj', false); }
    }
    /* what to practise now: forms that went wrong, then forms not tried yet, then ones that are due */
    function conjNext(n) {
      const t = now();
      const score = i => (i.miss > i.ok ? 0 : i.n === 0 ? 1 : 2) * 1e13 - (i.due ? t - i.due : 0);
      return S.conj.bank.filter(i => i.n === 0 || i.due <= t).sort((a, b) => score(a) - score(b)).slice(0, n || 8);
    }
    function conjGrade(id, answer, ms) {
      const it = S.conj.bank.find(i => i.id === id); if (!it) throw new Error('No such drill');
      const given = String(answer || '').normalize('NFC').trim(), all = [it.answer].concat(it.accept);
      const exact = all.some(a => String(a).normalize('NFC').trim() === given), ok = exact || all.some(a => norm(a) === norm(given));
      it.n++; if (ok) { it.ok++; it.ivl = it.ivl ? Math.round(it.ivl * 2.2) : 1; it.due = now() + it.ivl * DAY; } else { it.miss++; it.ivl = 0; it.due = now(); }
      day('conj', 1); if (ok) day('conjOk', 1); day('conjMs', ms || 0);
      flush(); emit('conjgrade', id);
      return { ok, exact, answer: it.answer, note: it.note, marksDiffer: ok && !exact };
    }
    /* a short explanation of a wrong answer: a light job, so the free on-phone model is used first */
    async function conjExplain(id, answer) {
      const it = S.conj.bank.find(i => i.id === id); if (!it || !ai || (deps.ready && !deps.ready())) return '';
      const L = (deps.lang && deps.lang()) || { native: 'English' };
      try {
        const r = await ai.chat({ system: 'You are a patient language tutor. Be brief.', messages: [{ r: 'me', t: 'Drill: ' + it.lemma + ' (' + it.meaning + '), ' + it.tense + ', ' + it.person + '. Prompt: ' + it.prompt + '\nThe learner wrote: ' + answer + '\nCorrect: ' + it.answer + '\nIn two short sentences in ' + (L.nativeName || L.native) + ', say why the correct form is right and what the learner mixed up.' }], tier: 'light', quiet: true , purpose: 'explain-conjugation' });
        return String(r.text || '').trim().slice(0, 500);
      } catch (_) { return ''; }
    }
    function conjStats() {
      const by = {};
      S.conj.bank.forEach(i => { if (!i.n) return; const o = by[i.tense] || (by[i.tense] = { tense: i.tense, n: 0, ok: 0 }); o.n += i.n; o.ok += i.ok; });
      const rows = Object.values(by).map(o => Object.assign(o, { acc: o.n ? Math.round(o.ok / o.n * 100) : 0 }));
      return { rows, weakest: rows.slice().sort((a, b) => a.acc - b.acc).filter(x => x.n >= 2), drills: S.conj.bank.length, fresh: S.conj.bank.filter(i => !i.n).length };
    }

    migrate();
    return {
      on, norm, tokens, lineShown, lineReplayed, wordTapped, saved, reviewed, newSession,
      wordP, lineView, level, stats, profileText, rank, assess, tick, setOption, reset, flush,
      reviewWord, lostWords, isLost, wordTable, wordAverages, progress, track, ageYears, setProfile,
      targets, prepare, queue, rateCard, importSentences, cards: () => S.cards, card: cardOf, STAGES,
      conjPrepare, conjNext, conjGrade, conjExplain, conjStats, conjBank: () => S.conj.bank,
      state: () => S, isRunning: () => running
    };
  }

  return { create, norm, tokens, lineKey, LEVELS };
});
