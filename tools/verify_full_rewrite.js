#!/usr/bin/env node
// tools/verify_full_rewrite.js — v_fullrewrite
//
// ล็อกพฤติกรรม "เขียนทับงวดที่ล็อกแล้วทั้งก้อน" จาก /nrr:
//   (ก) KAM: ทุก component คำนวณสดจากไฟล์ (NRR tier + handover + P1/P3 + expansion
//       + gate) แล้วรวมตามสูตร engine เงินจริง (handover อยู่ใต้ gate)
//   (ข) หลัก "ห้ามตีเป็น ฿0": component ที่ข้อมูลไม่ครอบ = แช่ค่าล็อกเดิม + ธง
//       (handover data_missing → แช่ · P3 ไม่ covered → แช่เฉพาะ P3, P1 สด ·
//        bundle โหลดไม่ได้ → แช่ P1/P3 ทั้งคู่)
//   (ค) TL: ตัวคูณแช่เสมอ (ไฟล์ทีมไม่มีรายเดือน) + ติดธงบอก
//   (ง) apply payload: breakdown เขียน component ใหม่ครบ + revisions
//       kind:'full_rewrite' เก็บ prev_components + top-level ครบ + status คง final
//   (จ) การ์ดเดิมทุกตัวยังคุม (role/สิทธิ์/งวด/โหมด/เดือนสลับ)
//
// เหตุการณ์ต้นเรื่อง (2026-08-07): งวด ก.ค. ล็อกตอนไฟล์ handover ยังไม่มีข้อมูล
// → KAM 13 คนโดนล็อก handover ฿0 ทั้งที่ควรได้ — ฟีเจอร์นี้คือทางคืนเงินก้อนนั้น
//
// Usage: node tools/verify_full_rewrite.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PERIOD = '2026-07';
const EVAL_LABEL = 'ก.ค. 2569';
const KAM = 'kam@test.co';
const TL = 'tl@test.co';

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

// ── mock supabase (ชุดเดียวกับ verify_nrr_recompute) ─────────────────────
function makeSupa(state) {
  return {
    from(table) {
      const q = {
        _table: table, _eq: {}, _upsert: null,
        select() { return q; },
        in() { return q; },
        eq(k, v) { q._eq[k] = v; return q; },
        upsert(payload, opts) { q._upsert = { payload, opts }; return q; },
        then(resolve) {
          let data = [];
          if (q._upsert) {
            state.upserts.push({ table, payload: q._upsert.payload, opts: q._upsert.opts });
            data = q._upsert.payload.map((p, i) => ({ id: p.id || i + 1 }));
          } else if (table === 'nrr_policies') {
            data = state.policyRows.filter(p => !q._eq.period_month || p.period_month === q._eq.period_month);
          } else if (table === 'commission_payout_snapshots') {
            data = state.snapshotRows.filter(r =>
              (!q._eq.period_month || r.period_month === q._eq.period_month) &&
              (!q._eq.snapshot_status || r.snapshot_status === q._eq.snapshot_status));
          }
          resolve({ data: JSON.parse(JSON.stringify(data)), error: null });
        }
      };
      return q;
    }
  };
}

// ── engine fixture — core 2 ร้าน (87% → waive A2 → 105%) + expansion 1 ร้าน ──
function engineRows() {
  const out = [];
  [{ acc: 'A1', outlet: 'O1', mv: 'core_nrr', base: 600000, curr: 630000 },
   { acc: 'A2', outlet: 'O2', mv: 'core_nrr', base: 400000, curr: 240000 },
   { acc: 'A3', outlet: 'O3', mv: 'expansion', base: 0, curr: 20000 }].forEach(o => {
    out.push({
      period_month: PERIOD, movement_type: o.mv, transfer_scope: '',
      current_portfolio: 'KAM', base_portfolio: 'KAM',
      outlet_id: o.outlet, account_id: o.acc, account_name: o.acc, res_name: o.acc,
      account_type: 'SA', cohort_month: o.mv === 'expansion' ? PERIOD : '2025-01',
      curr_gmv: o.curr, base_gmv: o.base, base_days: 30, curr_days: 30,
      latest_staff_owner: 'Kam Test', latest_kam_email: KAM,
      latest_tl_email: TL, base_kam_email: KAM, base_tl_email: TL
    });
  });
  return out;
}

