#!/usr/bin/env node
// tools/verify_transcript_gap_retry.js — v_transcribegap (2026-08-20)
//
// บุชขอให้เทียบเสียงจริงกับผล analyze ของ session ยาวๆ ("30-40 นาที แต่สรุปเหลือ
// แค่ 1-2 ประเด็น") — ไล่จริงพบว่าไม่ใช่ปัญหาการสรุปสั้นเกินไป แต่เป็นเพราะ
// Groq Whisper บางครั้งตอบ 200 OK แต่ transcript หยุดกลางคันเงียบๆ ก่อนถึงขั้น
// analyze ด้วยซ้ำ — สุ่มดู 20 session ยาว (whisper_fallback) เจอ 3 ใน 20 (15%)
// ที่ท่อนสุดท้ายจบก่อนความยาวคลิปจริงเกิน 10% หนักสุด 37% (2501 วิ เหลือ 1570 วิ)
//
// แก้: เทียบ timestamp ท่อนสุดท้ายกับ duration_secs จริง ถ้าขาดเกินเกณฑ์ ลองใหม่
// "ครั้งเดียว" (ไม่ใช่ 3 — ผูกกับบทเรียน 12 ส.ค. ว่าโควตา Groq คิดเป็นวินาทีเสียง
// ไม่ใช่จำนวนคำขอ ยิงซ้ำเกินจำเป็นเผาโควตาทั้ง batch) แล้วเลือกผลที่ครอบคลุมกว่า
//
// Usage: node tools/verify_transcript_gap_retry.js

const fs = require('fs');
const path = require('path');

const WK = fs.readFileSync(path.join(__dirname, '..', 'worker', 'freshket-sense-ai-proxy-v2.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

console.log('── v_transcribegap: จับ transcript ที่ Groq ตัดจบก่อนความยาวคลิปจริง ──');

const fnStart = WK.indexOf('async function runTranscribe(');
// ระยะคงที่ 8000 ตัวอักษร — ครอบคลุมถึงหลัง groqData retry logic แน่นอน
// (เดิมหา boundary ด้วยข้อความ "Step 2" แต่ตัวขีดในคอมเมนต์จริงไม่ตรงกับ
// สตริงในไฟล์นี้เป๊ะ ระยะคงที่แข็งแรงกว่า ไม่ผูกกับตัวอักษรที่เดาไม่ได้)
const fnBody = fnStart > -1 ? WK.slice(fnStart, fnStart + 8000) : '';
check('ดึงเนื้อ runTranscribe ออกมาได้', !!fnBody);

check('มีเกณฑ์ตัดสิน: อย่างน้อย 60 วิ หรือ 10% ของความยาวคลิป แล้วแต่ค่าไหนมากกว่า',
  /GROQ_GAP_FLOOR_SEC = 60/.test(fnBody) && /GROQ_GAP_RATIO = 0\.10/.test(fnBody) &&
  /Math\.max\(GROQ_GAP_FLOOR_SEC, \(duration_secs \|\| 0\) \* GROQ_GAP_RATIO\)/.test(fnBody));

check('เทียบจาก segment สุดท้ายจริง (end time) ไม่ใช่จำนวน segment',
  /function _lastSegEnd\(gd\)/.test(fnBody) &&
  /Math\.max\(\.\.\.segs\.map\(s => s\.end \|\| 0\)\)/.test(fnBody));

check('ลองใหม่ "ครั้งเดียว" เท่านั้น — ไม่มีลูป ไม่เรียกซ้ำเกิน 1 ครั้ง',
  (() => {
    // ต้องมี fetch สำหรับรอบ retry อีกแค่ 1 ครั้ง (รวมของเดิมในฟังก์ชันนี้ = 2 จุด
    // fetch ทั้งหมด: รอบแรกใน withRetry + รอบสองตรงนี้ — ไม่ใช่ลูป while/for)
    const retrySection = fnBody.slice(fnBody.indexOf('_firstGap > _gapThreshold'));
    return !/while\s*\(|for\s*\(/.test(retrySection.slice(0, 800)) &&
           (retrySection.match(/fetch\('https:\/\/api\.groq\.com/g) || []).length === 1;
  })());

check('เลือกผลที่ครอบคลุมมากกว่า (gap น้อยกว่า) ไม่ใช่เชื่อรอบสองเสมอ',
  /if \(_retryGap < _firstGap\) \{/.test(fnBody) && /groqData = retryData;/.test(fnBody));

check('รอบสอง fetch ล้มเหลว/เครือข่ายพัง ต้องไม่ทำให้ทั้ง session พัง (ใช้ผลรอบแรกต่อ)',
  /catch \(e\) \{\s*\n\s*console\.warn\('\[transcribe\] ลองใหม่รอบสองล้มเหลว/.test(fnBody));

console.log('\n' + (fail ? `❌ verify_transcript_gap_retry: ผ่าน ${pass} · ไม่ผ่าน ${fail}` : `✅ verify_transcript_gap_retry: ผ่าน ${pass} · ไม่ผ่าน 0`));
process.exit(fail ? 1 : 0);
