import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
function project(activity) {
  const root = mkdtempSync(join(tmpdir(), 'safina-llm-'));
  const main = join(root, 'android/app/src/main'), java = join(main, 'java/com/lingua/arabic');
  mkdirSync(java, { recursive: true });
  writeFileSync(join(java, 'MainActivity.java'), activity);
  writeFileSync(join(main, 'AndroidManifest.xml'), '<?xml version="1.0"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application\n        android:label="Safina">\n    </application>\n</manifest>\n');
  writeFileSync(join(root, 'android/app/build.gradle'), "apply plugin: 'com.android.application'\nandroid { }\ndependencies {\n    implementation project(':capacitor-android')\n}\n");
  writeFileSync(join(root, 'android/variables.gradle'), 'ext {\n    minSdkVersion = 23\n    compileSdkVersion = 35\n}\n');
  mkdirSync(join(root, 'native/android'), { recursive: true });
  cpSync(join(here, 'native/android/LinguaLlmPlugin.java.tpl'), join(root, 'native/android/LinguaLlmPlugin.java.tpl'));
  return root;
}
const run = root => execFileSync(process.execPath, [join(here, 'scripts/patch-llm.mjs')], { env: { ...process.env, SAFINA_ROOT: root }, encoding: 'utf8' });
const ACT_WITH_STORAGE = 'package com.lingua.arabic;\n\nimport android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(LinguaStoragePlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n}\n';

test('plugin installed with the real package, registered before super.onCreate, next to the storage plugin', () => {
  const root = project(ACT_WITH_STORAGE); const out = run(root);
  const dir = join(root, 'android/app/src/main/java/com/lingua/arabic');
  assert.match(readFileSync(join(dir, 'LinguaLlmPlugin.java'), 'utf8'), /^package com\.lingua\.arabic;/m);
  assert.match(readFileSync(join(dir, 'LinguaLlmPlugin.java'), 'utf8'), /@CapacitorPlugin\(name = "LinguaLlm"\)/);
  const act = readFileSync(join(dir, 'MainActivity.java'), 'utf8');
  assert.match(act, /registerPlugin\(LinguaStoragePlugin\.class\);\s*registerPlugin\(LinguaLlmPlugin\.class\);\s*super\.onCreate/);
  assert.match(out, /patched OK/);
});

test('works on a plain Capacitor MainActivity with no onCreate', () => {
  const root = project('package com.lingua.arabic;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n');
  run(root);
  const act = readFileSync(join(root, 'android/app/src/main/java/com/lingua/arabic/MainActivity.java'), 'utf8');
  assert.match(act, /registerPlugin\(LinguaLlmPlugin\.class\);\s*super\.onCreate\(savedInstanceState\)/);
});

test('gradle dependency, minSdk 24, large heap and the optional GPU library are set once', () => {
  const root = project(ACT_WITH_STORAGE); run(root);
  const g = readFileSync(join(root, 'android/app/build.gradle'), 'utf8');
  assert.equal((g.match(/com\.google\.mediapipe:tasks-genai:0\.10\.24/g) || []).length, 1);
  assert.match(g, /implementation project\(':capacitor-android'\)/, 'existing dependencies are kept');
  assert.match(readFileSync(join(root, 'android/variables.gradle'), 'utf8'), /minSdkVersion = 24/);
  const mf = readFileSync(join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.equal((mf.match(/largeHeap/g) || []).length, 1); assert.equal((mf.match(/libOpenCL/g) || []).length, 1);
  assert.equal((mf.match(/<application\b/g) || []).length, 1);
});

test('running it again changes nothing, and the version can be overridden', () => {
  const root = project(ACT_WITH_STORAGE); run(root);
  const files = ['android/app/build.gradle', 'android/variables.gradle', 'android/app/src/main/AndroidManifest.xml', 'android/app/src/main/java/com/lingua/arabic/MainActivity.java'];
  const before = files.map(f => readFileSync(join(root, f), 'utf8'));
  const out = run(root);
  assert.deepEqual(files.map(f => readFileSync(join(root, f), 'utf8')), before);
  assert.match(out, /already/);
  const r2 = project(ACT_WITH_STORAGE);
  execFileSync(process.execPath, [join(here, 'scripts/patch-llm.mjs')], { env: { ...process.env, SAFINA_ROOT: r2, SAFINA_MEDIAPIPE: '0.10.99' } });
  assert.match(readFileSync(join(r2, 'android/app/build.gradle'), 'utf8'), /tasks-genai:0\.10\.99/);
});

test('no android folder: stops with a clear message', () => {
  const root = mkdtempSync(join(tmpdir(), 'safina-llm-empty-'));
  assert.throws(() => run(root), e => /cap add android/.test(String(e.stderr)));
  assert.equal(existsSync(join(root, 'android')), false);
});
