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
    'freshket-style-runtime':'src/styles/uiTokenRegistry.js',
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
function cssRootTokens(html){ const m=/:root\s*\{([\s\S]*?)\}/.exec(html); if(!m) return []; return [...m[1].matchAll(/--[a-zA-Z0-9_-]+(?=\s*:)/g)].map(x=>x[0]); }
const srcHtml=read('src/app/index.html'), rootHtml=read('index.html'), distHtml=read('dist/index.html');
const srcSw=read('src/app/sw.js'), rootSw=read('sw.js'), distSw=read('dist/sw.js');
const styleRuntime=read('src/styles/uiTokenRegistry.js'), config=read('src/config/appConfig.js');
const expectedHtml=expectedBuiltIndex();
const version=JSON.parse(read('VERSION.json'));
const sourceScriptsOk=extractInlineScripts(srcHtml).every((script,i)=>syntaxOk(script,`src-inline-script-${i+1}.js`));
const builtScriptsOk=extractInlineScripts(rootHtml).every((script,i)=>syntaxOk(script,`built-inline-script-${i+1}.js`));
const styleSyntaxOk=syntaxOk(styleRuntime, 'src/styles/uiTokenRegistry.js');
const rootTokens=cssRootTokens(srcHtml);
const tokenRefs=(styleRuntime.match(/--[a-zA-Z0-9_-]+/g)||[]).filter((x,i,a)=>a.indexOf(x)===i);
const tokenCoverageOk=rootTokens.length>0 && rootTokens.every(t=>tokenRefs.includes(t));
const checks=[
 ['style runtime source exists',exists('src/styles/uiTokenRegistry.js')],
 ['style runtime source not empty',size('src/styles/uiTokenRegistry.js')>3500],
 ['Phase 21 final docs exist',exists('docs/PHASE21_FINAL_AUDIT_REGRESSION_PACKAGE.md')&&exists('docs/FINAL_REGRESSION_MATRIX.md')&&exists('docs/RELEASE_CHECKLIST_PHASE21.md')&&exists('docs/HANDOFF_FOR_NEXT_WORK.md')],
 ['style runtime syntax ok',styleSyntaxOk],
 ['config version phase21',config.includes("version: 'v155-phase21-final-audit-regression'")],
 ['source marker for style runtime exists',srcHtml.includes('id="freshket-style-runtime"')],
 ['root index built from source + all injected modules',rootHtml===expectedHtml],
 ['dist index built from source + all injected modules',distHtml===expectedHtml],
 ['root sw generated from source',rootSw===srcSw],
 ['dist sw generated from source',distSw===srcSw],
 ['source inline scripts syntax ok',sourceScriptsOk],
 ['built inline scripts syntax ok',builtScriptsOk],
 ['style runtime injected in root output',rootHtml.includes('FreshketSenseStyleRuntime')&&rootHtml.includes('global.getFreshketStyleRuntimeSnapshot')],
 ['style runtime behavior unchanged',styleRuntime.includes('const BEHAVIOR_CHANGED = false')&&rootHtml.includes('behaviorChanged: BEHAVIOR_CHANGED')],
 ['style runtime does not mutate style attribute',!styleRuntime.includes('.style.')&&!styleRuntime.includes('setAttribute(\'style')&&!styleRuntime.includes('classList.add')&&!styleRuntime.includes('classList.remove')],
 ['CSS :root token coverage in registry',tokenCoverageOk],
 ['debug smoke checks style runtime',srcHtml.includes("['style runtime exists'")&&srcHtml.includes("['style runtime validation ok'")],
 ['debug exposes style diagnostics',srcHtml.includes('styleDiagnostics')&&srcHtml.includes('printStyleDiagnostics')&&srcHtml.includes('printFreshketStyleDiagnostics')],
 ['debug snapshot includes style',srcHtml.includes('style: styleDiagnostics()')],
 ['navigation controller retained',srcHtml.includes('id="freshket-navigation-runtime"')&&srcHtml.includes('FreshketSenseNavigationRuntime')],
 ['renderer boundaries retained',srcHtml.includes('FreshketSenseReportRenderer')&&srcHtml.includes('FreshketSenseOverviewRenderer')&&srcHtml.includes('FreshketSensePortfolioRenderer')&&srcHtml.includes('FreshketSenseKamTeamRenderer')],
 ['read model retained',srcHtml.includes('FreshketSenseReadModelRuntime')],
 ['Phase 6.2 chat grounding retained',srcHtml.includes('v155-phase6.2-chat-grounding')&&srcHtml.includes('function oliveChatGroundingClean')],
 ['proxy-only production retained',srcHtml.includes('const PROXY_ONLY_PRODUCTION = true')],
 ['no direct Anthropic browser endpoint',!srcHtml.includes("fetch('https://api.anthropic.com/v1/messages'")&&!rootHtml.includes("fetch('https://api.anthropic.com/v1/messages'")],
 ['no Gemini browser endpoint',!srcHtml.includes('generativelanguage.googleapis.com/v1beta/models')&&!rootHtml.includes('generativelanguage.googleapis.com/v1beta/models')],
 ['service worker phase21 cache',srcSw.includes('freshket-sense-v155-phase21')],
 ['Phase 21 docs exist',exists('docs/PHASE21_FINAL_AUDIT_REGRESSION_PACKAGE.md')&&exists('docs/PHASE21_AUDIT_NOTES.md')&&exists('docs/STAGING_TEST_SCRIPT_PHASE21.md')&&exists('docs/FINAL_REGRESSION_MATRIX.md')&&exists('docs/RELEASE_CHECKLIST_PHASE21.md')&&exists('docs/HANDOFF_FOR_NEXT_WORK.md')],
 ['version manifest phase21',version.version==='v155-phase21-final-audit-regression'&&version.serviceWorkerCache==='freshket-sense-v155-phase21'&&version.behaviorChanged===false]
];
let ok=true; for(const [name,pass] of checks){ if(!pass){ console.error(`FAIL: ${name}`); ok=false; } else console.log(`OK: ${name}`); }
console.log(`CSS token registry coverage: ${tokenRefs.length}/${rootTokens.length} root tokens referenced`);
if(!ok) process.exit(1);
console.log('Phase 21 final audit/regression package audit passed. Product behavior remains intended unchanged; final release docs and regression matrix are present.');
