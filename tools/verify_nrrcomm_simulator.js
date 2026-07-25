// tools/verify_nrrcomm_simulator.js
// v_simtab regression harness — verifies the new Commission-tab engine
// functions in src/nrr/nrr_commission.js:
//   1. nrrComputeUpsellSku(...) === nrrComputeUpsellSkuWithParams(..., null)
//      (the wrapper delegation must reproduce the exact original behavior —
//      this is the reconciliation identity Part E's plan calls for, proven
//      here at the pure-function level).
//   2. Overriding p1MinGmv/p3ThreshPct changes which groups qualify, and by
//      how much, in the expected direction.
//   3. nrrEnumerateUpsellGroups keeps near-miss (non-qualifying) rows too,
//      with correct current/threshold/qualifies/projected/projectedQualifies
//      fields — the whole point of the breakdown table's pace badges.
//
// Today's date is patched to a fixed 2026-07-20 so day-of-month-dependent
// run-rate projection math is deterministic.
//
// Usage: node tools/verify_nrrcomm_simulator.js

const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) { super(2026, 6, 20); return; } // July 20, 2026
    super(...args);
  }
  static now() { return new RealDate(2026, 6, 20).getTime(); }
};

global.window = {};
global.supa = null; // unused by the functions under test
global.QNRR_CFG = {
  quarter: '2026q3', base_month: '2026-06', q_months: ['2026-07', '2026-08', '2026-09'],
  months_th: { '2026-06': 'มิ.ย.', '2026-07': 'ก.ค.', '2026-08': 'ส.ค.', '2026-09': 'ก.ย.' }
};

const fs = require('fs');
eval(fs.readFileSync(__dirname + '/../src/nrr/nrr_data.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/../src/nrr/nrr_commission.js', 'utf8'));

let fails = 0;
function check(label, actual, expected) {
  const ok = Math.abs(actual - expected) < 0.01;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : '*** FAIL ***'}  ${label}  actual=${actual}  expected=${expected}`);
}
function checkBool(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : '*** FAIL ***'}  ${label}  actual=${actual}  expected=${expected}`);
}

const baseMonth = '2026-06';
const currLabel = nrrCommCurrentMonthLabel(); // should be 'ก.ค.' + BE year
const p3Labels = nrrP3WindowLabels(baseMonth, 3); // [มิ.ย., พ.ค., เม.ย.] of 2569
console.log('currLabel =', currLabel, '| p3Labels =', p3Labels);

// Baseline raw GMV for the 3 P3 window months — deterministic maxBaseline
// computed via the harness's OWN nrrDaysInLabel, not hand-calculated, so the
// test never silently drifts from a leap-year/days-in-month assumption.
const P3_RAW = 20000;
let expectedMaxBaseline = 0;
p3Labels.forEach(l => {
  const norm = P3_RAW / nrrDaysInLabel(l) * 30;
  if (norm > expectedMaxBaseline) expectedMaxBaseline = norm;
});
console.log('expectedMaxBaseline =', expectedMaxBaseline.toFixed(2));

function buildMonthData(currRow) {
  const md = { [currLabel]: currRow };
  p3Labels.forEach(l => { md[l] = { totalGmv: P3_RAW, existingGmv: P3_RAW }; });
  return md;
}

const bundle = {
  loaded: true,
  groupCategory: {},
  data: {
    A1: {
      O1: {
        // P1, comfortably above default 5000 threshold — a "control" that
        // must qualify under every scenario below.
        'สินค้าใหม่ (มาก)': buildMonthData({ totalGmv: 10000, existingGmv: 0 }),
        // P1, near-miss — below default 5000, above a lowered 3000.
        'สินค้าใหม่ (น้อย)': buildMonthData({ totalGmv: 4000, existingGmv: 0 }),
        // P3, comfortably above default 2.0x+8000 — a "control".
        'สินค้าโต (มาก)': buildMonthData({ totalGmv: 50000, existingGmv: 50000 }),
        // P3, near-miss — 1.75x growth, below default 2.0x but incremental
        // itself (~15k) would clear a lowered 1.5x threshold.
        'สินค้าโต (น้อย)': buildMonthData({ totalGmv: 35000, existingGmv: 35000 })
      }
    }
  },
  baselineGroups: {
    A1: { O1: { 'สินค้าโต (มาก)': true, 'สินค้าโต (น้อย)': true } } // presence = P3 (existing); absence = P1 (new)
  }
};

console.log('\n=== Part 1: nrrComputeUpsellSku === nrrComputeUpsellSkuWithParams(..., null) ===');
const expIds = new Set();
const oldRes = nrrComputeUpsellSku(expIds, bundle, baseMonth);
const newResNull = nrrComputeUpsellSkuWithParams(expIds, bundle, baseMonth, null);
check('p1.comm identical', newResNull.p1.comm, oldRes.p1.comm);
check('p1.gmv identical', newResNull.p1.gmv, oldRes.p1.gmv);
check('p3.comm identical', newResNull.p3.comm, oldRes.p3.comm);
check('p3.gmv_incremental identical', newResNull.p3.gmv_incremental, oldRes.p3.gmv_incremental);
check('total_comm identical', newResNull.total_comm, oldRes.total_comm);
checkBool('p1 group count identical', newResNull.p1.groups.length, oldRes.p1.groups.length);
checkBool('p3 group count identical', newResNull.p3.groups.length, oldRes.p3.groups.length);
// Default params: only the two "control" groups qualify (near-miss ones excluded).
checkBool('default p1 qualifies only the big one', oldRes.p1.groups.length, 1);
checkBool('default p3 qualifies only the big one', oldRes.p3.groups.length, 1);
check('default p1 comm = 10000*1%', oldRes.p1.comm, 10000 * 0.01);

