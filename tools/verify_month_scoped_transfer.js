// tools/verify_month_scoped_transfer.js — MONTH-SCOPED TRANSFER policy lock
//
// นโยบายที่บุชเคาะ (2026-08-07): ย้ายเข้า/ย้ายออกเดือน M มีผลกับฐาน %NRR
// "ตั้งแต่เดือน M เป็นต้นไป" เท่านั้น — เดือนก่อนหน้าห้ามขยับ
//
// เคสจริงที่จุดประเด็น: โอเพ่น คิทเช่น (outlet 245755) ย้ายเข้าพอร์ต May เดือน ส.ค.
// กฎ quarter-wide เดิมดึงฐาน มิ.ย. ฿150,467 ของร้านเข้าตัวหาร ก.ค. ที่ล็อกไปแล้ว
// ย้อนหลัง ตัวตั้ง ก.ค. ไม่ได้อะไร → %NRR ตก 103.2→100.9 ค่าคอมหาย ฿5,000
//
// สัญญาที่ล็อกไว้ที่นี่ (ทั้ง 3 engine ต้องตรงกันเป๊ะ):
//   by_month[m].base_norm_m        = ฐาน month-scoped ก่อนหัก waiver
//   by_month[m].effective_base_norm = base_norm_m − waiver(m)
//   field ระดับไตรมาส (base_norm, transfer_in_base_norm, ...) = fold เต็มไตรมาสเหมือนเดิม
//   เดือนย้าย = min(period_month) ของ outlet + ฐานเอาจากแถวเดือนแรกสุด (ไม่ใช่แถวแรกตามลำดับ)
//   การย้ายเป็นแบบสะสม: ออก ส.ค. แล้วไม่มีแถว ก.ย. ก็ยังถือว่าออกอยู่
//
// Usage: node tools/verify_month_scoped_transfer.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KAM = 'kam@test.co';
const BASE_DAYS = 30, CURR_DAYS = 30; // norm×30 = ยอดดิบ อ่านเลขง่าย

function row(o) {
  return Object.assign({
    transfer_scope: '', current_portfolio: 'KAM', base_portfolio: 'KAM',
    account_id: 'ACC-' + o.outlet_id, account_name: o.outlet_id, res_name: o.outlet_id,
    account_type: 'SA', cohort_month: '2025-01',
    base_days: BASE_DAYS, curr_days: CURR_DAYS,
    latest_staff_owner: 'TestKam', latest_kam_email: KAM,
    latest_tl_email: 'tl@test.co', base_kam_email: KAM, base_tl_email: 'tl@test.co'
  }, o);
}

const CORE = ['2026-07', '2026-08', '2026-09'].map(m =>
  row({ period_month: m, movement_type: 'core_nrr', outlet_id: 'CORE', base_gmv: 300000, curr_gmv: 300000 }));

// ── Fixture A: ย้ายเข้าเดือน 2 — ก.ค. ห้ามขยับ, ส.ค./ก.ย. นับ ─────────────────
const FIX_A = CORE.concat(['2026-08', '2026-09'].map(m =>
  row({ period_month: m, movement_type: 'transfer_in', outlet_id: 'TI-AUG', base_gmv: 60000, curr_gmv: 60000 })));
// ── Fixture B: ย้ายออกแบบ fan-out (rep_view ปัจจุบัน — แถวเหมือนกันทุกเดือน) ──
//   min = เดือนแรก → เท่าพฤติกรรมเดิมเป๊ะ (degrade อย่างปลอดภัยกับไฟล์เก่า)
const FIX_B = CORE.concat(['2026-07', '2026-08', '2026-09'].map(m =>
  row({ period_month: m, movement_type: 'transfer_out', outlet_id: 'TO-FAN', base_gmv: 90000, curr_gmv: 0 })));
// ── Fixture C: ย้ายออกรายเดือน (SQL ใหม่/pool views) — ก.ค. core, ส.ค. ออก, ก.ย. ไม่มีแถว ──
const FIX_C = CORE.concat([
  row({ period_month: '2026-07', movement_type: 'core_nrr',     outlet_id: 'TO-AUG', base_gmv: 120000, curr_gmv: 120000 }),
  row({ period_month: '2026-08', movement_type: 'transfer_out', outlet_id: 'TO-AUG', base_gmv: 120000, curr_gmv: 0 })
]);
// ── Fixture D: ฐาน TI ต้องมาจากแถวเดือนแรกสุด — จงใจวางแถว ก.ย. (ฐานเน่า) ก่อน ──
const FIX_D = CORE.concat([
  row({ period_month: '2026-09', movement_type: 'transfer_in', outlet_id: 'TI-D', base_gmv: 900000, curr_gmv: 60000 }),
  row({ period_month: '2026-08', movement_type: 'transfer_in', outlet_id: 'TI-D', base_gmv: 60000,  curr_gmv: 60000 })
]);

// expected[scenario] = { quarterBase, byMonth: { m: [base_norm_m×30, pct] } }
const EXPECTED = {
  A: { quarterBase: 360000, tiBase: 60000,
       byMonth: { '2026-07': [300000, 100], '2026-08': [360000, 100], '2026-09': [360000, 100] } },
  B: { quarterBase: 300000,
       byMonth: { '2026-07': [300000, 100], '2026-08': [300000, 100], '2026-09': [300000, 100] } },
  C: { quarterBase: 300000,
       byMonth: { '2026-07': [420000, 100], '2026-08': [300000, 100], '2026-09': [300000, 100] } },
  D: { quarterBase: 360000, tiBase: 60000, tiMonth: '2026-08',
       byMonth: { '2026-07': [300000, 100], '2026-08': [360000, 100], '2026-09': [360000, 100] } }
};

