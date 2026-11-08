import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const factory = require('../www/safina-models.js');

function fakeEnv(over) {
  const disk = new Map();           // path -> size
  const mem = {};
  const listeners = [];
  const downloads = [];
  const Filesystem = {
    addListener: async (ev, fn) => { listeners.push(fn); return { remove: () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } }; },
    downloadFile: async ({ url, path }) => {
      downloads.push({ url, path });
      if (over && over.fail && over.fail(url)) throw new Error(over.fail(url));
      const size = (over && over.sizeOf && over.sizeOf(url)) || 1000;
      listeners.forEach(l => { l({ url, bytes: size / 2, contentLength: size }); l({ url, bytes: size, contentLength: size }); });
      disk.set(path, size);
      return { path };
    },
    stat: async ({ path }) => { if (!disk.has(path)) throw new Error('nope'); return { size: disk.get(path) }; },
    deleteFile: async ({ path }) => { if (!disk.delete(path)) throw new Error('nope'); },
    rename: async ({ from, to }) => { disk.set(to, disk.get(from)); disk.delete(from); },
    rmdir: async ({ path }) => { for (const k of [...disk.keys()]) if (k.startsWith(path)) disk.delete(k); },
    getUri: async ({ path }) => ({ uri: 'file:///data/user/0/app/files/' + path })
  };
  const store = { get: (k, d) => (k in mem ? JSON.parse(mem[k]) : d), set: (k, v) => { mem[k] = JSON.stringify(v); } };
  const llmCalls = [];
  const Llm = { load: async a => { llmCalls.push(['load', a]); }, generate: async a => { llmCalls.push(['generate', a]); return { text: 'hello<end_of_turn>' }; }, unload: async () => { llmCalls.push(['unload']); } };
  return { env: Object.assign({ Filesystem: () => Filesystem, Llm: () => (over && over.noLlm ? undefined : Llm), store, convertFileSrc: u => u.replace('file://', 'http://localhost/_capacitor_file_'), fetchJson: async () => { throw new Error('no net'); }, emit: () => {} }, over && over.env), disk, downloads, llmCalls };
}

test('urlFor: placeholders and the default folder layout', () => {
  const M = factory({});
  assert.equal(M.urlFor('https://h/x/{pair}-{file}', 'ar-en', 'config.json'), 'https://h/x/ar-en-config.json');
  assert.equal(M.urlFor('https://h/models/', 'ar-en', 'config.json'), 'https://h/models/ar-en/config.json');
  assert.equal(M.urlFor('', 'ar-en', 'x'), '');
});

test('manifest: normalised, bad entries dropped; template builds both directions per language', async () => {
  const M = factory({});
  const m = M.normaliseManifest({
    translators: [{ id: 'ar-en', files: [{ name: 'a.onnx', url: 'https://x/a', size: 10 }, { name: 'b.onnx', url: 'https://x/b', size: 5 }] }, { id: 'broken' }, { id: 'x', files: [] }],
    llms: [{ id: 'g', name: 'G', family: 'gemma', file: { url: 'https://x/g.task' } }, { id: 'nofile' }]
  });
  assert.equal(m.translators.length, 1); assert.equal(m.translators[0].size, 15); assert.equal(m.translators[0].src, 'ar'); assert.equal(m.translators[0].tgt, 'en');
  assert.equal(m.llms.length, 1);
  const t = M.translatorsFromTemplate('https://h/m', ['ar', 'fr', 'en']);
  assert.deepEqual(t.map(x => x.id), ['ar-en', 'en-ar', 'fr-en', 'en-fr']);
  assert.equal(t[0].files.length, 6);
  assert.equal(t[0].files[3].url, 'https://h/m/ar-en/encoder_model.onnx');
});

