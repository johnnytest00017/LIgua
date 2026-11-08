/* Safina AI core: providers, accounts, limit handling, conversation handoff, and the translation pipeline.
 *
 *   translation  =  machine translation draft (on-device Helsinki-NLP model or a translation API)
 *                   -> AI pass (fix mistakes, meaning in context, add diacritics) -> user
 *
 * No DOM in here. Everything the host supplies comes in through `deps` so this file runs in the
 * WebView (window.SafinaAI) and in Node tests (require).
 *
 *   deps.store      {get(key, default), set(key, value)}      persistence (localStorage in the app)
 *   deps.http       async ({url, method, headers, body}) -> {status, headers, text}
 *   deps.local      {ready(): bool, label(): string, chat({system, turns}): Promise<string>}   on-phone LLM
 *   deps.mt         {ready(src, tgt): bool, translate(text, src, tgt): Promise<string>}        on-phone translator
 *   deps.askLimit   async ({slot, reason, options}) -> option | null     asks the user what to do at a limit
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SafinaAI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ languages */
  const AR_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  const LANGS = {
    en: { name: 'English', tts: 'en-US', script: /[A-Za-z]/ },
    ar: { name: 'Arabic', rtl: true, tts: 'ar-SA', script: AR_RE, diac: 'tashkeel (harakat)', strip: /[ً-ٰٟـ]/g },
    he: { name: 'Hebrew', rtl: true, tts: 'he-IL', script: /[֐-׿]/, diac: 'niqqud', strip: /[֑-ׇ]/g },
    fa: { name: 'Persian', rtl: true, tts: 'fa-IR', script: AR_RE },
    ur: { name: 'Urdu', rtl: true, tts: 'ur-PK', script: AR_RE },
    tr: { name: 'Turkish', tts: 'tr-TR', script: /[A-Za-zÇĞİÖŞÜçğıöşü]/ },
    fr: { name: 'French', tts: 'fr-FR', script: /[A-Za-zÀ-ÿ]/ },
    es: { name: 'Spanish', tts: 'es-ES', script: /[A-Za-zÀ-ÿ]/ },
    de: { name: 'German', tts: 'de-DE', script: /[A-Za-zÄÖÜäöüß]/ },
    it: { name: 'Italian', tts: 'it-IT', script: /[A-Za-zÀ-ÿ]/ },
    pt: { name: 'Portuguese', tts: 'pt-PT', script: /[A-Za-zÀ-ÿ]/ },
    ru: { name: 'Russian', tts: 'ru-RU', script: /[Ѐ-ӿ]/ },
    hi: { name: 'Hindi', tts: 'hi-IN', script: /[ऀ-ॿ]/ },
    ja: { name: 'Japanese', tts: 'ja-JP', script: /[぀-ヿ一-鿿]/ },
    ko: { name: 'Korean', tts: 'ko-KR', script: /[가-힯ᄀ-ᇿ]/ },
    zh: { name: 'Chinese', tts: 'zh-CN', script: /[一-鿿]/ }
  };
  const langInfo = c => LANGS[c] || { name: String(c || '?'), tts: String(c || 'en'), script: /./ };
  const stripMarks = (s, lang) => { const L = LANGS[lang]; return L && L.strip ? String(s).replace(L.strip, '') : String(s); };
  const words = s => String(s || '').split(/\s+/).filter(Boolean);

  /* The AI may only ADD diacritics. If any word differs once marks are removed, throw its answer away. */
  function alignDiacritics(orig, dia, lang) {
    if (!dia || !LANGS[lang] || !LANGS[lang].strip) return '';
    const a = words(orig), b = words(dia);
    if (!a.length || a.length !== b.length) return '';
    for (let i = 0; i < a.length; i++) {
      if (stripMarks(a[i], lang).normalize('NFC') !== stripMarks(b[i], lang).normalize('NFC')) return '';
    }
    return b.join(' ');
  }

  /* ------------------------------------------------------------------ providers */
  const OPENAI_FMT = 'openai';
  const PROVIDERS = {
    anthropic:  { name: 'Claude',  fmt: 'anthropic', url: 'https://api.anthropic.com/v1/messages', modelsUrl: 'https://api.anthropic.com/v1/models',
                  suggest: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-fable-5-1'] },
    openai:     { name: 'ChatGPT', fmt: OPENAI_FMT, url: 'https://api.openai.com/v1/chat/completions', modelsUrl: 'https://api.openai.com/v1/models',
                  suggest: ['gpt-4o-mini', 'gpt-4o'] },
    gemini:     { name: 'Gemini',  fmt: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta',
                  suggest: ['gemini-2.5-flash', 'gemini-2.5-pro'] },
    xai:        { name: 'Grok',    fmt: OPENAI_FMT, url: 'https://api.x.ai/v1/chat/completions', modelsUrl: 'https://api.x.ai/v1/models',
                  suggest: ['grok-4', 'grok-3-mini'] },
    deepseek:   { name: 'DeepSeek', fmt: OPENAI_FMT, url: 'https://api.deepseek.com/chat/completions', modelsUrl: 'https://api.deepseek.com/models',
                  suggest: ['deepseek-chat'] },
    mistral:    { name: 'Mistral', fmt: OPENAI_FMT, url: 'https://api.mistral.ai/v1/chat/completions', modelsUrl: 'https://api.mistral.ai/v1/models',
                  suggest: ['mistral-small-latest', 'mistral-large-latest'] },
    groq:       { name: 'Groq',    fmt: OPENAI_FMT, url: 'https://api.groq.com/openai/v1/chat/completions', modelsUrl: 'https://api.groq.com/openai/v1/models',
                  suggest: ['llama-3.3-70b-versatile'] },
    openrouter: { name: 'OpenRouter', fmt: OPENAI_FMT, url: 'https://openrouter.ai/api/v1/chat/completions', modelsUrl: 'https://openrouter.ai/api/v1/models',
                  suggest: ['openrouter/auto'] },
    custom:     { name: 'Custom (OpenAI-compatible)', fmt: OPENAI_FMT, needsBase: true, suggest: [] },
    /* translation engines: only produce the draft, never chat */
    google_mt:  { name: 'Google Translate API', kind: 'mt', suggest: [] },
    deepl:      { name: 'DeepL API', kind: 'mt', suggest: [] }
  };
  const isMT = p => !!(PROVIDERS[p] && PROVIDERS[p].kind === 'mt');

  const flat = c => Array.isArray(c) ? c.map(x => (x && x.text) || '').join('') : String(c || '');
  const asTurns = messages => {
    const out = [];
    for (const m of messages || []) {
      if ((m.r || m.role) === 'sys') continue;          // notes such as "switched to Claude" are for the screen, not the AI
      const role = (m.r || m.role) === 'me' || (m.r || m.role) === 'user' ? 'user' : 'assistant';
      const text = String(m.t != null ? m.t : m.content != null ? m.content : '');
      if (!text.trim()) continue;
      if (out.length && out[out.length - 1].role === role) out[out.length - 1].text += '\n\n' + text;
      else out.push({ role, text });
    }
    while (out.length && out[0].role !== 'user') out.shift();
    return out;
  };

  function dataUrlParts(u) { const m = /^data:([^;]+);base64,(.*)$/.exec(u || ''); return m ? { mime: m[1], data: m[2] } : null; }

  const FORMATS = {
    openai: {
      build(P, acc, model, { system, turns, images }) {
        const msgs = system ? [{ role: 'system', content: system }] : [];
        turns.forEach((t, i) => {
          const last = i === turns.length - 1 && t.role === 'user';
          if (last && images && images.length) {
            msgs.push({ role: 'user', content: [{ type: 'text', text: t.text }].concat(images.map(u => ({ type: 'image_url', image_url: { url: u } }))) });
          } else msgs.push({ role: t.role, content: t.text });
        });
        const url = P.url || String(acc.base || '').replace(/\/+$/, '') + '/chat/completions';
        return { url, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + acc.key }, body: JSON.stringify({ model, messages: msgs }) };
      },
      parse: j => j && j.choices && j.choices[0] && j.choices[0].message ? flat(j.choices[0].message.content) : ''
    },
    anthropic: {
      build(P, acc, model, { system, turns, images }) {
        const msgs = turns.map((t, i) => {
          const last = i === turns.length - 1 && t.role === 'user';
          if (last && images && images.length) {
            const blocks = images.map(dataUrlParts).filter(Boolean).map(p => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } }));
            return { role: 'user', content: blocks.concat([{ type: 'text', text: t.text }]) };
          }
          return { role: t.role, content: t.text };
        });
        const body = { model, max_tokens: 2048, messages: msgs };
        if (system) body.system = system;
        return { url: P.url, headers: { 'content-type': 'application/json', 'x-api-key': acc.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) };
      },
      parse: j => j && Array.isArray(j.content) ? j.content.filter(b => b.type === 'text').map(b => b.text).join('') : ''
    },
    gemini: {
      build(P, acc, model, { system, turns, images }) {
        const contents = turns.map((t, i) => {
          const parts = [{ text: t.text }];
          if (i === turns.length - 1 && t.role === 'user' && images && images.length) {
            images.map(dataUrlParts).filter(Boolean).forEach(p => parts.push({ inlineData: { mimeType: p.mime, data: p.data } }));
          }
          return { role: t.role === 'user' ? 'user' : 'model', parts };
        });
        const body = { contents };
        if (system) body.systemInstruction = { parts: [{ text: system }] };
        return { url: P.base + '/models/' + encodeURIComponent(model) + ':generateContent', headers: { 'content-type': 'application/json', 'x-goog-api-key': acc.key }, body: JSON.stringify(body) };
      },
      parse: j => j && j.candidates && j.candidates[0] && j.candidates[0].content ? (j.candidates[0].content.parts || []).map(p => p.text || '').join('') : ''
    }
  };

  const decodeEntities = s => String(s).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;|&apos;/g, "'");
  const MT_ENGINES = {
    google_mt: {
      build: (acc, text, src, tgt) => ({ url: 'https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(acc.key), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: text, source: src, target: tgt, format: 'text' }) }),
      parse: j => j && j.data && j.data.translations && j.data.translations[0] ? decodeEntities(j.data.translations[0].translatedText) : ''
    },
    deepl: {
      build: (acc, text, src, tgt) => ({
        url: String(acc.key).endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate',
        headers: { 'content-type': 'application/json', authorization: 'DeepL-Auth-Key ' + acc.key },
        body: JSON.stringify({ text: [text], source_lang: src.toUpperCase(), target_lang: tgt === 'en' ? 'EN-US' : tgt === 'pt' ? 'PT-PT' : tgt.toUpperCase() })
      }),
      parse: j => j && j.translations && j.translations[0] ? j.translations[0].text : ''
    }
  };

  /* ------------------------------------------------------------------ errors */
  class AIError extends Error {
    constructor(kind, message, extra) { super(message); this.name = 'AIError'; this.kind = kind; if (extra) Object.assign(this, extra); }
  }
  /* kinds: limit | auth | overload | network | bad | empty | none */
  function classify(status, text, headers, now) {
    let msg = String(text || ''), code = '';
    try { const j = JSON.parse(text); const e = j.error || j; msg = e.message || j.message || msg; code = String(e.code || e.type || e.status || ''); } catch (_) { /* plain text */ }
    const low = (msg + ' ' + code).toLowerCase();
    const h = headers || {};
    const retry = parseFloat(h['retry-after'] || h['Retry-After']);
    const clip = String(msg).replace(/\s+/g, ' ').slice(0, 220);
    if (!status) return new AIError('network', 'No connection (' + clip + ')');
    const perMinute = /per.?minute|retry in|retry after|tokens per min|requests per min|rate.?limit/.test(low);
    const quota = /insufficient_quota|credit balance|billing|exceeded your current quota|out of credits|payment required|insufficient (funds|balance)|quota/.test(low);
    if ((status === 429 || status === 402 || status === 403 || status === 400) && quota && !perMinute) {
      return new AIError('limit', clip || 'Quota used up', { scope: 'account', until: now + 6 * 3600e3 });
    }
    if (status === 429 || /resource_exhausted|too many requests|rate.?limit/.test(low)) {
      return new AIError('limit', clip || 'Rate limit reached', { scope: 'model', until: now + (retry > 0 ? retry * 1000 : 60e3) });
    }
    if (status === 401 || status === 403 || (status < 500 && /api key|api_key|unauthor|permission_denied|invalid x-api-key|authentication/.test(low))) {
      return new AIError('auth', clip || 'The key was rejected');
    }
    if (status === 529 || status >= 500 || /overloaded|unavailable/.test(low)) return new AIError('overload', clip || 'The service is busy');
    return new AIError('bad', clip || ('HTTP ' + status), { status });
  }

  async function defaultHttp(req) {
    const r = await fetch(req.url, { method: req.method || 'POST', headers: req.headers, body: req.body });
    const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
    return { status: r.status, headers, text: await r.text() };
  }

  /* ------------------------------------------------------------------ helpers */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const memoryStore = () => { const m = {}; return { get: (k, d) => (k in m ? JSON.parse(m[k]) : d), set: (k, v) => { m[k] = JSON.stringify(v); } }; };
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const slotKey = s => s.accountId + '|' + s.model;
  const sameSlot = (a, b) => !!a && !!b && a.accountId === b.accountId && a.model === b.model;

  function parseLooseJSON(text) {
    let t = String(text || '').replace(/```(?:json)?/gi, '').trim();
    const tryParse = s => { try { return JSON.parse(s); } catch (_) { return undefined; } };
    let v = tryParse(t);
    if (v !== undefined) return v;
    const a = t.indexOf('['), o = t.indexOf('{');
    const pairs = [];
    if (a >= 0) pairs.push([a, t.lastIndexOf(']')]);
    if (o >= 0) pairs.push([o, t.lastIndexOf('}')]);
    pairs.sort((x, y) => x[0] - y[0]);
    for (const [s, e] of pairs) { if (e > s) { v = tryParse(t.slice(s, e + 1)); if (v !== undefined) return v; } }
    return undefined;
  }
  const cleanLine = s => String(s || '').trim().replace(/^["“”«»']+|["“”«»']+$/g, '').replace(/\s+/g, ' ').trim();

  /* ================================================================== the engine */
  function create(deps) {
    deps = deps || {};
    const store = deps.store || memoryStore();
    const http = deps.http || defaultHttp;
    const now = deps.now || Date.now;
    const listeners = {};
    const emit = (ev, data) => (listeners[ev] || []).forEach(f => { try { f(data); } catch (_) { /* listener bug must not break translation */ } });

    const DEFAULTS = { v: 1, accounts: [], active: null, autoSwitch: false, localOnLimit: true, logAI: true, mtMode: 'local', refine: true, lang: { learn: 'ar', native: 'en' }, limits: {}, invalid: {} };
    let S = Object.assign({}, DEFAULTS, store.get('safina.ai.v1', {}) || {});
    S.lang = Object.assign({}, DEFAULTS.lang, S.lang);
    S.accounts = S.accounts || []; S.limits = S.limits || {}; S.invalid = S.invalid || {};
    const save = () => { store.set('safina.ai.v1', S); emit('state', S); };

    /* ---------------- the AI log: every prompt and every reply, whole ----------------
     * One entry per attempt (a failed attempt and the fallback that answered are separate entries), newest last.
     * Kept on this phone only. Bounded so it cannot fill the storage: oldest entries go first. */
    const LOG_KEY = 'safina.ailog.v1', LOG_MAX = deps.logMax || 600, LOG_CHARS = deps.logChars || 1500000;
    let LOG = []; try { LOG = store.get(LOG_KEY, []) || []; if (!Array.isArray(LOG)) LOG = []; } catch (_) { LOG = []; }
    let logTimer = null;
    const logSize = () => LOG.reduce((n, e) => n + (e.system || '').length + (e.prompt || '').length + (e.reply || '').length + (e.error || '').length + 120, 0);
    function logFlush() { clearTimeout(logTimer); logTimer = null; try { store.set(LOG_KEY, LOG); } catch (_) { LOG = LOG.slice(Math.floor(LOG.length / 2)); try { store.set(LOG_KEY, LOG); } catch (__) { /* storage full: keep in memory */ } } }
    function logAdd(e) {
      if (S.logAI === false) return;
      LOG.push(e);
      while (LOG.length > LOG_MAX || (LOG.length > 1 && logSize() > LOG_CHARS)) LOG.shift();
      if (!logTimer) { logTimer = setTimeout(logFlush, 400); if (logTimer && logTimer.unref) logTimer.unref(); }
      emit('log', LOG.length);
    }
    const msgText = m => String(m.t != null ? m.t : m.text != null ? m.text : m.content != null ? m.content : '');
    const logApi = {
      list: () => LOG.slice(),
      count: () => LOG.length,
      size: logSize,
      clear: () => { LOG = []; logFlush(); emit('log', 0); },
      /* everything, as JSON, to save or send */
      exportJSON: () => JSON.stringify({ app: 'Safina', what: 'Every prompt sent to an AI and every reply, whole', exported: new Date(now()).toISOString(), count: LOG.length, entries: LOG }, null, 2),
      /* the same, written to be read by a person */
      exportText: () => LOG.map((e, i) => '=== #' + (i + 1) + '  ' + new Date(e.at).toISOString() + '  ' + (e.purpose || 'chat') + '  via ' + e.via + '  ' + (e.ok ? 'OK' : 'FAILED') + '  ' + e.ms + ' ms\n' +
        (e.system ? '--- system ---\n' + e.system + '\n' : '') + '--- prompt ---\n' + e.prompt + '\n' + (e.ok ? '--- reply ---\n' + e.reply : '--- error ---\n' + e.error) + '\n').join('\n')
    };

    /* ---------------- accounts ---------------- */
    const P = id => PROVIDERS[id] || null;
    const acct = id => S.accounts.find(a => a.id === id) || null;
    function addAccount(o) {
      const prov = P(o.provider);
      if (!prov) throw new Error('Unknown provider ' + o.provider);
      const a = { id: 'a' + rid(), provider: o.provider, label: (o.label || prov.name).trim(), key: String(o.key || '').trim(), model: o.model || (prov.suggest[0] || ''), models: prov.suggest.slice(), enabled: true, base: o.base || '' };
      S.accounts.push(a); softReset(); save(); return a.id;
    }
    function updateAccount(id, patch) {
      const a = acct(id); if (!a) return;
      Object.assign(a, patch);
      if (patch.key !== undefined) delete S.invalid[id];
      softReset(); save();
    }
    function removeAccount(id) {
      S.accounts = S.accounts.filter(a => a.id !== id);
      delete S.invalid[id];
      Object.keys(S.limits).forEach(k => { if (k.split('|')[0] === id) delete S.limits[k]; });
      if (S.active && S.active.accountId === id) S.active = null;
      softReset(); save();
    }
    function moveAccount(id, dir) {
      const i = S.accounts.findIndex(a => a.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= S.accounts.length) return;
      const [a] = S.accounts.splice(i, 1); S.accounts.splice(j, 0, a); save();
    }
    function setOption(k, v) { S[k] = v; if (k === 'refine' || k === 'mtMode' || k === 'lang') softReset(); save(); }

    /* ---------------- limits / validity ---------------- */
    function limitOf(accId, model) {
      const t = now();
      for (const k of [accId, accId + '|' + model]) {
        const l = S.limits[k];
        if (l && l.until > t) return l;
        if (l && l.until <= t) delete S.limits[k];
      }
      return null;
    }
    function markLimit(slot, e) {
      const key = e.scope === 'account' ? slot.accountId : slot.accountId + '|' + slot.model;
      S.limits[key] = { until: e.until || now() + 60e3, scope: e.scope, reason: e.message };
      save(); emit('limit', { slot: describe(slot), reason: e.message });
    }
    function markInvalid(slot) { S.invalid[slot.accountId] = true; save(); emit('auth', { slot: describe(slot) }); }
    const localReady = () => !!(deps.local && deps.local.ready && deps.local.ready());
    const LOCAL = { accountId: 'local', model: 'local' };

    function usable(slot) {
      if (!slot) return false;
      if (slot.accountId === 'local') return localReady();
      const a = acct(slot.accountId);
      if (!a || isMT(a.provider) || !a.enabled || S.invalid[a.id]) return false;
      if (!a.key && !(P(a.provider).needsBase && a.base)) return false;
      return !limitOf(a.id, slot.model);
    }
    function describe(slot) {
      if (!slot) return '';
      if (slot.accountId === 'local') return (deps.local && deps.local.label && deps.local.label()) || 'On-phone AI';
      const a = acct(slot.accountId);
      return a ? P(a.provider).name + ' · ' + a.label + ' · ' + slot.model : '(removed account)';
    }
    const via = slot => {
      if (slot.accountId === 'local') return { accountId: 'local', provider: 'local', model: 'local', label: describe(slot) };
      const a = acct(slot.accountId);
      return { accountId: a.id, provider: a.provider, model: slot.model, label: describe(slot) };
    };
    const chatAccounts = () => S.accounts.filter(a => !isMT(a.provider));
    function defaultSlots() {
      const out = chatAccounts().map(a => ({ accountId: a.id, model: a.model })).filter(usable);
      if (localReady()) out.push(LOCAL);
      return out;
    }
    function resolveActive() {
      /* Switched to the on-phone AI only because a limit ran out: go back as soon as the limit has reset. */
      if (S.returnTo && S.active && S.active.accountId === 'local' && usable(S.returnTo)) { S.active = S.returnTo; S.returnTo = null; save(); }
      if (S.active && usable(S.active)) return S.active;
      return defaultSlots()[0] || null;
    }
    function setActive(slot) { S.active = slot; softReset(); save(); }
    const aiAvailable = () => !!resolveActive();

    /* Which AI for which job.  heavy = rare, demanding jobs (judging a batch of sentences, writing flashcards, conjugation drills):
     * the powerful API account first, the on-phone model only if no API account is usable.
     * light = frequent small jobs (explaining a mistake, a quick hint): the free on-phone model first, so the limited API is saved.
     * The chosen slot is not remembered as "the active AI", so background work never changes what the user picked. */
    function orderedSlots(tier) {
      const all = defaultSlots();
      let cloud = all.filter(s => s.accountId !== 'local');
      if (S.active && S.active.accountId !== 'local') cloud = cloud.slice().sort((a, b) => (sameSlot(b, S.active) ? 1 : 0) - (sameSlot(a, S.active) ? 1 : 0));
      const local = localReady() ? [LOCAL] : [];
      return tier === 'light' ? local.concat(cloud) : cloud.concat(local);
    }
    const pick = tier => orderedSlots(tier)[0] || null;

    /* all slots for pickers: every account x its known models, plus the local model */
    function listSlots() {
      const out = [];
      chatAccounts().forEach(a => {
        const models = Array.from(new Set([a.model].concat(a.models || []))).filter(Boolean);
        models.forEach(m => { const s = { accountId: a.id, model: m }; out.push({ slot: s, label: describe(s), provider: a.provider, account: a.label, model: m, usable: usable(s), limit: limitOf(a.id, m) }); });
      });
      out.push({ slot: LOCAL, label: describe(LOCAL), provider: 'local', account: 'This phone', model: 'local', usable: localReady(), limit: null });
      return out;
    }

    /* ---------------- calling a provider ---------------- */
    function budgetFor(slot) { return slot.accountId === 'local' ? 5000 : 60000; }
    function trimTurns(turns, budget) {
      const kept = []; let used = 0;
      for (let i = turns.length - 1; i >= 0; i--) {
        const len = turns[i].text.length;
        if (kept.length && used + len > budget) break;
        kept.unshift(turns[i]); used += len;
      }
      while (kept.length && kept[0].role !== 'user') kept.shift();
      const dropped = turns.length - kept.length;
      return { turns: kept, dropped };
    }

    async function callSlot(slot, o) {
      let { turns, dropped } = trimTurns(asTurns(o.messages), budgetFor(slot));
      let system = o.system || '';
      if (dropped > 0) system += (system ? '\n\n' : '') + '(Note: ' + dropped + ' earlier message(s) of this conversation were left out to fit the context window.)';
      if (!turns.length) throw new AIError('bad', 'Nothing to send');
      if (slot.accountId === 'local') {
        try {
          const text = await deps.local.chat({ system, turns, signal: o.signal });
          if (!String(text || '').trim()) throw new AIError('empty', 'The on-phone model returned nothing');
          return String(text).trim();
        } catch (e) { if (e instanceof AIError) throw e; throw new AIError('bad', 'On-phone AI failed: ' + (e && e.message ? e.message : e)); }
      }
      const a = acct(slot.accountId), prov = P(a.provider), fmt = FORMATS[prov.fmt];
      const req = fmt.build(prov, a, slot.model, { system, turns, images: o.images });
      let res;
      try { res = await http(Object.assign({ method: 'POST' }, req)); }
      catch (e) { throw new AIError('network', 'No connection (' + (e && e.message ? e.message : e) + ')'); }
      if (res.status < 200 || res.status >= 300) throw classify(res.status, res.text, res.headers, now());
      let j; try { j = JSON.parse(res.text); } catch (_) { throw new AIError('bad', 'The reply was not readable'); }
      const text = fmt.parse(j);
      if (!String(text || '').trim()) throw new AIError('empty', 'The AI returned an empty reply');
      return String(text).trim();
    }

    /* ---------------- limit handling ---------------- */
    function limitOptions(slot, err, tried) {
      const a = acct(slot.accountId), opts = [], seen = new Set(tried);
      const add = (o) => { if (!seen.has(slotKey(o.slot)) && usable(o.slot)) { seen.add(slotKey(o.slot)); opts.push(o); } };
      if (a) {
        chatAccounts().filter(b => b.provider === a.provider && b.id !== a.id).forEach(b =>
          add({ id: 'acct:' + b.id, kind: 'account', label: 'Same model (' + slot.model + '), other account: ' + b.label, slot: { accountId: b.id, model: slot.model } }));
        if (err.scope !== 'account') {
          (a.models || []).filter(m => m !== slot.model).slice(0, 4).forEach(m =>
            add({ id: 'model:' + m, kind: 'model', label: 'Different model on the same account: ' + m, slot: { accountId: a.id, model: m } }));
        }
        const done = new Set([a.provider]);
        chatAccounts().forEach(b => {
          if (done.has(b.provider)) return;
          const s = { accountId: b.id, model: b.model };
          if (usable(s) && !seen.has(slotKey(s))) { done.add(b.provider); add({ id: 'prov:' + b.id, kind: 'provider', label: 'Another AI: ' + describe(s), slot: s }); }
        });
      } else {
        defaultSlots().filter(s => s.accountId !== 'local').forEach(s => add({ id: 'any:' + slotKey(s), kind: 'provider', label: describe(s), slot: s }));
      }
      add({ id: 'local', kind: 'local', label: 'On-phone AI (free, works offline): ' + describe(LOCAL), slot: LOCAL });
      return opts;
    }
    const pending = {};
    async function onLimit(slot, err, tried) {
      if (S.active && !sameSlot(S.active, slot) && usable(S.active) && !tried.has(slotKey(S.active))) return S.active; // someone already chose
      /* The powerful AI is used up: carry on with the free on-phone AI without interrupting the learner. */
      if (S.localOnLimit !== false && slot.accountId !== 'local' && usable(LOCAL) && !tried.has(slotKey(LOCAL))) { if (!S.returnTo) S.returnTo = slot; return LOCAL; }
      const opts = limitOptions(slot, err, tried);
      if (!opts.length) throw new AIError('limit', 'Limit reached on ' + describe(slot) + ' (' + err.message + '). No other AI is set up: add an account or download the on-phone AI in AI settings.', { final: true });
      if (S.autoSwitch || !deps.askLimit) return opts[0].slot;
      const k = slot.accountId;
      if (!pending[k]) pending[k] = Promise.resolve(deps.askLimit({ slot: describe(slot), reason: err.message, options: opts })).finally(() => { delete pending[k]; });
      const choice = await pending[k];
      if (!choice) throw new AIError('limit', 'Limit reached on ' + describe(slot) + ' and no other AI was chosen.', { declined: true });
      return choice.slot;
    }

    /* ---------------- chat (the tutor + anything else) ---------------- */
    async function chat(o) {
      const first = o.tier ? pick(o.tier) : resolveActive();
      let slot = first, retries = 0;
      const tried = new Set();
      const nextAuto = () => (o.tier ? orderedSlots(o.tier) : defaultSlots()).find(s => !tried.has(slotKey(s))) || null;
      for (let n = 0; n < 10; n++) {
        if (!slot) throw new AIError('none', 'No AI is available. Add an account or download the on-phone AI in AI settings.');
        tried.add(slotKey(slot));
        if (!usable(slot)) { slot = nextAuto(); continue; }
        try {
          emit('status', 'Asking ' + describe(slot) + '…');
          const t0 = now(), rec = { id: t0 + '-' + LOG.length, at: t0, purpose: o.purpose || 'chat', tier: o.tier || '', via: describe(slot), system: String(o.system || ''), prompt: (o.messages || []).filter(m => (m.r || m.role) !== 'sys').map(m => (((m.r || m.role) === 'me' || (m.r || m.role) === 'user') ? 'USER: ' : 'AI: ') + msgText(m)).join('\n\n') + (o.images && o.images.length ? '\n[' + o.images.length + ' image(s) attached, not stored]' : '') };
          let text; try { text = await callSlot(slot, o); } catch (er) { logAdd(Object.assign(rec, { ok: false, ms: now() - t0, reply: '', error: (er && er.kind ? er.kind + ': ' : '') + (er && er.message || er) })); throw er; }
          logAdd(Object.assign(rec, { ok: true, ms: now() - t0, reply: text, error: '' }));
          if (!o.tier && !sameSlot(slot, S.active)) { S.active = slot; save(); }
          emit('status', '');
          return { text, via: via(slot), switched: !o.tier && first && !sameSlot(first, slot) ? { from: describe(first), to: describe(slot) } : null };
        } catch (e) {
          if (!(e instanceof AIError) || (o.signal && o.signal.aborted)) throw e;
          if (e.kind === 'limit') { markLimit(slot, e); slot = o.quiet ? nextAuto() : await onLimit(slot, e, tried); continue; }   // quiet = background job: fall back without asking
          if (e.kind === 'auth') { markInvalid(slot); slot = nextAuto(); continue; }
          if ((e.kind === 'overload' || e.kind === 'network') && retries < 1) { retries++; await sleep(deps.retryDelay != null ? deps.retryDelay : 900); tried.delete(slotKey(slot)); continue; }
          if (e.kind === 'overload' || e.kind === 'network' || e.kind === 'empty' || (e.kind === 'bad' && /model|not found|does not exist|unsupported/i.test(e.message))) { slot = nextAuto(); continue; }
          throw e;
        }
      }
      throw new AIError('none', 'Every available AI failed.');
    }

    async function testAccount(id) {
      const a = acct(id); if (!a) throw new Error('No such account');
      if (isMT(a.provider)) {
        const t = await mtViaAccount(a, 'مرحبا', 'ar', 'en');
        return 'Translated a test word: ' + t;
      }
      const slot = { accountId: id, model: a.model };
      delete S.invalid[id];
      const text = await callSlot(slot, { messages: [{ r: 'me', t: 'Reply with the single word: OK' }], system: 'You are a connection test.' });
      return text.slice(0, 40);
    }

    async function refreshModels(id) {
      const a = acct(id), prov = a && P(a.provider);
      if (!a || !prov) throw new Error('No such account');
      let url, headers = {};
      if (prov.fmt === 'gemini') { url = prov.base + '/models?pageSize=200'; headers = { 'x-goog-api-key': a.key }; }
      else if (prov.fmt === 'anthropic') { url = prov.modelsUrl + '?limit=100'; headers = { 'x-api-key': a.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }; }
      else { url = prov.modelsUrl || (String(a.base || '').replace(/\/+$/, '') + '/models'); headers = { authorization: 'Bearer ' + a.key }; }
      const res = await http({ url, method: 'GET', headers });
      if (res.status < 200 || res.status >= 300) throw classify(res.status, res.text, res.headers, now());
      const j = JSON.parse(res.text);
      let ids = [];
      if (prov.fmt === 'gemini') ids = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => String(m.name).replace(/^models\//, ''));
      else ids = (j.data || []).map(m => m.id);
      ids = ids.filter(Boolean).filter(m => !/embed|whisper|tts|dall-e|moderation|image|audio|realtime/i.test(m)).sort();
      if (!ids.length) throw new Error('The provider returned no models');
      a.models = ids;
      if (!ids.includes(a.model)) a.model = ids[0];
      save();
      return ids;
    }

    /* ================================================================== translation pipeline */
    const lang = () => S.lang;
    const cacheKey = (kind, src, tgt, text, extra) => kind + '|' + src + '>' + tgt + '|' + text + (extra ? '|' + extra : '');
    let tcache = store.get('safina.tcache.v1', {}) || {};
    let tcacheTimer = null;
    const soft = new Map();          // session-only results that were NOT refined (retry when settings change)
    const inflight = new Map();
    function softReset() { soft.clear(); }
    function cachePut(key, val) {
      tcache[key] = val;
      const ks = Object.keys(tcache);
      if (ks.length > 4000) ks.slice(0, 500).forEach(k => delete tcache[k]);
      clearTimeout(tcacheTimer);
      tcacheTimer = setTimeout(flush, 600);
    }
    function flush() { logFlush(); clearTimeout(tcacheTimer); try { store.set('safina.tcache.v1', tcache); } catch (_) { tcache = {}; } }
    function clearCache() { tcache = {}; soft.clear(); flush(); }

    /* --- stage 1: the machine-translation draft --- */
    async function mtViaAccount(a, text, src, tgt) {
      const eng = MT_ENGINES[a.provider];
      let res;
      try { res = await http(Object.assign({ method: 'POST' }, eng.build(a, text, src, tgt))); }
      catch (e) { throw new AIError('network', 'No connection (' + e.message + ')'); }
      if (res.status < 200 || res.status >= 300) throw classify(res.status, res.text, res.headers, now());
      const out = eng.parse(JSON.parse(res.text));
      if (!out) throw new AIError('empty', 'Empty translation');
      return out;
    }
    const mtAccounts = () => S.accounts.filter(a => isMT(a.provider) && a.enabled && a.key && !S.invalid[a.id] && !limitOf(a.id, a.model));
    async function viaMtApi(text, src, tgt) {
      for (const a of mtAccounts()) {
        try { return { text: await mtViaAccount(a, text, src, tgt), engine: P(a.provider).name + ' · ' + a.label }; }
        catch (e) { if (e.kind === 'limit') markLimit({ accountId: a.id, model: a.model }, e); else if (e.kind === 'auth') markInvalid({ accountId: a.id, model: a.model }); }
      }
      return null;
    }
    async function viaLocalMt(text, src, tgt) {
      if (!(deps.mt && deps.mt.ready && deps.mt.ready(src, tgt))) return null;
      try { const t = await deps.mt.translate(text, src, tgt); return t ? { text: t, engine: 'On-phone translator (' + src + '→' + tgt + ')' } : null; }
      catch (e) { emit('mt-error', e); return null; }
    }
    async function mtDraft(text, src, tgt) {
      const mode = S.mtMode;
      if (mode === 'ai') return null;
      const order = mode === 'api' ? [viaMtApi, viaLocalMt] : [viaLocalMt, viaMtApi];
      for (const f of order) { const r = await f(text, src, tgt); if (r) return r; }
      return null;
    }

    /* --- stage 2: the AI pass --- */
    const sysFor = (src, tgt, extra) => {
      const L = langInfo(src), T = langInfo(tgt);
      return 'You are a careful subtitle translator and language tutor for a learner whose own language is ' + T.name + ' and who is learning ' + L.name + '. ' +
        'Translate ' + L.name + ' into natural, accurate ' + T.name + ', the way a native speaker would say it, keeping the speaker\'s tone. ' +
        'Dialect, slang and idioms are common in subtitles: translate what is meant, not word for word. ' + (extra || '');
    };
    const wantDia = src => !!(LANGS[src] && LANGS[src].diac);
    const diaRule = src => wantDia(src) ? ('"source_diacritized": the source text with full ' + LANGS[src].diac + ' added. Same words, same order, nothing added, removed or respelled. ') : '';
    const validTranslation = (t, tgt) => {
      if (!t) return false;
      const L = LANGS[tgt]; if (!L || !L.script) return true;
      const letters = (t.match(/\p{L}/gu) || []).length; if (!letters) return false;
      const own = (t.match(new RegExp(L.script.source, 'g')) || []).length;
      return own / letters > 0.5;
    };

    function applyItem(it, text, draft, src, tgt, slotVia) {
      const tr = cleanLine(it && (it.translation || it.t));
      if (!validTranslation(tr, tgt)) return null;
      const dia = wantDia(src) ? alignDiacritics(text, cleanLine(it.source_diacritized || it.diacritized || it.d), src) : '';
      return { t: tr, d: dia, m: String(it.meaning || it.m || '').trim().slice(0, 300), refined: true, via: slotVia, draft: draft ? draft.text : '' };
    }

    async function refineOne(text, draft, src, tgt, ctx, signal) {
      const near = ctx ? [].concat((ctx.prev || []).map(s => 'Before: ' + s), (ctx.next || []).map(s => 'After: ' + s)).join('\n') : '';
      const user = 'Source line (' + langInfo(src).name + '): ' + text + '\n' +
        (draft ? 'Machine translation draft (may contain mistakes): ' + draft.text + '\n' : '') +
        (near ? 'Nearby lines for context:\n' + near + '\n' : '') +
        '\nReturn ONLY a JSON object with these keys: "translation": the corrected ' + langInfo(tgt).name + ' translation. ' + diaRule(src) +
        '"meaning": one short sentence explaining the meaning in context, ONLY if the line is an idiom, dialect, wordplay or ambiguous, otherwise an empty string.';
      const r = await chat({ system: sysFor(src, tgt), messages: [{ r: 'me', t: user }], signal, purpose: 'translate-line' });
      let obj = parseLooseJSON(r.text);
      if (obj && !Array.isArray(obj)) { const out = applyItem(obj, text, draft, src, tgt, r.via); if (out) return out; }
      const plain = cleanLine(String(r.text).split('\n')[0]);          // small models often ignore the JSON request
      if (validTranslation(plain, tgt) && !/^[{\[]/.test(plain)) return { t: plain, d: '', m: '', refined: true, via: r.via, draft: draft ? draft.text : '' };
      return null;
    }

    async function refineBatch(items, src, tgt) {
      const payload = items.map((x, i) => ({ i, src: x.text, draft: x.draft ? x.draft.text : undefined }));
      const user = 'Translate these ' + langInfo(src).name + ' subtitle lines (they are consecutive lines of one scene).\n' + JSON.stringify(payload) +
        '\n\nReturn ONLY a JSON array with one object per line, same "i": {"i": number, "translation": corrected ' + langInfo(tgt).name + ' translation, ' +
        diaRule(src).replace(/"source_diacritized"/, '"source_diacritized"') + '"meaning": short sentence ONLY for idioms/dialect/ambiguity, otherwise ""}.';
      const r = await chat({ system: sysFor(src, tgt), messages: [{ r: 'me', t: user }], purpose: 'translate-batch' });
      const arr = parseLooseJSON(r.text);
      const out = new Array(items.length).fill(null);
      if (Array.isArray(arr)) arr.forEach(o => { const i = o && +o.i; if (i >= 0 && i < items.length) out[i] = applyItem(o, items[i].text, items[i].draft, src, tgt, r.via); });
      return out;
    }

    function unrefined(draft) { return { t: cleanLine(draft.text), d: '', m: '', refined: false, via: { label: draft.engine }, draft: draft.text }; }

    async function translateLine(text, opts) {
      opts = opts || {};
      const src = opts.src || S.lang.learn, tgt = opts.tgt || S.lang.native;
      text = String(text || '').trim();
      if (!text) return { t: '', d: '', m: '', refined: true };
      const key = cacheKey('l', src, tgt, text);
      if (tcache[key]) return tcache[key];
      if (soft.has(key)) return soft.get(key);
      if (inflight.has(key)) { try { return await inflight.get(key); } catch (_) { /* fall through to a direct attempt */ } }
      const p = (async () => {
        const draft = await mtDraft(text, src, tgt);
        let out = null, failure = null;
        if (S.refine && aiAvailable()) {
          try { out = await refineOne(text, draft, src, tgt, opts.ctx, opts.signal); }
          catch (e) { failure = e; }
        }
        if (out) { cachePut(key, out); return out; }
        if (draft) { const u = unrefined(draft); soft.set(key, u); return u; }
        if (failure) throw failure;
        throw new AIError('none', 'No translator is available. Add an AI account, add a translation API key, or download the translator for ' + langInfo(src).name + ' in AI settings.');
      })();
      inflight.set(key, p);
      p.catch(() => {}).then(() => { if (inflight.get(key) === p) inflight.delete(key); });
      return p;
    }

    /* Translate upcoming subtitle lines in one request, so a limited API is not hit once per line. */
    function prefetch(list, opts) {
      opts = opts || {};
      const src = opts.src || S.lang.learn, tgt = opts.tgt || S.lang.native;
      const useAI = S.refine && aiAvailable();
      const max = opts.max || (useAI ? 10 : 2);
      const todo = [];
      for (const raw of list) {
        const text = String(raw || '').trim(); if (!text) continue;
        const key = cacheKey('l', src, tgt, text);
        if (tcache[key] || soft.has(key) || inflight.has(key) || todo.some(x => x.key === key)) continue;
        todo.push({ key, text });
        if (todo.length >= max) break;
      }
      if (!todo.length) return Promise.resolve();
      todo.forEach(x => { x.d = {}; x.d.promise = new Promise((res, rej) => { x.d.resolve = res; x.d.reject = rej; }); x.d.promise.catch(() => {}); inflight.set(x.key, x.d.promise); });
      return (async () => {
        try {
          for (const x of todo) x.draft = await mtDraft(x.text, src, tgt);
          let results = new Array(todo.length).fill(null);
          if (useAI) { try { results = await refineBatch(todo, src, tgt); } catch (_) { /* fall back to drafts */ } }
          todo.forEach((x, i) => {
            const r = results[i];
            if (r) { cachePut(x.key, r); x.d.resolve(r); }
            else if (x.draft) { const u = unrefined(x.draft); soft.set(x.key, u); x.d.resolve(u); }
            else x.d.reject(new AIError('none', 'No translation available'));
          });
        } catch (e) { todo.forEach(x => x.d.reject(e)); }
        finally { todo.forEach(x => { if (inflight.get(x.key) === x.d.promise) inflight.delete(x.key); }); }
      })();
    }

    /* One word, in the sentence it was tapped in: meaning in context + diacritics + part of speech. */
    async function lookupWord(word, sentence, opts) {
      opts = opts || {};
      const src = opts.src || S.lang.learn, tgt = opts.tgt || S.lang.native;
      word = String(word || '').trim(); sentence = String(sentence || '').trim();
      if (!word) return { gloss: '', d: '', refined: true };
      const key = cacheKey('w', src, tgt, word, sentence);
      if (tcache[key]) return tcache[key];
      if (soft.has(key)) return soft.get(key);
      let sentTr = '';
      if (sentence) { const k2 = cacheKey('l', src, tgt, sentence); if (tcache[k2]) sentTr = tcache[k2].t; }
      let out = null, failure = null;
      if (S.refine && aiAvailable()) {
        const user = 'Word: ' + word + '\n' + (sentence ? 'It was tapped in this sentence (' + langInfo(src).name + '): ' + sentence + '\n' : '') + (sentTr ? 'Sentence translation: ' + sentTr + '\n' : '') +
          '\nReturn ONLY a JSON object: "gloss": the meaning of THIS word as used in this sentence, 1 to 5 words in ' + langInfo(tgt).name + ' (for a verb use the infinitive of its meaning here). ' +
          (wantDia(src) ? '"diacritized": the word with full ' + LANGS[src].diac + ' as pronounced here. ' : '') +
          '"lemma": the dictionary form of this word in ' + langInfo(src).name + ' (without the clitics or inflection attached here). "pos": part of speech. "root": the root if the language has one, else "". "note": one short sentence of useful context (dialect, idiom, grammar) or "".';
        try {
          const r = await chat({ system: sysFor(src, tgt), messages: [{ r: 'me', t: user }], purpose: 'word-lookup' });
          const o = parseLooseJSON(r.text);
          if (o && !Array.isArray(o) && cleanLine(o.gloss)) {
            out = { gloss: cleanLine(o.gloss), lemma: cleanLine(o.lemma) || word, d: wantDia(src) ? alignDiacritics(word, cleanLine(o.diacritized), src) : '', pos: String(o.pos || ''), root: String(o.root || ''), note: String(o.note || '').slice(0, 240), refined: true, via: r.via };
          } else { const plain = cleanLine(String(r.text).split('\n')[0]); if (plain && !/^[{\[]/.test(plain)) out = { gloss: plain, lemma: word, d: '', pos: '', root: '', note: '', refined: true, via: r.via }; }
        } catch (e) { failure = e; }
      }
      if (out) { cachePut(key, out); return out; }
      const draft = await mtDraft(word, src, tgt);
      if (draft) { const u = { gloss: cleanLine(draft.text), lemma: word, d: '', pos: '', root: '', note: '', refined: false, via: { label: draft.engine } }; soft.set(key, u); return u; }
      if (failure) throw failure;
      throw new AIError('none', 'No translator is available. Add an AI account or download the translator in AI settings.');
    }

    /* The tutor system prompt follows the language being learned. */
    function tutorSystem(extra) {
      const L = langInfo(S.lang.learn), N = langInfo(S.lang.native);
      const lv = deps.level ? String(deps.level() || '') : '';
      return 'You are a friendly ' + L.name + ' tutor for a ' + N.name + '-speaking ' + (lv ? 'learner at CEFR level ' + lv : 'beginner (A1)') + '. Answer simply in ' + N.name + ' with short ' + L.name + ' examples (add pronunciation in Latin letters when helpful' +
        (wantDia(S.lang.learn) ? ', and write ' + L.name + ' examples with ' + LANGS[S.lang.learn].diac : '') + '). ' + (extra || '');
    }

    return {
      PROVIDERS, LANGS, AIError,
      on(ev, f) { (listeners[ev] = listeners[ev] || []).push(f); },
      state: () => S, save, setOption, lang, langInfo,
      addAccount, updateAccount, removeAccount, moveAccount, refreshModels, testAccount,
      listSlots, setActive, active: resolveActive, describe, localReady, aiAvailable, usable, pick, isLocalSlot: s => !!s && s.accountId === 'local',
      chat, log: logApi, translateLine, prefetch, lookupWord, tutorSystem, clearCache, flush,
      cached: (text, o) => { o = o || {}; return tcache[cacheKey('l', o.src || S.lang.learn, o.tgt || S.lang.native, String(text || '').trim())] || null; }
    };
  }

  return { create, LANGS, PROVIDERS, AIError, classify, parseLooseJSON, alignDiacritics, stripMarks, asTurns, langInfo, isMT, AR_RE };
});
