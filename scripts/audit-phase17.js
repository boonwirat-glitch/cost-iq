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
    'freshket-portfolio-renderer':'src/views/portfolioRenderer.js'
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
const srcPortfolioRenderer=read('src/views/portfolioRenderer.js'), srcOverviewRenderer=read('src/views/overviewRenderer.js'), srcReportRenderer=read('src/views/reportRenderer.js');
const expectedHtml=expectedBuiltIndex(); const version=JSON.parse(read('VERSION.json')); const pkg=JSON.parse(read('package.json'));
const builtScriptsOk=extractInlineScripts(rootHtml).every((script,i)=>syntaxOk(script,`dist-inline-script-${i+1}.js`));
const sourceScriptsOk=extractInlineScripts(srcHtml).every((script,i)=>syntaxOk(script,`src-inline-script-${i+1}.js`));
const checks=[
 ['source index exists',exists('src/app/index.html')],
 ['source sw exists',exists('src/app/sw.js')],
 ['source config exists',exists('src/config/appConfig.js')],
 ['portfolio renderer source exists',exists('src/views/portfolioRenderer.js')],
 ['portfolio renderer source not empty',size('src/views/portfolioRenderer.js')>7000],
 ['config version phase17',srcConfig.includes("version: 'v155-phase17-portfolio-sku-renderer'")],
 ['root index built from source + config + registry + read model + renderers',rootHtml===expectedHtml],
 ['dist index built from source + config + registry + read model + renderers',distHtml===expectedHtml],
 ['root sw generated from source',rootSw===srcSw],
 ['dist sw generated from source',distSw===srcSw],
 ['source inline scripts syntax ok',sourceScriptsOk],
 ['built inline scripts syntax ok',builtScriptsOk],
 ['portfolio renderer marker exists',srcHtml.includes('id="freshket-portfolio-renderer"')],
 ['portfolio renderer global exposed',srcPortfolioRenderer.includes('global.FreshketSensePortfolioRenderer')&&rootHtml.includes('global.FreshketSensePortfolioRenderer')],
 ['portfolio renderer behavior unchanged',srcPortfolioRenderer.includes('const BEHAVIOR_CHANGED = false')&&rootHtml.includes('behaviorChanged: BEHAVIOR_CHANGED')],
 ['portfolio renderer extracts portfolio and SKU list',srcPortfolioRenderer.includes('renderPortfolioFromLegacy')&&srcPortfolioRenderer.includes('renderSKUListFromLegacy')&&srcPortfolioRenderer.includes('sku-price-filter-row')],
 ['renderPortfolio delegates to extracted renderer',srcHtml.includes('FreshketSensePortfolioRenderer')&&srcHtml.includes('renderer.renderPortfolioFromLegacy')&&srcHtml.includes('__legacyRenderPortfolioFallback')],
 ['renderSKUList delegates to extracted renderer',srcHtml.includes('renderer.renderSKUListFromLegacy')&&srcHtml.includes('__legacyRenderSKUListFallback')],
 ['legacy portfolio fallback retained',srcHtml.includes('function __legacyRenderPortfolioFallback()')&&srcHtml.includes('Portfolio renderer failed, falling back to legacy renderer')],
 ['legacy SKU fallback retained',srcHtml.includes('function __legacyRenderSKUListFallback(passedSkus)')&&srcHtml.includes('SKU list renderer failed, falling back to legacy renderer')],
 ['debug smoke checks portfolio renderer',srcHtml.includes("['portfolio renderer exists'")&&srcHtml.includes("['portfolio renderer validation ok'")],
 ['debug exposes portfolio renderer diagnostics',srcHtml.includes('printPortfolioRendererDiagnostics')&&srcHtml.includes('global.printFreshketPortfolioRendererDiagnostics')],
 ['debug snapshot includes portfolio renderer',srcHtml.includes('portfolioRenderer: portfolioRendererDiagnostics()')],
 ['overview renderer retained',srcOverviewRenderer.includes('global.FreshketSenseOverviewRenderer')&&srcHtml.includes('id="freshket-overview-renderer"')],
 ['report renderer retained',srcReportRenderer.includes('global.FreshketSenseReportRenderer')&&srcHtml.includes('id="freshket-report-renderer"')],
 ['read model retained',srcHtml.includes('id="freshket-read-model"')&&srcHtml.includes('global.FreshketSenseReadModelRuntime')],
 ['Phase 6.2 chat grounding retained',srcHtml.includes('v155-phase6.2-chat-grounding')&&srcHtml.includes('function oliveChatGroundingClean')],
 ['proxy-only production retained',srcHtml.includes('const PROXY_ONLY_PRODUCTION = true')],
 ['no direct Anthropic browser endpoint',!srcHtml.includes("fetch('https://api.anthropic.com/v1/messages'")],
 ['no Gemini browser endpoint',!srcHtml.includes('generativelanguage.googleapis.com/v1beta/models')],
 ['service worker phase17 cache',srcSw.includes('freshket-sense-v155-phase17')],
 ['Phase 17 docs exist',exists('docs/PHASE17_PORTFOLIO_SKU_RENDERER_EXTRACTION.md')&&exists('docs/PHASE17_AUDIT_NOTES.md')&&exists('docs/STAGING_TEST_SCRIPT_PHASE17.md')],
 ['version manifest phase17',version.version==='v155-phase17-portfolio-sku-renderer'&&version.serviceWorkerCache==='freshket-sense-v155-phase17'&&version.behaviorChanged===false],
 ['package verify uses phase17 audit',pkg.scripts.verify.includes('audit:phase17')]
];
let failed=false; for(const [name,ok] of checks){ console.log(`${ok?'✅':'❌'} ${name}`); if(!ok) failed=true; } if(failed) process.exit(1); console.log('Phase 17 portfolio/SKU renderer extraction audit passed.');
