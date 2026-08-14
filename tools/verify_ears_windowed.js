#!/usr/bin/env node
// tools/verify_ears_windowed.js — v_ears เฟส 1 (2026-08-14)
//
// ล็อกตรรกะ "ซอยเป็นหน้าต่างเวลา" ที่ใช้เลี่ยงเพดาน 128-131 วินาทีของ Gemini
//
// ที่มาของตัวเลข (วัดจริง 7 คลิป): คำขอตายที่ 128-131 วิ เสมอ · output คงที่
// ~530 token ต่อนาทีของเสียง · 33.2 นาที = 17,498 token = 100 วิ **รอด**
// 36.1 นาทีขึ้นไป **ตายหมด** · input 49,557 token กลืนได้สบาย
// → ตัวชนเพดานคือความยาว "คำตอบ" ไม่ใช่ความยาว "ไฟล์"
//    จึงแก้ด้วยการให้ตอบทีละช่วง ไม่ใช่หั่นไฟล์เสียง (Worker หั่นไม่ได้อยู่แล้ว)
//
// Usage: node tools/verify_ears_windowed.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WK = fs.readFileSync(path.join(__dirname, '..', 'worker', 'freshket-sense-ai-proxy-v2.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

// ── โหลดฟังก์ชันจริงจาก worker (ไม่ก็อปสูตรมาเขียนใหม่) ──────────────────────
const start = WK.indexOf('const AB_WIN_MIN');
const end = WK.indexOf('async function _abCallGemini');
if (start < 0 || end < 0) { console.error('ERROR: หาบล็อก AB ใน worker ไม่เจอ — โครงเปลี่ยน?'); process.exit(2); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(WK.slice(start, end) +
  '\nthis.API = { AB_WIN_MIN, AB_SINGLE_MAX_MIN, AB_MAX_ATTEMPTS, AB_MIN_WIN_SEC, _abTsToSec, _abSecToTs, _abParseSegments, _abPrompt };', ctx);
const { AB_WIN_MIN, AB_SINGLE_MAX_MIN, AB_MAX_ATTEMPTS, AB_MIN_WIN_SEC,
        _abTsToSec, _abSecToTs, _abParseSegments, _abPrompt } = ctx.API;

console.log('\n── 1. ขนาดหน้าต่างต้องอยู่ใต้เพดานอย่างมีระยะเผื่อ ──');

// เพดานไม่คงที่: 20.2 นาทีเคยผ่านใน 65 วิ แล้ววันเดียวกันโดน 524 ซ้ำสองรอบ
// ความเร็ว generate แกว่ง 76-175 token/วิ → ต้องคิดจากวันช้าสุด
check('หน้าต่าง ≤ 16 นาที (งบ 110 วิ ที่ความเร็วต่ำสุด 76 token/วิ)',
  AB_WIN_MIN <= 16 && AB_WIN_MIN >= 5, `AB_WIN_MIN=${AB_WIN_MIN}`);

check('เกณฑ์ยิงรอบเดียว ≤ 16 นาที (20 นาทีพิสูจน์แล้วว่าเสี่ยง)',
  AB_SINGLE_MAX_MIN <= 16, `AB_SINGLE_MAX_MIN=${AB_SINGLE_MAX_MIN}`);

// ประมาณเวลาจากอัตราจริง: 530 token/นาที · 33.2 นาที(17,498 tok) ใช้ 100 วิ
const secFor = (min) => Math.round(min * 530 / 17498 * 100);
check(`หน้าต่าง ${AB_WIN_MIN} นาที ≈ ${secFor(AB_WIN_MIN)} วิ ในวันปกติ = ไม่เกินครึ่งของเพดาน 128 วิ`,
  secFor(AB_WIN_MIN) <= 64, `ประมาณได้ ${secFor(AB_WIN_MIN)} วิ`);
// วันช้าสุดที่วัดได้ 76 token/วิ · 530 token/นาทีของเสียง
check(`หน้าต่าง ${AB_WIN_MIN} นาที ยังรอดในวันช้าสุด (${Math.round(AB_WIN_MIN*530/76)} วิ < 128)`,
  AB_WIN_MIN * 530 / 76 < 115, `ช้าสุดได้ ${Math.round(AB_WIN_MIN*530/76)} วิ`);

console.log('\n── 2. แปลงเวลา ──');
check('mm:ss → วินาที', _abTsToSec('15:30') === 930 && _abTsToSec('00:05') === 5);
check('hh:mm:ss ก็อ่านได้ (คลิปยาวเกินชั่วโมง)', _abTsToSec('1:02:03') === 3723);
check('ค่าเพี้ยนคืน null ไม่ใช่ 0 (0 จะถูกนับว่าอยู่ต้นคลิป)',
  _abTsToSec('') === null && _abTsToSec('abc') === null && _abTsToSec(null) === null);
check('วินาที → mm:ss เติมศูนย์หน้า', _abSecToTs(930) === '15:30' && _abSecToTs(5) === '00:05');
check('ไป-กลับได้ค่าเดิม', _abTsToSec(_abSecToTs(2700)) === 2700);

console.log('\n── 3. อ่านคำตอบ Gemini ได้ทุกโครงที่มันเคยตอบมาจริง ──');
const segs = [{ ts: '00:01', speaker: 'Sales', text: 'สวัสดีครับ' }];
check('โครงตามที่ขอ {"segments":[…]}',
  JSON.stringify(_abParseSegments(JSON.stringify({ segments: segs }))) === JSON.stringify(segs));
check('**array เปล่าๆ** — โครงที่มันตอบจริงในรอบแรก',
  JSON.stringify(_abParseSegments(JSON.stringify(segs))) === JSON.stringify(segs),
  'เคสนี้เคยทำให้คลิป 20 นาทีที่ถอดได้ดี ถูกเก็บเป็น segments=null');
check('มีข้อความห่อหน้า-หลัง JSON ก็ยังดึงได้',
  (_abParseSegments('นี่คือผลลัพธ์:\n' + JSON.stringify(segs) + '\nจบ') || []).length === 1);
check('ขยะจริงๆ คืน null (ไม่ใช่ [] ที่จะถูกนับว่า "ถอดได้ 0 ท่อน")',
  _abParseSegments('ขอโทษครับ ไม่สามารถถอดได้') === null);
check('{} ที่ไม่มี segments ก็คืน null', _abParseSegments('{"foo":1}') === null);

console.log('\n── 4. prompt: หน้าต่างต้องสั่งชัดทั้งขอบเขตและฐานเวลา ──');
const pFull = _abPrompt(null, null), pWin = _abPrompt(900, 1800);
check('ไม่ระบุหน้าต่าง = prompt เดิม ไม่มีท่อนบังคับช่วง', !/ถอดเฉพาะช่วง/.test(pFull));
check('ระบุหน้าต่าง = บอกช่วงเป็น mm:ss', /ถอดเฉพาะช่วง 15:00 ถึง 30:00/.test(pWin));
check('สั่งข้ามช่วงอื่นชัดเจน', /ห้ามถอด/.test(pWin));
check('บังคับ ts เป็นเวลาจริงจากต้นไฟล์ (ไม่งั้นรวมหน้าต่างแล้วเวลาเพี้ยนทั้งบท)',
  /เวลาจริงนับจากต้นไฟล์/.test(pWin));

console.log('\n── 5. แผนหน้าต่าง: ต้องคลุมทั้งคลิป ไม่มีรู ──');
// จำลองตรรกะแบ่งหน้าต่างจาก sweepAbGemini (ก็อปเงื่อนไขมาเทียบ ไม่ได้เรียกฟังก์ชันจริง
// เพราะมันพัวพัน network — จึงล็อกด้วย source check ข้อ 6 คู่กัน)
function planWindows(durSec, winMin) {
  if (durSec / 60 <= AB_SINGLE_MAX_MIN) return [{ from: null, to: null }];
  const out = [];
  for (let s = 0; s < durSec; s += winMin * 60) out.push({ from: s, to: Math.min(s + winMin * 60, Math.ceil(durSec)) });
  return out;
}
{
  const short = planWindows(10 * 60, AB_WIN_MIN);
  check('คลิป 10 นาที = ยิงรอบเดียว (ไม่ซอยโดยไม่จำเป็น)',
    short.length === 1 && short[0].from === null);
  const mid = planWindows(20.2 * 60, AB_WIN_MIN);
  check('คลิป 20.2 นาที (ตัวที่ 524 ตอนยิงรอบเดียว) ถูกซอยแล้ว', mid.length >= 2);

  const long = planWindows(48.8 * 60, AB_WIN_MIN);
  check(`คลิป 48.8 นาที = ${Math.ceil(48.8 / AB_WIN_MIN)} หน้าต่าง`,
    long.length === Math.ceil(48.8 * 60 / (AB_WIN_MIN * 60)));
  check('หน้าต่างแรกเริ่มที่ 0', long[0].from === 0);
  check('หน้าต่างสุดท้ายจบที่ความยาวจริง ไม่เลยไม่ขาด',
    long[long.length - 1].to === Math.ceil(48.8 * 60));
  check('ต่อกันสนิท ไม่มีรูระหว่างหน้าต่าง',
    long.every((w, i) => i === 0 || w.from === long[i - 1].to));
  check('ทุกหน้าต่างยาวไม่เกินที่ตั้งไว้',
    long.every(w => (w.to - w.from) <= AB_WIN_MIN * 60));

  // คลิป 36.1 นาที = ตัวที่ล้มจริง ต้องถูกซอย
  const failed = planWindows(36.1 * 60, AB_WIN_MIN);
  check('คลิป 36.1 นาที (ตัวที่ล้มจริง) ถูกซอยแน่นอน', failed.length >= 2 && failed[0].from === 0);
}

console.log('\n── 6. โครงงานบน cron: หนึ่ง tick หนึ่งขั้น + ไม่อัปซ้ำ + ไม่ตัน ──');
const SWEEP = WK.slice(WK.indexOf('async function sweepAbGemini'), WK.indexOf('// ── Router'));
check('ดึงตัว sweep ออกมาตรวจได้', SWEEP.length > 500);
check('เลือกแถวด้วย status (queued/running) ไม่ใช่แค่ requested',
  /ab_gemini->>status=in\.\(queued,running\)/.test(SWEEP),
  'ถ้ากรองด้วย requested อย่างเดียว แถวที่ทำเสร็จแล้วจะถูกหยิบวนไม่จบ');
check('ดึง ab_gemini กลับมาด้วย (ต้องอ่าน state เดิมก่อนเขียนทับ)',
  /select=id,audio_path,account_name,duration_secs,ab_gemini/.test(SWEEP));
check('เขียนกลับแบบรวม state เดิม (…st) ไม่ใช่ทับทั้งก้อน',
  /\{ \.\.\.st, \.\.\.patch, attempts/.test(SWEEP),
  'ทับทั้งก้อน = file_uri/windows หายทุกรอบ วนอัปใหม่ไม่จบ');
check('อัปไฟล์เฉพาะตอนยังไม่มี file_uri (หน้าต่างถัดไปใช้ uri ซ้ำ)',
  /if \(!st\.file_uri\) \{/.test(SWEEP));
check('ขั้นอัปโหลดจบ tick ตัวเองทันที (return true) — ไม่ต่อหน้าต่างในรอบเดียวกัน',
  /console\.log\(`\[ab-gemini\] อัปเสร็จ[\s\S]{0,80}return true;/.test(SWEEP),
  'อัป+ถอดในรอบเดียวคือสิ่งที่ทำให้ HTTP เดิมโดน 524');
check('มีเพดานจำนวนรอบกันแถวค้างบล็อกคิว',
  /attempts > AB_MAX_ATTEMPTS/.test(SWEEP) && AB_MAX_ATTEMPTS > 0);
check('ล้มตอนอัป = failed ทันที (ยังไม่มีอะไรให้ทำต่อ)',
  /if \(!st\.file_uri\) \{\s*await save\(\{ status: 'failed', error: msg \}\);/.test(SWEEP));
check('ล้มด้วยเหตุอื่นที่ไม่ใช่หมดเวลา = คง running ให้ tick ถัดไปลองซ้ำ',
  /await save\(\{ status: 'running', error: msg \}\);/.test(SWEEP));
check('วัดว่าโมเดลเชื่อคำสั่งช่วงเวลาจริงไหม (in_window_pct)',
  /in_window_pct/.test(SWEEP),
  'ถ้ามันไม่เชื่อ แผนหน้าต่างใช้ไม่ได้ ต้องรู้จากตัวเลข ไม่ใช่เดา');
check('รวมผลเรียงตามเวลาจริง',
  /\.sort\(\(a, b\) => \(_abTsToSec\(a\?\.ts\) \?\? 0\) - \(_abTsToSec\(b\?\.ts\) \?\? 0\)\)/.test(SWEEP));
check('ตอนรวมแล้วไม่เก็บ segments ซ้ำในทุกหน้าต่าง (meta เท่านั้น)',
  /const meta = windows\.map/.test(SWEEP) && !/windows: windows,\s*segments: merged/.test(SWEEP));

console.log('\n── 6b. กันเขียนทับคำสั่งคน + หดหน้าต่างเองเมื่อหมดเวลา ──');
check('อ่านสถานะสดก่อนเขียน (compare-and-set)',
  /const fresh = await sbSelect\(env, `ci_sessions\?id=eq\.\$\{row\.id\}&select=ab_gemini`\)/.test(SWEEP),
  'ไม่มีตัวนี้ = สั่งหยุดด้วย SQL แล้วโดน tick ที่ค้างอยู่เขียนทับกลับเป็น running (เจอจริง 14 ส.ค.)');
check('สถานะที่คนตั้งไว้เอง (ไม่ใช่ queued/running) ห้ามถูกเขียนทับ',
  /now\.status !== 'queued' && now\.status !== 'running'/.test(SWEEP));
check('จับ 524/timeout แล้วผ่าหน้าต่างครึ่งหนึ่ง แทนที่จะลองขนาดเดิมซ้ำ',
  /const timedOut = \/\\b524\\b\|timeout\|timed out\/i\.test\(msg\)/.test(SWEEP) &&
  /windows\.splice\(i, 1, \{ from, to: mid \}, \{ from: mid, to \}\)/.test(SWEEP));
check('มีพื้นหดต่ำสุด — หดจนสั้นมากแล้วยังพัง = ยอมแพ้พร้อมบอกว่าไม่ใช่เรื่องความยาว',
  /AB_MIN_WIN_SEC/.test(SWEEP) && AB_MIN_WIN_SEC >= 120);
check('ยิงรอบเดียวที่หมดเวลา ถูกแปลงเป็นหน้าต่างอัตโนมัติ (from ว่าง = 0, to ว่าง = ความยาวจริง)',
  /const from = w\.from == null \? 0 : w\.from;/.test(SWEEP) &&
  /const to = w\.to == null \? Math\.ceil\(row\.duration_secs \|\| 0\) : w\.to;/.test(SWEEP));

console.log('\n── 7. รวมผลจริง: เรียงเวลาถูก และไม่ทำท่อนหาย ──');
{
  const w = [
    { segments: [{ ts: '00:10', text: 'a' }, { ts: '02:00', text: 'b' }] },
    { segments: [{ ts: '15:05', text: 'c' }] },
    { segments: [] },
  ];
  const merged = w.flatMap(x => x.segments || [])
    .sort((a, b) => (_abTsToSec(a?.ts) ?? 0) - (_abTsToSec(b?.ts) ?? 0));
  check('ท่อนครบทุกหน้าต่าง', merged.length === 3);
  check('เรียงตามเวลา', merged.map(s => s.text).join('') === 'abc');
  check('หน้าต่างที่ว่างไม่ทำให้พัง', Array.isArray(merged));
}

console.log('\n' + (fail ? `❌ verify_ears_windowed: ผ่าน ${pass} · ไม่ผ่าน ${fail}` : `✅ verify_ears_windowed: ผ่าน ${pass} · ไม่ผ่าน 0`));
process.exit(fail ? 1 : 0);
