// tools/verify_nrr_precision_tiers.js — verifies the v92 %NRR
// rounding-before-decision fix in src/07a_commission_engine.js.
//
// Rather than exercising the full _commBuildKamPayout/_commBuildTlPayout
// pipeline (which also computes upsell/handover/etc — unrelated surface
// area that would need heavy, fragile mocking), this harness targets the
// EXACT unit that had the bug: _nrrGovernedPct (source rounding) feeding
// _commMatchTierByCode/_commPayoutForPctByCode (tier lookup) and
// _commComputeGmvGate (gate cap). Each is called directly with the two
// documented boundary ratios, using both the OLD (rounded) and NEW
// (unrounded) pct to demonstrate the exact decision flip.
//
// Quarterly mode's own source fix (07c_qnrr_view.js:332-334, removing
// Math.round before the value flows into _qnrrComputeForCommission's
// `nrr: (monthData.nrr_pct||0)/100`) was verified by direct code
// inspection — that one-line arithmetic change has no branching/tier
// logic of its own to unit-test in isolation; it feeds the exact same
// _nrrGovernedPct/_commMatchTierByCode/_commComputeGmvGate chain tested
// here, so this harness covers its downstream effect too.
//
// Usage: node tools/verify_nrr_precision_tiers.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function domStub() {
  return {
    head: { appendChild: function () {} },
    body: { appendChild: function () {} },
    addEventListener: function () {},
    getElementById: function () { return null; },
    createElement: function () { return { style: {}, appendChild: function () {}, setAttribute: function () {} }; }
  };
}

function setGlobal(ctx, name, value) {
  ctx.__inject = value;
  vm.runInContext(name + ' = __inject;', ctx);
  delete ctx.__inject;
}

function makeCtx() {
  const ctx = { window: {}, document: domStub(), navigator: {}, localStorage: { getItem: () => null, setItem: () => {} }, console, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/07a_commission_engine.js'), 'utf8'), ctx);
  // Synthetic KAM_NRR_STD tier: min_value 95, open-ended, ฿10,000 payout —
  // matches the documented "94.6% vs tier boundary 95" example.
  setGlobal(ctx, '_commRuleConfig', {
    plans: { KAM_NRR_STD: { id: 'rule1', plan_code: 'KAM_NRR_STD', beneficiary_role: 'kam', status: 'active' } },
    rules: { rule1: { id: 'rule1', payout_type: 'flat_amount', measurement_scope: 'governed_nrr' } },
    tiers: { rule1: [{ min_value: 95, max_value: null, payout_value: 10000, payout_label: 'Tier A' }] }
  });
  // Synthetic gate config matching the documented live defaults
  // (threshold_1=98, cap_1=0.3) used in the 97.96% example.
  setGlobal(ctx, '_tgtSettings', { gmv_gate_params: { threshold_1: 98, threshold_2: 95, cap_1: 0.3, cap_2: 0 } });
  return ctx;
}

let pass = 0, fail = 0;
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✓ ' + desc); }
  else { fail++; console.log('  ✗ ' + desc + '\n      expected: ' + JSON.stringify(expected) + '\n      actual:   ' + JSON.stringify(actual)); }
}

console.log('── %NRR rounding-before-decision fix ──\n');

const ctx = makeCtx();

console.log('_nrrGovernedPct — no premature rounding');
// Compared to 10 decimal places, not exact equality — 0.9796*100 hits normal
// IEEE-754 binary float representation noise (97.96000000000001), unrelated
// to this fix; what matters is it's NOT rounded to a whole number (98) or
// even 1 decimal (98.0), which the other checks below already prove via
// _commFmtPct and the tier/gate decisions.
check('  0.9796 → 97.96 (not 98)', Math.round(vm.runInContext('_nrrGovernedPct({nrr: 0.9796})', ctx) * 1e10) / 1e10, 97.96);
check('  0.946 → 94.6 (not 95)', Math.round(vm.runInContext('_nrrGovernedPct({nrr: 0.946})', ctx) * 1e10) / 1e10, 94.6);
check('  null nrr → null', vm.runInContext('_nrrGovernedPct({nrr: null})', ctx), null);

console.log('\n_commFmtPct — 1-decimal display formatter');
check('  97.96 → "98.0%" (display rounds, decision does not)', vm.runInContext('_commFmtPct(97.96)', ctx), '98.0%');
check('  94.6 → "94.6%"', vm.runInContext('_commFmtPct(94.6)', ctx), '94.6%');
check('  null → "—"', vm.runInContext('_commFmtPct(null)', ctx), '—');

console.log('\nTier boundary: true ratio 94.6%, tier min_value:95');
check('  OLD behavior (rounded pct=95) wrongly clears the tier', vm.runInContext("!!_commMatchTierByCode('KAM_NRR_STD','kam',95)", ctx), true);
check('  NEW behavior (unrounded pct=94.6) correctly stays below tier', vm.runInContext("!!_commMatchTierByCode('KAM_NRR_STD','kam',94.6)", ctx), false);
check('  NEW payout for 94.6% is ฿0 (no tier matched)', vm.runInContext("_commPayoutForPctByCode('KAM_NRR_STD','kam',94.6)", ctx), 0);
check('  NEW payout for exactly 95.0% is ฿10,000 (boundary inclusive)', vm.runInContext("_commPayoutForPctByCode('KAM_NRR_STD','kam',95.0)", ctx), 10000);

console.log('\nGate boundary: true ratio 97.96%, gate threshold_1:98, cap_1:0.3');
const oldGate = vm.runInContext("_commComputeGmvGate('kam@test.co', 98)", ctx); // old rounded pct
const newGate = vm.runInContext("_commComputeGmvGate('kam@test.co', 97.96)", ctx); // new unrounded pct
check('  OLD behavior (rounded pct=98) wrongly clears the gate (cap=1.0)', oldGate.cap_multiplier, 1.0);
check('  NEW behavior (unrounded pct=97.96) correctly applies cap_1 (cap=0.3)', newGate.cap_multiplier, 0.3);

console.log('\nConcrete payout impact — ฿100,000 subtotal at 97.96% NRR');
const oldFinal = Math.round(100000 * oldGate.cap_multiplier);
const newFinal = Math.round(100000 * newGate.cap_multiplier);
check('  OLD (buggy) final payout', oldFinal, 100000);
check('  NEW (correct) final payout', newFinal, 30000);
console.log('  → this is the exact ฿70,000 gate-cap miss documented in the audit, now fixed.');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
