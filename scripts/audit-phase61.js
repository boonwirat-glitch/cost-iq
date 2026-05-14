const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'dist', 'sw.js'), 'utf8');
const checks = [
  ['phase6.1 runtime version installed', html.includes('v155-phase6-1-stabilized-loader')],
  ['phase6.1 loader control installed', html.includes('FreshketSenseLoaderControl') && html.includes('disableRuntime') && html.includes('enableRuntimeNextReload')],
  ['legacy rollback flag supported', html.includes('freshket_loader_runtime_disabled') && html.includes('freshket_force_legacy_loader')],
  ['loader diagnostics installed', html.includes('loaderDiagnostics') && html.includes('printFreshketLoaderDiagnostics')],
  ['phase6 adapter still present', html.includes('FreshketSensePhase6LoaderAdapter')],
  ['proxy only still present', html.includes('AI proxy ยังไม่ถูกตั้งค่า') && !html.includes('https://api.anthropic.com') && !html.includes('generativelanguage.googleapis.com/v1beta/models')],
  ['service worker cache bumped', sw.includes("freshket-sense-v155-phase6-1")],
  ['service worker network-first remains', sw.includes("event.request.mode !== 'navigate'") && sw.includes('fetch(event.request)')],
  ['debug smoke checklist includes loader checks', html.includes('loader control exists') && html.includes('loader adapter status exists')],
];
const failed = checks.filter(([, ok]) => !ok);
checks.forEach(([name, ok]) => console.log(`${ok ? 'OK' : 'FAIL'} ${name}`));
if (failed.length) {
  console.error('Phase 6.1 audit failed:', failed.map(f => f[0]).join(', '));
  process.exit(1);
}
console.log('Phase 6.1 audit passed');
