// tools/verify_base_movements.js — v_basefix regression lock
//
// กติกาฐาน %NRR ที่บุชกำหนด: ฐาน = NRR + Churn + Comeback + Transfer In เท่านั้น
//
// บั๊กที่เจอ (2026-08-06): โค้ดเดิมกันแค่ handover กับ transfer_in ออกจากฐาน แล้ว
// พึ่งสมมติว่า new_sales/expansion จะมี base_gmv = 0 เสมอ (ลูกค้าใหม่ย่อมไม่มียอด
// เดือนฐาน) — ข้อมูลจริงหักล้างสมมติฐานนี้: 16 outlet ทั่วองค์กร รวม ฿790,891
// ถูกตีตรา cohort เดือนปัจจุบัน (new_sales) ทั้งที่มียอดเดือนฐานติดมาด้วย
// ผลคือมันเข้า "ตัวหาร" แต่ไม่เข้า "ตัวตั้ง" (ตัวตั้งรับแค่ core_nrr/churn/
// transfer_in/comeback) → กด %NRR ลงทั้งไตรมาส → Tape 99.69% กับ Monet 99.89%
// พลาดเกณฑ์ 100% ทั้งที่ควรได้คนละ ฿5,000
//
// ไฟล์นี้ล็อกกติกาไว้กับ engine ทั้งสองฝั่งพร้อมกัน:
//   src/07c_qnrr_view.js  = ตัวคิดเงินจริง (_qnrrComputeForCommission)
//   src/nrr/nrr_logic.js  = ตัวโชว์บนจอ /nrr
// ถ้าวันหลังมีคนแก้ฝั่งเดียว ไฟล์นี้จะแดงทันที — ซึ่งคือปัญหาที่เกิดซ้ำมาหลายรอบแล้ว
//
// Usage: node tools/verify_base_movements.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KAM = 'kam@test.co';
const BASE_DAYS = 30;   // base_days=30 → norm×30 = ยอดดิบ อ่านเลขง่าย

// outlet ละ 1 แถวต่อเดือน · base_gmv > 0 ทุกตัว "โดยตั้งใจ" เพราะหัวใจของบั๊กคือ
// movement ที่ไม่ควรอยู่ในฐาน แต่ดันมียอดเดือนฐานติดมา
const OUTLETS = [
  { id: 'OUT-CORE',  mv: 'core_nrr',  base: 100000, curr: 90000, inBase: true,  why: 'core_nrr = ฐานเต็มตัว' },
  { id: 'OUT-CHURN', mv: 'core_nrr',  base:  50000, curr:     0, inBase: true,  why: 'churn ต้องอยู่ในฐาน (curr=0 → core_nrr_churn)' },
  { id: 'OUT-NEW',   mv: 'new_sales', base:  40000, curr: 30000, inBase: false, why: 'new_sales ห้ามเข้าฐาน ← บั๊กตัวจริง' },
  { id: 'OUT-EXP',   mv: 'expansion', base:  20000, curr: 10000, inBase: false, why: 'expansion ห้ามเข้าฐาน' },
  { id: 'OUT-HO',    mv: 'handover',  base:  30000, curr: 25000, inBase: false, why: 'handover ห้ามเข้าฐาน (เดิมถูกอยู่แล้ว)' }
];
const EXPECTED_BASE = OUTLETS.filter(o => o.inBase).reduce((s, o) => s + o.base, 0); // 150,000

function rows() {
  const out = [];
  ['2026-07', '2026-08'].forEach(m => OUTLETS.forEach(o => out.push({
    period_month: m, movement_type: o.mv, transfer_scope: '',
    current_portfolio: 'KAM', base_portfolio: 'KAM',
    outlet_id: o.id, account_id: 'ACC-' + o.id, account_name: o.id, res_name: o.id,
    account_type: 'SA', cohort_month: o.mv === 'new_sales' ? '2026-07' : '2025-01',
    curr_gmv: o.curr, base_gmv: o.base, base_days: BASE_DAYS, curr_days: 30,
    latest_staff_owner: 'TestKam', latest_kam_email: KAM,
    latest_tl_email: 'tl@test.co', base_kam_email: KAM, base_tl_email: 'tl@test.co'
  })));
  return out;
}

function bulk() {
  const all = rows();
  return { byKamEmail: { [KAM]: all }, byTlEmail: { 'tl@test.co': all }, allRows: all, loaded: true };
}

