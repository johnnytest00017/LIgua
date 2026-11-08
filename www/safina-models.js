/* Safina model manager: downloads translator packs (one per language pair) and the on-phone AI into app
 * storage after install, so the APK itself stays small.
 *
 *   translator pack  = Helsinki-NLP opus-mt ONNX files for one direction, e.g. "ar-en" or "en-ar"
 *   on-phone AI      = one model file for the native LinguaLlm plugin (MediaPipe LLM Inference)
 *
 * WHERE THE FILES COME FROM is yours to set, in the app (AI settings > Downloads) or by editing DEFAULT_CONFIG:
 *   manifestUrl      a JSON file you host (GitHub raw / release asset / any https). Lets you add languages
 *                    and models later without shipping a new APK. Schema:
 *   {
 *     "translators": [ { "id": "ar-en", "src": "ar", "tgt": "en", "prefix": "", "size": 160000000,
 *                        "files": [ { "name": "encoder_model.onnx", "url": "https://...", "size": 50000000 }, ... ] } ],
 *     "llms":        [ { "id": "gemma3-1b", "name": "Gemma 3 1B", "family": "gemma", "size": 555000000,
 *                        "file": { "name": "model.task", "url": "https://..." } } ]
 *   }
 *   translatorBase   (alternative, no manifest) a URL pattern. {pair} and {file} are replaced, e.g.
 *                    https://github.com/YOU/REPO/releases/download/models/{pair}-{file}
 *                    A base without {file} is read as BASE/{pair}/{file}.
 *
 * A translator pack needs these files (same names as the Xenova/transformers.js ONNX export):
 *   config.json, tokenizer.json, tokenizer_config.json, encoder_model.onnx, decoder_model.onnx, decoder_with_past_model.onnx
 * "prefix" is for multi-target models such as opus-mt-en-ar, which need a language tag in front of the text
 * (for example ">>ara<<"). Check the model card of each model you host.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.SafinaModels = factory({});
})(typeof self !== 'undefined' ? self : this, function (env) {
  'use strict';
  env = env || {};
  const W = typeof window !== 'undefined' ? window : {};
  const E = {
    Filesystem: env.Filesystem || (() => W.Capacitor && W.Capacitor.Plugins && W.Capacitor.Plugins.Filesystem),
    Llm: env.Llm || (() => {   /* the native LinguaLlm plugin, however this Capacitor build exposes it */
      const C = W.Capacitor; if (!C) return undefined;
      if (C.Plugins && C.Plugins.LinguaLlm) return C.Plugins.LinguaLlm;
      if (C.isPluginAvailable && C.registerPlugin && C.isPluginAvailable('LinguaLlm')) return (W.__linguaLlm = W.__linguaLlm || C.registerPlugin('LinguaLlm'));
      return undefined;
    }),
    store: env.store || { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* full */ } } },
    fetchJson: env.fetchJson || (async u => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
    convertFileSrc: env.convertFileSrc || (u => (W.Capacitor && W.Capacitor.convertFileSrc ? W.Capacitor.convertFileSrc(u) : u)),
    native: env.native || (() => !!(W.Capacitor && W.Capacitor.isNativePlatform && W.Capacitor.isNativePlatform())),
    importBundle: env.importBundle || (() => import('./lingua-onnx.js')),
    onCellular: env.onCellular || (() => { const c = W.navigator && W.navigator.connection; return !!(c && c.type === 'cellular'); }),
    emit: env.emit || (() => {})
  };

  const scriptOf = env.scriptOf || (l => { const L = W.SafinaAI && W.SafinaAI.LANGS && W.SafinaAI.LANGS[l]; return L && L.script ? L.script.source : ''; });

  const DEFAULT_CONFIG = { manifestUrl: '', translatorBase: '', customLlm: null, llm: null, setupDone: false, allowBuiltin: true };
  const TRANSLATOR_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'encoder_model.onnx', 'decoder_model.onnx', 'decoder_with_past_model.onnx'];
  /* BUILT-IN SOURCES: used when you have not set a manifest or folder pattern, so the app downloads what it needs by itself.
   * Translator: the public Xenova/opus-mt-<pair> ONNX exports on Hugging Face (int8-quantized files, about 4x smaller than fp32),
   * stored locally under the standard names the engine expects. Local AI: a small MediaPipe .task model.
   * These addresses could not be checked from the build machine. If one is wrong the download says which file was not found;
   * point the app at your own copy in AI settings > Downloads (manifest or folder pattern) and it takes priority. */
  const BUILTIN = {
    translatorUrl: (pair, remote) => 'https://huggingface.co/Xenova/opus-mt-' + pair + '/resolve/main/' + remote,
    /* multi-target models need a language tag in front of the text; en-ar is the one this app uses */
    prefixes: { 'en-ar': '>>ara<<' },
    remoteName: name => /\.onnx$/.test(name) ? 'onnx/' + name.replace(/\.onnx$/, '_quantized.onnx') : name,
    llms: [{ id: 'qwen2.5-0.5b', name: 'Qwen 2.5 0.5B', family: 'chatml', size: 550000000,
      file: { name: 'qwen2.5-0.5b.task', url: 'https://huggingface.co/litert-community/Qwen2.5-0.5B-Instruct/resolve/main/Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task' } }]
  };
  const DIR = 'safina-models';
  const CFG_KEY = 'safina.models.cfg', REG_KEY = 'safina.models.installed';

  const cfg = () => Object.assign({}, DEFAULT_CONFIG, E.store.get(CFG_KEY, {}) || {});
  const setConfig = patch => { E.store.set(CFG_KEY, Object.assign(cfg(), patch)); };
  const registry = () => E.store.get(REG_KEY, {}) || {};
  const setRegistry = r => E.store.set(REG_KEY, r);

  /* ---------------- manifest ---------------- */
  function urlFor(base, pair, file) {
    const b = String(base || '').trim();
    if (!b) return '';
    return (b.includes('{file}') ? b : b.replace(/\/+$/, '') + '/{pair}/{file}').replace(/\{pair\}/g, pair).replace(/\{file\}/g, file);
  }
  function translatorsFromTemplate(base, langCodes) {
    const out = [];
    (langCodes || []).filter(c => c !== 'en').forEach(c => {
      [[c, 'en'], ['en', c]].forEach(([src, tgt]) => {
        const pair = src + '-' + tgt;
        out.push({ id: pair, src, tgt, prefix: '', size: 0, files: TRANSLATOR_FILES.map(name => ({ name, url: urlFor(base, pair, name) })) });
      });
    });
    return out;
  }
  function builtinTranslators(langCodes) {
    const out = [];
    (langCodes || []).filter(c => c !== 'en').forEach(c => {
      [[c, 'en'], ['en', c]].forEach(([src, tgt]) => {
        const pair = src + '-' + tgt;
        out.push({ id: pair, src, tgt, prefix: BUILTIN.prefixes[pair] || '', size: 0, builtin: true, files: TRANSLATOR_FILES.map(name => ({ name, url: BUILTIN.translatorUrl(pair, BUILTIN.remoteName(name)) })) });
      });
    });
    return out;
  }
  function normaliseManifest(j) {
    const m = { translators: [], llms: [] };
    (j && j.translators || []).forEach(t => {
      if (!t || !t.id || !Array.isArray(t.files) || !t.files.length) return;
      m.translators.push({ id: String(t.id), src: t.src || String(t.id).split('-')[0], tgt: t.tgt || String(t.id).split('-')[1], prefix: t.prefix || '', size: +t.size || t.files.reduce((s, f) => s + (+f.size || 0), 0), files: t.files.filter(f => f && f.name && f.url).map(f => ({ name: String(f.name), url: String(f.url), size: +f.size || 0 })) });
    });
    (j && j.llms || []).forEach(l => {
      if (!l || !l.id || !l.file || !l.file.url) return;
      m.llms.push({ id: String(l.id), name: l.name || String(l.id), family: l.family || 'chatml', size: +l.size || +l.file.size || 0, file: { name: l.file.name || (l.id + '.task'), url: String(l.file.url), size: +l.file.size || 0 } });
    });
    return m;
  }
  async function loadManifest(langCodes) {
    const c = cfg();
    let m = { translators: [], llms: [] }, source = 'none', error = '';
    if (c.manifestUrl) {
      try { m = normaliseManifest(await E.fetchJson(c.manifestUrl)); source = 'manifest'; }
      catch (e) { error = 'Could not read the manifest (' + (e && e.message ? e.message : e) + ')'; }
    }
    if (!m.translators.length && c.translatorBase) { m.translators = translatorsFromTemplate(c.translatorBase, langCodes); source = source === 'manifest' ? source : 'template'; }
    /* your own sources win; the built-in ones fill every pair and model you did not provide */
    if (c.allowBuiltin !== false) {   /* on by default; your own manifest or folder pattern always wins; set allowBuiltin:false to use only your own */
      builtinTranslators(langCodes).forEach(t => { if (!m.translators.some(x => x.id === t.id)) m.translators.push(t); });
      BUILTIN.llms.forEach(l => { if (!m.llms.some(x => x.id === l.id)) m.llms.push(l); });
      if (source === 'none') source = 'built-in';
    }
    if (c.customLlm && c.customLlm.url) m.llms.push({ id: 'custom', name: c.customLlm.name || 'Custom model', family: c.customLlm.family || 'chatml', size: 0, file: { name: 'custom.task', url: c.customLlm.url } });
    return Object.assign(m, { source, error });
  }

  /* ---------------- files ---------------- */
  const FS = () => { const f = E.Filesystem(); if (!f) throw new Error('Downloads work in the installed app, not in a browser.'); return f; };
  const rel = (kind, id, name) => DIR + '/' + kind + '/' + id + (name ? '/' + name : '');

  async function downloadOne(url, path, onBytes) {
    const fs = FS();
    const part = path + '.part';
    let handle = null;
    let total = 0;
    try {
      if (fs.addListener) handle = await fs.addListener('progress', p => { if (p && p.url === url) { total = p.contentLength || total; onBytes(p.bytes || 0, total); } });
      /* The plugin does not create the folder for a download on Android (the file then fails with ENOENT), so make it first. */
      const dir = part.split('/').slice(0, -1).join('/');
      if (dir && fs.mkdir) { try { await fs.mkdir({ path: dir, directory: 'DATA', recursive: true }); } catch (e) { if (!/exist/i.test(String(e && e.message || e))) throw e; } }
      await fs.downloadFile({ url, path: part, directory: 'DATA', recursive: true, progress: true });
      const st = await fs.stat({ path: part, directory: 'DATA' });
      if (!st || !(st.size > 0)) throw new Error('the download was empty');
      if (total && st.size < total) throw new Error('the download stopped early (' + st.size + ' of ' + total + ' bytes)');
      try { await fs.deleteFile({ path, directory: 'DATA' }); } catch (_) { /* not there yet */ }
      await fs.rename({ from: part, to: path, directory: 'DATA', toDirectory: 'DATA' });
      onBytes(st.size, st.size);
      return st.size;
    } catch (e) {
      try { await fs.deleteFile({ path: part, directory: 'DATA' }); } catch (_) { /* nothing to clean */ }
      const msg = String(e && e.message ? e.message : e);
      throw new Error(/404|not found/i.test(msg) ? 'File not found at ' + url + ' (check the address in Downloads settings)' : msg);
    } finally { if (handle && handle.remove) handle.remove(); }
  }

  const busy = {};
  async function install(kind, pack, onProgress) {
    const key = kind + ':' + pack.id;
    if (busy[key]) return busy[key];
    const files = kind === 'tr' ? pack.files : [pack.file];
    const sizes = files.map(f => f.size || 0);
    const done = files.map(() => 0);
    const report = (i, got, tot) => {
      if (tot) sizes[i] = tot;
      done[i] = got;
      const all = sizes.reduce((a, b) => a + b, 0) || pack.size || 0;
      onProgress && onProgress({ pack: key, bytes: done.reduce((a, b) => a + b, 0), total: all, file: files[i].name });
    };
    busy[key] = (async () => {
      const got = {};
      for (let i = 0; i < files.length; i++) {
        got[files[i].name] = await downloadOne(files[i].url, rel(kind, pack.id, files[i].name), (b, t) => report(i, b, t));
      }
      const r = registry();
      r[key] = { kind, id: pack.id, name: pack.name || pack.id, src: pack.src, tgt: pack.tgt, prefix: pack.prefix || '', family: pack.family || '', files: got, file: kind === 'llm' ? files[0].name : '', at: Date.now() };
      setRegistry(r);
      E.emit('installed', key);
      return r[key];
    })().finally(() => { delete busy[key]; });
    return busy[key];
  }
  async function remove(kind, id) {
    const fs = FS();
    try { await fs.rmdir({ path: rel(kind, id), directory: 'DATA', recursive: true }); } catch (_) { /* already gone */ }
    const r = registry(); delete r[kind + ':' + id]; setRegistry(r);
    if (kind === 'llm') { await unloadLlm(); if (cfg().llm === id) setConfig({ llm: null }); }
    if (kind === 'tr') await releaseMarian();
    E.emit('removed', kind + ':' + id);
  }
  /* A pack counts as installed only if its files are still on disk at the recorded size. */
  async function verify() {
    if (!E.Filesystem()) return registry();
    const fs = E.Filesystem(), r = registry(); let changed = false;
    for (const key of Object.keys(r)) {
      const rec = r[key]; let good = true;
      for (const name of Object.keys(rec.files || {})) {
        try { const st = await fs.stat({ path: rel(rec.kind, rec.id, name), directory: 'DATA' }); if (!st || st.size !== rec.files[name]) good = false; } catch (_) { good = false; }
      }
      if (!good) { delete r[key]; changed = true; }
    }
    if (changed) setRegistry(r);
    return r;
  }
  const installed = (kind, id) => !!registry()[kind + ':' + id];
  const hasTranslator = (src, tgt) => installed('tr', src + '-' + tgt);
  const busyKeys = () => Object.keys(busy);

  /* ---------------- on-device translator (Marian ONNX) ---------------- */
  let marianBundle = null, dirCache = {};
  async function dirUrl(pair) {
    if (dirCache[pair]) return dirCache[pair];
    const { uri } = await FS().getUri({ path: rel('tr', pair), directory: 'DATA' });
    return (dirCache[pair] = E.convertFileSrc(uri).replace(/\/+$/, '') + '/');
  }
  const marian = {
    ready: (src, tgt) => hasTranslator(src, tgt),
    async translate(text, src, tgt) {
      const pair = src + '-' + tgt, rec = registry()['tr:' + pair];
      if (!rec) throw new Error('The ' + pair + ' translator is not downloaded');
      if (!marianBundle) marianBundle = E.importBundle();
      const m = await marianBundle;
      return m.translate(text, { pair, dir: await dirUrl(pair), prefix: rec.prefix || '', script: scriptOf(src) });
    }
  };
  async function releaseMarian() { dirCache = {}; if (marianBundle) { try { const m = await marianBundle; if (m.release) await m.release(); } catch (_) { /* ignore */ } } }

  /* ---------------- on-phone AI ---------------- */
  /* Chat templates. MediaPipe adds the BOS token itself. */
  function formatPrompt(family, system, turns) {
    if (family === 'gemma') {
      let out = '';
      turns.forEach((t, i) => {
        const text = (i === 0 && system ? system + '\n\n' : '') + t.text;
        out += '<start_of_turn>' + (t.role === 'user' ? 'user' : 'model') + '\n' + text + '<end_of_turn>\n';
      });
      return out + '<start_of_turn>model\n';
    }
    let out = system ? '<|im_start|>system\n' + system + '<|im_end|>\n' : '';
    turns.forEach(t => { out += '<|im_start|>' + (t.role === 'user' ? 'user' : 'assistant') + '\n' + t.text + '<|im_end|>\n'; });
    return out + '<|im_start|>assistant\n';
  }
  let llmLoaded = null;
  const currentLlm = () => { const r = registry(); const id = cfg().llm; return (id && r['llm:' + id]) || Object.values(r).find(x => x.kind === 'llm') || null; };
  async function ensureLlm() {
    const plugin = E.Llm(); if (!plugin) throw new Error('This build has no on-phone AI engine (LinguaLlm plugin missing)');
    const rec = currentLlm(); if (!rec) throw new Error('No on-phone AI is downloaded');
    if (llmLoaded && llmLoaded.id === rec.id) return rec;
    E.emit('status', 'Loading ' + rec.name + '…');
    const { uri } = await FS().getUri({ path: rel('llm', rec.id, rec.file), directory: 'DATA' });
    await plugin.load({ path: uri.replace(/^file:\/\//, ''), maxTokens: 1280 });
    llmLoaded = { id: rec.id };
    E.emit('status', '');
    return rec;
  }
  async function unloadLlm() { llmLoaded = null; const p = E.Llm(); if (p && p.unload) { try { await p.unload(); } catch (_) { /* ignore */ } } }
  const local = {
    ready: () => !!(E.Llm() && currentLlm()),
    label: () => { const r = currentLlm(); return r ? r.name + ' (on this phone)' : 'On-phone AI'; },
    async chat({ system, turns }) {
      const rec = await ensureLlm();
      const prompt = formatPrompt(rec.family, system, turns);
      const out = await E.Llm().generate({ prompt, maxTokens: 512 });
      return String(out && out.text || '').replace(/<end_of_turn>|<\|im_end\|>/g, '').trim();
    }
  };
  /* Automatic setup: downloads the translator for the user's language pair and, when the build has the engine and the phone is
   * not on mobile data, the on-phone AI. Safe to call repeatedly: it only fetches what is missing. Failures are returned, not thrown. */
  const failedAuto = {};
  async function autoSetup(o) {
    o = o || {};
    const out = { done: [], failed: [], skipped: [] };
    if (!E.native()) { out.skipped.push('not in the installed app'); return out; }
    const learn = o.learn, native = o.native;
    if (!learn || !native || learn === native) return out;
    if (!cfg().manifestUrl && !cfg().translatorBase && cfg().allowBuiltin === false) { out.skipped.push('no download source set'); out.needSource = true; return out; }
    const man = await loadManifest([learn, native]);
    const jobs = [];
    const tr = man.translators.find(t => t.id === learn + '-' + native);
    if (tr && !installed('tr', tr.id)) jobs.push(['tr', tr]);
    else if (!tr) out.failed.push({ id: learn + '-' + native, error: 'No translator source for ' + learn + ' to ' + native });
    if (E.Llm() && !local.ready()) {
      const llm = man.llms.find(x => x.id !== 'custom') || man.llms[0];
      if (llm && !installed('llm', llm.id)) {
        if (E.onCellular() && !o.allowCellular) out.skipped.push('on-phone AI waits for Wi-Fi');
        else jobs.push(['llm', llm]);
      }
    }
    for (const [kind, pack] of jobs) {
      const key = kind + ':' + pack.id;
      if (failedAuto[key] && !o.retry) { out.skipped.push(key + ' failed earlier'); continue; }
      try {
        await install(kind, pack, o.onProgress);
        if (kind === 'llm' && !currentLlm()) selectLlm(pack.id);
        delete failedAuto[key]; out.done.push(key);
      } catch (e) { failedAuto[key] = 1; out.failed.push({ id: key, error: String(e && e.message || e) }); }
    }
    return out;
  }
  const selectLlm = id => { setConfig({ llm: id }); llmLoaded = null; };

  return {
    cfg, setConfig, loadManifest, normaliseManifest, translatorsFromTemplate, urlFor, TRANSLATOR_FILES,
    autoSetup, install, remove, verify, installed, hasTranslator, busyKeys, registry,
    marian, local, formatPrompt, selectLlm, currentLlm, unloadLlm,
    isNative: () => E.native(), onCellular: () => E.onCellular(), hasLlmEngine: () => !!E.Llm()
  };
});
