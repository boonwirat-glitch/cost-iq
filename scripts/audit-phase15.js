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
  const markers={
    config:/<script id="freshket-sense-config">[\s\S]*?<\/script>/,
    registry:/<script id="freshket-view-registry">[\s\S]*?<\/script>/,
    readModel:/<script id="freshket-read-model">[\s\S]*?<\/script>/,
    reportRenderer:/<script id="freshket-report-renderer">[\s\S]*?<\/script>/
  };
  for(const [name,rx] of Object.entries(markers)) if(!rx.test(html)) throw new Error(`Missing ${name} marker`);
  html=html.replace(markers.config, `<script id="freshket-sense-config">\n${config}\n</script>`);
  html=html.replace(markers.registry, `<script id="freshket-view-registry">\n${registry}\n</script>`);
  html=html.replace(markers.readModel, `<script id="freshket-read-model">\n${readModel}\n</script>`);
  html=html.replace(markers.reportRenderer, `<script id="freshket-report-renderer">\n${reportRenderer}\n</script>`);
  return html;
}
function extractInlineScripts(html){ const scripts=[]; const rx=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi; let m; while((m=rx.exec(html))) scripts.push(m[1]); return scripts; }
function syntaxOk(code,label){ try{ new vm.Script(code,{filename:label}); return true; } catch(err){ console.error(`Syntax error in ${label}:`, err.message); return false; } }
const srcHtml=read('src/app/index.html'), srcConfig=read('src/config/appConfig.js'), srcRegistry=read('src/views/viewRegistry.js'), srcReadModel=read('src/runtime/readModelRuntime.js'), srcReportRenderer=read('src/views/reportRenderer.js'), srcSw=read('src/app/sw.js');
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
 ['report renderer source not empty',size('src/views/reportRenderer.js')>5000],
 ['config version phase15',srcConfig.includes("version: 'v155-phase15-report-renderer'")],
 ['root index built from source + config + registry + read model + report renderer',rootHtml===expectedHtml],
 ['dist index built from source + config + registry + read model + report renderer',distHtml===expectedHtml],
 ['root sw generated from source',rootSw===srcSw],
 ['dist sw generated from source',distSw===srcSw],
 ['source inline scripts syntax ok',sourceScriptsOk],
 ['built inline scripts syntax ok',builtScriptsOk],
 ['report renderer marker exists',srcHtml.includes('id="freshket-report-renderer"')],
 ['report renderer global exposed',srcReportRenderer.includes('global.FreshketSenseReportRenderer')&&rootHtml.includes('global.FreshketSenseReportRenderer')],
 ['report renderer behavior unchanged',srcReportRenderer.includes('const BEHAVIOR_CHANGED = false')&&rootHtml.includes('behaviorChanged: BEHAVIOR_CHANGED')],
 ['report renderer has renderFromLegacy',srcReportRenderer.includes('function renderFromLegacy')&&srcReportRenderer.includes('renderRows')&&srcReportRenderer.includes('renderTotal')],
 ['renderReport delegates to extracted renderer',srcHtml.includes('FreshketSenseReportRenderer')&&srcHtml.includes('renderer.renderFromLegacy')&&srcHtml.includes('__legacyRenderReportFallback')],
 ['legacy report fallback retained',srcHtml.includes('function __legacyRenderReportFallback()')&&srcHtml.includes('Report renderer failed, falling back to legacy renderer')],
 ['debug smoke checks report renderer',srcHtml.includes("['report renderer exists'")&&srcHtml.includes("['report renderer validation ok'")],
 ['debug exposes report renderer diagnostics',srcHtml.includes('printReportRendererDiagnostics')&&srcHtml.includes('global.printFreshketReportRendererDiagnostics')],
 ['debug snapshot includes report renderer',srcHtml.includes('reportRenderer: reportRendererDiagnostics()')],
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
 ['service worker phase15 cache',srcSw.includes('freshket-sense-v155-phase15')],
 ['continuity docs retained',exists('docs/REFACTOR_CONTINUITY.md')&&exists('docs/CURRENT_BASELINE.md')&&exists('docs/PHASE_LEDGER.md')],
 ['Phase 15 docs exist',exists('docs/PHASE15_REPORT_RENDERER_EXTRACTION.md')&&exists('docs/PHASE15_AUDIT_NOTES.md')&&exists('docs/STAGING_TEST_SCRIPT_PHASE15.md')],
 ['version manifest phase15',version.version==='v155-phase15-report-renderer'&&version.serviceWorkerCache==='freshket-sense-v155-phase15'&&version.behaviorChanged===false],
 ['package verify uses phase15 audit',pkg.scripts.verify.includes('audit:phase15')]
];
let failed=false; for(const [name,ok] of checks){ console.log(`${ok?'✅':'❌'} ${name}`); if(!ok) failed=true; } if(failed) process.exit(1); console.log('Phase 15 report renderer extraction audit passed.');