// ── snapshot fixture — ก.ค. ล็อก final โดย handover/upsell เป็นค่าเก่า ──────
const LOCK_ISO = '2026-08-01T00:25:00.000Z';
function snapshotRows() {
  return [
    { id: 11, period_month: PERIOD, beneficiary_role: 'kam', beneficiary_email: KAM,
      team_lead_email: TL, raw_nrr_pct: 87, governed_nrr_pct: 87, payout_amount: 0,
      snapshot_status: 'final', updated_at: LOCK_ISO,
      breakdown: { kam_name: 'Kam Test', computed_at: LOCK_ISO, nrr_pct: 87, nrr_payout: 0,
        upsell_sku: { p1: { gmv: 90000, comm: 900, groups: [] },
                      p3: { gmv_incremental: 8000, comm: 80, groups: [] },
                      total_commission: 980 },
        upsell_outlet: { commission: 500, outlet_gmv: 100000 },
        handover: { payout: 0, accounts: 0, retention_pct: 0, detail: [] } } },
    { id: 12, period_month: PERIOD, beneficiary_role: 'tl', beneficiary_email: TL,
      raw_nrr_pct: 87, governed_nrr_pct: 87, payout_amount: 0,
      snapshot_status: 'final', updated_at: LOCK_ISO,
      breakdown: { team_lead_name: 'TL Test', computed_at: LOCK_ISO,
        upsell_mult: { multiplier: 1.2, team_upsell_pct: 2.5 } } },
    { id: 14, period_month: PERIOD, beneficiary_role: 'pm', beneficiary_email: 'pm@test.co',
      raw_nrr_pct: null, governed_nrr_pct: null, payout_amount: 3000,
      snapshot_status: 'final', updated_at: LOCK_ISO,
      breakdown: { computed_at: LOCK_ISO } }
  ];
}

// ── handover fixture — ก.ค. = โอนจาก SALE เดือน มิ.ย. วัดผล ก.ค. ──────────
// baseline 100,000 (30 วัน) → norm 100,000 · perf 105,000 (31 วัน) → norm 101,612.9
// retention 101.6% → legacy 2-tier fallback (ไม่มี gmv_tiers ใน fixture) → ฿2,500
function handoverRows() {
  return [
    { kam_name: 'Old Sales', account_id: 'HACC', account_name: 'Handover Cafe',
      new_owner_type: 'KAM', new_kam_name: 'Kam Test', prev_owner: 'SALE',
      transfer_month: '2026-06', baseline_gmv: '100000', perf_gmv: '105000',
      perf_days_in_month: '31', baseline_days_in_month: '30', period_month: PERIOD }
  ];
}

// ── upsell bundle fixture — โครงเดียวกับ nrrFetchUpsellBundle จริง ──────────
// P1: กลุ่มใหม่ (ไม่อยู่ใน baselineGroups) ก.ค. totalGmv 50,000 → 1% = ฿500
// P3: กลุ่มเก่า baseline มิ.ย. 10,000 → ก.ค. existing 40,000 (>2×) incr 30,000 → ฿300
function bundleFixture() {
  return {
    loaded: true,
    data: {
      UACC: {
        UO1: {
          NEWGROUP: { [EVAL_LABEL]: { totalGmv: 50000, existingGmv: 0 } },
          OLDGROUP: { 'มิ.ย. 2569': { totalGmv: 10000, existingGmv: 10000 },
                      [EVAL_LABEL]: { totalGmv: 40000, existingGmv: 40000 } }
        }
      }
    },
    baselineGroups: { UACC: { UO1: { OLDGROUP: true } } },
    groupCategory: {}
  };
}
// รุ่น "ไม่ครอบเดือนย้อนหลัง" — ก.ค. existingGmv = 0 ทุกกลุ่ม (ไฟล์เก่า)
function bundleFixtureNoSplit() {
  const b = bundleFixture();
  b.data.UACC.UO1.OLDGROUP[EVAL_LABEL] = { totalGmv: 40000, existingGmv: 0 };
  return b;
}

