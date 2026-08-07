#!/usr/bin/env node
// tools/verify_commission_workbook.js — v_xlsx (RECON-GRADE v2 งาน X)
//
// ล็อกสัญญาของ Excel export หลายชีท:
//   1. รายชื่อ/ลำดับชีทคงที่ (README, SUMMARY, TL_COMMISSION, NRR_OUTLETS,
//      UPSELL, EXPANSION, HANDOVER, RECON)
//   2. NRR_OUTLETS = base_audit ∪ numerator_audit บน (account,outlet) —
//      1 ร้าน 1 แถว ฐานกับเดือนปัจจุบันแถวเดียวกัน + สถานะข้อมูลถูก 3 แบบ
//   3. แถว UPSELL สดมีชื่อบัญชี/ร้านครบ + P3 มีฐานสูงสุด/เดือนฐานเป็นคอลัมน์
//   4. gate P3 ย้อนเดือน: ไฟล์ไม่ครอบ → 0 แถว P3 สด + แถวสถานะ 1 แถว/KAM +
//      README บอกสถานะ · ไฟล์ครอบ (หลัง rerun SQL) → แถว P3 สดกลับมาเอง
//   5. SUMMARY จ่ายจริง = payout_amount (golden reconcile) · ownership columns
//      มาจาก kam_rep_view ตรงตำแหน่ง
//   6. XML: parse ผ่าน (python ET), ss:Name ≤31+unique, เลขเป็น ss:Type=Number
//
// Usage: node tools/verify_commission_workbook.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PERIOD = '2026-07';
const KAM = 'kam@test.co', TL = 'tl@test.co';

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}
function section(s) { console.log('\n' + s); }

// ── engine fixture rows (ก.ค.): A1 both-months, A2 base-only (churn-out ก็ยัง
// อยู่ audit ฐาน), A3 perf-only (new_sales), A4 expansion — ownership ครบ
function qRows() {
  const mk = (o) => Object.assign({
    period_month: PERIOD, movement_type: 'core_nrr', transfer_scope: 'in_team',
    current_portfolio: 'KAM', current_staff_owner: 'staff-now', base_portfolio: 'Admin',
    base_staff_owner: 'staff-old',
    account_name: 'บริษัท ' + o.acc, res_name: 'ร้าน ' + o.acc, account_type: 'SA', cohort_month: '2025-01',
    base_days: 30, curr_days: 30,
    first_dollar_date: '2025-01-15', first_portfolio_date: '', first_dollar_owner: 'sales-a',
    new_user_exp_date: '2025-07-15', latest_tl: 'TL', base_tl: 'TL',
    latest_staff_owner: 'staff-now', latest_commercial_owner: 'KAM',
    latest_kam_email: KAM, latest_tl_email: TL, base_kam_email: 'oldkam@test.co', base_tl_email: TL
  }, o);
  return [
    mk({ acc: 'A1', account_id: 'A1', outlet_id: 'O1', base_gmv: 600000, curr_gmv: 630000 }),
    mk({ acc: 'A2', account_id: 'A2', outlet_id: 'O2', base_gmv: 0, curr_gmv: 0 }),          // base_gmv=0 → base-audit excluded row
    mk({ acc: 'A3', account_id: 'A3', outlet_id: 'O3', base_gmv: 0, curr_gmv: 50000, movement_type: 'new_sales', cohort_month: PERIOD }),
    mk({ acc: 'A4', account_id: 'A4', outlet_id: 'O4', base_gmv: 0, curr_gmv: 80000, movement_type: 'expansion', cohort_month: PERIOD })
  ];
}

