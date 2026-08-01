#!/usr/bin/env node
/**
 * verify_commission_golden.js — v_clock Phase 0
 *
 * ตัวพิสูจน์ว่า "ค่าคอมฯ ไม่ regression" — ตรึงผลลัพธ์ของ `_commBuildSnapshotRows()`
 * ทั้งแถว (payout_amount + breakdown ทุก component) เทียบกับ golden fixture
 *
 * ทำไมต้องมี: harness เดิม 5 ตัวตรวจแค่ฟังก์ชันย่อย — tier (verify_nrr_precision_tiers),
 * gate, handover (verify_handover_gmv_tiers), upsell rate (verify_category_bonus),
 * single-month (verify_expansion_p1p3_single_month) · **ไม่มีตัวไหนตรึงผลลัพธ์รวม
 * ที่ถูกเขียนลงตาราง commission_payout_snapshots** ซึ่งเป็นตัวเลขที่จ่ายเงินจริง
 * ก่อนจะแตะเรื่อง lock/recompute จึงต้องมีตัวนี้ก่อน ไม่งั้น "ไม่ regression"
 * เป็นแค่ความเชื่อ ไม่ใช่ข้อพิสูจน์
 *
 * วิธีใช้:
 *   node tools/verify_commission_golden.js            → เทียบกับ golden
 *   node tools/verify_commission_golden.js --update   → เขียน golden ใหม่
 *                                                       (ใช้เฉพาะตอนตั้งใจเปลี่ยนสูตร
 *                                                        และต้องอธิบายได้ว่าเปลี่ยนอะไร)
 *
 * ขอบเขต: โหลด 07a + 07c ของจริงเข้า vm (แพตเทิร์นเดียวกับ
 * verify_nrr_precision_tiers.js) แล้วป้อน fixture คงที่ · ไม่ mock ตัวคำนวณเลย —
 * mock เฉพาะ "ข้อมูลเข้า" (CSV globals) กับ `_buildKamGroups` ซึ่งอยู่คนละไฟล์
 * (06_portview_teamview.js) และเป็น input ไม่ใช่สูตร
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const GOLDEN = path.join(__dirname, 'fixtures', 'commission_golden.json');
const UPDATE = process.argv.includes('--update');

// นาฬิกาตรึง — หลายฟังก์ชันเรียก new Date() (daysElapsed, computed_at,
// _commEomStatus, handover window) ถ้าไม่ตรึงไว้ golden จะเปลี่ยนทุกวัน
// 2026-07-15 = กลางเดือน ก.ค. เลือกวันที่ 15 เพื่อให้ projectionReady=true
// (daysElapsed>=5) และไม่อยู่ในช่วง grace (<=3) — เป็นสภาพ "เดือนกำลังเดิน" ปกติ
const FROZEN_NOW = new Date('2026-07-15T03:00:00.000Z').getTime();

function domStub() {
  return {
    head: { appendChild() {} }, body: { appendChild() {} },
    addEventListener() {}, getElementById() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {}, setAttribute() {}, addEventListener() {} }; }
  };
}

// ตั้งทั้ง global ของ context และ window.<name> พร้อมกัน
//
// จำเป็น เพราะโค้ดจริงอ่านสองแบบปนกัน: 07a อ่าน `bulkQnrrData` ตรงๆ แต่
// 07c:101 อ่าน `window.bulkQnrrData` · ใน vm นั้น `window` เป็น object แยก
// ไม่ใช่ตัว global เหมือนในเบราว์เซอร์ ถ้าตั้งข้างเดียว `_qnrrCompute` จะคืน null
// ที่บรรทัด 102 แล้วทั้ง harness จะได้ 0 หมดโดยไม่มี error ให้เห็น
function setGlobal(ctx, name, value) {
  ctx.__inject = value;
  vm.runInContext(name + ' = __inject; try{ window.' + name + ' = __inject; }catch(e){}', ctx);
  delete ctx.__inject;
}

function makeCtx() {
  // Date ที่ตรึงเวลา — subclass ของจริงเพื่อให้ method อื่นทำงานปกติหมด
  class FrozenDate extends Date {
    constructor(...args) { if (!args.length) super(FROZEN_NOW); else super(...args); }
    static now() { return FROZEN_NOW; }
  }
  const ctx = {
    window: {}, document: domStub(), navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    // ห้ามกลืน warn/error — `_commBuildKamPayout` มี catch ที่คืน fallback
    // `upsell_sku:{total_comm:0}` (ไม่มี .p1) แล้ว `_commBuildSnapshotRows` จะพังต่อ
    // ที่ `.p1.gmv` ถ้าปิด console ไว้จะไล่ต้นเหตุไม่เจอเลย
    console: { log() {}, info() {},
               warn: (...a) => console.warn('    [vm warn]', ...a),
               error: (...a) => console.error('    [vm error]', ...a) },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Date: FrozenDate, JSON, Math, Object, Array, String, Number, Boolean, isNaN,
    parseFloat, parseInt, Set, Map, Promise, RegExp, Error
  };
  vm.createContext(ctx);
  // โหลดตามลำดับ build.py จริง (build.py:27-33) — ลำดับสำคัญ เพราะ 07b_cds.js
  // override window._commBuildPayoutSummary ทับของ 07a ตอนโหลด
  // (_commBuildSnapshotRows ที่เราตรึงไม่ถูก override แต่โหลดครบไว้ก่อนถูกกว่า)
  ['src/07a_commission_engine.js',
   'src/07b_commission_cockpit.js',   // _commGetAssignmentPlan, _commGetConfig
   'src/07b_nrr_target.js',           // _tgtComputeKamNRR (โหมด monthly เรียกถึง)
   'src/07b_cds.js',                  // override _commBuildPayoutSummary (โหลดให้ครบตามจริง)
   'src/07c_qnrr_view.js'             // window._qnrrComputeForCommission (07a เรียก lazy)
  ].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
  });
  return ctx;
}

// ── Fixture: ทีมเดียว 2 KAM + 1 TL + 1 PM · ตัวเลขกลมๆ อ่านออกด้วยตา ────────
const PERIOD = '2026-07';
const KAMS = [
  { email: 'kam.a@f.co', name: 'Alpha (Al) One' },
  { email: 'kam.b@f.co', name: 'Bravo (Bee) Two' }
];
const TL = { email: 'tl.x@f.co', name: 'Xray (Ray) Lead' };

function qnrrRow(o) {
  return Object.assign({
    period_month: PERIOD, account_id: 'A1', outlet_id: 'O1', res_name: 'ร้านทดสอบ',
    account_name: 'บริษัททดสอบ', movement_type: 'core_nrr', base_gmv: 0, curr_gmv: 0,
    // ต้องเป็น latest_tl_email — `_rowInScope` scope 'tl' อ่านชื่อนี้ (07c:145)
    // ถ้าตั้งเป็น latest_tl แถว TL จะได้ null เงียบๆ
    latest_kam_email: KAMS[0].email, latest_tl_email: TL.email, account_type: 'Chain',
    curr_days: 15, days_in_month: 31
  }, o);
}

function buildFixture(ctx) {
  // bulkQnrrData — โครงเดียวกับที่ 02_data_pipeline.js สร้าง (byKamEmail/byTlEmail/allRows)
  const rows = [
    // KAM A: ฐาน 1,000,000 → ปัจจุบัน 1,050,000 = 105%
    qnrrRow({ account_id: 'A1', outlet_id: 'O1', base_gmv: 600000, curr_gmv: 630000 }),
    qnrrRow({ account_id: 'A2', outlet_id: 'O2', base_gmv: 400000, curr_gmv: 420000 }),
    // KAM B: ฐาน 500,000 → ปัจจุบัน 460,000 = 92% (ต่ำกว่าเกณฑ์ ใช้ทดสอบ gate)
    qnrrRow({ account_id: 'B1', outlet_id: 'O3', base_gmv: 500000, curr_gmv: 460000,
              latest_kam_email: KAMS[1].email }),
    // outlet ใหม่ ใช้ทดสอบ expansion
    qnrrRow({ account_id: 'A3', outlet_id: 'O4', movement_type: 'expansion',
              base_gmv: 0, curr_gmv: 80000 })
  ];
  const byKamEmail = {}, byTlEmail = {};
  rows.forEach(r => {
    (byKamEmail[r.latest_kam_email] = byKamEmail[r.latest_kam_email] || []).push(r);
    (byTlEmail[r.latest_tl_email] = byTlEmail[r.latest_tl_email] || []).push(r);
  });
  setGlobal(ctx, 'bulkQnrrData', { loaded: true, allRows: rows, byKamEmail, byTlEmail });

  // portview — ใช้สร้าง TL list + map email→ชื่อ
  setGlobal(ctx, 'portviewBulkData', KAMS.map((k, i) => ({
    accountId: 'ACC' + i, kamEmail: k.email, kamName: k.name,
    tlEmail: TL.email, tlName: TL.name, gmv: 100000
  })));

  // upsell bundle ต่อ KAM — grain กลุ่มสินค้า × สาขา × เดือน
  const upRow = (existing, total) => ({ existingGmv: existing, totalGmv: total });
  setGlobal(ctx, 'bulkUpsellData', {
    byKam: {
      [KAMS[0].email]: { A1: { O1: {
        'เนื้อวัว': { 'ก.ค. 2569': upRow(200000, 200000), 'มิ.ย. 2569': upRow(0, 80000) },
        'ผักสด':   { 'ก.ค. 2569': upRow(0, 60000) }
      } } },
      [KAMS[1].email]: { B1: { O3: {
        'อาหารทะเล': { 'ก.ค. 2569': upRow(0, 30000) }
      } } }
    }
  });

  // handover — retention
  setGlobal(ctx, 'bulkHandoverData', { byNewKamName: {
    [KAMS[0].name]: [{ account_id: 'H1', account_name: 'ร้านรับโอน',
      baseline_gmv: 300000, current_gmv: 285000, outlet_id: 'OH1' }]
  } });

  setGlobal(ctx, 'bulkHistoryData', {});
  setGlobal(ctx, 'bulkOutletsData', { byAccountId: {} });
  setGlobal(ctx, 'bulkCurrentMonthData', {});

  // ไม่มี waiver ใน baseline — เก็บไว้ทดสอบใน verify_recompute_nrr_only.js
  setGlobal(ctx, '_nrrExclusions', []);

  // config: บังคับโหมด quarterly ให้ชัด ไม่ให้ตกไป monthly เพราะ policy ยังไม่โหลด
  // key เป็น string แบน `${period}|${scopeType}|${scopeKey}` (`_nrrGovKey` 07a:2176)
  // ไม่ใช่ object ซ้อน — ถ้าใส่ผิดจะตกไป _nrrGovDefaultPolicy ที่เป็น rolling_mom
  // แล้วทั้ง harness จะวัด monthly engine โดยไม่รู้ตัว
  setGlobal(ctx, '_nrrGovPolicies', {
    '2026-07|all|all': {
      period_month: PERIOD, scope_type: 'all', scope_key: 'all',
      commission_mode: 'quarterly', base_mode: 'fixed', base_month: '2026-06',
      quarter_id: '2026q3', status: 'locked'
    }
  });
  ctx.window._nrrGovPoliciesLoaded = true;
  // Tier + gate config — เลือกขั้นบันไดให้ "คร่อม" ค่า %NRR ที่ fixture นี้ผลิตจริง
  // (kam.a 217.0 · kam.b 190.13 · tl 208.04) เพื่อให้ตรรกะ tier matching และ gate
  // ทำงานจริงทั้งสองด้าน ไม่ใช่ทุกคนตกขั้นเดียวกันหมดจนตรวจอะไรไม่ได้:
  //   kam.a 217.0  → ขั้นบน (10,000) · gate ผ่าน (>=215)
  //   kam.b 190.13 → ขั้นล่าง (5,000) · gate ตัดเหลือ 0.3
  //   tl    208.04 → ขั้น TL (20,000) · gate ตัดเหลือ 0.3
  //
  // หมายเหตุสำคัญ: %NRR ที่ได้ (190-217%) ไม่ใช่ค่าที่สมจริงในธุรกิจ — มันสูงเพราะ
  // fixture มีข้อมูลเดือนเดียวแต่ base_norm เป็นแบบทั้งไตรมาส · ไม่ใช่บั๊ก และไม่สำคัญ
  // ต่อหน้าที่ของ harness นี้ ซึ่งคือ "จับการเปลี่ยนแปลง" ไม่ใช่ "จำลองธุรกิจ"
  setGlobal(ctx, '_commRuleConfig', {
    plans: {
      KAM_NRR_STD: { id: 'r-kam', plan_code: 'KAM_NRR_STD', beneficiary_role: 'kam', status: 'active' },
      TL_NRR_STD:  { id: 'r-tl',  plan_code: 'TL_NRR_STD',  beneficiary_role: 'tl',  status: 'active' }
    },
    rules: {
      'r-kam': { id: 'r-kam', payout_type: 'flat_amount', measurement_scope: 'governed_nrr' },
      'r-tl':  { id: 'r-tl',  payout_type: 'flat_amount', measurement_scope: 'governed_nrr' }
    },
    tiers: {
      'r-kam': [{ min_value: 200, max_value: null, payout_value: 10000, payout_label: 'ขั้นบน' },
                { min_value: 185, max_value: 200,  payout_value: 5000,  payout_label: 'ขั้นล่าง' }],
      'r-tl':  [{ min_value: 200, max_value: null, payout_value: 20000, payout_label: 'TL ขั้นบน' }]
    },
    assignments: []
  });
  setGlobal(ctx, '_tgtSettings', {
    nrr_threshold: 98,
    gmv_gate_params: { threshold_1: 215, threshold_2: 180, cap_1: 0.3, cap_2: 0 }
  });
  setGlobal(ctx, '_tgtSettingsLoadFailed', false);

  setGlobal(ctx, 'currentUserProfile', {
    email: 'admin@f.co', role: 'admin', full_name: 'Admin Tester'
  });

  // _buildKamGroups อยู่ใน 06_portview_teamview.js (ไฟล์ใหญ่ พึ่ง DOM หนัก)
  // เป็น "ข้อมูลเข้า" ไม่ใช่สูตร จึงป้อนตรงๆ แทนการโหลดทั้งไฟล์
  setGlobal(ctx, '_buildKamGroups', function () {
    return KAMS.map(k => ({
      kamEmail: k.email, kamName: k.name, tlEmail: TL.email, tlName: TL.name,
      accounts: [], accountCount: 1
    }));
  });
}

// ตัดเฉพาะ field ที่ไม่คงที่ตามเวลา/ผู้รัน — ที่เหลือต้องนิ่งทุกครั้ง
const VOLATILE = new Set(['computed_at', 'updated_at', 'created_at', 'locked_at',
                          'updated_by', 'locked_by', 'id']);
function stripVolatile(v) {
  if (Array.isArray(v)) return v.map(stripVolatile);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).sort().forEach(k => { if (!VOLATILE.has(k)) out[k] = stripVolatile(v[k]); });
    return out;
  }
  if (typeof v === 'number' && !Number.isInteger(v)) return Math.round(v * 1e6) / 1e6;
  return v;
}

function run() {
  const ctx = makeCtx();
  buildFixture(ctx);
  ctx.__period = PERIOD;
  const rows = vm.runInContext('_commBuildSnapshotRows(__period)', ctx);
  if (!Array.isArray(rows)) throw new Error('_commBuildSnapshotRows ไม่ได้คืน array');
  // เรียงให้เสถียร — ลำดับจาก forEach ขึ้นกับลำดับ key ของ object
  const sorted = rows.slice().sort((a, b) =>
    (a.beneficiary_role + '|' + a.beneficiary_email)
      .localeCompare(b.beneficiary_role + '|' + b.beneficiary_email));
  return stripVolatile(sorted);
}

let actual;
try { actual = run(); }
catch (e) {
  console.error('ERROR: รัน _commBuildSnapshotRows ไม่ผ่าน — ' + e.message);
  console.error(e.stack);
  process.exit(2);
}

if (UPDATE || !fs.existsSync(GOLDEN)) {
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + '\n');
  console.log((UPDATE ? 'อัปเดต' : 'สร้าง') + ' golden แล้ว: ' +
    path.relative(ROOT, GOLDEN) + ' (' + actual.length + ' แถว)');
  console.log('\nสรุปแถวที่ถูกตรึง:');
  actual.forEach(r => console.log('  ' + r.beneficiary_role.padEnd(6) + ' ' +
    String(r.beneficiary_email).padEnd(14) + ' payout=' + r.payout_amount +
    ' nrr=' + r.governed_nrr_pct));
  process.exit(0);
}

const expected = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
const a = JSON.stringify(actual, null, 2);
const b = JSON.stringify(expected, null, 2);

if (a === b) {
  console.log('PASS — commission snapshot ตรงกับ golden ทุกแถว (' + actual.length + ' แถว)');
  actual.forEach(r => console.log('  ' + r.beneficiary_role.padEnd(6) + ' ' +
    String(r.beneficiary_email).padEnd(14) + ' payout=' + r.payout_amount));
  console.log('\n0 fail');
  process.exit(0);
}

console.log('FAIL — ค่าคอมฯ เปลี่ยนจาก golden');
console.log('ถ้าตั้งใจเปลี่ยนสูตร ให้รัน --update แล้วอธิบายว่าเปลี่ยนอะไรใน commit\n');
const al = a.split('\n'), bl = b.split('\n');
let shown = 0;
for (let i = 0; i < Math.max(al.length, bl.length) && shown < 40; i++) {
  if (al[i] !== bl[i]) {
    console.log('  บรรทัด ' + (i + 1));
    console.log('    golden: ' + (bl[i] === undefined ? '(ไม่มี)' : bl[i].trim()));
    console.log('    ตอนนี้: ' + (al[i] === undefined ? '(ไม่มี)' : al[i].trim()));
    shown++;
  }
}
console.log('\n1 fail');
process.exit(1);
