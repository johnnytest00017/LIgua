/* Safina AI UI: the "AI & downloads" sheet, the limit dialog, first-run setup, and language switching.
 * Needs window.SAI (safina-boot.js), window.SafinaModels, window.SafinaAI. Uses the page's toast() when present. */
(function () {
  'use strict';
  const SAI = window.SAI, SM = window.SafinaModels, SA = window.SafinaAI;
  if (!SAI || !SM || !SA) { console.error('Safina AI scripts did not load'); return; }
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = m => { try { window.toast(m); } catch (_) { /* page has no toast */ } };
  const mb = n => n ? (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1e6)) + ' MB') : 'size unknown';
  const L = c => (SA.LANGS[c] || { name: c }).name;

  /* ------------------------------------------------------------------ styles */
  const css = document.createElement('style');
  css.textContent = `
#sai-sheet,#sai-dlg{position:fixed;inset:0;z-index:2000;display:none;background:rgba(0,0,0,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
#sai-sheet.open,#sai-dlg.open{display:block}
#sai-panel{position:absolute;left:0;right:0;bottom:0;top:max(24px,env(safe-area-inset-top,0px));background:var(--bg,#0b0b0c);color:var(--tx,#f3f3f3);border-radius:24px 24px 0 0;overflow:auto;padding:14px 16px calc(28px + env(safe-area-inset-bottom,0px));font:500 14px/1.4 "Plus Jakarta Sans",Manrope,system-ui,sans-serif;-webkit-overflow-scrolling:touch}
#sai-panel h2{font:800 20px/1.1 "Plus Jakarta Sans",system-ui,sans-serif;margin:0}
#sai-panel h3{font:800 13px/1 "Plus Jakarta Sans",system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--mu,#9aa);margin:22px 2px 10px}
.sai-top{display:flex;align-items:center;gap:10px;margin-bottom:6px}.sai-top h2{flex:1}
.sai-x{width:40px;height:40px;border-radius:50%;border:1px solid var(--ln,#333);background:var(--card,#161618);color:inherit;font-size:18px}
.sai-card{background:var(--card,#161618);border:1px solid var(--ln,#2a2a2e);border-radius:18px;padding:12px 14px;margin:8px 0}
.sai-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.sai-row .grow{flex:1;min-width:0}
.sai-card b{font-weight:800}.sai-mu{color:var(--mu,#9aa);font-size:12.5px}
.sai-card select,.sai-card input[type=text],.sai-card input[type=password],.sai-card input:not([type]){width:100%;box-sizing:border-box;padding:10px 12px;border-radius:12px;border:1px solid var(--ln,#333);background:var(--bg,#0b0b0c);color:inherit;font:inherit;margin-top:6px}
.sai-btn{border:1px solid var(--ln,#333);background:var(--card,#161618);color:inherit;border-radius:9999px;padding:9px 14px;font:800 12.5px "Plus Jakarta Sans",system-ui,sans-serif;white-space:nowrap}
.sai-btn.pri{background:var(--tx,#fff);color:var(--bg,#000);border-color:transparent}.sai-btn.bad{color:#ff6b78}.sai-btn:disabled{opacity:.45}
.sai-ok{color:#4ade80}.sai-warn{color:#f5c542}.sai-err{color:#ff6b78}
.sai-bar{height:6px;border-radius:9px;background:var(--ln,#333);overflow:hidden;margin-top:8px}.sai-bar i{display:block;height:100%;width:0;background:var(--ac,#e0334a)}
.sai-sw{display:flex;align-items:center;gap:12px;padding:8px 0}.sai-sw input{width:20px;height:20px;accent-color:var(--ac,#e0334a);flex:0 0 auto}
.sai-banner{background:color-mix(in srgb,var(--ac,#e0334a) 16%,var(--card,#161618));border:1px solid var(--ac,#e0334a);border-radius:18px;padding:12px 14px;margin:10px 0}
.sai-note{font-size:12px;color:var(--mu,#9aa);margin:6px 2px;line-height:1.45}
#sai-dlg{background:rgba(0,0,0,.6)}
#sai-dlgbox{position:absolute;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));max-width:520px;margin:0 auto;background:var(--card,#161618);color:var(--tx,#f3f3f3);border:1px solid var(--ln,#333);border-radius:24px;padding:18px;font:500 14px/1.4 "Plus Jakarta Sans",system-ui,sans-serif}
#sai-dlgbox h2{font:800 18px/1.15 "Plus Jakarta Sans",system-ui,sans-serif;margin:0 0 4px}
#sai-dlgbox .opt{display:block;width:100%;text-align:left;margin-top:8px;padding:12px 14px;border-radius:16px;border:1px solid var(--ln,#333);background:var(--bg,#0b0b0c);color:inherit;font:700 14px "Plus Jakarta Sans",system-ui,sans-serif}
#sai-dlgbox .opt small{display:block;font:500 12px Manrope,system-ui,sans-serif;color:var(--mu,#9aa);margin-top:2px}
#sai-dlgbox .opt:first-of-type{border-color:var(--ac,#e0334a)}
.wa-sys{align-self:center;margin:10px auto;padding:5px 12px;border-radius:9999px;background:var(--card,#161618);border:1px solid var(--ln,#333);color:var(--mu,#9aa);font:700 11.5px "Plus Jakarta Sans",system-ui,sans-serif;text-align:center;max-width:90%}
.wa-via{font:600 11px Manrope,system-ui,sans-serif;color:var(--mu,#9aa);margin:3px 6px 0}
.pnote{font:500 12.5px/1.4 Manrope,system-ui,sans-serif;color:var(--mu,#9aa);margin:6px 0 0}.pnote.dim{opacity:.8}.pnote a{color:inherit;text-decoration:underline}
.w .dia,.w{unicode-bidi:plaintext}
`;
  document.head.appendChild(css);

  /* ------------------------------------------------------------------ language-dependent bits of the page */
  function applyLang() {
    const l = SAI.lang(), info = SA.LANGS[l.learn] || { name: l.learn };
    document.documentElement.setAttribute('data-learn', l.learn);
    ['ar', 'pAr'].forEach(id => { const n = $(id); if (n) n.setAttribute('dir', info.rtl ? 'rtl' : 'ltr'); });
    const q = $('aiq'); if (q) q.placeholder = 'Message ' + info.name + ' Tutor';
    const g = document.querySelector('#aiempty p'); if (g) g.textContent = 'How can I help with your ' + info.name + '?';
    const t = document.querySelector('#menu .mrow span'); if (t) t.textContent = info.name + ' text size';
    const st = $('sai-profile-status'); if (st) st.textContent = statusLine();
    const ln = $('sai-learn-name'); if (ln) ln.textContent = info.name;
    window.dispatchEvent(new Event('safina-lang'));
  }
  function statusLine() {
    const l = SAI.lang(), a = SAI.active();
    const mt = SM.hasTranslator(l.learn, l.native) ? 'on-phone translator ready' : 'no on-phone translator';
    return L(l.learn) + ' → ' + L(l.native) + ' · ' + (a ? 'AI: ' + SAI.describe(a) : 'no AI set up') + ' · ' + mt;
  }

  /* ------------------------------------------------------------------ the sheet */
  let MAN = { translators: [], llms: [], source: 'none', error: '' };
  let open = false, progress = {}, msgs = {}, cfgEdit = false;
  const sheet = document.createElement('div');
  sheet.id = 'sai-sheet'; sheet.innerHTML = '<div id="sai-panel" role="dialog" aria-label="AI and downloads"></div>';
  const dlg = document.createElement('div');
  dlg.id = 'sai-dlg'; dlg.innerHTML = '<div id="sai-dlgbox" role="alertdialog"></div>';
  document.body.append(sheet, dlg);
  const panel = $('sai-panel');

  async function reloadManifest() { MAN = await SM.loadManifest(Object.keys(SA.LANGS)); }
  function pairsNeeded() {
    const l = SAI.lang(); return [[l.learn, l.native, true], [l.native, l.learn, false]];
  }
  const trFor = (s, t) => MAN.translators.find(x => x.src === s && x.tgt === t);
  const fmtLimit = lim => lim ? 'limit until ' + new Date(lim.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  function packRow(kind, pack, title, sub) {
    const key = kind + ':' + pack.id, inst = SM.installed(kind, pack.id), pr = progress[key];
    const busy = SM.busyKeys().includes(key);
    let right;
    if (busy) right = '<button class="sai-btn" disabled>Downloading…</button>';
    else if (inst) right = (kind === 'llm' ? '<button class="sai-btn" data-act="use-llm" data-id="' + esc(pack.id) + '">' + (SM.currentLlm() && SM.currentLlm().id === pack.id ? 'In use ✓' : 'Use') + '</button> ' : '') + '<button class="sai-btn bad" data-act="rm" data-kind="' + kind + '" data-id="' + esc(pack.id) + '">Remove</button>';
    else right = '<button class="sai-btn pri" data-act="dl" data-kind="' + kind + '" data-id="' + esc(pack.id) + '">Download</button>';
    return '<div class="sai-card"><div class="sai-row"><div class="grow"><b>' + esc(title) + '</b><div class="sai-mu">' + esc(sub) + (inst ? ' · <span class="sai-ok">installed</span>' : '') + '</div></div>' + right + '</div>' +
      (busy ? '<div class="sai-bar"><i data-prog="' + esc(key) + '" style="width:' + (pr && pr.total ? Math.round(pr.bytes / pr.total * 100) : 0) + '%"></i></div><div class="sai-mu" data-progtxt="' + esc(key) + '">' + (pr ? progText(pr) : 'Starting…') + '</div>' : '') +
      (msgs[key] ? '<div class="sai-err" style="margin-top:6px">' + esc(msgs[key]) + '</div>' : '') + '</div>';
  }
  const progText = p => p.total ? Math.round(p.bytes / p.total * 100) + '% · ' + mb(p.bytes) + ' of ' + mb(p.total) : mb(p.bytes) + ' downloaded';

  function accountCard(a) {
    const prov = SA.PROVIDERS[a.provider], mt = SA.isMT(a.provider), st = SAI.state();
    const lim = !mt && Object.entries(st.limits).map(([k, v]) => [k.split('|'), v]).find(([k, v]) => k[0] === a.id && v.until > Date.now());
    const status = st.invalid[a.id] ? '<span class="sai-err">key rejected</span>' : !a.key ? '<span class="sai-warn">needs a key</span>' : lim ? '<span class="sai-warn">' + fmtLimit(lim[1]) + '</span>' : a.enabled ? '<span class="sai-ok">ready</span>' : '<span class="sai-mu">off</span>';
    const models = Array.from(new Set([a.model].concat(a.models || []))).filter(Boolean);
    const first = SAI.state().accounts.indexOf(a) === 0, last = SAI.state().accounts.indexOf(a) === SAI.state().accounts.length - 1;
    return '<div class="sai-card" data-acc="' + esc(a.id) + '"><div class="sai-row"><div class="grow"><b>' + esc(prov.name) + ' · ' + esc(a.label) + '</b> ' + status + '</div>' +
      '<button class="sai-btn" data-act="acc-up"' + (first ? ' disabled' : '') + ' aria-label="Move up">↑</button><button class="sai-btn" data-act="acc-down"' + (last ? ' disabled' : '') + ' aria-label="Move down">↓</button></div>' +
      '<input data-f="label" value="' + esc(a.label) + '" placeholder="Name (Personal, Work…)" aria-label="Account name">' +
      '<input data-f="key" type="password" value="' + esc(a.key) + '" placeholder="API key" autocomplete="off" aria-label="API key">' +
      (prov.needsBase ? '<input data-f="base" value="' + esc(a.base) + '" placeholder="Base address, e.g. https://host/v1" aria-label="Base address">' : '') +
      (mt ? '' : '<div class="sai-row"><div class="grow"><select data-f="model" aria-label="Model">' + models.map(m => '<option' + (m === a.model ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select></div><button class="sai-btn" data-act="acc-models">Refresh list</button></div>') +
      '<div class="sai-row" style="margin-top:8px"><label class="sai-sw" style="padding:0"><input type="checkbox" data-f="enabled"' + (a.enabled ? ' checked' : '') + '><span>On</span></label><span class="grow"></span><button class="sai-btn" data-act="acc-test">Test</button><button class="sai-btn bad" data-act="acc-del">Remove</button></div>' +
      (msgs[a.id] ? '<div class="sai-mu" style="margin-top:6px">' + esc(msgs[a.id]) + '</div>' : '') + '</div>';
  }

  function view() {
    const st = SAI.state(), cfg = SM.cfg(), l = st.lang, native = SM.isNative();
    const langOpts = sel => Object.keys(SA.LANGS).map(c => '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>' + esc(SA.LANGS[c].name) + '</option>').join('');
    let h = '<div class="sai-top"><h2>AI &amp; downloads</h2><button class="sai-x" data-act="close" aria-label="Close">✕</button></div>';

    const needTr = !SM.hasTranslator(l.learn, l.native), needLlm = !SM.local.ready();
    if (!cfg.setupDone && (needTr || needLlm)) h += '<div class="sai-banner"><b>First set-up</b><div class="sai-mu">The app is small because the translator and the on-phone AI are downloaded here. Pick the language you are learning, then download. You can also skip this and use an AI account only.</div></div>';

    h += '<h3>Languages</h3><div class="sai-card"><label class="sai-mu">I am learning</label><select data-act="lang" data-f="learn">' + langOpts(l.learn) + '</select><label class="sai-mu" style="display:block;margin-top:10px">My language (translations appear in)</label><select data-act="lang" data-f="native">' + langOpts(l.native) + '</select></div>';

    h += '<h3>Translation</h3><div class="sai-card"><div class="sai-mu">How a line reaches you:  draft  →  AI pass  →  you</div>' +
      '<label class="sai-mu" style="display:block;margin-top:8px">Draft comes from</label><select data-act="opt" data-f="mtMode">' +
      [['local', 'On-phone translator first, translation API as backup'], ['api', 'Translation API first, on-phone translator as backup'], ['ai', 'No draft: the AI translates directly']].map(o => '<option value="' + o[0] + '"' + (st.mtMode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
      '<label class="sai-sw"><input type="checkbox" data-act="opt" data-f="refine"' + (st.refine ? ' checked' : '') + '><span><b>AI pass</b><br><span class="sai-mu">Fixes mistakes, explains the meaning in context' + (SA.LANGS[l.learn] && SA.LANGS[l.learn].diac ? ', adds ' + SA.LANGS[l.learn].diac : '') + '.</span></span></label>' +
      '<label class="sai-sw"><input type="checkbox" data-act="showdia"' + (window.SAFINA_SHOWDIA() ? ' checked' : '') + '><span><b>Show diacritics</b><br><span class="sai-mu">On the line you are learning, when the AI has added them.</span></span></label></div>';

    h += '<h3>Downloads</h3>';
    if (!native) h += '<div class="sai-note">Downloads only work in the installed app. In a browser you can still use AI accounts below.</div>';
    if (SM.onCellular() && native) h += '<div class="sai-note sai-warn">You are on mobile data. These files are large: Wi-Fi is better.</div>';
    h += '<div class="sai-card"><div class="sai-row"><div class="grow"><b>Where to download from</b><div class="sai-mu">' + (cfg.manifestUrl || cfg.translatorBase ? esc(cfg.manifestUrl || cfg.translatorBase) : 'Not set yet') + '</div></div><button class="sai-btn" data-act="cfg-toggle">' + (cfgEdit || !(cfg.manifestUrl || cfg.translatorBase) ? 'Hide' : 'Change') + '</button></div>';
    if (cfgEdit || !(cfg.manifestUrl || cfg.translatorBase)) {
      h += '<input data-f="manifestUrl" value="' + esc(cfg.manifestUrl) + '" placeholder="Manifest address (https://…/manifest.json)" aria-label="Manifest address">' +
        '<input data-f="translatorBase" value="' + esc(cfg.translatorBase) + '" placeholder="or translator folder, e.g. https://github.com/you/repo/releases/download/models/{pair}-{file}" aria-label="Translator folder address">' +
        '<div class="sai-note">The manifest lists the translator packs and on-phone AI models you host. Or give a folder pattern: {pair} becomes ar-en, {file} becomes encoder_model.onnx and so on.</div><button class="sai-btn pri" data-act="cfg-save" style="margin-top:6px">Save</button>';
    }
    if (MAN.error) h += '<div class="sai-err" style="margin-top:6px">' + esc(MAN.error) + '</div>';
    h += '</div>';

    const shown = [];
    pairsNeeded().forEach(([s, t, main]) => {
      const p = trFor(s, t);
      if (p) { shown.push(p.id); h += packRow('tr', p, L(s) + ' → ' + L(t) + ' translator' + (main ? '' : ' (optional)'), (main ? 'Used for subtitles and words · ' : 'For the reverse direction · ') + mb(p.size)); }
      else if (main) h += '<div class="sai-card"><b>' + esc(L(s) + ' → ' + L(t)) + ' translator</b><div class="sai-mu">' + (MAN.translators.length || cfg.translatorBase || cfg.manifestUrl ? 'Not in your download list.' : 'Set the download address above to see it.') + '</div></div>';
    });
    const rec = recommended();
    if (rec.length && native) h += '<button class="sai-btn pri" data-act="dl-rec" style="margin:8px 0">Download recommended (' + mb(rec.reduce((s, r) => s + (r.pack.size || 0), 0)) + ')</button>';

    h += '<h3>On-phone AI</h3>';
    if (!SM.hasLlmEngine()) h += '<div class="sai-note sai-warn">This build has no on-phone AI engine yet (the LinguaLlm plugin is not installed). You can download a model, but it cannot run until the plugin is built into the app.</div>';
    if (MAN.llms.length) MAN.llms.forEach(m => { h += packRow('llm', m, m.name, 'Free, works offline, used when AI accounts run out · ' + mb(m.size)); });
    else h += '<div class="sai-note">No on-phone models in your download list.</div>';
    const cl = cfg.customLlm || {};
    h += '<div class="sai-card"><b>Use your own model file</b><div class="sai-mu">A direct link to a MediaPipe .task / .litertlm file.</div><input data-f="cl-name" value="' + esc(cl.name || '') + '" placeholder="Name"><input data-f="cl-url" value="' + esc(cl.url || '') + '" placeholder="https://…/model.task"><select data-f="cl-family"><option value="gemma"' + (cl.family === 'gemma' ? ' selected' : '') + '>Gemma chat format</option><option value="chatml"' + (cl.family !== 'gemma' ? ' selected' : '') + '>ChatML format (Qwen and most others)</option></select><button class="sai-btn" data-act="cl-save" style="margin-top:8px">Save</button></div>';

    h += '<h3>AI accounts</h3><div class="sai-note">An account is an API key from the provider\'s developer page. A ChatGPT Plus or Claude Pro subscription is not an API key. Keys stay on this phone. Order matters: the first usable account is used first.</div>';
    st.accounts.forEach(a => { h += accountCard(a); });
    const provs = Object.keys(SA.PROVIDERS);
    h += '<div class="sai-card"><b>Add an account</b><select data-f="n-provider">' + provs.map(p => '<option value="' + p + '">' + esc(SA.PROVIDERS[p].name) + (SA.isMT(p) ? ' (translation only)' : '') + '</option>').join('') + '</select><input data-f="n-label" placeholder="Name (Personal, Work…)"><input data-f="n-key" type="password" placeholder="API key" autocomplete="off"><input data-f="n-base" placeholder="Base address (Custom only)"><button class="sai-btn pri" data-act="acc-add" style="margin-top:8px">Add</button></div>';

    h += '<h3>When a limit is reached</h3><div class="sai-card"><label class="sai-sw"><input type="radio" name="sai-lim" data-act="autoswitch" value="0"' + (!st.autoSwitch ? ' checked' : '') + '><span><b>Ask me</b><br><span class="sai-mu">Choose: same model on another account, another model on the same account, another AI, or the on-phone AI.</span></span></label>' +
      '<label class="sai-sw"><input type="radio" name="sai-lim" data-act="autoswitch" value="1"' + (st.autoSwitch ? ' checked' : '') + '><span><b>Switch automatically</b><br><span class="sai-mu">In that order, without asking.</span></span></label></div>';
    h += '<h3>Saved translations</h3><div class="sai-card"><div class="sai-row"><div class="grow sai-mu">Lines and words already translated are kept, so they cost nothing the second time.</div><button class="sai-btn" data-act="clear-cache">Clear</button></div></div>';
    return h;
  }

  function recommended() {
    const l = SAI.lang(), out = [];
    const t = trFor(l.learn, l.native); if (t && !SM.installed('tr', t.id)) out.push({ kind: 'tr', pack: t });
    if (!SM.local.ready() && MAN.llms.length && SM.hasLlmEngine()) { const m = MAN.llms.find(x => x.id !== 'custom') || MAN.llms[0]; if (!SM.installed('llm', m.id)) out.push({ kind: 'llm', pack: m }); }
    return out;
  }

  function render() {
    const y = panel.scrollTop;
    panel.innerHTML = view();
    panel.scrollTop = y;
    const st = $('sai-profile-status'); if (st) st.textContent = statusLine();
  }
  async function openSheet() {
    open = true; sheet.classList.add('open'); render();
    try { await reloadManifest(); } catch (e) { MAN.error = String(e && e.message || e); }
    if (open) render();
  }
  function closeSheet() {
    open = false; sheet.classList.remove('open');
    if (!SM.cfg().setupDone) SM.setConfig({ setupDone: true });
    applyLang();
  }

  async function startInstall(kind, pack) {
    const key = kind + ':' + pack.id; msgs[key] = '';
    progress[key] = { bytes: 0, total: pack.size || 0 };
    render();
    try {
      await SM.install(kind, pack, p => {
        progress[key] = p;
        const bar = panel.querySelector('[data-prog="' + key + '"]'), tx = panel.querySelector('[data-progtxt="' + key + '"]');
        if (bar && p.total) bar.style.width = Math.round(p.bytes / p.total * 100) + '%';
        if (tx) tx.textContent = progText(p);
      });
      say(pack.name || pack.id + ' installed');
      if (kind === 'llm' && !SM.currentLlm()) SM.selectLlm(pack.id);
    } catch (e) { msgs[key] = String(e && e.message || e); }
    delete progress[key];
    if (open) render();
    applyLang();
  }
  const findPack = (kind, id) => (kind === 'tr' ? MAN.translators : MAN.llms).find(p => p.id === id);

  /* inputs inside an account card save as soon as they change */
  panel.addEventListener('change', e => {
    const t = e.target, card = t.closest('[data-acc]');
    if (card && t.dataset.f) {
      const id = card.dataset.acc, f = t.dataset.f;
      SAI.updateAccount(id, { [f]: f === 'enabled' ? t.checked : t.value.trim() });
      if (f === 'key' || f === 'enabled' || f === 'model') render();
      return;
    }
    const act = t.dataset.act;
    if (act === 'lang') {
      const l = Object.assign({}, SAI.lang(), { [t.dataset.f]: t.value });
      if (l.learn === l.native) { l[t.dataset.f === 'learn' ? 'native' : 'learn'] = l.learn === 'en' ? 'ar' : 'en'; }
      SAI.setOption('lang', l); applyLang(); render();
    } else if (act === 'opt') { SAI.setOption(t.dataset.f, t.type === 'checkbox' ? t.checked : t.value); render(); }
    else if (act === 'showdia') { window.SAFINA_SHOWDIA(t.checked); }
    else if (act === 'autoswitch') { SAI.setOption('autoSwitch', t.value === '1'); }
  });

  panel.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    const act = b.dataset.act, card = b.closest('[data-acc]'), id = card && card.dataset.acc;
    const val = f => { const n = panel.querySelector('[data-f="' + f + '"]'); return n ? n.value.trim() : ''; };
    if (act === 'close') closeSheet();
    else if (act === 'cfg-toggle') { cfgEdit = !cfgEdit; render(); }
    else if (act === 'cfg-save') { SM.setConfig({ manifestUrl: val('manifestUrl'), translatorBase: val('translatorBase') }); cfgEdit = false; await reloadManifest(); render(); }
    else if (act === 'dl' || act === 'rm') {
      const kind = b.dataset.kind, pid = b.dataset.id;
      if (act === 'dl') { const p = findPack(kind, pid); if (p) startInstall(kind, p); }
      else if (confirm('Remove this download from the phone?')) { await SM.remove(kind, pid); render(); applyLang(); }
    }
    else if (act === 'use-llm') { SM.selectLlm(b.dataset.id); render(); }
    else if (act === 'dl-rec') { for (const r of recommended()) await startInstall(r.kind, r.pack); }
    else if (act === 'cl-save') {
      SM.setConfig({ customLlm: val('cl-url') ? { name: val('cl-name') || 'Custom model', url: val('cl-url'), family: val('cl-family') } : null });
      await reloadManifest(); render();
    }
    else if (act === 'acc-add') {
      const provider = val('n-provider'), key = val('n-key');
      if (!key) { say('Paste the API key first'); return; }
      const nid = SAI.addAccount({ provider, key, label: val('n-label') || SA.PROVIDERS[provider].name, base: val('n-base') });
      msgs[nid] = ''; render();
      if (!SA.isMT(provider)) SAI.refreshModels(nid).then(() => open && render()).catch(() => { /* suggested models stay */ });
    }
    else if (act === 'acc-del') { if (confirm('Remove this account from the phone?')) { SAI.removeAccount(id); render(); } }
    else if (act === 'acc-up' || act === 'acc-down') { SAI.moveAccount(id, act === 'acc-up' ? -1 : 1); render(); }
    else if (act === 'acc-models') { msgs[id] = 'Loading the model list…'; render(); try { const m = await SAI.refreshModels(id); msgs[id] = m.length + ' models found'; } catch (err) { msgs[id] = 'Could not load models: ' + err.message; } render(); }
    else if (act === 'acc-test') { msgs[id] = 'Testing…'; render(); try { msgs[id] = '✓ Works. Reply: ' + await SAI.testAccount(id); } catch (err) { msgs[id] = '✗ ' + err.message; } render(); }
    else if (act === 'clear-cache') { SAI.clearCache(); say('Saved translations cleared'); }
  });
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });

  /* ------------------------------------------------------------------ the limit dialog */
  let dlgChain = Promise.resolve();
  function askLimit(o) {
    const run = () => new Promise(resolve => {
      const box = $('sai-dlgbox');
      const done = v => { dlg.classList.remove('open'); box.onclick = null; resolve(v); };
      box.innerHTML = '<h2>Limit reached</h2><div class="sai-mu">' + esc(o.slot) + ' cannot answer right now.<br>' + esc(String(o.reason || '').slice(0, 160)) + '</div>' +
        '<div style="margin-top:10px;font-weight:800">Keep going with:</div>' +
        o.options.map((x, i) => '<button class="opt" data-i="' + i + '">' + esc(x.label) + '</button>').join('') +
        '<div class="sai-row" style="margin-top:12px"><button class="sai-btn" data-x="manage">Manage accounts</button><span class="grow"></span><button class="sai-btn" data-x="cancel">Not now</button></div>';
      box.onclick = e => {
        const opt = e.target.closest('[data-i]'), x = e.target.closest('[data-x]');
        if (opt) done(o.options[+opt.dataset.i]);
        else if (x && x.dataset.x === 'cancel') done(null);
        else if (x && x.dataset.x === 'manage') { done(null); openSheet(); }
      };
      dlg.classList.add('open');
    });
    const p = dlgChain.then(run, run);
    dlgChain = p.catch(() => null);
    return p;
  }

  /* ------------------------------------------------------------------ first run + hooks */
  /* The app downloads what it needs by itself: the translator for the chosen language pair, then the on-phone AI. */
  let pill = null, autoBusy = false;
  function showPill(text, pct, keep) {
    if (!pill) {
      pill = document.createElement('div'); pill.id = 'sai-auto';
      pill.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 74px);z-index:99998;background:#16161a;color:#fff;border:1px solid #2c2c34;border-radius:14px;padding:10px 14px;font:13px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4)';
      pill.innerHTML = '<div class="t"></div><div style="height:4px;border-radius:3px;background:#2c2c34;margin-top:7px;overflow:hidden"><i style="display:block;height:100%;width:0;background:#e0334a;transition:width .2s"></i></div>';
      document.body.appendChild(pill);
    }
    pill.querySelector('.t').textContent = text;
    pill.querySelector('i').style.width = (pct || 0) + '%';
    pill.style.display = 'block';
    if (!keep) setTimeout(() => { if (pill && pill.querySelector('.t').textContent === text) pill.style.display = 'none'; }, 6000);
  }
  async function autoSetup(retry) {
    if (autoBusy || !SM.isNative()) return;
    autoBusy = true;
    const l = SAI.lang();
    try {
      const r = await SM.autoSetup({
        learn: l.learn, native: l.native, retry,
        onProgress: p => showPill('Downloading ' + (p.pack.indexOf('llm:') === 0 ? 'on-phone AI' : SAI.langInfo(l.learn).name + ' translator') + (p.total ? ' · ' + Math.round(p.bytes / p.total * 100) + '%' : ' · ' + mb(p.bytes)), p.total ? p.bytes / p.total * 100 : 0, true)
      });
      if (r.needSource) { if (!open) setTimeout(openSheet, 600); autoBusy = false; return; }
      if (r.failed.length) { showPill('Download problem: ' + r.failed[0].error + ' Open AI settings to change the source.', 0, false); if (!open && !SM.cfg().setupDone) setTimeout(openSheet, 600); }
      else if (r.done.length) showPill('Ready. ' + r.done.length + ' download' + (r.done.length > 1 ? 's' : '') + ' finished.', 100, false);
      else if (pill) pill.style.display = 'none';
      if (!r.failed.length) SM.setConfig({ setupDone: true });
    } catch (e) { showPill('Download problem: ' + (e && e.message || e), 0, false); }
    autoBusy = false; applyLang();
  }
  function maybeFirstRun() {
    if (SM.isNative()) { setTimeout(() => autoSetup(false), 600); return; }
    if (SM.cfg().setupDone) return;
    if (SAI.state().accounts.length || SM.registry && Object.keys(SM.registry()).length) { SM.setConfig({ setupDone: true }); return; }
    setTimeout(openSheet, 900);
  }
  /* choosing a different language downloads its translator too */
  let lastPair = SAI.lang().learn + '>' + SAI.lang().native;
  SAI.on('state', () => { const k = SAI.lang().learn + '>' + SAI.lang().native; if (k !== lastPair) { lastPair = k; autoSetup(false); } });
  window.SafinaUI = { open: openSheet, close: closeSheet, askLimit, applyLang, statusLine };

  SAI.on('state', () => { try { window.aiAixUI(); } catch (_) { /* tutor not built yet */ } });
  SAI.on('status', m => { const n = $('onnxStatus'); if (n) n.textContent = m || ''; });
  SAI.on('auth', d => say('The key for ' + d.slot + ' was rejected. Check it in AI settings.'));
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-open-ai]')) { e.preventDefault(); openSheet(); } });
  const pb = $('safinaAiOpen'); if (pb) pb.onclick = openSheet;
  applyLang(); maybeFirstRun();
})();
