import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = require('../www/safina-brain.js');
const DAY = 864e5;

function mk(over) {
  const mem = {}; const clock = { t: Date.UTC(2026, 0, 10, 12) };
  const calls = [];
  const o = Object.assign({
    now: () => clock.t,
    store: { get: (k, d) => (k in mem ? JSON.parse(mem[k]) : d), set: (k, v) => { mem[k] = JSON.stringify(v); } },
    ai: { chat: async a => { calls.push(a); return { text: JSON.stringify(o.reply ? o.reply(a) : {}), via: { label: 'API' } }; } },
    parseJSON: s => JSON.parse(s), ready: () => true, isLocal: () => false,
    lang: () => ({ learn: 'xx', native: 'en', learnName: 'Xish', nativeName: 'English' })
  }, over || {});
  return { brain: B.create(o), calls, clock, mem, o, adv: d => { clock.t += d * DAY; } };
}
const see = (b, text, src, times) => { for (let i = 0; i < (times || 1); i++) { b.newSession(); b.lineShown(text, { src }); } };
const KNOWN = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh'];
function teachKnown(b) { KNOWN.forEach(w => { for (let i = 0; i < 4; i++) b.reviewWord(w, 3); }); }

test('word history: first source and time, then how long and how many repetitions it took to become easy', () => {
  const { brain, adv } = mk();
  see(brain, 'aa zork bb', 'Movie One');
  assert.equal(brain.wordTable().find(r => r.word === 'zork').firstSource, 'Movie One');
  adv(1); brain.wordTapped('zork', 'aa zork bb');
  adv(2); brain.reviewWord('zork', 2); adv(3); brain.reviewWord('zork', 2); adv(5); brain.reviewWord('zork', 3);
  const row = brain.wordTable().find(r => r.word === 'zork');
  assert.equal(row.status, 'known'); assert.equal(row.reviews, 3); assert.equal(row.repsToEasy, 3);
  assert.equal(row.daysToLearn, 10, 'from the day it was looked up to the day it became easy');
  const avg = brain.wordAverages();
  assert.equal(avg.learned, 1); assert.equal(avg.avgRepsToEasy, 3); assert.equal(avg.avgDaysToLearn, 10);
});

test('a word that became easy and is then missed is "lost", and it is a target for new cards', () => {
  const { brain } = mk();
  for (let i = 0; i < 3; i++) brain.reviewWord('zork', 3);
  assert.deepEqual(brain.lostWords(), []);
  brain.reviewWord('zork', 0);
  assert.deepEqual(brain.lostWords(), ['zork']);
  assert.equal(brain.wordTable().find(r => r.word === 'zork').status, 'lost');
  assert.equal(brain.targets(5)[0].why, 'you used to know it');
  brain.reviewWord('zork', 2); brain.reviewWord('zork', 2);
  assert.deepEqual(brain.lostWords(), [], 'two good answers bring it back');
});

test('forgetting: a word answered right fades back toward "not sure" as the weeks pass', () => {
  const { brain, adv } = mk();
  for (let i = 0; i < 3; i++) brain.reviewWord('zork', 2);
  const fresh = brain.wordP('zork'); adv(60);
  assert.ok(brain.wordP('zork') < fresh - 0.2);
  assert.ok(brain.isLost('zork'), 'long unseen counts as lost');
});

test('cards: a sentence the learner already met with exactly one unknown word becomes a card without any AI call', async () => {
  const { brain, calls } = mk();
  teachKnown(brain);
  see(brain, 'aa bb zork cc', 'Show A', 1);
  brain.wordTapped('zork', 'aa bb zork cc');
  see(brain, 'aa bb cc dd ee ff zork gg hh qq ww rr tt yy uu', 'Show A');   // too long and too many unknowns for stage 0
  const r = await brain.prepare({ count: 3 });
  assert.equal(calls.length, 0); assert.equal(r.fromLines, 1);
  const c = brain.cards()[0];
  assert.equal(c.text, 'aa bb zork cc'); assert.deepEqual(c.targets, ['zork']); assert.equal(c.from, 'Show A'); assert.equal(c.stage, 0);
});

test('cards: with no fitting sentence the API writes one, and it is checked before it is kept', async () => {
  const { brain, calls } = mk({
    reply: a => ({ cards: [
      { i: 0, form: 'zork', text: 'aa zork bb cc', meaning: 'a x b c', hint: 'think of orcs' },
      { i: 1, form: 'blip', text: 'blip aa bb cc dd ee ff gg hh aa bb cc', meaning: 'too long', hint: '' }
    ] })
  });
  teachKnown(brain);
  brain.wordTapped('zork', 'zork'); brain.wordTapped('blip', 'blip');
  const r = await brain.prepare({ count: 4 });
  assert.equal(calls.length, 1); assert.equal(calls[0].tier, 'heavy'); assert.equal(calls[0].quiet, true);
  const sent = JSON.parse(calls[0].messages[0].t.split('\n')[1]);
  assert.ok(sent.known_words.includes('aa')); assert.equal(sent.items[0].other_unknown_words_allowed, 0);
  assert.equal(r.fromAI, 1, 'the over-long sentence was rejected'); assert.equal(brain.cards()[0].tr, 'a x b c'); assert.equal(brain.cards()[0].src, 'ai');
});

