#!/usr/bin/env node
/**
 * verify_upsell_period_guard.js — v_augfix
 *
 * เรื่องที่ harness นี้กัน (เจอจริง 2026-08-02):
 *
 *   draft ของเดือน ส.ค. ทั้ง 44 แถวถูกคำนวณตอน 1 ส.ค. 00:27 — ตอนนั้นไฟล์ upsell
 *   บน R2 ยังเป็นข้อมูลของ **ก.ค.** (SQL ยึด day-1 lag) → ตัวเลข ก.ค. ถูกเขียนลง
 *   DB โดยติดป้ายว่าเป็น ส.ค. · upsell ที่ควรเป็น ฿40,783 กลายเป็น ฿4,740,065
 *
 * รากปัญหา: `_commComputeUpsellSku` **ไม่เคยรู้ว่ากำลังคำนวณเดือนไหน**
 *   มันเลือกเดือนจาก `_commLagDate()` = นาฬิกาจริง −1 วัน เสมอ
 *   → ขอเดือนไหนก็ได้เดือนเดียวกันหมด ผิดได้ 2 ทาง:
 *     1. วันที่ 1 ของเดือน  → ขอเดือนใหม่ ได้ข้อมูลเดือนเก่า  (เคส ส.ค. ที่เกิดจริง)
 *     2. คำนวณย้อนหลัง      → ขอเดือนเก่า ได้ข้อมูลเดือนปัจจุบัน
 *
 * ★ ข้อที่สำคัญที่สุดในไฟล์นี้: **ไม่ส่ง period = ต้องได้เลขเดิมเป๊ะ**
 *   call site เดิมกว่า 10 จุด (หน้า KAM, CDS, portview, strip) เรียกแบบไม่ระบุเดือน
 *   ทั้งหมดแปลว่า "เอาเดือนล่าสุด" — ถ้าพฤติกรรมนั้นขยับ = หน้าจอผู้ใช้เพี้ยนหมด
 *
 * รัน: node tools/verify_upsell_period_guard.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}
function section(s) { console.log('\n' + s); }

function setGlobal(ctx, name, value) {
  ctx.__inject = value;
  vm.runInContext(name + ' = __inject; try{ window.' + name + ' = __inject; }catch(e){}', ctx);
  delete ctx.__inject;
}

// นาฬิกาปลอม — ทุกเคสในไฟล์นี้ต้องระบุวันเองเสมอ ห้ามพึ่งวันจริงของเครื่อง
function makeCtx(nowISO) {
  const FROZEN = new Date(nowISO).getTime();
  class FrozenDate extends Date {
    constructor(...a) { if (!a.length) super(FROZEN); else super(...a); }
    static now() { return FROZEN; }
  }
  const ctx = {
    window: {}, document: {
      head: { appendChild() {} }, body: { appendChild() {} }, addEventListener() {},
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} },
        appendChild() {}, setAttribute() {}, addEventListener() {} })
    },
    navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Date: FrozenDate, JSON, Math, Object, Array, String, Number, Boolean, isNaN,
    parseFloat, parseInt, Set, Map, Promise, RegExp, Error, Infinity
  };
  vm.createContext(ctx);
  // 05_kam_view.js supplies getThaiMonthDays, which _tgtComputeKamNRR calls in
  // live (non-frozen) mode — section [8] exercises that path.
  ['src/05_kam_view.js', 'src/07a_commission_engine.js', 'src/07b_commission_cockpit.js',
   'src/07b_nrr_target.js', 'src/07b_cds.js', 'src/07c_qnrr_view.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  return ctx;
}

// ── ข้อมูลจำลอง ────────────────────────────────────────────────────────────
// KAM หนึ่งคน ร้านหนึ่งร้าน กลุ่มสินค้าหนึ่งกลุ่ม แต่มี GMV สองเดือนที่ต่างกันมาก
// ก.ค. = 1,000,000 (เดือนที่ข้อมูลเต็ม)   ส.ค. = 10,000 (เพิ่งผ่านไปวันเดียว)
// ต่างกัน 100 เท่า เพื่อให้ "หยิบผิดเดือน" มองเห็นทันทีในตัวเลขผลลัพธ์
const KAM = 'kam1@freshket.co';
const JUL = 'ก.ค. 2569', AUG = 'ส.ค. 2569';

function seedUpsell(ctx, months) {
  const groups = {};
  Object.keys(months).forEach(lbl => { groups[lbl] = { existingGmv: 0, totalGmv: months[lbl] }; });
  setGlobal(ctx, 'bulkUpsellData', {
    loaded: true,
    byKam: { [KAM]: { 'acct-1': { 'outlet-1': { 'ผักสด': groups } } } },
    baselineGroups: {},        // ว่าง = ทุกกลุ่มเป็น P1 (ของใหม่) → ตรวจง่ายที่สุด
    groupCategory: {},
    monthLabels: new Set(Object.keys(months))
  });
  setGlobal(ctx, 'portviewBulkData', [
    { kamEmail: KAM, kamName: 'KAM หนึ่ง', tlEmail: 'tl1@freshket.co', id: 'acct-1' }
  ]);
}

function seedTiers(ctx) {
  setGlobal(ctx, '_commRuleConfig', { plans: {}, rules: {}, tiers: {}, assignments: [] });
  setGlobal(ctx, '_tgtSettings', {
    nrr_threshold: 98,
    upsell_sku: { p1_rate: 0.01, p3_rate: 0.01, p1_min_gmv: 5000 },
    upsell_outlet: { rate: 0.005 }
  });
}

// เรียก _commComputeUpsellSku โดยส่ง periodOverride เป็นตัวที่ 6
function skuFor(ctx, period) {
  ctx.__per = period === undefined ? undefined : period;
  return vm.runInContext(
    '_commComputeUpsellSku(' + JSON.stringify(KAM) + ', undefined, null, null, null, __per)', ctx);
}

// ═════════════════════════════════════════════════════════════════════════
section('[1] _commPeriodToLabel — แปลง period เป็น label ไทย');
{
  const ctx = makeCtx('2026-08-02T03:00:00Z');
  const cases = [
    ['2026-01', 'ม.ค. 2569'], ['2026-07', 'ก.ค. 2569'],
    ['2026-08', 'ส.ค. 2569'], ['2026-12', 'ธ.ค. 2569'], ['2027-01', 'ม.ค. 2570']
  ];
  cases.forEach(([per, exp]) => {
    ctx.__p = per;
    const got = vm.runInContext('_commPeriodToLabel(__p)', ctx);
    t(`${per} → ${exp}`, got === exp, 'ได้ ' + got);
  });
  ctx.__p = null;
  t('null → null (ไม่เดาเป็นเดือนปัจจุบัน)', vm.runInContext('_commPeriodToLabel(__p)', ctx) === null);
  ctx.__p = 'ขยะ';
  t('ค่าขยะ → null', vm.runInContext('_commPeriodToLabel(__p)', ctx) === null);
}

// ═════════════════════════════════════════════════════════════════════════
section('[2] ★ หัวใจ — ขอเดือนไหน ต้องได้เดือนนั้น ไม่ใช่เดือนตามนาฬิกา');
{
  // จำลองสถานการณ์จริง: ยืนอยู่วันที่ 1 ส.ค. (lag = 31 ก.ค.) ไฟล์มีทั้งสองเดือน
  const ctx = makeCtx('2026-08-01T00:27:00Z');
  seedTiers(ctx);
  seedUpsell(ctx, { [JUL]: 1000000, [AUG]: 10000 });

  const jul = skuFor(ctx, '2026-07');
  const aug = skuFor(ctx, '2026-08');

  t('ขอ 2026-07 → ได้ GMV ของ ก.ค. (1,000,000)',
    jul && jul.p1.gmv === 1000000, 'ได้ ' + (jul && jul.p1.gmv));
  t('★ ขอ 2026-08 → ได้ GMV ของ ส.ค. (10,000) ไม่ใช่ ก.ค.',
    aug && aug.p1.gmv === 10000,
    'ได้ ' + (aug && aug.p1.gmv) + ' — ถ้าได้ 1000000 คือบั๊กเดิมที่ทำให้ draft ส.ค. พัง');
  t('สองเดือนต้องได้คนละเลข (ไม่ใช่ตัวเดียวกันทั้งคู่)',
    jul && aug && jul.p1.gmv !== aug.p1.gmv);
}

// ═════════════════════════════════════════════════════════════════════════
section('[3] ★ คำนวณย้อนหลัง — ขอเดือนเก่าตอนที่นาฬิกาเดินไปไกลแล้ว');
{
  // 5 ก.ย. — "เดือนล่าสุดตามนาฬิกา" คือ ก.ย. แต่เราขอ ก.ค.
  const ctx = makeCtx('2026-09-05T03:00:00Z');
  seedTiers(ctx);
  seedUpsell(ctx, { [JUL]: 1000000, [AUG]: 10000 });

  const jul = skuFor(ctx, '2026-07');
  t('ขอ 2026-07 ตอน 5 ก.ย. → ยังได้ ก.ค. (1,000,000)',
    jul && jul.p1.gmv === 1000000,
    'ได้ ' + (jul && jul.p1.gmv) + ' — ถ้าได้ 10000 แปลว่าหยิบ ส.ค. มาแทน');

  const sep = skuFor(ctx, '2026-09');
  t('★ ขอ 2026-09 ที่ไฟล์ไม่มี → ต้องปฏิเสธ (null) ไม่ใช่คืน ฿0 เงียบๆ',
    sep === null,
    'ได้ ' + JSON.stringify(sep) + ' — ฿0 แยกไม่ออกจาก "ไม่มียอดจริง" จึงห้ามใช้');
}

// ═════════════════════════════════════════════════════════════════════════
section('[4] ★ ไม่ส่ง period = พฤติกรรมเดิมเป๊ะ (call site เก่ากว่า 10 จุดพึ่งอันนี้)');
{
  const ctx = makeCtx('2026-08-01T00:27:00Z');   // lag = 31 ก.ค. → เดือนล่าสุด = ก.ค.
  seedTiers(ctx);
  seedUpsell(ctx, { [JUL]: 1000000, [AUG]: 10000 });

  const noPeriod = skuFor(ctx, undefined);
  t('ไม่ส่ง period ตอน 1 ส.ค. → ได้ ก.ค. ตามนาฬิกา (เหมือนเดิม)',
    noPeriod && noPeriod.p1.gmv === 1000000, 'ได้ ' + (noPeriod && noPeriod.p1.gmv));
  t('ไม่ส่ง period ต้องไม่คืน null เด็ดขาด (จอจะขาว)', noPeriod !== null);

  const ctx2 = makeCtx('2026-08-15T03:00:00Z');  // lag = 14 ส.ค. → เดือนล่าสุด = ส.ค.
  seedTiers(ctx2);
  seedUpsell(ctx2, { [JUL]: 1000000, [AUG]: 10000 });
  const noPeriod2 = skuFor(ctx2, undefined);
  t('ไม่ส่ง period ตอน 15 ส.ค. → ได้ ส.ค. ตามนาฬิกา (เหมือนเดิม)',
    noPeriod2 && noPeriod2.p1.gmv === 10000, 'ได้ ' + (noPeriod2 && noPeriod2.p1.gmv));

  // เดือนที่ไม่มีในไฟล์เลย แต่ไม่ได้ระบุ period → ต้องคืนก้อนศูนย์ ไม่ใช่ null
  const ctx3 = makeCtx('2026-12-15T03:00:00Z');
  seedTiers(ctx3);
  seedUpsell(ctx3, { [JUL]: 1000000 });
  const noPeriod3 = skuFor(ctx3, undefined);
  t('ไม่ส่ง period + ไฟล์ไม่มีเดือนนั้น → คืนก้อน ฿0 (เหมือนเดิม) ไม่ใช่ null',
    noPeriod3 !== null && noPeriod3.total_comm === 0,
    'ได้ ' + JSON.stringify(noPeriod3 && noPeriod3.total_comm));
}

// ═════════════════════════════════════════════════════════════════════════
section('[5] ตัวคูณ TL — ทางลัดต้องปิดเมื่อระบุเดือน');
{
  // ไฟล์ทีม (ทางลัด) ไม่มีคอลัมน์เดือนติดมาเลย ตอบได้แค่ "วันนี้" เท่านั้น
  // ถ้าระบุเดือนเจาะจงแล้วยังใช้ทางลัด = เอาเลขเดือนอื่นมาตอบ
  const ctx = makeCtx('2026-08-01T00:27:00Z');
  seedTiers(ctx);
  seedUpsell(ctx, { [JUL]: 1000000, [AUG]: 10000 });
  setGlobal(ctx, 'bulkUpsellTeamData', { [KAM]: { p1_gmv: 1000000, p3_incr: 0,
    outlet_gmv: 0, tl_upsell_base: 1000000 } });   // ← ค่าของ ก.ค.
  setGlobal(ctx, 'bulkHistoryData', {});

  ctx.__per = '2026-08';
  const withPeriod = vm.runInContext(
    "_commComputeTeamUpsellMult('tl1@freshket.co', false, null, null, null, __per)", ctx);
  t('★ ระบุ 2026-08 → ต้องไม่หยิบ 1,000,000 จากไฟล์ทีม (ซึ่งเป็นของ ก.ค.)',
    withPeriod && withPeriod.team_upsell_gmv !== 1000000,
    'ได้ ' + (withPeriod && withPeriod.team_upsell_gmv));

  const noPeriod = vm.runInContext(
    "_commComputeTeamUpsellMult('tl1@freshket.co', false, null, null, null, undefined)", ctx);
  t('ไม่ระบุเดือน → ยังใช้ทางลัดเหมือนเดิม (1,000,000)',
    noPeriod && noPeriod.team_upsell_gmv === 1000000,
    'ได้ ' + (noPeriod && noPeriod.team_upsell_gmv));
}

// ═════════════════════════════════════════════════════════════════════════
section('[6] ★ นาฬิกาสองเรือนต้องเดินตรงกัน');
{
  // _nrrExclusionCurrentPeriod เดิมใช้ new Date() ไม่หัก 1 วัน
  // แต่ฝั่งข้อมูลใช้ _commLagDate() หัก 1 วัน → วันที่ 1 ของเดือนสองเรือนชี้คนละเดือน
  // นี่คือกลไกที่ทำให้ป้าย "ส.ค." ไปแปะบนข้อมูล ก.ค.
  const d1 = makeCtx('2026-08-01T00:27:00Z');
  t('★ 1 ส.ค. → period ต้องเป็น 2026-07 (ตรงกับข้อมูลที่มีจริง)',
    vm.runInContext('_nrrExclusionCurrentPeriod()', d1) === '2026-07',
    'ได้ ' + vm.runInContext('_nrrExclusionCurrentPeriod()', d1));
  t('   และ label ฝั่งข้อมูลต้องชี้เดือนเดียวกัน',
    vm.runInContext('_commCurrentMonthLabel()', d1) === JUL);

  const d2 = makeCtx('2026-08-02T03:00:00Z');
  t('2 ส.ค. → period = 2026-08', vm.runInContext('_nrrExclusionCurrentPeriod()', d2) === '2026-08');
  t('   label ฝั่งข้อมูล = ส.ค.', vm.runInContext('_commCurrentMonthLabel()', d2) === AUG);

  const d3 = makeCtx('2026-08-31T16:00:00Z');
  t('31 ส.ค. → period = 2026-08 (ยังไม่ข้ามเดือน)',
    vm.runInContext('_nrrExclusionCurrentPeriod()', d3) === '2026-08');
}

// ═════════════════════════════════════════════════════════════════════════
section('[7] ★ เดือนที่ยังไม่จบ ห้ามเขียน draft');
{
  const ctx = makeCtx('2026-08-02T03:00:00Z');
  const closed = p => { ctx.__p = p; return vm.runInContext('_commPeriodIsClosed(__p)', ctx); };
  t('2026-07 (จบแล้ว) → เขียนได้', closed('2026-07') === true);
  t('2026-06 (จบนานแล้ว) → เขียนได้', closed('2026-06') === true);
  t('★ 2026-08 (เพิ่งวันที่ 2) → ต้องปฏิเสธ', closed('2026-08') === false);
  t('2026-09 (อนาคต) → ต้องปฏิเสธ', closed('2026-09') === false);

  // เส้นแบ่งวันสุดท้าย: 31 ส.ค. ยังไม่จบ · 1 ก.ย. จบแล้ว
  const last = makeCtx('2026-08-31T16:00:00Z');
  last.__p = '2026-08';
  t('31 ส.ค. → 2026-08 ยังไม่จบ ปฏิเสธ',
    vm.runInContext('_commPeriodIsClosed(__p)', last) === false);
  const next = makeCtx('2026-09-01T01:00:00Z');
  next.__p = '2026-08';
  t('★ 1 ก.ย. → 2026-08 จบแล้ว เขียนได้ (auto-compute ต้องยังทำงาน)',
    vm.runInContext('_commPeriodIsClosed(__p)', next) === true);
}

// ═════════════════════════════════════════════════════════════════════════
section('[8] ★ คนที่ไม่มีร้านของตัวเอง ต้องไม่ได้ก้อน GMV รวมทั้งบริษัท');
{
  // บั๊กจริง: _tgtComputeKamNRR มี fallback ที่ถ้าหา account ของคนนี้ไม่เจอ
  // จะยกทุก account ใน bulkHistoryData มาให้เป็นของเขา → sales/admin 24 คน
  // ได้ outlet GMV ก้อนเดียวกันทั้งบริษัท (฿1,790,879) คนละ ฿8,954 เท่ากันเป๊ะ
  const ctx = makeCtx('2026-08-02T03:00:00Z');
  setGlobal(ctx, 'portviewBulkData', [
    { kamEmail: KAM, kamName: 'KAM หนึ่ง', tlEmail: 'tl1@freshket.co', id: 'acct-1' }
  ]);
  setGlobal(ctx, 'bulkHistoryData', {
    'acct-1': [{ m: JUL, gmv: 500000 }, { m: AUG, gmv: 500000 }],
    'acct-2': [{ m: JUL, gmv: 800000 }, { m: AUG, gmv: 800000 }]
  });

  ctx.__e = 'sales9@freshket.co';   // ไม่มีใน portviewBulkData เลย
  const orphan = vm.runInContext('_tgtComputeKamNRR(__e, null, "2026-07")', ctx);
  t('★ คนที่ไม่มีร้านเลย → ต้องได้ null ไม่ใช่ยอดรวมทั้งบริษัท',
    orphan === null,
    'ได้ ' + JSON.stringify(orphan && { base: orphan.baselinePrevGmv }) +
    ' — ถ้าได้ตัวเลข = บั๊กที่ทำให้ sales/admin 24 คนได้ ฿8,954 เท่ากันหมด');

  ctx.__e = KAM;
  const real = vm.runInContext('_tgtComputeKamNRR(__e, null, "2026-07")', ctx);
  t('คนที่มีร้านจริง → ยังคำนวณได้ตามปกติ', real !== null);

  // load race ของจริง: portviewBulkData ว่างชั่วคราวตอน token refresh
  // เคสนี้ fallback ยังต้องทำงาน ไม่งั้นหน้าจอจะพังตอนบูต
  const ctx2 = makeCtx('2026-08-02T03:00:00Z');
  setGlobal(ctx2, 'portviewBulkData', []);
  setGlobal(ctx2, 'bulkHistoryData', {
    'acct-1': [{ m: JUL, gmv: 500000 }, { m: AUG, gmv: 500000 }]
  });
  ctx2.__e = KAM;
  const racing = vm.runInContext('_tgtComputeKamNRR(__e, null, "2026-07")', ctx2);
  t('portviewBulkData ว่าง (load race จริง) → fallback ยังต้องทำงาน',
    racing !== null, 'ได้ null — เท่ากับทำหน้าจอพังตอนบูต');
}

// ═════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// v_brkperiod (RECON-GRADE v2 งาน B) — ฝั่ง /nrr: nrrEnumerateUpsellGroups
// รับ overrides.evalLabel + gate nrrUpsellBundleCoversPeriod
// ═══════════════════════════════════════════════════════════════════════════

function makeNrrCtx(nowISO) {
  const FROZEN = new Date(nowISO).getTime();
  class FrozenDate extends Date {
    constructor(...a) { if (!a.length) super(FROZEN); else super(...a); }
    static now() { return FROZEN; }
  }
  const ctx = {
    window: { addEventListener() {}, location: { hash: '' } },
    document: { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] },
    navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout: () => 0, clearTimeout() {},
    Date: FrozenDate, JSON, Math, Object, Array, String, Number, Boolean, isNaN,
    parseFloat, parseInt, Set, Map, Promise, RegExp, Error,
    QNRR_CFG: { quarter: '2026q3', base_month: '2026-06', q_months: ['2026-07', '2026-08', '2026-09'],
                months_th: { '2026-06': 'มิ.ย.', '2026-07': 'ก.ค.', '2026-08': 'ส.ค.' } },
    supa: null
  };
  ctx.window.QNRR_CFG = ctx.QNRR_CFG;
  vm.createContext(ctx);
  ['src/nrr/nrr_data.js', 'src/nrr/nrr_commission.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  // ให้ rate getters ใช้ default (cache ว่างแบบ loaded)
  vm.runInContext('nrrCommRatesCache = { byKey: {}, loaded: true };', ctx);
  return ctx;
}

// bundle จำลอง: กลุ่มเดียว มีทั้ง ก.ค. (lookback: existingGmv=0, totalGmv ใหญ่)
// และ ส.ค. (เดือนปัจจุบันของไฟล์: มี existing split จริง) — เหมือนไฟล์จริงเป๊ะ
function nrrBundle(julExisting) {
  return {
    loaded: true,
    data: { 'acct-1': { 'outlet-1': { 'ผักสด': {
      'ก.ค. 2569': { existingGmv: julExisting, totalGmv: 900000 },
      'ส.ค. 2569': { existingGmv: 40000, totalGmv: 50000 }
    } } } },
    baselineGroups: {}, groupCategory: {}
  };
}

section('[nrr-1] enumerate default = เดือนล่าสุดตามนาฬิกา (พฤติกรรมเดิมเป๊ะ)');
{
  const ctx = makeNrrCtx('2026-08-07T03:00:00Z'); // นาฬิกา ส.ค. → currLabel ส.ค.
  setGlobal(ctx, '__bundle', nrrBundle(0));
  const rows = vm.runInContext(
    'nrrEnumerateUpsellGroups({email:"k@f.co"}, __bundle, QNRR_CFG.base_month, null, new Set())', ctx);
  t('ได้ 1 แถว จากเดือน ส.ค. (totalGmv 50,000)', rows.length === 1 && rows[0].current === 50000,
    JSON.stringify(rows.map(r => r.current)));
  t('เดือนปัจจุบัน projection ทำงานตามเดิม (วันที่ 7 ≥ 5)', rows[0].projectionReady === true && rows[0].projected != null);
}

section('[nrr-2] ★ evalLabel ก.ค. → แถวเป็นของ ก.ค. + ไม่มี "คาดสิ้นเดือน"');
{
  const ctx = makeNrrCtx('2026-08-07T03:00:00Z');
  setGlobal(ctx, '__bundle', nrrBundle(0));
  const rows = vm.runInContext(
    'nrrEnumerateUpsellGroups({email:"k@f.co"}, __bundle, QNRR_CFG.base_month, {evalLabel:"ก.ค. 2569"}, new Set())', ctx);
  t('ได้แถวของ ก.ค. (totalGmv 900,000) ไม่ใช่ ส.ค.', rows.length === 1 && rows[0].current === 900000,
    JSON.stringify(rows.map(r => r.current)));
  t('เดือนจบแล้ว → projected เป็น null (ห้าม project เดือนเก่าด้วยนาฬิกาวันนี้)',
    rows[0].projectionReady === false && rows[0].projected === null,
    'projReady=' + rows[0].projectionReady + ' projected=' + rows[0].projected);
}

section('[nrr-3] gate nrrUpsellBundleCoversPeriod — ห้ามโชว์ P3=0 หลอกๆ');
{
  const ctx = makeNrrCtx('2026-08-07T03:00:00Z');
  setGlobal(ctx, '__b0', nrrBundle(0));
  setGlobal(ctx, '__b1', nrrBundle(123456)); // = ไฟล์ที่ rerun ด้วย SQL split-ทุกเดือนแล้ว
  t('เดือนปัจจุบัน (ส.ค.) → ผ่านเสมอ',
    vm.runInContext('nrrUpsellBundleCoversPeriod(__b0, "ส.ค. 2569")', ctx) === true);
  t('ก.ค. บนไฟล์ปัจจุบัน (existing=0 ทุกแถว) → ไม่ผ่าน',
    vm.runInContext('nrrUpsellBundleCoversPeriod(__b0, "ก.ค. 2569")', ctx) === false);
  t('ก.ค. หลัง rerun SQL (มี existing จริง) → ผ่านเอง ไม่ต้องแก้โค้ด',
    vm.runInContext('nrrUpsellBundleCoversPeriod(__b1, "ก.ค. 2569")', ctx) === true);
  t('bundle โหลดไม่สำเร็จ → ไม่ผ่าน (ไม่เดา)',
    vm.runInContext('nrrUpsellBundleCoversPeriod({loaded:false}, "ก.ค. 2569")', ctx) === false);
}

console.log('\n' + '─'.repeat(66));
console.log('  ผ่าน ' + pass + ' · ตก ' + fail);
console.log('─'.repeat(66));
process.exit(fail ? 1 : 0);
