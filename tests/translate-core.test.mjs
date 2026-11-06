import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, TranslationError, describeError } from '../src/lingua-translate-core.mjs';

/* A faithful stand-in for the three real Marian graphs. Tensor/input/output names are exactly the ones used by
 * your working lingua-onnx-test.js. The "model" is deterministic and depends on the encoder input, so a pass here
 * proves the data really flows tokenizer -> encoder -> decoder -> decoded text.
 * What this cannot prove is that your real ONNX files behave: run  npm run verify:onnx  for that. */

const V = 50, PAD = 49, EOS = 0, L = 2;                     // tiny vocab, 2 decoder layers
class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
const ort = { Tensor };

const spec = ids => ids.slice(0, -1).map(i => (i % 40) + 1);   // what the fake model "translates" a source into
const words = ids => ids.map(i => '▁w' + i).join('');

function makeWorld(over = {}) {
  const w = { calls: { enc: 0, dec: 0, cached: 0, create: [] }, active: 0, maxActive: 0, log: [], ...over };

  const guard = async fn => {
    w.active++; w.maxActive = Math.max(w.maxActive, w.active);
    await new Promise(r => setTimeout(r, 1));
    try { return await fn(); } finally { w.active--; }
  };
  const logitsFor = tok => {
    const d = new Float32Array(V).fill(0);
    d[PAD] = 100;                                            // the model "wants" pad: it must be banned
    if (tok !== EOS) d[tok] = 5; else d[EOS] = 5;
    return d;
  };
  const kv = (t) => new Tensor('float32', new Float32Array(t * 2), [1, 2, t, 1]);

  const encoder = {
    inputNames: ['input_ids', 'attention_mask'],
    async run(feeds) {
      return guard(async () => {
        w.calls.enc++;
        if (w.encFail) throw new Error('encoder exploded');
        const ids = feeds.input_ids, m = feeds.attention_mask;
        assert.equal(ids.type, 'int64'); assert.ok(ids.data instanceof BigInt64Array);
        assert.deepEqual(ids.dims, [1, ids.data.length]); assert.deepEqual(m.dims, ids.dims);
        w.encIds = Array.from(ids.data, Number);
        return { last_hidden_state: new Tensor('float32', Float32Array.from(w.encIds), [1, w.encIds.length, 1]) };
      });
    }
  };
  const decoder = {
    inputNames: ['input_ids', 'encoder_attention_mask', 'encoder_hidden_states'],
    async run(feeds) {
      return guard(async () => {
        w.calls.dec++;
        assert.equal(Number(feeds.input_ids.data[0]), PAD, 'decoding must start from the decoder_start token');
        const hs = Array.from(feeds.encoder_hidden_states.data);
        assert.deepEqual(feeds.encoder_attention_mask.dims, [1, hs.length]);
        w.target = spec(hs);
        w.pos = 0;
        const out = { logits: new Tensor('float32', logitsFor(w.target.length ? w.target[0] : EOS), [1, 1, V]) };
        w.decT = 1;
        for (let l = 0; l < L; l++) for (const p of ['decoder', 'encoder']) for (const k of ['key', 'value'])
          out[`present.${l}.${p}.${k}`] = kv(p === 'decoder' ? 1 : hs.length);
        w.encKv = out['present.0.encoder.key'];
        if (w.nanLogits) out.logits.data[0] = NaN;
        if (w.immediateEos) out.logits = new Tensor('float32', logitsFor(EOS), [1, 1, V]);
        return out;
      });
    }
  };
  const pastNames = [];
  for (let l = 0; l < L; l++) for (const p of ['decoder', 'encoder']) for (const k of ['key', 'value']) pastNames.push(`past_key_values.${l}.${p}.${k}`);
  const cached = {
    inputNames: ['input_ids', 'encoder_attention_mask', ...pastNames],
    async run(feeds) {
      return guard(async () => {
        w.calls.cached++;
        if (w.decodeFailAt && w.calls.cached === w.decodeFailAt) throw new Error('decoder exploded at step ' + w.calls.cached);
        for (const n of pastNames) if (!feeds[n]) throw new Error('Missing Input: ' + n);   // ORT behaves like this
        assert.equal(feeds['past_key_values.0.decoder.key'].dims[2], w.decT, 'decoder KV length must grow by one per step');
        assert.strictEqual(feeds['past_key_values.0.encoder.key'], w.encKv, 'encoder KV must be reused unchanged');
        w.pos++; w.decT++;
        const next = w.pos < w.target.length ? w.target[w.pos] : EOS;
        const out = { logits: new Tensor('float32', logitsFor(next), [1, 1, V]) };
        for (let l = 0; l < L; l++) for (const k of ['key', 'value']) out[`present.${l}.decoder.${k}`] = kv(w.decT);
        return out;
      });
    }
  };

  w.deps = {
    ort,
    loadConfig: async () => ({ decoder_layers: L, vocab_size: V, eos_token_id: EOS, pad_token_id: PAD, decoder_start_token_id: PAD }),
    loadTokenizer: async () => {
      if (w.tokFail) throw new Error('tokenizer.json is corrupt');
      return {
        encode: text => { if (w.encodeThrows) throw new Error('bad token'); return w.encodeEmpty ? [] : Array.from(text.replace(/\s+/g, ''), c => (c.codePointAt(0) % 40) + 1); },
        decode: ids => words(ids)
      };
    },
    createSession: async f => {
      w.calls.create.push(f);
      if (w.createFail && w.createFail === f) throw new Error('Failed to allocate 231 MB for ' + f);
      return { 'encoder_model.onnx': w.badEncoder ? { inputNames: ['foo'], run() {} } : encoder, 'decoder_model.onnx': decoder, 'decoder_with_past_model.onnx': cached }[f];
    }
  };
  return w;
}
const ar = n => 'مرحبا '.repeat(n).trim();                 // Arabic input of n words
const expected = text => { const ids = Array.from(text.replace(/\s+/g, ''), c => (c.codePointAt(0) % 40) + 1).concat([EOS]); return spec(ids).length ? words(spec(ids)).replace(/▁/g, ' ').trim() : ''; };

