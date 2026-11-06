// Real-browser end-to-end check of the shipped www/ folder (optional dev check; needs Playwright + Chromium).
//   node tests/e2e/ui.e2e.mjs
// It serves a temp copy of www/ with tests/fixtures/lingua-onnx.STUB.js standing in for the ONNX bundle, so it proves
// the UI calls the engine, shows its output, and shows its errors. It does NOT prove the real model works (use
// `npm run verify:onnx` for that).
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/npm-tools/node_modules/playwright']) { try { ({ chromium } = require(p)); break; } catch (_) {} }
if (!chromium) { console.error('Playwright is not installed (npm i -D playwright). Skipping the browser e2e.'); process.exit(2); }
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const OUT = process.env.E2E_SHOTS || mkdtempSync(join(tmpdir(), 'safina-shots-'));

/* ---------------------------------------------------------------- fixtures */
const AR = ['أريد أن أذهب إلى المدرسة', 'هذه فرصة جيدة', 'أين تسكن الآن', 'الكتاب على الطاولة', 'نحن نحب القهوة العربية', 'سأرى صديقي غدا'];
const srt = lines => lines.map((t, i) => `${i + 1}\n00:00:${String(i * 3).padStart(2, '0')},000 --> 00:00:${String(i * 3 + 2).padStart(2, '0')},500\n${t}\n`).join('\n');
const EN = ['I want to go to school', 'This is a good opportunity', 'Where do you live now', 'The book is on the table', 'We love Arabic coffee', 'I will see my friend tomorrow'];
const fx = mkdtempSync(join(tmpdir(), 'safina-fx-')), fxm = mkdtempSync(join(tmpdir(), 'safina-fxm-'));
const put = (dir, name, data) => { writeFileSync(join(dir, name), data); return join(dir, name); };
const A = 'Avatar.The.Last.Airbender';
const tv = [
  put(fx, `${A}.S01E01.1080p.WEB-DL.mkv`, Buffer.alloc(4000, 1)), put(fx, `${A}.S01E02.1080p.WEB-DL.mkv`, Buffer.alloc(4100, 2)),
  put(fx, 'Avatar The Last Airbender 1x03.mkv', Buffer.alloc(4200, 3)), put(fx, `${A}.S02E01.mkv`, Buffer.alloc(4300, 4)),
  put(fx, `${A}.S01E01.ar.srt`, srt(AR)), put(fx, `${A}.S01E02.ar.srt`, srt(AR)), put(fx, `${A}.S01E02.v2.ar.srt`, srt(AR.map(s => s + ' ؟'))),
  put(fx, `${A}.S01E02.en.srt`, srt(EN)), put(fx, 'Avatar Season 1 Episode 3.ar.srt', srt(AR)),
  put(fx, `${A}.S02E01.srt`, srt(AR)),                       // no language tag: must be detected from content
  put(fx, 'Avatar.E09.ar.srt', srt(AR)),                     // season unknown, no video
  put(fx, 'broken.srt', 'this is not a subtitle file'), put(fx, 'empty.srt', ''), put(fx, 'notes.docx', 'x'), put(fx, 'cover.jpg', Buffer.alloc(500, 9))
];
const film = [put(fxm, 'Great.Film.2019.1080p.mkv', Buffer.alloc(3000, 5)), put(fxm, 'Great.Film.2019.1080p.ar.srt', srt(AR)), put(fxm, 'Great.Film.2019.1080p.en.srt', srt(EN))];

