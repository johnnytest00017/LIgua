import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

/* Checks on the shipped page. www/index.html is a copy of www/both_25.html; either is accepted. */
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const exists = f => existsSync(new URL('../' + f, import.meta.url));
const pageFile = exists('www/index.html') ? 'www/index.html' : 'www/both_25.html';
const html = read(pageFile);
const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const order = [...html.matchAll(/<script\b([^>]*)>/g)].map(m => (m[1].match(/\bsrc="([^"]+)"/) || [])[1] || '(inline)');

test('UTF-8 is declared at the top, and no mojibake or replacement characters survive', () => {
  const idx = html.search(/<meta\s+charset=["']?utf-8["']?/i);
  assert.ok(idx >= 0 && idx < 200);
  for (const f of ['www/safina-ai.js', 'www/safina-ai-ui.js', 'www/safina-brain.js', 'www/safina-brain-ui.js', 'www/safina-models.js', pageFile].filter(exists)) {
    const t = read(f);
    assert.equal(t.includes('�'), false, f + ' contains U+FFFD');
    assert.equal(/â€|ðŸ|Ø[ -¿]|Ù[\u0080-¿]/.test(t), false, f + ' has double-encoded text');
  }
});

test('CSS braces are balanced', () => {
  assert.equal((style.match(/\{/g) || []).length, (style.match(/\}/g) || []).length);
});

test('scripts load in the right order: engine, models, brain, boot, then the page, then the UI and library', () => {
  const at = n => order.indexOf(n);
  const chain = ['safina-ai.js', 'safina-models.js', 'safina-brain.js', 'safina-boot.js', '(inline)', 'safina-ai-ui.js', 'safina-brain-ui.js'];
  chain.forEach(n => assert.ok(at(n) >= 0, n + ' is not loaded by the page'));
  for (let i = 1; i < chain.length; i++) assert.ok(at(chain[i - 1]) < at(chain[i]), chain[i - 1] + ' must load before ' + chain[i]);
  assert.ok(at('safina-match.js') < at('(inline)') && at('safina-tree.js') < at('(inline)'));
  assert.ok(at('safina-library.js') > at('(inline)'), 'the library uses the page globals');
});

test('every script compiles', () => {
  assert.ok(inline.length >= 1);
  inline.forEach((code, i) => assert.doesNotThrow(() => new vm.Script(code), 'inline script #' + i));
  for (const f of ['www/safina-ai.js', 'www/safina-ai-ui.js', 'www/safina-brain.js', 'www/safina-brain-ui.js', 'www/safina-models.js', 'www/safina-boot.js'].filter(exists))
    assert.doesNotThrow(() => new vm.Script(read(f), { filename: f }), f);
  for (const f of ['src/lingua-translate-core.mjs', 'src/lingua-onnx-entry.js', 'scripts/build-web.mjs', 'scripts/patch-llm.mjs']) assert.ok(read(f).length > 100, f);
});

test('translation and the tutor go through the shared engine, not a bundled-model-only path', () => {
  const body = (html.match(/async function translateCached\(text,sentence\)\{([\s\S]*?)\n\}/) || [])[1];
  assert.ok(body, 'translateCached not found');
  assert.match(body, /SAI\.lookupWord/); assert.match(body, /SAI\.translateLine/);
  assert.match(html, /SAI\.chat\(/);
});

test('the learner brain is wired in: signals, verdict chip, AI flashcards, review order', () => {
  for (const needle of ['BRAIN.lineShown', 'BRAIN.wordTapped', 'BRAIN.saved', 'BRAIN.reviewed', 'BRAIN.rank', 'BRAIN.profileText', 'SAFINA_ADDCARDS', 'SAFINA_CHIP'])
    assert.ok(html.includes(needle), needle + ' is missing from the page');
});

test('no invented content is left in the Socials code', () => {
  for (const gone of ['API0', 'const LEX', 'Not in the demo lexicon', 'هذا نص تجريبي', 'sample content'])
    assert.equal(html.includes(gone), false, gone + ' is still in the page');
});

test('globals that safina-library.js depends on exist in the page', { skip: !exists('www/safina-library.js') }, () => {
  for (const g of ['parseSrt', 'decodeBuf', 'toast', 'nav', 'playLoded', 'LIBD', 'lib'].map(x => x === 'playLoded' ? 'playLoaded' : x))
    assert.match(html, new RegExp('(function\\s+' + g + '\\b|(const|let|var)\\s+' + g + '\\b)'), g + ' is missing');
});

import { existsSync as __ex, readFileSync as __rf } from 'node:fs';
test('the build signs with the committed key, so updates install over the old app', () => {
  assert.ok(__ex(new URL('../signing/debug.keystore', import.meta.url)));
  assert.match(__rf(new URL('../.github/workflows/android.yml', import.meta.url), 'utf8'), /signing\/debug\.keystore/);
});

test('the page prepares subtitles before playing and keeps the layout still', () => {
  const page = read('www/both_25.html');
  assert.ok(exists('www/safina-prep-ui.js'));
  assert.match(page, /safina-prep-ui\.js/);
  assert.match(page, /SAFINA_PREP\.offer\(\)/);
  assert.match(page, /if\(window\.SAFINA_PREP_BUSY\)return/);                 // no on-demand translating while preparing
  assert.match(page, /#watch #onnxStatus\{height:16px/);                       // the status line no longer pushes the video around
  assert.match(page, /tick\.__l/);                                              // time bar updates are throttled
});

test('the page loads the film manager before the preparing screen, and the Cards tab is wired to the AI practice', () => {
  const page = read('www/both_25.html');
  assert.ok(exists('www/safina-film.js'));
  assert.ok(page.indexOf('safina-film.js') > 0 && page.indexOf('safina-film.js') < page.indexOf('safina-prep-ui.js'));
  assert.match(page, /SAFINA_PREP_BUSY=true/);
  assert.match(read('www/safina-learn-ui.js'), /#cards \[data-p="rev"\]/);
});

test('the crash trace loads first and the heavy engines run inside it', () => {
  const page = read('www/both_25.html');
  assert.ok(page.indexOf('safina-trace.js') > 0 && page.indexOf('safina-trace.js') < page.indexOf('safina-ai.js'));
  const boot = read('www/safina-boot.js');
  assert.match(boot, /T\.begin\('llm'/); assert.match(boot, /T\.begin\('mt'/); assert.match(boot, /releaseMarian/);
  assert.match(read('www/safina-film.js'), /T\.begin\('film'/);
});
