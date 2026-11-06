// Browser entry for the on-device translators (Helsinki-NLP opus-mt, any language pair).
// esbuild bundles this file (plus onnxruntime-web, @huggingface/tokenizers and the engine core) into www/lingua-onnx.js,
// which is only imported the first time the on-device translator is needed.
//
// The model files are NOT in the APK any more. safina-models.js downloads them into app storage and passes the
// address of the folder in (a Capacitor file URL), so the same bundle serves every language pair.
// Only one pair is kept in memory at a time: switching pairs frees the previous sessions first.
//
// Exports: translate(text, {pair, dir, prefix, script}), release(), onProgress(cb), describeError(err)

import * as ort from 'onnxruntime-web';
import { Tokenizer } from '@huggingface/tokenizers';
import { createEngine, describeError, TranslationError } from './lingua-translate-core.mjs';

const ORT_DIR = new URL('ort/', document.baseURI).href;
const GLUE = 'ort-wasm-simd-threaded.mjs';
const WASM = 'ort-wasm-simd-threaded.wasm';

let progressCb = () => {};
export const onProgress = cb => { progressCb = typeof cb === 'function' ? cb : () => {}; };

async function httpGet(url, what) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error('could not read ' + what + ' (' + (e && e.message ? e.message : e) + ')');
  }
  if (!res.ok) throw new Error(what + ' returned HTTP ' + res.status + '. Download the translator again in AI settings.');
  return res;
}

async function fetchBytes(dir, fileName, label) {
  const res = await httpGet(dir + fileName, fileName);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0, lastPct = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) {
      const pct = Math.floor(got / total * 100);
      if (pct !== lastPct) { lastPct = pct; progressCb(label + ' ' + pct + '%'); }
    }
  }
  const out = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  chunks.length = 0;
  return out;
}

let runtimeReady = null;
function prepareRuntime() {
  if (!runtimeReady) {
    runtimeReady = (async () => {
      // The WebView has no cross-origin isolation, so SharedArrayBuffer threads are unavailable.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      const glue = await (await httpGet(ORT_DIR + GLUE, 'ONNX runtime script')).text();
      const glueUrl = URL.createObjectURL(new Blob([glue], { type: 'text/javascript' }));
      ort.env.wasm.wasmPaths = { mjs: glueUrl, wasm: ORT_DIR + WASM };
    })().catch(e => { runtimeReady = null; throw e; });
  }
  return runtimeReady;
}

function makeEngine({ pair, dir, prefix, script }) {
  const deps = {
    ort,
    prefix: prefix || '',
    scriptRe: script ? new RegExp(script) : null,
    onProgress: msg => progressCb(msg),
    async loadConfig() { return (await httpGet(dir + 'config.json', 'config.json')).json(); },
    async loadTokenizer() {
      const json = await (await httpGet(dir + 'tokenizer.json', 'tokenizer.json')).json();
      let cfg = {};
      try { cfg = await (await httpGet(dir + 'tokenizer_config.json', 'tokenizer_config.json')).json(); } catch (_) { /* optional */ }
      const tk = new Tokenizer(json, cfg);
      return {
        encode(text) { const r = tk.encode(text); return Array.isArray(r) ? r : r.ids; },
        decode(ids) { return tk.decode(ids, { skip_special_tokens: true }); }
      };
    },
    async createSession(fileName) {
      await prepareRuntime();
      const bytes = await fetchBytes(dir, fileName, pair + ' · ' + fileName);
      progressCb('Initialising ' + fileName + '…');
      try {
        return await ort.InferenceSession.create(bytes, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'basic',   // 'all' roughly doubles peak memory while loading
          enableCpuMemArena: false,
          enableMemPattern: false
        });
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        const oom = /memory|alloc|abort|out of/i.test(msg);
        throw new Error(fileName + ' could not be initialised: ' + msg + (oom ? ' (the phone ran out of memory loading the translator; close other apps and retry)' : ''));
      }
    }
  };
  return createEngine(deps);
}

let current = null;   // { pair, engine }
async function engineFor(o) {
  if (current && current.pair === o.pair) return current.engine;
  await release();
  current = { pair: o.pair, engine: makeEngine(o) };
  return current.engine;
}

export async function translate(text, o) {
  if (!o || !o.pair || !o.dir) throw new TranslationError('load', 'translator folder not given');
  const engine = await engineFor(o);
  return engine.translate(text);
}

export async function release() {
  if (!current) return;
  const c = current; current = null;
  await c.engine.release();
}

export { describeError, TranslationError };
