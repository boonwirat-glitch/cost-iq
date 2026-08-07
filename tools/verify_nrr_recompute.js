#!/usr/bin/env node
// tools/verify_nrr_recompute.js — v_waiverecompute (backlog ข้อ 2)
//
// ล็อกพฤติกรรมของ "คำนวณใหม่หลัง waive-after-lock จาก /nrr" ทั้ง 4 ข้อในแผน:
//   (ก) %NRR ใหม่ + payout ใหม่ตรงตามบันได (99.5%→฿0, 101%→฿5,000, 104%→฿10,000)
//       + gate ตัดที่ค่าปัด 1 ตำแหน่ง (97.96 → 98.0 → ไม่โดน cap) เหมือน Sense v_round
//   (ข) กันเดือนสลับ: /nrr อ่าน by_month[period] ตรงๆ — เดือนไม่มี = skip ไม่ใช่แทนเดือน
//   (ค) write payload มี field ครบตาม shape ของ Sense recomputeNrrOnlyApply
//       (source-lock รายชื่อ field กับ src/07a_commission_engine.js จริง)
//   (ง) upsell/handover/multiplier ใน payload = ค่าเดิมเป๊ะ (แช่แข็งจริง)
// แถม: detection nrrDetectStaleLockedPeriods (ป้ายขึ้น/หายถูกจังหวะ) + การ์ด role/สิทธิ์
//
// Usage: node tools/verify_nrr_recompute.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PERIOD = '2026-07';
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

// ── mock supabase — thenable query builder ──────────────────────────────
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

// ── engine fixture — base_days 30 + curr_days เต็มเดือน → pct = curr/base ตรงๆ ──
// A1 630,000/600,000 · A2 240,000/400,000 → รวม 87.0% · waive A2 → 105.0%
function engineRows() {
  const out = [];
  [{ acc: 'A1', outlet: 'O1', base: 600000, curr: 630000 },
   { acc: 'A2', outlet: 'O2', base: 400000, curr: 240000 }].forEach(o => {
    out.push({
      period_month: PERIOD, movement_type: 'core_nrr', transfer_scope: '',
      current_portfolio: 'KAM', base_portfolio: 'KAM',
      outlet_id: o.outlet, account_id: o.acc, account_name: o.acc, res_name: o.acc,
      account_type: 'SA', cohort_month: '2025-01',
      curr_gmv: o.curr, base_gmv: o.base, base_days: 30, curr_days: 30,
      latest_staff_owner: 'K', latest_kam_email: KAM,
      latest_tl_email: TL, base_kam_email: KAM, base_tl_email: TL
    });
  });
  return out;
}

// ── snapshot fixture — งวด ก.ค. ล็อกแล้ว (final) ─────────────────────────
const LOCK_ISO = '2026-08-01T00:25:00.000Z';
function snapshotRows() {
  return [
    { id: 11, period_month: PERIOD, beneficiary_role: 'kam', beneficiary_email: KAM,
      team_lead_email: TL, raw_nrr_pct: 87, governed_nrr_pct: 87, payout_amount: 0,
      snapshot_status: 'final', updated_at: LOCK_ISO,
      breakdown: { kam_name: 'Kam Test', computed_at: LOCK_ISO, nrr_pct: 87, nrr_payout: 0,
        upsell_sku: { total_commission: 2000 }, upsell_outlet: { commission: 500 },
        handover: { payout: 1000, data_missing: false } } },
    { id: 12, period_month: PERIOD, beneficiary_role: 'tl', beneficiary_email: TL,
      raw_nrr_pct: 87, governed_nrr_pct: 87, payout_amount: 0,
      snapshot_status: 'final', updated_at: LOCK_ISO,
      breakdown: { team_lead_name: 'TL Test', computed_at: LOCK_ISO,
        upsell_mult: { multiplier: 1.2, team_upsell_pct: 2.5 } } },
    { id: 13, period_month: PERIOD, beneficiary_role: 'tl', beneficiary_email: 'tl2@test.co',
      raw_nrr_pct: 87, governed_nrr_pct: 87, payout_amount: 0,
      snapshot_status: 'final', updated_at: LOCK_ISO,
      breakdown: { team_lead_name: 'No Mult', computed_at: LOCK_ISO } },
    { id: 14, period_month: PERIOD, beneficiary_role: 'pm', beneficiary_email: 'pm@test.co',
      raw_nrr_pct: null, governed_nrr_pct: null, payout_amount: 3000,
      snapshot_status: 'final', updated_at: LOCK_ISO,
      breakdown: { computed_at: LOCK_ISO } }
  ];
}

