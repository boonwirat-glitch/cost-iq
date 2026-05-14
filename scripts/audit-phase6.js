const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'dist', 'sw.js'), 'utf8');
const checks = [
  ['phase6 runtime installed', html.includes('v155-phase6-loader-orchestration')],
  ['phase6 adapter installed', html.includes('FreshketSensePhase6LoaderAdapter')],
  ['loader runtime methods present', html.includes('fetchCloudflareFile') && html.includes('startCloudBackgroundLoad') && html.includes('reloadFromCloudflareR2')],
  ['proxy only still present', html.includes('AI proxy ยังไม่ถูกตั้งค่า') && !html.includes('https://api.anthropic.com') && !html.includes('generativelanguage.googleapis.com/v1beta/models')],
  ['service worker cache bumped', sw.includes("freshket-sense-v155-phase6")],
  ['service worker network-first remains', sw.includes("event.request.mode !== 'navigate'") && sw.includes('fetch(event.request)')],
];
const failed = checks.filter(([, ok]) => !ok);
checks.forEach(([name, ok]) => console.log(`${ok ? 'OK' : 'FAIL'} ${name}`));
if (failed.length) {
  console.error('Phase 6 audit failed:', failed.map(f => f[0]).join(', '));
  process.exit(1);
}
console.log('Phase 6 audit passed');