test('loadManifest: remote manifest wins; failure falls back to the template and reports the error', async () => {
  const e = fakeEnv({ env: { fetchJson: async () => ({ translators: [{ id: 'ar-en', files: [{ name: 'f', url: 'https://x/f' }] }] }) } });
  const M = factory(e.env);
  M.setConfig({ manifestUrl: 'https://x/manifest.json', translatorBase: 'https://h/m' });
  let m = await M.loadManifest(['ar']);
  assert.equal(m.source, 'manifest'); assert.equal(m.translators.find(x => x.id === 'ar-en').files.length, 1, 'the manifest entry wins; built-in fills only the pairs it lacks');
  const e2 = fakeEnv();
  const M2 = factory(e2.env);
  M2.setConfig({ manifestUrl: 'https://x/manifest.json', translatorBase: 'https://h/m' });
  m = await M2.loadManifest(['ar']);
  assert.equal(m.source, 'template'); assert.match(m.error, /Could not read the manifest/); assert.equal(m.translators.length, 2);
});

test('install: all files downloaded to .part then renamed, progress adds up, pack is registered', async () => {
  const e = fakeEnv({ sizeOf: u => (u.endsWith('big') ? 3000 : 1000) });
  const M = factory(e.env);
  const pack = { id: 'ar-en', src: 'ar', tgt: 'en', prefix: '', files: [{ name: 'small.json', url: 'https://x/small', size: 1000 }, { name: 'big.onnx', url: 'https://x/big', size: 3000 }] };
  const seen = [];
  await M.install('tr', pack, p => seen.push(p));
  assert.ok(e.downloads.every(d => d.path.endsWith('.part')));
  assert.ok(e.disk.has('safina-models/tr/ar-en/small.json') && e.disk.has('safina-models/tr/ar-en/big.onnx'));
  assert.ok(![...e.disk.keys()].some(k => k.endsWith('.part')));
  assert.equal(seen.at(-1).bytes, 4000); assert.equal(seen.at(-1).total, 4000);
  assert.equal(M.hasTranslator('ar', 'en'), true); assert.equal(M.hasTranslator('en', 'ar'), false);
});

test('install: a failed file leaves nothing half-installed and says which address was wrong', async () => {
  const e = fakeEnv({ fail: u => (u.endsWith('big') ? 'Request failed with status 404' : '') });
  const M = factory(e.env);
  const pack = { id: 'fr-en', src: 'fr', tgt: 'en', files: [{ name: 'a', url: 'https://x/a' }, { name: 'b', url: 'https://x/big' }] };
  await assert.rejects(M.install('tr', pack), /File not found at https:\/\/x\/big/);
  assert.equal(M.hasTranslator('fr', 'en'), false);
  assert.ok(![...e.disk.keys()].some(k => k.endsWith('.part')));
});

test('install: a download that stops early is rejected', async () => {
  const e = fakeEnv();
  e.env.Filesystem().downloadFile = async ({ url, path }) => { e.disk.set(path, 400); e.env.Filesystem().addListener; };
  const fs = e.env.Filesystem();
  const origAdd = fs.addListener; let cb;
  fs.addListener = async (ev, fn) => { cb = fn; return { remove() {} }; };
  fs.downloadFile = async ({ url, path }) => { cb({ url, bytes: 400, contentLength: 1000 }); e.disk.set(path, 400); };
  const M = factory(e.env);
  await assert.rejects(M.install('tr', { id: 'x-y', files: [{ name: 'f', url: 'https://x/f' }] }), /stopped early/);
});

test('verify: a pack whose file vanished or changed size is no longer installed', async () => {
  const e = fakeEnv();
  const M = factory(e.env);
  await M.install('tr', { id: 'ar-en', src: 'ar', tgt: 'en', files: [{ name: 'a', url: 'https://x/a' }] });
  assert.equal(M.hasTranslator('ar', 'en'), true);
  await M.verify(); assert.equal(M.hasTranslator('ar', 'en'), true);
  e.disk.delete('safina-models/tr/ar-en/a');
  await M.verify(); assert.equal(M.hasTranslator('ar', 'en'), false);
});

test('remove deletes the files and the record', async () => {
  const e = fakeEnv();
  const M = factory(e.env);
  await M.install('tr', { id: 'ar-en', src: 'ar', tgt: 'en', files: [{ name: 'a', url: 'https://x/a' }] });
  await M.remove('tr', 'ar-en');
  assert.equal(e.disk.size, 0); assert.equal(M.hasTranslator('ar', 'en'), false);
});

