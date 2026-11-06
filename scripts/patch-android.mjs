// Applies the native Android changes. Cross-platform (Windows, macOS, Linux, Termux) and safe to run repeatedly.
// Run from the project root after "npx cap sync android":
//     node scripts/patch-android.mjs
//
// What it does
//   1. installs LinguaStoragePlugin.java and MainActivity.java from native/android/*.tpl (package name filled in)
//   2. makes sure the manifest declares the storage permissions the existing plugin uses (adds only what is missing)
//   3. sets the launcher label ("app_name" / "title_activity_main") to Safina in res/values/strings.xml
// It does NOT change the application id / Java package (com.lingua.arabic): renaming it would break existing installs.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.SAFINA_ROOT ? resolve(process.env.SAFINA_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_LABEL = 'Safina';
const fail = m => { console.error('\nPATCH FAILED: ' + m + '\n'); process.exit(1); };
const read = p => readFileSync(p, 'utf8').replace(/^﻿/, '');
const write = (p, t) => writeFileSync(p, t, 'utf8');                    // UTF-8, no BOM

function findFile(dir, name) {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { const r = findFile(p, name); if (r) return r; }
    else if (e === name) return p;
  }
  return null;
}

const javaRoot = join(root, 'android', 'app', 'src', 'main', 'java');
const mainActivity = findFile(javaRoot, 'MainActivity.java');
if (!mainActivity) fail('android/ not found. Run "npx cap add android" (once) and "npx cap sync android" first.');
const pkg = (read(mainActivity).match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1];
if (!pkg) fail('could not read the package name from ' + mainActivity);
console.log('package: ' + pkg);

// 1) native templates
const tplDir = join(root, 'native', 'android');
for (const [tpl, out] of [['LinguaStoragePlugin.java.tpl', join(dirname(mainActivity), 'LinguaStoragePlugin.java')], ['MainActivity.java.tpl', mainActivity]]) {
  const src = join(tplDir, tpl);
  if (!existsSync(src)) fail('missing template ' + src);
  write(out, read(src).replace(/__PKG__/g, pkg));
  console.log('wrote  ' + out.slice(root.length + 1));
}

// 2) manifest permissions (only what is missing)
const manifest = join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!existsSync(manifest)) fail('missing ' + manifest);
let mf = read(manifest);
const perms = [
  ['android.permission.MANAGE_EXTERNAL_STORAGE', ''],
  ['android.permission.READ_EXTERNAL_STORAGE', ' android:maxSdkVersion="32"'],
  ['android.permission.WRITE_EXTERNAL_STORAGE', ' android:maxSdkVersion="29"']
];
const add = perms.filter(([n]) => !mf.includes('"' + n + '"'))
  .map(([n, extra]) => '    <uses-permission android:name="' + n + '"' + extra + ' />\n').join('');
if (add) {
  if (!/<application\b/.test(mf)) fail('no <application> element in AndroidManifest.xml');
  mf = mf.replace(/(\s*)<application\b/, (m, ws) => '\n' + add.replace(/\n$/, '') + ws + '<application');
  write(manifest, mf);
  console.log('manifest: added ' + perms.filter(([n]) => add.includes(n)).map(p => p[0].split('.').pop()).join(', '));
} else console.log('manifest: permissions already present');

// 3) launcher label
const strings = join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
if (!existsSync(strings)) fail('missing ' + strings);
let sx = read(strings), changed = [];
for (const key of ['app_name', 'title_activity_main']) {
  const re = new RegExp('(<string\\s+name="' + key + '"[^>]*>)([^<]*)(</string>)');
  if (re.test(sx)) {
    const cur = sx.match(re)[2];
    if (cur !== APP_LABEL) { sx = sx.replace(re, '$1' + APP_LABEL + '$3'); changed.push(key + ': "' + cur + '" -> "' + APP_LABEL + '"'); }
  } else {
    sx = sx.replace(/<\/resources>/, '    <string name="' + key + '">' + APP_LABEL + '</string>\n</resources>');
    changed.push(key + ': added');
  }
}
if (changed.length) { write(strings, sx); changed.forEach(c => console.log('label:  ' + c)); }
else console.log('label:  already "' + APP_LABEL + '"');

console.log('\npatched OK');
