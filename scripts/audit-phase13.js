const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));
const size = rel => fs.statSync(path.join(root, rel)).size;
function expectedBuiltIndex(){
  let html=read('src/app/index.html');
  const config=read('src/config/appConfig.js').trim();
  const registry=read('src/views/viewRegistry.js').trim();
  const configMarker=/<script id="freshket-sense-config">[\s\S]*?<\/script>/;
  const registryMarker=/<script id="freshket-view-registry">[\s\S]*?<\/script>/;
  if(!configMarker.test(html)) throw new Error('Missing config marker');
  if(!registryMarker.test(html)) throw new Error('Missing view registry marker');
  html = html.replace(configMarker, `<script id="freshket-sense-config">\n${config}\n</script>`);
  html = html.replace(registryMarker, `<script id="freshket-view-registry">\n${registry}\n</script>`);
  return html;
}
function extractInlineScripts(html){ const scripts=[]; const rx=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi; let m; while((m=rx.exec(html))) scripts.push(m[1]); return scripts; }
function syntaxOk(code,label){ try{ new vm.Script(code,{filename:label}); return true; } catch(err){ console.error(`Syntax error in ${label}:`, err.message); return false; } }
const srcHtml=read('src/app/index.html'), srcConfig=read('src/config/appConfig.js'), srcRegistry=read('src/views/viewRegistry.js'), srcSw=read('src/app/sw.js');
const rootHtml=read('index.html'), distHtml=read('dist/index.html'), rootSw=read('sw.js'), distSw=read('dist/sw.js');
const expectedHtml=expectedBuiltIndex(); const version=JSON.parse(read('VERSION.json')); const pkg=JSON.parse(read('package.json'));
const builtScriptsOk=extractInlineScripts(rootHtml).every((script,i)=>syntaxOk(script,`dist-inline-script-${i+1}.js`));
const sourceScriptsOk=extractInlineScripts(srcHtml).every((script,i)=>syntaxOk(script,`src-inline-script-${i+1}.js`));
const requiredRenderers=['renderOverview','renderPortfolio','renderOpps','renderReport','renderKamOverview','renderPortview','renderTeamview'];
const checks=[
 ['source index exists',exists('src/app/index.html')],
 ['source sw exists',exists('src/app/sw.js')],
 ['source config exists',exists('src/config/appConfig.js')],
 ['view registry source exists',exists('src/views/viewRegistry.js')],
 ['view registry source not empty',size('src/views/viewRegistry.js')>6000],
 ['view runtime source exists',exists('src/runtime/viewBoundaryRuntime.js')],
 ['legacy view adapter source exists',exists('src/runtime/legacyViewAdapter.js')],
 ['config version phase13',srcConfig.includes("version: 'v155-phase13-view-registry-inventory'")],
 ['root index built from source + config + registry',rootHtml===expectedHtml],
 ['dist index built from source + config + registry',distHtml===expectedHtml],
 ['root sw generated from source',rootSw===srcSw],
 ['dist sw generated from source',distSw===srcSw],
 ['source inline scripts syntax ok',sourceScriptsOk],
 ['built inline scripts syntax ok',builtScriptsOk],
 ['registry marker exists',srcHtml.includes('id="freshket-view-registry"')],
 ['registry global exposed',srcRegistry.includes('global.FreshketSenseViewRegistry')&&rootHtml.includes('global.FreshketSenseViewRegistry')],
 ['view runtime reads registry',srcHtml.includes('const REGISTRY = global.FreshketSenseViewRegistry')&&srcHtml.includes('registryVersion')],
 ['Phase 13 view runtime inline block present',srcHtml.includes('PHASE 13 VIEW REGISTRY / RENDERER INVENTORY')&&srcHtml.includes('global.FreshketSenseViewRuntime')],
 ['Phase 13 legacy adapter diagnostic only',srcHtml.includes('global.FreshketSensePhase13ViewAdapter')&&srcHtml.includes('behaviorChanged: false')&&srcHtml.includes('No legacy view functions are overridden in Phase 13')],
 ['registry contains core screens',srcRegistry.includes('overview:')&&srcRegistry.includes('portfolio:')&&srcRegistry.includes('opportunities:')&&srcRegistry.includes('teamview:')],
 ['registry contains extraction order',srcRegistry.includes('extractionOrder')&&srcRegistry.includes('low-risk-renderer-extract')&&srcRegistry.includes('report')],
 ['registry contains required renderers',requiredRenderers.every(fn=>srcRegistry.includes(fn))],
 ['debug smoke checks view registry',srcHtml.includes("['view registry exists'")&&srcHtml.includes("['view runtime exists'")&&srcHtml.includes("['view runtime validation ok'")],
 ['debug snapshot includes view',srcHtml.includes('view: viewDiagnostics()')],
 ['auth runtime retained',srcHtml.includes('global.FreshketSenseAuthRuntime')&&srcHtml.includes('freshket_auth_runtime_disabled')],
 ['loader runtime retained',srcHtml.includes('FreshketSenseLoaderControl')&&srcHtml.includes('freshket_loader_runtime_disabled')],
 ['state runtime retained',srcHtml.includes('global.FreshketSenseStateRuntime')&&srcHtml.includes('freshket_state_runtime_disabled')],
 ['Phase 6.2 chat grounding retained',srcHtml.includes('v155-phase6.2-chat-grounding')&&srcHtml.includes('function oliveChatGroundingClean')],
 ['no SAMPLE fallback in chat skus',!srcHtml.includes('const _skus=D.skus.length?D.skus:SAMPLE.skus')],
 ['weekly unavailable marker retained',srcHtml.includes('weekly_data: not_available')],
 ['proxy-only production retained',srcHtml.includes('const PROXY_ONLY_PRODUCTION = true')],
 ['no direct Anthropic browser endpoint',!srcHtml.includes("fetch('https://api.anthropic.com/v1/messages'")],
 ['no Gemini browser endpoint',!srcHtml.includes('generativelanguage.googleapis.com/v1beta/models')],
 ['service worker phase13 cache',srcSw.includes('freshket-sense-v155-phase13')],
 ['Cloudflare worker proxy source exists',exists('workers/ai-proxy-cloudflare-worker.js')],
 ['Phase 13 docs exist',exists('docs/PHASE13_VIEW_REGISTRY_INVENTORY.md')&&exists('docs/STAGING_TEST_SCRIPT_PHASE13.md')&&exists('docs/PHASE13_AUDIT_NOTES.md')],
 ['version manifest phase13',version.version==='v155-phase13-view-registry-inventory'&&version.serviceWorkerCache==='freshket-sense-v155-phase13'&&version.behaviorChanged===false],
 ['package verify uses phase13 audit',pkg.scripts.verify.includes('audit:phase13')]
];
let failed=false; for(const [name,ok] of checks){ console.log(`${ok?'✅':'❌'} ${name}`); if(!ok) failed=true; } if(failed) process.exit(1); console.log('Phase 13 view registry / renderer inventory audit passed.');
