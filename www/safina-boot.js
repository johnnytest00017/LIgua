/* Creates the one shared engine (window.SAI) before the page's own script runs.
 * Network calls go through Capacitor's native HTTP when running in the app: that avoids the browser's CORS rules,
 * which some AI providers do not satisfy for a WebView. In a plain browser it falls back to fetch. */
(function () {
  'use strict';
  const store = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage full or blocked */ } }
  };

  async function http(req) {
    const C = window.Capacitor, H = C && C.Plugins && C.Plugins.CapacitorHttp;
    if (C && C.isNativePlatform && C.isNativePlatform() && H && H.request) {
      let data;
      if (req.body) { try { data = JSON.parse(req.body); } catch (_) { data = req.body; } }
      const r = await H.request({ url: req.url, method: req.method || 'POST', headers: req.headers || {}, data, responseType: 'text', connectTimeout: 20000, readTimeout: 90000 });
      return { status: r.status, headers: r.headers || {}, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) };
    }
    const res = await fetch(req.url, { method: req.method || 'POST', headers: req.headers, body: req.body });
    const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, headers, text: await res.text() };
  }

  /* "Show diacritics" preference, shared by the page and the settings sheet */
  window.SAFINA_SHOWDIA = function (v) {
    if (v === undefined) return store.get('safina.showdia', true) !== false;
    store.set('safina.showdia', !!v);
    window.dispatchEvent(new Event('safina-dia'));
    return !!v;
  };

  window.SAFINA_HTTP = http;     // the same transport, for the news feeds

  const M = window.SafinaModels;
  window.SAI = window.SafinaAI.create({
    store, http,
    local: M.local,
    mt: M.marian,
    level: () => (window.BRAIN ? window.BRAIN.level().level : ''),
    askLimit: o => (window.SafinaUI ? window.SafinaUI.askLimit(o) : Promise.resolve(null))
  });
  /* When the AI accounts or models change, films that were waiting for an AI can be prepared. */
  let aiTimer = null;
  try { window.SAI.on('state', () => { clearTimeout(aiTimer); aiTimer = setTimeout(() => window.dispatchEvent(new Event('safina-ai-changed')), 2500); }); } catch (_) { /* no events */ }
  /* The learner brain: watches what the learner does and has the AI (on-phone or API) judge it. */
  window.BRAIN = window.SafinaBrain.create({
    store, ai: window.SAI,
    parseJSON: window.SafinaAI.parseLooseJSON,
    ready: () => window.SAI.aiAvailable(),
    isLocal: tier => window.SAI.isLocalSlot(window.SAI.pick(tier || 'heavy') || window.SAI.active()),
    lang: () => { const l = window.SAI.lang(); return { learn: l.learn, native: l.native, learnName: window.SAI.langInfo(l.learn).name, nativeName: window.SAI.langInfo(l.native).name }; },
    addCards: c => (window.SAFINA_ADDCARDS ? window.SAFINA_ADDCARDS(c) : 0)
  });
  M.verify().catch(() => { /* not in the app, nothing to verify */ });
})();