function makeCtx(rows) {
  const all = rows.slice();
  const bulk = { byKamEmail: { [KAM]: all }, byTlEmail: { 'tl@test.co': all }, allRows: all, loaded: true };
  const ctx = {
    window: {}, console,
    QNRR_CFG: { quarter: '2026q3', base_month: '2026-06', q_months: ['2026-07', '2026-08', '2026-09'],
                months_th: {}, csv_file: 'kam_rep_view.csv' },
    bulkQnrrData: bulk,
    nrrRoleRoster: { nonKamSet: new Set(), adSet: new Set() },
    nrrAccountWaivedForPeriod: () => false,
    document: { getElementById: () => null, addEventListener: () => {}, querySelectorAll: () => [] },
    setTimeout, clearTimeout
  };
  ctx.window.QNRR_CFG = ctx.QNRR_CFG;
  ctx.window.bulkQnrrData = bulk;
  ctx.window.nrrRoleRoster = ctx.nrrRoleRoster;
  ctx.window.nrrAccountWaivedForPeriod = ctx.nrrAccountWaivedForPeriod;
  vm.createContext(ctx);
  return ctx;
}

function runEngine(relPath, rows, callExpr) {
  const ctx = makeCtx(rows);
  try { vm.runInContext(fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'), ctx); }
  catch (e) { return { err: 'load: ' + e.message }; }
  try { return { res: vm.runInContext(callExpr, ctx) }; }
  catch (e) { return { err: 'call: ' + e.message }; }
}

const ENGINES = [
  ['/nrr _qnrrCompute',   'src/nrr/nrr_logic.js', '_qnrrCompute(' + JSON.stringify(KAM) + ', "kam")'],
  ['Sense 07c (เงินจริง)', 'src/07c_qnrr_view.js', '_qnrrCompute(' + JSON.stringify(KAM) + ', "kam")'],
  ['/nrr pool (PM/Admin)', 'src/nrr/nrr_logic.js', 'nrrComputeRowsPool(window.bulkQnrrData.allRows, "test")']
];

let pass = 0, fail = 0;
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('    ✓ ' + desc); }
  else { fail++; console.log('    ✗ ' + desc + '\n        ต้องได้: ' + JSON.stringify(expected) + '\n        ได้จริง: ' + JSON.stringify(actual)); }
}
const r1 = x => x == null ? null : Math.round(x * 10) / 10;

console.log('── month-scoped transfer: ฐานปรับเฉพาะเดือนที่ย้ายเป็นต้นไป ──');

const SCENARIOS = [['A', FIX_A], ['B', FIX_B], ['C', FIX_C], ['D', FIX_D]];
const collected = {}; // scenario → engineLabel → {quarterBase, perMonth}

SCENARIOS.forEach(([name, rows]) => {
  const exp = EXPECTED[name];
  console.log('\nFixture ' + name);
  ENGINES.forEach(([label, rel, call]) => {
    const r = runEngine(rel, rows, call);
    if (r.err || !r.res) { fail++; console.log('    ✗ ' + label + ' โหลด/เรียกไม่ได้: ' + (r.err || 'null result')); return; }
    const res = r.res;
    console.log('  ' + label);
    check('ฐานไตรมาส (fold เต็ม ไม่เปลี่ยน) = ฿' + exp.quarterBase.toLocaleString(),
      Math.round(res.base_norm * 30), exp.quarterBase);
    if (exp.tiBase != null) {
      check('transfer_in_base_norm = ฿' + exp.tiBase.toLocaleString() + ' (ฐานจากแถวเดือนแรกสุด)',
        Math.round(res.transfer_in_base_norm * 30), exp.tiBase);
    }
    if (exp.tiMonth) {
      check('เดือนย้ายบน transfer_in_outlets = ' + exp.tiMonth + ' (min ไม่ใช่แถวแรกตามลำดับ)',
        (res.transfer_in_outlets[0] || {}).period_month, exp.tiMonth);
    }
    const perMonth = {};
    Object.keys(exp.byMonth).forEach(m => {
      const bm = res.by_month[m];
      const [expBase, expPct] = exp.byMonth[m];
      if (!bm) { fail++; console.log('    ✗ ไม่มี by_month[' + m + ']'); return; }
      check(m + ' base_norm_m = ฿' + expBase.toLocaleString(),
        bm.base_norm_m != null ? Math.round(bm.base_norm_m * 30) : null, expBase);
      check(m + ' effective_base_norm = base_norm_m (ไม่มี waiver ใน fixture)',
        bm.effective_base_norm != null ? Math.round(bm.effective_base_norm * 30) : null, expBase);
      check(m + ' %NRR = ' + expPct, r1(bm.nrr_pct), expPct);
      perMonth[m] = [Math.round((bm.base_norm_m || 0) * 30), r1(bm.nrr_pct)];
    });
    (collected[name] = collected[name] || {})[label] = { quarterBase: Math.round(res.base_norm * 30), perMonth };
  });
  // ฝาแฝดต้องเท่ากันเป๊ะ (เทียบหลังปัด 1 ตำแหน่ง — 07c จงใจไม่ปัด pct ฝั่ง source)
  const labels = Object.keys(collected[name] || {});
  for (let i = 1; i < labels.length; i++) {
    check('twin: ' + labels[0] + ' = ' + labels[i],
      collected[name][labels[i]], collected[name][labels[0]]);
  }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
