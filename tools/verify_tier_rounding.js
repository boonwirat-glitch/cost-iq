#!/usr/bin/env node
/**
 * verify_tier_rounding.js — v_round
 *
 * กฎที่บุชเคาะ 2026-08-02: **ปัด %NRR ขึ้นที่ทศนิยม 1 ตำแหน่ง ก่อนเทียบขั้น**
 *
 * ที่มา: KAM คนหนึ่งอยู่ที่ 99.9745% · จอปัดเป็น "100.0%" แต่ขั้น >=100 เห็น
 * 99.9745 จึงจ่าย ฿0 → หน้าจอเขียนว่า "100.0% · Below threshold" คู่กับ ฿0
 * ซึ่งแยกไม่ออกจากบั๊ก · ปัดที่ 1 ตำแหน่งเท่ากับที่จอแสดง = "เห็นเท่าไหร่ได้เท่านั้น"
 *
 * ทำไมต้อง 1 ไม่ใช่ 2: ปัด 2 ตำแหน่ง 99.9745 → 99.97 ยังไม่ถึง 100 = ไม่แก้เคสจริง
 *
 * ★ ข้อที่ห้ามพลาดที่สุด: **ห้ามปัดค่าที่เป็นบาท** ประตู P1 คือ GMV ฿5,000
 * ถ้าเผลอปัด ฿4,999.96 จะกลายเป็น ฿5,000.0 แล้วเปิดประตูที่ควรปิด
 *
 * รัน: node tools/verify_tier_rounding.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FROZEN_NOW = new Date('2026-08-02T03:00:00.000Z').getTime();

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
    parseFloat, parseInt, Set, Map, Promise, RegExp, Error, Infinity
  };
  vm.createContext(ctx);
  ['src/07a_commission_engine.js', 'src/07b_commission_cockpit.js',
   'src/07b_nrr_target.js', 'src/07b_cds.js', 'src/07c_qnrr_view.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
  return ctx;
}

// ขั้นจริงที่ใช้อยู่ใน production (ตรวจกับ Supabase แล้ว 2026-08-02)
//   < 100        → ฿0      "Below threshold"
//   100 – 103    → ฿5,000  "Base NRR"
//   >= 103       → ฿10,000 "Bonus NRR"
function seedTiers(ctx) {
  setGlobal(ctx, '_commRuleConfig', {
    plans: { KAM_NRR_STD: { id: 'r-kam', plan_code: 'KAM_NRR_STD', beneficiary_role: 'kam', status: 'active' } },
    rules: { 'r-kam': { id: 'r-kam', payout_type: 'flat_amount', measurement_scope: 'governed_nrr' } },
    tiers: { 'r-kam': [
      { min_value: 103,  max_value: null, payout_value: 10000, payout_label: 'Bonus NRR' },
      { min_value: 100,  max_value: 103,  payout_value: 5000,  payout_label: 'Base NRR' },
      { min_value: null, max_value: 100,  payout_value: 0,     payout_label: 'Below threshold' }
    ] },
    assignments: []
  });
  setGlobal(ctx, '_tgtSettings', { nrr_threshold: 98,
    gmv_gate_params: { threshold_1: 98, threshold_2: 95, cap_1: 0.3, cap_2: 0 } });
}

function payoutAt(ctx, pct) {
  ctx.__p = pct;
  return vm.runInContext("_commPayoutForPctByCode('KAM_NRR_STD','kam',__p)", ctx);
}
function labelAt(ctx, pct) {
  ctx.__p = pct;
  const tier = vm.runInContext("_commMatchTierByCode('KAM_NRR_STD','kam',__p)", ctx);
  return tier ? tier.payout_label : null;
}

// ═════════════════════════════════════════════════════════════════════════
section('[1] helper ปัด 1 ตำแหน่ง');
{
  const ctx = makeCtx();
  const cases = [
    [99.9745, 100.0, 'เคส Cream จริง'],
    [99.95,   100.0, 'ครึ่งพอดี → ปัดขึ้น'],
    [99.94,   99.9,  'ต่ำกว่าครึ่ง → ปัดลง'],
    [100.0,   100.0, 'เต็มพอดี → เท่าเดิม'],
    [102.9751,103.0, 'เคสนิชมนจริง'],
    [217,     217,   'ค่าใน golden ต้องไม่ขยับ'],
    [190.133333, 190.1, 'ค่าใน golden ต้องไม่ขยับข้ามขั้น']
  ];
  cases.forEach(([inp, exp, why]) => {
    ctx.__v = inp;
    const got = vm.runInContext('_commTierPct(__v)', ctx);
    t(`${inp} → ${exp}  (${why})`, got === exp, 'ได้ ' + got);
  });
  ctx.__v = null;
  t('null ผ่านทะลุ ไม่กลายเป็น 0', vm.runInContext('_commTierPct(__v)', ctx) === null);
  ctx.__v = NaN;
  t('NaN ผ่านทะลุ ไม่กลายเป็น 0', isNaN(vm.runInContext('_commTierPct(__v)', ctx)));
}

// ═════════════════════════════════════════════════════════════════════════
section('[2] ★ เส้นแบ่ง 100 — เคสที่ทำให้ต้องแก้ทั้งหมดนี้');
{
  const ctx = makeCtx(); seedTiers(ctx);
  t('99.94 → ฿0 (ยังไม่ถึงจริงๆ)',        payoutAt(ctx, 99.94)   === 0,    'ได้ ' + payoutAt(ctx, 99.94));
  t('99.95 → ฿5,000 (ครึ่งพอดี ปัดขึ้น)',  payoutAt(ctx, 99.95)   === 5000, 'ได้ ' + payoutAt(ctx, 99.95));
  t('★ 99.9745 (Cream) → ฿5,000',          payoutAt(ctx, 99.9745) === 5000, 'ได้ ' + payoutAt(ctx, 99.9745));
  t('100.0 → ฿5,000 (ไม่ถดถอย)',           payoutAt(ctx, 100)     === 5000, 'ได้ ' + payoutAt(ctx, 100));
  t('ป้ายของ 99.9745 ต้องเป็น Base NRR ไม่ใช่ Below threshold',
    labelAt(ctx, 99.9745) === 'Base NRR', 'ได้ ' + labelAt(ctx, 99.9745));
  t('ป้ายของ 99.94 ยังเป็น Below threshold',
    labelAt(ctx, 99.94) === 'Below threshold', 'ได้ ' + labelAt(ctx, 99.94));
}

// ═════════════════════════════════════════════════════════════════════════
section('[3] เส้นแบ่ง 103 — กฎเดียวกันต้องใช้ทุกขั้น');
{
  const ctx = makeCtx(); seedTiers(ctx);
  t('102.94 → ฿5,000',                      payoutAt(ctx, 102.94)   === 5000,  'ได้ ' + payoutAt(ctx, 102.94));
  t('102.95 → ฿10,000',                     payoutAt(ctx, 102.95)   === 10000, 'ได้ ' + payoutAt(ctx, 102.95));
  t('★ 102.9751 (นิชมน) → ฿10,000',         payoutAt(ctx, 102.9751) === 10000, 'ได้ ' + payoutAt(ctx, 102.9751));
  t('103.0 → ฿10,000 (ไม่ถดถอย)',           payoutAt(ctx, 103)      === 10000, 'ได้ ' + payoutAt(ctx, 103));
}

// ═════════════════════════════════════════════════════════════════════════
section('[4] จอกับเงินต้องพูดตรงกันเสมอ — คุณสมบัติหลักของงานนี้');
{
  const ctx = makeCtx(); seedTiers(ctx);
  // ไล่ทีละ 0.01 รอบเส้นแบ่ง: ถ้าจอเขียน "100.0%" ต้องไม่มีทางได้ ฿0
  let contradictions = [];
  for (let v = 99.80; v <= 100.20; v = Math.round((v + 0.01) * 100) / 100) {
    ctx.__v = v;
    const shown = vm.runInContext('_commFmtPct(__v)', ctx);
    const paid  = payoutAt(ctx, v);
    if (shown === '100.0%' && paid === 0) contradictions.push(v);
    if (shown === '99.9%'  && paid > 0)   contradictions.push(v);
  }
  t('ไม่มีค่าไหนที่จอบอก 100.0% แล้วจ่าย ฿0 (หรือกลับกัน)',
    contradictions.length === 0, 'ขัดกันที่ ' + JSON.stringify(contradictions));

  let c2 = [];
  for (let v = 102.80; v <= 103.20; v = Math.round((v + 0.01) * 100) / 100) {
    ctx.__v = v;
    const shown = vm.runInContext('_commFmtPct(__v)', ctx);
    if (shown === '103.0%' && payoutAt(ctx, v) !== 10000) c2.push(v);
  }
  t('เส้น 103 ก็ไม่ขัดกันเช่นกัน', c2.length === 0, 'ขัดกันที่ ' + JSON.stringify(c2));
}

// ═════════════════════════════════════════════════════════════════════════
section('[5] GMV Gate — เส้นแบ่งเปอร์เซ็นต์เหมือนกัน ต้องปัดเหมือนกัน');
{
  const ctx = makeCtx(); seedTiers(ctx);
  setGlobal(ctx, '_commRuleConfig', Object.assign(
    vm.runInContext('_commRuleConfig', ctx), { componentRules: {} }));
  const gate = (pct) => { ctx.__p = pct; return vm.runInContext('_commComputeGmvGate("k@f.co",__p,null)', ctx); };
  t('97.94 → โดน cap 0.3',   gate(97.94).cap_multiplier === 0.3, JSON.stringify(gate(97.94)));
  t('★ 97.95 → รอด cap',      gate(97.95).cap_multiplier === 1.0, JSON.stringify(gate(97.95)));
  t('94.95 → รอดขึ้นมาชั้น 0.3', gate(94.95).cap_multiplier === 0.3, JSON.stringify(gate(94.95)));
  t('94.94 → ยังโดน cap 0',   gate(94.94).cap_multiplier === 0,   JSON.stringify(gate(94.94)));
  t('ach_pct ที่บันทึกไว้ยังเป็นค่าดิบ ไม่ถูกปัด (ต้องตรวจสอบย้อนหลังได้)',
    gate(97.9432).ach_pct === 97.9432, 'ได้ ' + gate(97.9432).ach_pct);
}

// ═════════════════════════════════════════════════════════════════════════
section('[6] ★★ ห้ามปัดบาท — ประตู P1 ฿5,000 ต้องไม่ถูกเปิดด้วยการปัด');
{
  const ctx = makeCtx();
  // rule ที่วัดเป็นบาท (gmv_raw) — ขั้นต่ำ ฿5,000
  ctx.__found = {
    rule: { id: 'r-p1', measurement_scope: 'gmv_raw' },
    active: true,
    tiers: [{ min_value: 5000, max_value: null, payout_value: 0.015, payout_label: 'P1' }]
  };
  const matchAt = (v) => { ctx.__v = v; return vm.runInContext('_commMatchTierInRule(__found, __v)', ctx); };
  t('★ ฿4,999.96 ต้องยังไม่ผ่านประตู (ถ้าปัดจะกลายเป็น 5,000.0 แล้วผ่าน)',
    matchAt(4999.96) === null, 'ได้ ' + JSON.stringify(matchAt(4999.96)));
  t('฿4,999.99 ก็ยังไม่ผ่าน', matchAt(4999.99) === null);
  t('฿5,000 ผ่านตามปกติ',     matchAt(5000) !== null);

  // rule ที่วัดเป็นเปอร์เซ็นต์ — ต้องปัด
  ctx.__found2 = {
    rule: { id: 'r-gate', measurement_scope: 'governed_nrr' },
    active: true,
    tiers: [{ min_value: 98, max_value: null, payout_value: 1.0, payout_label: 'ผ่าน' }]
  };
  const match2 = (v) => { ctx.__v = v; return vm.runInContext('_commMatchTierInRule(__found2, __v)', ctx); };
  t('scope เปอร์เซ็นต์: 97.95 → ปัดขึ้นแล้วผ่าน', match2(97.95) !== null);
  t('scope เปอร์เซ็นต์: 97.94 → ยังไม่ผ่าน',      match2(97.94) === null);

  ctx.__found3 = {
    rule: { id: 'r-mult', measurement_scope: 'team_upsell_pct' },
    active: true,
    tiers: [{ min_value: 4, max_value: null, payout_value: 1.5, payout_label: 'x1.5' }]
  };
  const match3 = (v) => { ctx.__v = v; return vm.runInContext('_commMatchTierInRule(__found3, __v)', ctx); };
  t('ตัวคูณ TL (team_upsell_pct) ก็ปัดเหมือนกัน: 3.95 → ผ่าน', match3(3.95) !== null);
  t('ตัวคูณ TL: 3.94 → ยังไม่ผ่าน',                            match3(3.94) === null);
}

// ═════════════════════════════════════════════════════════════════════════
section('[7] /nrr ต้องให้คำตอบเดียวกับ Sense เป๊ะ (ไม่งั้นสองแอปเถียงกัน)');
{
  const senseCtx = makeCtx(); seedTiers(senseCtx);

  // โหลดเฉพาะ nrr_commission.js ใน context เปล่า พอให้ tier logic ทำงาน
  const nrrCtx = { window: {}, console: { log(){}, warn(){}, error(){} },
    JSON, Math, Object, Array, String, Number, Boolean, isNaN, parseFloat, parseInt,
    Set, Map, Promise, RegExp, Error, Infinity, Date,
    document: { getElementById: () => null, querySelectorAll: () => [] },
    setTimeout: () => 0, localStorage: { getItem: () => null, setItem() {} } };
  vm.createContext(nrrCtx);
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/nrr/nrr_commission.js'), 'utf8'), nrrCtx);
  } catch (e) { /* module อาจต้องพึ่งของอื่น — ดัก แล้วเช็คเท่าที่มี */ }

  const hasNrrHelper = vm.runInContext("typeof nrrTierPct === 'function'", nrrCtx);
  t('nrr มี nrrTierPct (ฝาแฝดของ _commTierPct)', hasNrrHelper === true);

  if (hasNrrHelper) {
    const probes = [99.94, 99.95, 99.9745, 100, 102.94, 102.95, 102.9751, 103, 217, 190.133333];
    const mismatched = probes.filter(v => {
      senseCtx.__v = v; nrrCtx.__v = v;
      return vm.runInContext('_commTierPct(__v)', senseCtx) !== vm.runInContext('nrrTierPct(__v)', nrrCtx);
    });
    t('ปัดเหมือนกันทุกค่าที่ทดสอบ', mismatched.length === 0,
      'ต่างกันที่ ' + JSON.stringify(mismatched));
  }
}

console.log('\n' + '─'.repeat(62));
console.log(`${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
