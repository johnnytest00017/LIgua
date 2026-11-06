import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, TranslationError } from '../src/lingua-translate-core.mjs';

/* A tiny fake model: encoder returns hidden states, decoder emits token 5 then EOS(0). */
function deps(over) {
  const seen = { encoded: [], released: [] };
  const ort = { Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } } };
  const mk = (name, run) => ({ inputNames: undefined, run, release: async () => { seen.released.push(name); } });
  const VOCAB = 8;
  const logits = id => { const d = new Float32Array(VOCAB).fill(-1); d[id] = 5; return { data: d }; };
  const d = Object.assign({
    ort,
    loadConfig: async () => ({ decoder_layers: 1, vocab_size: VOCAB, eos_token_id: 0, decoder_start_token_id: 7, pad_token_id: 7 }),
    loadTokenizer: async () => ({ encode: t => { seen.encoded.push(t); return [3, 4]; }, decode: ids => 'tok' + ids.join(',') }),
    createSession: async f => {
      if (f === 'encoder_model.onnx') return mk('enc', async () => ({ last_hidden_state: { dims: [1, 3, 2] } }));
      if (f === 'decoder_model.onnx') return mk('dec', async () => ({ logits: logits(5) }));
      return mk('cached', async () => ({ logits: logits(0) }));
    }
  }, over);
  return { d, seen };
}

test('original behaviour is unchanged: Arabic input is required by default', async () => {
  const { d } = deps();
  const e = createEngine(d);
  await assert.rejects(e.translate('hello'), err => err instanceof TranslationError && err.stage === 'input');
  assert.equal(await e.translate('مرحبا'), 'tok5');
});

test('prefix is placed in front of the text before tokenizing', async () => {
  const { d, seen } = deps({ prefix: '>>ara<<', scriptRe: null });
  const e = createEngine(d);
  await e.translate('good morning');
  assert.deepEqual(seen.encoded, ['>>ara<< good morning']);
});

test('scriptRe: null accepts any text, a regex enforces its script', async () => {
  const a = createEngine(deps({ scriptRe: null }).d);
  assert.equal(await a.translate('bonjour'), 'tok5');
  const b = createEngine(deps({ scriptRe: /[֐-׿]/ }).d);
  await assert.rejects(b.translate('hello'), /not in the language/);
  assert.equal(await b.translate('שלום'), 'tok5');
});

test('release frees all three sessions and a later call loads again', async () => {
  const { d, seen } = deps({ scriptRe: null });
  const e = createEngine(d);
  await e.translate('x');
  await e.release();
  assert.deepEqual(seen.released.sort(), ['cached', 'dec', 'enc']);
  assert.equal(e.isLoaded, false);
  assert.equal(await e.translate('y'), 'tok5');
});