test('on-phone AI: ready only with the engine and a downloaded model; loads once; uses the right template', async () => {
  const e = fakeEnv();
  const M = factory(e.env);
  assert.equal(M.local.ready(), false);
  await M.install('llm', { id: 'gemma', name: 'Gemma', family: 'gemma', file: { name: 'm.task', url: 'https://x/m' } });
  assert.equal(M.local.ready(), true);
  const out = await M.local.chat({ system: 'SYS', turns: [{ role: 'user', text: 'hi' }] });
  await M.local.chat({ system: 'SYS', turns: [{ role: 'user', text: 'again' }] });
  assert.equal(out, 'hello');
  assert.equal(e.llmCalls.filter(c => c[0] === 'load').length, 1);
  assert.equal(e.llmCalls[0][1].path, '/data/user/0/app/files/safina-models/llm/gemma/m.task');
  assert.ok(e.llmCalls.find(c => c[0] === 'generate')[1].prompt.startsWith('<start_of_turn>user\nSYS\n\nhi<end_of_turn>'));
  const e2 = fakeEnv({ noLlm: true });
  const M2 = factory(e2.env);
  await M2.install('llm', { id: 'g', family: 'gemma', file: { name: 'm', url: 'https://x/m' } });
  assert.equal(M2.local.ready(), false, 'no engine in this build -> not offered');
});

test('chat templates', () => {
  const M = factory({});
  const turns = [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'c' }];
  assert.equal(M.formatPrompt('gemma', 'S', turns),
    '<start_of_turn>user\nS\n\na<end_of_turn>\n<start_of_turn>model\nb<end_of_turn>\n<start_of_turn>user\nc<end_of_turn>\n<start_of_turn>model\n');
  assert.equal(M.formatPrompt('chatml', 'S', turns),
    '<|im_start|>system\nS<|im_end|>\n<|im_start|>user\na<|im_end|>\n<|im_start|>assistant\nb<|im_end|>\n<|im_start|>user\nc<|im_end|>\n<|im_start|>assistant\n');
});

test('on-device translator passes folder, prefix and script to the bundle', async () => {
  const e = fakeEnv();
  let got;
  const M = factory(Object.assign(e.env, { importBundle: async () => ({ translate: async (t, o) => { got = [t, o]; return 'Hello'; } }), scriptOf: l => (l === 'ar' ? '[\\u0600-\\u06FF]' : '') }));
  await M.install('tr', { id: 'ar-en', src: 'ar', tgt: 'en', prefix: '', files: [{ name: 'a', url: 'https://x/a' }] });
  assert.equal(await M.marian.translate('مرحبا', 'ar', 'en'), 'Hello');
  assert.equal(got[1].pair, 'ar-en'); assert.equal(got[1].dir, 'http://localhost/_capacitor_file_/data/user/0/app/files/safina-models/tr/ar-en/'); assert.equal(got[1].script, '[\\u0600-\\u06FF]');
  await assert.rejects(M.marian.translate('hello', 'en', 'ar'), /not downloaded/);
});

test('built-in sources: with nothing configured the app still knows where to download the translator and the AI', async () => {
  const f = fakeEnv(); const M = factory(f.env);
  M.setConfig({ allowBuiltin: false });
  assert.equal((await M.loadManifest(['ar', 'en'])).translators.length, 0, 'can be switched off');
  M.setConfig({ allowBuiltin: true });
  const m = await M.loadManifest(['ar', 'en']);
  assert.equal(m.source, 'built-in');
  const t = m.translators.find(x => x.id === 'ar-en');
  assert.ok(t && t.files.length === 6);
  const enc = t.files.find(x => x.name === 'encoder_model.onnx');
  assert.match(enc.url, /^https:\/\/huggingface\.co\/Xenova\/opus-mt-ar-en\/resolve\/main\/onnx\/encoder_model_quantized\.onnx$/, 'stored under the standard name, fetched from the quantized file');
  assert.match(t.files.find(x => x.name === 'tokenizer.json').url, /opus-mt-ar-en\/resolve\/main\/tokenizer\.json$/);
  assert.ok(m.translators.some(x => x.id === 'en-ar'));
  assert.ok(m.llms.length >= 1);
});

