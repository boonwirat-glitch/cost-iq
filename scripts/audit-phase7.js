const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));

const html = read('index.html');
const distHtml = read('dist/index.html');
const sw = read('sw.js');
const distSw = read('dist/sw.js');

const checks = [
  ['root index exists', exists('index.html')],
  ['root sw exists', exists('sw.js')],
  ['dist index exists', exists('dist/index.html')],
  ['dist sw exists', exists('dist/sw.js')],
  ['src exists', exists('src')],
  ['docs exists', exists('docs')],
  ['scripts exists', exists('scripts')],
  ['workers exists', exists('workers')],
  ['root and dist index match', html === distHtml],
  ['root and dist sw match', sw === distSw],
  ['Phase 6.2 chat grounding retained', html.includes('v155-phase6.2-chat-grounding') && html.includes('function oliveChatGroundingClean')],
  ['no SAMPLE fallback in chat skus', !html.includes('const _skus=D.skus.length?D.skus:SAMPLE.skus')],
  ['weekly unavailable marker retained', html.includes('weekly_data: not_available')],
  ['proxy-only production retained', html.includes('const PROXY_ONLY_PRODUCTION = true')],
  ['no direct Anthropic browser endpoint', !html.includes("fetch('https://api.anthropic.com/v1/messages'")],
  ['no Gemini browser endpoint', !html.includes('generativelanguage.googleapis.com/v1beta/models')],
  ['service worker phase7 cache', sw.includes("freshket-sense-v155-phase7")],
  ['Cloudflare worker proxy source exists', exists('workers/ai-proxy-cloudflare-worker.js')],
  ['Phase 7 docs exist', exists('docs/PHASE7_SOURCE_REPO_STRUCTURE.md') && exists('docs/BASELINE_DECISION.md')]
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log('Phase 7 source repo audit passed.');
