#!/usr/bin/env node
// tools/verify_kam_brief_ai.js — v_thinkfix (2026-08-20)
//
// บั๊กจริง: บุชรายงานว่า "AI insight ใน Sense กดแล้วมี animation แต่ไม่มีอะไร
// คายออกมา" — ไล่จนถึงต้นเหตุจริง (ไม่ใช่แค่ทฤษฎี รันจริงบน production แล้วเห็น
// error ตรงๆ):
//
//   1. Anthropic (Claude) ล่มอยู่ (เครดิตหมด ตามที่เคยเจอ 2026-08-12) → worker
//      ข้ามไป Gemini ตามดีไซน์ v_xfall ที่มีอยู่แล้ว (ทำงานถูกต้อง ไม่ใช่บั๊ก)
//   2. Gemini 3.x "คิดในใจ" ก่อนตอบ กินโควตา maxOutputTokens เกือบหมด — prompt
//      ที่ยาว + ขอ JSON หลาย field (เช่น KAM Brief) เหลือที่ให้ตอบจริงแค่
//      ~150 token ได้ field เดียวแล้วขาดกลางประโยค JSON ไม่ปิดวงเล็บ
//   3. worker เช็คแค่ "!text" ก่อนตัดสินว่าสำเร็จ — text ไม่ว่าง (มี field แรก
//      อยู่) จึงถือว่า ok:true ทั้งที่ finishReason=MAX_TOKENS
//   4. client (generateKamBriefing/generateLastMonthSummary) brace-scan หา
//      "{...}" ที่ปิดสมบูรณ์ ไม่เจอ (เพราะขาด) → throw ทันที
//   5. catch block เดิมมีแค่ console.error — ปุ่มรีเซ็ตกลับ "Brief" เฉยๆ
//      ไม่มีอะไรบอกผู้ใช้เลย = ตรงกับอาการที่บุชเห็นเป๊ะ
//
// แก้ 3 ชั้น (แต่ละชั้นลดโอกาส/ความเสียหายของปัญหาเดียวกัน ไม่ใช่ patch เดียว):
//   A. worker: ยกพื้น maxOutputTokens 2048→4096 (verify_ai_proxy_contract.js)
//      + ถือว่า finishReason=MAX_TOKENS เป็นความล้มเหลว ให้ไล่ chain ต่อ
//      (verify_ai_proxy_contract.js เช่นกัน)
//   B. client: ถ้าวงเล็บไม่ปิด ให้ลองกู้ field ที่สมบูรณ์ด้วย regex ก่อน (ของเดิม
//      มี regex กู้อยู่แล้วใน generateKamBriefing แต่ไปไม่ถึงเพราะเช็ควงเล็บตัด
//      จบก่อน — ย้ายเช็คเข้าไปในนี้แทน) — เพิ่ม regex เดียวกันให้
//      generateLastMonthSummary ด้วย (เดิมไม่มี salvage เลย)
//   C. client: catch สุดท้ายต้อง toast ให้เห็นเสมอ ไม่ปล่อยเงียบอีก
//
// Usage: node tools/verify_kam_brief_ai.js

const fs = require('fs');
const path = require('path');

