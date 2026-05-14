const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'dist', 'index.html');
const swPath = path.join(root, 'dist', 'sw.js');
const index = fs.readFileSync(indexPath, 'utf8');
const sw = fs.readFileSync(swPath, 'utf8');
const failures = [];
function expect(name, ok){ if(!ok) failures.push(name); }
expect('runtime version phase5.1 present', index.includes('v155-phase5.1-audit-patch'));
expect('proxy-only production flag present', index.includes('PROXY_ONLY_PRODUCTION = true'));
expect('direct key mode cannot be enabled by localStorage alone', !index.includes("localStorage?.getItem('freshket_allow_direct_ai_keys')==='1';"));
expect('direct Anthropic browser endpoint removed', !index.includes('api.anthropic.com/v1/messages'));
expect('direct Gemini browser endpoint removed', !index.includes('generativelanguage.googleapis.com'));
expect('Gemini key input removed from production DOM', !index.includes('id="gemini-api-key"'));
expect('Claude key input removed from production DOM', !index.includes('id="matcher-api-key"'));
expect('debug namespace present', index.includes('FreshketSenseDebug'));
expect('static smoke function present', index.includes('runFreshketStaticSmokeChecklist'));
expect('data runtime fallback snapshot present', index.includes('data runtime unavailable'));
expect('service worker phase5.1 cache', sw.includes("freshket-sense-v155-phase5-1"));
if(failures.length){
  console.error('Phase 5.1 audit failed:');
  failures.forEach(f=>console.error(' - '+f));
  process.exit(1);
}
console.log('Phase 5.1 audit passed');
