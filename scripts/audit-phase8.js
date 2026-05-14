const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));
const size = rel => fs.statSync(path.join(root, rel)).size;

const srcHtml = read('src/app/index.html');
const srcSw = read('src/app/sw.js');
const rootHtml = read('index.html');
const distHtml = read('dist/index.html');
const rootSw = read('sw.js');
const distSw = read('dist/sw.js');

const debugSize = exists('src/runtime/debugRuntime.js') ? size('src/runtime/debugRuntime.js') : 0;

const checks = [
  ['source index exists', exists('src/app/index.html')],
  ['source sw exists', exists('src/app/sw.js')],
  ['root index exists', exists('index.html')],
  ['root sw exists', exists('sw.js')],
  ['dist index exists', exists('dist/index.html')],
  ['dist sw exists', exists('dist/sw.js')],
  ['root index generated from source', rootHtml === srcHtml],
  ['dist index generated from source', distHtml === srcHtml],
  ['root sw generated from source', rootSw === srcSw],
  ['dist sw generated from source', distSw === srcSw],
  ['Phase 6.2 chat grounding retained', srcHtml.includes('v155-phase6.2-chat-grounding') && srcHtml.includes('function oliveChatGroundingClean')],
  ['no SAMPLE fallback in chat skus', !srcHtml.includes('const _skus=D.skus.length?D.skus:SAMPLE.skus')],
  ['weekly unavailable marker retained', srcHtml.includes('weekly_data: not_available')],
  ['proxy-only production retained', srcHtml.includes('const PROXY_ONLY_PRODUCTION = true')],
  ['no direct Anthropic browser endpoint', !srcHtml.includes("fetch('https://api.anthropic.com/v1/messages'")],
  ['no Gemini browser endpoint', !srcHtml.includes('generativelanguage.googleapis.com/v1beta/models')],
  ['service worker phase8 cache', srcSw.includes("freshket-sense-v155-phase8")],
  ['Cloudflare worker proxy source exists', exists('workers/ai-proxy-cloudflare-worker.js')],
  ['Phase 8 docs exist', exists('docs/PHASE8_BUILD_DISCIPLINE.md') && exists('docs/STAGING_TEST_SCRIPT_PHASE8.md')],
  ['version manifest exists', exists('VERSION.json') && read('VERSION.json').includes('v155-phase8-build-discipline')],
  ['debug runtime source trimmed', debugSize > 1000 && debugSize < 30000],
  ['archived older baseline separated', exists('src/archive/legacy-baselines')]
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log('Phase 8 build discipline audit passed.');