/* ---------------------------------------------------------------- servers */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/json' };
function serve(dir) {
  return new Promise(res => {
    const s = createServer((req, rsp) => {
      const p = join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
      if (!p.startsWith(dir) || !existsSync(p)) { rsp.writeHead(404); return rsp.end('nope'); }
      rsp.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); rsp.end(readFileSync(p));
    }).listen(0, '127.0.0.1', () => res({ s, url: 'http://127.0.0.1:' + s.address().port + '/' }));
  });
}
const withStub = mkdtempSync(join(tmpdir(), 'safina-www-')), noEngine = mkdtempSync(join(tmpdir(), 'safina-www0-'));
cpSync(join(here, 'www'), withStub, { recursive: true }); cpSync(join(here, 'www'), noEngine, { recursive: true });
rmSync(join(withStub, 'lingua-onnx.js'), { force: true }); rmSync(join(noEngine, 'lingua-onnx.js'), { force: true });
cpSync(join(here, 'tests/fixtures/lingua-onnx.STUB.js'), join(withStub, 'lingua-onnx.js'));

/* ---------------------------------------------------------------- harness */
let n = 0;
const step = (name, ok = true) => console.log((ok ? '  PASS ' : '  FAIL ') + String(++n).padStart(2, '0') + ' ' + name);
const T = async (name, fn) => { try { await fn(); step(name); } catch (e) { step(name, false); console.error('       ' + (e.message || e).split('\n').slice(0, 4).join('\n       ')); T.failed = (T.failed || 0) + 1; } };
const luminance = ([r, g, b]) => { const f = c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
async function open(url) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const bad = [], reqs = [];
  page.on('pageerror', e => bad.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource|manifest|lingua-native|icon-192|boom at stage decode/.test(m.text() + (m.location().url || ''))) bad.push('console: ' + m.text()); });
  page.on('request', r => reqs.push(r.url()));
  page.on('dialog', d => d.accept());
  await page.goto(url); await page.waitForTimeout(400);
  return { ctx, page, bad, reqs };
}
const row = (page, key) => page.$eval(`#safina-tree .te:has([data-pick="${key}"])`, e => e.dataset.status).catch(() => null);
const shot = (page, name) => page.screenshot({ path: join(OUT, name) });
const seekTo = async (page, t) => { await page.evaluate(t => { v.currentTime = t; }, t); await page.waitForTimeout(450); };

/* ================================================================ run 1: engine present (stub) */
const A1 = await serve(withStub);
let { ctx, page, bad, reqs } = await open(A1.url);
console.log('\nImport, tree, library, playback, translation (stubbed engine)');

