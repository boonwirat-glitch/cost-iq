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
function makeSenseCtx(rows, opts) {
  opts = opts || {};
  const ctx = { window: {}, document: domStub(), navigator: {}, localStorage: { getItem: () => null, setItem: () => {} }, console, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/07a_commission_engine.js'), 'utf8'), ctx);
  setGlobal(ctx, '_tgtSettings', { handover_params: TARGET_CONFIG });
  setGlobal(ctx, 'portviewBulkData', [{ kamEmail: 'kam@test.co', kamName: 'TestKam' }]);
  // v_hofix: fixtureMonth lets a test put the file on a DIFFERENT month than the
  // one being asked for — that is the exact real-world shape that silently zeroed
  // July (file held June's export while the engine asked for July's transfers).
  const fixtureMonth = opts.fixtureMonth || PREV_MONTH_LABEL;
  const hoRows = rows.map(r => ({
    accountId: r.id, accountName: r.id, kamName: 'PrevKam', prevOwner: 'SALE',
    transferMonth: fixtureMonth, baselineDays: 30, perfDays: 30,
    baselineGmv: r.baselineGmv, perfGmv: r.perfGmv
  }));
  // `rows` (the flat file-level array) is what the data-gap check reads — the real
  // parser in 07b_commission_history.js returns it alongside the byNewKamName index.
  setGlobal(ctx, 'bulkHandoverData', { byNewKamName: { TestKam: hoRows }, rows: hoRows });
  // _commComputeHandoverRetention reads `new Date()` to derive prevMonthLabel —
  // override the context's Date so it always resolves to PREV_MONTH_LABEL,
  // matching the fixture's transferMonth regardless of when this runs.
  setGlobal(ctx, 'Date', class extends Date { constructor(...a) { super(...(a.length ? a : [FIXED_TODAY])); } });
  return ctx;
}

function makeNrrCtx(rows, opts) {
  opts = opts || {};
  const fixtureMonth = opts.fixtureMonth || PREV_MONTH_LABEL;
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  // v_namefix (2026-08-27) เพิ่ม nrrDisplayName ใน nrr_logic.js แล้ว nrr_commission.js
  // เรียกใช้ — sandbox นี้โหลดแค่ไฟล์เดียวเลยต้องมี stub (พฤติกรรม passthrough พอ
  // เพราะเทสต์ชุดนี้วัดเงิน ไม่ได้วัดชื่อ)
  vm.runInContext('function nrrDisplayName(n){return n||"(ไม่มีชื่อในข้อมูล)";}', ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/nrr/nrr_commission.js'), 'utf8'), ctx);
  setGlobal(ctx, 'nrrCommRatesCache', { loaded: true, byKey: { handover_params: TARGET_CONFIG } });
  ctx.window.bulkQnrrData = { byKamEmail: { 'kam@test.co': [{ latest_staff_owner: 'TestKam' }] } };
  setGlobal(ctx, 'nrrHandoverCsvCache', { loaded: true, rows: rows.map(r => ({
    account_id: r.id, account_name: r.id, new_kam_name: 'TestKam', prev_owner: 'SALE',
    transfer_month: fixtureMonth, baseline_days_in_month: '30', perf_days_in_month: '30',
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

// ── v_hofix (2026-08-06) — period-awareness + data-gap flag ──────────────
// Regression cover for the bug that made every KAM's July handover ฿0:
// portview_handover.csv holds ONE transfer_month and is overwritten on every
// Q10 run, and Sense derived that month from the WALL CLOCK rather than from
// the period being computed. Locking July on 1 Aug therefore asked for July's
// transfers while the file still held June's → 0 rows matched → silent ฿0.
console.log('\n── v_hofix: period-aware transfer_month + data-gap flag ──');

// FIXED_TODAY is 2026-07-16, so the wall-clock path resolves to 2026-06.
// Asking for period 2026-08 must instead resolve to 2026-07 — a month the
// fixture below deliberately holds, and which the wall clock would never pick.
(function () {
  const rows = oneAccountRows(50000, 120);
  const ctx = makeSenseCtx(rows, { fixtureMonth: '2026-07' });
  const withOverride = vm.runInContext('_commComputeHandoverRetention("kam@test.co", null, null, "2026-08")', ctx);
  check('  Sense periodOverride 2026-08 → matches file month 2026-07, pays ฿5,000',
    [withOverride.payout, withOverride.data_missing], [5000, false]);

  // Same fixture, NO override: wall clock wants 2026-06, file has 2026-07 →
  // no match. This is byte-for-byte the July production failure.
  const noOverride = vm.runInContext('_commComputeHandoverRetention("kam@test.co")', ctx);
  check('  Sense no override → wall-clock month, file has none → ฿0 + data_missing',
    [noOverride.payout, noOverride.data_missing], [0, true]);
})();

// The live-month path must stay byte-identical to before this change: fixture
// on the wall-clock month, no override passed → same payout as it always gave.
(function () {
  const ctx = makeSenseCtx(oneAccountRows(50000, 120));
  const r = vm.runInContext('_commComputeHandoverRetention("kam@test.co")', ctx);
  check('  Sense live month unchanged (no override, file on wall-clock month) → ฿5,000',
    [r.payout, r.data_missing], [5000, false]);
})();

// data_missing must NOT fire when the month IS present but retention simply
// misses every tier — that is a real ฿0 and has to stay distinguishable.
(function () {
  const ctx = makeSenseCtx(oneAccountRows(50000, 80));
  const r = vm.runInContext('_commComputeHandoverRetention("kam@test.co")', ctx);
  check('  Sense real ฿0 (retention 80%, month present) → data_missing stays false',
    [r.payout, r.data_missing], [0, false]);

  const nrrCtx = makeNrrCtx(oneAccountRows(50000, 80));
  const r2 = vm.runInContext('nrrComputeHandoverForKam("kam@test.co", "2026-07")', nrrCtx);
  check('  /nrr  real ฿0 (retention 80%, month present) → data_missing stays false',
    [r2.payout, r2.data_missing], [0, false]);
})();

// /nrr asks for prevMonthOf(period); a file on any other month is a data gap.
(function () {
  const ctx = makeNrrCtx(oneAccountRows(50000, 120), { fixtureMonth: '2026-07' });
  const r = vm.runInContext('nrrComputeHandoverForKam("kam@test.co", "2026-07")', ctx);
  check('  /nrr  period 2026-07 wants 2026-06, file has 2026-07 → ฿0 + data_missing',
    [r.payout, r.data_missing], [0, true]);

  const r2 = vm.runInContext('nrrComputeHandoverForKam("kam@test.co", "2026-08")', ctx);
  check('  /nrr  period 2026-08 wants 2026-07 → matches, pays ฿5,000',
    [r2.payout, r2.data_missing], [5000, false]);
})();

// Both engines must agree on the same (period, file) pair — they are twins and
// have silently diverged here before (Sense wall-clock vs /nrr period-relative).
(function () {
  const senseCtx = makeSenseCtx(oneAccountRows(50000, 120), { fixtureMonth: '2026-07' });
  const s = vm.runInContext('_commComputeHandoverRetention("kam@test.co", null, null, "2026-08")', senseCtx);
  const nrrCtx = makeNrrCtx(oneAccountRows(50000, 120), { fixtureMonth: '2026-07' });
  const n = vm.runInContext('nrrComputeHandoverForKam("kam@test.co", "2026-08")', nrrCtx);
  check('  cross-app same period 2026-08 → identical payout', s.payout, n.payout);
  check('  cross-app same period 2026-08 → identical data_missing', !!s.data_missing, !!n.data_missing);
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
