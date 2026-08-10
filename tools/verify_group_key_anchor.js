#!/usr/bin/env node
// tools/verify_group_key_anchor.js — v_anchor (2026-08-08)
//
// ล็อกว่า "ชื่อกลุ่มสินค้า" ที่ใช้คิดค่าคอมฯ ถูกตรึงไว้ที่หมวด ณ ต้นไตรมาส
//
// ทำไมต้องมี: ต้นทาง dwh.order.item.item_family จัดหมวดใหม่กลางไตรมาส — วัดได้
// 2,030 สินค้า GMV ฿274M ในช่วง เม.ย.–ก.ค. และครึ่งหนึ่งย้ายแล้วย้ายกลับ (taxonomy
// ยังแกว่ง) · q3c เดิมใช้ item_family ดิบเป็น group_key → สินค้าตัวเดียวถูกนับคนละ
// คีย์ในคนละเดือน → กลุ่มใหม่ "เกิดกลางไตรมาส" มีฐานแค่เศษเดียว → ผ่าน P3 ง่ายเกินจริง
//   เคสพิสูจน์: Status Airport 223070 กลุ่ม 'หนัง /ไขมันไก่'
//   ระบบเห็นฐาน มิ.ย. 8,320 (2.47x ผ่าน จ่าย ฿182.85) · จริง 14,080 (1.46x ไม่ผ่าน)
//   ผลรวม P3 งวด ก.ค.: 45 แถวพลิก · จ่ายเกิน ฿6,107 · จ่ายขาด ฿3,939 · สุทธิ +฿2,168
//
// บุชเคาะ: ยึด "หมวด ณ จุดเริ่มต้น" (มะนาวแป้น เบอร์ 400 ก็คงเป็นมะนาวแป้น เบอร์ 400)
// ไม่ใช่หมวดที่เปลี่ยนใหม่ — เพราะเดือนฐานคือสิ่งที่ใช้ตั้งเป้าให้ rep ต้นไตรมาส
//
// สิ่งที่ล็อก: ทั้ง 3 ไฟล์ที่กระทบเงินต้องใช้นิยาม anchor เดียวกัน ถ้าไฟล์ใดไฟล์หนึ่ง
// หลุด ตัวเลข KAM กับตัวคูณ TL กับเรตรายหมวดจะขัดกันเองโดยไม่มีใครรู้
//
// Usage: node tools/verify_group_key_anchor.js

const fs = require('fs');
const path = require('path');

// 3 ไฟล์ที่กระทบเงินจริง — ต้องแก้พร้อมกัน
const FILES = [
  ['q3c_upsell_bulk_all_kams_v4.sql', 'bundle P1/P3 ราย KAM (แอปอ่านไฟล์นี้)'],
  ['q3c_upsell_team_summary_v4.sql',  'ตัวคูณ upsell ของ TL'],
  ['q3c_upsell_team_groups_v1.sql',   'map เรตโบนัสรายหมวด'],
];

let fail = 0, pass = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}

console.log('── group_key ต้องตรึงที่หมวด ณ ต้นไตรมาส ──');

const src = {};
for (const [f] of FILES) {
  src[f] = fs.readFileSync(path.join(__dirname, '..', 'sql', f), 'utf8');
}

