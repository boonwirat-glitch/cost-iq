#!/usr/bin/env node
/**
 * verify_recompute_nrr_only.js — v_clock Phase 3
 *
 * พิสูจน์ข้ออ้างหลักของฟีเจอร์นี้: **คำนวณใหม่หลังอนุมัติ waiver ต้องไม่พึ่งไฟล์
 * upsell บน R2 เลย** เพราะไฟล์นั้นถูกทับทุกครั้งที่ทีม data รัน (ยึด "เดือน")
 * ขณะที่ไฟล์ %NRR ยึด "ไตรมาส" จึงอยู่ยาวถึงสิ้น Q3
 *
 * ถ้าข้ออ้างนี้ผิด = Bucci กด "คำนวณใหม่" ในเดือน ก.ย. แล้วได้ P1/P3 ของเดือน ก.ย.
 * มาประทับใต้ชื่อเดือน ก.ค. โดยไม่มีอะไรเตือน = จ่ายเงินผิด
 *
 * รัน: node tools/verify_recompute_nrr_only.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FROZEN_NOW = new Date('2026-08-05T03:00:00.000Z').getTime();

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

function makeCtx() {
  class FrozenDate extends Date {
    constructor(...a) { if (!a.length) super(FROZEN_NOW); else super(...a); }
    static now() { return FROZEN_NOW; }
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
    parseFloat, parseInt, Set, Map, Promise, RegExp, Error
  };
  vm.createContext(ctx);
  ['src/07a_commission_engine.js', 'src/07b_commission_cockpit.js',
   'src/07b_nrr_target.js', 'src/07b_cds.js', 'src/07c_qnrr_view.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  return ctx;
}

const PERIOD = '2026-07';
const KAM = { email: 'kam.a@f.co', name: 'Alpha (Al) One' };
const TL = { email: 'tl.x@f.co', name: 'Xray (Ray) Lead' };

function qnrrRow(o) {
  return Object.assign({
    period_month: PERIOD, account_id: 'A1', outlet_id: 'O1', res_name: 'ร้าน',
    account_name: 'บริษัท', movement_type: 'core_nrr', base_gmv: 0, curr_gmv: 0,
    latest_kam_email: KAM.email, latest_tl_email: TL.email, account_type: 'Chain',
    curr_days: 31, days_in_month: 31
  }, o);
}

function seed(ctx, opts) {
  opts = opts || {};
  const rows = [
    qnrrRow({ account_id: 'A1', outlet_id: 'O1', base_gmv: 600000, curr_gmv: 560000 }),
    // ร้านนี้คือร้านที่จะถูก waive — ฐานใหญ่ แต่ยอดตก ดึง %NRR ลง
    qnrrRow({ account_id: 'A2', outlet_id: 'O2', base_gmv: 400000, curr_gmv: 240000 })
  ];
  const byKamEmail = {}, byTlEmail = {};
  rows.forEach(r => {
    (byKamEmail[r.latest_kam_email] = byKamEmail[r.latest_kam_email] || []).push(r);
    (byTlEmail[r.latest_tl_email] = byTlEmail[r.latest_tl_email] || []).push(r);
  });
  setGlobal(ctx, 'bulkQnrrData', { loaded: true, allRows: rows, byKamEmail, byTlEmail });
  setGlobal(ctx, 'portviewBulkData', [{ accountId: 'ACC1', kamEmail: KAM.email,
    kamName: KAM.name, tlEmail: TL.email, tlName: TL.name, gmv: 100000 }]);

  // ── หัวใจของเทสต์: ให้ปิดไฟล์ upsell ได้ ──
  if (opts.killUpsell) {
    setGlobal(ctx, 'bulkUpsellData', undefined);
    setGlobal(ctx, 'bulkUpsellTeamData', undefined);
    setGlobal(ctx, 'bulkUpsellTeamGroups', undefined);
  } else {
    setGlobal(ctx, 'bulkUpsellData', { loaded: true, byKam: {}, baselineGroups: {} });
  }
  setGlobal(ctx, 'bulkHandoverData', { byNewKamName: {} });
  setGlobal(ctx, 'bulkHistoryData', {});
  setGlobal(ctx, 'bulkOutletsData', { byAccountId: {} });
  setGlobal(ctx, '_nrrExclusions', opts.exclusions || []);
  setGlobal(ctx, '_nrrGovPolicies', {
    '2026-07|all|all': { period_month: PERIOD, scope_type: 'all', scope_key: 'all',
      commission_mode: 'quarterly', base_mode: 'fixed', base_month: '2026-06',
      quarter_id: '2026q3', status: 'locked' }
  });
  ctx.window._nrrGovPoliciesLoaded = true;
  setGlobal(ctx, '_commRuleConfig', {
    plans: {
      KAM_NRR_STD: { id: 'r-kam', plan_code: 'KAM_NRR_STD', beneficiary_role: 'kam', status: 'active' },
      TL_NRR_STD: { id: 'r-tl', plan_code: 'TL_NRR_STD', beneficiary_role: 'tl', status: 'active' }
    },
    rules: {
      'r-kam': { id: 'r-kam', payout_type: 'flat_amount', measurement_scope: 'governed_nrr' },
      'r-tl': { id: 'r-tl', payout_type: 'flat_amount', measurement_scope: 'governed_nrr' }
    },
    tiers: {
      'r-kam': [{ min_value: 120, max_value: null, payout_value: 10000, payout_label: 'บน' },
                { min_value: 90, max_value: 120, payout_value: 4000, payout_label: 'ล่าง' }],
      'r-tl': [{ min_value: 120, max_value: null, payout_value: 20000, payout_label: 'TL บน' },
               { min_value: 90, max_value: 120, payout_value: 8000, payout_label: 'TL ล่าง' }]
    },
    assignments: []
  });
  setGlobal(ctx, '_tgtSettings', { nrr_threshold: 98,
    gmv_gate_params: { threshold_1: 130, threshold_2: 100, cap_1: 0.5, cap_2: 0 } });
  setGlobal(ctx, 'currentUserProfile', { email: 'admin@f.co', role: 'admin', full_name: 'Admin' });
}

// แถว snapshot ที่ "lock ไว้แล้ว" พร้อม component ที่แช่แข็ง
function lockedKamRow(payout) {
  return {
    period_month: PERIOD, beneficiary_role: 'kam', beneficiary_email: KAM.email,
    snapshot_status: 'final', payout_amount: payout,
    raw_nrr_pct: 80, governed_nrr_pct: 80,
    breakdown: {
      kam_name: KAM.name, nrr_pct: 80, nrr_payout: 0,
      upsell_sku: { total_commission: 7000, p1: { gmv: 400000, comm: 4000 },
                    p3: { gmv_incremental: 300000, comm: 3000 } },
      upsell_outlet: { commission: 1200, outlet_gmv: 80000 },
      handover: { payout: 2500, retention_pct: 95, accounts: 1 },
      gmv_gate: { cap_multiplier: 1, gate_active: false },
      components_subtotal: 10700, final_payout: payout
    }
  };
}
function lockedTlRow(payout) {
  return {
    period_month: PERIOD, beneficiary_role: 'tl', beneficiary_email: TL.email,
    snapshot_status: 'final', payout_amount: payout,
    raw_nrr_pct: 80, governed_nrr_pct: 80,
    breakdown: { team_lead_name: TL.name, nrr_pct: 80, nrr_payout: 0,
                 upsell_mult: { multiplier: 1.5, tier: 2 }, final_payout: payout }
  };
}

// ═════════════════════════════════════════════════════════════════════════
section('[1] component ที่แช่แข็งต้องถูกอ่านออกมาถูกต้อง');
{
  const ctx = makeCtx(); seed(ctx);
  ctx.__row = lockedKamRow(10700);
  const f = vm.runInContext('_commFrozenComponents(__row)', ctx);
  t('upsell_sku อ่านจาก total_commission (ไม่ใช่ total_comm)', f.upsellSku === 7000, JSON.stringify(f));
  t('upsell_outlet.commission', f.upsellOutlet === 1200);
  t('handover.payout', f.handover === 2500);
  ctx.__row2 = lockedTlRow(0);
  const f2 = vm.runInContext('_commFrozenComponents(__row2)', ctx);
  t('TL multiplier จาก object', f2.multiplier === 1.5);
  ctx.__row3 = { breakdown: { upsell_mult: '1.75x' } };
  const f3 = vm.runInContext('_commFrozenComponents(__row3)', ctx);
  t('TL multiplier จาก string "1.75x" (Excel backfill) ก็ต้องอ่านได้', f3.multiplier === 1.75, JSON.stringify(f3));
}

// ═════════════════════════════════════════════════════════════════════════
section('[2] waive แล้ว %NRR ขยับ — แต่ upsell/handover ต้องเท่าเดิมเป๊ะ');
let noWaive, withWaive;
{
  const ctx = makeCtx(); seed(ctx);
  ctx.__row = lockedKamRow(10700); ctx.__p = PERIOD;
  noWaive = vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctx);
  t('คำนวณได้ (ไม่ถูกข้าม)', !!(noWaive && !noWaive.skip), JSON.stringify(noWaive && noWaive.skip));
}
{
  // waive ร้าน A2 ที่ยอดตก → %NRR ต้องดีขึ้น
  const ctx = makeCtx();
  seed(ctx, { exclusions: [{ period_month: PERIOD, account_id: 'A2', outlet_id: null,
    target_kam_email: KAM.email, status: 'approved', base_gmv: 400000,
    decided_at: '2026-08-04T00:00:00Z' }] });
  ctx.__row = lockedKamRow(10700); ctx.__p = PERIOD;
  withWaive = vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctx);
  t('คำนวณได้หลัง waive', !!(withWaive && !withWaive.skip), JSON.stringify(withWaive && withWaive.skip));
}
if (noWaive && withWaive && !noWaive.skip && !withWaive.skip) {
  t('%NRR เปลี่ยนจริงหลัง waive', withWaive.newPct !== noWaive.newPct,
    'ก่อน ' + noWaive.newPct + ' → หลัง ' + withWaive.newPct);
  t('%NRR ดีขึ้น (ตัดร้านที่ยอดตกออก)', withWaive.newPct > noWaive.newPct,
    noWaive.newPct + ' → ' + withWaive.newPct);
  // นี่คือหัวใจ — component ที่แช่แข็งห้ามขยับ
  t('upsell_sku เท่าเดิมเป๊ะ', withWaive.frozen.upsellSku === 7000 && noWaive.frozen.upsellSku === 7000);
  t('upsell_outlet เท่าเดิมเป๊ะ', withWaive.frozen.upsellOutlet === 1200 && noWaive.frozen.upsellOutlet === 1200);
  t('handover เท่าเดิมเป๊ะ', withWaive.frozen.handover === 2500 && noWaive.frozen.handover === 2500);
}

// ═════════════════════════════════════════════════════════════════════════
section('[3] ★ ลบไฟล์ upsell ทิ้งทั้งก้อน — ผลลัพธ์ต้องเท่าเดิมทุกบาท');
{
  const excl = [{ period_month: PERIOD, account_id: 'A2', outlet_id: null,
    target_kam_email: KAM.email, status: 'approved', base_gmv: 400000,
    decided_at: '2026-08-04T00:00:00Z' }];
  const ctxA = makeCtx(); seed(ctxA, { exclusions: excl });
  ctxA.__row = lockedKamRow(10700); ctxA.__p = PERIOD;
  const withFile = vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctxA);

  const ctxB = makeCtx(); seed(ctxB, { exclusions: excl, killUpsell: true });
  ctxB.__row = lockedKamRow(10700); ctxB.__p = PERIOD;
  const noFile = vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctxB);

  t('ยังคำนวณได้แม้ไม่มีไฟล์ upsell เลย', !!(noFile && !noFile.skip), JSON.stringify(noFile && noFile.skip));
  if (withFile && noFile && !withFile.skip && !noFile.skip) {
    t('ยอดจ่ายเท่ากันเป๊ะ', withFile.newPayout === noFile.newPayout,
      'มีไฟล์ ' + withFile.newPayout + ' · ไม่มีไฟล์ ' + noFile.newPayout);
    t('%NRR เท่ากันเป๊ะ', withFile.newPct === noFile.newPct);
    t('upsell ที่ใช้เท่ากันเป๊ะ (มาจาก breakdown ไม่ใช่ R2)',
      withFile.frozen.upsellSku === noFile.frozen.upsellSku &&
      withFile.frozen.upsellOutlet === noFile.frozen.upsellOutlet);
    t('subtotal เท่ากันเป๊ะ', withFile.subtotal === noFile.subtotal);
  }
}

// ═════════════════════════════════════════════════════════════════════════
section('[4] สูตรต้องตรงกับเอนจินจริง');
{
  const ctx = makeCtx(); seed(ctx);
  ctx.__row = lockedKamRow(10700); ctx.__p = PERIOD;
  const r = vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctx);
  if (r && !r.skip) {
    const expectSub = r.nrrPayout + 7000 + 1200 + 2500;
    t('KAM subtotal = nrr + upsell_sku + outlet + handover', r.subtotal === expectSub,
      r.subtotal + ' vs ' + expectSub);
    const cap = r.gate ? r.gate.cap_multiplier : 1;
    t('KAM final = round(subtotal × gateCap)', r.newPayout === Math.round(expectSub * cap),
      r.newPayout + ' vs ' + Math.round(expectSub * cap) + ' (cap ' + cap + ')');
  }
  ctx.__trow = lockedTlRow(0);
  const tr = vm.runInContext('_commRecomputeRowNrrOnly(__trow, __p)', ctx);
  if (tr && !tr.skip) {
    t('TL final = round(nrrPayout × multiplier) ไม่บวก component',
      tr.newPayout === Math.round(tr.nrrPayout * 1.5),
      tr.newPayout + ' vs ' + Math.round(tr.nrrPayout * 1.5));
    t('TL ไม่ใช้ gate', tr.gate === null);
  }
}

// ═════════════════════════════════════════════════════════════════════════
section('[5] ไม่มีข้อมูล → ต้องข้าม ห้ามตัดเป็น 0 (จะเป็นการตัดเงินคน)');
{
  const ctx = makeCtx(); seed(ctx);
  setGlobal(ctx, 'bulkQnrrData', { loaded: true, allRows: [], byKamEmail: {}, byTlEmail: {} });
  ctx.__row = lockedKamRow(10700); ctx.__p = PERIOD;
  const r = vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctx);
  t('ข้อมูล %NRR หายหมด → ข้าม ไม่ใช่ payout 0', !!(r && r.skip), JSON.stringify(r));
  t('ไม่มี newPayout ให้เขียนทับ', !r || r.newPayout === undefined, JSON.stringify(r));

  const ctx2 = makeCtx(); seed(ctx2);
  ctx2.__row = { beneficiary_role: 'kam', breakdown: {} };   // ไม่มี email
  ctx2.__p = PERIOD;
  const r2 = vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctx2);
  t('แถวไม่มี email → ข้าม', !!(r2 && r2.skip), JSON.stringify(r2));
  ctx2.__row = null;
  t('แถว null → null', vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctx2) === null);
}

// ═════════════════════════════════════════════════════════════════════════
section('[6] waiver ที่ไม่ทำให้ข้ามขั้น → ยอดต้องไม่เปลี่ยน');
{
  const ctx = makeCtx(); seed(ctx);
  ctx.__row = lockedKamRow(10700); ctx.__p = PERIOD;
  const before = vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctx);
  // waive ร้านจิ๋วที่ไม่มีอยู่จริงในข้อมูล → %NRR ไม่ขยับ
  setGlobal(ctx, '_nrrExclusions', [{ period_month: PERIOD, account_id: 'ZZZ',
    target_kam_email: KAM.email, status: 'approved', base_gmv: 1,
    decided_at: '2026-08-04T00:00:00Z' }]);
  const after = vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctx);
  if (before && after && !before.skip && !after.skip) {
    t('%NRR ไม่ขยับ', before.newPct === after.newPct);
    t('ยอดจ่ายไม่ขยับ', before.newPayout === after.newPayout,
      before.newPayout + ' → ' + after.newPayout);
  }
}

// ═════════════════════════════════════════════════════════════════════════
section('[7] ตรวจจับ waiver ที่อนุมัติหลัง lock');
{
  // ★ ต้องใช้ชื่อคอลัมน์จริงของตาราง = reviewed_at (ที่ nrr_exclusions.js:182 เขียน
  // ตอน approve) ถ้าโค้ดไปอ่าน decided_at ซึ่งไม่มีอยู่จริง ป้ายเตือนจะไม่เคยขึ้น
  const ctx = makeCtx(); seed(ctx);
  setGlobal(ctx, '_commissionSnapshots', [Object.assign(lockedKamRow(10700),
    { locked_at: '2026-08-01T10:00:00Z' })]);
  setGlobal(ctx, '_nrrExclusions', [
    { period_month: PERIOD, account_id: 'A1', status: 'approved', reviewed_at: '2026-07-30T00:00:00Z' },
    { period_month: PERIOD, account_id: 'A2', status: 'approved', reviewed_at: '2026-08-03T00:00:00Z' },
    { period_month: PERIOD, account_id: 'A3', status: 'submitted', reviewed_at: '2026-08-04T00:00:00Z' },
    { period_month: '2026-06', account_id: 'A4', status: 'approved', reviewed_at: '2026-08-03T00:00:00Z' }
  ]);
  ctx.__p = PERIOD;
  const late = vm.runInContext('_commWaiversDecidedAfterLock(__p)', ctx);
  t('อ่านจาก reviewed_at (คอลัมน์จริง) ไม่ใช่ decided_at',
    late.length === 1 && late[0].account_id === 'A2',
    JSON.stringify(late.map(x => x.account_id)));

  // แถวที่มีแต่ updated_at (ไม่มี reviewed_at) ก็ต้องยังจับได้
  setGlobal(ctx, '_nrrExclusions', [
    { period_month: PERIOD, account_id: 'B1', status: 'approved', updated_at: '2026-08-03T00:00:00Z' }
  ]);
  t('ถอยไปใช้ updated_at ได้ถ้าไม่มี reviewed_at',
    vm.runInContext('_commWaiversDecidedAfterLock(__p)', ctx).length === 1);

  // snapshot ที่ไม่มี locked_at (select หลักไม่ได้ดึงมา) ต้องถอยไปใช้ updated_at
  setGlobal(ctx, '_commissionSnapshots', [Object.assign(lockedKamRow(10700),
    { updated_at: '2026-08-01T10:00:00Z' })]);
  setGlobal(ctx, '_nrrExclusions', [
    { period_month: PERIOD, account_id: 'C1', status: 'approved', reviewed_at: '2026-08-05T00:00:00Z' },
    { period_month: PERIOD, account_id: 'C2', status: 'approved', reviewed_at: '2026-07-01T00:00:00Z' }
  ]);
  const viaUpd = vm.runInContext('_commWaiversDecidedAfterLock(__p)', ctx);
  t('snapshot ไม่มี locked_at → ใช้ updated_at เทียบแทน',
    viaUpd.length === 1 && viaUpd[0].account_id === 'C1',
    JSON.stringify(viaUpd.map(x => x.account_id)));

  setGlobal(ctx, '_commissionSnapshots', []);
  t('ไม่มีแถว lock → ไม่เตือน', vm.runInContext('_commWaiversDecidedAfterLock(__p)', ctx).length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
section('[8] ★ กันเดือนสลับ — ห้ามเอา %NRR เดือนอื่นมาประทับใต้เดือนที่ล็อก');
{
  // _qnrrComputeForCommission แทนเดือนให้เงียบๆ ได้ 2 ทาง (ขึ้น Q4 แล้วขอ ก.ค.
  // หรือ by_month ไม่มีเดือนที่ขอ) ทั้งคู่คืนผลลัพธ์หน้าตาปกติ
  const ctx = makeCtx(); seed(ctx);
  ctx.__row = lockedKamRow(10700); ctx.__p = PERIOD;
  const good = vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctx);
  t('เดือนตรงกัน → คำนวณปกติ', good && !good.skip, JSON.stringify(good && good.skip));

  // จำลองการแทนเดือน: ให้ตัวคำนวณคืน currentPeriod เป็นเดือนอื่น
  vm.runInContext(
    'window.__realQ = window._qnrrComputeForCommission;' +
    'window._qnrrComputeForCommission = function(e,s,p){' +
    '  var r = window.__realQ(e,s,p); if (r) r.currentPeriod = "2026-09"; return r; };', ctx);
  const bad = vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctx);
  t('เดือนไม่ตรง → ต้องข้าม ไม่ใช่คำนวณต่อ', !!(bad && bad.skip),
    'ได้ ' + JSON.stringify(bad && (bad.skip || bad.newPayout)));
  t('บอกเหตุผลว่าเป็นเดือนไหน', !!(bad && bad.skip && /2026-09/.test(bad.skip)),
    bad && bad.skip);

  // ต้องไม่หลุดเข้า changes ของ preview
  vm.runInContext('window.__skipRes = _commRecomputeRowNrrOnly(__row, __p);', ctx);
  t('ผลลัพธ์ที่ข้ามไม่มี newPayout ให้เขียน',
    vm.runInContext('window.__skipRes.newPayout === undefined', ctx));
}

// ═════════════════════════════════════════════════════════════════════════
section('[9] TL ที่ไม่มีตัวคูณเก็บไว้ → ห้ามเดาว่าเป็น 1');
{
  const ctx = makeCtx(); seed(ctx);
  ctx.__p = PERIOD;
  ctx.__ok = lockedTlRow(0);                       // มี upsell_mult 1.5
  t('TL ที่มีตัวคูณ → คำนวณปกติ',
    (() => { const r = vm.runInContext('_commRecomputeRowNrrOnly(__ok, __p)', ctx); return r && !r.skip; })());

  ctx.__bad = { period_month: PERIOD, beneficiary_role: 'tl', beneficiary_email: TL.email,
                snapshot_status: 'final', payout_amount: 9999,
                breakdown: { team_lead_name: TL.name } };   // ไม่มี upsell_mult เลย
  const r2 = vm.runInContext('_commRecomputeRowNrrOnly(__bad, __p)', ctx);
  t('TL ที่ไม่มีตัวคูณ → ข้าม ไม่ใช่คูณ 1', !!(r2 && r2.skip), JSON.stringify(r2));

  // ตัวคูณที่เก็บไว้ว่าเป็น 1.0 จริงๆ ต้องไม่ถูกมองว่า "ไม่มี"
  ctx.__one = { period_month: PERIOD, beneficiary_role: 'tl', beneficiary_email: TL.email,
                snapshot_status: 'final', payout_amount: 0,
                breakdown: { team_lead_name: TL.name, upsell_mult: { multiplier: 1.0, tier: 1 } } };
  const r3 = vm.runInContext('_commRecomputeRowNrrOnly(__one, __p)', ctx);
  t('ตัวคูณ 1.0 ที่เก็บไว้จริง → คำนวณปกติ', !!(r3 && !r3.skip), JSON.stringify(r3 && r3.skip));
}

// ═════════════════════════════════════════════════════════════════════════
section('[10] %NRR เท่าเดิม (ต่างแค่ทศนิยมจาก DB) → ต้องไม่ขึ้นว่า "กระทบ"');
{
  const ctx = makeCtx(); seed(ctx);
  ctx.__row = lockedKamRow(10700); ctx.__p = PERIOD;
  const r = vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctx);
  // ตั้ง oldPct ให้เท่ากับ newPct แบบปัด 2 ตำแหน่ง (เลียนแบบ numeric ใน DB)
  const rounded = Math.round(r.newPct * 100) / 100;
  ctx.__row2 = Object.assign({}, lockedKamRow(r.newPayout),
    { governed_nrr_pct: rounded, raw_nrr_pct: rounded });
  vm.runInContext(
    'window.__pctMoved = (function(){' +
    ' var res = _commRecomputeRowNrrOnly(__row2, __p);' +
    ' return {diff: res.diff, moved: Math.abs(res.newPct - res.oldPct) > 0.005};' +
    '})();', ctx);
  const out = vm.runInContext('window.__pctMoved', ctx);
  t('ยอดไม่ขยับ', out.diff === 0, JSON.stringify(out));
  t('%NRR ที่ต่างแค่ทศนิยมไม่นับว่าขยับ', out.moved === false, JSON.stringify(out));
}

// ═════════════════════════════════════════════════════════════════════════
section('[11] โหมดรายเดือน → ต้องข้าม ไม่ใช่ไปอ่านฐานไตรมาสมาแทน');
{
  const ctx = makeCtx(); seed(ctx);
  setGlobal(ctx, '_nrrGovPolicies', {
    '2026-07|all|all': { period_month: PERIOD, scope_type: 'all', scope_key: 'all',
      commission_mode: 'monthly', base_mode: 'prev_month', status: 'locked' }
  });
  ctx.__row = lockedKamRow(10700); ctx.__p = PERIOD;
  const r = vm.runInContext('_commRecomputeRowNrrOnly(__row, __p)', ctx);
  t('โหมดรายเดือน → ข้าม', !!(r && r.skip), JSON.stringify(r));
  t('บอกเหตุผลว่าเป็นโหมดรายเดือน', !!(r && r.skip && /รายเดือน/.test(r.skip)), r && r.skip);
  t('ไม่มี newPayout ให้เขียนทับ', !r.newPayout, JSON.stringify(r.newPayout));
}

console.log('\n' + '─'.repeat(62));
console.log(pass + ' pass · ' + fail + ' fail');
process.exit(fail ? 1 : 0);
