import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = read('www/index.html');
const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

/* ------------------------------------------------------------------ encoding (bug 5) */
test('UTF-8 is declared at the very top of the document', () => {
  const idx = html.search(/<meta\s+charset=["']?utf-8["']?/i);
  assert.ok(idx >= 0 && idx < 200, 'meta charset must be one of the first things in <head>');
});

test('no double-encoded text (mojibake) and no replacement characters survive', () => {
  for (const f of ['www/index.html', 'www/safina-library.js', 'www/safina-tree.js', 'www/safina-match.js']) {
    const t = read(f);
    assert.equal(t.includes('�'), false, f + ' contains U+FFFD');
    const m = t.match(/[ÃÂ][\u0080-¿]|â€|ðŸ|Ø[ -¿]|Ù[\u0080-¿]|â[\u0086\u0080-\u0090†…–]/);
    assert.equal(m, null, f + ' still contains mojibake near: ' + (m && t.slice(Math.max(0, m.index - 20), m.index + 30)));
  }
});

test('real Arabic text and real emoji are intact', () => {
  assert.ok((html.match(/[؀-ۿ]/g) || []).length > 400, 'Arabic content must be preserved');
  assert.ok(html.includes('أريد'), 'sample sentence 1');
  assert.ok(html.includes('✕') && html.includes('🎬') && html.includes('📺'), 'emoji and the close symbol must render correctly');
});

/* ------------------------------------------------------------------ CSS / branding (bug 6) */
test('CSS has balanced braces and no stray literal "\\n" tokens', () => {
  const open = (style.match(/\{/g) || []).length, close = (style.match(/\}/g) || []).length;
  assert.equal(open, close, 'unbalanced braces in <style>');
  assert.doesNotMatch(style, /^\s*\\n\s*$/m, 'a literal \\n line breaks the next CSS rule (it silently killed @font-face)');
});

test('@font-face for Introvert is a valid top-level rule and the header uses it with safe fallbacks', () => {
  assert.match(style, /(^|\})\s*@font-face\s*\{[^}]*font-family:\s*"Introvert"[^}]*Introvert-Regular\.ttf/m);
  const brand = style.match(/\.brand-name\s*\{([^}]*)\}/);
  assert.ok(brand, '.brand-name rule missing');
  assert.match(brand[1], /"Introvert"\s*,\s*"Plus Jakarta Sans"/);
  assert.match(brand[1], /sans-serif/);
  assert.match(html, /<header>\s*<span class="brand-name">Safina<\/span>\s*<\/header>/);
  assert.match(html, /<title>Safina<\/title>/);
});

test('invalid keyframes rule is gone', () => {
  assert.doesNotMatch(style, /@keyframes\s+pulse\s*\{\s*#watch/);
});

/* ------------------------------------------------------------------ translation is ONNX-only (bug 1) */
test('no cloud provider, dictionary or machine-translation service is referenced anywhere in the app', () => {
  const all = html + read('www/safina-library.js');
  const banned = /gemini|generativelanguage|openai|anthropic\.com|x-api-key|mymemory|wiktionary|freedictionary|translate\.google|aiSettings|aiLookup|resolveWord/i;
  const m = all.match(banned);
  assert.equal(m, null, 'forbidden reference: ' + (m && m[0]));
});

test('translateArabic loads the real engine, has no try/catch that could swallow an error into a fake result', () => {
  const body = (html.match(/async function translateArabic\(text\)\{([\s\S]*?)\n\}/) || [])[1];
  assert.ok(body, 'translateArabic not found');
  assert.match(body, /getOnnx\(\)/);
  assert.match(body, /m\.translateArabic\(q\)/);
  assert.doesNotMatch(body, /catch|return\s+['"`][^'"`]+['"`]|MyMemory|dictionary/i);
  assert.match(html, /import\('\.\/lingua-onnx\.js'\)/);
});

test('failures are surfaced to the user through describeError, not hidden', () => {
  assert.match(html, /errText\(e\)/);
  assert.match(html, /__onnxDescribe/);
  assert.match(html, /id="onnxStatus"/);
});

test('the test stub is not part of the shipped www folder', async () => {
  const { existsSync } = await import('node:fs');
  // lingua-onnx.js is a build output (npm run build:web); a stub must never be committed there
  const p = new URL('../www/lingua-onnx.js', import.meta.url);
  if (existsSync(p)) assert.doesNotMatch(readFileSync(p, 'utf8').slice(0, 400), /STUB/);
});

/* ------------------------------------------------------------------ structure / syntax */
test('scripts load in the right order and every inline script compiles', () => {
  const order = [...html.matchAll(/<script\b([^>]*)>/g)].map(m => (m[1].match(/\bsrc="([^"]+)"/) || [])[1] || '(inline)');
  const at = n => order.indexOf(n);
  assert.ok(at('safina-match.js') >= 0 && at('safina-tree.js') >= 0 && at('safina-library.js') >= 0);
  assert.ok(at('safina-match.js') < at('(inline)') && at('safina-tree.js') < at('(inline)'), 'match/tree must load before the app script');
  assert.ok(at('safina-library.js') > at('(inline)'), 'library must load after the app script (it uses its globals)');
  assert.ok(inline.length >= 1);
  inline.forEach((code, i) => assert.doesNotThrow(() => new vm.Script(code), 'inline script #' + i));
  for (const f of ['www/safina-library.js', 'www/safina-tree.js', 'www/safina-match.js'])
    assert.doesNotThrow(() => new vm.Script(read(f), { filename: f }), f);
  for (const f of ['src/lingua-translate-core.mjs', 'src/lingua-onnx-entry.js', 'scripts/build-web.mjs', 'scripts/verify-onnx.mjs'])
    assert.ok(read(f).length > 100, f);
});

test('globals that safina-library.js depends on really exist in index.html', () => {
  for (const g of ['parseSrt', 'decodeBuf', 'toast', 'nav', 'playLoaded', 'LIBD', 'lib']) {
    assert.match(html, new RegExp('(function\\s+' + g + '\\b|(const|let|var)\\s+' + g + '\\b)'), g + ' is missing');
  }
});

test('every element id the library script reads exists in the page', () => {
  const lib = read('www/safina-library.js');
  const ids = new Set([...lib.matchAll(/el\('([\w-]+)'\)/g)].map(m => m[1]));
  for (const id of ids) {
    if (['safina-tree', 'safina-season-fix', 'safina-show-tree'].includes(id) && !html.includes('id="' + id + '"')) continue; // created dynamically
    assert.ok(html.includes('id="' + id + '"') || lib.includes("id=\"" + id + "\""), 'missing #' + id);
  }
});
