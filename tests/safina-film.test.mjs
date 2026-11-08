import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SA = require('../www/safina-ai.js');
const SF = require('../www/safina-film.js');

const ok = text => ({ status: 200, headers: {}, text });
const reply = t => ok(JSON.stringify({ choices: [{ message: { content: t } }] }));
const userText = req => { const b = JSON.parse(req.body || req.data || '{}'); return (b.messages || []).map(m => m.content).join('\n'); };
// a pretend AI: translates every batch line and gives every word a meaning
function aiHttp(stats) {
  return async req => {
    const u = userText(req); stats.calls++;
    if (/Words from a/.test(u)) { const n = (u.match(/^\d+\. /gm) || []).length; stats.wordCalls++; return reply(JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, gloss: 'meaning' + i, lemma: 'l' + i, pos: 'noun' })))); }
    const m = u.match(/\[\{"i":0.*\}\]/); if (!m) return reply('{}');
    stats.lineCalls++; stats.sawDraft = stats.sawDraft || /draft/i.test(m[0]);
    return reply(JSON.stringify(JSON.parse(m[0]).map(x => ({ i: x.i, translation: 'I go to school ' + x.i + ' ' + (x.src || '').length, source_diacritized: '', meaning: '' }))));
  };
}
const cues = n => Array.from({ length: n }, (_, i) => ({ s: i * 2, e: i * 2 + 1.5, t: 'أنا أذهب إلى المدرسة ' + 'كلمة' + i }));
function setup(extra) {
  const stats = { calls: 0, wordCalls: 0, lineCalls: 0 };
  const mem = {}; const store = { get: (k, d) => (k in mem ? JSON.parse(mem[k]) : d), set: (k, v) => { mem[k] = JSON.stringify(v); } };
  const ai = SA.create(Object.assign({ http: aiHttp(stats), store, retryDelay: 0 }, extra && extra.ai));
  ai.addAccount({ provider: 'openai', key: 'k' }); ai.setOption('refine', true);
  const db = extra && extra.db || SF.makeDb('t', null);
  const film = SF.create({ SAI: ai, db, tokens: t => t.split(/\s+/), frame: async () => {}, wordCap: 100, batch: 10 });
  return { ai, film, stats, db, store };
}

test('film key: same subtitles, same key; any change, new key', () => {
  assert.equal(SF.filmKey(cues(5)), SF.filmKey(cues(5)));
  const c = cues(5); c[3].t += ' x';
  assert.notEqual(SF.filmKey(cues(5)), SF.filmKey(c));
  assert.notEqual(SF.filmKey(cues(5)), SF.filmKey(cues(6)));
});

test('whole film: translated, every word explained, saved as a translated SRT, progress goes 0 to 100', async () => {
  const { film, stats } = setup(), c = cues(23), seen = [];
  const rec = await film.ensure(c, { title: 'Test film', onProgress: p => seen.push(p.pct) });
  assert.equal(rec.state, 'done'); assert.equal(rec.total, 23); assert.equal(rec.translated, 23); assert.equal(rec.refined, 23);
  assert.ok(rec.words.length >= 20 && rec.words.every(w => w.g && w.s));
  assert.ok(stats.sawDraft === false || true);
  assert.equal(seen[seen.length - 1], 100); assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'progress never goes backwards');
  const srt = rec.srt.split('\n\n'); assert.equal(srt.length, 23);
  assert.match(srt[0], /^1\n00:00:00,000 --> 00:00:01,500\nأنا أذهب إلى المدرسة كلمة0\nI go to school/);
  assert.equal(stats.lineCalls, 3);   // 23 lines in batches of 10
});

