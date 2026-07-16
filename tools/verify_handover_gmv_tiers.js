// tools/verify_handover_gmv_tiers.js — boundary + cross-app consistency
// checks for the Handover GMV-tier feature (v91/nrr companion). Loads the
// REAL production source (07a_commission_engine.js and nrr_commission.js)
// into two isolated Node contexts via eval (same technique as
// tools/verify_nrr_formula.js) and exercises _commComputeHandoverRetention
// / nrrComputeHandoverForKam with synthetic data — no browser needed since
// this is pure JS logic. Per the plan's Verification section: no automated
// test harness exists in this codebase, so this script is the repeatable
// substitute for a "manual side-by-side console comparison."
//
// Usage: node tools/verify_handover_gmv_tiers.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TARGET_CONFIG = {
  gmv_tiers: [
    { tier_order: 1, gmv_min: 20000, gmv_max: 49999, label: '20,000–49,999',
      thresholds: [ { min_retention_pct: 100, payout: 1000 }, { min_retention_pct: 120, payout: 2000 } ] },
    { tier_order: 2, gmv_min: 50000, gmv_max: null, label: '≥50,000',
      thresholds: [ { min_retention_pct: 100, payout: 2500 }, { min_retention_pct: 120, payout: 5000 } ] }
  ]
};

// ── Fixed "today" so transfer-month resolution is deterministic ──────────
const FIXED_TODAY = new Date('2026-07-16T12:00:00Z');
const PREV_MONTH_LABEL = '2026-06';

function domStub() {
  return {
    head: { appendChild: function () {} },
    body: { appendChild: function () {} },
    addEventListener: function () {},
    getElementById: function () { return null; },
    createElement: function () { return { style: {}, appendChild: function () {}, setAttribute: function () {} }; }
  };
}

// vm.createContext top-level `let`/`const` bindings are NOT reachable via
// direct sandbox property assignment from outside (ctx.foo = x silently
// creates an unrelated own-property instead of rebinding `let foo`) — only
// code executed via vm.runInContext can rebind them. `var`-declared globals
// (and undeclared identifiers the script only reads, never declares) DO
// become real sandbox own-properties either way. Route every injection
// through this so the harness works regardless of which declaration form
// the source file happens to use.
function setGlobal(ctx, name, value) {
  ctx.__inject = value;
  vm.runInContext(name + ' = __inject;', ctx);
  delete ctx.__inject;
}

// One row = one handover account. baselineGmv/perfGmv already daily-rate-
// normalizable (baselineDays/perfDays default 30 so norm === raw here,
// keeping the arithmetic in each test case easy to reason about).
function makeSenseCtx(rows) {
  const ctx = { window: {}, document: domStub(), navigator: {}, localStorage: { getItem: () => null, setItem: () => {} }, console, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/07a_commission_engine.js'), 'utf8'), ctx);
  setGlobal(ctx, '_tgtSettings', { handover_params: TARGET_CONFIG });
  setGlobal(ctx, 'portviewBulkData', [{ kamEmail: 'kam@test.co', kamName: 'TestKam' }]);
  setGlobal(ctx, 'bulkHandoverData', { byNewKamName: { TestKam: rows.map(r => ({
    accountId: r.id, accountName: r.id, kamName: 'PrevKam', prevOwner: 'SALE',
    transferMonth: PREV_MONTH_LABEL, baselineDays: 30, perfDays: 30,
    baselineGmv: r.baselineGmv, perfGmv: r.perfGmv
  })) } });
  // _commComputeHandoverRetention reads `new Date()` to derive prevMonthLabel —
  // override the context's Date so it always resolves to PREV_MONTH_LABEL,
  // matching the fixture's transferMonth regardless of when this runs.
  setGlobal(ctx, 'Date', class extends Date { constructor(...a) { super(...(a.length ? a : [FIXED_TODAY])); } });
  return ctx;
}

function makeNrrCtx(rows) {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/nrr/nrr_commission.js'), 'utf8'), ctx);
  setGlobal(ctx, 'nrrCommRatesCache', { loaded: true, byKey: { handover_params: TARGET_CONFIG } });
  ctx.window.bulkQnrrData = { byKamEmail: { 'kam@test.co': [{ latest_staff_owner: 'TestKam' }] } };
  setGlobal(ctx, 'nrrHandoverCsvCache', { loaded: true, rows: rows.map(r => ({
    account_id: r.id, account_name: r.id, new_kam_name: 'TestKam', prev_owner: 'SALE',
    transfer_month: PREV_MONTH_LABEL, baseline_days_in_month: '30', perf_days_in_month: '30',
    baseline_gmv: String(r.baselineGmv), perf_gmv: String(r.perfGmv)
  })) });
  return ctx;
}

// A single handover account whose baseline/perf GMV yields the target
// aggregate GMV and retention % exactly (one account keeps the arithmetic
// legible; aggregate-GMV bucketing means the exact split across accounts
// doesn't matter for these boundary checks).
function oneAccountRows(gmv, retentionPct) {
  return [{ id: 'ACC1', baselineGmv: gmv, perfGmv: gmv * retentionPct / 100 }];
}

let pass = 0, fail = 0;
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✓ ' + desc); }
  else { fail++; console.log('  ✗ ' + desc + '\n      expected: ' + JSON.stringify(expected) + '\n      actual:   ' + JSON.stringify(actual)); }
}

