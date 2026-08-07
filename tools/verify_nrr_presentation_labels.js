#!/usr/bin/env node
// tools/verify_nrr_presentation_labels.js — v_onemeaning (RECON-GRADE v2 งาน C)
//
// ล็อกกติกา "เลขเดียว ความหมายเดียว" ของหน้า NRR — presentation ล้วน engine ห้ามขยับ:
//   1. คู่เลขใต้ % บนกราฟ (ตัวตั้ง ÷ ฐาน NRR) หารกันได้ % ที่พิมพ์จริง (ปัด 1 ตำแหน่ง)
//   2. triple (leaderboard/pulse/team cards): เลขใหญ่ = ตัวตั้ง NRR, บรรทัดรองมี
//      ฐาน NRR + รวมทุกประเภท · pool result (ไม่มี nrr_curr_norm) ตกไปหน้าตาเดิม
//   3. caption แถบ composition = ยอดรวมทุกประเภทของเดือน (ไม่ใช่เลขฐาน)
//   4. โน้ตฐานนำด้วย "ฐาน NRR" + transfer-in ระบุ "มูลค่าฐาน ณ เดือน..."
//   5. หัวคอลัมน์ฐาน = "ฐานก่อนยกเว้น" · แถว Transfer in ติดป้าย "ยอดเดือนนั้นๆ"
//
// Usage: node tools/verify_nrr_presentation_labels.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const KAM = 'kam@test.co', TL = 'tl@test.co', PERIOD = '2026-07';

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}

// fixture: A1 core 600000→630000 · A2 core 400000→240000 (waived) · A3 new_sales
// (ไม่เข้าฐาน/ตัวตั้ง แต่เข้า total) · A4 transfer_in base 90000 curr 65000
function rows() {
  const mk = (o) => Object.assign({
    period_month: PERIOD, movement_type: 'core_nrr', transfer_scope: '',
    current_portfolio: 'KAM', base_portfolio: 'KAM',
    account_name: o.acc, res_name: o.acc, account_type: 'SA', cohort_month: '2025-01',
    base_days: 30, curr_days: 30,
    latest_staff_owner: 'K', latest_kam_email: KAM, latest_tl_email: TL,
    base_kam_email: KAM, base_tl_email: TL
  }, o);
  return [
    mk({ acc: 'A1', account_id: 'A1', outlet_id: 'O1', base_gmv: 600000, curr_gmv: 630000 }),
    mk({ acc: 'A2', account_id: 'A2', outlet_id: 'O2', base_gmv: 400000, curr_gmv: 240000 }),
    mk({ acc: 'A3', account_id: 'A3', outlet_id: 'O3', base_gmv: 0, curr_gmv: 50000, movement_type: 'new_sales', cohort_month: PERIOD }),
    mk({ acc: 'A4', account_id: 'A4', outlet_id: 'O4', base_gmv: 90000, curr_gmv: 65000, movement_type: 'transfer_in' })
  ];
}

const waived = new Set(['A2|' + PERIOD]);
const captured = { chart: '', table: '' };
const ctx = {
  window: { addEventListener() {}, removeEventListener() {}, location: { hash: '' } }, console: { log() {}, warn() {}, error() {} },
  document: {
    getElementById: (id) => ({
      set innerHTML(h) { captured[id] = h; }, get innerHTML() { return captured[id] || ''; },
      addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], _nrrMvBound: true
    }),
    addEventListener() {}, querySelectorAll: () => []
  },
  setTimeout, clearTimeout, JSON, Math, Object, Array, String, Number, Boolean,
  isNaN, parseFloat, parseInt, Set, Map, Promise, RegExp, Error, Date,
  QNRR_CFG: { quarter: '2026q3', base_month: '2026-06', q_months: ['2026-07', '2026-08', '2026-09'],
              months_th: { '2026-06': 'มิ.ย.', '2026-07': 'ก.ค.', '2026-08': 'ส.ค.', '2026-09': 'ก.ย.' } },
  bulkQnrrData: (() => { const all = rows(); return { byKamEmail: { [KAM]: all }, byTlEmail: { [TL]: all }, allRows: all, loaded: true }; })(),
  nrrRoleRoster: { nonKamSet: new Set(), adSet: new Set() },
  nrrAccountWaivedForPeriod: (acc, m) => waived.has(acc + '|' + m),
  nrrWaivedAccountCountForRows: (rws, m) => {
    const seen = new Set();
    (rws || []).forEach(r => { if (waived.has(r.account_id + '|' + m)) seen.add(r.account_id); });
    return seen.size;
  }
};
ctx.window.QNRR_CFG = ctx.QNRR_CFG;
ctx.window.bulkQnrrData = ctx.bulkQnrrData;
ctx.window.nrrRoleRoster = ctx.nrrRoleRoster;
ctx.window.nrrAccountWaivedForPeriod = ctx.nrrAccountWaivedForPeriod;
ctx.window.nrrWaivedAccountCountForRows = ctx.nrrWaivedAccountCountForRows;
vm.createContext(ctx);
['src/nrr/nrr_core.js', 'src/nrr/nrr_logic.js', 'src/nrr/nrr_aggregate.js', 'src/nrr/nrr_components.js'].forEach(f => {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx); }
  catch (e) { console.error('LOAD FAIL ' + f + ': ' + e.message); process.exit(1); }
});

