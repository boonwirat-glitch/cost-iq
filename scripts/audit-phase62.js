const fs = require('fs');
const html = fs.readFileSync('dist/index.html','utf8');
const sw = fs.readFileSync('dist/sw.js','utf8');
const required = [
  'weekly_data: not_available',
  'supplier_data: not_available',
  'menu_data: not_available',
  'function oliveChatGroundingClean',
  'Do not force a rigid template every time',
  'สมมติฐานที่ต้องถามยืนยัน',
  'no-fallback' // soft marker checked below via message instead
];
const checks = [
  ['no SAMPLE fallback in chat skus', !html.includes('const _skus=D.skus.length?D.skus:SAMPLE.skus')],
  ['no SAMPLE fallback in chat cats', !html.includes('const _cats=D.cats.length?D.cats:SAMPLE.cats')],
  ['no SAMPLE fallback in chat history', !html.includes('const _hist=D.history.length?D.history:SAMPLE.history')],
  ['grounding clean function present', html.includes('function oliveChatGroundingClean')],
  ['cleanReply uses grounding clean', html.includes('oliveChatGroundingClean(oliveToneClean(reply), _context, _scope)')],
  ['weekly unavailable marker present', html.includes('weekly_data: not_available')],
  ['supplier unavailable marker present', html.includes('supplier_data: not_available')],
  ['flexible output instruction present', html.includes('Do not force a rigid template every time')],
  ['cache bumped phase6-2', sw.includes('freshket-sense-v155-phase6-2')],
  ['proxy only still active', html.includes('const PROXY_ONLY_PRODUCTION = true')],
  ['no direct Anthropic browser endpoint', !html.includes("fetch('https://api.anthropic.com/v1/messages'" )],
  ['no Gemini browser endpoint', !html.includes('generativelanguage.googleapis.com/v1beta/models')]
];
let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log('Phase 6.2 chat grounding audit passed.');
