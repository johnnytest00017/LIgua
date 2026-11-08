import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = require('../www/safina-brain.js');

function mk(over) {
  const mem = {}; let t = 1e12;
  const calls = [], cards = [];
  const o = Object.assign({
    now: () => (t += 1000),
    store: { get: (k, d) => (k in mem ? JSON.parse(mem[k]) : d), set: (k, v) => { mem[k] = JSON.stringify(v); } },
    ai: { chat: async a => { calls.push(a); return { text: o.reply ? JSON.stringify(o.reply(a)) : '{}', via: { label: 'Test AI' } }; } },
    parseJSON: s => JSON.parse(s), ready: () => true, isLocal: () => false,
    lang: () => ({ learn: 'ar', native: 'en', learnName: 'Arabic', nativeName: 'English' }),
    addCards: c => { cards.push(...c); return c.length; }
  }, over || {});
  return { brain: B.create(o), calls, cards, mem, o, tick: ms => { t += ms; } };
}
const read = (b, line, times) => { for (let i = 0; i < (times || 1); i++) { b.newSession(); b.lineShown(line); } };

test('words: never seen is unlikely known; seen without a lookup grows; a lookup drops it; a correct answer lifts it', () => {
  const { brain } = mk();
  const fresh = brain.wordP('كتاب');
  assert.ok(fresh < 0.4);
  read(brain, 'هذا كتاب', 6);
  assert.ok(brain.wordP('كتاب') > fresh + 0.3, 'met six times and never looked up');
  brain.wordTapped('كتاب', 'هذا كتاب');
  assert.ok(brain.wordP('كتاب') < 0.5, 'the learner just looked it up');
  brain.reviewed('كتاب', true); brain.reviewed('كتاب', true);
  assert.ok(brain.wordP('كتاب') > 0.45);
});

test('diacritics and case do not make a new word', () => {
  const { brain } = mk();
  brain.wordTapped('كَتَبَ', 'كَتَبَ الولد');
  assert.ok(brain.wordP('كتب') < 0.3);
  brain.wordTapped('Hello', 'Hello there');
  assert.ok(brain.wordP('hello') < 0.3);
});

test('a line counts once per viewing session, again in the next', () => {
  const { brain } = mk();
  brain.lineShown('a b c'); brain.lineShown('a b c');
  assert.equal(brain.state().words.a.ex, 1);
  brain.newSession(); brain.lineShown('a b c');
  assert.equal(brain.state().words.a.ex, 2);
});

test('understood: yes / maybe / no follows the number of unknown words', () => {
  const { brain } = mk();
  const known = 'one two three four five six seven eight nine ten';
  read(brain, known, 12);
  assert.equal(brain.lineView(known).state, 'yes');
  const unk1 = 'one two three four five six seven eight nine zed';
  assert.equal(brain.lineView(unk1).state, 'yes', 'one unknown word in ten still reads as understood');
  const unk3 = 'one two three four five six seven alpha beta gamma';
  const v3 = brain.lineView(unk3);
  assert.equal(v3.state, 'maybe'); assert.equal(v3.unknown.length, 3);
  const unk5 = 'one two three four five alpha beta gamma delta epsilon';
  assert.equal(brain.lineView(unk5).state, 'no');
});

test('words the learner looked up count as unknown even if they were seen often', () => {
  const { brain } = mk();
  const line = 'one two three four five six';
  read(brain, line, 10);
  assert.equal(brain.lineView(line).state, 'yes');
  brain.wordTapped('two', line); brain.wordTapped('five', line); brain.wordTapped('six', line);
  const v = brain.lineView(line);
  assert.deepEqual(v.unknown.sort(), ['five', 'six', 'two']);
  assert.notEqual(v.state, 'yes');
});

test('going back to a line makes the verdict one step less sure', () => {
  const { brain } = mk();
  const line = 'a b c d e f g h';
  read(brain, line, 12);
  assert.equal(brain.lineView(line).state, 'yes');
  brain.lineReplayed(line);
  assert.equal(brain.lineView(line).state, 'maybe');
});

test('assess: too few new lines does nothing; force or lookups make it run', async () => {
  const { brain, calls } = mk({ reply: () => ({ level: 'A2', lines: [], words: [], cards: [] }) });
  read(brain, 'x y z');
  assert.match((await brain.assess()).skipped, /not enough/);
  assert.equal(calls.length, 0);
  brain.wordTapped('y', 'x y z'); brain.wordTapped('z', 'x y z');
  const r = await brain.assess();
  assert.equal(calls.length, 1); assert.ok(!r.skipped);
});