function runBoth(desc, rows, assertFn) {
  console.log(desc);
  const senseCtx = makeSenseCtx(rows);
  const senseResult = vm.runInContext('_commComputeHandoverRetention("kam@test.co")', senseCtx);
  assertFn('Sense', senseResult);

  const nrrCtx = makeNrrCtx(rows);
  const nrrResult = vm.runInContext('nrrComputeHandoverForKam("kam@test.co", "2026-07")', nrrCtx);
  assertFn('/nrr ', nrrResult);

  check('  cross-app payout match', senseResult.payout, nrrResult.payout);
  check('  cross-app gmv_tier_label match', senseResult.gmv_tier_label, nrrResult.gmv_tier_label);
  check('  cross-app retention_pct match', senseResult.retention_pct, nrrResult.retention_pct);
}

console.log('── Handover GMV-tier boundary + cross-app consistency ──\n');

runBoth('GMV exactly 20,000, retention exactly 100% → tier "20,000–49,999", ฿1,000',
  oneAccountRows(20000, 100),
  (who, r) => { check(who + ' payout', r.payout, 1000); check(who + ' tier label', r.gmv_tier_label, '20,000–49,999'); });

runBoth('GMV exactly 49,999, retention exactly 120% → tier "20,000–49,999", ฿2,000',
  oneAccountRows(49999, 120),
  (who, r) => { check(who + ' payout', r.payout, 2000); check(who + ' tier label', r.gmv_tier_label, '20,000–49,999'); });

runBoth('GMV exactly 50,000, retention exactly 100% → tier "≥50,000", ฿2,500',
  oneAccountRows(50000, 100),
  (who, r) => { check(who + ' payout', r.payout, 2500); check(who + ' tier label', r.gmv_tier_label, '≥50,000'); });

runBoth('GMV exactly 50,000, retention exactly 120% → tier "≥50,000", ฿5,000',
  oneAccountRows(50000, 120),
  (who, r) => { check(who + ' payout', r.payout, 5000); check(who + ' tier label', r.gmv_tier_label, '≥50,000'); });

runBoth('GMV 19,999 (below lowest tier) → no tier match, ฿0',
  oneAccountRows(19999, 150),
  (who, r) => { check(who + ' payout', r.payout, 0); check(who + ' tier label', r.gmv_tier_label, null); });

runBoth('Retention 99.9% (just under 100%) → ฿0 within the matched tier',
  oneAccountRows(50000, 99.9),
  (who, r) => { check(who + ' payout', r.payout, 0); check(who + ' retention_pct', r.retention_pct, 99.9); });

runBoth('Retention 99.94% rounds to 99.9 in BOTH engines (the pre-existing whole-vs-decimal rounding divergence this feature fixed) → ฿0, not ฿2,500',
  oneAccountRows(50000, 99.94),
  (who, r) => { check(who + ' retention_pct rounds to 99.9', r.retention_pct, 99.9); check(who + ' payout stays 0', r.payout, 0); });

console.log('\nKAM with zero handover accounts this period → unchanged EMPTY result');
(function () {
  const senseCtx = makeSenseCtx([]);
  const r = vm.runInContext('_commComputeHandoverRetention("kam@test.co")', senseCtx);
  check('  Sense accounts=0, payout=0', [r.accounts, r.payout], [0, 0]);
  const nrrCtx = makeNrrCtx([]);
  const r2 = vm.runInContext('nrrComputeHandoverForKam("kam@test.co", "2026-07")', nrrCtx);
  check('  /nrr  accounts=0, payout=0', [r2.accounts, r2.payout], [0, 0]);
})();

console.log('\nLegacy fallback (gmv_tiers empty/absent) → old flat 2-tier behavior unchanged');
(function () {
  const rows = oneAccountRows(999999, 120); // huge GMV, irrelevant to flat legacy logic
  const senseCtx = makeSenseCtx(rows);
  setGlobal(senseCtx, '_tgtSettings', { handover_params: { tier2_pct: 100, tier3_pct: 120, tier2_payout: 2500, tier3_bonus: 2500 } }); // no gmv_tiers key
  const r = vm.runInContext('_commComputeHandoverRetention("kam@test.co")', senseCtx);
  check('  Sense legacy flat payout (retention 120% → t2+t3)', r.payout, 5000);
  check('  Sense legacy gmv_tier_label stays null', r.gmv_tier_label, null);

  const nrrCtx = makeNrrCtx(rows);
  setGlobal(nrrCtx, 'nrrCommRatesCache', { loaded: true, byKey: {} }); // no handover_params at all -> nrrCommRateGet falls back to defaults
  const r2 = vm.runInContext('nrrComputeHandoverForKam("kam@test.co", "2026-07")', nrrCtx);
  check('  /nrr  legacy flat payout (retention 120% → t2+t3)', r2.payout, 5000);
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
