#!/usr/bin/env node
// tools/verify_ears_prompt.js — v_ears (2026-08-14)
//
// ล็อกการแก้ 3 อย่างที่ทำให้ transcript แม่นขึ้น โดยไม่เปลี่ยนโมเดล:
//
//   1. Whisper prompt ต้องไม่เป็นประโยค — Whisper ตีความ prompt ว่าเป็น
//      "บทที่ถอดมาก่อนหน้า" แล้วเขียนต่อ · prompt เดิมเขียนเป็นประโยคเต็ม
//      จึงคายกลับมาเป็นบทพูด · วัดจริง: 60 ท่อน / 16 จาก 52 session
//      และ 17 ท่อนได้ conf > 0.8 = ตัววัดความมั่นใจจับไม่ได้
//   2. ต้องมีตะแกรงกรอง prompt ที่รั่วออกก่อนเก็บลง DB (ชั้นสองแบบตายตัว)
//   3. Gemini ต้องแก้คำได้ แต่เฉพาะท่อนที่ Whisper ไม่มั่นใจ และต้องเก็บ
//      ต้นฉบับไว้เสมอ — ของเดิมสั่ง "ห้ามแก้ text" = ทิ้งหูที่ดีกว่าไปเปล่าๆ
//
// Usage: node tools/verify_ears_prompt.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WK = fs.readFileSync(path.join(__dirname, '..', 'worker', 'freshket-sense-ai-proxy-v2.js'), 'utf8');
const CI = fs.readFileSync(path.join(__dirname, '..', 'src', '09_conv_intel.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

console.log('\n── 1. Whisper prompt: รายการคำ ไม่ใช่ประโยค ──');

check('prompt สร้างจาก array แล้ว join ไม่ใช่ประโยคสำเร็จรูป',
  /const promptParts = \[/.test(WK) && /promptParts\.join\(' '\)/.test(WK));

check('ไม่เหลือ prompt แบบประโยคเดิม ("บทสนทนาภาษาไทยระหว่าง…")',
  !/บทสนทนาภาษาไทยระหว่างพนักงานขาย Freshket \(วัตถุดิบอาหาร\)/.test(WK),
  'ประโยคเต็มคือสิ่งที่ชวนให้ Whisper เขียนต่อ');

check('ไม่มีวลีชี้นำแบบ "อาจมีคำว่า" หลงเหลือใน prompt',
  !/อาจมีคำว่า/.test(WK));

check('temperature=0 (เลิกไล่ temperature ขึ้นตอน decode ไม่ผ่าน)',
  /groqForm\.append\('temperature', '0'\)/.test(WK));

console.log('\n── 2. glossary ชื่อสินค้ารายร้าน (ของที่มีอยู่แล้วแต่ไม่เคยใช้) ──');

check('client มีตัวสร้าง glossary จาก bulkSkusData',
  /function _skuGlossaryFor\(/.test(CI) && /bulkSkusData\[accountGuid\]/.test(CI));

check('glossary คุมความยาว (Whisper ตัดหัวเงียบๆ ที่ 224 token)',
  /SKU_GLOSSARY_MAX_CHARS/.test(CI));

check('glossary เรียงตาม GMV — คำที่พูดถึงบ่อยได้ที่ก่อน',
  /sort\(\(a, b\) => \(b\.gmv \|\| 0\) - \(a\.gmv \|\| 0\)\)/.test(CI));

check('client เขียน sku_glossary ลง DB ทั้ง update และ insert',
  (CI.match(/sku_glossary:\s*ctx\.skuGlossary/g) || []).length === 2);

check('worker อ่าน sku_glossary จากแถว (เส้น cron) และจาก body (เส้น HTTP)',
  /select=id,owner_email,owner_type,account_id,account_name,sku_glossary/.test(WK) &&
  /const \{ audio_b64, mime_type, duration_secs, account_name, sku_glossary \}/.test(WK));

check('glossary ถูกใส่เข้า prompt จริง ไม่ใช่รับมาแล้วทิ้ง',
  /promptParts\.push\(safeGlossary\)/.test(WK));

console.log('\n── 3. ตะแกรงกรอง prompt ที่รั่ว ──');

check('มีตัวตรวจ prompt echo',
  /_looksLikePromptEcho/.test(WK));

check('กรองด้วยสัดส่วนคำที่ทับกับ prompt ไม่ใช่เทียบสตริงตรงๆ',
  /hits \/ words\.length\) >= 0\.6/.test(WK),
  'เทียบตรงๆ จับไม่ได้ เพราะ Whisper คายออกมาปนกับคำอื่น');

check('กันวลี hallucination คลาสสิกของ Whisper ด้วย',
  /โปรดติดตามตอนต่อไป/.test(WK));

check('ตัดออกก่อนเก็บลง DB (อยู่ใน filter ของ rawSegs)',
  /if \(_looksLikePromptEcho\(txt\)\) \{ _echoDropped\+\+; return false; \}/.test(WK));

// รันตัวกรองจริงด้วยข้อความจากของจริง
{
  const src = WK.slice(WK.indexOf('function _looksLikePromptEcho'), WK.indexOf('let _echoDropped'));
  const ctx = { dynamicPrompt: 'Freshket ออเดอร์ เครดิต วางบิล ใบเสนอราคา กิโล ลัง มะม่วงน้ำดอกไม้ อะโวคาโด' };
  vm.createContext(ctx);
  vm.runInContext(`
    const _promptWords = new Set(dynamicPrompt.toLowerCase().split(/[\\s,]+/).filter(w => w.length >= 3));
    const _HALLUCINATION_PHRASES = ['โปรดติดตามตอนต่อไป','ขอบคุณที่รับชม','subscribe'];
    ${src}
    this.__f = _looksLikePromptEcho;
  `, ctx);
  const f = ctx.__f;

  // ข้อความจริงจาก DB (session bd3d48a1 นาที 14:46 conf 0.94)
  check('รัน: ท่อนที่เป็น prompt ล้วน → ตัดทิ้ง',
    f('Freshket ออเดอร์ เครดิต วางบิล ใบเสนอราคา กิโล ลัง') === true);
  check('รัน: hallucination "โปรดติดตามตอนต่อไป" → ตัดทิ้ง',
    f('โปรดติดตามตอนต่อไป') === true);
  check('รัน: ประโยคลูกค้าจริงที่มีชื่อสินค้าปน → **ต้องเก็บไว้**',
    f('ตัวสเปคคืออยากให้มะม่วงน้ำดอกไม้มันหวาน ไม่อยากให้เปรี้ยว') === false,
    'ถ้าตัดอันนี้ทิ้งคือ false positive — อันตรายกว่าปล่อยขยะผ่าน');
  check('รัน: ท่อนสั้นมาก → ไม่ตัด (ข้อมูลไม่พอตัดสิน)',
    f('ครับ ได้') === false);
}

console.log('\n── 4. Gemini แก้คำได้ แต่มีขอบเขต ──');

// ตรวจเฉพาะตัว prompt ที่ส่งให้โมเดลจริง — ไม่ใช่ทั้งไฟล์ เพราะคอมเมนต์
// อธิบายที่มาก็อ้างถึงข้อความเดิมด้วย (เจอตอนเขียน harness นี้เอง)
const DIARIZE_PROMPT = WK.slice(
  WK.indexOf('const diarizePrompt = `ฟัง audio แล้วทำ 2 อย่าง'),
  WK.indexOf('let diarized = false')
);
check('ดึงตัว diarize prompt ออกมาตรวจได้', DIARIZE_PROMPT.length > 200);
check('ตัว prompt จริงเลิกสั่ง "ห้ามแก้ text" แล้ว',
  !/ห้ามแก้ text/.test(DIARIZE_PROMPT));
check('แต่ยังห้ามเพิ่ม/ลบ segment อยู่ (จำนวนท่อนต้องตรงกับ Whisper)',
  /ห้ามเพิ่ม\/ลบ segment/.test(DIARIZE_PROMPT));

check('แก้ได้เฉพาะท่อนที่ Whisper ไม่มั่นใจ (มีเกณฑ์เป็นค่าคงที่)',
  /LOW_CONF_EDIT_THRESHOLD/.test(WK));

check('prompt ติดป้าย (ไม่ชัด) ให้ Gemini รู้ว่าท่อนไหนแก้ได้',
  /\(ไม่ชัด\)/.test(WK));

check('prompt สั่งห้ามเดาจากบริบท — ต้องมั่นใจจากเสียงจริง',
  /ห้ามเดาจากบริบท/.test(WK));

check('ฝั่งรับผลบังคับเกณฑ์ซ้ำ ไม่เชื่อโมเดลอย่างเดียว',
  /s\.transcript_confidence < LOW_CONF_EDIT_THRESHOLD/.test(WK),
  'โมเดลอาจส่ง corrected_text ของท่อนที่ไม่เข้าเกณฑ์มาด้วย');

check('เก็บต้นฉบับไว้เสมอ (text_original) + ตีตรา corrected',
  /s\.text_original = s\.text/.test(WK) && /s\.corrected = true/.test(WK));

console.log('\n' + (fail ? `❌ verify_ears_prompt: ผ่าน ${pass} · ไม่ผ่าน ${fail}` : `✅ verify_ears_prompt: ผ่าน ${pass} · ไม่ผ่าน 0`));
process.exit(fail ? 1 : 0);