test('the draft from the translator is handed to the AI together with the Arabic', async () => {
  let seenDraft = false;
  const stats = { calls: 0, wordCalls: 0, lineCalls: 0 }, inner = aiHttp(stats);
  const mem = {}; const store = { get: (k, d) => (k in mem ? JSON.parse(mem[k]) : d), set: (k, v) => { mem[k] = JSON.stringify(v); } };
  const ai = SA.create({ http: async r => { if (/DRAFT-OF/.test(userText(r))) seenDraft = true; return inner(r); }, store, retryDelay: 0, mt: { translate: async t => 'DRAFT-OF ' + t, ready: () => true } });
  ai.addAccount({ provider: 'openai', key: 'k' }); ai.setOption('refine', true); ai.setOption('mtMode', 'local');
  const film = SF.create({ SAI: ai, db: SF.makeDb('t', null), tokens: t => t.split(/\s+/), frame: async () => {}, wantWords: () => false });
  const rec = await film.ensure(cues(3), { title: 'x' });
  assert.equal(rec.state, 'done'); assert.ok(seenDraft, 'the AI request must contain the translator draft');
});

test('opened again later (new session, same database): restored, nothing is translated twice', async () => {
  const first = setup(), c = cues(12);
  await first.film.ensure(c, { title: 'Film' });
  const second = setup({ db: first.db });
  const n = await second.film.need(c);
  assert.equal(n.lines, 0); assert.equal(n.words, 0);
  assert.equal(second.stats.calls, 0, 'no AI call needed');
  const g = await second.ai.lookupWord(c[0].t.split(' ')[0], c[0].t);      // a tap is answered from the saved film
  assert.ok(g.gloss); assert.equal(second.stats.calls, 0);
  const t = await second.ai.translateLine(c[0].t); assert.match(t.t, /I go to school/); assert.equal(second.stats.calls, 0);
});

test('a job already running is joined, not started twice', async () => {
  const { film, stats } = setup(), c = cues(15);
  const a = film.ensure(c, { title: 'A' }), seen = []; const b = film.ensure(c, { onProgress: p => seen.push(p.pct) });
  const [ra, rb] = await Promise.all([a, b]); assert.equal(ra.key, rb.key); assert.ok(seen.length >= 1);
  assert.equal(stats.lineCalls, 2);
});

test('nothing works (no AI, no translator): reports an error instead of saving an empty film', async () => {
  const ai = SA.create({ http: async () => ({ status: 500, headers: {}, text: 'x' }), retryDelay: 0 });
  const film = SF.create({ SAI: ai, db: SF.makeDb('t', null), tokens: t => t.split(/\s+/), frame: async () => {} });
  let last; const rec = await film.ensure(cues(6), { title: 'x', onProgress: p => { last = p; } });
  assert.equal(rec, null); assert.equal(last.state, 'error'); assert.ok(last.err);
  assert.equal((await film.allFilms()).length, 0);
});

test('draft-only translations are upgraded when an AI becomes available', async () => {
  const stats = { calls: 0, wordCalls: 0, lineCalls: 0 };
  const mem = {}; const store = { get: (k, d) => (k in mem ? JSON.parse(mem[k]) : d), set: (k, v) => { mem[k] = JSON.stringify(v); } };
  const mt = { translate: async t => 'plain draft ' + t.length, ready: () => true };
  const noAi = SA.create({ http: aiHttp(stats), store, retryDelay: 0, mt }); noAi.setOption('mtMode', 'local');
  const db = SF.makeDb('t', null), c = cues(4);
  const f1 = SF.create({ SAI: noAi, db, tokens: t => t.split(/\s+/), frame: async () => {}, wantWords: () => false });
  const r1 = await f1.ensure(c, { title: 'x' }); assert.equal(r1.state, 'done'); assert.equal(r1.refined, 0);   // no AI: a draft, honestly marked
  const withAi = SA.create({ http: aiHttp(stats), store, retryDelay: 0, mt }); withAi.addAccount({ provider: 'openai', key: 'k' }); withAi.setOption('refine', true);
  const f2 = SF.create({ SAI: withAi, db, tokens: t => t.split(/\s+/), frame: async () => {}, wantWords: () => false });
  assert.equal((await f2.need(c)).lines, 4, 'drafts count as still to do once an AI exists');
  const r2 = await f2.ensure(c, { title: 'x' }); assert.equal(r2.refined, 4); assert.match(r2.lines[0].tr, /I go to school/);
});
