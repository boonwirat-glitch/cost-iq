#!/usr/bin/env node
// tools/verify_echo_queue.js — v_queue (2026-08-12)
//
// ล็อกว่า pipeline ของ Echo "รู้จักยอมแพ้ รู้จักรอ และรู้จักบอก"
//
// ทำไมต้องมี — เหตุการณ์จริง 11-12 ส.ค. 2026:
//   ไฟล์เสียง 3 อันที่เสียถาวร (iOS ตัดไมค์ตอนจอล็อก · 0.01-0.05 MB ทั้งที่อัด
//   5-48 นาที) ถูก cron วนลองใหม่ทุก 2 นาทีตลอด 24 ชม. เพราะคิวไม่มีทาง "จบแบบ
//   ล้มเหลว" · แต่ละรอบ withRetry ยังยิงซ้ำอีก 3 ครั้ง → เผาโควตา Groq
//   (7,200 วินาทีเสียง/ชม.) จนหมด → **ไฟล์ที่ดีพลอยโดน 429 ไปด้วย**
//   พิสูจน์แล้วกับของจริง: พอเอาไฟล์เสียออกจากคิว ไฟล์ดี 3 อัน (19/39/49 นาที
//   รวม 107 นาที = 6,420 วินาที × 3 retry = 19,260 วินาที/tick) ก็ยังล้ม 429
//   เหมือนเดิม — ยืนยันว่าตัวการคือวงวน ไม่ใช่ไฟล์
//
// กติกาที่ไฟล์นี้ล็อกไว้:
//   1. มีสถานะจบแบบล้มเหลว (failed_audio / failed_system) — ไม่งั้นของเสียวนตลอดกาล
//   2. แยกสาเหตุก่อนตัดสินใจ — 429 (คิวรวมเต็ม) ต้องไม่ถูกปฏิบัติเหมือน 400 (ไฟล์พัง)
//   3. 429 ต้องไม่นับเป็น attempt ของงานนั้น และต้องรอข้ามหน้าต่างโควตา (≥ 1 ชม.)
//   4. งานพอดี invocation — Free plan ให้ 50 subrequest ต่อครั้ง
//   5. ความล้มเหลวต้องไปถึงหน้าจอ KAM ไม่ใช่ค้างที่ "กำลังวิเคราะห์" ตลอดกาล
//
// Usage: node tools/verify_echo_queue.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WK = fs.readFileSync(path.join(__dirname, '..', 'worker', 'freshket-sense-ai-proxy-v2.js'), 'utf8');
const CI = fs.readFileSync(path.join(__dirname, '..', 'src', '09_conv_intel.js'), 'utf8');
const TOML = fs.readFileSync(path.join(__dirname, '..', 'wrangler.toml'), 'utf8');

let fail = 0, pass = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}
function grab(src, header, close) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  const e = src.indexOf(close, i);
  return e < 0 ? null : src.slice(i, e + close.length);
}
// ตัดคอมเมนต์ก่อนตรวจ — ไฟล์นี้เต็มไปด้วยคอมเมนต์ที่เล่าโค้ดเก่าที่ลบไปแล้ว
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
const WKC = strip(WK), CIC = strip(CI);

console.log('── คิวงาน Echo ต้องรู้จักยอมแพ้ รู้จักรอ และรู้จักบอก ──');

// ── 1. สถานะจบแบบล้มเหลว ────────────────────────────────────────────────
console.log('\n[worker] สถานะจบ');
check('มีสถานะจบ failed_audio (ไฟล์ใช้ไม่ได้ — ไม่มีวันสำเร็จ)',
  /'failed_audio'/.test(WKC),
  'ไม่งั้นไฟล์ที่ Groq ปฏิเสธจะวนอยู่ในคิวตลอดไป');
check('มีสถานะจบ failed_system (ระบบยอมแพ้หลังลองครบงบ)',
  /'failed_system'/.test(WKC));

// ── 2. แยกสาเหตุ — ทดสอบพฤติกรรมจริงใน vm ไม่ใช่แค่ regex ────────────────
console.log('\n[worker] การจำแนกสาเหตุ (รันจริงใน vm)');
const clsSrc  = grab(WK, 'function classifyFailure(', '\n}\n');
const backSrc = grab(WK, 'function backoffMs(', '\n}\n');
check('ดึง classifyFailure ออกมาได้', !!clsSrc);
check('ดึง backoffMs ออกมาได้', !!backSrc);

// ค่าคงที่ FAIL_* ประกาศอยู่นอกฟังก์ชัน — ต้องดึงจาก source มาด้วย ไม่ใช่นิยามเอง
// (ถ้านิยามเองใน harness เวลามีคนเปลี่ยนชื่อใน worker เทสต์จะยังเขียวหลอกๆ)
const failConsts = (WK.match(/^const FAIL_[A-Z]+ = '[a-z]+';/gm) || []).join('\n');
check('ดึงค่าคงที่ FAIL_* จาก source ได้ครบ 3 ตัว',
  (failConsts.match(/const FAIL_/g) || []).length === 3);

