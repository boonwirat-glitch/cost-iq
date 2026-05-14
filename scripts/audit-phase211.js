const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
function read(rel){ return fs.readFileSync(path.join(root, rel), 'utf8'); }
function assert(cond, msg){ if(!cond){ console.error('FAIL:', msg); process.exitCode = 1; } }
const files = ['src/app/index.html','index.html','dist/index.html','src/runtime/appStateRuntime.js'];
for (const rel of files){
  const text = read(rel);
  assert(text.includes('knownKeys: knownStorageKeys'), `${rel} should map knownKeys to knownStorageKeys`);
  assert(!text.includes('\n      knownKeys,\n'), `${rel} should not contain undefined knownKeys shorthand`);
}
assert(read('src/app/sw.js').includes("freshket-sense-v155-phase21-1"), 'source sw cache should be phase21-1');
assert(read('sw.js').includes("freshket-sense-v155-phase21-1"), 'root sw cache should be phase21-1');
assert(read('dist/sw.js').includes("freshket-sense-v155-phase21-1"), 'dist sw cache should be phase21-1');
assert(read('index.html') === read('dist/index.html'), 'root index should match dist index');
assert(read('sw.js') === read('dist/sw.js'), 'root sw should match dist sw');
if (process.exitCode) process.exit(process.exitCode);
console.log('Phase 21.1 audit passed.');