const result = vm.runInContext('nrrKamResult("' + KAM + '")', ctx);
const bm = result.by_month[PERIOD];
const days = vm.runInContext('nrrBaseDays()', ctx);

console.log('\n(1) คู่เลขใต้ % หารกันได้ % ที่พิมพ์');
// ค่าคาด: ตัวตั้ง = A1 630000 + A4 65000 = 695000 · ฐาน = 600000+90000 = 690000 (A2 waived ทั้งฐาน/ตัวตั้ง)
t('fixture pct = 100.7 (ตัวตั้ง 695000 ÷ ฐาน 690000)', bm.nrr_pct === 100.7, 'got ' + bm.nrr_pct);
const numer = Math.round(bm.nrr_curr_norm * days);
const effB = Math.round(bm.effective_base_norm * days);
t('numer/effBase ปัด 1 ตำแหน่ง = nrr_pct', Math.round(numer / effB * 1000) / 10 === bm.nrr_pct,
  numer + '/' + effB + ' vs ' + bm.nrr_pct);

console.log('\n(2) triple: เลขใหญ่ = ตัวตั้ง NRR + บรรทัดรองครบ');
const triple = vm.runInContext('nrrMonthTriple(nrrKamResult("' + KAM + '"), "' + PERIOD + '")', ctx);
t('triple.numer = ตัวตั้ง (695000)', triple.numer === 695000, 'got ' + triple.numer);
t('triple.base = ฐาน NRR หลังยกเว้น (690000)', triple.base === 690000, 'got ' + triple.base);
const md = vm.runInContext('nrrTripleHtml("md", ' + JSON.stringify(triple) + ')', ctx);
t('md เลขใหญ่มีค่า numer + title ตัวตั้ง NRR', md.indexOf('ตัวตั้ง NRR') !== -1, md.slice(0, 200));
t('md บรรทัดรองมี ฐาน NRR + รวมทุกประเภท', md.indexOf('ฐาน NRR') !== -1 && md.indexOf('รวมทุกประเภท') !== -1, md);
const lg = vm.runInContext('nrrTripleHtml("lg", ' + JSON.stringify(triple) + ')', ctx);
t('lg มี cell ตัวตั้ง NRR + ป้าย ฐาน NRR + รวมทุกประเภท',
  lg.indexOf('ตัวตั้ง NRR') !== -1 && lg.indexOf('ฐาน NRR') !== -1 && lg.indexOf('รวมทุกประเภท') !== -1, lg.slice(0, 300));
// pool-shape fallback: ไม่มี numer → หน้าตาเดิม (เลขใหญ่ = run_rate, ไม่มีคำว่า ตัวตั้ง)
const poolTriple = Object.assign({}, triple, { numer: null });
const mdPool = vm.runInContext('nrrTripleHtml("md", ' + JSON.stringify(poolTriple) + ')', ctx);
t('pool (ไม่มี numer) → หน้าตาเดิม ไม่มีคำว่า "ตัวตั้ง"', mdPool.indexOf('ตัวตั้ง') === -1 && mdPool.indexOf('ฐาน ') !== -1, mdPool);

console.log('\n(3) caption แถบ composition = ยอดรวมของเดือน ไม่ใช่ฐาน');
const compo = vm.runInContext('nrrCompositionBarHtml(nrrKamResult("' + KAM + '"), "' + PERIOD + '")', ctx);
t('caption ขึ้นต้น "องค์ประกอบยอดรวมทุกประเภทเดือนนี้"', compo.indexOf('องค์ประกอบยอดรวมทุกประเภทเดือนนี้') !== -1, compo.slice(0, 150));
t('caption ไม่พูดคำว่า "องค์ประกอบของฐาน" อีกแล้ว', compo.indexOf('องค์ประกอบของฐาน') === -1);

