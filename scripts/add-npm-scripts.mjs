// Adds the Safina scripts to YOUR existing package.json without touching anything else
// (dependencies, lockfile and every other field are left exactly as they are).
//   node scripts/add-npm-scripts.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'package.json');
const pkg = JSON.parse(readFileSync(file, 'utf8'));
pkg.scripts = pkg.scripts || {};
const want = {
  'build:web': 'node scripts/build-web.mjs',
  'verify:onnx': 'node scripts/verify-onnx.mjs',
  'test': 'node --test "tests/*.test.mjs"'
};
let changed = 0;
for (const [k, v] of Object.entries(want)) {
  if (pkg.scripts[k] !== v) { pkg.scripts[k] = v; changed++; }
}
if (changed) {
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  console.log('package.json: updated ' + changed + ' script(s).');
} else console.log('package.json: scripts already present.');
if (!pkg.type) console.log('note: package.json has no "type" field; that is fine, the scripts use .mjs files.');