test('cards: a sentence that uses too many unknown words is rejected, and an AI failure is reported, not thrown', async () => {
  const bad = mk({ reply: () => ({ cards: [{ i: 0, form: 'zork', text: 'zork nn mm kk jj', meaning: '', hint: '' }] }) });
  teachKnown(bad.brain); bad.brain.wordTapped('zork', 'zork');
  assert.equal((await bad.brain.prepare({ count: 2 })).fromAI, 0);
  const down = mk({ ai: { chat: async () => { throw new Error('limit reached'); } } });
  teachKnown(down.brain); down.brain.wordTapped('zork', 'zork');
  const r = await down.brain.prepare({ count: 2 });
  assert.match(r.error, /limit reached/); assert.equal(down.brain.cards().length, 0);
});

test('cards get harder step by step: a good answer moves the word to the next stage, again moves it back', async () => {
  const { brain } = mk();
  teachKnown(brain);
  see(brain, 'aa bb zork cc', 'S'); brain.wordTapped('zork', 'aa bb zork cc');
  await brain.prepare({ count: 1 });
  const c = brain.cards()[0];
  brain.rateCard(c.id, { q: 2, ms: 4000 });
  assert.equal(brain.table ? 0 : 1, 1);
  assert.equal(brain.state().words.zork.stage, 1);
  brain.rateCard(c.id, { q: 0 });
  assert.equal(brain.state().words.zork.stage, 0);
  assert.ok(brain.state().words.zork.miss >= 1);
});

test('the sentence rating updates its schedule, the word, activity and tells which words became easy', async () => {
  const { brain, clock } = mk();
  teachKnown(brain);
  see(brain, 'aa bb zork cc', 'S'); brain.wordTapped('zork', 'aa bb zork cc');
  await brain.prepare({ count: 1 });
  const c = brain.cards()[0]; let out;
  for (let i = 0; i < 3; i++) { out = brain.rateCard(c.id, { q: 3, ms: 3000 }); clock.t += DAY; }
  assert.ok(c.ivl >= 4); assert.deepEqual(out.learned, ['zork']);
  const p = brain.progress();
  assert.equal(p.totals.reviews, 3); assert.equal(p.totals.q3, 3); assert.equal(p.avgSecondsPerCard, 3); assert.equal(p.retention, 100);
});

test('words tapped while reading a card count as not known, even if the card was rated good', async () => {
  const { brain } = mk();
  teachKnown(brain);
  see(brain, 'aa bb zork cc', 'S'); brain.wordTapped('zork', 'aa bb zork cc');
  await brain.prepare({ count: 1 });
  const c = brain.cards()[0], tapsBefore = brain.state().words.cc.tp;
  brain.rateCard(c.id, { q: 2, tapped: ['cc'] });
  assert.equal(brain.state().words.cc.tp, tapsBefore + 1); assert.ok(brain.wordP('cc') < 0.8);
});

test('queue: words you used to know first, then due reviews, then new cards; nothing that is not due', async () => {
  const { brain, adv } = mk();
  teachKnown(brain);
  ['zork', 'blip'].forEach(w => brain.wordTapped(w, 'aa bb ' + w + ' cc'));
  see(brain, 'aa bb zork cc', 'S'); see(brain, 'aa bb blip cc', 'S');
  await brain.prepare({ count: 2 });
  const [z, b] = ['zork', 'blip'].map(w => brain.cards().find(c => c.targets.includes(w)));
  brain.rateCard(z.id, { q: 3 });                       // not due for days
  assert.deepEqual(brain.queue(5).map(c => c.id), [b.id]);
  for (let i = 0; i < 3; i++) brain.reviewWord('lostone', 3); brain.reviewWord('lostone', 0);
  brain.importSentences([{ text: 'aa lostone bb', word: 'lostone' }]);
  assert.equal(brain.queue(5)[0].targets[0], 'lostone');
  adv(30); assert.ok(brain.queue(5).some(c => c.id === z.id));
});

test('progress: watch time, pauses, replays, streak and the understanding rate', () => {
  const { brain, adv } = mk();
  for (let d = 0; d < 3; d++) { brain.track('watch', 600); brain.track('pauses', 4); brain.track('pauseSec', 50); adv(1); }
  brain.track('watch', 600);
  const p = brain.progress();
  assert.equal(p.totals.watch, 2400); assert.equal(p.totals.pauses, 12); assert.equal(p.streak, 4); assert.equal(p.series.length, 14);
  assert.equal(p.series.at(-1).watch, 600);
});