test('assess: the AI verdicts, word estimates, level and flashcards are applied', async () => {
  const lines = ['hello world one', 'second line here'];
  const { brain, calls, cards } = mk({
    reply: a => ({
      level: 'B1',
      lines: [{ i: 0, understood: 'maybe', why: 'only one rare word', key_unknown: ['world'] }, { i: 1, understood: 'no', why: 'grammar is new', key_unknown: [] }],
      words: [{ w: 'hello', p_known: 0.95 }],
      cards: [{ type: 'word', lemma: 'world', word: 'world', meaning: 'العالم', sentence: 'hello world one', hint: 'think globe', why: 'looked up' }, { type: 'junk' }, { lemma: 'x' }]
    })
  });
  lines.forEach(l => read(brain, l));
  brain.wordTapped('world', lines[0]);
  const r = await brain.assess({ force: true });
  const sent = JSON.parse(calls[0].messages[0].t.split('\n')[1]);
  assert.equal(sent.learning, 'Arabic'); assert.equal(sent.lines.length, 2);
  assert.ok(sent.lines.some(l => l.tapped.includes('world')));
  assert.equal(brain.level().level, 'B1'); assert.equal(brain.level().estimated, false);
  assert.equal(brain.lineView('second line here').state, 'no'); assert.match(brain.lineView('second line here').why, /grammar/);
  assert.ok(brain.wordP('hello') > 0.6);
  assert.equal(cards.length, 1, 'cards without a meaning are dropped'); assert.equal(cards[0].lemma, 'world'); assert.equal(cards[0].level, 'B1');
  assert.equal(r.cards, 1); assert.equal(r.via, 'Test AI');
});

test('looking a word up after the AI judged a line overrides that verdict', async () => {
  const { brain, tick } = mk({ reply: () => ({ level: 'A2', lines: [{ i: 0, understood: 'yes', why: 'easy', key_unknown: [] }], words: [{ w: 'alpha', p_known: 0.9 }], cards: [] }) });
  read(brain, 'alpha beta gamma');
  await brain.assess({ force: true });
  assert.equal(brain.lineView('alpha beta gamma').state, 'yes');
  tick(5000);
  brain.wordTapped('alpha', 'alpha beta gamma');
  assert.ok(brain.wordP('alpha') <= 0.35, 'the learner just told us');
  assert.notEqual(brain.lineView('alpha beta gamma').why, 'easy');
});

test('assess: a failing AI is reported, not thrown, and does not run twice at once', async () => {
  const { brain } = mk({ ai: { chat: async () => { throw new Error('limit reached'); } } });
  read(brain, 'p q r'); brain.wordTapped('p', 'p q r'); brain.wordTapped('q', 'p q r');
  const r = await brain.assess({ force: true });
  assert.match(r.error, /limit reached/);
  let release; const gate = new Promise(res => { release = res; });
  const { brain: b2 } = mk({ ai: { chat: async () => { await gate; return { text: '{"lines":[]}' }; } } });
  read(b2, 'p q r');
  const first = b2.assess({ force: true });
  assert.equal((await b2.assess({ force: true })).skipped, 'busy');
  release(); await first;
});

test('assess: malformed AI output is an error, never fake data', async () => {
  const { brain, cards } = mk({ reply: () => ({ nothing: true }) });
  read(brain, 'p q r');
  const r = await brain.assess({ force: true });
  assert.match(r.error, /did not return/); assert.equal(cards.length, 0);
});

test('the on-phone AI gets a smaller job', async () => {
  const { brain, calls } = mk({ isLocal: () => true, reply: () => ({ lines: [] }) });
  for (const w of ['aaa','bbb','ccc','ddd','eee','fff','ggg','hhh','iii']) read(brain, w + ' common');
  await brain.assess({ force: true });
  assert.equal(JSON.parse(calls[0].messages[0].t.split('\n')[1]).lines.length, 3);
  assert.match(calls[0].messages[0].t, /at most 3 flashcards/);
});

test('does nothing when the AI is off, unavailable, or the brain is switched off', async () => {
  let m = mk({ ready: () => false }); read(m.brain, 'a b c'); assert.match((await m.brain.assess({ force: true })).skipped, /no AI/);
  m = mk(); m.brain.setOption('on', false); read(m.brain, 'a b c'); assert.equal((await m.brain.assess({ force: true })).skipped, 'off');
  assert.equal(m.calls.length, 0);
});

test('tick runs the assessment in the background once enough lines have gone by', async () => {
  const { brain, calls } = mk({ reply: () => ({ lines: [] }) });
  brain.setOption('every', 4);
  const L = ['alpha one', 'bravo two', 'charlie three', 'delta four'];
  for (let i = 0; i < 3; i++) { read(brain, L[i]); brain.tick(); }
  assert.equal(calls.length, 0);
  read(brain, L[3]); brain.tick();
  await new Promise(r => setTimeout(r, 5));
  assert.equal(calls.length, 1);
});

test('profile text gives the tutor the level and the recent trouble words', () => {
  const { brain } = mk();
  brain.wordTapped('عَجِيب', 'شيء عجيب');
  const p = brain.profileText();
  assert.match(p, /Learner level: A1/); assert.match(p, /عَجِيب/);
});

test('rank puts sentences with the most unknown words first and known ones last', () => {
  const { brain } = mk();
  read(brain, 'aa bb cc dd', 12);
  const out = brain.rank([{ text: 'aa bb cc dd' }, { text: 'new one two three' }, { text: 'aa new' }]);
  assert.equal(out[0].text, 'new one two three'); assert.equal(out[2].text, 'aa bb cc dd');
});

test('everything survives a restart and can be reset', () => {
  const m = mk(); read(m.brain, 'a b c'); m.brain.wordTapped('b', 'a b c'); m.brain.flush();
  const again = B.create({ now: Date.now, store: { get: (k, d) => (k in m.mem ? JSON.parse(m.mem[k]) : d), set: () => {} } });
  assert.ok(again.wordP('b') < 0.3); assert.equal(again.state().lines['a b c'].taps[0], 'b');
  m.brain.reset(); assert.equal(Object.keys(m.brain.state().words).length, 0);
});
