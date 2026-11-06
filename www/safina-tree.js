/* Safina import tree: renders a SafinaMatch tree (series > seasons > episodes > files) as HTML.
 * Pure functions (state in, HTML string out) so they can be tested in Node.
 * Used twice: as the import review (checkboxes) and, read-only, as the episode list of a library show. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SafinaTree = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');

  const BADGE = {
    matched: ['ok', '✓ Matched'],
    'missing-subtitle': ['warn', 'No subtitle'],
    'missing-media': ['bad', 'No video'],
    ambiguous: ['warn', 'Choose subtitle'],
    duplicate: ['warn', 'Duplicate video'],
    review: ['warn', 'Needs review']
  };

  // movies are rendered with the same row component as episodes
  function movieNode(m) {
    return { key: m.key, label: m.video.name, videos: [m.video], subs: m.subs, notes: m.notes || [], status: m.status, conflicts: m.conflicts || [], season: 0, episode: 0, isMovie: true };
  }

  function isSelectable(nd) {
    if (nd.status === 'matched' || nd.status === 'missing-subtitle') return nd.videos.length === 1;
    if (nd.status === 'review') return nd.season != null && nd.videos.length === 1;
    return false;
  }
  function isChecked(nd, sel) {
    if (!isSelectable(nd)) return false;
    if (sel && sel.has(nd.key)) return !!sel.get(nd.key);
    return nd.status === 'matched' || nd.status === 'missing-subtitle';
  }
  function allNodes(tree) {
    if (tree.type === 'movie') return tree.movies.map(movieNode);
    const out = [];
    tree.seasons.forEach(s => s.episodes.forEach(e => out.push(e)));
    return out;
  }
  function selection(tree, sel) { return allNodes(tree).filter(nd => isChecked(nd, sel)); }

  const lang = l => (l && l !== 'und') ? '<span class="ttag">' + esc(String(l).toUpperCase()) + '</span>' : '<span class="ttag ttag-u">?</span>';
  const fline = (icon, name, extra) => '<div class="tf"><span class="ti">' + icon + '</span><span class="tn-name">' + esc(name) + '</span>' + (extra || '') + '</div>';

  function toggleBtn(id, open) {
    return '<button type="button" class="tg" data-toggle="' + esc(id) + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="' + (open ? 'Collapse' : 'Expand') + '">' + (open ? '▾' : '▸') + '</button>';
  }
  const isOpen = (ui, id, dflt) => ui.open && ui.open.has(id) ? ui.open.get(id) : dflt;

  function episodeHtml(nd, ui) {
    const id = 'ep:' + nd.key;
    const open = isOpen(ui, id, nd.status !== 'matched');
    const [cls, label] = BADGE[nd.status] || ['warn', nd.status];
    const checked = isChecked(nd, ui.sel), canPick = isSelectable(nd);
    const title = nd.isMovie ? esc(nd.label) : 'Episode ' + pad(nd.episode);
    let h = '<div class="te st-' + cls + '" data-status="' + esc(nd.status) + '"><div class="tr">';
    if (!ui.readOnly) h += '<input type="checkbox" class="tc" data-pick="' + esc(nd.key) + '"' + (checked ? ' checked' : '') + (canPick ? '' : ' disabled') + ' aria-label="Import ' + title + '">';
    h += toggleBtn(id, open) + '<span class="tl">' + title + '</span><span class="bdg b-' + cls + '">' + esc(label) + '</span>';
    // Collapsed rows still show which subtitle languages were attached, so a long list can be reviewed at a glance.
    if (!open) h += nd.subs.map(s => lang(s.lang)).join('');
    if (ui.readOnly && nd.videos.length === 1 && ui.playable) h += '<button type="button" class="tplay" data-play="' + esc(nd.key) + '">▶ Play</button>';
    h += '</div>';
    if (open) {
      h += '<div class="tk">';
      nd.videos.forEach(v => { h += fline('▶', v.name); });
      if (!nd.videos.length) h += '<div class="tf tmiss">No video file for this episode</div>';
      nd.subs.forEach(s => { h += fline('≣', s.name, lang(s.lang)); });
      if (!nd.subs.length && nd.videos.length && !(nd.conflicts || []).length) h += '<div class="tf tmiss">No subtitle file for this episode</div>';
      (nd.unusedSubs || []).forEach(s => { h += '<div class="tf tmiss">Not used: ' + esc(s.name) + '</div>'; });
      (nd.unusedVideos || []).forEach(s => { h += '<div class="tf tmiss">Not used: ' + esc(s.name) + '</div>'; });
      if (!ui.readOnly) {
        if (nd.videos.length > 1) {
          h += '<label class="tsel">Which video?<select data-choice="' + esc(nd.key) + '|video"><option value="">Choose one…</option>' +
            nd.videos.map(v => '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>').join('') + '</select></label>';
        }
        (nd.conflicts || []).forEach(c => {
          h += '<label class="tsel">Which ' + (c.lang === 'und' ? '' : esc(c.lang.toUpperCase()) + ' ') + 'subtitle?<select data-choice="' + esc(nd.key) + '|sub|' + esc(c.lang) + '"><option value="">Choose one…</option>' +
            c.candidates.map(s => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('') + '</select></label>';
        });
      }
      (nd.notes || []).forEach(n => { h += '<div class="tnote">' + esc(n) + '</div>'; });
      h += '</div>';
    }
    return h + '</div>';
  }

  function seasonHtml(s, ui) {
    const id = 'se:' + (s.season == null ? '?' : s.season);
    const open = isOpen(ui, id, true);
    const n = s.episodes.length, ok = s.episodes.filter(e => e.status === 'matched').length;
    let h = '<div class="ts"><div class="tr">' + toggleBtn(id, open) + '<span class="tl">' + esc(s.label) + '</span><span class="tcount">' + n + ' episode' + (n === 1 ? '' : 's') + ' · ' + ok + ' matched</span></div>';
    if (open) {
      h += '<div class="tk">';
      if (s.season == null && !ui.readOnly) {
        h += '<div class="tfix">These files have no season in their name. Nothing was guessed. Set the season: ' +
          '<input type="number" inputmode="numeric" min="1" max="99" id="safina-season-fix" placeholder="Season">' +
          '<button type="button" data-apply-season="1">Apply</button></div>';
      }
      h += s.episodes.map(e => episodeHtml(e, ui)).join('') + '</div>';
    }
    return h + '</div>';
  }

  function listHtml(id, title, rows, ui, extraFn) {
    if (!rows.length) return '';
    const open = isOpen(ui, id, true);
    let h = '<div class="ts"><div class="tr">' + toggleBtn(id, open) + '<span class="tl">' + esc(title) + '</span><span class="tcount">' + rows.length + '</span></div>';
    if (open) h += '<div class="tk">' + rows.map(r => extraFn(r)).join('') + '</div>';
    return h + '</div>';
  }

  function placeRow(r, ui) {
    const it = r.item;
    let h = '<div class="tplace">' + fline(it.kind === 'video' ? '▶' : '≣', it.name, it.kind === 'subtitle' ? lang(it.lang) : '') +
      '<div class="tnote">' + esc(r.reason) + '</div>';
    if (!ui.readOnly && r.placeable) {
      h += '<div class="tfix">Place it: season <input type="number" min="1" max="99" data-place-season="' + esc(it.id) + '"> episode <input type="number" min="1" max="999" data-place-episode="' + esc(it.id) + '"> <button type="button" data-place="' + esc(it.id) + '">Place</button></div>';
    }
    return h + '</div>';
  }

  function render(tree, ui) {
    ui = ui || {};
    const nodes = allNodes(tree);
    const counts = tree.counts || {};
    let h = '';
    const rootId = 'root';
    const rootOpen = isOpen(ui, rootId, true);
    const summary = ui.readOnly ? nodes.length + ' episode' + (nodes.length === 1 ? '' : 's') : Object.keys(counts).map(k => (counts[k] + ' ' + (BADGE[k] ? BADGE[k][1].replace('✓ ', '') : k).toLowerCase())).join(' · ');
    h += '<div class="ttree"><div class="tr troot">' + toggleBtn(rootId, rootOpen) + '<span class="tl">' + esc(ui.title || tree.series || 'Untitled') + '</span><span class="tcount">' + esc(summary || 'nothing to import') + '</span></div>';
    if (rootOpen) {
      h += '<div class="tk">';
      if (!ui.readOnly && nodes.length) {
        h += '<div class="tquick"><button type="button" data-quick="all">Select all</button><button type="button" data-quick="none">None</button><button type="button" data-quick="matched">Only matched</button></div>';
      }
      if (tree.type === 'movie') h += nodes.map(n => episodeHtml(n, ui)).join('');
      else h += tree.seasons.map(s => seasonHtml(s, ui)).join('');
      const placeable = r => Object.assign({ placeable: true }, r);
      h += listHtml('un', 'Not placed in the tree', (tree.unparsed || []).map(placeable), ui, r => placeRow(r, ui));
      h += listHtml('fo', 'Different series (not matched)', tree.foreign || [], ui, r => placeRow(r, ui));
      h += listHtml('um', 'Subtitles without a video', tree.unmatched || [], ui, r => placeRow(r, ui));
      h += listHtml('ig', 'Ignored files', ui.ignored || [], ui, r => '<div class="tplace">' + fline('•', r.name) + '<div class="tnote">' + esc(r.reason) + '</div></div>');
      h += '</div>';
    }
    return h + '</div>';
  }

  return { render, isSelectable, isChecked, selection, allNodes, esc };
});
