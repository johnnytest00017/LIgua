/* Safina: the top status bar (profile, language, streak, points) and the learning path.
 * "Start learning" opens a path of lessons. Lessons are grouped into units by where you met the words (the film or series),
 * with a unit at the top for words you are losing. Each lesson is a short run of exercises built from the AI's sentences.
 * The thinking stays in safina-brain.js; this file draws and collects answers. */
(function () {
  'use strict';
  const B = window.BRAIN, SAI = window.SAI;
  if (!B) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* storage blocked */ } };
  const toast = m => { try { (window.toast || (() => {}))(m); } catch (_) { /* ignore */ } };
  const learnLang = () => (SAI ? SAI.lang().learn : 'ar');
  const LESSON = 5;

  /* ------------------------------------------------------------------ points (XP) */
  const XP_KEY = 'safina.xp.v1';
  const today = () => new Date().toISOString().slice(0, 10);
  function xpState() { try { const o = JSON.parse(lsGet(XP_KEY, 'null')); if (o && typeof o.total === 'number') return o; } catch (_) { /* fresh */ } return { total: 0, days: {} }; }
  const XP = {
    total: () => xpState().total,
    today: () => xpState().days[today()] || 0,
    add(n) {
      n = Math.max(0, Math.round(n)); if (!n) return 0;
      const s = xpState(); s.total += n; s.days[today()] = (s.days[today()] || 0) + n;
      const keys = Object.keys(s.days).sort(); while (keys.length > 60) delete s.days[keys.shift()];
      lsSet(XP_KEY, JSON.stringify(s)); paintBar(); return n;
    }
  };

  /* ------------------------------------------------------------------ top bar */
  const css = document.createElement('style');
  css.textContent = 'header{display:flex;align-items:center;gap:10px}#sb{margin-left:auto;position:relative;display:flex;align-items:center;gap:18px;font:800 19px "Plus Jakarta Sans",system-ui,sans-serif;color:var(--tx)}' +
    '#sb button{display:inline-flex;align-items:center;gap:6px;border:0;background:none;color:inherit;font:inherit;padding:2px;cursor:pointer}#sb button:active{transform:scale(.94)}' +
    '#sb .lgb .fg{display:inline-flex;align-items:center;justify-content:center;width:36px;height:30px;border-radius:7px;background:transparent;border:0}#sb .ch{font-size:11px;opacity:.6;margin-left:-2px}' +
    '#sb .stk{gap:4px}#sb-m{display:none;position:absolute;right:0;top:calc(100% + 8px);z-index:99989;min-width:210px;max-height:60vh;overflow:auto;background:var(--card,#16161a);border:1px solid var(--ln,#2c2c34);border-radius:16px;padding:6px;box-shadow:0 12px 34px rgba(0,0,0,.55)}#sb-m.on{display:block}' +
    '#sb-m .mh{font:700 11px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;opacity:.55;padding:8px 10px 4px}#sb-m button{display:flex;width:100%;align-items:center;gap:10px;padding:9px 10px;border-radius:11px;font:600 15px system-ui,sans-serif;text-align:left}#sb-m button.cur{background:rgba(255,41,59,.14)}#sb-m button b{margin-left:auto;color:var(--ac,#ff293b)}#sb-m .fg{font-size:22px}' +
    '#lp{position:fixed;inset:0;z-index:99991;background:var(--bg,#0d0e11);color:var(--tx,#f3f1ed);display:none;flex-direction:column;font-family:var(--fb,Manrope,system-ui,sans-serif)}#lp.on{display:flex}' +
    '#lp .top{display:flex;align-items:center;gap:12px;padding:calc(env(safe-area-inset-top,0px) + 12px) 16px 8px}#lp .x{border:0!important;background:none!important;color:var(--mu);font-size:22px;padding:4px 8px}' +
    '#lp .lpb{flex:1;height:8px;border-radius:99px;background:var(--card2,#1e2025);overflow:hidden}#lp .lpb i{display:block;height:100%;width:0;background:var(--ac,#5fd3e6);border-radius:99px;transition:width .35s}' +
    '#lp .scroll{flex:1;overflow:auto;padding:4px 16px 30px;max-width:560px;width:100%;margin:0 auto}' +
    '#lp .ban{position:sticky;top:0;z-index:2;border-radius:18px;padding:14px 18px;background:var(--card,#16181c);border:1px solid var(--ln,#2a2d34);margin:14px 0 24px}#lp .ban small{display:block;color:var(--mu);font-weight:600;font-size:13px}#lp .ban b{font:700 21px/1.15 var(--fd,sans-serif);letter-spacing:-.01em}' +
    '#lp .nd{position:relative;display:flex;justify-content:center;margin:0 0 26px}#lp .nd button{position:relative;width:74px;height:74px;border-radius:50%;border:0;background:var(--tx,#f3f1ed);color:#0d0e11;font-size:26px;box-shadow:0 10px 24px rgba(0,0,0,.45);cursor:pointer}#lp .nd button:active{transform:scale(.94)}' +
    '#lp .nd.done button{background:var(--card2,#1e2025);color:var(--ok,#4ade9a);box-shadow:none;border:1px solid var(--ln,#2a2d34)}#lp .nd.idle button{background:var(--card,#16181c);color:var(--mu);box-shadow:none;border:1px solid var(--ln,#2a2d34)}' +
    '#lp .nd.cur button{background:var(--ac,#5fd3e6);color:var(--on-ac,#04222a)}#lp .nd.cur button::before{content:"";position:absolute;inset:-8px;border-radius:50%;border:2px solid var(--ac,#5fd3e6);opacity:.45}' +
    '#lp .pop{margin:-8px auto 26px;width:min(300px,100%);background:var(--card2,#1e2025);border:1px solid var(--ln,#2a2d34);border-radius:18px;padding:16px;text-align:left;position:relative}' +
    '#lp .pop b{font:700 19px/1.15 var(--fd,sans-serif);display:block}#lp .pop span{color:var(--mu);font-size:14px;font-weight:500}#lp .pop button{display:block;width:100%;margin-top:12px;padding:13px;border-radius:999px;border:0;background:var(--tx,#f3f1ed);color:#0d0e11;font:800 15px var(--fb,sans-serif)}' +
    '#lp .mu{color:var(--mu);font-size:13px}#lp .strip{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 6px}#lp .strip button{flex:1;min-width:112px;padding:11px 8px;font-size:13.5px;border-radius:999px;background:transparent}' +
    '#lp .q{font:700 26px/1.12 var(--fd,sans-serif);letter-spacing:-.02em;margin:16px 0 14px}' +
    '#lp .big{background:var(--card,#16181c);border:1px solid var(--ln,#2a2d34);border-radius:22px;padding:26px 14px;text-align:center;margin:8px 0 20px}' +
    '#lp .sent{font-size:30px;line-height:2;direction:rtl}#lp .sent .w{padding:2px 4px;border-radius:8px;cursor:pointer;background:none!important;color:inherit!important}#lp .sent .w.f{background:var(--ac,#5fd3e6)!important;color:var(--on-ac,#04222a)!important}#lp .sent .gap{display:inline-block;min-width:64px;border-bottom:3px solid var(--mu);border-radius:2px}#lp .sent .gap.fill{border-bottom-color:var(--ok,#4ade9a);color:var(--ok,#4ade9a)}' +
    '#lp .opts{display:flex;flex-direction:column;gap:10px}#lp .opts.row{flex-direction:row}#lp .o{flex:1;padding:16px 14px;border-radius:16px;border:1px solid var(--ln,#2a2d34);background:var(--card,#16181c);color:inherit;font:600 17px/1.35 var(--fb,sans-serif);text-align:left}#lp .opts.row .o{text-align:center}#lp .o:disabled{opacity:1}' +
    '#lp .o.sel{border-color:var(--ac,#5fd3e6);background:rgba(95,211,230,.1);box-shadow:inset 0 0 0 1px var(--ac,#5fd3e6)}#lp .o.ok{border-color:var(--ok,#4ade9a);background:rgba(74,222,154,.12);box-shadow:inset 0 0 0 1px var(--ok,#4ade9a)}#lp .o.no{border-color:var(--bad,#ff6b6b);background:rgba(255,107,107,.12);box-shadow:inset 0 0 0 1px var(--bad,#ff6b6b)}' +
    '#lp .gl{text-align:center;min-height:22px;font-size:14px;color:var(--mu);margin:-6px 0 10px}' +
    '#lp .foot{padding:16px 16px calc(env(safe-area-inset-bottom,0px) + 16px);width:100%;border-top:1px solid var(--ln,#2a2d34);background:var(--bg,#0d0e11)}#lp .foot>*{max-width:560px;margin-left:auto;margin-right:auto}#lp .foot.ok{background:#0f2219;border-top-color:rgba(74,222,154,.4)}#lp .foot.no{background:#271416;border-top-color:rgba(255,107,107,.4)}' +
    '#lp .foot b{display:block;font:700 22px/1.1 var(--fd,sans-serif);margin-bottom:2px}#lp .foot.ok b{color:var(--ok,#4ade9a)}#lp .foot.no b{color:var(--bad,#ff6b6b)}' +
    '#lp .go{width:100%;padding:16px;border-radius:999px;border:0;background:var(--tx,#f3f1ed);color:#0d0e11;font:800 16px var(--fb,sans-serif)}#lp .go:disabled{background:var(--card2,#1e2025);color:var(--mu)}#lp .foot.no .go{background:var(--bad,#ff6b6b);color:#2a0709}' +
    '#lp .dif{display:flex;gap:8px;margin-top:10px}#lp .dif button{flex:1;padding:14px 4px;border-radius:999px;font:800 15px var(--fb,sans-serif);background:transparent;border:1px solid var(--ln,#2a2d34)}#lp .dif button:nth-child(3){background:var(--tx,#f3f1ed);color:#0d0e11;border-color:var(--tx,#f3f1ed)}' +
    '#lp .end{text-align:center;padding:54px 6px 10px}#lp .end .ck{width:84px;height:84px;margin:0 auto;border-radius:50%;border:2px solid var(--ok,#4ade9a);color:var(--ok,#4ade9a);display:grid;place-items:center;font-size:38px}#lp .end h2{margin:18px 0 2px;font:700 32px/1.05 var(--fd,sans-serif);letter-spacing:-.02em}' +
    '#lp .tl{display:flex;gap:10px;justify-content:center;margin:30px 0 8px}#lp .tl div{flex:1;max-width:136px;border:1px solid var(--ln,#2a2d34);border-radius:18px;padding:14px 4px;background:var(--card,#16181c)}#lp .tl em{display:block;font:600 12px var(--fb,sans-serif);font-style:normal;color:var(--mu);margin-bottom:4px}#lp .tl b{display:block;font:700 24px/1.1 var(--fd,sans-serif)}' +
    '#lp .empty{text-align:center;padding:36px 10px}#lp .empty b{font:700 24px var(--fd,sans-serif);letter-spacing:-.01em;display:block}';
  
  css.textContent += '.flm{overflow:visible}.flm.on{filter:drop-shadow(0 3px 10px rgba(253,195,31,.35))}';
  document.head.appendChild(css);
  css.textContent += '#sb-pop{display:none;position:absolute;right:0;top:calc(100% + 8px);z-index:99989;width:min(340px,92vw);background:#121214;border:1px solid #2a2a30;border-radius:20px;padding:18px;box-shadow:0 16px 40px rgba(0,0,0,.65)}#sb-pop.on{display:block}' +
    '.stp{direction:ltr;text-align:left;color:#f2f2f4;font-family:system-ui,sans-serif}.stp .sth{display:flex;gap:16px;align-items:center}.stp .stt{font:800 22px system-ui,sans-serif;display:block}.stp .sts{color:#9a9aa3;font-size:14px;line-height:1.35;display:block;margin-top:4px}' +
    '.stp .stw{display:flex;justify-content:space-between;margin-top:16px}.stp .stw div{text-align:center}.stp .stw em{display:block;font:700 13px system-ui,sans-serif;font-style:normal;color:#6f6f78;margin-bottom:6px}.stp .stw .td em{color:#ffb81c}' +
    '.stp .stw i{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#26272b;color:#fff;font:800 16px system-ui,sans-serif;font-style:normal}.stp .stw .on i{background:#ff9a1f}' +
    '.stp.big{text-align:center}.stp.big .sth{flex-direction:column;gap:2px;margin-top:6px}.stp.big .stn{font:900 76px/1 system-ui,sans-serif;margin-top:6px}.stp.big .stt{color:#ffb81c;font-weight:900;font-size:20px;margin-top:4px}.stp.big .stw{margin-top:20px}' +
    '#streak-card{background:#121214!important;border:1px solid #2a2a30!important;color:#f2f2f4}';


  /* flat, straight (not waving) flags drawn as simple SVG rectangles, so they look the same on every phone */
  const R = (x, y, w, h, f) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + f + '"/>';
  const H3 = (a, b, c) => R(0, 0, 30, 7, a) + R(0, 7, 30, 6, b) + R(0, 13, 30, 7, c), V3 = (a, b, c) => R(0, 0, 10, 20, a) + R(10, 0, 10, 20, b) + R(20, 0, 10, 20, c);
  const FL = {
    en: R(0, 0, 30, 20, '#1d3a8a') + '<path d="M0 0L30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0L30 20M30 0L0 20" stroke="#d52b3a" stroke-width="1.4"/>' + R(12, 0, 6, 20, '#fff') + R(0, 7, 30, 6, '#fff') + R(13, 0, 4, 20, '#d52b3a') + R(0, 8, 30, 4, '#d52b3a'),
    ar: R(0, 0, 30, 20, '#1b7a3d') + R(7, 11, 16, 2, '#fff') + R(8, 7, 14, 2, '#fff'),
    he: R(0, 0, 30, 20, '#fff') + R(0, 2, 30, 3, '#2a5bb7') + R(0, 15, 30, 3, '#2a5bb7') + '<circle cx="15" cy="10" r="3.6" fill="none" stroke="#2a5bb7" stroke-width="1.2"/>',
    fa: H3('#2a9d4a', '#fff', '#d52b3a'), ur: R(0, 0, 30, 20, '#1b6b3a') + R(0, 0, 7, 20, '#fff'),
    tr: R(0, 0, 30, 20, '#d52b3a') + '<circle cx="13" cy="10" r="5" fill="#fff"/><circle cx="14.6" cy="10" r="4" fill="#d52b3a"/>',
    fr: V3('#2347a3', '#fff', '#d52b3a'), it: V3('#2a9d4a', '#fff', '#d52b3a'), es: R(0, 0, 30, 20, '#d52b3a') + R(0, 5, 30, 10, '#f4c21b'),
    de: H3('#222', '#d52b3a', '#f4c21b'), pt: R(0, 0, 30, 20, '#d52b3a') + R(0, 0, 12, 20, '#1b7a3d'), ru: H3('#fff', '#2347a3', '#d52b3a'),
    hi: H3('#f59a2e', '#fff', '#1b8a3d') + '<circle cx="15" cy="10" r="2" fill="none" stroke="#2347a3" stroke-width=".8"/>',
    ja: R(0, 0, 30, 20, '#fff') + '<circle cx="15" cy="10" r="5.4" fill="#d52b3a"/>', ko: R(0, 0, 30, 20, '#fff') + '<circle cx="15" cy="10" r="4.6" fill="#d52b3a"/><path d="M10.400 10a4.600 4.600 0 0 0 9.200 0z" fill="#2347a3"/>',
    zh: R(0, 0, 30, 20, '#d52b3a') + '<circle cx="6" cy="6" r="2.6" fill="#f4c21b"/>'
  };
  const flag = (c, w) => '<svg viewBox="0 0 30 20" width="' + (w || 30) + '" height="' + Math.round((w || 30) * 2 / 3) + '" style="border-radius:3px;display:block">' + (FL[c] || (R(0, 0, 30, 20, '#444') + '<text x="15" y="14" text-anchor="middle" font-size="10" fill="#fff" font-family="sans-serif">' + String(c).toUpperCase() + '</text>')) + '</svg>';
  /* streak flame: traced from the reference picture (soft yellow flame, cream drop, small spark); grey when the streak is 0 */
  const FL_BODY = "M230 105C227 106 223 107 220 108C217 110 213 112 210 114C207 116 204 119 201 122C198 124 195 127 191 130C188 133 185 136 182 138C179 141 176 144 173 146C169 149 166 151 163 153C160 155 156 157 153 158C149 159 146 160 142 160C138 161 135 161 131 161C127 161 123 161 120 161C116 161 112 161 109 161C106 162 102 162 99 163C96 164 93 166 91 168C88 170 86 172 84 175C83 178 81 181 80 185C79 189 78 193 77 197C77 201 76 205 76 209C76 214 75 218 75 223C75 227 75 232 75 236C75 241 75 245 75 250C75 254 75 259 75 263C75 268 75 272 75 277C75 281 75 286 75 291C75 295 75 300 75 304C75 309 75 313 75 318C75 322 76 327 76 331C76 336 76 340 77 344C77 349 78 353 78 357C79 362 80 366 81 370C82 374 83 378 84 382C85 386 87 390 88 394C90 398 92 401 93 405C95 409 97 412 99 416C102 419 104 423 106 426C109 430 111 433 114 436C116 439 119 442 122 445C124 448 127 451 130 454C133 456 136 459 140 462C143 464 146 466 150 468C153 471 157 473 160 474C164 476 168 478 171 479C175 481 179 482 183 483C187 485 191 486 196 486C200 487 204 488 208 489C212 489 217 490 221 490C225 490 230 490 234 490C238 490 243 490 247 490C251 489 256 489 260 488C264 488 268 487 272 486C277 485 281 484 285 483C289 481 293 480 296 478C300 477 304 475 308 473C311 471 315 469 318 467C322 464 325 462 328 459C332 457 335 454 338 451C341 448 344 445 347 442C349 439 352 436 355 433C357 429 360 426 362 422C365 419 367 415 369 412C371 408 373 404 375 401C377 397 378 393 380 389C381 385 383 381 384 377C385 373 386 369 387 365C388 361 389 357 389 352C390 348 390 344 391 340C391 335 391 331 391 327C391 322 391 318 390 314C390 309 390 305 389 301C388 297 387 292 386 288C385 284 384 280 383 276C381 272 380 268 378 265C377 261 375 257 373 253C371 249 369 246 367 242C365 239 362 235 360 232C358 228 355 225 353 221C350 218 347 214 345 211C342 207 339 204 337 201C334 197 331 194 329 191C326 187 323 184 321 180C318 177 315 174 312 170C310 167 307 164 304 160C301 157 299 153 296 150C293 147 290 143 287 140C285 137 282 133 279 130C276 127 273 124 270 121C267 119 264 116 260 114C257 111 254 109 250 108C247 107 244 105 240 105C237 104 233 105 230 105Z", FL_DROP = "M239 266C262 300 304 318 304 355A65 65 0 0 1 174 355C174 318 216 300 239 266Z";
  const flame = (on, sz) => { const w = sz || 26, id = 'sf' + w + (on ? 'a' : 'b'), st = on ? ['#fdeb7d', '#fee05a', '#fbc31a'] : ['#5a5b62', '#4b4c52', '#3b3c41'], d = on ? '#fef8d8' : '#27282c';
    return '<svg class="flm' + (on ? ' on' : '') + '" viewBox="60 5 345 495" width="' + w + '" height="' + Math.round(w * 495 / 345) + '"><defs><linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="0" y1="94" x2="0" y2="493"><stop offset="0" stop-color="' + st[0] + '"/><stop offset=".5" stop-color="' + st[1] + '"/><stop offset="1" stop-color="' + st[2] + '"/></linearGradient></defs>' +
      '<path fill="url(#' + id + ')" d="' + FL_BODY + '"/><path fill="' + d + '" d="' + FL_DROP + '"/>' + (on ? '<ellipse cx="82" cy="29" rx="13" ry="17" fill="#f5b13d" transform="rotate(-18 82 29)"/>' : '') + '</svg>'; };
  function mountBar() {
    const h = document.querySelector('body > header'); if (!h || $('sb')) return;
    const d = document.createElement('div'); d.id = 'sb';
    d.innerHTML = '<button class="lgb" data-sb="lang" aria-label="Language you are learning" aria-haspopup="listbox"><span class="fg" id="sb-f"></span><span class="ch">▾</span></button>' +
      '<button class="stk" data-sb="streak" aria-label="Day streak"><span id="sb-fl"></span><span id="sb-s">0</span></button><div id="sb-m" role="listbox"></div><div id="sb-pop"></div>';
    h.appendChild(d);
    d.addEventListener('click', e => {
      const o = e.target.closest('[data-pick]');
      if (o) { pickLang(o.dataset.pick); return; }
      const b = e.target.closest('[data-sb]');
      if (!b) return; const k = b.dataset.sb;
      if (k === 'lang') { closePop(); toggleMenu(); } else { closeMenu(); togglePop(); }
    });
    document.addEventListener('click', e => { if (!e.target.closest('#sb')) { closeMenu(); closePop(); } }, true);
    paintBar(); mountProfile();
  }
  /* ---- streak panel: used as a drop-down under the flame and as a section on the Profile page ---- */
  const DN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  function week() {
    let ser = []; try { ser = B.progress().series.slice(-7); } catch (_) { /* brain not ready */ }
    return ser.map(d => ({ n: DN[new Date(d.date + 'T12:00:00Z').getUTCDay()], on: ((d.watch || 0) > 30 || !!d.reviews || !!d.conj), today: d === ser[ser.length - 1] }));
  }
  function streakHtml(big) {
    const n = streak(), wk = week(), on = n > 0;
    return '<div class="stp' + (big ? ' big' : '') + '"><div class="sth">' + (big ? '<div class="stf">' + flame(on, 84) + '</div>' : '<div class="stf">' + flame(on, 54) + '</div>') +
      '<div><div class="stn" style="color:' + (on ? '#ffb81c' : '#6b6c74') + '">' + (big ? n : '') + '</div><b class="stt">' + (big ? 'day streak' : 'Streak') + '</b>' +
      '<span class="sts">' + (on ? (big ? "You're making great progress!" : n + '-day streak. Keep it going today.') : 'Complete a lesson, review or watch a little every day to build your streak.') + '</span></div></div>' +
      '<div class="stw">' + wk.map(d => '<div class="' + (d.on ? 'on' : '') + (d.today ? ' td' : '') + '"><em>' + d.n + '</em><i>' + (d.on ? '✓' : '') + '</i></div>').join('') + '</div></div>';
  }
  function paintStreak() {
    const t = $('sb-pop'); if (t && t.classList.contains('on')) t.innerHTML = streakHtml(false);
    const pc = $('streak-card'); if (pc) { const h = streakHtml(true); if (pc.dataset.h !== h) { pc.innerHTML = '<b style="font-size:18px">Streak</b>' + h; pc.dataset.h = h; } }
  }
  function closePop() { const t = $('sb-pop'); if (t) t.classList.remove('on'); }
  function togglePop() { const t = $('sb-pop'); if (!t) return; if (t.classList.contains('on')) return closePop(); t.classList.add('on'); paintBar(); paintStreak(); }
  function mountProfile() {
    const prof = $('profile'); if (!prof || $('streak-card')) return;
    const c = document.createElement('div'); c.className = 'card'; c.id = 'streak-card'; const first = prof.querySelector('.card'); first ? first.after(c) : prof.prepend(c); paintStreak();
  }
  function closeMenu() { const m = $('sb-m'); if (m) m.classList.remove('on'); }
  function toggleMenu() {
    const m = $('sb-m'); if (!m) return;
    if (m.classList.contains('on')) return closeMenu();
    const cur = SAI.lang().learn, L = SAI.LANGS || (window.SafinaAI && window.SafinaAI.LANGS) || {};
    m.innerHTML = '<div class="mh">I am learning</div>' + Object.keys(L).filter(c => c !== SAI.lang().native || c === cur).map(c => '<button role="option" data-pick="' + c + '"' + (c === cur ? ' class="cur"' : '') + '><span class="fg">' + flag(c, 26) + '</span><span>' + esc(L[c].name) + '</span>' + (c === cur ? '<b>✓</b>' : '') + '</button>').join('');
    m.classList.add('on');
  }
  function pickLang(c) {
    closeMenu(); const l = Object.assign({}, SAI.lang()); if (l.learn === c) return;
    l.learn = c; if (l.native === c) l.native = c === 'en' ? 'ar' : 'en';
    SAI.setOption('lang', l);
    try { window.SafinaUI.applyLang(); } catch (_) { /* settings not loaded */ }
    paintBar(); toast('Now learning ' + ((window.SafinaAI && window.SafinaAI.LANGS[c]) || { name: c }).name + '. Download its translator in AI & downloads if you have not.');
    try { if (window.render) window.render(); } catch (_) { /* ignore */ }
  }
  /* the same points the profile page shows (10 per saved word, 2 per review, 1 per minute watched) plus lesson points */
  function allXp() { let n = 0; try { n = vocab.length * 10 + vocab.reduce((a, v) => a + v.hist.length, 0) * 2 + Math.round(Object.values(log).reduce((a, d) => a + d.sec, 0) / 60); } catch (_) { /* page not ready */ } return n + XP.total(); }
  function streak() { try { return B.progress().streak || 0; } catch (_) { return 0; } }
  function paintBar() {
    if (!$('sb')) return;
    mountProfile();
    let code = 'ar'; try { code = SAI.lang().learn; } catch (_) { /* default */ }
    $('sb-f').innerHTML = flag(code, 28);
    const n = streak(); $('sb-fl').innerHTML = flame(n > 0, 20); $('sb-s').textContent = n; $('sb-s').style.color = n > 0 ? '#fdc41f' : 'var(--mu,#8a8a96)'; paintStreak();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBar); else mountBar();
  setTimeout(paintBar, 700); setInterval(paintBar, 10000);
  B.on(ev => { if (ev === 'card' || ev === 'cards' || ev === 'assessed' || ev === 'option' || ev === 'reset') setTimeout(paintBar, 0); });
  document.addEventListener('safina-ai-changed', () => setTimeout(paintBar, 0));

  /* ------------------------------------------------------------------ the path */
  const root = document.createElement('div'); root.id = 'lp';
  root.innerHTML = '<div class="top"><button class="x" data-lp="close" aria-label="Close">✕</button><div class="lpb" id="lp-pb" style="display:none"><i></i></div><span class="mu" id="lp-t"></span></div><div class="scroll" id="lp-b"></div><div id="lp-f"></div>';
  document.body.appendChild(root);
  const body = () => $('lp-b'), foot = () => $('lp-f');
  let view = '', S = {}, picked = '';

  function pause() { try { const v = document.getElementById('v'); if (v && !v.paused) v.pause(); } catch (_) { /* no video */ } }
  function open() {
    pause(); view = 'path'; picked = '';
    root.classList.add('on'); document.body.style.overflow = 'hidden';
    drawPath();
    refill(false);
  }
  function close() {
    root.classList.remove('on'); document.body.style.overflow = ''; view = ''; S = {};
    try { speechSynthesis.cancel(); } catch (_) { /* ignore */ }
    try { if (window.render) window.render(); } catch (_) { /* ignore */ }
    paintBar();
  }

  /* what is the best way to group them: by where the person met the words, with the words they are losing first */
  function units() {
    const cards = B.cards(), t = Date.now(), st = {}, src = {};
    try { B.wordTable({ limit: 5000 }).forEach(r => { st[r.key] = r.status; src[r.key] = r.firstSource || ''; }); } catch (_) { /* no words yet */ }
    const map = new Map();
    cards.forEach(c => {
      const k0 = c.targets && c.targets[0];
      const lost = (c.targets || []).some(k => st[k] === 'lost');
      const name = lost ? 'Words to win back' : (src[k0] || c.from || 'Other words');
      if (!map.has(name)) map.set(name, { name, lost, cards: [] });
      map.get(name).cards.push(c);
    });
    const out = Array.from(map.values()).map(u => {
      u.cards.sort((a, b) => (a.stage || 0) - (b.stage || 0) || a.created - b.created);
      u.lessons = []; for (let i = 0; i < u.cards.length; i += LESSON) { const cs = u.cards.slice(i, i + LESSON); u.lessons.push({ cards: cs, due: cs.filter(c => c.due <= t).length }); }
      u.due = u.cards.filter(c => c.due <= t).length; return u;
    });
    out.sort((a, b) => (b.lost - a.lost) || (b.due > 0) - (a.due > 0) || b.cards.length - a.cards.length);
    return out;
  }

  function drawPath() {
    if (view !== 'path') return;
    $('lp-pb').style.display = 'none'; $('lp-t').textContent = ''; foot().innerHTML = '';
    let lvl = ''; try { const l = B.level(); lvl = l && l.level ? l.level + (l.estimated ? '*' : '') : ''; } catch (_) { /* no level */ }
    const us = units(), offs = [0, 38, 62, 38, 0, -38, -62, -38];
    let h = '<div class="strip"><button data-lp="more">✨ New sentences</button><button data-lp="conj">🔤 Conjugation</button><button data-lp="words">📊 Words</button><button data-lp="prog">📈 Progress</button></div>' +
      '<div class="mu" id="lp-msg" style="min-height:18px;margin:2px 2px 0">' + (S.busy ? 'Writing sentences for your level…' : S.err ? '<span style="color:#e0334a">' + esc(S.err) + '</span>' : '') + '</div>';
    if (!us.length) {
      h += '<div class="empty"><b>No lessons yet</b><div class="mu" style="margin-top:6px">Look up a word while you watch. The AI turns it into sentences made of words you know plus one new word. Tap “New sentences” to make some now.</div></div>';
    }
    let firstDue = true;
    us.forEach((u, ui) => {
      h += '<div class="ban"><small>Unit ' + (ui + 1) + (lvl ? ' · ' + esc(lvl) : '') + '</small><b>' + esc(u.name.length > 40 ? u.name.slice(0, 38) + '…' : u.name) + '</b></div>';
      u.lessons.forEach((l, li) => {
        const id = ui + ':' + li, done = !l.due, cur = !done && firstDue; if (cur) firstDue = false;
        h += '<div class="nd ' + (done ? 'done' : cur ? 'cur' : '') + '" style="transform:translateX(' + offs[li % offs.length] + 'px)"><button data-lp="node" data-id="' + id + '" aria-label="Lesson ' + (li + 1) + '">' + (done ? '✓' : '★') + '</button></div>';
        if (picked === id && !done) h += '<div class="pop"><b>' + esc(u.name.length > 28 ? u.name.slice(0, 26) + '…' : u.name) + '</b><span>Lesson ' + (li + 1) + ' of ' + u.lessons.length + ' · ' + l.due + ' sentence' + (l.due === 1 ? '' : 's') + '</span><button data-lp="start" data-id="' + id + '">Start</button></div>';
      });
    });
    body().innerHTML = h;
    S.units = us;
    const cur = body().querySelector('.nd.cur'); if (cur && !S.scrolled) { S.scrolled = true; try { cur.scrollIntoView({ block: 'center' }); } catch (_) { /* old webview */ } }
  }

  async function refill(force) {
    if (S.busy) return;
    const fresh = B.cards().filter(c => !c.reps).length;
    if (!force && fresh >= LESSON) return;
    S.busy = true; S.err = ''; drawPath();
    try {
      try { B.importSentences((window.vocab || []).flatMap(x => x.auto ? [] : x.kind === 'line' ? [{ text: x.lemma, tr: x.tr, src: x.src }] : x.sent ? [{ text: x.sent, word: x.lemma, tr: x.sentTr, src: x.src }] : [])); } catch (_) { /* nothing saved */ }
      const r = await B.prepare({ count: 10 });
      if (r && r.error && !B.cards().length) S.err = r.error;
    } catch (e) { S.err = e.message || 'Could not write sentences'; }
    S.busy = false; if (view === 'path') drawPath();
  }

  /* ------------------------------------------------------------------ a lesson */
  const norm = w => B.norm(String(w).replace(/[^\p{L}\p{M}\p{N}]/gu, ''));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const bare = w => String(w).replace(/[^\p{L}\p{M}\p{N}]/gu, '');

  function startLesson(id) {
    const [ui, li] = id.split(':').map(Number), u = S.units && S.units[ui], l = u && u.lessons[li]; if (!l) return;
    const t = Date.now(), cs = l.cards.filter(c => c.due <= t); if (!cs.length) return;
    const pool = B.cards();
    S = { progress: 0, units: S.units, lesson: cs.map(c => ({ c, tries: 0 })), i: 0, total: cs.length, right: 0, wrong: 0, xp: 0, t00: Date.now(), pool };
    view = 'lesson'; $('lp-pb').style.display = ''; exercise();
  }
  function bar() { const n = S.total + 0; $('lp-pb').firstElementChild.style.width = Math.round(S.progress / n * 100) + '%'; }
  S.progress = 0;

  function mkExercise(c, idx) {
    const toks = c.text.replace(/\s+/g, ' ').trim().split(' ');
    const tgt = c.targets && c.targets[0];
    const gi = tgt ? toks.findIndex(w => norm(w) === tgt) : -1;
    const others = S.pool.filter(x => x.id !== c.id && x.tr).map(x => x.tr);
    const canMeaning = c.tr && new Set(others).size >= 2;
    const wordsPool = Array.from(new Set(S.pool.flatMap(x => x.text.split(' ').map(bare)).filter(w => w && norm(w) !== tgt && w.length > 1)));
    const canFill = gi >= 0 && toks.length >= 3 && wordsPool.length >= 2;
    let type = idx % 2 === 0 ? 'meaning' : 'fill';
    if (type === 'meaning' && !canMeaning) type = 'fill'; if (type === 'fill' && !canFill) type = 'meaning';
    if (type === 'meaning' && !canMeaning) type = 'reveal';
    if (type === 'meaning') {
      const opts = shuffle([c.tr].concat(shuffle(Array.from(new Set(others))).slice(0, 2)));
      return { type, toks, answer: c.tr, opts };
    }
    if (type === 'fill') {
      const ans = bare(toks[gi]);
      const dist = shuffle(wordsPool).slice(0, 2);
      return { type, toks, gi, answer: ans, opts: shuffle([ans].concat(dist)) };
    }
    return { type: 'reveal', toks };
  }

  function sentHtml(ex, c, hide) {
    return ex.toks.map((w, i) => (hide && i === ex.gi) ? '<span class="gap" id="lp-gap">&nbsp;</span>' : '<span class="w" data-w="' + esc(bare(w)) + '" data-k="' + esc(norm(w)) + '">' + esc(w) + '</span>').join(' ');
  }
  function exercise() {
    if (view !== 'lesson') return;
    const it = S.lesson[S.i]; if (!it) return finish();
    const c = it.c; S.ex = mkExercise(c, S.i + it.tries); S.sel = null; S.checked = false; S.t0 = Date.now(); S.tapped = new Set(); S.shown = false;
    const ex = S.ex; bar();
    let h = '';
    if (ex.type === 'meaning') {
      h = '<div class="q">What does this sentence mean?</div><div class="big"><div class="sent" dir="rtl" lang="' + esc(learnLang()) + '">' + sentHtml(ex, c) + '</div></div><div class="gl" id="lp-g">Tap a word to see its meaning.</div>' +
        '<div class="opts">' + ex.opts.map((o, i) => '<button class="o" data-lp="opt" data-i="' + i + '" dir="auto">' + esc(o) + '</button>').join('') + '</div>';
    } else if (ex.type === 'fill') {
      h = '<div class="q">Which word is missing?</div><div class="big"><div class="sent" dir="rtl" lang="' + esc(learnLang()) + '">' + sentHtml(ex, c, true) + '</div>' + (c.tr ? '<div class="mu" style="margin-top:6px" dir="auto">' + esc(c.tr) + '</div>' : '') + '</div>' +
        '<div class="opts row">' + ex.opts.map((o, i) => '<button class="o" data-lp="opt" data-i="' + i + '" dir="auto" lang="' + esc(learnLang()) + '" style="font-size:22px">' + esc(o) + '</button>').join('') + '</div>';
    } else {
      h = '<div class="q">Read the sentence</div><div class="big"><div class="sent" dir="rtl" lang="' + esc(learnLang()) + '">' + sentHtml(ex, c) + '</div></div><div class="gl" id="lp-g">Tap a word you did not know.</div><div id="lp-r"></div>';
    }
    body().innerHTML = h;
    foot().innerHTML = '<div class="foot"><button class="go" data-lp="check" ' + (ex.type === 'reveal' ? '' : 'disabled') + '>' + (ex.type === 'reveal' ? 'Show meaning' : 'Check') + '</button></div>';
    try { if (window.say && S.i === 0) { /* no auto speech: the phone may be silent */ } } catch (_) { /* ignore */ }
  }

  async function tapWord(sp) {
    const k = sp.dataset.k, c = S.lesson[S.i].c; if (!k) return;
    if (S.tapped.has(k)) { S.tapped.delete(k); sp.classList.remove('f'); return; }
    S.tapped.add(k); sp.classList.add('f');
    const g = $('lp-g'); if (!g) return; g.textContent = sp.dataset.w + ' …';
    try { const r = await SAI.lookupWord(sp.dataset.w, c.text); g.textContent = sp.dataset.w + ' = ' + r.gloss + (r.pos ? ' (' + r.pos + ')' : ''); } catch (e) { g.textContent = sp.dataset.w + ': ' + (e.message || 'no meaning available'); }
  }

  async function check() {
    const it = S.lesson[S.i], c = it.c, ex = S.ex; if (S.checked) return;
    if (ex.type === 'reveal') {
      if (S.shown) return; S.shown = true;
      const el = $('lp-r'); el.innerHTML = '<div class="mu" style="text-align:center">Translating…</div>';
      let tr = c.tr; if (!tr) { try { tr = (await SAI.translateLine(c.text)).t; c.tr = tr; } catch (_) { tr = ''; } }
      if (S.lesson[S.i] !== it) return;
      el.innerHTML = '<div class="big" dir="auto" style="font-size:19px">' + esc(tr || 'No translation available right now.') + '</div>' + (c.hint ? '<div class="mu" style="text-align:center">💡 ' + esc(c.hint) + '</div>' : '');
      S.checked = true; return feedback(true, tr || '');
    }
    if (S.sel == null) return;
    S.checked = true;
    const ok = ex.opts[S.sel] === ex.answer;
    body().querySelectorAll('.o').forEach((b, i) => { b.disabled = true; if (ex.opts[i] === ex.answer) b.classList.add('ok'); else if (i === S.sel) b.classList.add('no'); });
    if (ex.type === 'fill') { const g = $('lp-gap'); if (g) { g.textContent = ex.answer; g.classList.add('fill'); } }
    feedback(ok, ex.type === 'fill' ? '' : ex.answer);
  }

  /* the sheet at the bottom: correct or not, and "how difficult was it?" */
  function feedback(ok, answer) {
    const it = S.lesson[S.i], c = it.c, ex = S.ex;
    S.ok = ok;
    const hint = ok && ex.type !== 'reveal' && c.hint ? '<div class="mu">💡 ' + esc(c.hint) + '</div>' : '';
    if (ex.type === 'reveal' || ok) {
      foot().innerHTML = '<div class="foot ' + (ex.type === 'reveal' ? '' : 'ok') + '">' + (ex.type === 'reveal' ? '' : '<b>Correct!</b>') + hint + '<div class="mu" style="margin-top:4px">How difficult was this sentence?</div><div class="dif"><button data-lp="dif" data-q="1">Hard</button><button data-lp="dif" data-q="2">Good</button><button data-lp="dif" data-q="3">Easy</button></div>' +
        (ex.type === 'reveal' ? '<button class="go" data-lp="dif" data-q="0" style="margin-top:10px;background:var(--card,#16161a);color:inherit;box-shadow:none;border:2px solid var(--ln,#2c2c34)">I could not follow it</button>' : '') + '</div>';
    } else {
      foot().innerHTML = '<div class="foot no"><b>Not quite</b><div class="mu" dir="auto">' + (ex.type === 'fill' ? 'Missing word: <span style="font-size:18px">' + esc(ex.answer) + '</span>' : 'Correct answer: ' + esc(answer)) + '</div><div style="height:10px"></div><button class="go" data-lp="dif" data-q="0">Continue</button></div>';
    }
  }

  function rate(q) {
    const it = S.lesson[S.i], c = it.c; if (!it || S.rated) return;
    let out = { learned: [] };
    if (it.tries === 0) { try { out = B.rateCard(c.id, { q, ms: Date.now() - S.t0, tapped: Array.from(S.tapped) }) || out; } catch (e) { toast(e.message); } }
    if (q > 0) { S.right++; S.xp += XP.add(q === 3 ? 4 : q === 2 ? 3 : 2); } else {
      S.wrong++;
      if (it.tries === 0) S.lesson.push({ c, tries: 1 });    // one more go at the end, not rated again
    }
    if (out.learned && out.learned.length) toast('🎉 You now know: ' + out.learned.join(', '));
    S.progress++; S.i++; exercise();
  }

  function finish() {
    const bonus = S.right ? XP.add(10) : 0; S.xp += bonus;
    $('lp-pb').firstElementChild.style.width = '100%';
    const secs = Math.round((Date.now() - S.t00) / 1000), n = S.right + S.wrong, acc = n ? Math.round(S.right / n * 100) : 0;
    body().innerHTML = '<div class="end"><div class="ck">✓</div><h2>' + (acc >= 80 ? 'Lesson complete' : 'Lesson done') + '</h2><div class="mu">' + streak() + '-day streak</div>' +
      '<div class="tl"><div><em>Points</em><b>+' + S.xp + '</b></div><div><em>Right</em><b>' + acc + '%</b></div><div><em>Time</em><b>' + (secs >= 60 ? Math.round(secs / 60) + ' min' : secs + ' s') + '</b></div></div></div>';
    foot().innerHTML = '<div class="foot"><button class="go" data-lp="back">Continue</button></div>';
    paintBar();
  }
  function back() { view = 'path'; S = { busy: false, units: null }; S.progress = 0; drawPath(); }

  /* ------------------------------------------------------------------ events */
  root.addEventListener('click', e => {
    const w = e.target.closest('.sent .w'); if (w && view === 'lesson') return tapWord(w);
    const a = e.target.closest('[data-lp]'); if (!a) return; const k = a.dataset.lp;
    if (k === 'close') { if (view === 'lesson' && S.i > 0 && S.i < S.lesson.length && !confirm('Leave this lesson? Your answers so far are kept.')) return; if (view === 'lesson') { back(); return; } close(); }
    else if (k === 'node') { picked = picked === a.dataset.id ? '' : a.dataset.id; const l = S.units[+a.dataset.id.split(':')[0]].lessons[+a.dataset.id.split(':')[1]]; if (!l.due) { picked = ''; toast('All done here for now. It comes back when it is due.'); } drawPath(); }
    else if (k === 'start') startLesson(a.dataset.id);
    else if (k === 'opt') { if (S.checked) return; S.sel = +a.dataset.i; body().querySelectorAll('.o').forEach((b, i) => b.classList.toggle('sel', i === S.sel)); const g = foot().querySelector('.go'); if (g) g.disabled = false; }
    else if (k === 'check') check();
    else if (k === 'dif') { S.rated = false; rate(+a.dataset.q); }
    else if (k === 'back') back();
    else if (k === 'more') refill(true);
    else if (k === 'conj' || k === 'words' || k === 'prog') { const n = k === 'prog' ? 'progress' : k; close(); try { window.SafinaLearn.open(n); } catch (_) { /* learn screens missing */ } }
  });

  window.SAFINA_XP = XP;
  window.SafinaPath = { open, close, xp: XP, paintBar };
})();
