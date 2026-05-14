const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
function read(rel){ return fs.readFileSync(path.join(root, rel), 'utf8'); }
function assert(cond, msg){ if(!cond){ console.error('FAIL:', msg); process.exitCode = 1; } }
const src = read('src/app/index.html');
const cfg = read('src/config/appConfig.js');
const built = read('index.html');
const dist = read('dist/index.html');

assert(cfg.includes("defaultProxyUrl: 'https://freshket-sense-ai-proxy.boonwirat-t.workers.dev'"), 'config should include default AI proxy URL');
assert(src.includes('defaultProxyUrl'), 'src/app/index.html should read defaultProxyUrl');
assert(built.includes("defaultProxyUrl: 'https://freshket-sense-ai-proxy.boonwirat-t.workers.dev'"), 'built index should include default AI proxy URL');
assert(built.includes('configDefault'), 'built index getAiProxyUrl should include config default fallback');
assert(read('src/app/sw.js').includes('freshket-sense-v155-phase22-1'), 'source sw cache should be phase22-1');
assert(read('sw.js').includes('freshket-sense-v155-phase22-1'), 'root sw cache should be phase22-1');
assert(read('dist/sw.js').includes('freshket-sense-v155-phase22-1'), 'dist sw cache should be phase22-1');
assert(built === dist, 'root index should match dist index');
assert(read('sw.js') === read('dist/sw.js'), 'root sw should match dist sw');
assert(!built.includes('api.anthropic.com/v1/messages'), 'deploy HTML should not include direct Anthropic endpoint');
assert(!built.includes('generativelanguage.googleapis.com'), 'deploy HTML should not include direct Gemini endpoint');
assert(built.includes('OLIVE CHAT V2 TASK'), 'Olive Chat v2 should be retained');
assert(built.includes('You are not a screen reader'), 'Olive Chat v2 context policy should be retained');
const scripts = [...built.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
for (let i=0;i<scripts.length;i++){
  try { new Function(scripts[i]); }
  catch (e) { console.error('FAIL: inline script syntax error at script', i, e.message); process.exitCode = 1; break; }
}
if (process.exitCode) process.exit(process.exitCode);
console.log('Phase 22.1 AI proxy default audit passed.');