/* ------------------------------------------------------------------ happy path */
test('short sentence: tokenizer -> encoder -> decoder -> English text', async () => {
  const w = makeWorld(), eng = createEngine(w.deps);
  const text = 'أريد أن أذهب';
  const out = await eng.translate(text);
  assert.equal(out, expected(text));
  assert.equal(w.calls.enc, 1); assert.equal(w.calls.dec, 1);
  assert.ok(w.calls.cached >= 1, 'the cached decoder must be used for steps after the first');
  assert.deepEqual(w.encIds.slice(-1), [EOS], 'EOS must be appended to the source ids');
});

test('longer sentence produces proportionally longer output and never emits the pad token', async () => {
  const w = makeWorld(), eng = createEngine(w.deps);
  const short = await eng.translate(ar(2)), long = await eng.translate(ar(12));
  assert.ok(long.split(' ').length > short.split(' ').length);
  assert.ok(!long.includes('w49'), 'pad token (id 49) must be banned from the output');
});

test('very long source is truncated to the model limit and still ends with EOS', async () => {
  const w = makeWorld(), eng = createEngine(w.deps);
  await eng.translate(ar(400).slice(0, 1400));
  assert.ok(w.encIds.length <= 256); assert.equal(w.encIds.at(-1), EOS);
});

/* ------------------------------------------------------------------ input validation (no model is loaded) */
test('empty and whitespace-only input return an empty string without loading the model', async () => {
  const w = makeWorld(), eng = createEngine(w.deps);
  assert.equal(await eng.translate(''), ''); assert.equal(await eng.translate('   \n\t '), '');
  assert.equal(w.calls.create.length, 0);
});

test('non-Arabic, non-string and oversized input are rejected with stage "input"', async () => {
  const w = makeWorld(), eng = createEngine(w.deps);
  for (const bad of ['Hello world', '12345 !!!', 42, null, ar(400)]) {
    await assert.rejects(() => eng.translate(bad), e => e instanceof TranslationError && e.stage === 'input', String(bad).slice(0, 20));
  }
  assert.equal(w.calls.create.length, 0, 'invalid input must never trigger a model load');
});

/* ------------------------------------------------------------------ failures are loud, staged, and never faked */
test('model load failure: stage "load", names the file, and the next call retries', async () => {
  const w = makeWorld({ createFail: 'decoder_model.onnx' }), eng = createEngine(w.deps);
  await assert.rejects(() => eng.translate(ar(3)), e => {
    assert.ok(e instanceof TranslationError); assert.equal(e.stage, 'load');
    assert.match(e.message, /decoder_model\.onnx/);
    assert.match(describeError(e), /^The ONNX translation model failed to load/);
    return true;
  });
  assert.equal(eng.isLoaded, false);
  w.createFail = null;                                       // e.g. the user freed memory
  assert.equal(await eng.translate(ar(3)), expected(ar(3)));
});

