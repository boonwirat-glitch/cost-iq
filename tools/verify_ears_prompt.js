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

console.log('\n── 2b. เพดานความยาว prompt ต้องนับเป็น "ไบต์" ไม่ใช่ตัวอักษร ──');
//
// เหตุจริง 14 ส.ค. 2026: การอัด 2 คลิปตายด้วย
//   400 "prompt length must be 896 characters or fewer, provided 932/980"
// ทั้งที่โค้ดคุมไว้ 260+60+300 ตัวอักษร ซึ่ง "ผ่าน" ถ้านับเป็นตัวอักษร
// → Groq วัดเป็นไบต์ UTF-8 และภาษาไทยกิน 3 ไบต์ต่อตัว
// harness เดิมเช็คแค่ "มีการคุมความยาว" จึงจับไม่ได้ นี่คือข้อที่อุดรูนั้น

check('worker มี helper วัดไบต์ (ไม่ใช่ .length)',
  /function _utf8Bytes\(/.test(WK) && /new TextEncoder\(\)\.encode/.test(WK));

check('มีตัวตัดตามไบต์ _clampBytes และเลิกใช้ slice นับตัวอักษรกับ glossary',
  /function _clampBytes\(/.test(WK) &&
  !/String\(skuGlossary \|\| ''\)\.trim\(\)\.slice\(/.test(WK),
  'slice(0,300) คือบรรทัดที่ทำให้ 14 ส.ค. ล่ม');

check('เพดาน prompt ตั้งต่ำกว่า 896 ที่ Groq บังคับ',
  /const GROQ_PROMPT_MAX_BYTES = (\d+)/.test(WK) &&
  Number(WK.match(/const GROQ_PROMPT_MAX_BYTES = (\d+)/)[1]) <= 896);

check('เกินเพดานแล้วต้องตัด glossary ทิ้งแล้วยิงต่อ ไม่ปล่อยให้ทั้งคำขอตาย',
  /prompt ยังเกินหลังตัด glossary/.test(WK));

// รันของจริง: ประกอบ prompt แบบเดียวกับ worker ด้วย glossary ที่ทำให้ล้มจริง
{
  const src = WK.slice(WK.indexOf('function _utf8Bytes'), WK.indexOf('const GROQ_MAX_AUDIO_BYTES'));
  const c = {};
  vm.createContext(c);
  vm.runInContext(`const TextEncoder = this.TextEncoder;\n${src}\nthis.API={_utf8Bytes,_clampBytes};`,
    Object.assign(c, { TextEncoder }));
  const { _utf8Bytes, _clampBytes } = c.API;

  const MAX = Number(WK.match(/const GROQ_PROMPT_MAX_BYTES = (\d+)/)[1]);
  // glossary จริงจาก session 843d66eb (ตัวที่ตายด้วย 932) และ 4aa561b4 (980)
  const GLOSS_REAL = 'ไข่ไก่ เบอร์ 3 ตราเบทาโกร สันนอกหมู ตัดแต่ง สะโพกไก่ เนื้อไหล่หมู ตัดแต่ง '
    + 'ต้นหอมไทย คัดสวย ผงเจลาติน ตราแม็กกาแรต วุ้นเส้น ตราต้นสน ซอสฝาแดง ตราเด็กสมบูรณ์ '
    + 'พริกขี้หนูสวน มะนาวแป้น เบอร์ 40 กระเทียมจีนปอกเปลือก โครงไก่ เบียร์ขวดเล็ก ตราคิริน';
  const ACCT_REAL = 'ร้านอาหารสาขาสยามพารากอน ชั้น 4 โซนอาหารไทย';

  check('รัน: ข้อความไทยล้วน 1 ตัวอักษร = 3 ไบต์ (สมมติฐานที่ทำให้พลาด)',
    _utf8Bytes('ก') === 3 && 'ก'.length === 1);

  // ประกอบแบบเดียวกับ worker
  const parts = ['Freshket', 'ออเดอร์', 'เครดิต', 'วางบิล', 'ใบเสนอราคา', 'กิโล', 'ลัง'];
  parts.push(_clampBytes(ACCT_REAL, 120));
  const budget = MAX - _utf8Bytes(parts.join(' ')) - 1;
  const gl = budget > 30 ? _clampBytes(GLOSS_REAL, budget) : '';
  if (gl) parts.push(gl);
  const prompt = parts.join(' ');

  check(`รัน: prompt จาก glossary ตัวจริง = ${_utf8Bytes(prompt)} ไบต์ ต้อง ≤ ${MAX}`,
    _utf8Bytes(prompt) <= MAX,
    `ของเดิมได้ 932-1,012 ไบต์ = โดน Groq ปฏิเสธทั้งคำขอ`);
  check('รัน: prompt ยังต่ำกว่าเพดานจริงของ Groq (896) แน่นอน',
    _utf8Bytes(prompt) <= 896);
  check('รัน: ยังเหลือชื่อร้านกับคำเฉพาะอยู่ (ตัด glossary ก่อน ไม่ตัดของสำคัญ)',
    prompt.includes('Freshket') && prompt.includes('ใบเสนอราคา') && prompt.includes('สยามพารากอน'));
  check('รัน: _clampBytes ไม่ตัดกลางตัวอักษรจนพัง',
    !/�/.test(_clampBytes(GLOSS_REAL, 51)) && _utf8Bytes(_clampBytes(GLOSS_REAL, 51)) <= 51);
  check('รัน: ชื่อร้านยาวผิดปกติก็ยังไม่ทำให้ prompt ทะลุเพดาน',
    (() => {
      const p2 = ['Freshket', 'ออเดอร์', 'เครดิต', 'วางบิล', 'ใบเสนอราคา', 'กิโล', 'ลัง'];
      p2.push(_clampBytes('ร้าน'.repeat(200), 120));
      const b2 = MAX - _utf8Bytes(p2.join(' ')) - 1;
      if (b2 > 30) p2.push(_clampBytes(GLOSS_REAL, b2));
      return _utf8Bytes(p2.join(' ')) <= MAX;
    })());
}

console.log('\n── 2c. ขนาดไฟล์เสียง: ต้องกันก่อนยิง ไม่ใช่ให้ Groq ตอบ 413 ──');
// 14 ส.ค.: 25.6MB โดน 413 / 19.0MB ผ่าน → เพดานจริง 25MB
// ของเดิมไม่เคยเช็ค ทำให้ไฟล์ดีถูกตีตรา "ไฟล์เสีย" แล้วปิดคิวถาวร
check('มีเพดานขนาดไฟล์ก่อนเรียก Groq',
  /const GROQ_MAX_AUDIO_BYTES = 24 \* 1024 \* 1024/.test(WK));
check('เช็คขนาดเป็นขั้นแรกของ runTranscribe',
  /if \(_audioBytesLen > GROQ_MAX_AUDIO_BYTES\) throw new AudioTooLargeForGroq/.test(WK));
check('ไฟล์ใหญ่ = พักไว้ที่ needs_gemini ไม่ใช่ failed_audio ถาวร',
  /if \(err && err\.tooLarge\)/.test(WK) && /pipeline_stage  = 'needs_gemini'/.test(WK));
check('ฝั่งแอปรู้จัก needs_gemini แล้ว (ไม่งั้นผู้ใช้เห็นหน้าว่าง)',
  (CI.match(/needs_gemini/g) || []).length >= 2);
check('400 ที่เป็นความผิดคำขอฝั่งเรา ไม่ถูกตีเป็นไฟล์เสียถาวร',
  /prompt length\|invalid\[_ \]request\|parameter/.test(WK) && /ourFault: true/.test(WK));

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