function makeCtx(state) {
  const waived = new Set();
  const ctx = {
    window: {}, console: { log() {}, info() {}, warn() {}, error() {} },
    document: { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] },
    setTimeout, clearTimeout, JSON, Math, Object, Array, String, Number, Boolean,
    isNaN, parseFloat, parseInt, Set, Map, Promise, RegExp, Error, Date,
    fetch: () => Promise.reject(new Error('no fetch in harness')),
    QNRR_CFG: { quarter: '2026q3', base_month: '2026-06',
                q_months: ['2026-07', '2026-08', '2026-09'], months_th: {}, csv_file: 'kam_rep_view.csv' },
    bulkQnrrData: (() => {
      const all = engineRows();
      return { byKamEmail: { [KAM]: all }, byTlEmail: { [TL]: all }, allRows: all, loaded: true };
    })(),
    nrrRoleRoster: { nonKamSet: new Set(), adSet: new Set() },
    nrrAccountWaivedForPeriod: (acc, m) => waived.has(acc + '|' + m),
    nrrProfile: { email: 'admin@test.co', role: 'admin', name: 'Admin' },
    supa: makeSupa(state),
    __waived: waived
  };
  ctx.window.QNRR_CFG = ctx.QNRR_CFG;
  ctx.window.bulkQnrrData = ctx.bulkQnrrData;
  ctx.window.nrrRoleRoster = ctx.nrrRoleRoster;
  ctx.window.nrrAccountWaivedForPeriod = ctx.nrrAccountWaivedForPeriod;
  vm.createContext(ctx);
  ['src/nrr/nrr_data.js', 'src/nrr/nrr_logic.js', 'src/nrr/nrr_aggregate.js', 'src/nrr/nrr_commission.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  // nrr_data.js ประกาศ var ทับ fixture ตอนโหลด — ต้อง inject ซ้ำหลังโหลดทุกไฟล์
  // (บทเรียนเดียวกับ verify_commission_workbook)
  setGlobal(ctx, 'bulkQnrrData', ctx.bulkQnrrData);
  setGlobal(ctx, 'nrrRoleRoster', ctx.nrrRoleRoster);
  setGlobal(ctx, 'nrrAccountWaivedForPeriod', ctx.nrrAccountWaivedForPeriod);
  vm.runInContext('nrrCommPlansCache = { tiersByPlan: {}, assignments: {}, loaded: true };' +
                  'nrrCommRatesCache = { byKey: {}, loaded: true };', ctx);
  setGlobal(ctx, 'nrrFetchExclusions', async () => vm.runInContext('nrrExclusionsCache', ctx));
  setGlobal(ctx, 'nrrExclusionsCache', []);
  // handover CSV cache ยิงตรง (fetch ถูก stub) — โครงเดียวกับของจริงหลัง parse
  vm.runInContext('nrrHandoverCsvCache = ' + JSON.stringify({ rows: handoverRows(), loaded: true }) + ';', ctx);
  // bundle fetch — override เป็น fixture ต่ออีเมล (preview เรียกผ่าน window scope)
  ctx.__bundle = bundleFixture();
  setGlobal(ctx, 'nrrFetchUpsellBundle', async () => ctx.__bundle);
  return ctx;
}