const KV = fs.readFileSync(path.join(__dirname, '..', 'src', '05_kam_view.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

function fn(src, name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) return null;
  // ตัดที่ฟังก์ชันถัดไปเริ่ม (บรรทัดที่ขึ้นต้นด้วย async function ใหม่ในคอลัมน์ 0)
  const rest = src.slice(i + 1);
  const m = rest.match(/\nasync function [A-Za-z_]/);
  return src.slice(i, m ? i + 1 + m.index : src.length);
}

console.log('── KAM Brief AI: ไม่ปล่อย JSON ที่ถูกตัดกลางคันหายไปเงียบๆ ──');

const kb = fn(KV, 'generateKamBriefing');
const lm = fn(KV, 'generateLastMonthSummary');
check('ดึง generateKamBriefing ออกมาได้', !!kb);
check('ดึง generateLastMonthSummary ออกมาได้', !!lm);

if (kb) {
  check('generateKamBriefing: ไม่ throw ทันทีถ้าวงเล็บไม่ปิด (ให้ไปกู้ด้วย regex ก่อน)',
    /const _slice=\(st>-1&&en>-1\)\?txt\.slice\(st,en\+1\):\(st>-1\?txt\.slice\(st\):txt\);/.test(kb) &&
    /if\(st===-1\|\|en===-1\)throw new Error\('No JSON in response'\);/.test(kb),
    'ต้องมีทั้ง _slice ที่ไม่พึ่ง en เสมอ และ throw ที่ย้ายเข้ามาอยู่ใน try แล้ว');
  check('generateKamBriefing: มี regex กู้ field รายตัว (paceInsight/skuInsight/costInsight/summary)',
    /_rx\('paceInsight'\)/.test(kb) && /_rx\('skuInsight'\)/.test(kb) &&
    /_rx\('costInsight'\)/.test(kb) && /_rx\('summary'\)/.test(kb));
  check('generateKamBriefing: catch สุดท้ายต้อง toast ให้เห็น ไม่ใช่แค่ console.error',
    // ระยะห่าง 400 ตัวอักษร เผื่อคอมเมนต์อธิบายเหตุผลระหว่างสองบรรทัด (เจอพังมาแล้ว
    // ในไฟล์อื่นของ session นี้ตอนคอมเมนต์เบียดระยะจน [\s\S]{0,N} เดิมไม่พอ)
    /console\.error\('KAM briefing error:',e\);[\s\S]{0,400}showToast\(/.test(kb));
}

if (lm) {
  check('generateLastMonthSummary: ไม่ throw ทันทีถ้าวงเล็บไม่ปิด (เหมือน generateKamBriefing)',
    /const _slice=\(st>-1&&en>-1\)\?txt\.slice\(st,en\+1\):\(st>-1\?txt\.slice\(st\):txt\);/.test(lm));
  check('generateLastMonthSummary: มี regex กู้ field รายตัว (ของเดิมไม่มี salvage เลย)',
    /_rx\('gmvInsight'\)/.test(lm) && /_rx\('outletInsight'\)/.test(lm) &&
    /_rx\('skuInsight'\)/.test(lm) && /_rx\('costInsight'\)/.test(lm) && /_rx\('summary'\)/.test(lm));
  check('generateLastMonthSummary: catch สุดท้ายต้อง toast ให้เห็น',
    /console\.error\('Last month summary error:',e\);[\s\S]{0,200}showToast\(/.test(lm));
}

// เคสจริงที่ต้องไม่ regress: ยังต้องรับ JSON ปกติ (ไม่ถูกตัด) ได้เหมือนเดิม —
// ตรวจว่า path ปกติ (JSON.parse(_slice) ตรงๆ) ยังอยู่ ไม่ได้ถูกแทนที่ทั้งหมด
// ด้วย regex salvage (regex ควรเป็นทางสำรองเท่านั้น)
check('generateKamBriefing: ทางหลักยังเป็น JSON.parse(_slice) ตรงๆ ก่อนถอยไป regex',
  !!kb && /brief=JSON\.parse\(_slice\);/.test(kb));
check('generateLastMonthSummary: ทางหลักยังเป็น JSON.parse(_slice) ตรงๆ ก่อนถอยไป regex',
  !!lm && /brief=JSON\.parse\(_slice\);/.test(lm));

console.log('\n' + (fail ? `❌ verify_kam_brief_ai: ผ่าน ${pass} · ไม่ผ่าน ${fail}` : `✅ verify_kam_brief_ai: ผ่าน ${pass} · ไม่ผ่าน 0`));
process.exit(fail ? 1 : 0);