for (const [f, what] of FILES) {
  const s = src[f];
  console.log(`\n[${f}] — ${what}`);

  // 1. ต้องมี CTE anchor
  check('มี CTE item_anchor', /item_anchor AS \(/.test(s));

  // 2. anchor ต้องเลือกจากเดือนแรกสุด และตัดสินเสมอด้วย GMV (ไม่งั้นรันสองครั้งได้คนละคำตอบ)
  check('anchor เลือกเดือนแรกสุด + ตัดสินเสมอด้วย GMV',
    /ROW_NUMBER\(\) OVER \(PARTITION BY item_id ORDER BY mo ASC, gmv DESC\)/.test(s),
    'ต้องเป็น ORDER BY mo ASC, gmv DESC เป๊ะ ไม่งั้นผลไม่นิ่ง');

  // 3. item_id เป็น NULL ได้ — ห้ามให้ join หลุดแล้ว GMV หายเงียบ (ซ้ำรอยบั๊กเดิม)
  check('กัน item_id NULL ด้วย COALESCE (ห้ามให้ GMV หายเงียบ)',
    /COALESCE\(ia\.grp_anchor,/.test(s));

  // 4. ห้ามเหลือ item_family ดิบเป็น group_key ที่ไหนอีก — ยกเว้นใน CTE ที่สร้าง anchor เอง
  // CASE ดิบยังต้องมีอยู่ 2 ที่เท่านั้น: (ก) ใน anchor_src ที่สร้าง anchor เอง
  // (ข) เป็น fallback ใน COALESCE(ia.grp_anchor, …) กันเคส item_id เป็น NULL
  // ถ้ามีที่ไหนใช้ CASE ดิบลอยๆ = จุดนั้นยังคิดกลุ่มแบบเก่า ตัวเลขจะขัดกันเอง
  const rawUses = (s.match(/THEN i\.item_family ELSE i\.subclass_name/g) || []).length;
  const anchorBlock = s.slice(s.indexOf('item_anchor_src AS ('), s.indexOf('item_anchor AS ('));
  const rawInAnchor = (anchorBlock.match(/THEN i\.item_family ELSE i\.subclass_name/g) || []).length;
  const wrapped = (s.match(/COALESCE\(ia\.grp_anchor,/g) || []).length;
  check('ไม่เหลือ item_family ดิบลอยๆ (มีได้แค่ใน anchor_src กับ fallback ของ COALESCE)',
    rawUses > 0 && rawInAnchor > 0 && rawUses === rawInAnchor + wrapped,
    `ดิบ ${rawUses} · ใน anchor_src ${rawInAnchor} · ห่อ COALESCE ${wrapped} → ลอยๆ ${rawUses - rawInAnchor - wrapped}`);
}

// 5. นิยาม anchor ต้องเป็นข้อความเดียวกันทุกไฟล์ (กันแก้ไม่ครบ)
console.log('\n[ข้ามไฟล์]');
const norm = s => {
  const i = s.indexOf('item_anchor AS (');
  if (i < 0) return null;
  const end = s.indexOf('\n),', i);
  return end < 0 ? null : s.slice(i, end).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
};
const defs = FILES.map(([f]) => [f, norm(src[f])]);
const base = defs[0][1];
// เทียบเฉพาะบล็อก item_anchor (ตรรกะตัดสิน) — anchor_src ต่างกันได้เพราะสองไฟล์
// เป็น script style ใช้ตัวแปรวันที่คนละชื่อ (v_lookback_start vs d.lookback_start)
check('ตรรกะตัดสิน item_anchor เหมือนกันเป๊ะทั้ง 3 ไฟล์',
  base !== null && defs.every(([, d]) => d === base),
  defs.filter(([, d]) => d !== base).map(([f]) => f).join(', ') || 'ดึงนิยามไม่ได้');

// 6. หน้าต่างของ anchor ต้องคลุมทั้ง lookback และเดือนปัจจุบัน ไม่งั้นของบางเดือนไม่มี anchor
// bulk ใช้ CTE dates (d.lookback_start) · อีกสองไฟล์เป็น script ใช้ตัวแปร v_lookback_start
check('หน้าต่าง anchor เริ่มที่ lookback_start (คลุมทั้งไตรมาส)',
  FILES.every(([f]) => /[dv][._]lookback_start/.test(
    src[f].slice(src[f].indexOf('item_anchor_src AS ('), src[f].indexOf('item_anchor AS ('))
  )), 'anchor ต้องสแกนตั้งแต่ต้น pool ฐาน ไม่ใช่แค่เดือนปัจจุบัน');

console.log('\n' + (fail ? '❌' : '✅') +
  ' verify_group_key_anchor: ผ่าน ' + pass + ' · ไม่ผ่าน ' + fail);
process.exit(fail ? 1 : 0);
