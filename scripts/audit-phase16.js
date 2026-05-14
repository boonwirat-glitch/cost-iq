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
  const readModel=read('src/runtime/readModelRuntime.js').trim();
  const reportRenderer=read('src/views/reportRenderer.js').trim();
  const overviewRenderer=read('src/views/overviewRenderer.js').trim();
  const markers={
    config:/<script id="freshket-sense-config">[\s\S]*?<\/script>/,
    registry:/<script id="freshket-view-registry">[\s\S]*?<\/script>/,
    readModel:/<script id="freshket-read-model">[\s\S]*?<\/script>/,
    reportRenderer:/<script id="freshket-report-renderer">[\s\S]*?<\/script>/,
    overviewRenderer:/<script id="freshket-overview-renderer">[\s\S]*?<\/script>/
  };
  for(const [name,rx] of Object.entries(markers)) if(!rx.test(html)) throw new Error(`Missing ${name} marker`);
  html=html.replace(markers.config, `<script id="freshket-sense-config">\n${config}\n</script>`);
  html=html.replace(markers.registry, `<script id="freshket-view-registry">\n${registry}\n</script>`);
  html=html.replace(markers.readModel, `<script id="freshket-read-model">\n${readModel}\n</script>`);
  html=html.replace(markers.reportRenderer, `<script id="freshket-report-renderer">\n${reportRenderer}\n</script>`);
  html=html.replace(markers.overviewRenderer, `<script id="freshket-overview-renderer">\n${overviewRenderer}\n</script>`);
  return html;
}
function extractInlineScripts(html){ const scripts=[]; const rx=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi; let m; while((m=rx.exec(html))) scripts.push(m[1]); return scripts; }
function syntaxOk(code,label){ try{ new vm.Script(code,{filename:label}); return true; } catch(err){ console.error(`Syntax error in ${label}:`, err.message); return false; } }
const srcHtml=read('src/app/index.html'), srcConfig=read('src/config/appConfig.js'), srcRegistry=read('src/views/viewRegistry.js'), srcReadModel=read('src/runtime/readModelRuntime.js'), srcReportRenderer=read('src/views/reportRenderer.js'), srcOverviewRenderer=read('src/views/overviewRenderer.js'), srcSw=read('src/app/sw.js');
const rootHtml=read('index.html'), distHtml=read('dist/index.html'), rootSw=read('sw.js'), distSw=read('dist/sw.js');
const expectedHtml=expectedBuiltIndex(); const version=JSON.parse(read('VERSION.json')); const pkg=JSON.parse(read('package.json'));
const builtScriptsOk=extractInlineScripts(rootHtml).every((script,i)=>syntaxOk(script,`dist-inline-script-${i+1}.js`));
const sourceScriptsOk=extractInlineScripts(srcHtml).every((script,i)=>syntaxOk(script,`src-inline-script-${i+1}.js`));
const checks=[
 ['source index exists',exists('src/app/index.html')],
 ['source sw exists',exists('src/app/sw.js')],
 ['source config exists',exists('src/config/appConfig.js')],
 ['view registry source exists',exists('src/views/viewRegistry.js')],
 ['read model source exists',exists('src/runtime/readModelRuntime.js')],
 ['report renderer source exists',exists('src/views/reportRenderer.js')],
 ['overview renderer source exists',exists('src/views/overviewRenderer.js')],
 ['overview renderer source not empty',size('src/views/overviewRenderer.js')>5000],
 ['config version phase16',srcConfig.includes("version: 'v155-phase16-overview-renderer'")],
 ['root index built from source + config + registry + read model + renderers',rootHtml===expectedHtml],
 ['dist index built from source + config + registry + read model + renderers',distHtml===expectedHtml],
 ['root sw generated from source',rootSw===srcSw],
 ['dist sw generated from source',distSw===srcSw],
 ['source inline scripts syntax ok',sourceScriptsOk],
 ['built inline scripts syntax ok',builtScriptsOk],
 ['overview renderer marker exists',srcHtml.includes('id="freshket-overview-renderer"')],
 ['overview renderer global exposed',srcOverviewRenderer.includes('global.FreshketSenseOverviewRenderer')&&rootHtml.includes('global.FreshketSenseOverviewRenderer')],
 ['overview renderer behavior unchanged',srcOverviewRenderer.includes('const BEHAVIOR_CHANGED = false')&&rootHtml.includes('behaviorChanged: BEHAVIOR_CHANGED')],
 ['overview renderer has renderFromLegacy',srcOverviewRenderer.includes('function renderFromLegacy')&&srcOverviewRenderer.includes('renderTrendBars')&&srcOverviewRenderer.includes('renderHeroCurrentMonth')&&srcOverviewRenderer.includes('renderCategories')],
 ['renderOverview delegates to extracted renderer',srcHtml.includes('FreshketSenseOverviewRenderer')&&srcHtml.includes('renderer.renderFromLegacy')&&srcHtml.includes('__legacyRenderOverviewFallback')],
 ['legacy overview fallback retained',srcHtml.includes('function __legacyRenderOverviewFallback()')&&srcHtml.includes('Overview renderer failed, falling back to legacy renderer')],
 ['overview renderer flag adapter retained',srcHtml.includes("if(name === 'heroLockedToCurrent')")&&srcHtml.includes("if(name === 'senseActivated')")&&srcHtml.includes("if(name === 'sgRunning')")],
 ['debug smoke checks overview renderer',srcHtml.includes("['overview renderer exists'")&&srcHtml.includes("['overview renderer validation ok'")],
 ['debug exposes overview renderer diagnostics',srcHtml.includes('printOverviewRendererDiagnostics')&&srcHtml.includes('global.printFreshketOverviewRendererDiagnostics')],
 ['debug snapshot includes overview renderer',srcHtml.includes('overviewRenderer: overviewRendererDiagnostics()')],
 ['report renderer retained',srcReportRenderer.includes('global.FreshketSenseReportRenderer')&&srcHtml.includes('id="freshket-report-renderer"')],
 ['read model retained',srcReadModel.includes('global.FreshketSenseReadModelRuntime')&&srcHtml.includes('id="freshket-read-model"')],
 ['view registry retained',srcRegistry.includes('global.FreshketSenseViewRegistry')&&srcHtml.includes('id="freshket-view-registry"')],
 ['auth runtime retained',srcHtml.includes('global.FreshketSenseAuthRuntime')&&srcHtml.includes('freshket_auth_runtime_disabled')],
 ['loader runtime retained',srcHtml.includes('FreshketSenseLoaderControl')&&srcHtml.includes('freshket_loader_runtime_disabled')],
 ['state runtime retained',srcHtml.includes('global.FreshketSenseStateRuntime')&&srcHtml.includes('freshket_state_runtime_disabled')],
 ['view runtime retained',srcHtml.includes('global.FreshketSenseViewRuntime')&&srcHtml.includes('FreshketSenseViewControl')],
 ['Phase 6.2 chat grounding retained',srcHtml.includes('v155-phase6.2-chat-grounding')&&srcHtml.includes('function oliveChatGroundingClean')],
 ['proxy-only production retained',srcHtml.includes('const PROXY_ONLY_PRODUCTION = true')],
 ['no direct Anthropic browser endpoint',!srcHtml.includes("fetch('https://api.anthropic.com/v1/messages'")],
 ['no Gemini browser endpoint',!srcHtml.includes('generativelanguage.googleapis.com/v1beta/models')],
 ['service worker phase16 cache',srcSw.includes('freshket-sense-v155-phase16')],
 ['continuity docs retained',exists('docs/REFACTOR_CONTINUITY.md')&&exists('docs/CURRENT_BASELINE.md')&&exists('docs/PHASE_LEDGER.md')],
 ['Phase 16 docs exist',exists('docs/PHASE16_OVERVIEW_RENDERER_EXTRACTION.md')&&exists('docs/PHASE16_AUDIT_NOTES.md')&&exists('docs/STAGING_TEST_SCRIPT_PHASE16.md')],
 ['version manifest phase16',version.version==='v155-phase16-overview-renderer'&&version.serviceWorkerCache==='freshket-sense-v155-phase16'&&version.behaviorChanged===false],
 ['package verify uses phase16 audit',pkg.scripts.verify.includes('audit:phase16')]
];
let failed=false; for(const [name,ok] of checks){ console.log(`${ok?'✅':'❌'} ${name}`); if(!ok) failed=true; } if(failed) process.exit(1); console.log('Phase 16 overview renderer extraction audit passed.');