if (clsSrc && backSrc && failConsts) {
  const ctx = { console };
  vm.createContext(ctx);
  try {
    vm.runInContext(failConsts + '\n' + clsSrc + '\n' + backSrc, ctx);

    const kind = m => { try { return ctx.classifyFailure(new Error(m)).kind; } catch (e) { return 'ERR:' + e.message; } };

    // ข้อความจริงที่เจอใน production 12 ส.ค.
    check('Groq 400 "could not process file" = ถาวร (ห้ามลองใหม่)',
      kind('Groq transcribe failed: Groq 400: {"error":{"message":"could not process file - is it a valid media file?"}}') === 'permanent',
      'นี่คือไฟล์ที่ iOS ตัดจนพัง — ลองอีกกี่ครั้งก็ไม่สำเร็จ');
    check('429 = ถูกจำกัดอัตรา (ไม่ใช่ความผิดของงานนี้)',
      kind('Groq 429: rate limit exceeded') === 'throttled');
    check('ข้อความ rate limit ที่ไม่มีเลขสถานะ ก็ต้องอ่านออก',
      kind('ปลายทางปฏิเสธทุกครั้ง (HTTP 429)') === 'throttled');
    check('503 = ชั่วคราว (ลองใหม่แบบถอยหลัง)',
      kind('Gemini diarize 503') === 'transient');
    check('เน็ตล่ม/ไม่มีเลขสถานะ = ชั่วคราว',
      kind('fetch failed') === 'transient');
    check('4xx อื่น (เช่น 401 key ผิด) = ถาวร ไม่ต้องวน',
      kind('sbSelect 401: invalid key') === 'permanent');
    check('408 timeout = ชั่วคราว ไม่ใช่ถาวร',
      kind('Groq 408: request timeout') === 'transient');

    // backoff ต้องโตขึ้นจริง และตัวแรกต้องไม่ถี่กว่า 5 นาที
    const b = [1, 2, 3].map(n => ctx.backoffMs(n));
    check('backoff โตขึ้นเรื่อยๆ (' + b.map(x => Math.round(x / 60000) + 'น.').join(' → ') + ')',
      b[0] < b[1] && b[1] < b[2] && b[0] >= 5 * 60000,
      'ครั้งแรกต้องห่างอย่างน้อย 5 นาที ไม่งั้นเท่ากับวนถี่เหมือนเดิม');
  } catch (e) {
    check('รัน classifyFailure/backoffMs ใน vm ได้', false, e.message);
  }
}

// ── 3. 429 ต้องรอข้ามหน้าต่างโควตา และไม่นับเป็นความผิดของงาน ──────────────
console.log('\n[worker] นโยบายการรอ');
const throttleConst = (WKC.match(/THROTTLE_WAIT_MS\s*=\s*([^;]+);/) || [])[1] || '';
check('มีเวลารอเฉพาะสำหรับ 429 (THROTTLE_WAIT_MS)', !!throttleConst);
check('เวลารอของ 429 ≥ 60 นาที (โควตา Groq เป็นรายชั่วโมง)',
  /60\s*\*\s*60\s*\*\s*1000/.test(throttleConst) || /\b(60|90|120)\s*\*\s*60000/.test(throttleConst),
  'ได้: ' + throttleConst.trim() + ' — รอสั้นกว่าหน้าต่างโควตา = โดน 429 ซ้ำแน่นอน');

const failStage = grab(WK, 'async function failStage(', '\n}\n') || '';
check('ดึง failStage ออกมาได้', !!failStage);
check('เส้นทาง throttled ไม่แตะ attempts (ไม่ลงโทษงานที่ไม่ผิด)',
  /FAIL_THROTTLED[\s\S]{0,700}?next_attempt_at/.test(failStage) &&
  !/FAIL_THROTTLED[\s\S]{0,400}?attempts:/.test(failStage),
  'ถ้านับ 429 เป็น attempt ไฟล์ดีจะถูกตีตรา failed_system ทั้งที่ไม่มีอะไรผิด');
check('เส้นทาง permanent ปิดคิวถาวร (ไม่ตั้งเวลานัดใหม่)',
  /FAIL_PERMANENT[\s\S]{0,500}?next_attempt_at\s*[:=]\s*null/.test(failStage));
check('ครบงบ attempts แล้วต้องจบที่ failed_system',
  /MAX_ATTEMPTS[\s\S]{0,300}?'failed_system'/.test(failStage));

// ── 4. งานต้องพอดี invocation (Free = 50 subrequest) ──────────────────────
console.log('\n[worker] ขนาดงานต่อ 1 invocation');
const sweep = grab(WK, 'async function sweepPending(', '\n}\n') || '';
check('sweep หยิบทีละ 1 session (stage เดียวใช้ได้ถึง ~31 subrequest)',
  /limit=1\b/.test(sweep),
  'ของเดิม limit=3 → 51-204 subrequest ต่อ tick = เกินเพดาน Free 50');
check('sweep กรองด้วย next_attempt_at (ไม่หยิบงานที่ยังไม่ถึงเวลานัด)',
  /next_attempt_at/.test(sweep));
