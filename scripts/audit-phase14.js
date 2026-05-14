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
  const configMarker=/<script id="freshket-sense-config">[\s\S]*?<\/script>/;
  const registryMarker=/<script id="freshket-view-registry">[\s\S]*?<\/script>/;
  const readModelMarker=/<script id="freshket-read-model">[\s\S]*?<\/script>/;
  if(!configMarker.test(html)) throw new Error('Missing config marker');
  if(!registryMarker.test(html)) throw new Error('Missing view registry marker');
  if(!readModelMarker.test(html)) throw new Error('Missing read model marker');
  html = html.replace(configMarker, `<script id="freshket-sense-config">\n${config}\n</script>`);
  html = html.replace(registryMarker, `<script id="freshket-view-registry">\n${registry}\n</script>`);
  html = html.replace(readModelMarker, `<script id="freshket-read-model">\n${readModel}\n</script>`);
  return html;
}
function extractInlineScripts(html){ const scripts=[]; const rx=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi; let m; while((m=rx.exec(html))) scripts.push(m[1]); return scripts; }
function syntaxOk(code,label){ try{ new vm.Script(code,{filename:label}); return true; } catch(err){ console.error(`Syntax error in ${label}:`, err.message); return false; } }
const srcHtml=read('src/app/index.html'), srcConfig=read('src/config/appConfig.js'), srcRegistry=read('src/views/viewRegistry.js'), srcReadModel=read('src/runtime/readModelRuntime.js'), srcSw=read('src/app/sw.js');
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
 ['read model source not empty',size('src/runtime/readModelRuntime.js')>9000],
 ['config version phase14',srcConfig.includes("version: 'v155-phase14-read-model-boundary'")],
 ['root index built from source + config + registry + read model',rootHtml===expectedHtml],
 ['dist index built from source + config + registry + read model',distHtml===expectedHtml],
 ['root sw generated from source',rootSw===srcSw],
 ['dist sw generated from source',distSw===srcSw],
 ['source inline scripts syntax ok',sourceScriptsOk],
 ['built inline scripts syntax ok',builtScriptsOk],
 ['read model marker exists',srcHtml.includes('id="freshket-read-model"')],
 ['read model global exposed',srcReadModel.includes('global.FreshketSenseReadModelRuntime')&&rootHtml.includes('global.FreshketSenseReadModelRuntime')],
 ['read model is behavior unchanged',srcReadModel.includes('const BEHAVIOR_CHANGED = false')&&rootHtml.includes('behaviorChanged: BEHAVIOR_CHANGED')],
 ['read model selectors exist',srcReadModel.includes('function accountIdentity')&&srcReadModel.includes('function reportModel')&&srcReadModel.includes('function portviewModel')&&srcReadModel.includes('function teamviewModel')],
 ['read model validates all screen models',srcReadModel.includes("'overview'")&&srcReadModel.includes("'teamview'")&&srcReadModel.includes('validate()')],
 ['debug smoke checks read model',srcHtml.includes("['read model runtime exists'")&&srcHtml.includes("['read model validation ok'")],
 ['debug snapshot includes read model',srcHtml.includes('readModel: readModelDiagnostics()')],
 ['debug exposes read model diagnostics',srcHtml.includes('printReadModelDiagnostics')&&srcHtml.includes('global.printFreshketReadModelDiagnostics')],
 ['view registry retained',srcRegistry.includes('global.FreshketSenseViewRegistry')&&srcHtml.includes('id="freshket-view-registry"')],
 ['auth runtime retained',srcHtml.includes('global.FreshketSenseAuthRuntime')&&srcHtml.includes('freshket_auth_runtime_disabled')],
 ['loader runtime retained',srcHtml.includes('FreshketSenseLoaderControl')&&srcHtml.includes('freshket_loader_runtime_disabled')],
 ['state runtime retained',srcHtml.includes('global.FreshketSenseStateRuntime')&&srcHtml.includes('freshket_state_runtime_disabled')],
 ['view runtime retained',srcHtml.includes('global.FreshketSenseViewRuntime')&&srcHtml.includes('FreshketSenseViewControl')],
 ['Phase 6.2 chat grounding retained',srcHtml.includes('v155-phase6.2-chat-grounding')&&srcHtml.includes('function oliveChatGroundingClean')],
 ['proxy-only production retained',srcHtml.includes('const PROXY_ONLY_PRODUCTION = true')],
 ['no direct Anthropic browser endpoint',!srcHtml.includes("fetch('https://api.anthropic.com/v1/messages'")],
 ['no Gemini browser endpoint',!srcHtml.includes('generativelanguage.googleapis.com/v1beta/models')],
 ['service worker phase14 cache',srcSw.includes('freshket-sense-v155-phase14')],
 ['continuity docs exist',exists('docs/REFACTOR_CONTINUITY.md')&&exists('docs/CURRENT_BASELINE.md')&&exists('docs/PHASE_LEDGER.md')],
 ['Phase 14 docs exist',exists('docs/PHASE14_READ_MODEL_BOUNDARY.md')&&exists('docs/PHASE14_AUDIT_NOTES.md')&&exists('docs/STAGING_TEST_SCRIPT_PHASE14.md')],
 ['version manifest phase14',version.version==='v155-phase14-read-model-boundary'&&version.serviceWorkerCache==='freshket-sense-v155-phase14'&&version.behaviorChanged===false],
 ['package verify uses phase14 audit',pkg.scripts.verify.includes('audit:phase14')]
];
let failed=false; for(const [name,ok] of checks){ console.log(`${ok?'✅':'❌'} ${name}`); if(!ok) failed=true; } if(failed) process.exit(1); console.log('Phase 14 continuity + read model boundary audit passed.');