test('tokenizer file failure is reported as a load failure; tokenizer runtime failures as "tokenize"', async () => {
  let w = makeWorld({ tokFail: true });
  await assert.rejects(() => createEngine(w.deps).translate(ar(2)), e => e.stage === 'load' && /tokenizer\.json/.test(e.message));
  w = makeWorld({ encodeThrows: true });
  await assert.rejects(() => createEngine(w.deps).translate(ar(2)), e => e.stage === 'tokenize' && /Tokenization failed/.test(describeError(e)));
  w = makeWorld({ encodeEmpty: true });
  await assert.rejects(() => createEngine(w.deps).translate(ar(2)), e => e.stage === 'tokenize');
});

test('a model file with the wrong graph inputs is rejected at load time with its name', async () => {
  const w = makeWorld({ badEncoder: true });
  await assert.rejects(() => createEngine(w.deps).translate(ar(2)), e => e.stage === 'load' && /encoder_model\.onnx/.test(e.message) && /input_ids/.test(e.message));
});

test('encoder failure -> stage "encode"', async () => {
  const w = makeWorld({ encFail: true });
  await assert.rejects(() => createEngine(w.deps).translate(ar(2)), e => e.stage === 'encode' && /ONNX encoder failed/.test(describeError(e)));
});

test('decoder failure mid-generation -> stage "decode", no partial text is returned, engine stays usable', async () => {
  const w = makeWorld({ decodeFailAt: 3 }), eng = createEngine(w.deps);
  await assert.rejects(() => eng.translate(ar(10)), e => e.stage === 'decode' && /ONNX decoder failed/.test(describeError(e)) && /step 3/.test(e.message));
  w.decodeFailAt = 0;
  assert.equal(await eng.translate(ar(10)), expected(ar(10)));
});

test('invalid logits and empty generations are errors, not blank or fake translations', async () => {
  let w = makeWorld({ nanLogits: true });
  await assert.rejects(() => createEngine(w.deps).translate(ar(2)), e => e.stage === 'decode' && /invalid logits/.test(e.message));
  w = makeWorld({ immediateEos: true });
  await assert.rejects(() => createEngine(w.deps).translate(ar(2)), e => e.stage === 'decode' && /empty translation/.test(e.message));
});

/* ------------------------------------------------------------------ repeated use */
test('many consecutive translations are all correct and the model files are loaded exactly once', async () => {
  const w = makeWorld(), eng = createEngine(w.deps);
  for (let i = 1; i <= 15; i++) {
    const t = ar(i) + ' ' + 'سلام'.repeat(i % 3);
    assert.equal(await eng.translate(t.trim()), expected(t.trim()), 'translation #' + i);
  }
  assert.deepEqual(w.calls.create.sort(), ['decoder_model.onnx', 'decoder_with_past_model.onnx', 'encoder_model.onnx']);
});

test('simultaneous requests are serialised, keep their own results, and one failure does not poison the queue', async () => {
  const w = makeWorld(), eng = createEngine(w.deps);
  const jobs = [ar(2), 'English only', ar(5), ar(3), '', ar(7)];
  const settled = await Promise.allSettled(jobs.map(j => eng.translate(j)));
  assert.equal(w.maxActive, 1, 'the ONNX sessions must never be entered concurrently');
  assert.equal(settled[0].value, expected(ar(2)));
  assert.equal(settled[1].status, 'rejected');
  assert.equal(settled[2].value, expected(ar(5)));
  assert.equal(settled[3].value, expected(ar(3)));
  assert.equal(settled[4].value, '');
  assert.equal(settled[5].value, expected(ar(7)));
});

test('translating again after other work (a "returning to the screen" pattern) reuses the loaded engine', async () => {
  const w = makeWorld(), eng = createEngine(w.deps);
  const a = await eng.translate(ar(4));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(await eng.translate(ar(4)), a);
  assert.equal(w.calls.create.length, 3);
});

/* ------------------------------------------------------------------ no dictionary / cloud fallback anywhere */
test('translation sources contain no dictionary, cloud or fake-output path', async () => {
  const { readFileSync } = await import('node:fs');
  const banned = /gemini|openai|anthropic|mymemory|wiktionary|freedictionary|translate\.google|generativelanguage|api\.anthropic|fetch\(\s*['"`]https?:/i;
  for (const f of ['../src/lingua-translate-core.mjs', '../src/lingua-onnx-entry.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, banned, f);
  }
});
