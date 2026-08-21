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

// ทิ้งบรรทัดคอมเมนต์ออก — ใช้เวลาต้องยืนยันว่า "สตริงนี้ต้องไม่มีอยู่ในโค้ดที่รัน"
// (คอมเมนต์อธิบายที่มามักอ้างคำเดิมที่กำลังเลิกใช้ ทำให้เช็คแบบนั้น false-fail)
function noComments(s) {
  return s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}

const STAGE1 = WK.slice(WK.indexOf('// ── Stage 1: uploaded / needs_gemini → transcribed'),
                       WK.indexOf('// ── Stage 2: transcribed → analyzed'));
const STEP = WK.slice(WK.indexOf('async function runListenStep'), WK.indexOf('async function processSession'));
// v_winoverlap (2026-08-21): ตัววางแผนหน้าต่างถูกแยกออกมาเป็นฟังก์ชันของตัวเอง
// เพื่อให้ harness รันจริงทดสอบได้ ไม่ใช่แค่ grep หาสตริงในโค้ดก้อนใหญ่
const PLAN = WK.slice(WK.indexOf('function _planListenWindows'), WK.indexOf('function _keepInWindow'));

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
  // v_keepprogress (2026-08-21): เลิกวัดด้วยระยะตัวอักษรถึงสตริง — regex นี้พังจาก
  // การแก้ใกล้ๆ มา 3 ครั้งแล้ว (2500→4200→6000) ทั้งที่พฤติกรรมไม่ได้เปลี่ยน
  // เช็คด้วยลำดับ index แทน: catch ต้องมาก่อนจุดตกไป Whisper และ t = null
  // ⚠ ห้ามใช้ indexOf('t = null;') เปล่าๆ — มี `let t = null;` ประกาศไว้ต้น stage
  // อยู่แล้ว (ก่อน catch) จะเจอตัวนั้นก่อนเสมอ ต้องค้นต่อจากจุดข้อความ fallback
  STAGE1.indexOf('catch (e) {') > -1 &&
  STAGE1.indexOf('→ ใช้ตัวสำรอง Whisper') > STAGE1.indexOf('catch (e) {') &&
  STAGE1.indexOf('t = null;', STAGE1.indexOf('→ ใช้ตัวสำรอง Whisper')) > -1);
// v_attemptbudget (2026-08-17): needs_gemini ไม่มี Whisper ให้ถอย — เมื่องบ Gemini
// เอง (LISTEN_MAX_ATTEMPTS) หมดจริงถึงปิดถาวร ส่วน hiccup ชั่วคราวปล่อยให้ tick
// ถัดไปลองซ้ำ ไม่แตะ general attempts (เพดานแค่ 4) เพื่อไม่ให้ blip ที่ไม่เกี่ยวกับ
// Gemini มาปิดคิวถาวรทั้งที่งบ Gemini จริงยังเหลือเยอะ
// v_honestlabel (2026-08-21): เคสนี้ไฟล์เสียงดีสมบูรณ์ (ของจริง 21 ส.ค. 10:18 =
// 25.41MB ที่ 8,640 B/s อยู่ในย่านไฟล์ดีเต็มๆ) ปัญหาอยู่ที่ตัวถอดล้วนๆ — ป้าย
// failed_audio ที่แอปแปลว่า "ไฟล์เสียงใช้ไม่ได้" จึงโกหกและทำให้ไล่ผิดทาง
check('needs_gemini: งบ Gemini หมดจริงถึงปิดถาวร (ไม่ผ่าน classifyFailure ที่จะเดาผิด)',
  /const genuinelyExhausted = \/ไม่จบใน \\d\+ รอบ\//.test(STAGE1) &&
  /pipeline_stage: 'failed_system', processing_since: null, next_attempt_at: null/.test(STAGE1));
check('ไฟล์เสียงดีแต่ถอดไม่จบ ต้องไม่ถูกตีตราว่า "ไฟล์เสียงใช้ไม่ได้"',
  // ⚠ ต้องกรองคอมเมนต์ออกก่อน — คอมเมนต์ที่อธิบายที่มาอ้างคำว่า failed_audio โดย
  // ตั้งใจ (ทั้งของ v_honestlabel เองและของ v_hiccupbudget เดิม) เป็นกับดักเดิมที่
  // โดนมาแล้วใน verify_echo_visit.js — ใช้สำนวนกรองแบบเดียวกัน
  !/failed_audio/.test(noComments(STAGE1)) &&
  /ไฟล์เสียงปกติดี แต่ถอดด้วย Gemini ไม่จบ/.test(STAGE1),
  'failed_audio = แอปขึ้นว่าไฟล์เสียงใช้ไม่ได้ ซึ่งไม่จริงสำหรับเคสนี้');
