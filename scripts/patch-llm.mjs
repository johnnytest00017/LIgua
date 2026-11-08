// Installs the on-phone AI engine into the generated android/ project, so the downloaded model can actually run:
//   1. copies native/android/LinguaLlmPlugin.java.tpl into the app's Java package
//   2. registers it in MainActivity (before super.onCreate)
//   3. adds the MediaPipe LLM dependency to android/app/build.gradle
//   4. raises minSdkVersion to 24 (the minimum MediaPipe needs) and allows a large heap
// Run it AFTER scripts/patch-android.sh / patch-android.mjs. Safe to run again: it changes nothing twice.
// SAFINA_ROOT points at another project folder (tests); SAFINA_MEDIAPIPE overrides the library version.
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.SAFINA_ROOT || fileURLToPath(new URL('..', import.meta.url));
const VERSION = process.env.SAFINA_MEDIAPIPE || '0.10.24';   // check Maven Central for a newer 0.10.x if the build cannot resolve it
const fail = m => { console.error('\nPATCH FAILED: ' + m + '\n'); process.exit(1); };
const note = m => console.log(m);

const android = join(root, 'android');
if (!existsSync(android)) fail('there is no android/ folder. Run "npx cap add android" first.');
const main = join(android, 'app/src/main');

function findMainActivity(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { const r = findMainActivity(p); if (r) return r; }
    else if (e === 'MainActivity.java') return p;
  }
  return null;
}
const javaRoot = join(main, 'java');
const activityPath = existsSync(javaRoot) ? findMainActivity(javaRoot) : null;
if (!activityPath) fail('MainActivity.java was not found under android/app/src/main/java');
const dir = activityPath.slice(0, activityPath.lastIndexOf('/'));
let act = readFileSync(activityPath, 'utf8');
const pkg = (act.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1];
if (!pkg) fail('could not read the package name from MainActivity.java');

// 1. the plugin
const tplPath = join(root, 'native/android/LinguaLlmPlugin.java.tpl');
if (!existsSync(tplPath)) fail('native/android/LinguaLlmPlugin.java.tpl is missing');
const plugin = readFileSync(tplPath, 'utf8').replace(/^package\s+[\w.]+\s*;/m, 'package ' + pkg + ';');
const pluginPath = join(dir, 'LinguaLlmPlugin.java');
if (!existsSync(pluginPath) || readFileSync(pluginPath, 'utf8') !== plugin) { writeFileSync(pluginPath, plugin); note('wrote  LinguaLlmPlugin.java'); } else note('plugin: already installed');

// 2. register it
if (!/registerPlugin\(\s*LinguaLlmPlugin\.class\s*\)/.test(act)) {
  if (/registerPlugin\(\s*LinguaStoragePlugin\.class\s*\)\s*;/.test(act)) {
    act = act.replace(/(registerPlugin\(\s*LinguaStoragePlugin\.class\s*\)\s*;)/, '$1\n        registerPlugin(LinguaLlmPlugin.class);');
  } else if (/super\.onCreate\(/.test(act)) {
    act = act.replace(/(\n[ \t]*)(super\.onCreate\()/, '$1registerPlugin(LinguaLlmPlugin.class);$1$2');
  } else {
    act = act.replace(/(class\s+MainActivity\s+extends\s+BridgeActivity\s*)\{\s*\}/, '$1{\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        registerPlugin(LinguaLlmPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n}');
  }
  if (!/registerPlugin\(\s*LinguaLlmPlugin\.class\s*\)/.test(act)) fail('could not register the plugin in MainActivity.java; add registerPlugin(LinguaLlmPlugin.class); before super.onCreate yourself');
  writeFileSync(activityPath, act); note('registered in MainActivity');
} else note('MainActivity: already registered');

// 3. dependency
const gradlePath = join(android, 'app/build.gradle');
if (!existsSync(gradlePath)) fail('android/app/build.gradle not found');
let g = readFileSync(gradlePath, 'utf8');
if (!g.includes('com.google.mediapipe:tasks-genai')) {
  if (!/dependencies\s*\{/.test(g)) fail('no dependencies block in android/app/build.gradle');
  g = g.replace(/dependencies\s*\{/, "dependencies {\n    implementation 'com.google.mediapipe:tasks-genai:" + VERSION + "'");
  writeFileSync(gradlePath, g); note('added MediaPipe ' + VERSION);
} else note('gradle: MediaPipe already present');

// 4. minSdk and heap
const varsPath = join(android, 'variables.gradle');
if (existsSync(varsPath)) {
  const v = readFileSync(varsPath, 'utf8'), m = v.match(/minSdkVersion\s*=\s*(\d+)/);
  if (m && +m[1] < 24) { writeFileSync(varsPath, v.replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 24')); note('minSdkVersion raised to 24'); }
}
const mfPath = join(main, 'AndroidManifest.xml');
if (existsSync(mfPath)) {
  let mf = readFileSync(mfPath, 'utf8'), changed = false;
  if (!/android:largeHeap=/.test(mf)) { mf = mf.replace(/<application\b/, '<application\n        android:largeHeap="true"'); changed = true; }
  if (!/libOpenCL\.so/.test(mf)) { mf = mf.replace(/(<application\b[^>]*>)/, '$1\n        <uses-native-library android:name="libOpenCL.so" android:required="false" />'); changed = true; }
  if (changed) { writeFileSync(mfPath, mf); note('manifest: large heap + optional GPU library'); }
}
console.log('\npatched OK (on-phone AI engine)');
