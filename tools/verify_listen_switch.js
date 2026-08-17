#!/usr/bin/env node
// tools/verify_listen_switch.js — v_listen (2026-08-16)
//
// ล็อกการสลับ "หู" จาก Whisper เป็น Gemini ในท่อจริง
//
// ทำไมสลับ (วัดจากคลิปจริง 3,605 ท่อน / 50 การอัด):
//   · Whisper ความมั่นใจเฉลี่ย 0.570 · ต่ำกว่า 0.5 อยู่ 35.5% · สูงกว่า 0.9 แค่ 12.3%
//   · และผิดแบบมั่นใจ (0.79-0.87) ตรงจุดสำคัญ: "เคลม"→"สมภัย",
//     "Restaurant Manager"→"Reservoir Manager", ข้ามคำตอบทั้งท่อน
//   · คลิปเดียวกัน Gemini ได้ 415 ท่อน / Whisper 277 + แยกคนพูดมาในรอบเดียว
//
// สิ่งที่ต้องไม่พังตอนสลับ:
//   1. คลิปยาวต้องถอดข้าม tick ได้ ไม่ใช่เริ่มใหม่ทุกครั้ง (แพงและไม่มีวันจบ)
//   2. Gemini ล้ม → ต้องตกไป Whisper เสมอ งานห้ามค้าง
//   3. ต้องถอยกลับได้ทันทีโดยไม่ต้องแก้โค้ด
//   4. ป้ายเตือน "ถอดเสียงไม่ชัด" ต้องไม่เงียบไปเฉยๆ เพราะ Gemini ไม่มีตัวเลข conf
//
// Usage: node tools/verify_listen_switch.js

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

const STAGE1 = WK.slice(WK.indexOf('// ── Stage 1: uploaded / needs_gemini → transcribed'),
                       WK.indexOf('// ── Stage 2: transcribed → analyzed'));
const STEP = WK.slice(WK.indexOf('async function runListenStep'), WK.indexOf('async function processSession'));

console.log('\n── 1. Gemini เป็นหูหลัก แต่ถอยกลับได้ ──');
check('stage 1 เรียก runListenStep ก่อน ไม่ใช่ Whisper',
  STAGE1.indexOf('runListenStep') < STAGE1.indexOf('runTranscribe('),
  'ถ้า Whisper มาก่อน = ยังไม่ได้สลับจริง');
check('มีสวิตช์ถอยกลับด้วย env var ไม่ต้องแก้โค้ด',
  /env\.LISTEN_ENGINE !== 'whisper'/.test(STAGE1),
  'ตั้ง LISTEN_ENGINE=whisper แล้วต้องกลับไปใช้ของเดิมได้ทันที');
check('ไม่มี GEMINI_API_KEY ก็ยังทำงานได้ (ตกไป Whisper)',
  /&& !!env\.GEMINI_API_KEY/.test(STAGE1));

console.log('\n── 2. Gemini ล้ม = ต้องตกไป Whisper งานห้ามค้าง ──');
check('มี try/catch ครอบเส้น Gemini แล้วปล่อยให้ t เป็น null',
  /catch \(e\) \{[\s\S]{0,2500}Gemini ล้ม → ใช้ตัวสำรอง Whisper[\s\S]{0,600}t = null;/.test(STAGE1));
// v_attemptbudget (2026-08-17): needs_gemini ไม่มี Whisper ให้ถอย — เมื่องบ Gemini
// เอง (LISTEN_MAX_ATTEMPTS) หมดจริงถึงปิดถาวร ส่วน hiccup ชั่วคราวปล่อยให้ tick
// ถัดไปลองซ้ำ ไม่แตะ general attempts (เพดานแค่ 4) เพื่อไม่ให้ blip ที่ไม่เกี่ยวกับ
// Gemini มาปิดคิวถาวรทั้งที่งบ Gemini จริงยังเหลือเยอะ
check('needs_gemini: งบ Gemini หมดจริงถึงปิดถาวร (ไม่ผ่าน classifyFailure ที่จะเดาผิด)',
  /const genuinelyExhausted = \/ไม่จบใน \\d\+ รอบ\//.test(STAGE1) &&
  /pipeline_stage: 'failed_audio', processing_since: null, next_attempt_at: null/.test(STAGE1));
check('needs_gemini: hiccup ชั่วคราวไม่แตะ general attempts — แค่ปล่อย claim ให้ tick ถัดไป',
  /hiccup ชั่วคราวรายหน้าต่าง[\s\S]{0,500}processing_since: null \}\)\.catch/.test(STAGE1));
check('ล้างสถานะระหว่างทางทิ้งก่อนส่งต่อให้ Whisper (ไม่งั้นค้างครึ่งๆ)',
  /listen_state: null \}\)\.catch/.test(STAGE1));
