const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));
const size = rel => fs.statSync(path.join(root, rel)).size;
function expectedBuiltIndex(){
  let html=read('src/app/index.html');
  const injects={
    'freshket-sense-config':'src/config/appConfig.js',
    'freshket-view-registry':'src/views/viewRegistry.js',
    'freshket-read-model':'src/runtime/readModelRuntime.js',
    'freshket-report-renderer':'src/views/reportRenderer.js',
    'freshket-overview-renderer':'src/views/overviewRenderer.js',
    'freshket-portfolio-renderer':'src/views/portfolioRenderer.js',
    'freshket-kam-team-renderer':'src/views/kamTeamRenderer.js'
  };
  for(const [id,file] of Object.entries(injects)){
    const rx=new RegExp(`<script id="${id}">[\\s\\S]*?<\\/script>`);
    if(!rx.test(html)) throw new Error(`Missing ${id} marker`);
    html=html.replace(rx, `<script id="${id}">\n${read(file).trim()}\n</script>`);
  }
  return html;
}
function extractInlineScripts(html){ const scripts=[]; const rx=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi; let m; while((m=rx.exec(html))) scripts.push(m[1]); return scripts; }
function syntaxOk(code,label){ try{ new vm.Script(code,{filename:label}); return true; } catch(err){ console.error(`Syntax error in ${label}:`, err.message); return false; } }
const srcHtml=read('src/app/index.html'), srcConfig=read('src/config/appConfig.js'), srcSw=read('src/app/sw.js');
const rootHtml=read('index.html'), distHtml=read('dist/index.html'), rootSw=read('sw.js'), distSw=read('dist/sw.js');
const srcKam=read('src/views/kamTeamRenderer.js');
const expectedHtml=expectedBuiltIndex();
const version=JSON.parse(read('VERSION.json'));
const builtScriptsOk=extractInlineScripts(rootHtml).every((script,i)=>syntaxOk(script,`dist-inline-script-${i+1}.js`));
const sourceScriptsOk=extractInlineScripts(srcHtml).every((script,i)=>syntaxOk(script,`src-inline-script-${i+1}.js`));
const wrapped=['renderKamThisMonth','renderKamLastMonth','renderKamOverview','renderPortview','renderPortviewSummary','renderPortviewList','renderTeamview','renderTeamviewSummary','renderTeamviewKamList'];
const fallbacks=['__legacyRenderKamThisMonthFallback','__legacyRenderKamLastMonthFallback','__legacyRenderKamOverviewFallback','__legacyRenderPortviewFallback','__legacyRenderPortviewSummaryFallback','__legacyRenderPortviewListFallback','__legacyRenderTeamviewFallback','__legacyRenderTeamviewSummaryFallback','__legacyRenderTeamviewKamListFallback'];
const wrappersOk = wrapped.every(fn => srcHtml.includes(`function ${fn}(){`) && srcHtml.includes(`FreshketSenseKamTeamRenderer`) && srcHtml.includes(`renderer failed, falling back to legacy renderer`));
const fallbacksOk = fallbacks.every(fn => srcHtml.includes(`function ${fn}(){`));
const checks=[
 ['source index exists',exists('src/app/index.html')],
 ['KAM/Team renderer source exists',exists('src/views/kamTeamRenderer.js')],
 ['KAM/Team renderer source not empty',size('src/views/kamTeamRenderer.js')>4500],
 ['config version phase18',srcConfig.includes("version: 'v155-phase18-kam-team-renderer'")],
 ['root index built from source + all injected modules',rootHtml===expectedHtml],
 ['dist index built from source + all injected modules',distHtml===expectedHtml],
 ['root sw generated from source',rootSw===srcSw],
 ['dist sw generated from source',distSw===srcSw],
 ['source inline scripts syntax ok',sourceScriptsOk],
 ['built inline scripts syntax ok',builtScriptsOk],
 ['KAM/Team renderer marker exists',srcHtml.includes('id="freshket-kam-team-renderer"')],
 ['KAM/Team renderer global exposed',srcKam.includes('global.FreshketSenseKamTeamRenderer')&&rootHtml.includes('global.FreshketSenseKamTeamRenderer')],
 ['KAM/Team renderer behavior unchanged',srcKam.includes('const BEHAVIOR_CHANGED = false')&&rootHtml.includes('behaviorChanged: BEHAVIOR_CHANGED')],
 ['KAM/Team renderer has all method adapters',wrapped.every(fn => srcKam.includes(fn+'FromLegacy') || fn==='renderKamOverview' && srcKam.includes('renderKamOverviewFromLegacy'))],
 ['legacy wrappers installed',wrappersOk],
 ['legacy fallbacks retained',fallbacksOk],
 ['debug smoke checks KAM/Team renderer',srcHtml.includes("['KAM/Team renderer exists'")&&srcHtml.includes("['KAM/Team renderer validation ok'")],
 ['debug exposes KAM/Team diagnostics',srcHtml.includes('printKamTeamRendererDiagnostics')&&srcHtml.includes('global.printFreshketKamTeamRendererDiagnostics')],
 ['debug snapshot includes KAM/Team renderer',srcHtml.includes('kamTeamRenderer: kamTeamRendererDiagnostics()')],
 ['report renderer retained',srcHtml.includes('id="freshket-report-renderer"')&&srcHtml.includes('FreshketSenseReportRenderer')],
 ['overview renderer retained',srcHtml.includes('id="freshket-overview-renderer"')&&srcHtml.includes('FreshketSenseOverviewRenderer')],
 ['portfolio renderer retained',srcHtml.includes('id="freshket-portfolio-renderer"')&&srcHtml.includes('FreshketSensePortfolioRenderer')],
 ['read model retained',srcHtml.includes('id="freshket-read-model"')&&srcHtml.includes('FreshketSenseReadModelRuntime')],
 ['Phase 6.2 chat grounding retained',srcHtml.includes('v155-phase6.2-chat-grounding')&&srcHtml.includes('function oliveChatGroundingClean')],
 ['proxy-only production retained',srcHtml.includes('const PROXY_ONLY_PRODUCTION = true')],
 ['no direct Anthropic browser endpoint',!srcHtml.includes("fetch('https://api.anthropic.com/v1/messages'")],
 ['no Gemini browser endpoint',!srcHtml.includes('generativelanguage.googleapis.com/v1beta/models')],
 ['service worker phase18 cache',srcSw.includes('freshket-sense-v155-phase18')],
 ['Phase 18 docs exist',exists('docs/PHASE18_KAM_TEAM_RENDERER_BOUNDARY.md')&&exists('docs/PHASE18_AUDIT_NOTES.md')&&exists('docs/STAGING_TEST_SCRIPT_PHASE18.md')],
 ['version manifest phase18',version.version==='v155-phase18-kam-team-renderer'&&version.serviceWorkerCache==='freshket-sense-v155-phase18'&&version.behaviorChanged===false]
];
let ok=true; for(const [name,pass] of checks){ if(!pass){ console.error(`FAIL: ${name}`); ok=false; } else console.log(`OK: ${name}`); }
if(!ok) process.exit(1);
console.log('Phase 18 audit passed.');