console.log('\n(4)+(5) กราฟ+ตาราง movement: ป้ายครบทุกจุด');
vm.runInContext('nrrRenderMovementChart("chart", "table", nrrKamResult("' + KAM + '"), {})', ctx);
const chartHtml = captured.chart || '';
const tableHtml = captured.table || '';
t('กราฟมีคู่เลข "ตัวตั้ง ... ÷ ฐาน ..." ใต้ %', /ตัวตั้ง .*÷ ฐาน /.test(chartHtml), chartHtml.slice(0, 120));
t('footnote กราฟอธิบาย %NRR = ตัวตั้ง ÷ ฐาน', chartHtml.indexOf('%NRR = ตัวตั้ง NRR ÷ ฐาน NRR') !== -1);
t('คอลัมน์ฐานติดป้าย "ฐานก่อนยกเว้น"', tableHtml.indexOf('ฐานก่อนยกเว้น (มิ.ย.)') !== -1);
t('แถว Transfer in ติดป้าย "(ยอดเดือนนั้นๆ)"', tableHtml.indexOf('Transfer in (ยอดเดือนนั้นๆ)') !== -1);
t('โน้ตฐานนำด้วย "ฐาน NRR (ตัวหาร %NRR จริง รายเดือน)"', tableHtml.indexOf('ฐาน NRR (ตัวหาร %NRR จริง รายเดือน)') !== -1);
t('โน้ตมี "ฐานก่อนยกเว้น" + สูตร Core NRR', tableHtml.indexOf('ฐานก่อนยกเว้น') !== -1 && tableHtml.indexOf('Core NRR') !== -1);
t('transfer-in ในโน้ตระบุ "มูลค่าฐาน ณ เดือนมิ.ย."', tableHtml.indexOf('มูลค่าฐาน ณ เดือนมิ.ย.') !== -1,
  (tableHtml.match(/ย้ายเข้า[^<]*/) || [''])[0]);

console.log('\n(6) v_qgrid-fix: pool scope (PM/Admin/Chain/SA/MC) ไม่มี nrr_curr_norm — ห้ามพิมพ์ "ตัวตั้ง ฿0" หลอก');
// nrrComputeRowsPool ไม่คาย nrr_curr_norm เข้า by_month เลย (ต่างจาก
// _qnrrCompute ที่ KAM/TL ใช้) — จำลองแถวเดียวกับ pool จริงแล้วเช็คว่า
// nrrRenderMovementChart ไม่พิมพ์แถว .nrr-qcol-pair ออกมาสำหรับ scope นี้
const poolRows = rows().map(r => Object.assign({}, r)); // reuse fixture rows, any scope shape works
const poolResult = vm.runInContext(
  'nrrComputeRowsPool(' + JSON.stringify(poolRows) + ', "ทดสอบ")', ctx);
const poolBm = poolResult.by_month[PERIOD];
t('nrrComputeRowsPool ไม่มี nrr_curr_norm ใน by_month (ยืนยันสมมติฐาน)', poolBm && poolBm.nrr_curr_norm === undefined,
  poolBm && JSON.stringify(Object.keys(poolBm)));
captured.chart = ''; captured.table = '';
vm.runInContext('nrrRenderMovementChart("chart", "table", ' + JSON.stringify(poolResult) + ', {})', ctx);
const poolChartHtml = captured.chart || '';
t('pool scope: ไม่มี .nrr-qcol-pair (ไม่โชว์ "ตัวตั้ง ฿0" หลอก)', poolChartHtml.indexOf('nrr-qcol-pair') === -1,
  poolChartHtml.slice(poolChartHtml.indexOf('nrr-qcol-nrr'), poolChartHtml.indexOf('nrr-qcol-nrr') + 200));
t('pool scope: กราฟยังเรนเดอร์แท่งได้ปกติ (.nrr-qcol-stack มีอยู่)', poolChartHtml.indexOf('nrr-qcol-stack') !== -1);
t('base column title ย้ายไปอยู่ที่ .nrr-qcol-cap แล้ว (wrapper เป็น display:contents ไม่มี hit-area)',
  /class="nrr-qcol-cap num" title="/.test(poolChartHtml), poolChartHtml.slice(0, 160));

console.log('\n' + (fail ? '❌' : '✅') + ' verify_nrr_presentation_labels: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