await T('header shows "Safina", is large and has strong contrast against the background', async () => {
  assert.equal((await page.textContent('header')).trim(), 'Safina');
  const m = await page.$eval('.brand-name', e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return { w: r.width, h: r.height, size: parseFloat(c.fontSize), color: c.color, bg: getComputedStyle(document.body).backgroundColor }; });
  assert.ok(m.w > 60 && m.h > 20, 'header must have a real box: ' + JSON.stringify(m));
  assert.ok(m.size >= 28, 'font size ' + m.size);
  assert.ok(contrast(rgb(m.color), rgb(m.bg)) >= 7, 'contrast ' + contrast(rgb(m.color), rgb(m.bg)).toFixed(1));
  await shot(page, '01-library.png');
});
await T('the Introvert @font-face rule is registered (it was silently dropped before)', async () => {
  const fam = await page.evaluate(() => [...document.fonts].map(f => f.family.replace(/"/g, '')));
  assert.ok(fam.includes('Introvert'), 'registered families: ' + fam.join(', '));
});
await T('"+" opens the importer; it offers a file picker, not a preview-only form', async () => {
  await page.click('#safina-add');
  assert.ok(await page.$eval('#safina-add-sheet', e => e.classList.contains('open')));
  assert.ok(await page.$('#safina-import-files')); assert.ok(await page.$('#safina-pick-btn'));
});

await page.setInputFiles('#safina-import-files', tv);
await page.waitForSelector('#safina-tree .ttree'); await page.waitForTimeout(400);
await shot(page, '02-tree.png');

await T('the review screen is a Series > Season > Episode tree, built from the picked files', async () => {
  const seasons = await page.$$eval('#safina-tree .ts > .tr .tl', e => e.map(x => x.textContent));
  for (const s of ['Season 01', 'Season 02', 'Season unknown']) assert.ok(seasons.includes(s), s + ' in ' + seasons);
  assert.equal(await row(page, '1:1'), 'matched');
  assert.equal(await row(page, '1:3'), 'matched', '"1x03" video must pair with the "Season 1 Episode 3" subtitle');
  assert.equal(await row(page, '2:1'), 'matched', 'untagged subtitle is paired after its language is detected from content');
  assert.equal(await row(page, '1:2'), 'ambiguous', 'two Arabic subtitles for S01E02 must not be auto-picked');
  assert.equal(await page.$('text=Manual episode corrections'), null, 'the old manual-correction form must be gone');
});
await T('files that cannot be imported are listed with the reason (empty, unparsable, unsupported)', async () => {
  const t = await page.textContent('#safina-tree');
  assert.match(t, /empty\.srt/); assert.match(t, /0 bytes/);
  assert.match(t, /broken\.srt/); assert.match(t, /No subtitle cues/);
  assert.match(t, /notes\.docx/); assert.match(t, /Unsupported/);
});
await T('nodes collapse and expand', async () => {
  const sel = '#safina-tree [data-toggle="se:1"]';
  assert.equal(await page.getAttribute(sel, 'aria-expanded'), 'true');
  const before = await page.$$eval('#safina-tree .te', e => e.length);
  await page.click(sel);
  assert.equal(await page.getAttribute(sel, 'aria-expanded'), 'false');
  assert.ok(await page.$$eval('#safina-tree .te', e => e.length) < before);
  await page.click(sel);
  assert.equal(await page.$$eval('#safina-tree .te', e => e.length), before);
});
await T('the user resolves the ambiguity explicitly; only then does the episode become importable', async () => {
  assert.equal(await page.$eval('[data-pick="1:2"]', e => e.disabled), true);
  const opts = await page.$$eval('select[data-choice="1:2|sub|ar"] option', o => o.map(x => x.value).filter(Boolean));
  assert.equal(opts.length, 2);
  await page.selectOption('select[data-choice="1:2|sub|ar"]', opts[0]);
  await page.waitForTimeout(200);
  assert.equal(await row(page, '1:2'), 'matched');
  assert.match(await page.textContent('#safina-import-go'), /Import 4 selected/);
});
await T('importing stores the real bytes (IndexedDB round-trip) and the library shows the show', async () => {
  await page.click('#safina-import-go');
  await page.waitForSelector('#safina-add-sheet:not(.open)', { state: 'attached', timeout: 15000 });
  await page.waitForTimeout(600);
  const tiles = await page.$$eval('.pc .pt', e => e.map(x => x.textContent));
  assert.ok(tiles.includes('Avatar The Last Airbender'), 'tiles: ' + tiles);
  const db = await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('safina'); r.onerror = () => rej(r.error);
    r.onsuccess = () => { const d = r.result, g = (s) => new Promise(ok => { const q = d.transaction(s).objectStore(s).getAll(); q.onsuccess = () => ok(q.result); });
      Promise.all([g('items'), g('files')]).then(([items, files]) => res({ items: items.length, files: files.map(f => [f.name, f.blob.size, f.role, f.lang]) })); };
  }));
  assert.equal(db.items, 1);
  const bySize = Object.fromEntries(db.files.map(f => [f[0], f[1]]));
  assert.equal(bySize[`${A}.S01E01.1080p.WEB-DL.mkv`], 4000); assert.equal(bySize['Avatar The Last Airbender 1x03.mkv'], 4200);
  assert.equal(db.files.filter(f => f[2] === 'video').length, 4);
  // S01E01 ar, S01E02 ar (the one the user chose) + en, S01E03 ar, S02E01 ar (untagged, detected from content) = 5.
  // The unchosen S01E02.v2.ar.srt, broken.srt, empty.srt and notes.docx must NOT be stored.
  const subs = db.files.filter(f => f[2] === 'subtitle');
  assert.equal(subs.length, 5, JSON.stringify(subs));
  assert.equal(subs.filter(f => f[3] === 'ar').length, 4); assert.equal(subs.filter(f => f[3] === 'en').length, 1);
  assert.ok(!db.files.some(f => /v2\.ar|broken|empty|notes/.test(f[0])), 'rejected files must not be stored');
  assert.equal(db.files.filter(f => f[2] === 'image').length, 1, 'cover.jpg is attached as the cover');
  assert.ok(db.files.some(f => f[0] === `${A}.S02E01.srt` && f[3] === 'ar'), 'untagged subtitle stored as Arabic');
  await shot(page, '03-library-after.png');
});
await T('the show survives a full reload', async () => {
  await page.reload(); await page.waitForTimeout(800);
  assert.ok((await page.$$eval('.pc .pt', e => e.map(x => x.textContent))).includes('Avatar The Last Airbender'));
});
await T('the show page lists the imported episodes as a read-only tree with Play buttons', async () => {
  await page.click('.pc:has-text("Avatar")'); await page.waitForSelector('#safina-show-tree .ttree');
  assert.equal(await page.$$eval('#safina-show-tree .te', e => e.length), 4);
  assert.equal(await page.$('#safina-show-tree input[type=checkbox]'), null);
  assert.equal(await page.$$eval('#safina-show-tree [data-play]', e => e.length), 4);
  await shot(page, '04-show.png');
});
await T('Play opens the player with the stored video and parsed subtitles', async () => {
  await page.click('#safina-show-tree [data-play="1:1"]'); await page.waitForTimeout(800);
  assert.ok(await page.$eval('#watch', e => e.classList.contains('show')));
  assert.match(await page.$eval('#v', v => v.src), /^blob:/);
  assert.equal(await page.evaluate(() => AR.length), 6);
  assert.match(await page.textContent('#st'), /Arabic 6 lines/);
});