test('profile: birthday gives the age (and is sent to the AI only when sharing is on); a bad date is refused', async () => {
  const { brain, calls } = mk({ reply: () => ({ cards: [] }) });
  brain.setProfile({ birthday: '2000-06-15' });
  assert.equal(brain.ageYears(), 25);
  assert.throws(() => brain.setProfile({ birthday: '15/06/2000' })); assert.throws(() => brain.setProfile({ birthday: '2090-01-01' }));
  assert.equal(brain.ageYears(), 25, 'the old value is kept');
  teachKnown(brain); brain.wordTapped('zork', 'zork');
  await brain.prepare({ count: 1 });
  assert.equal(JSON.parse(calls[0].messages[0].t.split('\n')[1]).learner_age, 25);
  brain.setProfile({ shareAge: false }); calls.length = 0;
  brain.wordTapped('blip', 'blip'); await brain.prepare({ count: 3 });
  assert.equal('learner_age' in JSON.parse(calls[0].messages[0].t.split('\n')[1]), false);
});

test('word table: sorting and filtering', () => {
  const { brain } = mk();
  brain.wordTapped('aa', 'aa'); brain.wordTapped('aa', 'aa'); brain.wordTapped('bb', 'bb');
  assert.equal(brain.wordTable({ sort: 'lookups' })[0].word, 'aa');
  assert.equal(brain.wordTable({ status: 'lost' }).length, 0);
  assert.equal(brain.wordTable({ limit: 1 }).length, 1);
});

/* ------------------------------------------------------------ conjugation */
const DRILLS = { drills: [
  { lemma: 'write', meaning: 'to write', tense: 'past', person: 'he', prompt: 'he ____ (write)', answer: 'wrote', accept: [], note: 'irregular' },
  { lemma: 'write', meaning: 'to write', tense: 'present', person: 'I', prompt: 'I ____ (write)', answer: 'ésc', accept: ['esc'], note: '' },
  { lemma: 'go', meaning: 'to go', tense: 'past', person: 'we', prompt: 'we ____ (go)', answer: 'went', accept: [], note: '' },
  { lemma: 'bad' }, { lemma: 'x', answer: 'y', tense: 't', person: 'p' }
] };

test('conjugation: the API writes a bank of drills, bad ones are dropped, duplicates are not added twice', async () => {
  const { brain, calls } = mk({ reply: () => DRILLS });
  const r = await brain.conjPrepare({ force: true });
  assert.equal(r.made, 3); assert.equal(calls[0].tier, 'heavy');
  assert.equal((await brain.conjPrepare({ force: true })).made, 0, 'the same drills again are ignored');
  const sent = JSON.parse(calls[0].messages[0].t.split('\n')[1]); assert.match(sent.tenses_for_this_level, /present/);
});

test('conjugation: grading is done in code; marks-only differences are right but flagged; wrong answers are repeated first', async () => {
  const { brain } = mk({ reply: () => DRILLS });
  await brain.conjPrepare({ force: true });
  const [wrote, present, went] = brain.conjBank();
  assert.deepEqual(brain.conjGrade(wrote.id, '  wrote ', 2000), { ok: true, exact: true, answer: 'wrote', note: 'irregular', marksDiffer: false });
  const loose = brain.conjGrade(present.id, 'ESC', 1); assert.equal(loose.ok, true); assert.equal(loose.marksDiffer, true);
  const bad = brain.conjGrade(went.id, 'goed', 1); assert.equal(bad.ok, false);
  assert.equal(brain.conjNext(3)[0].id, went.id, 'the missed form comes back first');
  const st = brain.conjStats(); assert.equal(st.rows.find(x => x.tense === 'past').n, 2); assert.equal(st.rows.find(x => x.tense === 'past').acc, 50);
  assert.equal(brain.progress().totals.conj, 3);
});

test('conjugation: explaining a mistake is a light job (free on-phone model first); no AI means an empty answer, not a crash', async () => {
  const m = mk({ reply: () => DRILLS }); await m.brain.conjPrepare({ force: true });
  m.o.ai.chat = async a => { m.calls.push(a); return { text: 'Because it is irregular.' }; };
  m.calls.length = 0;
  assert.equal(await m.brain.conjExplain(m.brain.conjBank()[0].id, 'writed'), 'Because it is irregular.');
  assert.equal(m.calls[0].tier, 'light'); assert.equal(m.calls[0].quiet, true);
  assert.match(m.calls[0].messages[0].t, /writed/);
  assert.equal(await mk({ ai: null }).brain.conjExplain('j1', 'x'), '');
});

test('conjugation: failure to get drills is reported', async () => {
  const { brain } = mk({ ai: { chat: async () => { throw new Error('offline'); } } });
  assert.match((await brain.conjPrepare({ force: true })).error, /offline/);
  assert.match((await mk({ ready: () => false }).brain.conjPrepare({ force: true })).error, /No AI/);
});

test('records saved by the first version are upgraded when loaded', () => {
  const mem = { 'safina.brain.v1': JSON.stringify({ v: 1, on: true, every: 12, words: { old: { w: 'old', ex: 3, tp: 1, sv: 0, ok: 0, miss: 0, last: 1, tpAt: 1, ai: null } }, lines: {}, order: [] }) };
  const b = B.create({ now: Date.now, store: { get: (k, d) => (k in mem ? JSON.parse(mem[k]) : d), set: () => {} } });
  assert.equal(b.wordTable()[0].word, 'old'); assert.deepEqual(b.cards(), []); assert.equal(b.progress().streak, 0);
});
