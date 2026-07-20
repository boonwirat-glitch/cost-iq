// tools/verify_category_bonus.js
// v_catbonus regression harness — proves per-category / per-group_key Upsell
// bonus rates: precedence group > category > base, fallback to base for an
// unlisted category, a stored 0 beating base, and ONE shared map driving
// BOTH P1 and P3 (Bush's locked decisions, 2026-07-19).
//
// Usage: node tools/verify_category_bonus.js

global.window = {};
const fakeEl = () => ({ classList: { add(){}, remove(){}, contains(){return false;} },
  appendChild(){}, id: '', textContent: '', style: {}, addEventListener(){} });
global.document = {
  getElementById: () => null, createElement: () => fakeEl(), addEventListener: () => {},
  querySelector: () => null, head: fakeEl(), body: fakeEl()
};
global.portviewBulkData = [];
global.bulkUpsellData = { byKam: {}, baselineGroups: {}, groupCategory: {}, loaded: true };

eval(require('fs').readFileSync(__dirname + '/../src/07a_commission_engine.js', 'utf8'));

let fails = 0;
function check(label, actual, expected) {
  const ok = Math.abs(actual - expected) < 0.01;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : '*** FAIL ***'}  ${label}  actual=${actual}  expected=${expected}`);
}

// ── Part 1: _commUpsellRateFor pure-function precedence ──────────────────
console.log('\n=== Part 1: _commUpsellRateFor precedence ===');
const rm = { categoryRates: { Vegetable: 0.03, Meat: 0 }, groupRates: { 'มิกซ์สลัด': 0.05 } };
check('group override wins over category', _commUpsellRateFor(rm, 0.01, 'Vegetable', 'มิกซ์สลัด'), 0.05);
check('category override when no group', _commUpsellRateFor(rm, 0.01, 'Vegetable', 'ผักอื่น'), 0.03);
check('base rate when neither', _commUpsellRateFor(rm, 0.015, 'Fruit', 'กล้วย'), 0.015);
check('stored 0 category beats base', _commUpsellRateFor(rm, 0.01, 'Meat', 'เนื้อ'), 0);
check('empty map → base', _commUpsellRateFor({ categoryRates:{}, groupRates:{} }, 0.02, 'Vegetable', 'x'), 0.02);
check('null map → base', _commUpsellRateFor(null, 0.02, 'Vegetable', 'x'), 0.02);

// ── Part 2: _commComputeUpsellSku applies per-group rates (P1 + P3) ──────
console.log('\n=== Part 2: engine applies per-group rate, shared P1+P3 map ===');

// Inject the category_bonus rule via previewResolver (the engine's own
// unsaved-draft injection hook — cleaner than reassigning the module's
// let-scoped _commRuleConfig from the harness). Returning undefined for other
// metrics means "no draft → use real resolution", which resolves to null
// here → base rate falls back to _commGetConfig default 0.01.
const previewResolver = (pc, mc, mv) => {
  if (mc === 'upsell_gmv' && mv === 'category_bonus') {
    return { active: true, params: {}, tiers: [],
      tier_config: { category_rates: { Vegetable: 0.03 }, group_rates: { 'มิกซ์สลัด': 0.05 } } };
  }
  return undefined;
};

// Find a baseMonthOverride that makes exactly 1 quarter month elapsed today.
function overrideFor1() {
  const now = new Date();
  for (let mb = 1; mb <= 24; mb++) {
    const d = new Date(now.getFullYear(), now.getMonth() - mb, 1);
    const o = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    if (_commElapsedQuarterLabels(o).length === 1) return o;
  }
  throw new Error('no override found');
}
const override = overrideFor1();
const lbl = _commElapsedQuarterLabels(override)[0];
const kamName = 'Test KAM';
global.portviewBulkData = [{ kamEmail: 'ning@freshket.co', kamName, daysElapsed: 20 }];

// 3 P1 groups (all new, all ≥5000): มิกซ์สลัด(Veg,group-ovr), ผักอื่น(Veg,cat-ovr), เนื้อ(Meat,base)
const outletGroups = {
  'มิกซ์สลัด': { [lbl]: { totalGmv: 100000, existingGmv: 0 } },
  'ผักอื่น':   { [lbl]: { totalGmv: 100000, existingGmv: 0 } },
  'เนื้อ':      { [lbl]: { totalGmv: 100000, existingGmv: 0 } }
};
global.bulkUpsellData = {
  loaded: true,
  byKam: { [kamName]: { acct1: { outlet1: outletGroups } } },
  baselineGroups: { [kamName]: { acct1: { outlet1: new Set() } } }, // empty = all P1
  groupCategory: { 'มิกซ์สลัด': 'Vegetable', 'ผักอื่น': 'Vegetable', 'เนื้อ': 'Meat' }
};

const p1res = _commComputeUpsellSku('ning@freshket.co', new Set(), override, 'KAM_TEST', previewResolver);
const byGroup = {};
p1res.p1.groups.forEach(g => { byGroup[g.groupKey] = g; });
check('P1 มิกซ์สลัด uses group rate 5%', byGroup['มิกซ์สลัด'].commission, 100000 * 0.05);
check('P1 ผักอื่น uses category rate 3%', byGroup['ผักอื่น'].commission, 100000 * 0.03);
check('P1 เนื้อ uses base rate 1%', byGroup['เนื้อ'].commission, 100000 * 0.01);
check('P1 total = 5000+3000+1000', p1res.p1.comm, 100000*0.05 + 100000*0.03 + 100000*0.01);
check('applied_rate recorded on group', byGroup['มิกซ์สลัด'].applied_rate, 0.05);

// P3: existing group ผักอื่น (Vegetable), baseline 20k/mo, current 200k → incremental 180k.
// SAME category map must drive P3 → 3%.
const p3Labels = _commBaseMonthLabels(override, 3);
const p3OutletGroups = { 'ผักอื่น': { [lbl]: { totalGmv: 200000, existingGmv: 200000 } } };
p3Labels.forEach(l => { p3OutletGroups['ผักอื่น'][l] = { totalGmv: 20000, existingGmv: 20000 }; });
global.bulkUpsellData = {
  loaded: true,
  byKam: { [kamName]: { acct1: { outlet1: p3OutletGroups } } },
  baselineGroups: { [kamName]: { acct1: { outlet1: new Set(['ผักอื่น']) } } }, // in baseline = P3
  groupCategory: { 'ผักอื่น': 'Vegetable' }
};
const p3res = _commComputeUpsellSku('ning@freshket.co', new Set(), override, 'KAM_TEST', previewResolver);
const p3g = p3res.p3.groups[0];
check('P3 ผักอื่น incremental = 180k', p3res.p3.gmv_incremental, 180000);
check('P3 uses SAME category map (3%), not base', p3g.commission, 180000 * 0.03);
check('P3 applied_rate = 0.03', p3g.applied_rate, 0.03);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}`);
process.exit(fails === 0 ? 0 : 1);
