import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SA = require('../www/safina-ai.js');

const ok = (text, headers) => ({ status: 200, headers: headers || {}, text });
const openaiReply = t => ok(JSON.stringify({ choices: [{ message: { content: t } }] }));
const claudeReply = t => ok(JSON.stringify({ content: [{ type: 'text', text: t }] }));
const geminiReply = t => ok(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }));
const quota = () => ({ status: 429, headers: {}, text: JSON.stringify({ error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } }) });
const rate = () => ({ status: 429, headers: { 'retry-after': '30' }, text: JSON.stringify({ error: { message: 'Rate limit reached, retry in 30s' } }) });

function make(handler, extra) {
  const calls = [];
  const http = async req => { calls.push(req); return handler(req, calls.length); };
  const ai = SA.create(Object.assign({ http, retryDelay: 0 }, extra || {}));
  return { ai, calls };
}

test('classify: quota, rate limit, auth, overload, network', () => {
  const t = Date.now();
  assert.equal(SA.classify(429, JSON.stringify({ error: { code: 'insufficient_quota', message: 'quota' } }), {}, t).scope, 'account');
  const r = SA.classify(429, 'Rate limit reached', { 'retry-after': '10' }, t);
  assert.equal(r.kind, 'limit'); assert.equal(r.scope, 'model'); assert.ok(r.until - t >= 10000 && r.until - t < 12000);
  assert.equal(SA.classify(400, JSON.stringify({ error: { message: 'Your credit balance is too low to access the API' } }), {}, t).scope, 'account');
  assert.equal(SA.classify(401, 'bad key', {}, t).kind, 'auth');
  assert.equal(SA.classify(529, 'Overloaded', {}, t).kind, 'overload');
  assert.equal(SA.classify(0, 'offline', {}, t).kind, 'network');
  assert.equal(SA.classify(429, JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for requests per minute' } }), {}, t).scope, 'model');
});

test('each provider builds a valid request and parses its reply', async () => {
  const seen = {};
  const { ai } = make(req => {
    if (req.url.includes('anthropic')) { seen.anthropic = req; return claudeReply('hi from claude'); }
    if (req.url.includes('generativelanguage')) { seen.gemini = req; return geminiReply('hi from gemini'); }
    if (req.url.includes('x.ai')) { seen.xai = req; return openaiReply('hi from grok'); }
    seen.openai = req; return openaiReply('hi from gpt');
  });
  const msgs = [{ r: 'me', t: 'hello' }];
  for (const [p, want] of [['anthropic', 'hi from claude'], ['gemini', 'hi from gemini'], ['xai', 'hi from grok'], ['openai', 'hi from gpt']]) {
    const id = ai.addAccount({ provider: p, key: 'K-' + p, label: 'x' });
    ai.setActive({ accountId: id, model: ai.state().accounts.find(a => a.id === id).model });
    const r = await ai.chat({ system: 'sys', messages: msgs });
    assert.equal(r.text, want);
  }
  assert.equal(seen.anthropic.headers['x-api-key'], 'K-anthropic');
  assert.equal(seen.anthropic.headers['anthropic-version'], '2023-06-01');
  assert.equal(JSON.parse(seen.anthropic.body).system, 'sys');
  assert.equal(seen.openai.headers.authorization, 'Bearer K-openai');
  assert.equal(JSON.parse(seen.openai.body).messages[0].role, 'system');
  assert.equal(seen.gemini.headers['x-goog-api-key'], 'K-gemini');
  assert.ok(seen.gemini.url.includes(':generateContent'));
  assert.equal(JSON.parse(seen.gemini.body).systemInstruction.parts[0].text, 'sys');
  assert.ok(seen.xai.url.startsWith('https://api.x.ai/'));
});

test('images are attached to the last user turn in each format', async () => {
  const img = 'data:image/jpeg;base64,AAAA';
  let last;
  const { ai } = make(req => { last = req; return req.url.includes('anthropic') ? claudeReply('x') : req.url.includes('google') ? geminiReply('x') : openaiReply('x'); });
  for (const p of ['anthropic', 'openai', 'gemini']) {
    const id = ai.addAccount({ provider: p, key: 'k' });
    ai.setActive({ accountId: id, model: ai.state().accounts.find(a => a.id === id).model });
    await ai.chat({ messages: [{ r: 'me', t: 'look' }], images: [img] });
    assert.ok(last.body.includes('AAAA'), p);
  }
});

test('limit: user is asked, options put same-model-other-account first, choice is remembered', async () => {
  let asked = null;
  const { ai, calls } = make((req) => {
    if (req.headers['x-api-key'] === 'K1') return quota().status ? { status: 429, headers: {}, text: JSON.stringify({ error: { message: 'Number of requests exceeded', type: 'rate_limit_error' } }) } : null;
    return claudeReply('answer from account two');
  }, { askLimit: async o => { asked = o; return o.options[0]; } });
  const a1 = ai.addAccount({ provider: 'anthropic', key: 'K1', label: 'Personal' });
  const a2 = ai.addAccount({ provider: 'anthropic', key: 'K2', label: 'Work' });
  ai.addAccount({ provider: 'gemini', key: 'G', label: 'Free' });
  ai.setActive({ accountId: a1, model: 'claude-sonnet-5-5' });
  const r = await ai.chat({ messages: [{ r: 'me', t: 'hi' }] });
  assert.equal(r.text, 'answer from account two');
  assert.equal(asked.options[0].kind, 'account');
  assert.match(asked.options[0].label, /Same model.*Work/);
  assert.ok(asked.options.some(o => o.kind === 'model'), 'different model on same account offered');
  assert.ok(asked.options.some(o => o.kind === 'provider' && /Gemini/.test(o.label)), 'other provider offered');
  assert.equal(ai.active().accountId, a2);
  assert.ok(r.switched && /Personal/.test(r.switched.from) && /Work/.test(r.switched.to));
  const before = calls.length;
  await ai.chat({ messages: [{ r: 'me', t: 'again' }] });
  assert.equal(calls.length, before + 1, 'next message goes straight to the chosen account');
});

test('limit: account-wide quota does not offer other models on the same account', async () => {
  let asked;
  const { ai } = make(req => req.headers.authorization === 'Bearer BAD' ? quota() : openaiReply('ok'), { askLimit: async o => { asked = o; return o.options[0]; } });
  const a = ai.addAccount({ provider: 'openai', key: 'BAD' });
  ai.addAccount({ provider: 'xai', key: 'G' });
  ai.setActive({ accountId: a, model: ai.state().accounts[0].model });
  await ai.chat({ messages: [{ r: 'me', t: 'x' }] });
  assert.ok(!asked.options.some(o => o.kind === 'model'));
});

test('limit: declining the prompt gives a clear error', async () => {
  const { ai } = make(() => quota(), { askLimit: async () => null });
  ai.addAccount({ provider: 'openai', key: 'k' });
  ai.addAccount({ provider: 'xai', key: 'k2' });
  await assert.rejects(ai.chat({ messages: [{ r: 'me', t: 'x' }] }), e => e.kind === 'limit' && e.declined);
});

test('autoSwitch picks the first option without asking', async () => {
  let asked = false;
  const { ai } = make(req => req.headers['x-api-key'] === 'K1' ? rate() : claudeReply('two'), { askLimit: async () => { asked = true; return null; } });
  ai.addAccount({ provider: 'anthropic', key: 'K1', label: 'one' });
  ai.addAccount({ provider: 'anthropic', key: 'K2', label: 'two' });
  ai.setOption('autoSwitch', true);
  const r = await ai.chat({ messages: [{ r: 'me', t: 'x' }] });
  assert.equal(r.text, 'two'); assert.equal(asked, false);
});

test('a limited account is skipped until its time is up', async () => {
  let t = 1000000;
  const { ai, calls } = make(req => req.headers['x-api-key'] === 'K1' ? rate() : claudeReply('two'), { now: () => t });
  const a1 = ai.addAccount({ provider: 'anthropic', key: 'K1' });
  ai.addAccount({ provider: 'anthropic', key: 'K2' });
  ai.setOption('autoSwitch', true);
  await ai.chat({ messages: [{ r: 'me', t: 'x' }] });
  assert.equal(ai.usable({ accountId: a1, model: 'claude-sonnet-5-5' }), false);
  t += 31000;
  assert.equal(ai.usable({ accountId: a1, model: 'claude-sonnet-5-5' }), true);
});

test('bad key: account is flagged and the next AI answers', async () => {
  const { ai } = make(req => req.headers.authorization === 'Bearer BAD' ? { status: 401, headers: {}, text: 'Incorrect API key' } : claudeReply('x') && openaiReply('fine'));
  const a = ai.addAccount({ provider: 'openai', key: 'BAD' });
  ai.addAccount({ provider: 'xai', key: 'GOOD' });
  const r = await ai.chat({ messages: [{ r: 'me', t: 'x' }] });
  assert.equal(r.text, 'fine');
  assert.equal(ai.usable({ accountId: a, model: ai.state().accounts[0].model }), false);
  ai.updateAccount(a, { key: 'NEW' });
  assert.equal(ai.usable({ accountId: a, model: ai.state().accounts[0].model }), true, 'fixing the key re-enables it');
});

test('offline falls back to the on-phone model and the full conversation goes with it', async () => {
  let localArgs;
  const local = { ready: () => true, label: () => 'Gemma (on phone)', chat: async a => { localArgs = a; return 'local answer'; } };
  const { ai } = make(() => { throw new Error('offline'); }, { local });
  ai.addAccount({ provider: 'openai', key: 'k' });
  const history = [{ r: 'me', t: 'first question' }, { r: 'bot', t: 'first answer' }, { r: 'me', t: 'follow up' }];
  const r = await ai.chat({ system: 'tutor', messages: history });
  assert.equal(r.text, 'local answer');
  assert.equal(r.via.provider, 'local');
  assert.deepEqual(localArgs.turns.map(t => t.text), ['first question', 'first answer', 'follow up']);
});

test('handoff: the second provider receives the whole earlier conversation', async () => {
  const bodies = [];
  const { ai } = make(req => { bodies.push(req.body); return req.url.includes('anthropic') ? claudeReply('claude says hi') : openaiReply('gpt says hi'); });
  const g = ai.addAccount({ provider: 'openai', key: 'k' });
  const c = ai.addAccount({ provider: 'anthropic', key: 'k' });
  ai.setActive({ accountId: g, model: ai.state().accounts[0].model });
  const conv = [{ r: 'me', t: 'teach me greetings' }];
  const r1 = await ai.chat({ messages: conv });
  conv.push({ r: 'bot', t: r1.text, via: r1.via }, { r: 'me', t: 'now give me a quiz' });
  ai.setActive({ accountId: c, model: 'claude-sonnet-5-5' });
  await ai.chat({ messages: conv });
  const sent = JSON.parse(bodies[1]).messages.map(m => m.content);
  assert.deepEqual(sent, ['teach me greetings', 'gpt says hi', 'now give me a quiz']);
});

test('long conversations are trimmed for the small local model and the model is told', async () => {
  let args;
  const local = { ready: () => true, label: () => 'L', chat: async a => { args = a; return 'ok'; } };
  const { ai } = make(() => { throw new Error('x'); }, { local });
  const msgs = [];
  for (let i = 0; i < 40; i++) { msgs.push({ r: 'me', t: 'q' + i + ' ' + 'x'.repeat(400) }); msgs.push({ r: 'bot', t: 'a' + i + ' ' + 'y'.repeat(400) }); }
  msgs.push({ r: 'me', t: 'last question' });
  await ai.chat({ system: 'S', messages: msgs });
  assert.ok(args.turns.length < msgs.length);
  assert.equal(args.turns[args.turns.length - 1].text, 'last question');
  assert.equal(args.turns[0].role, 'user');
  assert.match(args.system, /earlier message/);
});

test('concurrent limit hits ask the user only once', async () => {
  let prompts = 0;
  const { ai } = make(req => req.headers['x-api-key'] === 'K1' ? rate() : claudeReply('ok'), {
    askLimit: async o => { prompts++; await new Promise(r => setTimeout(r, 20)); return o.options[0]; }
  });
  const a1 = ai.addAccount({ provider: 'anthropic', key: 'K1' });
  ai.addAccount({ provider: 'anthropic', key: 'K2' });
  ai.setActive({ accountId: a1, model: 'claude-sonnet-5-5' });
  const rs = await Promise.all([1, 2, 3].map(() => ai.chat({ messages: [{ r: 'me', t: 'x' }] })));
  assert.equal(prompts, 1);
  rs.forEach(r => assert.equal(r.text, 'ok'));
});

/* ---------------- translation pipeline ---------------- */
const mtLocal = (map) => ({ ready: () => true, translate: async t => map[t] || 'draft:' + t });

test('pipeline: local draft -> AI fixes it, adds diacritics, explains meaning', async () => {
  let prompt;
  const reply = JSON.stringify({ translation: 'How are you doing?', source_diacritized: 'كَيْفَ حَالُكَ', meaning: '' });
  const { ai } = make(req => { prompt = JSON.parse(req.body).messages.at(-1).content; return openaiReply(reply); }, { mt: mtLocal({ 'كيف حالك': 'How is your condition' }) });
  ai.addAccount({ provider: 'openai', key: 'k' });
  const r = await ai.translateLine('كيف حالك', { ctx: { prev: ['مرحبا'] } });
  assert.equal(r.t, 'How are you doing?');
  assert.equal(r.d, 'كَيْفَ حَالُكَ');
  assert.equal(r.refined, true);
  assert.match(prompt, /How is your condition/, 'the draft is given to the AI');
  assert.match(prompt, /Before: مرحبا/, 'neighbouring lines are given as context');
});

test('pipeline: diacritics that change a word are discarded, translation still used', async () => {
  const reply = JSON.stringify({ translation: 'Where are you going?', source_diacritized: 'أَيْنَ تَسِيرُ' });   // "تذهب" replaced by "تسير"
  const { ai } = make(() => openaiReply(reply));
  ai.addAccount({ provider: 'openai', key: 'k' });
  const r = await ai.translateLine('أين تذهب');
  assert.equal(r.t, 'Where are you going?');
  assert.equal(r.d, '');
});

test('pipeline: result is cached, second call makes no request', async () => {
  const { ai, calls } = make(() => openaiReply(JSON.stringify({ translation: 'Hello' })));
  ai.addAccount({ provider: 'openai', key: 'k' });
  await ai.translateLine('مرحبا');
  const n = calls.length;
  const r = await ai.translateLine('مرحبا');
  assert.equal(r.t, 'Hello'); assert.equal(calls.length, n);
});

test('pipeline: model answers in the wrong language -> rejected, draft used', async () => {
  const { ai } = make(() => openaiReply(JSON.stringify({ translation: 'مرحبا بك' })), { mt: mtLocal({ 'مرحبا': 'Hello' }) });
  ai.addAccount({ provider: 'openai', key: 'k' });
  const r = await ai.translateLine('مرحبا');
  assert.equal(r.t, 'Hello'); assert.equal(r.refined, false);
});

test('pipeline: plain-text answer from a small model is accepted', async () => {
  const { ai } = make(() => openaiReply('"Good morning"'));
  ai.addAccount({ provider: 'openai', key: 'k' });
  assert.equal((await ai.translateLine('صباح الخير')).t, 'Good morning');
});

test('pipeline: no AI, only on-phone translator -> draft, flagged as not refined', async () => {
  const { ai } = make(() => { throw new Error('no net'); }, { mt: mtLocal({ 'مرحبا': 'Hello' }) });
  const r = await ai.translateLine('مرحبا');
  assert.equal(r.t, 'Hello'); assert.equal(r.refined, false);
});

test('pipeline: nothing available -> a message that says what to do', async () => {
  const { ai } = make(() => { throw new Error('x'); });
  await assert.rejects(ai.translateLine('مرحبا'), /AI account|translator/i);
});

test('pipeline: translation API (DeepL) provides the draft, AI refines', async () => {
  const urls = [];
  const { ai } = make(req => { urls.push(req.url); return req.url.includes('deepl') ? ok(JSON.stringify({ translations: [{ text: 'draft from deepl' }] })) : openaiReply(JSON.stringify({ translation: 'Fixed by AI' })); });
  ai.addAccount({ provider: 'deepl', key: 'abc:fx' });
  ai.addAccount({ provider: 'openai', key: 'k' });
  ai.setOption('mtMode', 'api');
  const r = await ai.translateLine('مرحبا');
  assert.equal(r.t, 'Fixed by AI');
  assert.ok(urls[0].startsWith('https://api-free.deepl.com/'));
  assert.equal(r.draft, 'draft from deepl');
});

test('pipeline: Google Translate API entities are decoded', async () => {
  const { ai } = make(req => req.url.includes('translation.googleapis') ? ok(JSON.stringify({ data: { translations: [{ translatedText: 'It&#39;s fine' }] } })) : openaiReply('x'));
  ai.addAccount({ provider: 'google_mt', key: 'k' });
  ai.setOption('mtMode', 'api'); ai.setOption('refine', false);
  assert.equal((await ai.translateLine('لا بأس')).t, "It's fine");
});

test('prefetch: ten lines cost one request, then each line is already cached', async () => {
  const lines = Array.from({ length: 10 }, (_, i) => 'سطر ' + i);
  const { ai, calls } = make(req => {
    const sent = JSON.parse(JSON.parse(req.body).messages.at(-1).content.split('\n')[1]);
    return openaiReply(JSON.stringify(sent.map(x => ({ i: x.i, translation: 'line ' + x.i }))));
  });
  ai.addAccount({ provider: 'openai', key: 'k' });
  await ai.prefetch(lines);
  assert.equal(calls.length, 1);
  for (let i = 0; i < 10; i++) assert.equal((await ai.translateLine(lines[i])).t, 'line ' + i);
  assert.equal(calls.length, 1);
});

test('prefetch: a line asked for while its batch is in flight joins the batch', async () => {
  const { ai, calls } = make(req => {
    const sent = JSON.parse(JSON.parse(req.body).messages.at(-1).content.split('\n')[1]);
    return new Promise(res => setTimeout(() => res(openaiReply(JSON.stringify(sent.map(x => ({ i: x.i, translation: 'T' + x.i }))))), 30));
  });
  ai.addAccount({ provider: 'openai', key: 'k' });
  const lines = ['أ', 'ب', 'ج'];
  const batch = ai.prefetch(lines);
  const single = ai.translateLine('ب');
  await batch;
  assert.equal((await single).t, 'T1');
  assert.equal(calls.length, 1);
});

test('prefetch: a batch reply with missing items falls back for those lines only', async () => {
  const { ai } = make(req => {
    const body = JSON.parse(req.body).messages.at(-1).content;
    if (body.startsWith('Translate these')) return openaiReply(JSON.stringify([{ i: 0, translation: 'first' }]));   // item 1 missing
    return openaiReply(JSON.stringify({ translation: 'second (single call)' }));
  });
  ai.addAccount({ provider: 'openai', key: 'k' });
  await ai.prefetch(['واحد', 'اثنان']);
  assert.equal((await ai.translateLine('واحد')).t, 'first');
  assert.equal((await ai.translateLine('اثنان')).t, 'second (single call)');
});

test('word lookup: meaning in context + validated diacritics', async () => {
  let prompt;
  const { ai } = make(req => { prompt = JSON.parse(req.body).messages.at(-1).content; return openaiReply(JSON.stringify({ gloss: 'to write', diacritized: 'كَتَبَ', lemma: 'كتب', pos: 'verb', root: 'ك-ت-ب', note: '' })); });
  ai.addAccount({ provider: 'openai', key: 'k' });
  const r = await ai.lookupWord('كتب', 'هو كتب رسالة');
  assert.equal(r.gloss, 'to write'); assert.equal(r.d, 'كَتَبَ'); assert.equal(r.pos, 'verb'); assert.equal(r.lemma, 'كتب');
  assert.match(prompt, /هو كتب رسالة/);
});

test('languages: Hebrew gets niqqud validation, languages without diacritics never ask for them', async () => {
  let prompt;
  const { ai } = make(req => { prompt = JSON.parse(req.body).messages.at(-1).content; return openaiReply(JSON.stringify({ translation: 'Hello', source_diacritized: 'שָׁלוֹם' })); });
  ai.addAccount({ provider: 'openai', key: 'k' });
  const he = await ai.translateLine('שלום', { src: 'he', tgt: 'en' });
  assert.equal(he.d, 'שָׁלוֹם'); assert.match(prompt, /niqqud/);
  await ai.translateLine('bonjour', { src: 'fr', tgt: 'en' });
  assert.doesNotMatch(prompt, /diacritiz/);
});

test('diacritic alignment helper', () => {
  assert.equal(SA.alignDiacritics('كيف حالك', 'كَيْفَ حَالُكَ', 'ar'), 'كَيْفَ حَالُكَ');
  assert.equal(SA.alignDiacritics('كيف حالك', 'كَيْفَ', 'ar'), '');
  assert.equal(SA.alignDiacritics('كيف حالك', 'كَيْفَ حَالُهُ', 'ar'), '');
  assert.equal(SA.alignDiacritics('hello', 'hello', 'en'), '');
});

test('refreshModels reads each provider list format', async () => {
  const { ai } = make(req => {
    if (req.url.includes('generativelanguage')) return ok(JSON.stringify({ models: [{ name: 'models/gemini-x', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed-1', supportedGenerationMethods: ['embedContent'] }] }));
    if (req.url.includes('anthropic')) return ok(JSON.stringify({ data: [{ id: 'claude-b' }, { id: 'claude-a' }] }));
    return ok(JSON.stringify({ data: [{ id: 'gpt-z' }, { id: 'text-embedding-3' }, { id: 'whisper-1' }] }));
  });
  const g = ai.addAccount({ provider: 'gemini', key: 'k' }), c = ai.addAccount({ provider: 'anthropic', key: 'k' }), o = ai.addAccount({ provider: 'openai', key: 'k' });
  assert.deepEqual(await ai.refreshModels(g), ['gemini-x']);
  assert.deepEqual(await ai.refreshModels(c), ['claude-a', 'claude-b']);
  assert.deepEqual(await ai.refreshModels(o), ['gpt-z']);
});

test('state survives a reload and a removed account never stays active', async () => {
  const mem = {}; const store = { get: (k, d) => (k in mem ? JSON.parse(mem[k]) : d), set: (k, v) => { mem[k] = JSON.stringify(v); } };
  const a = SA.create({ store, http: async () => claudeReply('x') });
  const id = a.addAccount({ provider: 'anthropic', key: 'k', label: 'Mine' });
  a.setActive({ accountId: id, model: 'claude-sonnet-5-5' });
  const b = SA.create({ store, http: async () => claudeReply('x') });
  assert.equal(b.state().accounts[0].label, 'Mine'); assert.equal(b.active().accountId, id);
  b.removeAccount(id);
  assert.equal(b.active(), null);
});

/* ---------------------------------------------------------------- which AI for which job */
function twoAccountsPlusLocal() {
  const localCalls = [];
  const m = make(req => (req.url.includes('anthropic') ? claudeReply('from claude') : openaiReply('from gpt')),
    { local: { ready: () => true, label: () => 'Phone AI', chat: async a => { localCalls.push(a); return 'from phone'; } }, askLimit: async () => { throw new Error('must not ask during background work'); } });
  m.ai.addAccount({ provider: 'openai', key: 'k1', label: 'A' });
  m.ai.addAccount({ provider: 'anthropic', key: 'k2', label: 'B' });
  m.localCalls = localCalls;
  return m;
}

test('tiers: heavy jobs use the API first, light jobs use the on-phone model first, and the chosen AI is not changed', async () => {
  const { ai, calls, localCalls } = twoAccountsPlusLocal();
  const before = JSON.stringify(ai.state().active);
  const h = await ai.chat({ system: 's', messages: [{ r: 'me', t: 'x' }], tier: 'heavy' });
  assert.equal(h.text, 'from gpt'); assert.equal(localCalls.length, 0);
  const l = await ai.chat({ system: 's', messages: [{ r: 'me', t: 'x' }], tier: 'light' });
  assert.equal(l.text, 'from phone'); assert.equal(calls.length, 1, 'the light job made no API call');
  assert.equal(JSON.stringify(ai.state().active), before, 'background work never changes the AI the user picked');
  assert.equal(ai.pick('heavy').accountId !== 'local', true); assert.equal(ai.pick('light').accountId, 'local');
});

test('tiers: with no on-phone model a light job uses the API; with no API a heavy job uses the phone', async () => {
  let m = make(() => openaiReply('from gpt')); m.ai.addAccount({ provider: 'openai', key: 'k', label: 'A' });
  assert.equal((await m.ai.chat({ system: 's', messages: [{ r: 'me', t: 'x' }], tier: 'light' })).text, 'from gpt');
  m = make(() => openaiReply('x'), { local: { ready: () => true, chat: async () => 'from phone' } });
  assert.equal((await m.ai.chat({ system: 's', messages: [{ r: 'me', t: 'x' }], tier: 'heavy' })).text, 'from phone');
  assert.equal(m.ai.isLocalSlot(m.ai.pick('heavy')), true);
});

test('quiet background job: when the API hits its limit it falls back by itself and never asks the user', async () => {
  const { ai, localCalls } = twoAccountsPlusLocal();
  // both API accounts are out of quota; a normal chat would ask, a quiet heavy job drops to the phone
  const { ai: ai2, localCalls: lc2 } = (() => { const x = make(() => quota(), { local: { ready: () => true, chat: async () => 'from phone' }, askLimit: async () => { throw new Error('asked'); } }); x.ai.addAccount({ provider: 'openai', key: 'k', label: 'A' }); return { ai: x.ai, localCalls: [] }; })();
  const r = await ai2.chat({ system: 's', messages: [{ r: 'me', t: 'x' }], tier: 'heavy', quiet: true });
  assert.equal(r.text, 'from phone'); assert.equal(r.switched, null);
});

test('limit: powerful AI used up -> on-phone AI takes over without asking, and the API is used again after it resets', async () => {
  let t = 1000000, asked = false, limited = true;
  const local = { ready: () => true, chat: async () => 'from phone' };
  const { ai } = make(() => limited ? rate() : claudeReply('from api'), { now: () => t, local, askLimit: async () => { asked = true; return null; } });
  ai.addAccount({ provider: 'anthropic', key: 'K1' });
  const r = await ai.chat({ messages: [{ r: 'me', t: 'x' }] });
  assert.equal(r.text, 'from phone'); assert.equal(asked, false);
  limited = false; t += 120000;
  assert.equal((await ai.chat({ messages: [{ r: 'me', t: 'y' }] })).text, 'from api');
});

test('AI log: the whole prompt and the whole reply are kept, including failed attempts, and survive a restart', async () => {
  const mem = {}; const store = { get: (k, d) => (k in mem ? JSON.parse(mem[k]) : d), set: (k, v) => { mem[k] = JSON.stringify(v); } };
  const local = { ready: () => true, chat: async () => 'from phone' };
  const { ai } = make(() => rate(), { store, local });
  ai.addAccount({ provider: 'anthropic', key: 'K1' });
  await ai.chat({ system: 'SYS', messages: [{ r: 'me', t: 'make flashcards for X' }], purpose: 'write-flashcards', tier: 'heavy', quiet: true });
  const l = ai.log.list();
  assert.equal(l.length, 2);
  assert.equal(l[0].ok, false); assert.match(l[0].error, /limit/); assert.equal(l[0].purpose, 'write-flashcards');
  assert.equal(l[1].ok, true); assert.equal(l[1].reply, 'from phone'); assert.equal(l[1].system, 'SYS'); assert.match(l[1].prompt, /make flashcards for X/);
  assert.ok(!JSON.stringify(l).includes('K1'));
  ai.flush();
  const again = SA.create({ http: async () => rate(), store });
  assert.equal(again.log.count(), 2);
  assert.match(again.log.exportText(), /make flashcards for X/); assert.equal(JSON.parse(again.log.exportJSON()).count, 2);
  again.setOption('logAI', false); again.log.clear();
  await again.chat({ messages: [{ r: 'me', t: 'x' }] }).catch(() => {});
  assert.equal(again.log.count(), 0);
});

test('AI log: bounded, oldest entries dropped first', async () => {
  const { ai } = make(() => claudeReply('r'.repeat(50)), { logMax: 5 });
  ai.addAccount({ provider: 'anthropic', key: 'K' });
  for (let i = 0; i < 9; i++) await ai.chat({ messages: [{ r: 'me', t: 'q' + i }] });
  const l = ai.log.list(); assert.equal(l.length, 5); assert.match(l[0].prompt, /q4/); assert.match(l[4].prompt, /q8/);
});
