#!/usr/bin/env node
// tools/verify_pwa_crash_animation.js — v_pwacrash (2026-08-20)
//
// บุชรายงาน: หลังกดปุ่ม AI summary ต่างๆ ตัว PWA เด้งออกและปิดตัวทันที บนมือถือ
// จริง (เป็นมาตั้งแต่ก่อนรอบแก้ JSON truncation — คนละบั๊กกัน)
//
// เจอ animation `kam-star-breathe` (#kam-loading2 ตอน generateKamBriefing /
// generateLastMonthSummary กำลังรอ AI ตอบ) ซ้อน drop-shadow 3 ชั้น (บลอร์สูงสุด
// 48px) พร้อม transform:scale+rotate วนทุก 2 วิ "ไม่มีที่สิ้นสุด" ตลอดเวลาที่รอ
// AI — animate `filter` พร้อม transform บังคับ WebKit ต้อง re-raster ทุกเฟรม
// (cache bitmap เดิมไว้ไม่ได้เพราะ transform เปลี่ยนตลอด) เป็นสาเหตุที่รู้จักกันดี
// ว่าทำให้ WKWebView โดน iOS ฆ่าทิ้งเมื่อภาระ GPU สูงต่อเนื่องนานๆ — ยิ่งนานยิ่งเสี่ยง
// (ก่อนแก้ chain retry เดิมอาจค้าง 10-20+ วิ = animation วิ่งนานกว่าที่ควรมาก)
//
// ⚠ นี่คือสมมติฐานจากการอ่านโค้ด ยังไม่ได้ยืนยันบนเครื่องจริงของบุช — ล็อกไว้กัน
// การถอยกลับไปใช้ effect หนักแบบเดิมโดยไม่ได้ตั้งใจ ไม่ใช่การปิดเคสว่าแก้จบแล้ว
//
// Usage: node tools/verify_pwa_crash_animation.js

const fs = require('fs');
const path = require('path');

const CSS_LAYOUT = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles_layout.css'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

console.log('── PWA crash risk: kam-star-breathe ต้องไม่ซ้อน filter หนักระหว่าง AI คิด ──');

const m = CSS_LAYOUT.match(/@keyframes kam-star-breathe\{([\s\S]*?)\n\}/);
check('ดึง @keyframes kam-star-breathe ออกมาได้', !!m);

if (m) {
  const body = m[1];
  const dropShadowCounts = (body.match(/drop-shadow\(/g) || []).length;
  check('แต่ละ keyframe มี drop-shadow ชั้นเดียว ไม่ซ้อนหลายชั้น (เดิมซ้อนถึง 3 ชั้นที่ peak)',
    dropShadowCounts <= 2, `เจอ ${dropShadowCounts} ครั้งทั้ง block (คาดว่า ≤2 = 1 ต่อ keyframe)`);

  const blurRadii = [...body.matchAll(/drop-shadow\(0 0 (\d+)px/g)].map(x => parseInt(x[1], 10));
  const maxBlur = blurRadii.length ? Math.max(...blurRadii) : 0;
  check('บลอร์สูงสุดไม่เกิน 12px (เดิม peak ที่ 48px)',
    maxBlur > 0 && maxBlur <= 12, `บลอร์สูงสุดที่เจอ: ${maxBlur}px`);
}

console.log('\n' + (fail ? `❌ verify_pwa_crash_animation: ผ่าน ${pass} · ไม่ผ่าน ${fail}` : `✅ verify_pwa_crash_animation: ผ่าน ${pass} · ไม่ผ่าน 0`));
process.exit(fail ? 1 : 0);