function snapshotRows() {
  const LOCK = '2026-08-01T00:25:00.000Z';
  return [
    { id: 1, period_month: PERIOD, beneficiary_role: 'kam', beneficiary_email: KAM, team_lead_email: TL,
      raw_nrr_pct: 105, governed_nrr_pct: 105, payout_amount: 15300, snapshot_status: 'final', updated_at: LOCK,
      breakdown: { kam_name: 'กาม ทดสอบ', computed_at: LOCK, nrr_pct: 105, nrr_payout: 10000,
        components_subtotal: 15300, gmv_gate: { cap_multiplier: 1 },
        upsell_sku: {
          p1: { gmv: 69850, comm: 1048, groups: [{ groupKey: 'ส้ม', category: 'Fruit', applied_rate: 0.015, total_gmv: 69850, commission: 1048 }] },
          p3: { gmv_incremental: 254586, comm: 3819, groups: [{ groupKey: 'หมู', category: 'Meat', applied_rate: 0.015, incremental: 254586, commission: 3819 }] } },
        upsell_outlet: { outlet_gmv: 86688, commission: 433, rate: 0.005 },
        handover: { payout: 1000, retention_pct: 102.5, accounts: 1, data_missing: false,
          detail: [{ account_id: 'A9', name: 'บริษัท เก้า', transfer_month: '2026-06', baseline: 30000, current: 30750 }] } } },
    { id: 2, period_month: PERIOD, beneficiary_role: 'tl', beneficiary_email: TL,
      raw_nrr_pct: 104, governed_nrr_pct: 104, payout_amount: 60000, snapshot_status: 'final', updated_at: LOCK,
      breakdown: { team_lead_name: 'หัวหน้า ทดสอบ', computed_at: LOCK, nrr_payout: 50000,
        team_upsell_gmv: 1908864, upsell_mult: { multiplier: 1.2, team_upsell_pct: 2.86 } } }
  ];
}

// bundle: ก.ค. lookback (existingGmv คุมได้) + ส.ค. เดือนปัจจุบันของไฟล์
function bundle(julExisting, asP3) {
  const months = {};
  months['ก.ค. 2569'] = { existingGmv: julExisting, totalGmv: julExisting || 69850 };
  months['ส.ค. 2569'] = { existingGmv: 40000, totalGmv: 50000 };
  // โหมด P3: กลุ่มต้องอยู่ใน baselineGroups (= กลุ่มเดิม ไม่ใช่ของใหม่) + มีเดือน
  // baseline ให้เทียบ (มิ.ย. 60000 → เกณฑ์ 2× = 120000; existing 130000 ผ่าน)
  if (asP3) months['มิ.ย. 2569'] = { existingGmv: 0, totalGmv: 60000 };
  return { loaded: true, data: { A1: { O1: { 'ส้ม': months } } },
    baselineGroups: asP3 ? { A1: { O1: { 'ส้ม': true } } } : {},
    groupCategory: { 'ส้ม': 'Fruit' } };
}

