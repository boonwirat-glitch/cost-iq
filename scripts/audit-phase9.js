const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));
const size = rel => fs.statSync(path.join(root, rel)).size;

function expectedBuiltIndex(){
  const html = read('src/app/index.html');
  const config = read('src/config/appConfig.js').trim();
  const marker = /<script id="freshket-sense-config">[\s\S]*?<\/script>/;
  if(!marker.test(html)) throw new Error('Missing config marker in src/app/index.html');
  return html.replace(marker, `<script id="freshket-sense-config">\n${config}\n</script>`);
}

const srcHtml = read('src/app/index.html');
const srcConfig = read('src/config/appConfig.js');
const srcSw = read('src/app/sw.js');
const rootHtml = read('index.html');
const distHtml = read('dist/index.html');
const rootSw = read('sw.js');
const distSw = read('dist/sw.js');
const expectedHtml = expectedBuiltIndex();
const debugSize = exists('src/runtime/debugRuntime.js') ? size('src/runtime/debugRuntime.js') : 0;

const checks = [
  ['source index exists', exists('src/app/index.html')],
  ['source sw exists', exists('src/app/sw.js')],
  ['source config exists', exists('src/config/appConfig.js')],
  ['config exposes FreshketSenseConfig', srcConfig.includes('global.FreshketSenseConfig = config')],
  ['config version phase9', srcConfig.includes('v155-phase9-config-extraction')],
  ['config has no Claude/Gemini secrets', !/sk-ant-api03-|AIzaSy/.test(srcConfig)],
  ['app index has config injection marker', srcHtml.includes('script id="freshket-sense-config"')],
  ['root index built from source + config', rootHtml === expectedHtml],
  ['dist index built from source + config', distHtml === expectedHtml],
  ['root sw generated from source', rootSw === srcSw],
  ['dist sw generated from source', distSw === srcSw],
  ['Supabase config reads from config boundary', srcHtml.includes('FRESHKET_APP_CONFIG.supabase')],
  ['R2 top-level config reads from config boundary', srcHtml.includes('FRESHKET_APP_CONFIG.data && FRESHKET_APP_CONFIG.data.r2Base')],
  ['data runtime reads from FreshketSenseConfig', srcHtml.includes('const DATA_RUNTIME_VERSION = \'v155-phase9-config-extraction\'') && srcHtml.includes('const DATA_CFG = CFG.data || {}')],
  ['orchestration keys read from config boundary', srcHtml.includes('const ORCH_DATA_CFG = ORCH_CFG.data || {}')],
  ['AI proxy storage key reads from config boundary', srcHtml.includes('getAiProxyStorageKey') && srcHtml.includes('proxyStorageKey')],
  ['chat fab position key reads from config boundary', srcHtml.includes('chatFabPositionKey')],
  ['Phase 6.2 chat grounding retained', srcHtml.includes('v155-phase6.2-chat-grounding') && srcHtml.includes('function oliveChatGroundingClean')],
  ['no SAMPLE fallback in chat skus', !srcHtml.includes('const _skus=D.skus.length?D.skus:SAMPLE.skus')],
  ['weekly unavailable marker retained', srcHtml.includes('weekly_data: not_available')],
  ['proxy-only production retained', srcHtml.includes('const PROXY_ONLY_PRODUCTION = true')],
  ['no direct Anthropic browser endpoint', !srcHtml.includes("fetch('https://api.anthropic.com/v1/messages'")],
  ['no Gemini browser endpoint', !srcHtml.includes('generativelanguage.googleapis.com/v1beta/models')],
  ['service worker phase9 cache', srcSw.includes("freshket-sense-v155-phase9")],
  ['Cloudflare worker proxy source exists', exists('workers/ai-proxy-cloudflare-worker.js')],
  ['Phase 9 docs exist', exists('docs/PHASE9_CONFIG_EXTRACTION.md') && exists('docs/STAGING_TEST_SCRIPT_PHASE9.md')],
  ['version manifest phase9', exists('VERSION.json') && read('VERSION.json').includes('v155-phase9-config-extraction')],
  ['debug runtime source still trimmed', debugSize > 1000 && debugSize < 30000]
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log('Phase 9 config extraction audit passed.');