test('your own folder pattern overrides the built-in source for that pair', async () => {
  const f = fakeEnv(); const M = factory(f.env);
  M.setConfig({ translatorBase: 'https://mine.example/{pair}/{file}' });
  const m = await M.loadManifest(['ar', 'en']);
  assert.match(m.translators.find(x => x.id === 'ar-en').files[0].url, /^https:\/\/mine\.example\/ar-en\//);
});

test('autoSetup downloads the missing translator and the on-phone AI, once, and skips what is installed', async () => {
  const f = fakeEnv(); const M = factory(Object.assign({}, f.env, { native: () => true, onCellular: () => false }));
  M.setConfig({ translatorBase: 'https://mine.example/{pair}/{file}', allowBuiltin: true });
  const r1 = await M.autoSetup({ learn: 'ar', native: 'en' });
  assert.deepEqual(r1.failed, []);
  assert.ok(M.hasTranslator('ar', 'en')); assert.ok(M.local.ready());
  const n = f.downloads.length;
  const r2 = await M.autoSetup({ learn: 'ar', native: 'en' });
  assert.equal(f.downloads.length, n, 'nothing is downloaded twice'); assert.deepEqual(r2.done, []);
});

test('autoSetup: no AI download on mobile data, no AI download without the engine, nothing outside the app', async () => {
  let f = fakeEnv(); let M = factory(Object.assign({}, f.env, { native: () => true, onCellular: () => true })); M.setConfig({ translatorBase: 'https://mine.example/{pair}/{file}', allowBuiltin: true }); M.setConfig({ translatorBase: 'https://mine.example/{pair}/{file}', allowBuiltin: true });
  let r = await M.autoSetup({ learn: 'ar', native: 'en' });
  assert.ok(M.hasTranslator('ar', 'en')); assert.ok(!M.local.ready()); assert.ok(r.skipped.some(s => /Wi-Fi/.test(s)));
  f = fakeEnv({ noLlm: true }); M = factory(Object.assign({}, f.env, { native: () => true, onCellular: () => false })); M.setConfig({ translatorBase: 'https://mine.example/{pair}/{file}', allowBuiltin: true });
  await M.autoSetup({ learn: 'fr', native: 'en' });
  assert.ok(M.hasTranslator('fr', 'en')); assert.ok(f.downloads.every(d => !/\.task/.test(d.url)));
  f = fakeEnv(); M = factory(Object.assign({}, f.env, { native: () => false })); M.setConfig({ translatorBase: 'https://mine.example/{pair}/{file}' });
  r = await M.autoSetup({ learn: 'ar', native: 'en' });
  assert.equal(f.downloads.length, 0); assert.equal(r.done.length, 0);
});

test('autoSetup reports a failed download (not a crash) and does not hammer the same failure', async () => {
  const f = fakeEnv({ fail: u => /encoder_model/.test(u) ? 'HTTP 404 not found' : '' }); const M = factory(Object.assign({}, f.env, { native: () => true, onCellular: () => false })); M.setConfig({ translatorBase: 'https://mine.example/{pair}/{file}', allowBuiltin: true });
  const r = await M.autoSetup({ learn: 'ar', native: 'en' });
  assert.equal(r.failed.length, 1); assert.match(r.failed[0].error, /not found/i); assert.ok(!M.hasTranslator('ar', 'en'));
  const n = f.downloads.length; const r2 = await M.autoSetup({ learn: 'ar', native: 'en' });
  assert.equal(f.downloads.length, n); assert.ok(r2.skipped.some(s => /failed earlier/.test(s)));
});

test('English to Arabic carries the >>ara<< language tag; Arabic to English does not', async () => {
  const M = factory(fakeEnv().env); const m = await M.loadManifest(['ar', 'en']);
  assert.equal(m.translators.find(x => x.id === 'en-ar').prefix, '>>ara<<');
  assert.equal(m.translators.find(x => x.id === 'ar-en').prefix, '');
});
