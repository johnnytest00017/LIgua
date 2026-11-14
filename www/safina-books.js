/* Books and comics: import, read, tap a word to see its meaning in the sentence, save the sentence as a flashcard.
 * Books: EPUB or TXT. Comics: images or CBZ. Comic text is read from the picture (OCR) when you tap a speech bubble. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => { try { window.toast(m); } catch (_) { /* no toast */ } };
  const SAI = () => window.SAI, learn = () => { try { return SAI().lang().learn; } catch (_) { return 'ar'; } };
  const RTL = /[֐-ࣿ]/;

  /* ---------- storage ---------- */
  const db = () => new Promise((ok, no) => { const r = indexedDB.open('safina.books', 1); r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' }); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const tx = async (mode, f) => { const d = await db(); return new Promise((ok, no) => { const t = d.transaction('items', mode), q = f(t.objectStore('items')); t.oncomplete = () => ok(q && q.result); t.onerror = () => no(t.error); }); };
  const put = it => tx('readwrite', s => s.put(it)), all = () => tx('readonly', s => s.getAll()), get = id => tx('readonly', s => s.get(id)), del = id => tx('readwrite', s => s.delete(id));

  /* ---------- zip (EPUB / CBZ) ---------- */
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf); let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Not a zip file');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {}, dec = new TextDecoder();
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
      out[name] = async () => {
        const s = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), data = u8.slice(s, s + cs);
        if (method === 0) return data.buffer;
        return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      };
    }
    return out;
  }
  const text = async f => new TextDecoder('utf-8').decode(await f());

  /* ---------- parsing ---------- */
  function paginate(paras) {
    const pages = []; let cur = [], len = 0;
    const push = () => { if (cur.length) pages.push(cur); cur = []; len = 0; };
    paras.forEach(p => {
      const parts = p.length > 900 ? p.split(/(?<=[.!?؟。…])\s+/).reduce((a, s) => { const l = a[a.length - 1]; if (l && (l + ' ' + s).length < 700) a[a.length - 1] = l + ' ' + s; else a.push(s); return a; }, []) : [p];
      parts.forEach(q => { if (len + q.length > 1100) push(); cur.push(q); len += q.length; });
    });
    push(); return pages;
  }
  async function parseEpub(buf, fallbackTitle) {
    const z = await unzip(buf), dp = new DOMParser();
    if (!z['META-INF/container.xml']) throw new Error('This EPUB has no container');
    const cx = dp.parseFromString(await text(z['META-INF/container.xml']), 'application/xml'), opfPath = cx.querySelector('rootfile').getAttribute('full-path');
    const opf = dp.parseFromString(await text(z[opfPath]), 'application/xml'), dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const man = {}; opf.querySelectorAll('manifest > item').forEach(i => { man[i.getAttribute('id')] = i.getAttribute('href'); });
    const title = (opf.querySelector('metadata > *|title, title') || {}).textContent || fallbackTitle, paras = [];
    for (const ref of opf.querySelectorAll('spine > itemref')) {
      const href = man[ref.getAttribute('idref')]; if (!href) continue;
      const key = decodeURIComponent(new URL(href, 'http://x/' + dir).pathname.slice(1)); if (!z[key]) continue;
      const doc = dp.parseFromString(await text(z[key]), 'text/html'); const blocks = doc.body ? doc.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote') : [];
      let got = 0; blocks.forEach(b => { if (b.querySelector('p,li,blockquote')) return; const t = b.textContent.replace(/\s+/g, ' ').trim(); if (t) { paras.push(t); got++; } });
      if (!got && doc.body) { const t = doc.body.textContent.replace(/\s+/g, ' ').trim(); if (t) paras.push(t); }
    }
    if (!paras.length) throw new Error('No readable text found in this EPUB');
    return { title: String(title).trim(), pages: paginate(paras) };
  }
  async function parseTxt(file) {
    const t = new TextDecoder('utf-8').decode(await file.arrayBuffer()), paras = t.split(/\n\s*\n|\r\n\s*\r\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!paras.length) throw new Error('This file is empty');
    return { title: file.name.replace(/\.[^.]+$/, ''), pages: paginate(paras) };
  }
  /* PDF (bundled pdf.js, works offline), DOCX, HTML, Markdown */
  let pdfjs = null;
  async function pdfLib() {
    if (pdfjs) return pdfjs;
    pdfjs = await import('./vendor/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', document.baseURI).href; return pdfjs;
  }
  async function openPdf(file) { const lib = await pdfLib(); return lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; }
  async function parsePdfBook(file) {
    const doc = await openPdf(file), paras = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent(); let t = '';
      tc.items.forEach(x => { t += x.str + (x.hasEOL ? '\n' : ' '); });
      t.split(/\n{2,}|\n(?=[A-Z\u0600-\u06FF][^\n]{0,40}\n)/).forEach(b => { b = b.replace(/\s+/g, ' ').trim(); if (b) paras.push(b); });
      if (i % 10 === 0) toast('Reading page ' + i + ' of ' + doc.numPages + '…');
    }
    if (paras.join('').length < 40) throw new Error('This PDF has no text (it is scanned pictures). Import it as a comic instead.');
    return { title: file.name.replace(/\.[^.]+$/, ''), pages: paginate(paras) };
  }
  async function parsePdfComic(file) {
    const doc = await openPdf(file), imgs = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i), v1 = pg.getViewport({ scale: 1 }), sc = Math.min(2, 1400 / v1.width), v = pg.getViewport({ scale: sc }), c = document.createElement('canvas');
      c.width = Math.round(v.width); c.height = Math.round(v.height); await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
      imgs.push(await new Promise(ok => c.toBlob(ok, 'image/jpeg', .82))); c.width = c.height = 0;
      if (i % 5 === 0 || i === doc.numPages) toast('Page ' + i + ' of ' + doc.numPages + '…');
    }
    return { title: file.name.replace(/\.[^.]+$/, ''), imgs };
  }
  async function parseDocx(file) {
    const z = await unzip(await file.arrayBuffer()); if (!z['word/document.xml']) throw new Error('Not a Word document');
    const x = new DOMParser().parseFromString(await text(z['word/document.xml']), 'application/xml'), paras = [];
    x.querySelectorAll('p').forEach(p => { const t = [...p.querySelectorAll('t')].map(n => n.textContent).join('').trim(); if (t) paras.push(t); });
    if (!paras.length) throw new Error('This document is empty'); return { title: file.name.replace(/\.[^.]+$/, ''), pages: paginate(paras) };
  }
  async function parseMarkup(file) {
    const raw = new TextDecoder('utf-8').decode(await file.arrayBuffer()); let paras;
    if (/\.html?$/i.test(file.name)) { const d = new DOMParser().parseFromString(raw, 'text/html'); paras = [...d.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote')].filter(b => !b.querySelector('p,li')).map(b => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean); if (!paras.length) paras = [d.body.textContent.replace(/\s+/g, ' ').trim()]; }
    else paras = raw.replace(/[#>*_`]+/g, '').split(/\n\s*\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!paras.length || !paras.join('')) throw new Error('This file is empty'); return { title: file.name.replace(/\.[^.]+$/, ''), pages: paginate(paras) };
  }
  const IMG = /\.(png|jpe?g|webp|gif)$/i, MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  async function parseComic(files) {
    let imgs = [], title = '';
    const pdf = files.find(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'); if (pdf) return parsePdfComic(pdf);
    const zips = files.filter(f => /\.(cbz|zip)$/i.test(f.name));
    if (zips.length) {
      const z = await unzip(await zips[0].arrayBuffer()); title = zips[0].name.replace(/\.[^.]+$/, '');
      for (const k of Object.keys(z).filter(k => IMG.test(k) && !/__MACOSX/.test(k)).sort(nat)) imgs.push(new Blob([await z[k]()], { type: MIME[k.split('.').pop().toLowerCase()] }));
    } else {
      files.filter(f => IMG.test(f.name) || /^image\//.test(f.type)).sort((a, b) => nat(a.name, b.name)).forEach(f => imgs.push(f)); title = files[0] ? files[0].name.replace(/\.[^.]+$/, '') : '';
    }
    if (!imgs.length) throw new Error('No pictures found');
    return { title: title || 'Comic', imgs };
  }

  /* ---------- library hookup ---------- */
  const urls = {};
  const clean = t => (window.SafinaTitle ? window.SafinaTitle.clean(t) : String(t == null ? '' : t).slice(0, 60) || 'Untitled');
  function toItem(r) {
    const it = { id: r.id, title: clean(r.title), lvl: r.type === 'book' ? 'Book' : 'Comic', ar: 1, sub: r.type === 'book' ? (r.pages ? r.pages.length : 0) + (r.pages && r.pages.length === 1 ? ' page' : ' pages') : r.imgs.length + (r.imgs.length === 1 ? ' page' : ' pages'), glyph: '→', open: () => open(r.id), remove: async () => { await del(r.id); await refresh(); } };
    if (r.type === 'comic') { urls[r.id] = urls[r.id] || URL.createObjectURL(r.imgs[0]); it.poster = urls[r.id]; }
    return it;
  }
  async function refresh() {
    try { const rs = await all(); window.LIBD = window.LIBD || {}; LIBD.books = rs.filter(r => r.type === 'book').map(toItem); LIBD.comics = rs.filter(r => r.type === 'comic').map(toItem); if (typeof lib === 'function') lib(); } catch (_) { /* storage unavailable */ }
  }
  function pick(kind) {
    const i = document.createElement('input'); i.type = 'file'; i.style.display = 'none';
    if (kind === 'BOOK') i.accept = '.epub,.pdf,.docx,.txt,.md,.html,.htm,application/pdf,application/epub+zip,text/plain'; else { i.accept = '.pdf,.cbz,.zip,application/pdf,image/*'; i.multiple = true; }
    document.body.appendChild(i);
    i.onchange = async () => {
      const files = [...i.files]; i.remove(); if (!files.length) return;
      try {
        toast('Importing…');
        let rec;
        if (kind === 'BOOK') { const f = files[0], n = f.name.toLowerCase(), p = /\.epub$/.test(n) ? await parseEpub(await f.arrayBuffer(), f.name) : /\.pdf$/.test(n) ? await parsePdfBook(f) : /\.docx$/.test(n) ? await parseDocx(f) : /\.(html?|md)$/.test(n) ? await parseMarkup(f) : await parseTxt(f); rec = { id: 'b' + Date.now(), type: 'book', title: clean(p.title), pages: p.pages, pos: 0, created: Date.now() }; }
        else { const p = await parseComic(files); rec = { id: 'c' + Date.now(), type: 'comic', title: clean(p.title), imgs: p.imgs, pos: 0, created: Date.now() }; }
        await put(rec); await refresh(); toast('Added "' + rec.title + '"'); open(rec.id);
      } catch (e) { toast('Could not import: ' + (e && e.message ? e.message : e)); }
    };
    i.click();
  }

  /* ---------- reader ---------- */
  const css = document.createElement('style');
  css.textContent = '#sbk{position:fixed;inset:0;z-index:99992;background:#0b0b0c;color:#f1f1f3;display:none;flex-direction:column;font-family:"Plus Jakarta Sans",system-ui,sans-serif}#sbk.on{display:flex}' +
    '#sbk .bar{display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) 12px 10px}#sbk .bar button{width:40px;height:40px;border-radius:50%;border:0;background:#1d1e22;color:#fff;font-size:18px}#sbk .bar b{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:15px}#sbk .bar span{color:#8a8d95;font-size:13px}' +
    '#sbk .body{flex:1;overflow:auto;padding:8px 20px 30px;-webkit-overflow-scrolling:touch}#sbk .body p{font-size:21px;line-height:1.9;margin:0 0 18px}#sbk .body p.r{direction:rtl;text-align:right;font-family:var(--ar,Amiri,"Noto Naskh Arabic",serif);font-size:25px;line-height:2.2}' +
    '#sbk .bw{border-radius:6px;padding:0 1px}#sbk .bw.sel{background:var(--ac,#e11d2e);color:#fff}' +
    '#sbk .foot{display:flex;gap:10px;padding:10px 12px calc(12px + env(safe-area-inset-bottom,0px))}#sbk .foot button{flex:1;height:48px;border-radius:16px;border:0;background:#1d1e22;color:#fff;font:700 15px system-ui,sans-serif}#sbk .foot button.pri{background:var(--ac,#e11d2e)}#sbk .foot button:disabled{opacity:.35}' +
    '#sbk .img{flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;background:#000}#sbk .img img{max-width:100%;height:auto;display:block}' +
    '#sbk .oc{margin:0 12px;padding:14px;border-radius:18px;background:#17181b;max-height:34vh;overflow:auto;display:none}#sbk .oc.on{display:block}#sbk .oc p{margin:0;font-size:21px;line-height:1.9}#sbk .oc p.r{direction:rtl;text-align:right;font-size:25px}#sbk .oc textarea{width:100%;min-height:90px;background:#0b0b0c;color:#fff;border:1px solid #2a2b30;border-radius:12px;padding:10px;font-size:17px;box-sizing:border-box}#sbk .oc small{color:#8a8d95;display:block;margin-top:8px}' +
    '#sbk-pop{position:fixed;left:0;right:0;bottom:0;z-index:99993;background:#15161a;border-radius:26px 26px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));display:none;box-shadow:0 -20px 50px rgba(0,0,0,.6);color:#f1f1f3;font-family:"Plus Jakarta Sans",system-ui,sans-serif}#sbk-pop.on{display:block}' +
    '#sbk-pop .w{font-size:28px;font-weight:700}#sbk-pop .g{font-size:19px;margin-top:6px;min-height:26px}#sbk-pop .s{color:#9a9da6;font-size:14px;line-height:1.5;margin-top:10px}#sbk-pop .row{display:flex;gap:10px;margin-top:14px}#sbk-pop button{flex:1;height:46px;border:0;border-radius:14px;background:#24262b;color:#fff;font:700 14px system-ui,sans-serif}#sbk-pop button.pri{background:var(--ac,#e11d2e)}';
  document.head.appendChild(css);
  let cur = null, page = 0, ocrMode = false;
  function shell() {
    let b = $('sbk'); if (b) return b;
    b = document.createElement('div'); b.id = 'sbk';
    b.innerHTML = '<div class="bar"><button id="sbk-x" aria-label="Back">←</button><b id="sbk-t"></b><span id="sbk-n"></span><button id="sbk-d" aria-label="Remove" title="Remove from library">🗑</button></div><div class="body" id="sbk-b"></div><div class="oc" id="sbk-oc"></div><div class="foot"><button id="sbk-p">‹ Prev</button><button id="sbk-o" class="pri" style="display:none">Read text</button><button id="sbk-nx">Next ›</button></div>';
    document.body.appendChild(b);
    const pop = document.createElement('div'); pop.id = 'sbk-pop'; document.body.appendChild(pop);
    $('sbk-x').onclick = close; $('sbk-p').onclick = () => go(-1); $('sbk-nx').onclick = () => go(1);
    $('sbk-d').onclick = async () => {
      if (!cur) return;
      const nm = clean(cur.title), q = { title: 'Remove “' + nm + '”?', text: 'It will be taken out of your library, along with your place in it. The original file on your phone is not touched.', ok: 'Remove' };
      if (await (window.SAFINA_RM ? window.SAFINA_RM.ask(q) : Promise.resolve(confirm(q.title)))) { await del(cur.id); close(); refresh(); }
    };
    $('sbk-o').onclick = () => { ocrMode = !ocrMode; $('sbk-o').textContent = ocrMode ? 'Tap a bubble…' : 'Read text'; if (!ocrMode) $('sbk-oc').classList.remove('on'); };
    $('sbk-b').addEventListener('click', onBody);
    $('sbk-oc').addEventListener('click', onBody);
    return b;
  }
  async function open(id) {
    cur = await get(id); if (!cur) return; page = Math.min(cur.pos || 0, (cur.type === 'book' ? cur.pages.length : cur.imgs.length) - 1); ocrMode = false;
    shell().classList.add('on'); $('sbk-t').textContent = clean(cur.title); $('sbk-o').style.display = cur.type === 'comic' ? '' : 'none'; $('sbk-o').textContent = 'Read text'; $('sbk-oc').classList.remove('on'); draw();
  }
  function close() { const b = $('sbk'); if (b) b.classList.remove('on'); closePop(); if (cur) { cur.pos = page; put(cur).catch(() => { }); } }
  const total = () => cur.type === 'book' ? cur.pages.length : cur.imgs.length;
  function go(d) { const n = page + d; if (n < 0 || n >= total()) return; page = n; draw(); }
  const words = (para, si) => para.replace(/(\p{L}[\p{L}\p{M}'’\-]*)/gu, '<span class="bw">$1</span>');
  function paraHtml(p) { return '<p class="' + (RTL.test(p) ? 'r' : '') + '">' + p.split(/(?<=[.!?؟۔。…])\s+/).map(s => '<span class="bs">' + words(esc(s)) + ' </span>').join('') + '</p>'; }
  function draw() {
    closePop(); const b = $('sbk-b');
    $('sbk-n').textContent = (page + 1) + ' / ' + total(); $('sbk-p').disabled = page === 0; $('sbk-nx').disabled = page >= total() - 1; cur.pos = page;
    if (cur.type === 'book') { b.className = 'body'; b.innerHTML = cur.pages[page].map(paraHtml).join(''); b.scrollTop = 0; }
    else { b.className = 'img'; if (b._u) URL.revokeObjectURL(b._u); b._u = URL.createObjectURL(cur.imgs[page]); b.innerHTML = '<img id="sbk-i" alt="Page ' + (page + 1) + '" src="' + b._u + '">'; b.scrollTop = 0; $('sbk-oc').classList.remove('on'); }
  }

  /* ---------- word popup ---------- */
  function closePop() { const p = $('sbk-pop'); if (p) p.classList.remove('on'); document.querySelectorAll('#sbk .bw.sel').forEach(x => x.classList.remove('sel')); }
  async function onBody(e) {
    const w = e.target.closest('.bw');
    if (w) return wordPop(w);
    if (cur && cur.type === 'comic' && ocrMode && e.target.id === 'sbk-i') return ocr(e, e.target);
    closePop();
  }
  async function wordPop(w) {
    document.querySelectorAll('#sbk .bw.sel').forEach(x => x.classList.remove('sel')); w.classList.add('sel');
    const word = w.textContent, sent = (w.closest('.bs') ? w.closest('.bs').textContent : w.closest('p').textContent).trim(), pop = $('sbk-pop');
    pop.innerHTML = '<div class="w">' + esc(word) + '</div><div class="g" id="sbk-g">Looking it up…</div><div class="s">' + esc(sent) + '</div><div class="s" id="sbk-s"></div><div class="row"><button id="sbk-ts">Translate sentence</button><button class="pri" id="sbk-sv">Save sentence</button></div>';
    pop.classList.add('on'); let gloss = '';
    try { const r = await SAI().lookupWord(word, sent); gloss = (r && (r.gloss || r.t)) || ''; $('sbk-g').textContent = gloss || 'No meaning found'; } catch (e) { $('sbk-g').textContent = 'Could not look it up (' + (e && e.message ? e.message : 'set up AI in Profile') + ')'; }
    $('sbk-ts').onclick = async () => { $('sbk-s').textContent = '…'; try { $('sbk-s').textContent = (await SAI().translateLine(sent)).t; } catch (_) { $('sbk-s').textContent = 'Could not translate this sentence.'; } };
    $('sbk-sv').onclick = () => {
      try { if (window.SAFINA_ADDCARDS) window.SAFINA_ADDCARDS([{ type: 'word', word, lemma: word, meaning: gloss, sentence: sent, level: '' }]); } catch (_) { /* cards unavailable */ }
      try { window.BRAIN && BRAIN.saved && BRAIN.saved(word, sent); } catch (_) { /* brain not ready */ }
      $('sbk-sv').textContent = 'Saved ✓'; $('sbk-sv').disabled = true;
    };
  }

  /* ---------- comic OCR ---------- */
  const OL = { ar: 'ara', en: 'eng', fr: 'fra', es: 'spa', de: 'deu', it: 'ita', pt: 'por', ru: 'rus', tr: 'tur', ja: 'jpn', ko: 'kor', zh: 'chi_sim', he: 'heb', fa: 'fas', ur: 'urd', hi: 'hin' };
  const loadOcr = () => window.Tesseract ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'; s.onload = ok; s.onerror = () => no(new Error('needs internet the first time')); document.head.appendChild(s); });
  async function ocr(e, img) {
    const oc = $('sbk-oc'); oc.classList.add('on'); oc.innerHTML = '<small>Reading the bubble…</small>';
    try {
      const r = img.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width * img.naturalWidth, ny = (e.clientY - r.top) / r.height * img.naturalHeight;
      const w = Math.min(img.naturalWidth, img.naturalWidth * .55), h = Math.min(img.naturalHeight, img.naturalHeight * .24), x = Math.max(0, Math.min(img.naturalWidth - w, nx - w / 2)), y = Math.max(0, Math.min(img.naturalHeight - h, ny - h / 2));
      const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h); c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
      await loadOcr(); const res = await window.Tesseract.recognize(c, OL[learn()] || 'eng'), t = (res.data.text || '').replace(/\s+/g, ' ').trim();
      showText(t);
    } catch (err) { showText('', 'Could not read this bubble (' + (err && err.message ? err.message : err) + '). You can type the text instead.'); }
  }
  function showText(t, note) {
    const oc = $('sbk-oc'); oc.classList.add('on');
    oc.innerHTML = (t ? paraHtml(t) : '') + (note ? '<small>' + esc(note) + '</small>' : '') + '<small><a href="#" id="sbk-fix" style="color:var(--ac,#e11d2e)">' + (t ? 'Fix the text' : 'Type the text') + '</a></small>';
    $('sbk-fix').onclick = ev => { ev.preventDefault(); oc.innerHTML = '<textarea id="sbk-ta" dir="auto">' + esc(t || '') + '</textarea><div style="margin-top:8px"><button id="sbk-ok" style="height:40px;padding:0 18px;border:0;border-radius:12px;background:var(--ac,#e11d2e);color:#fff;font-weight:700">Done</button></div>'; $('sbk-ta').focus(); $('sbk-ok').onclick = () => showText($('sbk-ta').value.trim()); };
  }

  /* ---- the + (Add to your library) sheet: a Video / Book / Comic switch with an Upload button ---- */
  let mode = 'video';
  function addSheet() {
    const form = $('safina-import-form'), sel = $('safina-import-type'); if (!form || !sel) return;
    if ($('sbk-seg') && $('sbk-add')) return;
    ['sbk-seg', 'sbk-add'].forEach(i => { const o = $(i); if (o) o.remove(); });
    const seg = document.createElement('div'); seg.id = 'sbk-seg';
    seg.innerHTML = [['video', 'Video'], ['book', 'Book'], ['comic', 'Comic']].map(m => '<button type="button" data-m="' + m[0] + '">' + m[1] + '</button>').join('');
    const box = document.createElement('div'); box.id = 'sbk-add';
    box.innerHTML = '<button type="button" class="pri" id="sbk-up"></button><div class="mu" id="sbk-hint"></div>';
    form.prepend(seg); seg.after(box);
    const sync = () => {
      const bc = mode !== 'video';
      [...form.children].forEach(el => { if (el === seg || el === box) return; el.style.display = bc ? 'none' : ''; });
      box.style.display = bc ? '' : 'none';
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
      if (bc) { $('sbk-up').textContent = mode === 'book' ? '⬆  Upload a book' : '⬆  Upload a comic'; $('sbk-hint').textContent = mode === 'book' ? 'PDF, EPUB, Word (.docx), TXT, Markdown or HTML. Tap any word while reading to see its meaning and save the sentence.' : 'A PDF, a CBZ/ZIP of pages, or a set of pictures. Tap "Read text" on a page, then tap a speech bubble.'; }
    };
    seg.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; sync(); });
    $('sbk-up').onclick = () => { const k = mode === 'book' ? 'BOOK' : 'COMIC'; const x = $('safina-add-close'); if (x) x.click(); pick(k); };
    const h = $('safina-add-heading'); if (h && h.nextElementSibling) h.nextElementSibling.textContent = 'Videos, books and comics from your phone';
    sync();
  }
  const sheetCss = document.createElement('style');
  sheetCss.textContent = '#sbk-seg{display:flex;gap:6px;padding:4px;border-radius:16px;background:rgba(255,255,255,.06);margin:2px 0 14px}#sbk-seg button{flex:1;height:40px;border:0;border-radius:12px;background:transparent;color:#a9acb4;font:700 14px "Plus Jakarta Sans",system-ui,sans-serif}#sbk-seg button.on{background:var(--ac,#e11d2e);color:#fff}' +
    '#sbk-add #sbk-up{width:100%;height:54px;border:0;border-radius:16px;background:var(--ac,#e11d2e);color:#fff;font:800 16px "Plus Jakarta Sans",system-ui,sans-serif}#sbk-add .mu{margin-top:12px;line-height:1.55;font-size:13px}';
  document.head.appendChild(sheetCss);

  window.SAFINA_BOOKS = { pick, open, refresh, parseEpub, parseTxt, parseComic, parsePdfBook, parsePdfComic };
  const start = () => { setTimeout(refresh, 600); addSheet(); setInterval(addSheet, 800); document.addEventListener('click', () => setTimeout(addSheet, 60), true); };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
