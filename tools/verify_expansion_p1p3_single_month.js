// tools/verify_expansion_p1p3_single_month.js
// v880-fix regression harness — proves Expansion/P1/P3 now compute each
// month's commission from THAT MONTH's own current GMV alone, never summed
// with prior months (the bug this session found and fixed, confirmed via
// Bush's own worked examples: Ning/iBerry for Expansion, Ning/Avo-Mango-
// Apple for P1, Ning/Coke for P3).
//
// Usage: node tools/verify_expansion_p1p3_single_month.js

global.window = {};
const fakeEl = () => ({ classList: { add(){}, remove(){}, contains(){return false;} },
  appendChild(){}, id: '', textContent: '', style: {}, addEventListener(){} });
global.document = {
  getElementById: () => null, createElement: () => fakeEl(), addEventListener: () => {},
  querySelector: () => null, head: fakeEl(), body: fakeEl()
};
global.portviewBulkData = [];
global.bulkUpsellData = { byKam: {}, baselineGroups: {}, loaded: true };

eval(require('fs').readFileSync(__dirname + '/../src/07a_commission_engine.js', 'utf8'));

let fails = 0;
function check(label, actual, expected) {
  const ok = Math.abs(actual - expected) < 0.01;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : '*** FAIL ***'}  ${label}  actual=${actual}  expected=${expected}`);
}

// ═══════════════════════════════════════════════════════════════════════
// Test 1 — Expansion (Ning/iBerry): July 100k, Aug 200k, Sep 180k.
// _commComputeUpsellOutlet now reads only qnrrRaw.by_month[qnrrRaw.currentPeriod]
// — no loop across elapsed months — so each call is independent regardless
// of what "currentPeriod" label is used.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Test 1: Expansion (Ning/iBerry) ===');
const rate = 0.005; // real Supabase config, also the _commGetConfig default fallback

function expansionScenario(label, gmv) {
  const qnrrRaw = {
    currentPeriod: label,
    by_month: { [label]: { rows: [{ movement_type: 'expansion', outlet_id: 'iberry-1', curr_gmv: gmv }] } }
  };
  return _commComputeUpsellOutlet('ning@freshket.co', qnrrRaw, null, null, null);
}

const jul = expansionScenario('2026-07', 100000);
const aug = expansionScenario('2026-08', 200000);
const sep = expansionScenario('2026-09', 180000);

check('July own GMV used (not summed)', jul.expansion_gmv, 100000);
check('July commission', jul.commission, 100000 * rate);
check('Aug own GMV used (not 300k cumulative)', aug.expansion_gmv, 200000);
check('Aug commission', aug.commission, 200000 * rate);
check('Sep own GMV used (not 480k cumulative)', sep.expansion_gmv, 180000);
check('Sep commission', sep.commission, 180000 * rate);
check('Sep < Aug (proves not a monotonic cumulative sum)', sep.expansion_gmv < aug.expansion_gmv ? 1 : 0, 1);

// ═══════════════════════════════════════════════════════════════════════
// Test 2/3 — P1/P3 (_commComputeUpsellSku) via Ning/Avo-Mango-Apple + Coke.
// This function's "current month" is evalLabels[evalLabels.length-1], where
// evalLabels = _commElapsedQuarterLabels(baseMonthOverride) — driven by
// REAL wall-clock time (lag-1 today), not injectable directly. Trick: pick
// a baseMonthOverride far enough in the past that today's real date makes
// exactly N months of that quarter "elapsed", then use whatever THAT
// scenario's labels are as our synthetic "month 1/2/3" data.
// ═══════════════════════════════════════════════════════════════════════
function findOverrideForElapsedCount(n) {
  const now = new Date();
  for (let monthsBack = 1; monthsBack <= 24; monthsBack++) {
    const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const override = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    if (_commElapsedQuarterLabels(override).length === n) return override;
  }
  throw new Error('no baseMonthOverride found for elapsed count ' + n);
}

function p1p3Scenario(elapsedCount, itemsByMonth, isExistingBefore, lookbackMonthlyGmv) {
  // itemsByMonth: array (len = elapsedCount) of {groupKey: {totalGmv, existingGmv}} per month
  // lookbackMonthlyGmv: optional {groupKey: monthlyGmv} — P3's frozen baseline window
  // (base, base-1, base-2) needs its own monthData rows so max_baseline resolves to
  // something other than 0; real Coke example = 20k/mo steady before the quarter.
  const override = findOverrideForElapsedCount(elapsedCount);
  const evalLabels = _commElapsedQuarterLabels(override);
  const lookbackLabels = _commBaseMonthLabels(override, 3); // [base, base-1, base-2]
  const kamName = 'Test KAM';
  global.portviewBulkData = [{ kamEmail: 'ning@freshket.co', kamName, daysElapsed: 20 }];

  const outletGroups = {};
  // union of all group keys across all months in this scenario
  const allGroupKeys = new Set();
  itemsByMonth.forEach(m => Object.keys(m).forEach(g => allGroupKeys.add(g)));
  allGroupKeys.forEach(groupKey => {
    outletGroups[groupKey] = {};
    evalLabels.forEach((lbl, i) => {
      const row = itemsByMonth[i] && itemsByMonth[i][groupKey];
      if (row) outletGroups[groupKey][lbl] = row;
    });
    const lb = lookbackMonthlyGmv && lookbackMonthlyGmv[groupKey];
    if (lb) lookbackLabels.forEach(lbl => { outletGroups[groupKey][lbl] = { totalGmv: lb, existingGmv: lb }; });
  });

  const baselineSet = new Set(Object.keys(isExistingBefore).filter(g => isExistingBefore[g]));

  global.bulkUpsellData = {
    loaded: true,
    byKam: { [kamName]: { acct1: { outlet1: outletGroups } } },
    baselineGroups: { [kamName]: { acct1: { outlet1: baselineSet } } }
  };

  return _commComputeUpsellSku('ning@freshket.co', new Set(), override, null, null);
}

console.log('\n=== Test 2: P1 (Ning/Avo-Mango-Apple) — all 3 new items, never bought before ===');
const isNew = { AVO: false, MANGO: false, APPLE: false }; // false = not in baseline = P1 (new)

// July: Avo 50k, Mango 40k, Apple 60k = 150k
const julP1 = p1p3Scenario(1, [{ AVO: { totalGmv: 50000, existingGmv: 0 }, MANGO: { totalGmv: 40000, existingGmv: 0 }, APPLE: { totalGmv: 60000, existingGmv: 0 } }], isNew);
check('July P1 total = 150k (own month only)', julP1.p1.gmv, 150000);

// Aug: Avo 100k, Mango 0 (drops out, doesn't "keep" July's 40k), Apple 100k = 200k
const augP1 = p1p3Scenario(2,
  [{ AVO: { totalGmv: 50000, existingGmv: 0 }, MANGO: { totalGmv: 40000, existingGmv: 0 }, APPLE: { totalGmv: 60000, existingGmv: 0 } },
   { AVO: { totalGmv: 100000, existingGmv: 0 }, APPLE: { totalGmv: 100000, existingGmv: 0 } }], // Mango absent this month
  isNew);
check('Aug P1 total = 200k (NOT 350k = 150k+200k)', augP1.p1.gmv, 200000);

// Sep: Avo 200k, Mango 50k (back), Apple 100k = 350k
const sepP1 = p1p3Scenario(3,
  [{ AVO: { totalGmv: 50000, existingGmv: 0 }, MANGO: { totalGmv: 40000, existingGmv: 0 }, APPLE: { totalGmv: 60000, existingGmv: 0 } },
   { AVO: { totalGmv: 100000, existingGmv: 0 }, APPLE: { totalGmv: 100000, existingGmv: 0 } },
   { AVO: { totalGmv: 200000, existingGmv: 0 }, MANGO: { totalGmv: 50000, existingGmv: 0 }, APPLE: { totalGmv: 100000, existingGmv: 0 } }],
  isNew);
check('Sep P1 total = 350k (NOT 550k = 200k+350k, and Mango returning does not resurrect July\'s 40k)', sepP1.p1.gmv, 350000);

console.log('\n=== Test 3: P3 (Ning/Coke) — existing item, baseline 20k/mo ===');
const cokeExisting = { COKE: true }; // true = in baseline = P3 (existing)
const cokeLookback = { COKE: 20000 }; // frozen 3-month lookback: 20k/mo steady before the quarter

// July: still 20k (== baseline, no growth, fails >200% test)
const julP3 = p1p3Scenario(1, [{ COKE: { totalGmv: 20000, existingGmv: 20000 } }], cokeExisting, cokeLookback);
check('July P3 incremental = 0 (no growth)', julP3.p3.gmv_incremental, 0);

// Aug: big lot 200k vs 20k baseline -> incremental 180k, passes (>40k threshold, >=8000 incremental)
const augP3 = p1p3Scenario(2,
  [{ COKE: { totalGmv: 20000, existingGmv: 20000 } },
   { COKE: { totalGmv: 200000, existingGmv: 200000 } }],
  cokeExisting, cokeLookback);
check('Aug P3 incremental = 180k (this month alone)', augP3.p3.gmv_incremental, 180000);

// Sep: drops to 25k -> fails threshold (25k <= 20k*2=40k) -> contributes 0,
// and must NOT retroactively wipe out Aug's already-locked 180k (each call
// is independent — Aug's own computed result above is untouched by this).
const sepP3 = p1p3Scenario(3,
  [{ COKE: { totalGmv: 20000, existingGmv: 20000 } },
   { COKE: { totalGmv: 200000, existingGmv: 200000 } },
   { COKE: { totalGmv: 25000, existingGmv: 25000 } }],
  cokeExisting, cokeLookback);
check('Sep P3 incremental = 0 (fails threshold, no leftover streak)', sepP3.p3.gmv_incremental, 0);
check('Aug result unaffected by Sep failing (independent computation)', augP3.p3.gmv_incremental, 180000);

// ═══════════════════════════════════════════════════════════════════════
// Test 4 — monthly/rolling mode (baseMonthOverride=null) must be unchanged.
// evalLabels degenerates to a single [currLabel] entry either way, so this
// exercises the exact same "last evalLabel" code path with length-1 array.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Test 4: monthly/rolling mode regression check ===');
const kamName2 = 'Test KAM';
global.portviewBulkData = [{ kamEmail: 'ning@freshket.co', kamName: kamName2, daysElapsed: 20 }];
const currLabel = _commCurrentMonthLabel();
global.bulkUpsellData = {
  loaded: true,
  byKam: { [kamName2]: { acct1: { outlet1: { AVO: { [currLabel]: { totalGmv: 50000, existingGmv: 0 } } } } } },
  baselineGroups: { [kamName2]: { acct1: { outlet1: new Set() } } }
};
const monthly = _commComputeUpsellSku('ning@freshket.co', new Set(), null, null, null);
check('Monthly/rolling mode P1 unaffected by fix', monthly.p1.gmv, 50000);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}`);
process.exit(fails === 0 ? 0 : 1);
