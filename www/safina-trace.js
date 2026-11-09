/* Safina crash trace.
 * A crash that closes the whole app cannot be caught from JavaScript, so this keeps a small, always-saved note of what the app is
 * doing (heavy jobs: the on-phone AI, the on-phone translator, preparing a film). If the app closes while one of them is running,
 * the next start knows which one, switches that part off so the app cannot crash again the same way, and tells the person.
 * Loads before everything else. */
(function () {
  'use strict';
  const KEY = 'safina.trace.v1', SHOWN = 'safina.trace.shown';
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } }
  };
  const now = () => Date.now();
  let st; try { st = JSON.parse(ls.get(KEY) || 'null'); } catch (_) { st = null; }
  const prev = st && typeof st === 'object' ? st : null;
  const NAMES = { llm: 'the on-phone AI', mt: 'the on-phone translator', film: 'preparing a film in the background' };

  /* what was running when the last session ended without a clean exit */
  const crash = prev && prev.clean === false && Object.keys(prev.pending || {}).length ? { at: prev.at, pending: prev.pending, crumbs: prev.crumbs || [] } : null;
  const cur = { clean: false, at: now(), pending: {}, crumbs: crash ? crash.crumbs.slice(-40) : (prev && prev.crumbs || []).slice(-40) };
  const save = () => { cur.at = now(); ls.set(KEY, JSON.stringify(cur)); };
  const heap = () => { try { return Math.round(performance.memory.usedJSHeapSize / 1048576); } catch (_) { return undefined; } };

  function crumb(tag, info) {
    cur.crumbs.push({ t: now(), tag: String(tag).slice(0, 60), info: info == null ? undefined : String(info).slice(0, 160), heapMB: heap() });
    if (cur.crumbs.length > 60) cur.crumbs.splice(0, cur.crumbs.length - 60);
    save();
  }
  const guardKey = k => 'safina.guard.' + k;
  const guarded = k => ls.get(guardKey(k)) === '1';
  function unguard(k) { ls.del(guardKey(k)); if (k === 'film') ls.set('safina.film.bg', '1'); crumb('guard-off', k); }

  /* switch off whatever was running when the app closed */
  const switchedOff = [];
  if (crash) {
    Object.keys(crash.pending).forEach(k => { if (NAMES[k]) { ls.set(guardKey(k), '1'); if (k === 'film') ls.set('safina.film.bg', '0'); switchedOff.push(k); } });
  }
  cur.crumbs.push({ t: now(), tag: crash ? 'start-after-crash' : 'start', info: crash ? Object.keys(crash.pending).join(',') : undefined, heapMB: heap() });
  save();

  function begin(kind, label) { cur.pending[kind] = { label: label || kind, t: now() }; crumb('begin ' + kind, label); }
  function end(kind) { if (cur.pending[kind]) { delete cur.pending[kind]; crumb('end ' + kind); } }

  /* a clean exit: the page is being hidden or closed and nothing heavy is running */
  const settle = () => { if (!Object.keys(cur.pending).length) { cur.clean = true; save(); } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') settle(); else { cur.clean = false; save(); } });
  window.addEventListener('pagehide', settle);
  window.addEventListener('error', e => { crumb('js-error', (e && e.message) || ''); });
  window.addEventListener('unhandledrejection', e => { crumb('rejection', e && e.reason && (e.reason.message || e.reason)); });

  const report = () => 'Safina trace\n' + (crash ? 'Closed unexpectedly while: ' + Object.keys(crash.pending).map(k => NAMES[k] || k).join(', ') + '\n' : '') +
    'Device memory (GB): ' + (navigator.deviceMemory || '?') + ', cores: ' + (navigator.hardwareConcurrency || '?') + '\n' +
    cur.crumbs.map(c => new Date(c.t).toISOString().slice(11, 19) + ' ' + c.tag + (c.info ? ' ' + c.info : '') + (c.heapMB != null ? ' [' + c.heapMB + ' MB]' : '')).join('\n');

  window.SAFINA_TRACE = { begin, end, crumb, guarded, unguard, crash, switchedOff, report };

  /* tell the person, once */
  function banner() {
    if (!crash || ls.get(SHOWN) === String(crash.at)) return;
    ls.set(SHOWN, String(crash.at));
    const what = Object.keys(crash.pending).map(k => NAMES[k] || k).join(' and ');
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 12px);z-index:100010;background:#1d1d22;color:#fff;border:1px solid #ff293b;border-radius:14px;padding:14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    d.innerHTML = '<b style="font-size:15px">Safina closed unexpectedly last time</b><div style="opacity:.85;margin-top:4px">It was busy with ' + what + '. To keep it from happening again, ' + (switchedOff.length ? 'that part is now switched off (you can turn it back on in AI &amp; downloads).' : 'nothing was switched off.') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px"><button data-a="copy" style="flex:1;padding:9px;border-radius:10px;border:1px solid #444;background:#2a2a30;color:#fff">Copy details</button><button data-a="ok" style="flex:1;padding:9px;border-radius:10px;border:0;background:#ff293b;color:#fff;font-weight:600">OK</button></div><div id="tr-m" style="opacity:.7;margin-top:6px"></div>';
    d.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'ok') d.remove();
      else { try { await navigator.clipboard.writeText(report()); d.querySelector('#tr-m').textContent = 'Copied. Paste it to whoever is helping you fix it.'; } catch (_) { d.querySelector('#tr-m').textContent = 'Could not copy.'; } }
    });
    document.body.appendChild(d);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(banner, 800)); else setTimeout(banner, 800);
})();