function makeCtx(state) {
  const waived = new Set();
  const ctx = {
    window: {}, console: { log() {}, info() {}, warn() {}, error() {} },
    document: { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] },
    setTimeout, clearTimeout, JSON, Math, Object, Array, String, Number, Boolean,
    isNaN, parseFloat, parseInt, Set, Map, Promise, RegExp, Error, Date,
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
  // nrr_logic/aggregate อ่านผ่าน window.* ด้วย — mirror ให้ครบเหมือน verify_base_movements
  ctx.window.QNRR_CFG = ctx.QNRR_CFG;
  ctx.window.bulkQnrrData = ctx.bulkQnrrData;
  ctx.window.nrrRoleRoster = ctx.nrrRoleRoster;
  ctx.window.nrrAccountWaivedForPeriod = ctx.nrrAccountWaivedForPeriod;
  vm.createContext(ctx);
  ['src/nrr/nrr_logic.js', 'src/nrr/nrr_aggregate.js', 'src/nrr/nrr_commission.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  // fetch caches — ยิงตรงเป็น loaded ว่างๆ → tier/gate ใช้ default ladder (ล็อกไปด้วยในตัว)
  vm.runInContext('nrrCommPlansCache = { tiersByPlan: {}, assignments: {}, loaded: true };' +
                  'nrrCommRatesCache = { byKey: {}, loaded: true };', ctx);
  setGlobal(ctx, 'nrrFetchExclusions', async () => vm.runInContext('nrrExclusionsCache', ctx));
  setGlobal(ctx, 'nrrExclusionsCache', []);
  return ctx;
}

(async () => {
  const state = { policyRows: [{ period_month: PERIOD, scope_type: 'all', scope_key: 'all', commission_mode: 'quarterly' }],
                  snapshotRows: snapshotRows(), upserts: [] };
  const ctx = makeCtx(state);
  const rowOf = role => state.snapshotRows.find(r => r.beneficiary_role === role);

  // ── (ก) บันได payout + gate — stub engine result ให้คุม pct ตรงๆ ─────────
  section('(ก) บันได payout + gate (stub %NRR)');
  const realKam = vm.runInContext('nrrKamResult', ctx);
  const realTl = vm.runInContext('nrrTeamResult', ctx);
  const stubPct = pct => () => ({ by_month: { [PERIOD]: { nrr_curr_norm: pct, effective_base_norm: 100, nrr_pct: Math.round(pct * 10) / 10 } } });
  const kamRow = JSON.parse(JSON.stringify(rowOf('kam')));
  const FROZEN_SUM = 2000 + 500 + 1000; // upsell_sku + upsell_outlet + handover

  const ladder = [
    { pct: 99.5, tier: 0,     cap: 1,   note: '99.5% → tier ฿0, ไม่โดน gate' },
    { pct: 101,  tier: 5000,  cap: 1,   note: '101% → tier ฿5,000' },
    { pct: 104,  tier: 10000, cap: 1,   note: '104% → tier ฿10,000' },
    { pct: 97.5, tier: 0,     cap: 0.3, note: '97.5% → gate cap 0.3' },
    { pct: 94,   tier: 0,     cap: 0,   note: '94% → gate cap 0' },
    { pct: 97.96, tier: 0,    cap: 1,   note: '97.96% → ปัดเป็น 98.0 → รอด gate (v_round twin)' }
  ];
  for (const c of ladder) {
    setGlobal(ctx, 'nrrKamResult', stubPct(c.pct));
    const res = vm.runInContext('_nrrRecomputeRowNrrOnly(' + JSON.stringify(kamRow) + ', "' + PERIOD + '")', ctx);
    const expected = Math.round((c.tier + FROZEN_SUM) * c.cap);
    t(c.note + ' → ฿' + expected, res && !res.skip && res.newPayout === expected && res.nrrPayout === c.tier,
      res && res.skip ? 'skip: ' + res.skip : 'got payout=' + (res && res.newPayout) + ' tier=' + (res && res.nrrPayout));
  }
  // TL: tier(101)=12000 × mult ที่ล็อก 1.2 = 14400 — ไม่มี gate ไม่มี upsell บวก
  setGlobal(ctx, 'nrrTeamResult', stubPct(101));
  const tlRes = vm.runInContext('_nrrRecomputeRowNrrOnly(' + JSON.stringify(rowOf('tl')) + ', "' + PERIOD + '")', ctx);
  t('TL 101% → ฿12,000 × 1.2 = ฿14,400', tlRes && !tlRes.skip && tlRes.newPayout === 14400,
    tlRes && (tlRes.skip || 'got ' + tlRes.newPayout));
  // pct ที่คืนต้องเป็นค่าไม่ปัด (audit trail) — 97.96 ไม่ใช่ 98.0
  setGlobal(ctx, 'nrrKamResult', stubPct(97.96));
  const rawRes = vm.runInContext('_nrrRecomputeRowNrrOnly(' + JSON.stringify(kamRow) + ', "' + PERIOD + '")', ctx);
  t('newPct เก็บค่าไม่ปัด (97.96) + gate.ach_pct เท่ากัน',
    rawRes && Math.abs(rawRes.newPct - 97.96) < 1e-9 && Math.abs(rawRes.gate.ach_pct - 97.96) < 1e-9,
    rawRes && ('newPct=' + rawRes.newPct));

  // ── (ข) กันเดือนสลับ + การ์ดโหมด ──────────────────────────────────────
  section('(ข) กันเดือนสลับ + การ์ดงวด/โหมด');
  setGlobal(ctx, 'nrrKamResult', () => ({ by_month: { '2026-08': { nrr_curr_norm: 105, effective_base_norm: 100, nrr_pct: 105 } } }));
  const swap = vm.runInContext('_nrrRecomputeRowNrrOnly(' + JSON.stringify(kamRow) + ', "' + PERIOD + '")', ctx);
  t('engine มีแต่ ส.ค. ขอ ก.ค. → skip (ไม่หยิบเดือนอื่นแทน)', swap && !!swap.skip && /ไม่มีข้อมูลเดือน/.test(swap.skip),
    swap && JSON.stringify(swap.skip || swap.newPayout));
  const outQ = await vm.runInContext('nrrRecomputeNrrOnlyPreview("2026-10")', ctx);
  t('งวดนอกไตรมาส → ok:false period_outside_quarter', outQ && outQ.ok === false && outQ.reason === 'period_outside_quarter', JSON.stringify(outQ));
  state.policyRows[0].commission_mode = 'monthly';
  vm.runInContext('nrrCommPolicyCache = {}', ctx);
  const monthly = await vm.runInContext('nrrRecomputeNrrOnlyPreview("' + PERIOD + '")', ctx);
  t('โหมด monthly → ok:false not_quarterly_mode', monthly && monthly.ok === false && monthly.reason === 'not_quarterly_mode', JSON.stringify(monthly));
  state.policyRows[0].commission_mode = 'quarterly';
  vm.runInContext('nrrCommPolicyCache = {}', ctx);

  // ── การ์ดรายแถว ─────────────────────────────────────────────────────
  section('การ์ดรายแถว (role/มัลติพลายเออร์/ฐานศูนย์)');
  setGlobal(ctx, 'nrrKamResult', stubPct(105));
  setGlobal(ctx, 'nrrTeamResult', stubPct(105));
  const pmRes = vm.runInContext('_nrrRecomputeRowNrrOnly(' + JSON.stringify(rowOf('pm')) + ', "' + PERIOD + '")', ctx);
  t('role pm → skip ไปทำที่ Sense Cockpit', pmRes && !!pmRes.skip && /Sense Cockpit/.test(pmRes.skip), pmRes && (pmRes.skip || pmRes.newPayout));
  const noMult = vm.runInContext('_nrrRecomputeRowNrrOnly(' + JSON.stringify(state.snapshotRows[2]) + ', "' + PERIOD + '")', ctx);
  t('TL ไม่มีตัวคูณล็อกไว้ → skip ไม่เดา 1.0', noMult && !!noMult.skip && /ตัวคูณ/.test(noMult.skip), noMult && (noMult.skip || noMult.newPayout));
  setGlobal(ctx, 'nrrKamResult', () => ({ by_month: { [PERIOD]: { nrr_curr_norm: 0, effective_base_norm: 0, nrr_pct: null } } }));
  const zeroBase = vm.runInContext('_nrrRecomputeRowNrrOnly(' + JSON.stringify(kamRow) + ', "' + PERIOD + '")', ctx);
  t('ฐานศูนย์ → skip ไม่ตีเป็น ฿0', zeroBase && !!zeroBase.skip, zeroBase && (zeroBase.skip || zeroBase.newPayout));

  // ── end-to-end: engine จริง + waiver จริง 87% → 105% ───────────────────
  section('End-to-end พรีวิว (engine จริง, waive A2 หลัง lock)');
  setGlobal(ctx, 'nrrKamResult', realKam);
  setGlobal(ctx, 'nrrTeamResult', realTl);
  const pre = await vm.runInContext('nrrRecomputeNrrOnlyPreview("' + PERIOD + '")', ctx);
  t('ก่อน waive: ไม่มีแถวเปลี่ยน (87% ตรงกับที่ล็อก)', pre && pre.ok && pre.changes.length === 0,
    pre && ('changes=' + JSON.stringify((pre.changes || []).map(c => c.email + ':' + c.newPct))));
  t('แถว skip = tl2 (ไม่มีตัวคูณ) + pm (คนละ scheme)', pre && pre.skipped.length === 2, pre && JSON.stringify(pre.skipped));

  ctx.__waived.add('A2|' + PERIOD);
  const post = await vm.runInContext('nrrRecomputeNrrOnlyPreview("' + PERIOD + '")', ctx);
  const kamC = post.changes.find(c => c.email === KAM);
  const tlC = post.changes.find(c => c.email === TL);
  t('หลัง waive: KAM 87→105% → ฿10,000 + frozen ฿3,500 = ฿13,500',
    kamC && Math.abs(kamC.newPct - 105) < 1e-9 && kamC.newPayout === 13500 && kamC.oldPayout === 0,
    kamC ? 'pct=' + kamC.newPct + ' payout=' + kamC.newPayout : 'no kam change: ' + JSON.stringify(post.skipped));
  t('หลัง waive: TL 105% → ฿50,000 × 1.2 = ฿60,000',
    tlC && tlC.newPayout === 60000, tlC ? 'payout=' + tlC.newPayout : 'no tl change');
  t('totalDiff = ผลรวม diff ทุกแถว', post.totalDiff === post.changes.reduce((s, c) => s + c.diff, 0), 'got ' + post.totalDiff);

  // ── (ค)+(ง) apply: payload shape + frozen เป๊ะ + source-lock กับ Sense ──
  section('(ค)(ง) apply payload — shape เหมือน Sense + frozen ไม่ขยับ');
  const applied = await vm.runInContext('nrrRecomputeNrrOnlyApply("' + PERIOD + '", ' +
    JSON.stringify(post.changes) + ', "harness test")', ctx);
  t('apply สำเร็จ ' + post.changes.length + ' แถว', applied && applied.ok === true && applied.count === post.changes.length, JSON.stringify(applied));
  const up = state.upserts[state.upserts.length - 1];
  t('upsert onConflict = period_month,beneficiary_role,beneficiary_email',
    up && up.opts && up.opts.onConflict === 'period_month,beneficiary_role,beneficiary_email', up && JSON.stringify(up.opts));

  const pk = up.payload.find(p => p.beneficiary_email === KAM);
  const pt = up.payload.find(p => p.beneficiary_email === TL);
  // (ค) field ครบตาม shape ของ Sense — breakdown + top-level
  const bdFields = ['revisions', 'nrr_pct', 'nrr_payout', 'components_subtotal', 'gmv_gate', 'final_payout', 'frozen_components', 'recomputed_at'];
  t('breakdown มี field ครบ: ' + bdFields.join(','),
    pk && bdFields.every(f => pk.breakdown[f] !== undefined),
    pk && bdFields.filter(f => pk.breakdown[f] === undefined).join(',') + ' missing');
  const topFields = ['raw_nrr_pct', 'governed_nrr_pct', 'payout_amount', 'snapshot_status', 'updated_at', 'updated_by'];
  t('top-level มี field ครบ: ' + topFields.join(','),
    pk && topFields.every(f => pk[f] !== undefined),
    pk && topFields.filter(f => pk[f] === undefined).join(',') + ' missing');
  t('status คง final + payout_amount = ที่พรีวิว', pk && pk.snapshot_status === 'final' && pk.payout_amount === 13500,
    pk && (pk.snapshot_status + '/' + pk.payout_amount));
  const rev = pk && pk.breakdown.revisions[pk.breakdown.revisions.length - 1];
  t('revision kind nrr_only + prev/new ครบ', rev && rev.kind === 'nrr_only' && rev.prev_payout === 0 &&
    rev.new_payout === 13500 && rev.reason === 'harness test' && rev.by === 'admin@test.co', JSON.stringify(rev));
  t('frozen_components ระบุ 4 ก้อนเหมือน Sense',
    pk && JSON.stringify(pk.breakdown.frozen_components) === JSON.stringify(['upsell_sku', 'upsell_outlet', 'handover', 'upsell_mult']),
    pk && JSON.stringify(pk.breakdown.frozen_components));
  // (ง) ค่าแช่แข็งต้องไม่ขยับแม้แต่บาทเดียว
  t('upsell_sku/outlet/handover ค่าเดิมเป๊ะ (2000/500/1000)',
    pk && pk.breakdown.upsell_sku.total_commission === 2000 && pk.breakdown.upsell_outlet.commission === 500 &&
    pk.breakdown.handover.payout === 1000 && pk.breakdown.handover.data_missing === false,
    pk && JSON.stringify({ s: pk.breakdown.upsell_sku, o: pk.breakdown.upsell_outlet, h: pk.breakdown.handover }));
  t('TL upsell_mult แช่แข็ง 1.2 ไม่ถูกคำนวณใหม่',
    pt && pt.breakdown.upsell_mult.multiplier === 1.2 && pt.breakdown.upsell_mult.team_upsell_pct === 2.5 && pt.payout_amount === 60000,
    pt && JSON.stringify(pt.breakdown.upsell_mult));
  t('cache ถูกล้างหลังเขียน (nrrCommSnapshots=null + period cache หาย)',
    vm.runInContext('nrrCommSnapshots === null && !nrrCommPeriodCache["' + PERIOD + '"]', ctx));

  // source-lock: field ทุกตัวที่ /nrr เขียน ต้องยังอยู่ในตัวเขียนของ Sense
  const senseSrc = fs.readFileSync(path.join(ROOT, 'src/07a_commission_engine.js'), 'utf8');
  const applyStart = senseSrc.indexOf('async function recomputeNrrOnlyApply');
  const senseApply = senseSrc.slice(applyStart, senseSrc.indexOf('window.recomputeNrrOnlyApply', applyStart));
  const senseMarks = ['bd.revisions', 'bd.nrr_pct', 'bd.nrr_payout', 'bd.components_subtotal', 'bd.gmv_gate',
    'bd.final_payout', 'bd.frozen_components', 'bd.recomputed_at', 'raw_nrr_pct:', 'governed_nrr_pct:',
    'payout_amount:', "snapshot_status: 'final'", 'updated_at:', 'updated_by:',
    "kind: 'nrr_only'", 'prev_payout:', 'prev_nrr_pct:', 'new_payout:', 'new_nrr_pct:'];
  const missing = senseMarks.filter(m => senseApply.indexOf(m) === -1);
  t('source-lock: field ทั้ง ' + senseMarks.length + ' ตัวยังอยู่ใน Sense recomputeNrrOnlyApply', missing.length === 0,
    'หายจาก Sense (Sense เปลี่ยน shape — ต้อง re-mirror /nrr): ' + missing.join(', '));

  // การ์ดสิทธิ์
  section('การ์ดสิทธิ์');
  setGlobal(ctx, 'nrrProfile', { email: 'kam@test.co', role: 'kam' });
  const denied = await vm.runInContext('nrrRecomputeNrrOnlyApply("' + PERIOD + '", ' + JSON.stringify(post.changes) + ', "x")', ctx);
  t('role kam กด apply → not_authorized', denied && denied.ok === false && denied.error === 'not_authorized', JSON.stringify(denied));
  setGlobal(ctx, 'nrrProfile', { email: 'admin@test.co', role: 'admin' });
  const empty = await vm.runInContext('nrrRecomputeNrrOnlyApply("' + PERIOD + '", [], "x")', ctx);
  t('changes ว่าง → no_changes ไม่เขียนอะไร', empty && empty.ok === false && empty.error === 'no_changes', JSON.stringify(empty));

  // ── detection ───────────────────────────────────────────────────────
  section('Detection — nrrDetectStaleLockedPeriods');
  const mkWaiver = (o) => Object.assign({ id: 'w1', period_month: PERIOD, account_id: 'A2',
    status: 'approved', reviewed_at: '2026-08-05T10:00:00.000Z' }, o);
  setGlobal(ctx, 'nrrCommSnapshots', { rows: snapshotRows(), byEmail: {}, loaded: true });
  setGlobal(ctx, 'nrrExclusionsCache', [mkWaiver({})]);
  let det = vm.runInContext('nrrDetectStaleLockedPeriods()', ctx);
  t('waiver อนุมัติหลัง lock → งวดขึ้นป้าย 1 รายการ', det.length === 1 && det[0].period === PERIOD && det[0].count === 1, JSON.stringify(det));
  setGlobal(ctx, 'nrrExclusionsCache', [mkWaiver({ status: 'revoked' })]);
  det = vm.runInContext('nrrDetectStaleLockedPeriods()', ctx);
  t('เพิกถอนหลัง lock ก็นับ (กว้างกว่า Sense โดยตั้งใจ)', det.length === 1, JSON.stringify(det));
  setGlobal(ctx, 'nrrExclusionsCache', [mkWaiver({ reviewed_at: '2026-07-30T00:00:00.000Z' })]);
  det = vm.runInContext('nrrDetectStaleLockedPeriods()', ctx);
  t('ตัดสินก่อน lock → ไม่ขึ้นป้าย', det.length === 0, JSON.stringify(det));
  setGlobal(ctx, 'nrrExclusionsCache', [mkWaiver({ status: 'submitted' })]);
  det = vm.runInContext('nrrDetectStaleLockedPeriods()', ctx);
  t('ยังรออนุมัติ (submitted) → ไม่ขึ้นป้าย', det.length === 0, JSON.stringify(det));
  // recompute แล้ว recomputed_at ใหม่กว่า reviewed_at → ป้ายหายเอง
  const bumped = snapshotRows();
  bumped.forEach(r => { r.breakdown.recomputed_at = '2026-08-06T00:00:00.000Z'; });
  setGlobal(ctx, 'nrrCommSnapshots', { rows: bumped, byEmail: {}, loaded: true });
  setGlobal(ctx, 'nrrExclusionsCache', [mkWaiver({})]);
  det = vm.runInContext('nrrDetectStaleLockedPeriods()', ctx);
  t('หลัง recompute (recomputed_at ใหม่กว่า) → ป้ายหายเอง', det.length === 0, JSON.stringify(det));
  setGlobal(ctx, 'nrrCommSnapshots', null);
  det = vm.runInContext('nrrDetectStaleLockedPeriods()', ctx);
  t('snapshot ยังไม่โหลด → [] เงียบๆ ไม่พัง', Array.isArray(det) && det.length === 0, JSON.stringify(det));

  console.log('\n' + (fail ? '❌' : '✅') + ' verify_nrr_recompute: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS CRASH:', e); process.exit(1); });