console.log('\n=== Part 2: lowering thresholds brings the near-miss groups in ===');
const loosened = nrrComputeUpsellSkuWithParams(expIds, bundle, baseMonth, { p1MinGmv: 3000, p3ThreshPct: 1.5 });
checkBool('loosened p1 now qualifies both', loosened.p1.groups.length, 2);
checkBool('loosened p3 now qualifies both', loosened.p3.groups.length, 2);
check('loosened p1 comm = (10000+4000)*1%', loosened.p1.comm, 14000 * 0.01);
const expectedP3Incr = (50000 - expectedMaxBaseline) + (35000 - expectedMaxBaseline);
check('loosened p3 incremental = sum of both', loosened.p3.gmv_incremental, expectedP3Incr);
if (loosened.total_comm <= oldRes.total_comm) { fails++; console.log('*** FAIL ***  loosening thresholds must never DECREASE total commission'); }
else console.log('PASS  loosening thresholds increases total commission (' + oldRes.total_comm.toFixed(2) + ' -> ' + loosened.total_comm.toFixed(2) + ')');

console.log('\n=== Part 3: tightening thresholds excludes even the "control" groups ===');
const tightened = nrrComputeUpsellSkuWithParams(expIds, bundle, baseMonth, { p1MinGmv: 20000, p3ThreshPct: 5 });
checkBool('tightened p1 qualifies none', tightened.p1.groups.length, 0);
checkBool('tightened p3 qualifies none', tightened.p3.groups.length, 0);
check('tightened total_comm = 0', tightened.total_comm, 0);

console.log('\n=== Part 4: nrrEnumerateUpsellGroups keeps near-miss rows + pace tags ===');
const person = { email: 'test@freshket.co', name: 'Test KAM' };
const rows = nrrEnumerateUpsellGroups(person, bundle, baseMonth, null, expIds);
checkBool('enumerates all 4 groups (qualifying + near-miss)', rows.length, 4);

const p1Big = rows.find(r => r.groupKey === 'สินค้าใหม่ (มาก)');
const p1Small = rows.find(r => r.groupKey === 'สินค้าใหม่ (น้อย)');
const p3Big = rows.find(r => r.groupKey === 'สินค้าโต (มาก)');
const p3Small = rows.find(r => r.groupKey === 'สินค้าโต (น้อย)');

checkBool('big P1 qualifies', p1Big.qualifies, true);
checkBool('small P1 does NOT qualify at default threshold', p1Small.qualifies, false);
checkBool('small P1 IS on pace to qualify (near-miss badge case)', p1Small.projectedQualifies, true);
checkBool('big P3 qualifies', p3Big.qualifies, true);
checkBool('small P3 does NOT qualify at default threshold', p3Small.qualifies, false);
checkBool('small P3 IS on pace to qualify (near-miss badge case)', p3Small.projectedQualifies, true);
checkBool('projectionReady true at day 20 (>=5)', p1Small.projectionReady, true);
// Run-rate projection: current/daysElapsed(20)*daysInMonth(31 for July)
const expectedProjP1Small = 4000 / 20 * 31;
check('small P1 projected GMV = MTD/20*31', p1Small.projected, expectedProjP1Small);

console.log('\n=== Part 5: Σ enumerate().commission === compute().total_comm ===');
// THE load-bearing equivalence. nrr_view.js's Commission tab derives its hero
// totals, per-KAM table and breakdown rows from ONE enumeration pass instead
// of separately calling the engine mirror — safe only while the enumeration's
// per-row commission agrees exactly with nrrComputeUpsellSkuWithParams (which
// mirrors the real payout engine). If a future edit changes one predicate and
// not the other, the tab would show numbers that don't match a payout; this
// asserts it across several threshold settings, not just the defaults.
// (nrr_view.js also warns at runtime if the two ever drift — belt and braces.)
[null,
 { p1MinGmv: 3000, p3ThreshPct: 1.5 },
 { p1MinGmv: 0 },
 { p3MinIncr: 0, p3ThreshPct: 1 },
 { p1MinGmv: 20000, p3ThreshPct: 5 }
].forEach(function (ov, i) {
  var computed = nrrComputeUpsellSkuWithParams(expIds, bundle, baseMonth, ov);
  var enumerated = nrrEnumerateUpsellGroups(person, bundle, baseMonth, ov, expIds);
  var sumComm = enumerated.reduce(function (s, r) { return s + (r.qualifies ? r.commission : 0); }, 0);
  var sumGmv = enumerated.reduce(function (s, r) { return s + (r.qualifies ? r.current : 0); }, 0);
  var label = ov ? JSON.stringify(ov) : 'live defaults';
  check('[' + i + '] ' + label + ' — commission', sumComm, computed.total_comm);
  check('[' + i + '] ' + label + ' — eligible GMV', sumGmv, computed.total_gmv_eligible);
  var qualifyCount = enumerated.filter(function (r) { return r.qualifies; }).length;
  checkBool('[' + i + '] ' + label + ' — qualifying row count',
    qualifyCount, computed.p1.groups.length + computed.p3.groups.length);
});

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}`);
process.exit(fails === 0 ? 0 : 1);
