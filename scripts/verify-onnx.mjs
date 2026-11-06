// Runs the REAL engine (real tokenizer + your three ONNX files) in Node, on your PC, with no
// Android build needed. Do this BEFORE building the APK: if it prints sensible English here,
// the model, tokenizer and generation logic are fine and any remaining problem is Android-side.
//
//   node scripts/verify-onnx.mjs
//   node scripts/verify-onnx.mjs "مرحبا بكم في سفينة"      (your own sentence)
import * as ort from 'onnxruntime-web';
import { Tokenizer } from '@huggingface/tokenizers';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, describeError } from '../src/lingua-translate-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'www', 'models', 'ar-en');
ort.env.wasm.numThreads = 1;

const engine = createEngine({
  ort,
  onProgress: m => m && console.log('  …', m),
  loadConfig: async () => JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')),
  loadTokenizer: async () => {
    const tk = new Tokenizer(JSON.parse(readFileSync(join(dir, 'tokenizer.json'), 'utf8')),
      JSON.parse(readFileSync(join(dir, 'tokenizer_config.json'), 'utf8')));
    return {
      encode: s => { const r = tk.encode(s); return Array.isArray(r) ? r : r.ids; },
      decode: ids => tk.decode(ids, { skip_special_tokens: true })
    };
  },
  createSession: async f => ort.InferenceSession.create(new Uint8Array(readFileSync(join(dir, f))), {
    executionProviders: ['wasm'], graphOptimizationLevel: 'basic'
  })
});

const samples = process.argv[2] ? [process.argv[2]] : [
  'أريد أن أذهب إلى المدرسة.',
  'أين تسكن الآن؟',
  'الكتاب على الطاولة.',
  'سأرى صديقي غدا في المقهى القريب من بيتنا بعد انتهاء العمل.'
];

let failed = 0;
for (const s of samples) {
  const t0 = Date.now();
  try {
    const en = await engine.translate(s);
    console.log('\nAR: ' + s + '\nEN: ' + en + '\n    (' + (Date.now() - t0) + ' ms)');
  } catch (e) {
    failed++;
    console.log('\nAR: ' + s + '\nFAILED: ' + describeError(e));
    if (e && e.cause) console.log('    cause:', e.cause.stack || e.cause);
  }
}
console.log(failed ? '\n' + failed + ' translation(s) FAILED' : '\nAll translations produced output. Read them above: they must be real English sentences.');
process.exit(failed ? 1 : 0);