check('sweep เรียงตามเวลานัด ไม่ใช่ตาม claim',
  /order=next_attempt_at/.test(sweep));

const proc = grab(WK, 'async function processSession(', '\n}\n') || WK;
check('ไม่มี recursion ต่อ stage 2 ในตัวเอง (คืนหลักการ ONE stage per invocation)',
  !/await processSession\(sessionId,\s*null,\s*env\)/.test(strip(proc)),
  'stage1+stage2 ในครั้งเดียว = 17-51 subrequest ชนเพดาน');

const sched = grab(WK, 'async scheduled(', '\n  },') || '';
check('sweepExpiredAudio ไม่ยิงทุก tick (แย่งงบ subrequest กับ sweepPending)',
  /getUTCHours\(\)/.test(sched) || /scheduledTime/.test(sched),
  'ของเดิมยิงคู่กันทุกครั้ง เพิ่มได้อีก 51 subrequest');

// ── 5. withRetry ต้องไม่กลืนสถานะ ────────────────────────────────────────
console.log('\n[worker] withRetry');
const wr = grab(WK, 'async function withRetry(', '\n}\n') || '';
check('withRetry คืนสาเหตุจริงเมื่อโดนปฏิเสธทุกครั้ง (ไม่ใช่ All attempts failed เปล่าๆ)',
  /HTTP/.test(wr) && !/throw lastErr \|\| new Error\('All attempts failed'\);/.test(wr),
  'ของเดิม 429 คืน null → lastErr ไม่เคยถูกเซ็ต → ได้ข้อความเปล่าที่แยกสาเหตุไม่ได้');
check('ถอดเสียงยิง Groq ครั้งเดียวต่อ 1 รอบคิว (ไม่ retry รวด 3 ครั้ง)',
  /audio\/transcriptions[\s\S]{0,1600}?\}, 1\)/.test(WKC),
  'คลิป 19 นาที = 1,140 วินาที · ยิง 3 ครั้ง = 3,420 วินาที/tick จากโควตา 7,200/ชม.');

// ── 6. ความล้มเหลวต้องไปถึงหน้าจอ ────────────────────────────────────────
console.log('\n[client] บอกผู้ใช้ตามจริง');
check('client ดึง pipeline_error มาแสดง (เดิมเขียนลง DB แล้วไม่มีใครอ่าน)',
  /pipeline_error/.test(CIC));
check('client รู้จักสถานะ failed_audio',
  /failed_audio/.test(CIC));
check('client รู้จักสถานะ failed_system',
  /failed_system/.test(CIC));
check('เลิกสัญญาเวลาที่ทำไม่ได้ ("2-3 นาที")',
  !/ปกติไม่เกิน 2-3 นาที/.test(CI),
  'cron ที่ 5 นาที + 2 stage = ~10-15 นาที · ป้ายเดิมไม่มีที่มาที่ไปในโค้ดเลย');

// ── 7. กันตั้งแต่ต้นทาง ──────────────────────────────────────────────────
console.log('\n[client] กันไฟล์เสียก่อนอัปโหลด');
check('มี helper ตรวจไฟล์เสียใช้ร่วมกัน (_audioLooksTruncated)',
  /_audioLooksTruncated/.test(CIC));
const startAsync = grab(CI, 'async function _startAsyncPipeline(', '\n  }\n') || '';
check('เส้นทางหลัก (_startAsyncPipeline) เรียกตัวตรวจก่อนอัปโหลด',
  /_audioLooksTruncated/.test(strip(startAsync)),
  'ของเดิมตัวตรวจอยู่แต่ใน _processBlob (legacy) เส้นทางหลักไม่เคยเรียกเลย');
check('ใช้ bitrate จริงคำนวณ ไม่ใช่เลข 3000 ที่ตั้งไว้ตั้งแต่ยุค 24kbps',
  !/_secs \* 3000/.test(CIC),
  'เครื่องอัดที่ 48kbps = 6000 ไบต์/วินาที · เกณฑ์เดิมจึงหย่อนไป 2 เท่า');

// ── 8. cron ต้องตรงกันทั้งไฟล์และหน้า Cloudflare ─────────────────────────
console.log('\n[wrangler.toml] รอบ cron');
check('cron จำกัดเฉพาะเวลาทำงาน ไม่วิ่งทั้งคืน',
  /crons\s*=\s*\[\s*"[^"]*\s\d+-\d+\s/.test(TOML),
  'ต้องระบุช่วงชั่วโมง (UTC) ไม่ใช่ * ทั้งวัน');
check('cron ไม่ถี่กว่า 5 นาที (ถี่กว่านี้ไม่ได้ประโยชน์ เพราะ backoff คุมที่ DB แล้ว)',
  !/crons\s*=\s*\[\s*"\*\/[1-4]\s/.test(TOML));

console.log('\n' + (fail ? '❌' : '✅') +
  ' verify_echo_queue: ผ่าน ' + pass + ' · ไม่ผ่าน ' + fail);
process.exit(fail ? 1 : 0);
