// Safina translation core: Arabic -> English with a local Marian (opus-mt-ar-en) ONNX model.
// Pure logic, no globals: ONNX Runtime, the tokenizer and the model files are injected,
// so the same code runs in the Android WebView and in Node tests.
//
// There is deliberately NO dictionary, cloud or "sample" fallback in here. Every failure
// is thrown as a TranslationError that names the stage that failed.

export class TranslationError extends Error {
  constructor(stage, message, cause) {
    super(message);
    this.name = 'TranslationError';
    this.stage = stage;       // 'input' | 'load' | 'tokenize' | 'encode' | 'decode'
    this.cause = cause;
  }
}

const STAGE_LABEL = {
  input: 'Invalid input',
  load: 'The ONNX translation model failed to load',
  tokenize: 'Tokenization failed',
  encode: 'ONNX encoder failed',
  decode: 'ONNX decoder failed'
};

export function describeError(e) {
  if (e && e.name === 'TranslationError') {
    const base = STAGE_LABEL[e.stage] || 'Translation failed';
    return base + ': ' + e.message;
  }
  return 'Translation failed: ' + (e && e.message ? e.message : String(e));
}

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const MAX_CHARS = 1500;
const MAX_SRC_TOKENS = 256;

/**
 * deps = {
 *   ort:            { Tensor }                      // onnxruntime-web namespace
 *   loadConfig():   Promise<object>                 // models/ar-en/config.json
 *   loadTokenizer():Promise<{encode(text):number[], decode(ids):string}>
 *   createSession(fileName): Promise<InferenceSession>
 *   onProgress?(msg)
 *   prefix?:        string   language tag some multi-target models need in front of the text (">>ara<<")
 *   scriptRe?:      RegExp | null   the input must contain a letter of this script. Omitted: Arabic (the original
 *                   behaviour). null: no check (languages without a distinctive script, or an unknown pair).
 * }
 * The returned engine also has release() to free the three ONNX sessions.
 */
