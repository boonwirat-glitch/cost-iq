#!/usr/bin/env node
// tools/verify_customer_panel.js — v_echor2 (2026-08-08)
//
// ล็อกหน้า "ลูกค้า" หลังออกแบบใหม่
//
// ทำไมต้องมี: บุชบอกว่าหน้านี้ "มี 2 โครงสร้างทับซ้อนกัน ใช้เวลาอ่านนานมากกว่าจะ
// เข้าใจว่าลูกค้าต้องการอะไร" · ต้นเหตุคือโมเดลเขียนสิ่งที่ต้องทำลงสองที่
// (needs[].suggested_action กับ next_actions[]) แล้วหน้าจอโชว์ทั้งคู่
// ตอนนี้ action อยู่ที่เดียว + มีสรุปหนึ่งบรรทัดขึ้นก่อน
//
// ข้อที่ห้ามพังเด็ดขาด: session เก่า 44 อันที่วิเคราะห์ไปแล้วไม่มี headline /
// need_id / priority — ต้องเปิดอ่านได้เหมือนเดิม ไม่มีการ re-analyze ย้อนหลัง
//
// Usage: node tools/verify_customer_panel.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CI = fs.readFileSync(path.join(__dirname, '..', 'src', '09_conv_intel.js'), 'utf8');
const WK = fs.readFileSync(path.join(__dirname, '..', 'worker', 'freshket-sense-ai-proxy-v2.js'), 'utf8');

let fail = 0, pass = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}
// ตัดถึงบรรทัดปิดฟังก์ชันตัวแรกที่อยู่ระดับ indent เดียวกับหัวฟังก์ชัน
// (worker เป็น top-level = "}" ชิดซ้าย · client อยู่ใน IIFE = "  }")
function extract(src, header, file, close) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error('ไม่เจอ ' + header + ' ใน ' + file);
  const end = src.indexOf(close, i);
  if (end < 0) throw new Error('หาจุดจบของ ' + header + ' ไม่เจอใน ' + file);
  return src.slice(i, end + close.length);
}

console.log('── echo: หน้าลูกค้า (สรุปก่อน แล้วค่อยรายละเอียด) ──');

// ── ชั้น AI (worker) ────────────────────────────────────────────────────────
check('worker: needs ไม่สั่งให้เขียน suggested_action แล้ว',
  !/"suggested_action"/.test(WK) && !/และ "suggested_action"/.test(WK));