// 07c เป็นไฟล์ฝั่ง Sense — ต้องมี global ครบกว่า /nrr เล็กน้อย
function run(relPath) {
  const ctx = {
    window: {}, console,
    QNRR_CFG: { quarter: '2026q3', base_month: '2026-06', q_months: ['2026-07', '2026-08', '2026-09'],
                months_th: {}, csv_file: 'kam_rep_view.csv' },
    bulkQnrrData: bulk(),
    nrrRoleRoster: { nonKamSet: new Set(), adSet: new Set() },
    nrrAccountWaivedForPeriod: () => false,
    document: { getElementById: () => null, addEventListener: () => {}, querySelectorAll: () => [] },
    setTimeout, clearTimeout
  };
  ctx.window.QNRR_CFG = ctx.QNRR_CFG;
  ctx.window.bulkQnrrData = ctx.bulkQnrrData;
  ctx.window.nrrRoleRoster = ctx.nrrRoleRoster;
  ctx.window.nrrAccountWaivedForPeriod = ctx.nrrAccountWaivedForPeriod;
  vm.createContext(ctx);
  try { vm.runInContext(fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'), ctx); }
  catch (e) { return { err: 'load: ' + e.message }; }
  try { return { res: vm.runInContext('_qnrrCompute(' + JSON.stringify(KAM) + ', "kam")', ctx) }; }
  catch (e) { return { err: 'call: ' + e.message }; }
}

let pass = 0, fail = 0;
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✓ ' + desc); }
  else { fail++; console.log('  ✗ ' + desc + '\n      ต้องได้: ' + JSON.stringify(expected) + '\n      ได้จริง: ' + JSON.stringify(actual)); }
}

console.log('── v_basefix: ฐาน = NRR + Churn + Comeback + Transfer In เท่านั้น ──\n');

const TWINS = [
  ['Sense (คิดเงินจริง)', 'src/07c_qnrr_view.js'],
  ['/nrr  (โชว์บนจอ)',    'src/nrr/nrr_logic.js']
];
const bases = {};

TWINS.forEach(([label, rel]) => {
  console.log(label + '  —  ' + rel);
  const r = run(rel);
  if (r.err) { fail++; console.log('  ✗ โหลด/เรียกไม่ได้: ' + r.err); return; }
  const base = Math.round(r.res.base_norm_original * 30);
  bases[label] = base;
  check('  ฐานรวม = ฿' + EXPECTED_BASE.toLocaleString() + ' (core ฿100,000 + churn ฿50,000)', base, EXPECTED_BASE);
  // ถ้าบั๊กกลับมา ฐานจะเป็น 210,000 (บวก new_sales 40,000 + expansion 20,000)
  check('  ไม่ใช่ ฿210,000 (= อาการบั๊กเดิมที่ new_sales/expansion หลุดเข้าฐาน)', base === 210000, false);
});

// ฝาแฝดต้องได้เลขเดียวกันเป๊ะ — ที่ผ่านมาแก้ฝั่งเดียวแล้วเลขคนละตัวมาหลายรอบ
console.log('\nฝาแฝดต้องตรงกัน');
check('  Sense = /nrr', bases['Sense (คิดเงินจริง)'], bases['/nrr  (โชว์บนจอ)']);

// base_audit (ฝั่ง /nrr) ต้องบอกเหตุผลตรงกับสิ่งที่เกิดขึ้นจริง
console.log('\nbase_audit ต้องอธิบายเหตุผลได้ถูกทุก outlet');
const nrr = run('src/nrr/nrr_logic.js');
if (nrr.res && nrr.res.base_audit) {
  const seen = {};
  nrr.res.base_audit.forEach(a => { if (!(a.outlet_id in seen)) seen[a.outlet_id] = a.included; });
  OUTLETS.forEach(o => check('  ' + o.id + ' → ' + (o.inBase ? 'เข้าฐาน' : 'ไม่เข้าฐาน') + ' · ' + o.why,
    seen[o.id], o.inBase));
  const sum = nrr.res.base_audit.filter(a => a.included).reduce((s, a) => s + a.base_norm_30d, 0);
  check('  ผลรวม audit = ฐานจริงของ engine (audit โกหกไม่ได้)',
    Math.abs(sum - nrr.res.base_norm_original * 30) < 1, true);
} else { fail++; console.log('  ✗ ไม่มี base_audit'); }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