export function createEngine(deps) {
  let ready = null;      // Promise<state>; cleared on failure so the next call retries
  let queue = Promise.resolve();

  async function load() {
    const progress = deps.onProgress || (() => {});
    try {
      progress('Reading model configuration…');
      const cfg = await deps.loadConfig();
      progress('Loading tokenizer…');
      const tok = await deps.loadTokenizer();
      progress('Loading encoder (1/3)…');
      const encoder = await deps.createSession('encoder_model.onnx');
      progress('Loading decoder (2/3)…');
      const decoder = await deps.createSession('decoder_model.onnx');
      progress('Loading decoder with cache (3/3)…');
      const cached = await deps.createSession('decoder_with_past_model.onnx');
      progress('');
      const state = {
        tok, encoder, decoder, cached,
        layers: cfg.decoder_layers || 6,
        vocab: cfg.vocab_size || 62834,
        eos: cfg.eos_token_id ?? 0,
        start: cfg.decoder_start_token_id ?? cfg.pad_token_id ?? 62833,
        pad: cfg.pad_token_id ?? 62833
      };
      requireInputs(state.encoder, ['input_ids', 'attention_mask'], 'encoder_model.onnx');
      requireInputs(state.decoder, ['input_ids', 'encoder_hidden_states'], 'decoder_model.onnx');
      requireInputs(state.cached, ['input_ids'], 'decoder_with_past_model.onnx');
      return state;
    } catch (e) {
      if (e instanceof TranslationError) throw e;
      throw new TranslationError('load', e && e.message ? e.message : String(e), e);
    }
  }

  function requireInputs(session, names, file) {
    const have = session && session.inputNames;
    if (!have) return;
    const missing = names.filter(n => !have.includes(n));
    if (missing.length) {
      throw new TranslationError('load',
        file + ' does not expose the expected inputs (' + missing.join(', ') +
        '). It exposes: ' + have.join(', '));
    }
  }

  function ensureLoaded() {
    if (!ready) {
      ready = load().catch(e => { ready = null; throw e; });
    }
    return ready;
  }

  const i64 = (arr, dims) => new deps.ort.Tensor('int64', BigInt64Array.from(arr.map(BigInt)), dims);

  function argmax(logits, vocab, banned) {
    const d = logits.data;
    if (!d || d.length < vocab) {
      throw new TranslationError('decode', 'decoder returned invalid logits (expected at least ' + vocab + ' values, got ' + (d ? d.length : 0) + ')');
    }
    const off = d.length - vocab;          // last position of [1, seq, vocab]
    let best = -1, bestV = -Infinity;
    for (let i = 0; i < vocab; i++) {
      const v = d[off + i];
      // A NaN anywhere means the graph produced garbage (fp16 overflow, corrupt file...). Comparisons with NaN
      // are always false, so without this check the loop would quietly pick some other token and the user
      // would see a plausible-looking but meaningless "translation".
      if (v !== v) throw new TranslationError('decode', 'decoder returned invalid logits (NaN at token ' + i + ')');
      if (i === banned) continue;
      if (v > bestV) { bestV = v; best = i; }
    }
    if (best < 0 || !Number.isFinite(bestV)) {
      throw new TranslationError('decode', 'decoder returned invalid logits');
    }
    return best;
  }

  function feedsFor(session, all) {
    // Only pass inputs the graph really declares; unknown extras make ORT throw.
    const names = session.inputNames;
    if (!names) return all;
    const out = {};
    for (const n of names) {
      if (!(n in all)) {
        throw new TranslationError('decode', 'missing decoder input "' + n + '"');
      }
      out[n] = all[n];
    }
    return out;
  }

  async function run(text) {
    if (typeof text !== 'string') throw new TranslationError('input', 'text must be a string');
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    const scriptRe = deps.scriptRe === undefined ? ARABIC_RE : deps.scriptRe;
    if (scriptRe && !scriptRe.test(clean)) {
      throw new TranslationError('input', deps.scriptRe === undefined ? 'no Arabic letters found in the input' : 'the text is not in the language this translator reads');
    }
    if (clean.length > MAX_CHARS) {
      throw new TranslationError('input', 'text is too long (' + clean.length + ' characters, limit ' + MAX_CHARS + ')');
    }

    const S = await ensureLoaded();

    let ids;
    try {
      ids = Array.from(S.tok.encode(deps.prefix ? deps.prefix + ' ' + clean : clean));
    } catch (e) {
      throw new TranslationError('tokenize', e && e.message ? e.message : String(e), e);
    }
    if (!ids.length) throw new TranslationError('tokenize', 'tokenizer produced no tokens');
    if (ids.length > MAX_SRC_TOKENS) ids = ids.slice(0, MAX_SRC_TOKENS - 1).concat([S.eos]);
    if (ids[ids.length - 1] !== S.eos) ids.push(S.eos);

    const n = ids.length;
    const mask = () => i64(new Array(n).fill(1), [1, n]);

    let hidden;
    try {
      const enc = await S.encoder.run({ input_ids: i64(ids, [1, n]), attention_mask: mask() });
      hidden = enc.last_hidden_state || enc[Object.keys(enc)[0]];
      if (!hidden) throw new Error('encoder returned no hidden states');
    } catch (e) {
      throw new TranslationError('encode', e && e.message ? e.message : String(e), e);
    }

    const generated = [];
    try {
      const maxNew = Math.min(400, Math.ceil(n * 2) + 10);
      const first = await S.decoder.run(feedsFor(S.decoder, {
        input_ids: i64([S.start], [1, 1]),
        encoder_attention_mask: mask(),
        encoder_hidden_states: hidden
      }));

      const past = {};
      const grab = (out, parts) => {
        for (let l = 0; l < S.layers; l++) {
          for (const part of parts) {
            for (const kind of ['key', 'value']) {
              const v = out[`present.${l}.${part}.${kind}`];
              if (v) past[`past_key_values.${l}.${part}.${kind}`] = v;
            }
          }
        }
      };
      grab(first, ['decoder', 'encoder']);

      let token = argmax(first.logits, S.vocab, S.pad);
      for (let step = 0; step < maxNew && token !== S.eos; step++) {
        generated.push(token);
        const out = await S.cached.run(feedsFor(S.cached, {
          input_ids: i64([token], [1, 1]),
          encoder_attention_mask: mask(),
          ...past
        }));
        grab(out, ['decoder']);            // encoder K/V are constant after step 0
        token = argmax(out.logits, S.vocab, S.pad);
      }
    } catch (e) {
      if (e instanceof TranslationError) throw e;
      throw new TranslationError('decode', e && e.message ? e.message : String(e), e);
    }

    let english;
    try {
      english = String(S.tok.decode(generated)).replace(/▁/g, ' ').replace(/\s+/g, ' ').trim();
    } catch (e) {
      throw new TranslationError('tokenize', 'could not decode output tokens: ' + (e && e.message ? e.message : e), e);
    }
    if (!english) throw new TranslationError('decode', 'the model produced an empty translation');
    return english;
  }

  return {
    // Calls run one at a time; one failure does not poison the queue.
    translate(text) {
      const job = queue.then(() => run(text));
      queue = job.catch(() => {});
      return job;
    },
    preload: ensureLoaded,
    async release() {
      const p = ready; ready = null;
      if (!p) return;
      try {
        const S = await p;
        for (const s of [S.cached, S.decoder, S.encoder]) { try { if (s && s.release) await s.release(); } catch (_) { /* already freed */ } }
      } catch (_) { /* it never loaded */ }
    },
    get isLoaded() { return !!ready; }
  };
}