function makeCtx(julExisting, asP3) {
  const FROZEN = new Date('2026-08-07T03:00:00Z').getTime();
  class FrozenDate extends Date {
    constructor(...a) { if (!a.length) super(FROZEN); else super(...a); }
    static now() { return FROZEN; }
  }
  const all = qRows();
  const ctx = {
    window: { addEventListener() {}, removeEventListener() {}, location: { hash: '' } },
    document: {
      getElementById: () => null, addEventListener() {}, querySelectorAll: () => [],
      createElement: () => ({ style: {}, appendChild() {}, click() {}, setAttribute() {} }),
      body: { appendChild() {}, removeChild() {} }
    },
    navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, URL: { createObjectURL: () => '', revokeObjectURL() {} }, Blob: function () {},
    Date: FrozenDate, JSON, Math, Object, Array, String, Number, Boolean, isNaN,
    parseFloat, parseInt, Set, Map, Promise, RegExp, Error,
    QNRR_CFG: { quarter: '2026q3', base_month: '2026-06', q_months: ['2026-07', '2026-08', '2026-09'],
                months_th: { '2026-06': 'มิ.ย.', '2026-07': 'ก.ค.', '2026-08': 'ส.ค.', '2026-09': 'ก.ย.' } },
    bulkQnrrData: { byKamEmail: { [KAM]: all }, byTlEmail: { [TL]: all }, allRows: all, loaded: true },
    bulkPortviewData: { allRows: [
      { account_id: 'A1', account_name: 'บริษัท A1' }, { account_id: 'A4', account_name: 'บริษัท A4' },
      { account_id: 'A9', account_name: 'บริษัท เก้า' }] },
    bulkOutletsData: { byAccountId: { A1: [{ outlet_id: 'O1', outlet_name: 'สาขาหนึ่ง' }] } },
    nrrRoleRoster: { nonKamSet: new Set(), adSet: new Set() },
    nrrAccountWaivedForPeriod: () => false,
    nrrProfile: { email: 'admin@test.co', role: 'admin' },
    supa: null
  };
  ctx.window.QNRR_CFG = ctx.QNRR_CFG;
  ctx.window.bulkQnrrData = ctx.bulkQnrrData;
  ctx.window.bulkPortviewData = ctx.bulkPortviewData;
  ctx.window.bulkOutletsData = ctx.bulkOutletsData;
  ctx.window.nrrRoleRoster = ctx.nrrRoleRoster;
  ctx.window.nrrAccountWaivedForPeriod = ctx.nrrAccountWaivedForPeriod;
  vm.createContext(ctx);
  ['src/nrr/nrr_core.js', 'src/nrr/nrr_logic.js', 'src/nrr/nrr_aggregate.js',
   'src/nrr/nrr_router.js', 'src/nrr/nrr_data.js', 'src/nrr/nrr_exclusions.js',
   'src/nrr/nrr_commission.js', 'src/nrr/nrr_waivers.js', 'src/nrr/nrr_portfolio.js',
   'src/nrr/nrr_components.js', 'src/nrr/nrr_view.js'].forEach(f => {
    try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx); }
    catch (e) { console.error('LOAD FAIL ' + f + ': ' + e.message); process.exit(1); }
  });
  vm.runInContext('nrrCommRatesCache = { byKey: {}, loaded: true };' +
    'nrrCommPlansCache = { tiersByPlan: {}, assignments: {}, loaded: true };', ctx);
  // ไฟล์ data/view ตอน load อาจ reset window.bulk* — ยัด fixture กลับหลังโหลดเสมอ
  ctx.__pv = ctx.bulkPortviewData; ctx.__bo = ctx.bulkOutletsData; ctx.__qd = ctx.bulkQnrrData;
  vm.runInContext('window.bulkPortviewData = __pv; bulkPortviewData = __pv;' +
    'window.bulkOutletsData = __bo; try { bulkOutletsData = __bo; } catch (e) {}' +
    'window.bulkQnrrData = __qd; bulkQnrrData = __qd;', ctx);
  ctx.__snap = snapshotRows();
  vm.runInContext('nrrCommPeriodCache["' + PERIOD + '"] = { rows: __snap, loaded: true };', ctx);
  ctx.__bundle = bundle(julExisting, asP3);
  vm.runInContext('nrrFetchUpsellBundle = function () { return Promise.resolve(__bundle); };' +
    'window.nrrFetchUpsellBundle = nrrFetchUpsellBundle;' +
    'nrrFetchPortviewCsv = function () { return Promise.resolve(window.bulkPortviewData); };' +
    'window.nrrFetchPortviewCsv = nrrFetchPortviewCsv;' +
    'nrrFetchBulkOutletsCsv = function () { return Promise.resolve(window.bulkOutletsData); };' +
    'window.nrrFetchBulkOutletsCsv = nrrFetchBulkOutletsCsv;', ctx);
  return ctx;
}

function col(sheet, header) {
  const i = sheet.headers.indexOf(header);
  if (i === -1) throw new Error('no header ' + header + ' in ' + sheet.name);
  return i;
}

