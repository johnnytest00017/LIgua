import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));

// A realistic Capacitor 7 android tree, as "npx cap add android" generates it (label still says Lingua).
function fakeProject() {
  const root = mkdtempSync(join(tmpdir(), 'safina-patch-'));
  const main = join(root, 'android/app/src/main');
  mkdirSync(join(main, 'java/com/lingua/arabic'), { recursive: true });
  mkdirSync(join(main, 'res/values'), { recursive: true });
  writeFileSync(join(main, 'java/com/lingua/arabic/MainActivity.java'),
    'package com.lingua.arabic;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n');
  writeFileSync(join(main, 'AndroidManifest.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n\n    <application\n        android:allowBackup="true"\n        android:label="@string/app_name">\n    </application>\n\n    <!-- Permissions -->\n\n    <uses-permission android:name="android.permission.INTERNET" />\n</manifest>\n');
  writeFileSync(join(main, 'res/values/strings.xml'),
    '<?xml version=\'1.0\' encoding=\'utf-8\'?>\n<resources>\n    <string name="app_name">Lingua</string>\n    <string name="title_activity_main">Lingua</string>\n    <string name="package_name">com.lingua.arabic</string>\n    <string name="custom_url_scheme">com.lingua.arabic</string>\n</resources>\n');
  cpSync(join(here, 'native'), join(root, 'native'), { recursive: true });
  return root;
}
const run = root => execFileSync(process.execPath, [join(here, 'scripts/patch-android.mjs')], { env: { ...process.env, SAFINA_ROOT: root }, encoding: 'utf8' });

test('launcher label becomes Safina but the application id / package stay untouched', () => {
  const root = fakeProject();
  const out = run(root);
  const sx = readFileSync(join(root, 'android/app/src/main/res/values/strings.xml'), 'utf8');
  assert.match(sx, /<string name="app_name">Safina<\/string>/);
  assert.match(sx, /<string name="title_activity_main">Safina<\/string>/);
  assert.match(sx, /<string name="package_name">com\.lingua\.arabic<\/string>/);
  assert.match(sx, /<string name="custom_url_scheme">com\.lingua\.arabic<\/string>/);
  assert.doesNotMatch(sx, /Lingua</);
  assert.match(out, /patched OK/);
});

test('plugin and activity are installed with the real package name filled in', () => {
  const root = fakeProject(); run(root);
  const dir = join(root, 'android/app/src/main/java/com/lingua/arabic');
  const plugin = readFileSync(join(dir, 'LinguaStoragePlugin.java'), 'utf8'), act = readFileSync(join(dir, 'MainActivity.java'), 'utf8');
  assert.match(plugin, /^package com\.lingua\.arabic;/); assert.match(act, /^package com\.lingua\.arabic;/);
  assert.match(act, /registerPlugin\(LinguaStoragePlugin\.class\)/);
  assert.match(act, /registerPlugin[\s\S]*super\.onCreate/, 'plugins must be registered before super.onCreate');
  assert.doesNotMatch(plugin + act, /__PKG__/);
});

test('manifest gets the three storage permissions once, keeps INTERNET, stays well-formed, and re-running changes nothing', () => {
  const root = fakeProject();
  run(root);
  const mfPath = join(root, 'android/app/src/main/AndroidManifest.xml');
  const first = readFileSync(mfPath, 'utf8');
  for (const p of ['MANAGE_EXTERNAL_STORAGE', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'INTERNET'])
    assert.equal((first.match(new RegExp('android\\.permission\\.' + p + '"', 'g')) || []).length, 1, p);
  assert.match(first, /READ_EXTERNAL_STORAGE" android:maxSdkVersion="32"/);
  assert.ok(first.indexOf('MANAGE_EXTERNAL_STORAGE') < first.indexOf('<application'));
  assert.equal((first.match(/<application\b/g) || []).length, 1);
  const stringsPath = join(root, 'android/app/src/main/res/values/strings.xml');
  const s1 = readFileSync(stringsPath, 'utf8');
  const out2 = run(root);
  assert.equal(readFileSync(mfPath, 'utf8'), first, 'second run must not modify the manifest');
  assert.equal(readFileSync(stringsPath, 'utf8'), s1, 'second run must not modify strings.xml');
  assert.match(out2, /already/);
});

test('without an android/ folder it stops with an actionable message instead of half-patching', () => {
  const root = mkdtempSync(join(tmpdir(), 'safina-empty-'));
  assert.throws(() => run(root), e => /cap add android/.test(String(e.stderr)));
  assert.equal(existsSync(join(root, 'android')), false);
});