// v_hiccupbudget (2026-08-19): a hiccup with no Whisper fallback for this
// session (forcedGemini) used to release the claim WITHOUT ever persisting
// listen_state.attempts — since runListenStep's own exhaustion throw only
// fires off the PERSISTED attempts count, a window that hiccups the same
// way every tick (not a 524, so never hits the timeout-split save() either)
// could loop forever: LISTEN_MAX_ATTEMPTS never actually triggered because
// the counter it reads never moved. Confirmed live: a real session sat at
// listen_state.attempts=5 for 22+ hours while processing_since kept
// advancing every single cron tick — proof the sweep was retrying it
// constantly, yet the persisted attempt count never budged once. Fixed by
// bumping+persisting listen_state.attempts on every hiccup too, so repeated
// hiccups on the same window genuinely count toward the cap and the session
// eventually reaches a real terminal state instead of silent forever-retry.
check('needs_gemini: hiccup ยังไม่แตะ general (ci_sessions) attempts แต่ต้องขยับ listen_state.attempts จริง',
  /hiccupAttempts = \(\(row\.listen_state[\s\S]{0,300}\+ 1;/.test(STAGE1) &&
  /listen_state: \{ \.\.\.\(row\.listen_state \|\| \{\}\), attempts: hiccupAttempts/.test(STAGE1) &&
  !/hiccup ชั่วคราวรายหน้าต่าง[\s\S]{0,900}ci_sessions\.attempts \+\+/.test(STAGE1));
// v_enginelatch (2026-08-21): ยอมแพ้ Gemini แล้วต้องล็อกเป็น Whisper ไม่ใช่ล้างเป็น null
// ถ้าล้างเป็น null แล้วรอบ Whisper ถูกฆ่ากลางทาง (waitUntil ตาย) tick ถัดไปจะเริ่ม
// Gemini ใหม่จากศูนย์ อัปไฟล์ใหม่ทั้งก้อน วนไม่จำกัดโดยไม่มีตัวนับไหนขยับ
// (ตรวจของจริงแล้ว: ci_sessions.attempts เป็น 0 ทุกแถว = ไม่มีเพดานคุมวงจรนี้เลย)
check('ยอมแพ้ Gemini = ล็อกเป็น Whisper ไม่ใช่ล้างสถานะเป็น null (กันวนอัปไฟล์ใหม่)',
  /listen_state: \{ engine: 'whisper', gave_up_at:/.test(STAGE1) &&
  /const _latchedWhisper = !!\(row\.listen_state && row\.listen_state\.engine === 'whisper'\);/.test(STAGE1) &&
  /const useGemini = !_latchedWhisper &&/.test(STAGE1));
check('ล็อกแล้วต้องไม่กลับไปแตะ Gemini อีก แม้เป็นเส้น forcedGemini',
  STAGE1.indexOf('!_latchedWhisper &&') < STAGE1.indexOf('forcedGemini || (env.LISTEN_ENGINE'));
check('t เป็น null เมื่อไหร่ = เรียก Whisper เสมอ',
  // v_lazyaudio: มีคอมเมนต์คั่นระหว่าง if กับ t = await แล้ว จึงเช็คด้วยลำดับ index
  // ไม่ใช่ระยะตัวอักษร (regex เดิมพังทันทีที่แทรกคอมเมนต์ — กับดักเดิมของไฟล์นี้)
  STAGE1.indexOf('if (!t) {') > -1 &&
  STAGE1.indexOf('t = await runTranscribe(', STAGE1.indexOf('if (!t) {')) > -1);
check('มีเพดานจำนวนรอบ ไม่วนไม่รู้จบ',
  /attempts > LISTEN_MAX_ATTEMPTS/.test(STEP));
// v_attemptvisible (2026-08-21): waitUntil ที่ถูก Cloudflare ยกเลิกกลางทางไม่ทิ้งร่องรอย
// อะไรเลย (ยืนยันจาก wrangler tail จริง) — ถ้าไม่บันทึกก่อนยิง ตัวนับไม่ขยับ เพดานที่
// อ่านตัวนับนั้นก็ไม่มีวันทำงาน = บั๊กชนิดเดียวกับลูป 22 ชม. ของ Tape
check('บันทึกความพยายามก่อนยิง Gemini ไม่ใช่หลังสำเร็จ (กันความล้มที่มองไม่เห็น)',
  STEP.indexOf('await save({});') > -1 &&
  STEP.indexOf('await save({});') < STEP.indexOf('res = await _listenCall('),
  'ต้องอยู่ก่อน _listenCall ไม่งั้น invocation ที่ถูกฆ่าจะไม่ถูกนับ');

console.log('\n── 3. คลิปยาว: ถอดข้าม tick ได้ ไม่เริ่มใหม่ ──');
check('อัปไฟล์ครั้งเดียว แล้วใช้ file_uri ซ้ำ',
  /if \(!st\.file_uri\) \{/.test(STEP) && /_geminiUploadAudio/.test(STEP));
check('ยังไม่จบ = ปล่อย claim ให้ tick ถัดไปทำต่อ (stage ยังเป็น uploaded)',
  STAGE1.indexOf('if (!step) {') > -1 &&
  STAGE1.indexOf('processing_since: null', STAGE1.indexOf('if (!step) {')) > -1);
// ── v_queuefair (2026-08-21): ตัวยอมคิวมีอยู่แล้วในดีไซน์ แต่ไม่เคยถูกใช้ ────────
// order ของ sweepPending คือ next_attempt_at.asc.nullsfirst,visited_at.asc และคอมเมนต์
// ผู้เขียนระบุเจตนา "ไม่มีใครผูกขาด" — แต่เส้นทางสำเร็จไม่เคยเซ็ต next_attempt_at
// จึงค้าง null ตลอดกาลแล้ว visited_at เก่าสุดยึดคิวคนเดียว (หลักฐานสด 21 ส.ค.:
// session 19 ส.ค. กินคิวทั้งบ่าย อีก 2 ตัว attempts ยังเป็น 0)
check('ทำงานเสร็จหนึ่งขั้นแล้วต้อง "ยอมคิว" ทุกจุด (ไม่ผูกขาดคิว)',
  (() => {
    // ทุกจุดที่ปล่อย claim แบบ "ยังไม่จบ" ต้องเซ็ต next_attempt_at ไปด้วย
    const yields = (STAGE1.match(/next_attempt_at: new Date\(\)\.toISOString\(\)/g) || []).length;
    return yields >= 3;   // if(!step) + hiccup ของ forcedGemini + v_keepprogress
  })(), 'ต้องมีครบทั้ง 3 จุด ไม่งั้น session ที่ค้างจุดนั้นจะยึดคิวต่อ');
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
  /dur \/ 60 <= LISTEN_SINGLE_MAX_MIN/.test(PLAN));
// v_winmemory (2026-08-21): 524 = "ขนาดคำขอนี้ใหญ่เกินไปสำหรับวันนี้" ซึ่งเป็นข้อมูล
// ระดับ session ไม่ใช่ระดับหน้าต่าง ⇒ ต้องหดแล้ววางแผน "ทุกหน้าต่างที่เหลือ" ใหม่ทีเดียว
// แล้วจำไว้ที่ listen_state.win_sec · ของเดิมหดทีละหน้าต่าง หน้าต่างถัดไปจึงไปเจอ 524
// ใหม่เองอีก = จ่ายค่าค้นพบซ้ำทุกหน้าต่าง (เห็นสดวันนี้: หน้าต่าง 3 หดถึง 2 นาที
// แต่หน้าต่าง 4-9 ยังตั้งต้นที่ 12 นาที)
check('เจอ 524/timeout แล้วหดขนาดคำขอ + วางแผนที่เหลือใหม่ทั้งหมด',
  /\/\\b524\\b\|timeout\|timed out\/i\.test\(msg\)/.test(STEP) &&
  /const _newWin = Math\.max\(LISTEN_MIN_WIN_SEC \* 2, Math\.floor\(_curWin \/ 2\)\);/.test(STEP) &&
  /windows\.splice\(i, windows\.length - i, \.\.\.remaining\)/.test(STEP));
check('จำขนาดคำขอที่ใช้ได้ไว้ใน listen_state.win_sec (ไม่ค้นพบซ้ำทุกหน้าต่าง)',
  /const _curWin = st\.win_sec \|\| \(LISTEN_WIN_MIN \* 60\);/.test(STEP) &&
  /await save\(\{ windows, win_sec: _newWin \}\)/.test(STEP));
check('มีพื้นหดต่ำสุด — หดจนสั้นแล้วยังพัง = โยนต่อให้ตกไป Whisper',
  /if \(_newWin < _curWin\)/.test(STEP) && /LISTEN_MIN_WIN_SEC/.test(STEP) && /throw e;/.test(STEP),
  'ถ้า _newWin ไม่เล็กลงแล้ว ต้องตกไป throw ไม่ใช่วางแผนเดิมซ้ำ');
// v_winfloor (2026-08-21): พื้น 180 ทำให้หน้าต่าง 6 นาทีผ่าต่อไม่ได้ (360 > 360 เป็นเท็จ)
// ตันทันทีเมื่อ 524 ซ้ำที่ 6 นาที — เจอสดๆ กับ session 19 ส.ค. 16:00 บ่ายวันนี้
check('พื้นหดต้องต่ำพอให้หน้าต่าง 6 นาทีผ่าต่อได้อีก (ไม่ตันที่ 524 ซ้ำ)',
  (() => {
    const floor = Number((WK.match(/const LISTEN_MIN_WIN_SEC = (\d+)/) || [])[1]);
    return floor > 0 && 360 > floor * 2;
  })(), 'ถ้า 360 ไม่ > พื้น×2 หน้าต่าง 6 นาทีจะหดต่อไม่ได้และล้มทันที');
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
// v_usability (2026-08-21): ของเดิมทั้งสองฝั่งใช้ค่าที่โมเดลเดาความมั่นใจตัวเอง ซึ่ง
// แยก "งานใช้ได้" จาก "งานพัง" ไม่ออก — 19 ส.ค. 14:06 (บุชยืนยันว่าผลแม่น) ได้ 0.56
// แต่ 21 ส.ค. 14:09 ที่ถอดได้แค่ 27% ของคลิป ได้ 0.53 · ตอนนี้คิดจากความครอบคลุม
// คูณความละเอียดจริง ทั้งสองฝั่งใช้สูตรเดียวกัน
check('ทั้งสองหูคิดค่าความมั่นใจจากความใช้ได้จริง ไม่ใช่ค่าที่โมเดลเดาตัวเอง',
  /const conf = _usabilityScore\(merged, row\.duration_secs \|\| 0, unclear\)/.test(STEP) &&
  /avg_transcript_confidence: _usabilityScore\(segments, duration_secs, 0\)/.test(WK) &&
  !/avg_transcript_confidence: n \? segments\.reduce/.test(WK));
check('ยังนับท่อน [ฟังไม่ชัด] ต่อ (เป็นตัวคูณ clarity ไม่ได้ทิ้งของเดิม)',
  /const unclear = merged\.filter\(s => \/\\\[ฟังไม่ชัด\\\]\/\.test/.test(STEP) &&
  /const clarity\s+= segs\.length \? 1 - \(Math\.max\(0, unclearCount \|\| 0\) \/ segs\.length\) : 1;/.test(WK));
check('ค่ารายท่อนของ Whisper ยังอยู่ครบ (ตัวกรอง hallucination + ด่าน diarize ใช้ค่านี้)',
  /transcript_confidence: Math\.max\(0, Math\.min\(1, Math\.exp\(s\.avg_logprob \|\| -0\.3\)\)\)/.test(WK) &&
  /const LOW_CONF_EDIT_THRESHOLD = 0\.5;/.test(WK));
check('ป้ายในแอปยังอ่านค่านี้อยู่',
  /typeof s\.transcript_confidence === 'number' && s\.transcript_confidence < _confThreshold/.test(CI));
check('ระบุแหล่งที่มาเป็น gemini เพื่อให้ตรวจย้อนได้ว่าบทไหนมาจากหูไหน',
  /source: 'gemini-3\.1-pro'/.test(STEP));

// v_driftmeter (2026-08-21): ตัววัดต้องรอดตอน "สำเร็จ" ให้ได้ ไม่ใช่แค่ตอนค้าง/ล้ม —
// เคสสำเร็จคือเคสที่ต้องรู้ว่าครึ่งหลังของคำขอเพี้ยนหรือยัง · listen_state ถูกล้างตอน
// สำเร็จ จึงต้องย้ายไปเก็บที่อื่นก่อน ไม่งั้นวัดไปก็อ่านไม่ได้
check('ตัววัด drift ถูกเก็บลง ab_gemini ตอนสำเร็จ (listen_state ถูกล้างทิ้งตรงนั้น)',
  /drift\s+\/\/ v_driftmeter/.test(STEP) &&
  /ab_gemini: \{ drift: t\.drift, source: t\.source \|\| null, measured_at/.test(STAGE1) &&
  /listen_state:\s+null,/.test(STAGE1));
check('drift สะสมข้ามหน้าต่าง ไม่ใช่เก็บแค่หน้าต่างสุดท้าย',
  /const drift = \(st\.drift \|\| \[\]\)\.concat\(\[_windowDrift\(res\.segments, w, row\.duration_secs\)\]\)/.test(STEP) &&
  /await save\(\{ next: i \+ 1, segs, drift, fails: 0 \}\)/.test(STEP));

console.log('\n── 6b. v_filecleanup: ลบไฟล์ Gemini Files API หลังเลิกใช้ (best-effort) ──');
check('_geminiUploadAudio คืน {uri,name} ไม่ใช่ string เปล่า (name จำเป็นสำหรับสั่งลบ)',
  /return \{ uri: f\.uri, name \};/.test(WK));
check('มี _geminiDeleteFile ไว้สั่งลบ และพลาดได้โดยไม่ทำ pipeline พัง (best-effort)',
  /async function _geminiDeleteFile\(env, name\)/.test(WK) &&
  /method: 'DELETE'/.test(WK));
check('ถอดจบครบทุกช่วงแล้วลบไฟล์ทิ้งก่อน return ผลลัพธ์',
  /if \(st\.file_name\) await _geminiDeleteFile\(env, st\.file_name\);\s*return \{/.test(STEP));
check('เลิกใช้ไฟล์เพราะตกไป Whisper ก็ลบทิ้งก่อนเขียนสถานะใหม่',
  // v_enginelatch: เขียน listen_state เป็น {engine:'whisper'} แทน null แล้ว — เช็คด้วย
  // ลำดับ index (ลบไฟล์ต้องมาก่อนเขียนสถานะ) ไม่ใช่ regex ติดกันแบบเดิม
  STAGE1.indexOf('if (_cur.file_name) await _geminiDeleteFile(env, _cur.file_name);') > -1 &&
  STAGE1.indexOf("listen_state: { engine: 'whisper'",
    STAGE1.indexOf('if (_cur.file_name) await _geminiDeleteFile(env, _cur.file_name);')) > -1);
check('needs_gemini งบหมดถาวรก็ลบไฟล์ทิ้งก่อนปิดคิว',
  /if \(row\.listen_state && row\.listen_state\.file_name\) \{[\s\S]{0,100}_geminiDeleteFile[\s\S]{0,900}pipeline_stage: 'failed_system'/.test(STAGE1));

// ── v_lazyaudio (2026-08-21): ห้ามดาวน์โหลดไฟล์เสียงทิ้งเปล่าๆ ทุก tick ────────
// ต้นเหตุยอด egress พุ่งวันที่ 18-19 ส.ค.: คลิปยาวถอดข้าม tick ทีละหน้าต่าง แต่โค้ด
// โหลดไฟล์เต็มก้อน (15-26MB) ทุก tick ก่อนจะรู้ว่าต้องใช้ไบต์ไหม ทั้งที่หลังอัปเข้า
// Gemini แล้วมันใช้แต่ file_uri · session ของ Tape ติดลูป 22+ ชม. = ~264 tick × 26.56MB
console.log('\n── 6c. v_lazyaudio: ไม่โหลดไฟล์เสียงซ้ำทุก tick ──');
check('มี file_uri อยู่แล้ว = ไม่โหลดไฟล์เสียงเลย (Gemini อ่านจากไฟล์ของตัวเอง)',
  /const _haveGeminiFile = !!\(row\.listen_state && row\.listen_state\.file_uri\);/.test(STAGE1) &&
  /if \(!_haveGeminiFile\) await _fetchAudio\(\);/.test(STAGE1));
check('โหลดแบบ lazy ครั้งเดียวแล้วจำไว้ ไม่โหลดซ้ำในรอบเดียวกัน',
  /if \(!audioBytes\) audioBytes = await sbStorageGet\(env, row\.audio_path\);/.test(STAGE1));
check('ตกไป Whisper ต้องยังได้ไบต์จริง (โหลดตอนนั้นถ้ายังไม่มี)',
  /t = await runTranscribe\(await _fetchAudio\(\), mime,/.test(STAGE1));
check('ไม่มีการโหลดไฟล์แบบไม่มีเงื่อนไขหลงเหลืออยู่',
  !/const audioBytes = await sbStorageGet/.test(noComments(STAGE1)));

// ── v_queuethru (2026-08-21): เพิ่ม throughput แบบมีเพดาน subrequest ที่คิดเลขไว้ ──
// เดิม limit=1 ⇒ ทั้งระบบไหล 1 หน้าต่างต่อ 5 นาที รวมทุกคน · เหตุผลเดิมคือเพดาน
// 50 subrequest/invocation ซึ่งเปลี่ยนไปแล้วหลัง v_lazyaudio (ขั้นถอดหน้าต่างเหลือ ~6)
console.log('\n── 6d. v_queuethru: คิวไหลเร็วขึ้นโดยไม่ทะลุเพดาน subrequest ──');
{
  const SW = WK.slice(WK.indexOf('const SWEEP_MAX_STEPS'), WK.indexOf('await _alertIfFailingOften'));
  const num = re => Number((WK.match(re) || [])[1]);
  const steps = num(/const SWEEP_MAX_STEPS\s+= (\d+)/);
  const analyze = num(/const SWEEP_MAX_ANALYZE = (\d+)/);
  const deadline = num(/const SWEEP_DEADLINE_MS = (\d+)/);
  check('หยิบหลาย session ต่อ tick ไม่ใช่ 1 (คิวไม่ไหลทีละหน้าต่างอีก)',
    steps > 1 && /limit=\$\{SWEEP_MAX_STEPS\}/.test(WK), `SWEEP_MAX_STEPS=${steps}`);
  check('งบ subrequest worst case ยังต่ำกว่าเพดาน 50 (ปลอดภัยแม้อยู่ Free plan)',
    (steps - analyze) * 6 + analyze * 19 < 50,
    `(${steps}-${analyze})×6 + ${analyze}×19 = ${(steps - analyze) * 6 + analyze * 19}`);
  check('จำกัดขั้น analyze ต่อ tick (ขั้นนี้กิน subrequest หนักสุด ~19)',
    analyze >= 1 && analyze < steps && /r\.pipeline_stage === 'transcribed'/.test(SW));
  check('มีกำหนดเวลา ไม่เริ่มขั้นใหม่จนล้นไป tick ถัดไป',
    deadline > 0 && deadline < 300000 && /Date\.now\(\) - _t0 > SWEEP_DEADLINE_MS/.test(SW),
    `SWEEP_DEADLINE_MS=${deadline} ต้องน้อยกว่าคาบ cron 300000`);
  check('แถวที่ยังไม่ได้ทำต้องไม่ถูก claim ทิ้งไว้ (break ก่อน processSession)',
    SW.indexOf('SWEEP_DEADLINE_MS') < SW.indexOf('await processSession'));
}

// ── 6e. v_errretention + v_tslong + v_sweepsolo: งานเก็บกวาด ────────────────
console.log('\n── 6e. งานเก็บกวาด: retention + คลิปเกิน 100 นาที ──');
check('app_errors มี retention แล้ว (เดิมไม่มีเลย และเป็นตารางใหญ่สุดของฐาน)',
  /const ERROR_LOG_RETENTION_DAYS = \d+;/.test(WK) &&
  /sbDelete\(env, 'app_errors', `created_at=lt\./.test(WK));
check('คลิปเกิน 100 นาทีต้องอ่าน timestamp 3 หลักได้ (ไม่งั้นทั้งไฟล์อ่านไม่ออก)',
  /\^\\s\*\(\\d\{1,3\}:\\d\{2\}/.test(WK),
  '_abSecToTs ออก 3 หลักเมื่อเกิน 100 นาที แต่ _abParseCompact เดิมรับแค่ 2');
// v_pause เพิ่ม else-if คั่นระหว่าง _isDailyTick กับ sweepPending — เลิกใช้ระยะตัวอักษร
// เช็คด้วยลำดับ index แทน: tick รายวันต้องมาก่อน และ sweepPending ต้องอยู่สาขา else
check('tick งานกวาดรายวันไม่ทำคิวด้วย (กัน waitUntil ถูกยกเลิกเพราะแย่งเวลากัน)',
  (() => {
    const sc = WK.slice(WK.indexOf('async scheduled('), WK.indexOf('async fetch('));
    const iDaily = sc.indexOf('if (_isDailyTick) {');
    const iSweep = sc.indexOf('cfCtx.waitUntil(sweepPending(env));');
    return iDaily > -1 && iSweep > iDaily &&
           sc.indexOf('sweepExpiredAudio') > iDaily &&
           sc.indexOf('sweepExpiredAudio') < iSweep;
  })());

// ── 6f. v_pausesb: พักเฉพาะการดึงไฟล์จาก Supabase ────────────────────────────
// ของเดิมพักทั้งสายที่ scheduled() ซึ่งแรงเกินจำเป็นและมีช่อง: /process ที่แอปยิงเอง
// (_sweepStuckAsyncRows) ไม่ผ่าน cron จึงยังดึงไฟล์ได้ — เจอของจริง 21 ส.ค. 21:02
// session ที่พักไว้ถูกหยิบไปทำอีกจนดึงไฟล์ซ้ำ
console.log('\n── 6f. v_pausesb: พักเฉพาะคลิปที่ยังอยู่บน Supabase ──');
check('พักที่ sbStorageGet (ครอบทุกทางเรียก รวม /process ที่ไม่ผ่าน cron)',
  (() => {
    const f = WK.slice(WK.indexOf('async function sbStorageGet'), WK.indexOf('async function r2AudioPut'));
    return /ECHO_PIPELINE_PAUSED && env\.ECHO_PIPELINE_RESUME !== '1'/.test(f) &&
           /pausedSupabaseAudio = true/.test(f);
  })());
check('พักหลังจากลอง R2 แล้ว — ไฟล์ที่อยู่ R2 ต้องถอดได้ปกติ ไม่โดนพักไปด้วย',
  (() => {
    const f = WK.slice(WK.indexOf('async function sbStorageGet'), WK.indexOf('async function r2AudioPut'));
    return f.indexOf('env.ECHO_AUDIO.get(path)') < f.indexOf('ECHO_PIPELINE_PAUSED');
  })(), 'ถ้าพักก่อนลอง R2 การอัดใหม่จะถอดไม่ได้ทั้งที่ไม่มีค่าใช้จ่าย');
check('ไม่พักที่ scheduled() อีกแล้ว (คิวเดินปกติ)',
  (() => {
    const sc = WK.slice(WK.indexOf('async scheduled('), WK.indexOf('async fetch('));
    return !/ECHO_PIPELINE_PAUSED/.test(sc);
  })());
check('ติดสถานะพัก = เลื่อนนัดเงียบๆ ไม่นับเป็นความล้ม (ทั้งเส้น Gemini และ Whisper)',
  (WK.match(/if \(e && e\.pausedSupabaseAudio\)/g) || []).length >= 2 &&
  /next_attempt_at: '2026-09-03T00:00:00Z'/.test(WK));
check('เส้น Whisper ต้องไม่ถูก failStage ตีตราว่าล้ม (จะกินงบแล้วปิดคิวถาวร)',
  (() => {
    const i = WK.indexOf("await failStage(env, sessionId, 'transcribe', e, row);");
    const g = WK.lastIndexOf('e.pausedSupabaseAudio', i);
    return g > -1 && i - g < 700;
  })());
check('เปิดคืนได้ด้วย env var ไม่ต้อง deploy',
  /env\.ECHO_PIPELINE_RESUME !== '1'/.test(WK));

// ── 6g. v_audior2: ย้ายไฟล์เสียงไป R2 (ต้นเหตุ egress) ───────────────────────
console.log('\n── 6g. v_audior2: ไฟล์เสียงอยู่ R2 · Supabase เป็นทางถอย ──');
check('worker อ่าน R2 ก่อน แล้วค่อยถอยไป Supabase',
  (() => {
    const f = WK.slice(WK.indexOf('async function sbStorageGet'), WK.indexOf('async function r2AudioPut'));
    return f.indexOf('env.ECHO_AUDIO.get(path)') > -1 &&
           f.indexOf('env.ECHO_AUDIO.get(path)') < f.indexOf('/storage/v1/object/');
  })(), 'ถ้าอ่าน Supabase ก่อน จะยังโดนคิดค่าขาออกเหมือนเดิม');
check('ยังมีทางถอยไป Supabase (ไฟล์เก่าใน retention 7 วันต้องถอดได้)',
  /\/storage\/v1\/object\/\$\{AUDIO_BUCKET\}\/\$\{path\}`, \{ headers: _sbHeaders\(env\) \}/.test(WK));
check('log แยกออกว่าอ่านจากที่ไหน (ตรวจได้ว่าย้ายสำเร็จจริงไหม)',
  /อ่านจาก R2/.test(WK) && /อ่านจาก Supabase \(คิดค่าขาออก\)/.test(WK));
check('ลบไฟล์หมดอายุลบทั้งสองที่ (กันไฟล์กำพร้าที่ sweep หาไม่เจอ)',
  /env\.ECHO_AUDIO\.delete\(path\)/.test(WK) &&
  /if \(!r\.ok && r\.status !== 404\) sbErr/.test(WK) &&
  /if \(r2Err && sbErr\) throw sbErr;/.test(WK));
check('endpoint /audio-put กัน path ออกนอกโฟลเดอร์ (path มาจาก client)',
  /\^echo-audio\\\/\[0-9a-f-\]\{36\}\\\/\[0-9a-f-\]\{36\}\\\.\(webm\|mp4\|m4a\|ogg\)\$/.test(WK) &&
  /path ไม่ถูกรูปแบบ/.test(WK));
check('endpoint รับแต่ POST และปฏิเสธไฟล์ว่าง',
  /if \(request\.method !== 'POST'\)/.test(WK) && /ไฟล์ว่าง/.test(WK));
check('ผูก R2 binding ใน wrangler.toml แล้ว และเป็นถังส่วนตัว (ไม่ใช่ freshket-data ที่เปิดสาธารณะ)',
  (() => {
    const wt = fs.readFileSync(path.join(__dirname, '..', 'wrangler.toml'), 'utf8');
    return /binding = "ECHO_AUDIO"/.test(wt) &&
           /bucket_name = "freshket-echo-audio"/.test(wt) &&
           !/bucket_name = "freshket-data"/.test(wt);
  })(), 'freshket-data เปิดสาธารณะ — ไฟล์เสียงมีบทสนทนาลูกค้า+GPS ห้ามลงถังนั้น');
check('ฝั่งแอปอัป R2 ก่อน และถอยไป Supabase ถ้าล้ม (เสียงต้องไม่หาย)',
  (() => {
    const i = CI.indexOf('let _store = ');
    const iR2 = CI.indexOf('/audio-put?path=', i);
    const iFallback = CI.indexOf("supa.storage.from('ciq-data')", i);
    return i > -1 && iR2 > i && iFallback > iR2 &&
           /_store = 'supabase'/.test(CI);
  })(), 'ลำดับต้องเป็น R2 ก่อน แล้ว Supabase เป็นทางถอย ไม่ใช่ทางเดียว');

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

// ── 8. v_winoverlap + v_usability: รันจริง ไม่ใช่แค่ grep ─────────────────────
// บทเรียนของรอบ 19-21 ส.ค. คือผมปล่อย "สมมติฐานที่วัดไม่ได้" ลง production แล้ว
// มันเสียหายเงียบๆ 2 วัน (Gemini ไม่ถอดคลิปยาวอีกเลย) เพราะไม่มีอะไรพิสูจน์
// พฤติกรรมจริงเลย · บล็อกนี้ประกอบฟังก์ชันจริงในแซนด์บ็อกซ์แล้วรันกับ **เลขจริงของ
// session ใน production 14-21 ส.ค.** ที่บุชเห็นด้วยตาเอง
console.log('\n── 8. v_winoverlap + v_usability: รันจริงกับเลขจริงจาก production ──');
{
  const helpers = WK.slice(WK.indexOf('function _abTsToSec'), WK.indexOf('function _abSecToTs'));
  const consts = (WK.match(/const LISTEN_WIN_MIN = \d+;[\s\S]*?const LISTEN_WIN_MAX_FAILS = \d+;/) || [''])[0];
  const usab = WK.slice(WK.indexOf('const USABILITY_TARGET_SEG_PER_MIN'), WK.indexOf('async function runTranscribe'));
  const plan = WK.slice(WK.indexOf('function _planListenWindows'), WK.indexOf('const LISTEN_RETRY_DELAYS'));
  const ctx = {};
  vm.createContext(ctx);
  try {
    vm.runInContext(`${helpers}\n${consts}\n${usab}\n${plan}\n` +
      'this.API={_planListenWindows,_keepInWindow,_usabilityScore,_windowDrift,' +
      'LISTEN_WIN_MIN,LISTEN_STRIDE_MIN,LISTEN_MAX_ATTEMPTS,LISTEN_MIN_WIN_SEC};', ctx);
    const A = ctx.API;

    // ── ตัววางแผนหน้าต่าง ──
    check('รันจริง: คลิปสั้น (158 วิ = ของจริง 19 ส.ค. 14:20) = คำขอเดียว ไม่ซอย',
      (() => { const w = A._planListenWindows(158);
        return w.length === 1 && w[0].from === null && w[0].to === null; })());

    const w48 = A._planListenWindows(2880);   // 48 นาที
    check('รันจริง: คลิป 48 นาที = 8 คำขอ — เท่ากับตอน 6 นาทีไม่ซ้อนเป๊ะ (ไม่ช้าลง)',
      w48.length === 8, `ได้ ${w48.length} คำขอ`);
    check('รันจริง: แต่ละคำขอยาว 12 นาที แต่เก็บแค่ 6 นาทีแรก (ครึ่งที่ยังไม่เพี้ยน)',
      w48[0].from === 0 && w48[0].to === 720 && w48[0].keep_to === 360 &&
      w48[1].from === 360 && w48[1].to === 1080 && w48[1].keep_to === 720,
      JSON.stringify(w48.slice(0, 2)));
    check('รันจริง: คำขอสุดท้าย keep_to = null (เก็บถึงท้ายไฟล์ ไม่ตกท่อนท้าย)',
      w48[w48.length - 1].keep_to === null && w48[w48.length - 1].to === 2880);
    check('รันจริง: ช่วงที่เก็บต่อกันพอดีทั้งคลิป ไม่มีรูและไม่ทับกัน',
      (() => {
        for (let i = 0; i < w48.length - 1; i++) if (w48[i].keep_to !== w48[i + 1].from) return false;
        return w48[0].from === 0;
      })(), JSON.stringify(w48.map(w => [w.from, w.keep_to])));
    check('รันจริง: ทุกคำขอเก็บไม่เกินครึ่งของสิ่งที่ขอ (ครึ่งหลังที่เพี้ยนถูกทิ้งจริง)',
      w48.slice(0, -1).every(w => (w.keep_to - w.from) <= (w.to - w.from) / 2));
    check('รันจริง: คลิป 60 นาที ใช้ 10 คำขอ — ยังห่างเพดาน 48 เยอะ (ค่าเดิม 20 เคยชน)',
      A._planListenWindows(3600).length === 10 && A.LISTEN_MAX_ATTEMPTS >= 40,
      `${A._planListenWindows(3600).length} คำขอ · เพดาน ${A.LISTEN_MAX_ATTEMPTS}`);
    check('รันจริง: เศษท้ายไฟล์สั้นๆ ถูกกลืนรวม ไม่ยิงคำขอจิ๋วเพิ่ม',
      (() => { const w = A._planListenWindows(760);   // 12.7 นาที
        return w[w.length - 1].keep_to === null && w.length === 2; })(),
      JSON.stringify(A._planListenWindows(760)));

    // ── ตัวกรอง keep ──
    const segsAt = secs => secs.map(s => ({ ts: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, text: 'x' }));
    check('รันจริง: หน้าต่างกลางเก็บแค่ท่อนในช่วง keep (ครึ่งหลังของคำขอถูกทิ้ง)',
      A._keepInWindow(segsAt([300, 420, 660, 780, 900]), { from: 360, to: 1080, keep_to: 720 })
        .map(s => s.ts).join(',') === '7:00,11:00');
    check('รันจริง: หน้าต่างสุดท้าย (keep_to=null) เก็บทุกท่อนตั้งแต่ from ไปจนจบ',
      A._keepInWindow(segsAt([300, 2600, 2800]), { from: 2520, to: 2880, keep_to: null }).length === 2);
    check('รันจริง: state รูปแบบเก่าที่ไม่มี keep_to = เก็บทั้งหมดแบบเดิม (งานที่ค้างในคิวไม่พัง)',
      A._keepInWindow(segsAt([10, 400, 900]), { from: 0, to: 360 }).length === 3,
      'ต้องเข้ากันได้กับ session ที่ listen_state ถูกเขียนไว้ก่อน 21 ส.ค.');
    check('รันจริง: คำขอเดียวทั้งไฟล์ (from=null) เก็บทั้งหมด',
      A._keepInWindow(segsAt([10, 100]), { from: null, to: null, keep_to: null }).length === 2);

    // ── คะแนน "ใช้ได้จริง" เทียบกับ session จริงที่บุชเห็นด้วยตา ──
    // สร้างท่อนจำลอง n ท่อน โดยท่อนสุดท้ายจบที่ lastEnd (คือทั้งสองตัวแปรที่สูตรใช้)
    const mk = (n, lastEnd) => Array.from({ length: n }, (_, i) => ({
      end_sec: ((i + 1) / n) * lastEnd, ts: '0:00', text: 'x'
    }));
    const cases = [
      ['Dent 19 ส.ค. 14:06 (บุชยืนยันว่าผลแม่น)',      224, 2070, 2829, 0.732, false],
      ['Dent 21 ส.ค. 12:54 (คนเดียวกัน ยาวเท่ากัน)',    115, 2322, 2857, 0.402, true ],
      ['21 ส.ค. 14:09 (ถอดได้แค่ 27% ของคลิป)',          22,  165,  616, 0.268, true ],
      ['20 ส.ค. 11:08 (ครอบคลุม 63% ท่อนบาง)',          131, 1570, 2501, 0.523, true ],
      ['20 ส.ค. 13:10 (ครอบคลุมเต็ม ท่อนแน่น)',         185, 1469, 1474, 0.997, false],
      ['14 ส.ค. 13:05 Gemini 64 นาที (เพดานเดิม)',      776, 3840, 3864, 0.994, false],
    ];
    for (const [label, n, lastEnd, dur, want, shouldWarn] of cases) {
      const got = A._usabilityScore(mk(n, lastEnd), dur, 0);
      check(`รันจริง: ${label} → ${want} ${shouldWarn ? '(ต้องเตือน)' : '(ต้องไม่เตือน)'}`,
        Math.abs(got - want) < 0.01 && ((got < 0.6) === shouldWarn),
        `ได้ ${got}`);
    }
    check('รันจริง: ค่าเดิมแยกงานดี/งานพังไม่ออก แต่ค่าใหม่แยกออก (นี่คือเหตุผลที่เปลี่ยน)',
      // ของจริง: 19 ส.ค. conf 0.56 vs 21 ส.ค. 14:09 conf 0.53 — ต่างกัน 0.03 เท่านั้น
      // ค่าใหม่: 0.732 vs 0.268 — ต่างกัน 0.46 และคร่อมเกณฑ์ 0.6 คนละฝั่ง
      (() => {
        const good = A._usabilityScore(mk(224, 2070), 2829, 0);
        const bad  = A._usabilityScore(mk(22, 165), 616, 0);
        return (good - bad) > 0.4 && good >= 0.6 && bad < 0.6;
      })());
    check('รันจริง: ไม่มีท่อน/ไม่รู้ความยาว = คืน null ไม่ใช่ 0 (0 จะขึ้นป้ายเตือนผิดๆ)',
      A._usabilityScore([], 100, 0) === null && A._usabilityScore(mk(5, 50), 0, 0) === null);
    check('รันจริง: ท่อน [ฟังไม่ชัด] เยอะ กดคะแนนลงจริง',
      A._usabilityScore(mk(100, 600), 600, 50) < A._usabilityScore(mk(100, 600), 600, 0));

    // ── v_winmemory: วางแผนที่เหลือใหม่ด้วยขนาดเล็กลง ──
    const okOverlap = p => p.keep_to === null || (p.to - p.from) >= (p.keep_to - p.from) * 2;
    {
      // 524 ที่หน้าต่างเริ่มนาที 12 ของคลิป 40 นาที → วางแผนนาที 12 ถึงจบใหม่ที่ 6 นาที
      const re = A._planListenWindows(2406, 720, 360);
      check('รันจริง: วางแผนที่เหลือใหม่เริ่มถูกจุด และคำขอเล็กลงตามที่สั่ง',
        re[0].from === 720 && (re[0].to - re[0].from) === 360 && re[0].keep_to === 900,
        JSON.stringify(re.slice(0, 2)));
      check('รันจริง: ที่เหลือยังคงเกราะ "ขอ 2 เท่าของที่เก็บ" ทุกก้อน',
        re.every(okOverlap), JSON.stringify(re));
      check('รันจริง: ช่วงเก็บของที่เหลือต่อกันพอดีถึงท้ายไฟล์ ไม่มีรู',
        re.every((p, i) => i === 0 || p.from === re[i - 1].keep_to) &&
        re[re.length - 1].keep_to === null);
      check('รันจริง: หดแล้วจำนวนก้อนเพิ่มขึ้นจริง (จ่ายเวลาแลกความน่าจะสำเร็จ)',
        re.length > A._planListenWindows(2406, 720, 720).length);
    }
    check('รันจริง: หดถึงพื้นแล้วขนาดไม่เล็กลงอีก (ผู้เรียกจะได้ตกไป Whisper)',
      (() => {
        const floor = A.LISTEN_MIN_WIN_SEC * 2;
        const p = A._planListenWindows(2406, 0, 1);   // ขอเล็กกว่าพื้น
        return (p[0].to - p[0].from) === floor;
      })(), `พื้น = ${A.LISTEN_MIN_WIN_SEC * 2} วิ`);
    check('รันจริง: คลิปสั้นตอนหดต้องได้หน้าต่างจริง ไม่ใช่ก้อนเดิมซ้ำ (กันวนวางแผนเดิม)',
      (() => {
        const p = A._planListenWindows(180, 0, 120);
        return p.length >= 1 && p[0].from === 0 && p[0].to !== null;
      })(), JSON.stringify(A._planListenWindows(180, 0, 120)));
    check('รันจริง: การวางแผนครั้งแรกของคลิปสั้นยังเป็นคำขอเดียวเหมือนเดิม',
      A._planListenWindows(158)[0].from === null);

    // ── ตัววัดเสียงเพี้ยน ──
    const dseg = (sec, text) => ({ ts: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, text });
    check('รันจริง: ตัววัด drift — ครึ่งหลังยาวเท่ากัน = ratio ใกล้ 1 (ไม่เพี้ยน)',
      (() => {
        const d = A._windowDrift([dseg(10, 'x'.repeat(40)), dseg(600, 'y'.repeat(40))], { from: 0, to: 720 }, 2880);
        return d.ratio >= 0.9 && d.ratio <= 1.1;
      })());
    check('รันจริง: ตัววัด drift — ครึ่งหลังแตกเป็นคำสั้น = ratio ต่ำชัดเจน (จับอาการได้)',
      (() => {
        const d = A._windowDrift([dseg(10, 'x'.repeat(40)), dseg(600, 'สั้น')], { from: 0, to: 720 }, 2880);
        return d.ratio !== null && d.ratio < 0.3 && d.front > d.back;
      })(), 'นี่คือตัวชี้วัดที่ขาดไปตอน 19 ส.ค. ทำให้ตัดสินใจโดยไม่มีข้อมูล');
  } catch (e) {
    check('รันจริง: แซนด์บ็อกซ์รันได้โดยไม่พัง', false, String((e && e.stack) || e));
  }
}

console.log('\n' + (fail ? `❌ verify_listen_switch: ผ่าน ${pass} · ไม่ผ่าน ${fail}` : `✅ verify_listen_switch: ผ่าน ${pass} · ไม่ผ่าน 0`));
process.exit(fail ? 1 : 0);
