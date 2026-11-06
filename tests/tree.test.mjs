import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SM = require('../www/safina-match.js'), ST = require('../www/safina-tree.js');

const E = (id, name, lang) => ({ id, name, path: name, lang: lang || null });
const sample = () => SM.buildTree([
  E('v1', 'Show.S01E01.mkv'), E('a1', 'Show.S01E01.ar.srt', 'ar'),
  E('v2', 'Show.S01E02.mkv'),
  E('v3', 'Show.S02E01.mkv'), E('a3', 'Show.S02E01.ar.srt', 'ar'), E('a3b', 'Show.S02E01.v2.ar.srt', 'ar'),
  E('s9', 'Show.S01E09.ar.srt', 'ar'),
  E('x', 'Show.E04.ar.srt', 'ar')
], { type: 'tv' });

test('the tree is Series > Season > Episode and is built from real data', () => {
  // matched episodes are collapsed by default (only problem episodes open themselves), so open S01E01 explicitly
  const html = ST.render(sample(), { title: 'Show', open: new Map([['ep:1:1', true]]), sel: new Map() });
  assert.match(html, /class="ttree"/);
  assert.match(html, /Season 01/); assert.match(html, /Season 02/); assert.match(html, /Season unknown/);
  assert.match(html, /Episode 01/); assert.match(html, /Show\.S01E01\.mkv/); assert.match(html, /Show\.S01E01\.ar\.srt/);
  const dflt = ST.render(sample(), { title: 'Show', open: new Map(), sel: new Map() });
  assert.doesNotMatch(dflt, /Show\.S01E01\.mkv/, 'a matched episode starts collapsed');
  assert.match(dflt, /Show\.S01E02\.mkv/, 'an episode that needs attention starts expanded');
});

test('every status is visibly distinguished', () => {
  const html = ST.render(sample(), { title: 'Show', open: new Map(), sel: new Map() });
  for (const label of ['Matched', 'No subtitle', 'No video', 'Choose subtitle', 'Needs review'])
    assert.ok(html.includes(label), label);
  assert.match(html, /data-status="matched"/); assert.match(html, /data-status="ambiguous"/); assert.match(html, /data-status="missing-media"/);
});

test('nodes expand and collapse from the open-state map', () => {
  const t = sample();
  const open = new Map([['se:1', false]]);
  const collapsed = ST.render(t, { title: 'Show', open, sel: new Map() });
  assert.match(collapsed, /data-toggle="se:1"[^>]*aria-expanded="false"/);
  // "Episode 02" exists only in season 1 (season 2 has an "Episode 01" too, so that label can't be used here)
  assert.doesNotMatch(collapsed, /Episode 02/, 'children of a collapsed season must not be rendered');
  assert.doesNotMatch(collapsed, /Show\.S01E02\.mkv/);
  assert.match(collapsed, /Season 02/, 'other seasons are unaffected');
  open.set('se:1', true);
  const expanded = ST.render(t, { title: 'Show', open, sel: new Map() });
  assert.match(expanded, /Episode 02/); assert.match(expanded, /Show\.S01E02\.mkv/);
  open.set('ep:1:1', true);
  assert.match(ST.render(t, { title: 'Show', open, sel: new Map() }), /Show\.S01E01\.mkv/);
  const root = ST.render(t, { title: 'Show', open: new Map([['root', false]]), sel: new Map() });
  assert.doesNotMatch(root, /Season 01/);
});

test('selection: matched and missing-subtitle are on by default, ambiguous/duplicate/missing-media cannot be imported', () => {
  const t = sample();
  const picked = ST.selection(t, new Map()).map(n => n.key).sort();
  assert.deepEqual(picked, ['1:1', '1:2']);                        // S01E01 matched, S01E02 missing subtitle
  const amb = ST.allNodes(t).find(n => n.status === 'ambiguous');
  assert.equal(ST.isSelectable(amb), false);
  const html = ST.render(t, { title: 'Show', open: new Map(), sel: new Map() });
  assert.match(html, /data-pick="2:1"[^>]*disabled/);
  assert.match(html, /data-pick="1:1"[^>]*checked/);
});

test('the user can switch an episode off and on explicitly', () => {
  const t = sample();
  assert.deepEqual(ST.selection(t, new Map([['1:1', false]])).map(n => n.key), ['1:2']);
});

test('ambiguous subtitles offer an explicit chooser instead of a silent pick', () => {
  const html = ST.render(sample(), { title: 'Show', open: new Map(), sel: new Map() });
  assert.match(html, /<select data-choice="2:1\|sub\|ar">/);
  assert.match(html, /Show\.S02E01\.ar\.srt/); assert.match(html, /Show\.S02E01\.v2\.ar\.srt/);
});

test('unplaceable files are listed with a reason and a way to place them', () => {
  const t = SM.buildTree([E('v1', 'Show.S01E01.mkv'), E('m', 'Making.Of.mkv')], { type: 'tv' });
  const html = ST.render(t, { title: 'Show', open: new Map(), sel: new Map() });
  assert.match(html, /Not placed in the tree/); assert.match(html, /Making\.Of\.mkv/); assert.match(html, /data-place="m"/);
});

test('read-only mode (library detail) has play buttons and no checkboxes', () => {
  const html = ST.render(sample(), { readOnly: true, playable: true, title: 'Show', open: new Map() });
  assert.doesNotMatch(html, /type="checkbox"/); assert.match(html, /data-play="1:1"/);
});

test('hostile file names cannot inject markup', () => {
  const t = SM.buildTree([E('v1', 'Show.S01E01.<img src=x onerror=alert(1)>.mkv'), E('a1', '"><script>alert(1)</script>.S01E01.srt', 'ar')], { type: 'tv' });
  const html = ST.render(t, { title: '<b>x</b>', open: new Map([['ep:1:1', true]]), sel: new Map() });
  assert.doesNotMatch(html, /<img src=x|<script>alert|<b>x<\/b>/);
});

test('movie tree renders with the same row component', () => {
  const t = SM.buildTree([E('v', 'Great.Film.2019.mkv'), E('a', 'Great.Film.2019.ar.srt', 'ar')], { type: 'movie' });
  const html = ST.render(t, { title: 'Great Film', open: new Map(), sel: new Map() });
  assert.match(html, /Great\.Film\.2019\.mkv/); assert.equal(ST.selection(t, new Map()).length, 1);
});