(async () => {
  const state = { policyRows: [{ period_month: PERIOD, scope_type: 'all', scope_key: 'all', commission_mode: 'quarterly' }],
                  snapshotRows: snapshotRows(), upserts: [] };
  const ctx = makeCtx(state);

  // waive A2 ให้ %NRR ขยับ 87 → 105 (ทุกแถวเข้าเงื่อนไข "เปลี่ยน")
  ctx.__waived.add('A2|' + PERIOD);

  // ── (ก) KAM: ทุก component สด ────────────────────────────────────────────
  section('(ก) KAM full rewrite — ทุก component สดจากไฟล์');
  const pre = await vm.runInContext('nrrRecomputeFullPreview("' + PERIOD + '")', ctx);
  t('preview ok + evalLabel = ' + EVAL_LABEL, pre && pre.ok && pre.evalLabel === EVAL_LABEL, JSON.stringify(pre && pre.reason));
  const kamC = pre.changes.find(c => c.email === KAM);
  t('KAM อยู่ในรายการเปลี่ยน', !!kamC, JSON.stringify((pre.skipped || [])));
  t('%NRR สด 105', kamC && Math.abs(kamC.newPct - 105) < 1e-9, kamC && ('pct=' + kamC.newPct));
  t('NRR tier ฿10,000 (105% บันได default)', kamC && kamC.nrrPayout === 10000, kamC && ('tier=' + kamC.nrrPayout));
  t('handover สด ฿2,500 (ret 101.6% → tier2)', kamC && kamC.comps.handover && kamC.comps.handover.payout === 2500,
    kamC && JSON.stringify(kamC.comps.handover));
  t('handover detail 1 บัญชี retention 101.6', kamC && kamC.comps.handover.accounts === 1 &&
    Math.abs(kamC.comps.handover.retention_pct - 101.6) < 0.05, kamC && JSON.stringify(kamC.comps.handover));
  const sku = kamC && kamC.comps.upsell_sku;
  t('P1 สด ฿500 (50,000 × 1%)', sku && Math.round(sku.p1.comm) === 500, sku && JSON.stringify(sku.p1));
  t('P3 สด ฿300 (incr 30,000 × 1%)', sku && Math.round(sku.p3.comm) === 300, sku && JSON.stringify(sku.p3));
  t('expansion สด ฿100 (20,000 × 0.5%)', kamC && kamC.comps.upsell_outlet && kamC.comps.upsell_outlet.commission === 100,
    kamC && JSON.stringify(kamC.comps.upsell_outlet));
  // 10,000 + 800 (sku) + 100 (outlet) + 2,500 (ho) = 13,400 × gate 1.0
  t('รวม ฿13,400 (handover อยู่ใต้ gate)', kamC && kamC.newPayout === 13400, kamC && ('payout=' + kamC.newPayout));
  t('ไม่มี component ถูกแช่ (frozenList ว่าง)', kamC && kamC.frozenList.length === 0, kamC && JSON.stringify(kamC.frozenList));
  t('prev_components เก็บค่าเดิม (ho 0 / sku 980 / outlet 500)',
    kamC && kamC.prev.handover === 0 && kamC.prev.upsell_sku === 980 && kamC.prev.upsell_outlet === 500,
    kamC && JSON.stringify(kamC.prev));

  // ── (ค) TL: ตัวคูณแช่ + ธง ───────────────────────────────────────────────
  section('(ค) TL — ตัวคูณแช่เสมอ');
  const tlC = pre.changes.find(c => c.email === TL);
  t('TL 105% → ฿50,000 × 1.2 = ฿60,000', tlC && tlC.newPayout === 60000, tlC && ('payout=' + tlC.newPayout));
  t('frozenList = [upsell_mult] + ธงอธิบาย', tlC && JSON.stringify(tlC.frozenList) === '["upsell_mult"]' &&
    tlC.flags.length === 1 && /ตัวคูณ TL แช่/.test(tlC.flags[0]), tlC && JSON.stringify(tlC.flags));
  t('pm ถูก skip ไปทำที่ Sense', pre.skipped.some(s => s.role === 'pm' && /Sense Cockpit/.test(s.reason)),
    JSON.stringify(pre.skipped));

  // ── (ข) หลักห้ามตีเป็น ฿0 — แช่ + ธง ─────────────────────────────────────
  section('(ข) component ที่ข้อมูลไม่ครอบ = แช่ + ธง (ห้ามตีเป็น ฿0)');
  // handover: ไฟล์ไม่มีเดือนนี้เลย → data_missing → แช่ค่าเดิม (0 ตาม fixture ล็อก)
  vm.runInContext('nrrHandoverCsvCache = { rows: [], loaded: true };', ctx);
  const preNoHo = await vm.runInContext('nrrRecomputeFullPreview("' + PERIOD + '")', ctx);
  const kamNoHo = preNoHo.changes.find(c => c.email === KAM);
  t('handover data_missing → แช่ + frozenList มี handover',
    kamNoHo && kamNoHo.frozenList.indexOf('handover') !== -1 && kamNoHo.flags.some(f => /handover แช่/.test(f)),
    kamNoHo && JSON.stringify({ fl: kamNoHo.frozenList, flags: kamNoHo.flags }));
  t('ยอดรวมไม่มี handover ใหม่ (10,000+800+100 = ฿10,900)', kamNoHo && kamNoHo.newPayout === 10900,
    kamNoHo && ('payout=' + kamNoHo.newPayout));
  vm.runInContext('nrrHandoverCsvCache = ' + JSON.stringify({ rows: handoverRows(), loaded: true }) + ';', ctx);

  // P3 ไม่ covered (ไฟล์เก่า existingGmv=0) → P3 แช่จาก snapshot (฿80), P1 สด
  ctx.__bundle = bundleFixtureNoSplit();
  const preNoP3 = await vm.runInContext('nrrRecomputeFullPreview("' + PERIOD + '")', ctx);
  const kamNoP3 = preNoP3.changes.find(c => c.email === KAM);
  t('P3 ไม่ covered → แช่ P3 เดิม ฿80 + P1 สด ฿500',
    kamNoP3 && kamNoP3.frozenList.indexOf('upsell_sku_p3') !== -1 &&
    Math.round(kamNoP3.comps.upsell_sku.p1.comm) === 500 && Number(kamNoP3.comps.upsell_sku.p3.comm) === 80,
    kamNoP3 && JSON.stringify(kamNoP3.comps.upsell_sku));
  // 10,000 + (500+80) + 100 + 2,500 = 13,180
  t('ยอดรวม ฿13,180 (P1 สด + P3 แช่)', kamNoP3 && kamNoP3.newPayout === 13180, kamNoP3 && ('payout=' + kamNoP3.newPayout));

  // bundle โหลดไม่ได้ → แช่ P1/P3 ทั้งคู่ (฿980 เดิม)
  ctx.__bundle = null;
  const preNoBundle = await vm.runInContext('nrrRecomputeFullPreview("' + PERIOD + '")', ctx);
  const kamNoBundle = preNoBundle.changes.find(c => c.email === KAM);
  t('bundle โหลดไม่ได้ → แช่ P1/P3 ทั้งคู่ ฿980', kamNoBundle && kamNoBundle.frozenList.indexOf('upsell_sku') !== -1 &&
    kamNoBundle.newPayout === 10000 + 980 + 100 + 2500, kamNoBundle && ('payout=' + kamNoBundle.newPayout));
  ctx.__bundle = bundleFixture();

  // ── (ง) apply payload ────────────────────────────────────────────────────
  section('(ง) apply payload — เขียน component ใหม่ครบ + revision เก็บของเดิม');
  const applied = await vm.runInContext('nrrRecomputeFullApply("' + PERIOD + '", ' +
    JSON.stringify(pre.changes) + ', "harness full rewrite")', ctx);
  t('apply สำเร็จ ' + pre.changes.length + ' แถว', applied && applied.ok === true && applied.count === pre.changes.length,
    JSON.stringify(applied));
  const up = state.upserts[state.upserts.length - 1];
  t('upsert onConflict = period_month,beneficiary_role,beneficiary_email',
    up && up.opts && up.opts.onConflict === 'period_month,beneficiary_role,beneficiary_email', up && JSON.stringify(up.opts));
  const pk = up.payload.find(p => p.beneficiary_email === KAM);
  const pt = up.payload.find(p => p.beneficiary_email === TL);
  const bdFields = ['revisions', 'nrr_pct', 'nrr_payout', 'handover', 'upsell_sku', 'upsell_outlet',
                    'components_subtotal', 'gmv_gate', 'final_payout', 'frozen_components', 'rewrite_flags', 'recomputed_at'];
  t('breakdown มี field ครบ: ' + bdFields.join(','),
    pk && bdFields.every(f => pk.breakdown[f] !== undefined),
    pk && bdFields.filter(f => pk.breakdown[f] === undefined).join(',') + ' missing');
  const topFields = ['raw_nrr_pct', 'governed_nrr_pct', 'payout_amount', 'snapshot_status', 'updated_at', 'updated_by'];
  t('top-level มี field ครบ + status คง final + payout = พรีวิว',
    pk && topFields.every(f => pk[f] !== undefined) && pk.snapshot_status === 'final' && pk.payout_amount === 13400,
    pk && (pk.snapshot_status + '/' + pk.payout_amount));
  t('component ใหม่ถูกเขียนจริง (ho 2500 / p1 500 / p3 300 / outlet 100)',
    pk && pk.breakdown.handover.payout === 2500 && Math.round(pk.breakdown.upsell_sku.p1.comm) === 500 &&
    Math.round(pk.breakdown.upsell_sku.p3.comm) === 300 && pk.breakdown.upsell_outlet.commission === 100,
    pk && JSON.stringify({ h: pk.breakdown.handover.payout, s: pk.breakdown.upsell_sku, o: pk.breakdown.upsell_outlet.commission }));
  const rev = pk && pk.breakdown.revisions[pk.breakdown.revisions.length - 1];
  t('revision kind full_rewrite + prev_components ครบ',
    rev && rev.kind === 'full_rewrite' && rev.reason === 'harness full rewrite' && rev.by === 'admin@test.co' &&
    rev.prev_components && rev.prev_components.handover === 0 && rev.prev_components.upsell_sku === 980 &&
    rev.prev_components.upsell_outlet === 500,
    JSON.stringify(rev));
  t('TL: upsell_mult ไม่ถูกแตะ (1.2) + frozen_components = [upsell_mult]',
    pt && pt.breakdown.upsell_mult.multiplier === 1.2 &&
    JSON.stringify(pt.breakdown.frozen_components) === '["upsell_mult"]' && pt.payout_amount === 60000,
    pt && JSON.stringify({ m: pt.breakdown.upsell_mult, f: pt.breakdown.frozen_components }));
  t('cache ถูกล้างหลังเขียน', vm.runInContext('nrrCommSnapshots === null && !nrrCommPeriodCache["' + PERIOD + '"]', ctx));

  // ── (จ) การ์ด ────────────────────────────────────────────────────────────
  section('(จ) การ์ดงวด/โหมด/สิทธิ์');
  const outQ = await vm.runInContext('nrrRecomputeFullPreview("2026-10")', ctx);
  t('งวดนอกไตรมาส → period_outside_quarter', outQ && outQ.ok === false && outQ.reason === 'period_outside_quarter', JSON.stringify(outQ));
  state.policyRows[0].commission_mode = 'monthly';
  vm.runInContext('nrrCommPolicyCache = {}', ctx);
  const monthly = await vm.runInContext('nrrRecomputeFullPreview("' + PERIOD + '")', ctx);
  t('โหมด monthly → not_quarterly_mode', monthly && monthly.ok === false && monthly.reason === 'not_quarterly_mode', JSON.stringify(monthly));
  state.policyRows[0].commission_mode = 'quarterly';
  vm.runInContext('nrrCommPolicyCache = {}', ctx);
  setGlobal(ctx, 'nrrProfile', { email: 'kam@test.co', role: 'kam' });
  const denied = await vm.runInContext('nrrRecomputeFullApply("' + PERIOD + '", ' + JSON.stringify(pre.changes) + ', "x")', ctx);
  t('role kam กด apply → not_authorized', denied && denied.ok === false && denied.error === 'not_authorized', JSON.stringify(denied));
  setGlobal(ctx, 'nrrProfile', { email: 'admin@test.co', role: 'admin' });
  const empty = await vm.runInContext('nrrRecomputeFullApply("' + PERIOD + '", [], "x")', ctx);
  t('changes ว่าง → no_changes', empty && empty.ok === false && empty.error === 'no_changes', JSON.stringify(empty));

  console.log('\n' + (fail ? '❌' : '✅') + ' verify_full_rewrite: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS CRASH:', e); process.exit(1); });