check('t เป็น null เมื่อไหร่ = เรียก Whisper เสมอ',
  /if \(!t\) \{\s*t = await runTranscribe\(/.test(STAGE1));
check('มีเพดานจำนวนรอบ ไม่วนไม่รู้จบ',
  /attempts > LISTEN_MAX_ATTEMPTS/.test(STEP));

console.log('\n── 3. คลิปยาว: ถอดข้าม tick ได้ ไม่เริ่มใหม่ ──');
check('อัปไฟล์ครั้งเดียว แล้วใช้ file_uri ซ้ำ',
  /if \(!st\.file_uri\) \{/.test(STEP) && /_geminiUploadAudio/.test(STEP));
check('ยังไม่จบ = ปล่อย claim ให้ tick ถัดไปทำต่อ (stage ยังเป็น uploaded)',
  /if \(!step\) \{[\s\S]{0,300}processing_since: null \}\);\s*return;/.test(STAGE1));
check('อ่าน listen_state กลับมาด้วย ไม่งั้นลืมทุกรอบ',
  /select=id,owner_email,owner_type,account_id,account_name,sku_glossary,duration_secs,pipeline_stage,status,audio_path,transcript,processing_since,attempts,listen_state/.test(WK));
check('เขียนกลับแบบรวมสถานะเดิม ไม่ทับทั้งก้อน',
  /\{ \.\.\.st, \.\.\.patch, attempts/.test(STEP));
check('ถอดจบแล้วล้าง listen_state ทิ้ง',
  /listen_state:          null/.test(WK));

console.log('\n── 4. เพดาน 128 วิ: ขนาดช่วง + หดเองเมื่อหมดเวลา ──');
const WIN = Number((WK.match(/const LISTEN_WIN_MIN = (\d+)/) || [])[1]);
check(`ช่วงละ ${WIN} นาที — รอดแม้วันที่ช้าสุด (${Math.round(WIN * 530 / 76)} วิ < 128)`,
  WIN > 0 && WIN * 530 / 76 < 115, `LISTEN_WIN_MIN=${WIN}`);
check('คลิปสั้นยิงรอบเดียว ไม่ซอยโดยไม่จำเป็น',
  /st\.single === true \|\| dur \/ 60 <= LISTEN_SINGLE_MAX_MIN|dur \/ 60 <= LISTEN_SINGLE_MAX_MIN/.test(STEP));
check('เจอ 524/timeout แล้วผ่าช่วงครึ่งหนึ่ง แทนลองขนาดเดิมซ้ำ',
  /\/\\b524\\b\|timeout\|timed out\/i\.test\(msg\)/.test(STEP) &&
  /windows\.splice\(i, 1, \{ from, to: mid \}, \{ from: mid, to \}\)/.test(STEP));
check('มีพื้นหดต่ำสุด — หดจนสั้นแล้วยังพัง = โยนต่อให้ตกไป Whisper',
  /LISTEN_MIN_WIN_SEC/.test(STEP) && /throw e;/.test(STEP));
check('รวมผลเรียงตามเวลาจริง',
  /\.sort\(\(a, b\) => \(_abTsToSec\(a\?\.ts\) \?\? 0\) - \(_abTsToSec\(b\?\.ts\) \?\? 0\)\)/.test(STEP));

console.log('\n── 5. prompt: ช่วงเวลา + ความละเอียด + ชื่อร้าน ──');
{
  const src = WK.slice(WK.indexOf('function _listenPrompt'), WK.indexOf('async function _listenCall'));
  const helpers = WK.slice(WK.indexOf('function _utf8Bytes'), WK.indexOf('const GROQ_MAX_AUDIO_BYTES'))
    + WK.slice(WK.indexOf('function _abSecToTs'), WK.indexOf('// ── รูปแบบคำตอบแบบประหยัด'));
  const c = { TextEncoder };
  vm.createContext(c);
  vm.runInContext(`${helpers}\n${src}\nthis.API={_listenPrompt};`, c);
  const { _listenPrompt } = c.API;

  const full = _listenPrompt(null, null, 'ร้านทดสอบ');
  const win  = _listenPrompt(900, 1800, 'ร้านทดสอบ');
  check('ไม่ระบุช่วง = ไม่มีท่อนบังคับช่วงเวลา', !/ถอดเฉพาะช่วง/.test(full));
  check('ระบุช่วง = บอกเป็น mm:ss ชัดเจน', /ถอดเฉพาะช่วง 15:00 ถึง 30:00/.test(win));
  check('บังคับเวลาจริงจากต้นไฟล์ (ไม่งั้นรวมช่วงแล้วเวลาเพี้ยนทั้งบท)',
    /เวลาจริงนับจากต้นไฟล์/.test(win));
  check('บังคับความละเอียด (เปลี่ยนคนพูด/ทุก 10-15 วิ/ห้ามรวบ/ห้ามข้าม)',
    /ทุกครั้งที่เปลี่ยนคนพูด/.test(full) && /ห้ามรวบหลายประโยคยาวๆ/.test(full) && /ห้ามข้ามช่วงไหน/.test(full),
    'ไม่มีข้อนี้ = โมเดลรวบเป็นย่อหน้า เคยได้ 105 ท่อนจากที่ควรได้ 415');
  check('ใส่ชื่อร้านเข้า prompt และคุมความยาวเป็นไบต์',
    /ร้านที่ไปเยี่ยม/.test(full) && /_clampBytes\(String\(accountName\), 200\)/.test(src));
  check('ชื่อร้านยาวผิดปกติไม่ทำให้พัง', typeof _listenPrompt(0, 60, 'ก'.repeat(5000)) === 'string');
}

console.log('\n── 6. ป้ายเตือนคุณภาพต้องไม่เงียบ ──');
check('Gemini คืนค่าความมั่นใจจากสัดส่วนท่อนที่ฟังออก',
  /const unclear = merged\.filter\(s => \/\\\[ฟังไม่ชัด\\\]\/\.test/.test(STEP) &&
  /const conf = merged\.length \? 1 - \(unclear \/ merged\.length\) : null/.test(STEP),
  'ปล่อย null = ป้าย "ถอดเสียงไม่ชัดเจน" ในแอปจะไม่ขึ้นเลย เสียตัวกันพลาดที่ทำไว้');
check('ป้ายในแอปยังอ่านค่านี้อยู่ (เกณฑ์แยกตามหู — gemini เข้มกว่า whisper มาก)',
  /typeof s\.transcript_confidence === 'number' && s\.transcript_confidence < _confThreshold/.test(CI) &&
  /const _confThreshold = s\.transcript_source === 'gemini-3\.1-pro' \? 1 : 0\.6;/.test(CI),
  'ค่า proxy ของ Gemini กระจุกใกล้ 1.0 เกือบทุกแถวจริง — เกณฑ์ 0.6 คงที่จะไม่มีวันขึ้นป้ายเลย');
check('ระบุแหล่งที่มาเป็น gemini เพื่อให้ตรวจย้อนได้ว่าบทไหนมาจากหูไหน',
  /source: 'gemini-3\.1-pro'/.test(STEP));

console.log('\n── 6b. v_filecleanup: ลบไฟล์ Gemini Files API หลังเลิกใช้ (best-effort) ──');
check('_geminiUploadAudio คืน {uri,name} ไม่ใช่ string เปล่า (name จำเป็นสำหรับสั่งลบ)',
  /return \{ uri: f\.uri, name \};/.test(WK));
check('มี _geminiDeleteFile ไว้สั่งลบ และพลาดได้โดยไม่ทำ pipeline พัง (best-effort)',
  /async function _geminiDeleteFile\(env, name\)/.test(WK) &&
  /method: 'DELETE'/.test(WK));
check('ถอดจบครบทุกช่วงแล้วลบไฟล์ทิ้งก่อน return ผลลัพธ์',
  /if \(st\.file_name\) await _geminiDeleteFile\(env, st\.file_name\);\s*return \{/.test(STEP));
check('เลิกใช้ไฟล์เพราะตกไป Whisper ก็ลบทิ้งก่อนล้าง listen_state',
  /if \(row\.listen_state && row\.listen_state\.file_name\) \{[\s\S]{0,100}_geminiDeleteFile[\s\S]{0,150}listen_state: null \}\)/.test(STAGE1));
check('needs_gemini งบหมดถาวรก็ลบไฟล์ทิ้งก่อนปิดคิว',
  /if \(row\.listen_state && row\.listen_state\.file_name\) \{[\s\S]{0,100}_geminiDeleteFile[\s\S]{0,200}pipeline_stage: 'failed_audio'/.test(STAGE1));

console.log('\n── 7. blast radius: ของเดิมต้องไม่หาย ──');
check('runTranscribe (Whisper) ยังอยู่ครบ ไม่ได้ลบทิ้ง',
  /async function runTranscribe\(/.test(WK));
check('เส้น HTTP /transcript เดิมยังเรียก Whisper เหมือนเดิม',
  /const result = await runTranscribe\(_b64ToBytes\(audio_b64\)/.test(WK));
check('เคส "ไม่มีเสียงพูด" ยังทำงานเหมือนเดิมทั้งสองหู',
  /if \(t\.no_speech \|\| !\(t\.segments \|\| \[\]\)\.length\)/.test(STAGE1));
check('stage 2 (วิเคราะห์) ไม่ถูกแตะ',
  /if \(row\.pipeline_stage === 'transcribed' && row\.status !== 'saved'\)/.test(WK));
check('ยังกันไฟล์ใหญ่เกินขีด Whisper ไว้ (ตัวสำรองต้องไม่ระเบิด)',
  /if \(_audioBytesLen > GROQ_MAX_AUDIO_BYTES\) throw new AudioTooLargeForGroq/.test(WK));

console.log('\n' + (fail ? `❌ verify_listen_switch: ผ่าน ${pass} · ไม่ผ่าน ${fail}` : `✅ verify_listen_switch: ผ่าน ${pass} · ไม่ผ่าน 0`));
process.exit(fail ? 1 : 0);
