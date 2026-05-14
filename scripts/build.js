const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceIndex = path.join(root, 'src', 'app', 'index.html');
const sourceSw = path.join(root, 'src', 'app', 'sw.js');
const sourceConfig = path.join(root, 'src', 'config', 'appConfig.js');
const sourceStyleRuntime = path.join(root, 'src', 'styles', 'uiTokenRegistry.js');
const sourceViewRegistry = path.join(root, 'src', 'views', 'viewRegistry.js');
const sourceReadModel = path.join(root, 'src', 'runtime', 'readModelRuntime.js');
const sourceNavigationRuntime = path.join(root, 'src', 'runtime', 'navigationRuntime.js');
const sourceReportRenderer = path.join(root, 'src', 'views', 'reportRenderer.js');
const sourceOverviewRenderer = path.join(root, 'src', 'views', 'overviewRenderer.js');
const sourcePortfolioRenderer = path.join(root, 'src', 'views', 'portfolioRenderer.js');
const sourceKamTeamRenderer = path.join(root, 'src', 'views', 'kamTeamRenderer.js');
const dist = path.join(root, 'dist');

function rel(p) { return path.relative(root, p); }
function write(dest, content) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}
function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

if (!fs.existsSync(sourceIndex)) throw new Error(`Missing source of truth: ${rel(sourceIndex)}`);
if (!fs.existsSync(sourceSw)) throw new Error(`Missing source of truth: ${rel(sourceSw)}`);
if (!fs.existsSync(sourceConfig)) throw new Error(`Missing config source: ${rel(sourceConfig)}`);
if (!fs.existsSync(sourceStyleRuntime)) throw new Error(`Missing style runtime source: ${rel(sourceStyleRuntime)}`);
if (!fs.existsSync(sourceViewRegistry)) throw new Error(`Missing view registry source: ${rel(sourceViewRegistry)}`);
if (!fs.existsSync(sourceReadModel)) throw new Error(`Missing read model source: ${rel(sourceReadModel)}`);
if (!fs.existsSync(sourceNavigationRuntime)) throw new Error(`Missing navigation runtime source: ${rel(sourceNavigationRuntime)}`);
if (!fs.existsSync(sourceReportRenderer)) throw new Error(`Missing report renderer source: ${rel(sourceReportRenderer)}`);
if (!fs.existsSync(sourceOverviewRenderer)) throw new Error(`Missing overview renderer source: ${rel(sourceOverviewRenderer)}`);
if (!fs.existsSync(sourcePortfolioRenderer)) throw new Error(`Missing portfolio renderer source: ${rel(sourcePortfolioRenderer)}`);
if (!fs.existsSync(sourceKamTeamRenderer)) throw new Error(`Missing KAM/Team renderer source: ${rel(sourceKamTeamRenderer)}`);

const htmlTemplate = fs.readFileSync(sourceIndex, 'utf8');
const configInline = fs.readFileSync(sourceConfig, 'utf8').trim();
const styleRuntimeInline = fs.readFileSync(sourceStyleRuntime, 'utf8').trim();
const viewRegistryInline = fs.readFileSync(sourceViewRegistry, 'utf8').trim();
const readModelInline = fs.readFileSync(sourceReadModel, 'utf8').trim();
const navigationRuntimeInline = fs.readFileSync(sourceNavigationRuntime, 'utf8').trim();
const reportRendererInline = fs.readFileSync(sourceReportRenderer, 'utf8').trim();
const overviewRendererInline = fs.readFileSync(sourceOverviewRenderer, 'utf8').trim();
const portfolioRendererInline = fs.readFileSync(sourcePortfolioRenderer, 'utf8').trim();
const kamTeamRendererInline = fs.readFileSync(sourceKamTeamRenderer, 'utf8').trim();

function injectBlock(html, id, inlineSource, label) {
  const marker = new RegExp(`<script id="${id}">[\\s\\S]*?<\\/script>`);
  const block = `<script id="${id}">\n${inlineSource}\n</script>`;
  if (!marker.test(html)) {
    throw new Error(`Missing <script id="${id}"> marker in src/app/index.html`);
  }
  return html.replace(marker, block);
}

let builtIndex = injectBlock(htmlTemplate, 'freshket-sense-config', configInline, 'config');
builtIndex = injectBlock(builtIndex, 'freshket-style-runtime', styleRuntimeInline, 'style runtime');
builtIndex = injectBlock(builtIndex, 'freshket-view-registry', viewRegistryInline, 'view registry');
builtIndex = injectBlock(builtIndex, 'freshket-read-model', readModelInline, 'read model');
builtIndex = injectBlock(builtIndex, 'freshket-navigation-runtime', navigationRuntimeInline, 'navigation runtime');
builtIndex = injectBlock(builtIndex, 'freshket-report-renderer', reportRendererInline, 'report renderer');
builtIndex = injectBlock(builtIndex, 'freshket-overview-renderer', overviewRendererInline, 'overview renderer');
builtIndex = injectBlock(builtIndex, 'freshket-portfolio-renderer', portfolioRendererInline, 'portfolio renderer');
builtIndex = injectBlock(builtIndex, 'freshket-kam-team-renderer', kamTeamRendererInline, 'KAM/Team renderer');

fs.mkdirSync(dist, { recursive: true });

// Source of truth: src/app/index.html + src/config/appConfig.js + src/views/viewRegistry.js + src/runtime/readModelRuntime.js + src/views/reportRenderer.js + src/views/overviewRenderer.js + src/views/portfolioRenderer.js + src/app/sw.js
// Generated outputs: root files for current Cloudflare Pages workflow + dist files for future build-driven workflow.
write(path.join(root, 'index.html'), builtIndex);
copy(sourceSw, path.join(root, 'sw.js'));
write(path.join(dist, 'index.html'), builtIndex);
copy(sourceSw, path.join(dist, 'sw.js'));

console.log('Built Phase 21 deploy files from src/app + src/config + src/styles/uiTokenRegistry + src/views/viewRegistry + src/runtime/readModelRuntime + src/runtime/navigationRuntime + src/views/reportRenderer + src/views/overviewRenderer + src/views/portfolioRenderer + src/views/kamTeamRenderer + src/runtime/navigationRuntime: /index.html, /sw.js, /dist/index.html, /dist/sw.js');
