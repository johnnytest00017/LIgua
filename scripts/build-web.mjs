// Builds www/lingua-onnx.js (the on-phone translator engine) and copies the ONNX runtime files into www/ort/.
// NOTE: unlike the old version, this does NOT need any model files. Translator models are downloaded by the app
// after install, so nothing large is bundled.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const www = join(root, 'www');
const fail = m => { console.error('\nBUILD FAILED: ' + m + '\n'); process.exit(1); };

const entry = join(root, 'src/lingua-onnx-entry.js');
if (!existsSync(entry)) fail('src/lingua-onnx-entry.js is missing');

try {
  await build({
    entryPoints: [entry],
    outfile: join(www, 'lingua-onnx.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2020',
    minify: true, legalComments: 'none', logLevel: 'warning'
  });
} catch (e) { fail('esbuild could not bundle the engine: ' + (e && e.message ? e.message : e)); }

const dist = join(root, 'node_modules/onnxruntime-web/dist');
const ort = join(www, 'ort');
mkdirSync(ort, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  const from = join(dist, f);
  if (!existsSync(from)) fail(f + ' not found in node_modules/onnxruntime-web/dist (run npm install)');
  cpSync(from, join(ort, f));
}
// The app loads www/index.html. The page we edit is both_25.html, so copy it over on every build; otherwise an old index.html keeps being shipped.
const page = join(www, 'both_25.html');
if (existsSync(page)) { cpSync(page, join(www, 'index.html')); console.log('www/index.html <- www/both_25.html'); }
else if (!existsSync(join(www, 'index.html'))) fail('neither www/both_25.html nor www/index.html exists');
const mb = p => (statSync(p).size / 1048576).toFixed(1) + ' MB';
console.log('built www/lingua-onnx.js (' + mb(join(www, 'lingua-onnx.js')) + ') and www/ort/ (' + mb(join(ort, 'ort-wasm-simd-threaded.wasm')) + ' wasm). No models bundled.');