check('worker: action ผูกกลับ need ด้วย need_id', /"need_id"/.test(WK));
check('worker: มี headline ใน schema', /"headline"/.test(WK));
check('worker: action มี priority', /"priority": 1/.test(WK));
check('worker: สั่งชัดว่าเขียน action ที่เดียว',
  /next_actions" ที่เดียวเท่านั้น/.test(WK));
check('worker: ส่งธง [ฟังไม่ชัด] รายท่อนเข้า prompt',
  /\[ฟังไม่ชัด\]/.test(WK) && /transcript_confidence < LOW_CONF/.test(WK));
check('worker: ห้ามยกท่อนฟังไม่ชัดมาเป็น quote',
  /ห้ามยกเป็น quote/.test(WK));
check('worker: headline ถูกเก็บลง customer_intel',
  /headline:\s*typeof parsed\.headline/.test(WK));

// _normalizeActions — เรียง/ตัด/ล้าง need_id ก่อนลง DB
const normSrc = extract(WK, 'function _normalizeActions(raw) {', 'worker', '\n}\n');
const wctx = {}; vm.createContext(wctx);
vm.runInContext(normSrc + '\nthis.__n = _normalizeActions;', wctx);
const norm = wctx.__n;
check('normalize: ไม่ใช่ array → []', JSON.stringify(norm(null)) === '[]');
check('normalize: ตัดข้อที่ไม่มีข้อความทิ้ง', norm([{ action: '  ' }, { action: 'ทำ' }]).length === 1);
const sorted = norm([
  { action: 'C', priority: 3 }, { action: 'A', priority: '1' }, { action: 'B', priority: 2 }
]);
check('normalize: เรียงตาม priority และ priority เป็น string ก็อ่านออก',
  sorted.map(a => a.action).join('') === 'ABC', sorted.map(a => a.action).join(''));
check('normalize: ไล่เลข priority ใหม่ 1..n', sorted.map(a => a.priority).join('') === '123');
check('normalize: ตัดที่ 5 ข้อ',
  norm(Array.from({ length: 9 }, (_, i) => ({ action: 'a' + i }))).length === 5);
check('normalize: need_id เป็นข้อความ "null" → null',
  norm([{ action: 'x', need_id: 'null' }])[0].need_id === null);
check('normalize: need_id จริงคงไว้',
  norm([{ action: 'x', need_id: 'n2' }])[0].need_id === 'n2');

// ── ชั้นแสดงผล (client) ────────────────────────────────────────────────────
const panelSrc = extract(CI, 'function _customerPanel(d) {', 'client', '\n  }\n');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(panelSrc + '\nthis.__p = _customerPanel;', ctx);
const panel = ctx.__p;

// shape ใหม่
const NEW = {
  headline: 'ร้านติดเรื่องเวลาส่งเช้าเกินไป และเปิดช่องให้เสนอหมวดเนื้อสัตว์เพิ่ม',
  ocpb_status: { O: 'answered', C: 'answered', P: 'not_asked', B: 'not_asked' },
  ocpb_facts: [{ dim: 'O', summary: 'ครัวเริ่ม 9 โมง', quote: 'เราเปิดครัวเก้าโมง', ts: '02:10', tag: 'pain_medium' }],
  needs: [
    { id: 'n1', need: 'อยากให้ส่งก่อน 8 โมง', type: 'delivery', intensity: 'explicit', status: 'open', implication: 'ถ้าไม่แก้ ลูกค้าจะสั่งเจ้าอื่นคู่ไปด้วย' },
    { id: 'n2', need: 'ราคาหมูแพงกว่าเจ้าเดิม', type: 'price', intensity: 'implied', inferred_from: 'พูดเปรยเรื่องต้นทุน', status: 'open' }
  ],
  unknowns: ['ตอนนี้ซื้อหมูจากใคร เดือนละเท่าไหร่'],
  progress_vs_last: [{ topic: 'เครดิต', before: '15 วัน', now: '30 วัน', verdict: 'คืบหน้า' }],
  next_actions: [
    { action: 'คุยรอบส่งใหม่กับทีมจัดส่ง', need_id: 'n1', priority: 1, owner: 'Sales', urgency: '3_days', reason: 'r' },
    { action: 'ทำใบเสนอราคาหมู', need_id: 'n2', priority: 2, owner: 'Sales', urgency: 'this_week' },
    { action: 'พาหัวหน้าไปเยี่ยม', need_id: null, priority: 3, owner: 'TL', urgency: 'next_visit' },
    { action: 'ส่งตัวอย่างผัก', priority: 4, owner: 'Sales', urgency: 'next_visit' }
  ]
};
const hNew = panel(NEW);
check('ใหม่: headline ขึ้นก่อนทุกอย่าง',
  hNew.indexOf('เปิดช่องให้เสนอหมวดเนื้อสัตว์') < hNew.indexOf('ทำอะไรต่อ'));
check('ใหม่: "ทำอะไรต่อ" มาก่อนแถบ OCPB',
  hNew.indexOf('ทำอะไรต่อ') < hNew.indexOf('เก็บข้อมูลครบแค่ไหน'));
check('ใหม่: แถบ OCPB มาก่อนรายละเอียดที่พับไว้',
  hNew.indexOf('เก็บข้อมูลครบแค่ไหน') < hNew.indexOf('สิ่งที่ควรถามครั้งหน้า'));
check('ใหม่: การ์ด action 3 ใบแรกกางอยู่ ที่เหลือพับ',
  hNew.indexOf('คุยรอบส่งใหม่') < hNew.indexOf('อีก 1 ข้อ') &&
  hNew.indexOf('อีก 1 ข้อ') < hNew.indexOf('ส่งตัวอย่างผัก'));
check('ใหม่: action ที่ผูก need แสดงเหตุผลจาก need จริง',
  /เพราะลูกค้าติดเรื่อง: อยากให้ส่งก่อน 8 โมง/.test(hNew));
check('ใหม่: บอกจำนวนมิติที่ยังไม่ได้ถาม (P, B = 2)', /ยังไม่ได้ถาม 2 มิติ/.test(hNew));
check('ใหม่: ไม่มีข้อความ action ซ้ำสองที่ในหน้าเดียว',
  (hNew.match(/คุยรอบส่งใหม่กับทีมจัดส่ง/g) || []).length === 1,
  'เจอ ' + (hNew.match(/คุยรอบส่งใหม่กับทีมจัดส่ง/g) || []).length + ' ครั้ง');
check('ใหม่: ไม่โผล่คำว่า "เกมที่ควรเดิน" (ของเก่าเท่านั้น)', !/เกมที่ควรเดิน/.test(hNew));
check('ใหม่: unknowns/needs/progress ยังอยู่ครบในส่วนที่พับ',
  /ซื้อหมูจากใคร/.test(hNew) && /ราคาหมูแพง/.test(hNew) && /เครดิต/.test(hNew));
check('ใหม่: ป้าย urgency ถูกต้อง', /ภายใน 3 วัน/.test(hNew) && /สัปดาห์นี้/.test(hNew) && /visit ถัดไป/.test(hNew));

// shape เก่า — ไม่มี headline / id / need_id / priority และยังมี suggested_action
const OLD = {
  ocpb_status: { O: 'answered', C: 'asked_no_answer' },
  ocpb_facts: [{ dim: 'O', summary: 'ร้านเปิด 7 วัน', tag: 'pain_high' }],
  needs: [{ need: 'ของมาไม่ครบบ่อย', type: 'operations', intensity: 'explicit', status: 'open', suggested_action: 'เช็ค fill rate ย้อนหลัง' }],
  unknowns: [],
  next_actions: [{ action: 'โทรตามของที่ขาด', owner: 'Sales', urgency: 'this_week' }]
};
const hOld = panel(OLD);
check('เก่า: ไม่พังเมื่อไม่มี headline — ปั้นจาก pain ที่แรงที่สุด', /ร้านเปิด 7 วัน/.test(hOld));
check('เก่า: action เดิมที่ไม่มี priority ยังขึ้น', /โทรตามของที่ขาด/.test(hOld));
check('เก่า: suggested_action ของแถวเก่ายังแสดงอยู่ ไม่ทำข้อมูลหาย', /เกมที่ควรเดิน: เช็ค fill rate/.test(hOld));
check('เก่า: chip "operations" อยู่ใน enum แล้ว (เดิมหลุดโชว์เป็นภาษาอังกฤษ)',
  /ปฏิบัติการ/.test(hOld) && !/>operations</.test(hOld));
check('เก่า: status "open" ขึ้นว่าค้างอยู่', /ค้างอยู่/.test(hOld));
check('เก่า: มิติที่ไม่มีข้อมูลเลยนับเป็นช่องว่าง (P, B)', /ยังไม่ได้ถาม 2 มิติ/.test(hOld));

// ว่างเปล่า / ข้อมูลพัง
check('ว่าง: ไม่มีอะไรเลย → ข้อความเดียว ไม่ใช่หน้าโล่ง',
  /ยังไม่มีข้อมูลลูกค้าจาก session นี้/.test(panel({})));
check('ว่าง: undefined ก็ไม่ throw', /ยังไม่มีข้อมูลลูกค้า/.test(panel(undefined)));
check('พัง: next_actions เป็น object ไม่ใช่ array ก็ไม่ throw',
  typeof panel({ next_actions: { action: 'x' }, ocpb_facts: [] }) === 'string');
check('พัง: needs มี null ปนก็ไม่ throw',
  typeof panel({ needs: [null, { need: 'a' }], next_actions: [] }) === 'string');

// TAGS map ที่ไม่มีใครใช้ต้องหายไป
check('เก็บกวาด: ลบ TAGS map ที่เป็น dead code แล้ว', !/pain_high:\s*\['pain · high'/.test(CI));

console.log('\n' + (fail ? '❌' : '✅') + ' verify_customer_panel: ผ่าน ' + pass + ' · ไม่ผ่าน ' + fail);
process.exit(fail ? 1 : 0);
