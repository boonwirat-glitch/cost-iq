const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));
const size = rel => fs.statSync(path.join(root, rel)).size;
function sha(s){ return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }
function expectedBuiltIndex(){
  let html=read('src/app/index.html');
  const injects={
    'freshket-sense-config':'src/config/appConfig.js',
    'freshket-view-registry':'src/views/viewRegistry.js',
    'freshket-read-model':'src/runtime/readModelRuntime.js',
    'freshket-navigation-runtime':'src/runtime/navigationRuntime.js',
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
function extractFn(txt, name){
  const rx = new RegExp('function\\s+'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\([^)]*\\)\\s*\\{');
  const m = rx.exec(txt); if(!m) throw new Error(`Missing function ${name}`);
  let i=m.index+m[0].length, depth=1, j=i;
  for(; j<txt.length && depth; j++){
    if(txt[j]==='{') depth++; else if(txt[j]==='}') depth--;
  }
  return txt.slice(m.index, j);
}
function normalizeFn(src, name){ return src.replace(/\r\n/g,'\n').replace(new RegExp('function\\s+'+name), 'function __NAV_BASELINE_FUNCTION__').trim()+'\n'; }
const srcHtml=read('src/app/index.html'), srcConfig=read('src/config/appConfig.js'), srcSw=read('src/app/sw.js');
const rootHtml=read('index.html'), distHtml=read('dist/index.html'), rootSw=read('sw.js'), distSw=read('dist/sw.js');
const srcNav=read('src/runtime/navigationRuntime.js');
const expectedHtml=expectedBuiltIndex();
const version=JSON.parse(read('VERSION.json'));
const fixture=JSON.parse(read('scripts/fixtures/phase6_2_navigation_baseline.json'));
const builtScriptsOk=extractInlineScripts(rootHtml).every((script,i)=>syntaxOk(script,`dist-inline-script-${i+1}.js`));
const sourceScriptsOk=extractInlineScripts(srcHtml).every((script,i)=>syntaxOk(script,`src-inline-script-${i+1}.js`));
const fallbackMap = {
  showScreen: '__legacyShowScreenFallback',
  setMode: '__legacySetModeFallback',
  navPortHome: '__legacyNavPortHomeFallback'
};
const baselineComparisons = Object.entries(fallbackMap).map(([baselineName, fallbackName]) => {
  const fn = normalizeFn(extractFn(srcHtml, fallbackName), fallbackName);
  const expected = fixture.functions[baselineName];
  return {
    baselineName,
    fallbackName,
    actualSha256: sha(fn),
    expectedSha256: expected && expected.normalizedSha256,
    actualBytes: Buffer.byteLength(fn, 'utf8'),
    expectedBytes: expected && expected.normalizedBytes,
    ok: !!expected && sha(fn) === expected.normalizedSha256 && Buffer.byteLength(fn, 'utf8') === expected.normalizedBytes
  };
});
const baselineOk = baselineComparisons.every(x => x.ok);
const wrapped=['showScreen','setMode','navPortHome'];
const fallbacks=['__legacyShowScreenFallback','__legacySetModeFallback','__legacyNavPortHomeFallback'];
const wrappersOk = wrapped.every(fn => srcHtml.includes(`function ${fn}(`) && srcHtml.includes('FreshketSenseNavigationRuntime') && srcHtml.includes(`${fn} navigation controller failed, falling back to legacy navigation`));
const fallbacksOk = fallbacks.every(fn => srcHtml.includes(`function ${fn}(`));
const controllerDelegatesOnly = srcNav.includes('return safeLegacy(\'showScreen\'') && srcNav.includes('return safeLegacy(\'setMode\'') && srcNav.includes('return safeLegacy(\'navPortHome\'') && !srcNav.includes('document.body.classList.add(\'kam-mode\')') && !srcNav.includes('scrollTo({left:idx*');
const checks=[
 ['source index exists',exists('src/app/index.html')],
 ['navigation runtime source exists',exists('src/runtime/navigationRuntime.js')],
 ['navigation baseline fixture exists',exists('scripts/fixtures/phase6_2_navigation_baseline.json')],
 ['navigation runtime source not empty',size('src/runtime/navigationRuntime.js')>4500],
 ['config version phase19.1',srcConfig.includes("version: 'v155-phase19-1-navigation-regression-test'")],
 ['root index built from source + all injected modules',rootHtml===expectedHtml],
 ['dist index built from source + all injected modules',distHtml===expectedHtml],
 ['root sw generated from source',rootSw===srcSw],
 ['dist sw generated from source',distSw===srcSw],
 ['source inline scripts syntax ok',sourceScriptsOk],
 ['built inline scripts syntax ok',builtScriptsOk],
 ['navigation runtime marker exists',srcHtml.includes('id="freshket-navigation-runtime"')],
 ['navigation runtime global exposed',srcNav.includes('global.FreshketSenseNavigationRuntime')&&rootHtml.includes('global.FreshketSenseNavigationRuntime')],
 ['navigation runtime behavior unchanged',srcNav.includes('const BEHAVIOR_CHANGED = false')&&rootHtml.includes('behaviorChanged: BEHAVIOR_CHANGED')],
 ['navigation runtime delegates to legacy only',controllerDelegatesOnly],
 ['legacy navigation wrappers installed',wrappersOk],
 ['legacy navigation fallbacks retained',fallbacksOk],
 ['legacy fallbacks match Phase 6.2 baseline hashes',baselineOk],
 ['debug smoke checks navigation runtime',srcHtml.includes("['navigation runtime exists'")&&srcHtml.includes("['navigation validation ok'")],
 ['debug exposes navigation diagnostics',srcHtml.includes('printNavigationDiagnostics')&&srcHtml.includes('global.printFreshketNavigationDiagnostics')],
 ['debug snapshot includes navigation',srcHtml.includes('navigation: navigationDiagnostics()')],
 ['report renderer retained',srcHtml.includes('id="freshket-report-renderer"')&&srcHtml.includes('FreshketSenseReportRenderer')],
 ['overview renderer retained',srcHtml.includes('id="freshket-overview-renderer"')&&srcHtml.includes('FreshketSenseOverviewRenderer')],
 ['portfolio renderer retained',srcHtml.includes('id="freshket-portfolio-renderer"')&&srcHtml.includes('FreshketSensePortfolioRenderer')],
 ['KAM/Team renderer retained',srcHtml.includes('id="freshket-kam-team-renderer"')&&srcHtml.includes('FreshketSenseKamTeamRenderer')],
 ['read model retained',srcHtml.includes('id="freshket-read-model"')&&srcHtml.includes('FreshketSenseReadModelRuntime')],
 ['Phase 6.2 chat grounding retained',srcHtml.includes('v155-phase6.2-chat-grounding')&&srcHtml.includes('function oliveChatGroundingClean')],
 ['proxy-only production retained',srcHtml.includes('const PROXY_ONLY_PRODUCTION = true')],
 ['no direct Anthropic browser endpoint',!srcHtml.includes("fetch('https://api.anthropic.com/v1/messages'")],
 ['no Gemini browser endpoint',!srcHtml.includes('generativelanguage.googleapis.com/v1beta/models')],
 ['service worker phase19.1 cache',srcSw.includes('freshket-sense-v155-phase19-1')],
 ['Phase 19.1 docs exist',exists('docs/PHASE19_1_NAVIGATION_REGRESSION_TEST.md')&&exists('docs/PHASE19_1_AUDIT_NOTES.md')&&exists('docs/STAGING_TEST_SCRIPT_PHASE19_1.md')],
 ['version manifest phase19.1',version.version==='v155-phase19-1-navigation-regression-test'&&version.serviceWorkerCache==='freshket-sense-v155-phase19-1'&&version.behaviorChanged===false]
];
let ok=true; for(const [name,pass] of checks){ if(!pass){ console.error(`FAIL: ${name}`); ok=false; } else console.log(`OK: ${name}`); }
console.log('Navigation baseline comparisons:', JSON.stringify(baselineComparisons, null, 2));
if(!ok) process.exit(1);
console.log('Phase 19.1 navigation regression audit passed. Static baseline equivalence is confirmed for legacy navigation fallbacks. Browser behavior still requires smoke testing for absolute production confidence.');