console.log('\nTranslation goes through the ONNX engine only');
await T('a line with no English subtitle is translated by the engine and shown', async () => {
  await seekTo(page, 0.5);
  assert.match(await page.textContent('#en'), /^stub translation of \[أريد أن أذهب إلى المدرسة\]$/);
});
await T('consecutive lines each get their own translation', async () => {
  const got = [];
  for (const t of [3.5, 6.5, 9.5]) { await seekTo(page, t); got.push(await page.textContent('#en')); }
  assert.equal(new Set(got).size, 3, got.join(' | ')); got.forEach(g => assert.match(g, /^stub translation of \[/));
});
await T('an engine failure is shown with its stage message; no dictionary text or fake translation appears', async () => {
  await page.evaluate(() => { window.__failOnnx = true; subtitleTranslationCache.clear(); });
  await seekTo(page, 12.5);
  const t = await page.textContent('#en');
  assert.match(t, /^STUB-DESCRIBED: boom at stage decode/); assert.doesNotMatch(t, /stub translation/);
  assert.ok(await page.$eval('#en', e => e.classList.contains('errorNote')));
  await shot(page, '05-failure.png');
});
await T('tapping a word while the engine fails shows the failure, not a dictionary definition', async () => {
  await page.evaluate(() => openPanel()); await page.waitForTimeout(300);
  await page.click('#pAr .w >> nth=0'); await page.waitForTimeout(600);
  const m = await page.textContent('#mean');
  assert.match(m, /STUB-DESCRIBED/); assert.ok(await page.$('#mean .errorNote'));
});
await T('after leaving the player and coming back, translation works again (no stuck/cached failure)', async () => {
  await page.evaluate(() => { window.__failOnnx = false; nav('library'); });
  await page.waitForTimeout(300);
  await page.click('.pc:has-text("Avatar")'); await page.waitForSelector('#safina-show-tree .ttree');
  await page.click('#safina-show-tree [data-play="1:1"]'); await page.waitForTimeout(800);
  await seekTo(page, 12.5);
  assert.match(await page.textContent('#en'), /^stub translation of \[/);
});
await T('tapping a word shows the engine translation of that word', async () => {
  await page.evaluate(() => openPanel()); await page.waitForTimeout(300);
  await page.click('#pAr .w >> nth=0'); await page.waitForTimeout(600);
  assert.match(await page.textContent('#mean'), /stub translation of \[/);
});
await T('empty input is a no-op, not an error and not a fake result', async () => {
  assert.equal(await page.evaluate(() => translateArabic('   ')), '');
});
await T('no dictionary, cloud or machine-translation host was contacted during the whole session', async () => {
  const hit = reqs.filter(u => /wiktionary|freedictionary|generativelanguage|mymemory|openai|anthropic|translate\.google/i.test(u));
  assert.deepEqual(hit, []);
});

console.log('\nMovie flow');
await T('the "Import Your Own Film" tile opens the importer in movie mode; subtitles attach by title', async () => {
  await page.evaluate(() => nav('library')); await page.waitForTimeout(200);
  await page.click('.pc:has-text("Import Your Own Film")');
  assert.equal(await page.$eval('#safina-import-type', e => e.value), 'movie');
  await page.setInputFiles('#safina-import-files', film);
  await page.waitForSelector('#safina-tree .te');
  const st = await page.$$eval('#safina-tree .te', els => els.map(e => e.dataset.status));
  assert.deepEqual(st, ['matched']);
  assert.equal((await page.$$eval('#safina-tree .te .ttag', e => e.map(x => x.textContent))).sort().join(), 'AR,EN');
  await shot(page, '06-movie-tree.png');
});
await T('the film imports, appears in the library and plays with both subtitle tracks', async () => {
  await page.fill('#safina-import-title', 'Great Film');
  await page.click('#safina-import-go');
  await page.waitForSelector('#safina-add-sheet:not(.open)', { state: 'attached', timeout: 15000 }); await page.waitForTimeout(500);
  await page.click('.pc:has-text("Great Film")'); await page.waitForTimeout(800);
  assert.match(await page.textContent('#st'), /Arabic 6 lines.*English 6 lines/);
  await seekTo(page, 0.5);
  assert.equal(await page.textContent('#en'), EN[0], 'a real English subtitle must win over the engine');
});
await T('picking nothing, or only unusable files, gives a clear message and imports nothing', async () => {
  await page.evaluate(() => nav('library')); await page.click('#safina-add');
  await page.setInputFiles('#safina-import-files', [put(fx, 'zero.srt', ''), put(fx, 'junk.txt', 'hello')]);
  await page.waitForTimeout(400);
  assert.equal(await page.$eval('#safina-import-go', b => b.disabled), true);
  assert.match(await page.textContent('#safina-tree'), /0 bytes/);
});
await T('no uncaught page errors during the whole session', async () => { assert.deepEqual(bad, [], JSON.stringify(bad, null, 1)); });
await ctx.close();

/* ================================================================ run 2: engine bundle missing */
console.log('\nEngine bundle missing (what a user sees if "npm run build:web" was not run)');
const A2 = await serve(noEngine);
({ ctx, page, bad, reqs } = await open(A2.url));
await T('the UI reports that the ONNX engine could not be loaded, and still does not fall back to anything', async () => {
  await page.evaluate(() => {
    AR = [{ s: 0, e: 2, t: 'مرحبا بكم' }]; EN = []; v.removeAttribute('src'); nav('watch'); show(0);
  });
  await page.waitForFunction(() => /could not be loaded/.test(document.getElementById('en').textContent), null, { timeout: 5000 });
  const t = await page.textContent('#en');
  assert.match(t, /ONNX translation engine/); assert.match(t, /build:web/);
  assert.doesNotMatch(t, /stub|dictionary|definition/i);
});
await ctx.close(); await browser.close(); A1.s.close(); A2.s.close();

console.log('\nscreenshots: ' + OUT);
if (T.failed) { console.error('\n' + T.failed + ' e2e check(s) FAILED'); process.exit(1); }
console.log('\nAll ' + n + ' e2e checks passed.');