(async () => {
  // ── รอบที่ 1: เดือนย้อนหลัง + ไฟล์ไม่ครอบ (gate ปิด) ──
  const ctx = makeCtx(0);
  const wb = await vm.runInContext('nrrBuildCommissionWorkbook("' + PERIOD + '")', ctx);

  section('[1] โครง workbook');
  t('build คืน workbook', !!wb && Array.isArray(wb.sheets));
  const names = wb.sheets.map(s => s.name);
  t('ชีทครบ+เรียงตามสัญญา', JSON.stringify(names) ===
    JSON.stringify(['README', 'SUMMARY', 'TL_COMMISSION', 'NRR_OUTLETS', 'UPSELL', 'EXPANSION', 'HANDOVER', 'RECON']),
    JSON.stringify(names));
  const S = {}; wb.sheets.forEach(s => { S[s.name] = s; });
  wb.sheets.forEach(s => {
    s.rows.forEach((r, i) => {
      if (r.length !== s.headers.length) { fail++; console.log('  FAIL  ' + s.name + ' row ' + i + ' col mismatch ' + r.length + '≠' + s.headers.length); }
    });
  });
  t('ทุกแถวทุกชีทจำนวนคอลัมน์ตรง header', true);

  section('[2] SUMMARY + TL_COMMISSION — golden reconcile');
  const su = S.SUMMARY;
  t('SUMMARY 1 แถว (KAM เดียว)', su.rows.length === 1, su.rows.length);
  t('จ่ายจริง = payout_amount (15,300)', su.rows[0][col(su, 'จ่ายจริง ฿')] === 15300, su.rows[0][col(su, 'จ่ายจริง ฿')]);
  t('P1/P3/Upsell รวม จาก snapshot (1048/3819/4867)',
    su.rows[0][col(su, 'P1 ฿')] === 1048 && su.rows[0][col(su, 'P3 ฿')] === 3819 && su.rows[0][col(su, 'Upsell รวม ฿')] === 4867);
  t('HO ฐาน/เดือนนี้ ฿ เป็นคอลัมน์เลขคู่ (30000/30750)',
    su.rows[0][col(su, 'HO ฐาน ฿')] === 30000 && su.rows[0][col(su, 'HO เดือนนี้ ฿')] === 30750);
  const tl = S.TL_COMMISSION;
  t('TL 1 แถว เชนคูณครบ (mult 1.2, upsell% 2.86, จ่ายจริง 60000)',
    tl.rows.length === 1 && tl.rows[0][col(tl, 'Multiplier ×')] === 1.2 &&
    tl.rows[0][col(tl, 'Upsell %')] === 2.86 && tl.rows[0][col(tl, 'จ่ายจริง ฿')] === 60000,
    JSON.stringify(tl.rows[0]));

  section('[3] NRR_OUTLETS — 1 ร้าน 1 แถว ฐาน↔เดือนนี้ + ownership');
  const no = S.NRR_OUTLETS;
  t('จำนวนแถว = |base ∪ perf| (4 ร้าน)', no.rows.length === 4, no.rows.length + ' rows: ' +
    JSON.stringify(no.rows.map(r => r[col(no, 'outlet_id')] + ':' + r[col(no, 'สถานะข้อมูล')])));
  const byOut = {}; no.rows.forEach(r => { byOut[r[col(no, 'outlet_id')]] = r; });
  t('O1 สถานะ "ทั้งสองเดือน" + ฐาน 600000 + เดือนนี้ 630000 แถวเดียวกัน',
    byOut.O1 && byOut.O1[col(no, 'สถานะข้อมูล')] === 'ทั้งสองเดือน' &&
    byOut.O1[col(no, 'GMV เดือนฐาน ฿')] === 600000 && byOut.O1[col(no, 'GMV เดือนนี้ ฿')] === 630000,
    byOut.O1 && JSON.stringify([byOut.O1[col(no, 'สถานะข้อมูล')], byOut.O1[col(no, 'GMV เดือนฐาน ฿')], byOut.O1[col(no, 'GMV เดือนนี้ ฿')]]));
  // A3 อยู่ทั้งสอง audit (base_audit สร้างจากแถวเดือนแรกชุดเดียวกัน แค่ included=N)
  t('A3 (new_sales) → ทั้งสองเดือน + ไม่นับเข้าฐาน (เหตุผล new_sales)',
    byOut.O3 && byOut.O3[col(no, 'สถานะข้อมูล')] === 'ทั้งสองเดือน' &&
    byOut.O3[col(no, 'นับเข้าฐาน')] === 'N',
    byOut.O3 && JSON.stringify([byOut.O3[col(no, 'สถานะข้อมูล')], byOut.O3[col(no, 'นับเข้าฐาน')], byOut.O3[col(no, 'เหตุผลไม่นับ')]]));
  t('ownership: portfolio เดิม→ปัจจุบัน + staff + KAM เดิม + exp date',
    byOut.O1 && byOut.O1[col(no, 'portfolio เดิม')] === 'Admin' && byOut.O1[col(no, 'portfolio ปัจจุบัน')] === 'KAM' &&
    byOut.O1[col(no, 'staff เดิม')] === 'staff-old' && byOut.O1[col(no, 'KAM เดิม')] === 'oldkam@test.co' &&
    byOut.O1[col(no, 'วันหมดสถานะลูกค้าใหม่')] === '2025-07-15',
    byOut.O1 && JSON.stringify(byOut.O1.slice(col(no, 'transfer_scope'))));

  section('[4] UPSELL — ชื่อครบ + gate P3 ย้อนเดือน');
  const up = S.UPSELL;
  const liveP1 = up.rows.filter(r => r[col(up, 'ชนิด')] === 'P1' && String(r[col(up, 'แหล่งข้อมูล')]).indexOf('สด') === 0);
  t('แถว P1 สดมีชื่อบัญชี+ชื่อร้านครบ', liveP1.length === 1 &&
    liveP1[0][col(up, 'ชื่อบัญชี')] === 'บริษัท A1' && liveP1[0][col(up, 'ชื่อร้าน')] === 'สาขาหนึ่ง',
    JSON.stringify(liveP1.map(r => [r[col(up, 'ชื่อบัญชี')], r[col(up, 'ชื่อร้าน')]])));
  const liveP3 = up.rows.filter(r => r[col(up, 'ชนิด')] === 'P3' && String(r[col(up, 'แหล่งข้อมูล')]).indexOf('สด') === 0);
  t('gate ปิด → ไม่มีแถว P3 สดที่เป็นตัวเลข มีแค่แถวสถานะ 1 แถว',
    liveP3.length === 1 && String(liveP3[0][col(up, 'สถานะ')]).indexOf('คำนวณสดไม่ได้') === 0,
    JSON.stringify(liveP3.map(r => r[col(up, 'สถานะ')])));
  const lockedP3 = up.rows.filter(r => r[col(up, 'ชนิด')] === 'P3' && String(r[col(up, 'แหล่งข้อมูล')]).indexOf('ล็อก') === 0);
  t('แถว P3 ล็อกไว้ยังอยู่ (ตัวเลขทางการ)', lockedP3.length === 1 && lockedP3[0][col(up, 'ส่วนเพิ่ม ฿')] === 254586);
  const readme = S.README.rows.map(r => r.join('=')).join('\n');
  t('README ระบุสถานะ P3 สด = คำนวณไม่ได้', readme.indexOf('สถานะ P3 สด=คำนวณไม่ได้') !== -1);
  const rec = S.RECON;
  const upRec = rec.rows.find(r => String(r[col(rec, 'รายการ')]).indexOf('Upsell') === 0);
  t('RECON upsell บอกว่าเทียบได้เฉพาะ P1 + เหตุผล', upRec && String(upRec[col(rec, 'รายการ')]).indexOf('เฉพาะ P1') !== -1 &&
    String(upRec[col(rec, 'สาเหตุที่ต่างได้')]).indexOf('P3 สดย้อนเดือน') !== -1, upRec && JSON.stringify(upRec));

  section('[5] EXPANSION + HANDOVER');
  const ex = S.EXPANSION;
  t('EXPANSION 1 แถว (O4, 80000 × 0.005 = 400)', ex.rows.length === 1 &&
    ex.rows[0][col(ex, 'GMV เดือนนี้ ฿')] === 80000 && ex.rows[0][col(ex, 'คอมมิชชั่น ฿')] === 400,
    JSON.stringify(ex.rows));
  const ho = S.HANDOVER;
  t('HANDOVER 1 แถว baseline/current แถวเดียวกัน + สถานะปกติ', ho.rows.length === 1 &&
    ho.rows[0][col(ho, 'GMV ฐานตอนรับโอน ฿')] === 30000 && ho.rows[0][col(ho, 'GMV เดือนนี้ ฿')] === 30750 &&
    ho.rows[0][col(ho, 'สถานะข้อมูล')] === 'ปกติ', JSON.stringify(ho.rows[0]));

  section('[6] รอบที่ 2 — ไฟล์ครอบเดือน (หลัง rerun SQL) → P3 สดกลับมาเอง');
  const ctx2 = makeCtx(130000, true); // ก.ค. existing 130000 > 2× ฐาน มิ.ย. 60000 → P3 สดจริง
  const wb2 = await vm.runInContext('nrrBuildCommissionWorkbook("' + PERIOD + '")', ctx2);
  const up2 = wb2.sheets.find(s => s.name === 'UPSELL');
  const liveP32 = up2.rows.filter(r => r[col(up2, 'ชนิด')] === 'P3' && String(r[col(up2, 'แหล่งข้อมูล')]).indexOf('สด') === 0);
  t('มีแถว P3 สดจริง + ฐานสูงสุด/เดือนฐานเป็นคอลัมน์', liveP32.length >= 1 &&
    liveP32[0][col(up2, 'ฐานสูงสุด ฿ (P3)')] > 0 && !!liveP32[0][col(up2, 'เดือนฐานสูงสุด')],
    JSON.stringify(liveP32.map(r => [r[col(up2, 'ฐานสูงสุด ฿ (P3)')], r[col(up2, 'เดือนฐานสูงสุด')]])));
  const readme2 = wb2.sheets[0].rows.map(r => r.join('=')).join('\n');
  t('README รอบนี้บอกคำนวณได้', readme2.indexOf('สถานะ P3 สด=คำนวณได้') !== -1);

  section('[7] XML — parse ผ่าน + ss:Name + Number types');
  const xml = vm.runInContext('nrrWorkbookToSpreadsheetXml(' + JSON.stringify({ sheets: wb.sheets }) + ')', ctx);
  const tmp = path.join(require('os').tmpdir(), 'wb_test.xml');
  fs.writeFileSync(tmp, xml);
  let parseOk = true;
  try { execFileSync('python3', ['-c', 'import xml.etree.ElementTree as ET,sys; ET.parse(sys.argv[1])', tmp]); }
  catch (e) { parseOk = false; }
  t('XML parse ผ่าน (python ElementTree)', parseOk);
  const sheetNames = [...xml.matchAll(/ss:Name="([^"]*)"/g)].map(m => m[1]);
  t('ss:Name ครบ 8 · ≤31 ตัว · unique', sheetNames.length === 8 &&
    sheetNames.every(n => n.length <= 31) && new Set(sheetNames).size === 8, JSON.stringify(sheetNames));
  t('มี cell ss:Type="Number" จริง (สูตร Excel ผูกได้)', xml.indexOf('ss:Type="Number">15300<') !== -1);
  t('คอลัมน์ string ที่เป็นข้อความไทยยังเป็น String', xml.indexOf('ss:Type="String">ทั้งสองเดือน<') !== -1);

  console.log('\n' + (fail ? '❌' : '✅') + ' verify_commission_workbook: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS CRASH:', e); process.exit(1); });
