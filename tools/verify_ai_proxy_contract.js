#!/usr/bin/env node
// tools/verify_ai_proxy_contract.js — v_aifix (2026-08-08)
//
// ล็อก "สัญญา" ของช่องทาง AI กลางที่ Sense ทุกฟังก์ชันใช้ (สรุปปัญหา account,
// SAVE matcher, Olive chat) — คือ POST / ของ worker ที่ src/03_rendering.js
// callAI() เรียก
//
// ทำไมต้องมี: 2026-08-08 AI ทุกตัวใน Sense หยุดทำงานพร้อมกัน ยิงจริงแล้วพบว่า
//   claude → HTTP 400 body {"text":""}      (client throw ทุกครั้ง)
//   gemini → HTTP 200 body {"content":[…]}  (client อ่าน d.text → ได้ค่าว่าง)
// ต้นเหตุไม่ใช่โค้ดที่เพิ่งแก้ แต่เป็นการออกแบบที่ "กลืน error เงียบ" มาแต่ต้น:
//   - ฝั่ง claude ทิ้ง _d.error.message ที่บอกสาเหตุจริง
//   - ฝั่ง gemini ไม่เช็ค res.ok เลย + คืนโครงคนละแบบกับที่ client อ่าน
//   - ไม่มี fallback รุ่นสำรอง รุ่นเดียวตาย = ตายทั้งระบบ
//
// Usage: node tools/verify_ai_proxy_contract.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WK_PATH = path.join(__dirname, '..', 'worker', 'freshket-sense-ai-proxy-v2.js');
const CI_PATH = path.join(__dirname, '..', 'src', '03_rendering.js');
const WK = fs.readFileSync(WK_PATH, 'utf8');
const CI = fs.readFileSync(CI_PATH, 'utf8');

let fail = 0, pass = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}
// ตัดบล็อกระดับบนสุด (const X = … / function X …) ออกมารันใน vm
function grab(src, header, close) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  const e = src.indexOf(close, i);
  return e < 0 ? null : src.slice(i, e + close.length);
}

console.log('── สัญญาของช่องทาง AI กลาง (POST /) ──');

// ── 1. MODEL_MAP: ห้ามมีรุ่นที่ใกล้ตาย/ตายแล้ว ────────────────────────────
const mapSrc = grab(WK, 'const MODEL_MAP = {', '\n};\n');
check('ดึง MODEL_MAP ออกมาได้', !!mapSrc);
if (mapSrc) {
  check('MODEL_MAP ไม่มีสาย gemini 2.5 (ใกล้ปิดตัว ต.ค. 2026)',
    !/gemini-2\.5-/.test(mapSrc), mapSrc.match(/gemini-2\.5-[\w-]+/g)?.join(', '));
  check('ระดับ "ฉลาด" อัปเป็น claude-sonnet-5 แล้ว',
    /claude-sonnet-5/.test(mapSrc));
  check('ระดับ "เร็ว/ถูก" ยังเป็น haiku ตามที่ตกลง (ไม่เผลออัปทั้งกระดาน)',
    /claude-haiku-4-5/.test(mapSrc));
}

// ── 2. ต้องมี chain สำรอง และต้องไม่ใช่ copy ที่สามของ retry logic ────────
check('มี chain รุ่นสำรองของช่องทางกลาง (TEXT_MODEL_CHAIN)',
  /const TEXT_MODEL_CHAIN\s*=/.test(WK));
check('มี primitive ยิงโมเดลตัวเดียวที่ใช้ร่วมกัน (_callOneModel)',
  /async function _callOneModel\(/.test(WK));
check('callBrainModel ใช้ primitive ตัวเดียวกัน ไม่เขียน fetch เองซ้ำ',
  (() => {
    const brain = grab(WK, 'async function callBrainModel(', '\n}\n');
    return !!brain && /_callOneModel\(/.test(brain) &&
      !/fetch\('https:\/\/api\.anthropic\.com/.test(brain);
  })(), 'brain ยังมี fetch ตรงของตัวเอง = copy ที่สอง');

// ── 3. รันจริง: handleGeneralAI ต้องคืนโครงที่ client อ่านได้ ─────────────
const pieces = [
  grab(WK, 'const MODEL_MAP = {', '\n};\n'),
  grab(WK, 'const TEXT_MODEL_CHAIN', '\n];\n'),
  grab(WK, 'function corsHeaders(env) {', '\n}\n'),
  grab(WK, 'function json(', '\n}\n'),
  grab(WK, 'async function _callOneModel(', '\n}\n'),
  grab(WK, 'async function callTextModel(', '\n}\n'),
  grab(WK, 'async function handleGeneralAI(', '\n}\n'),
];
const missing = ['MODEL_MAP','TEXT_MODEL_CHAIN','corsHeaders','json','_callOneModel','callTextModel','handleGeneralAI']
  .filter((n, i) => !pieces[i]);
check('ดึงชิ้นส่วนที่ต้องรันออกมาได้ครบ', !missing.length, 'ขาด: ' + missing.join(', '));

if (!missing.length) {
  const ENV = { ANTHROPIC_API_KEY: 'k', GEMINI_API_KEY: 'k' };
  // สร้าง context ใหม่ทุกเคส เพราะแต่ละเคส stub fetch ไม่เหมือนกัน
  function run(fetchStub) {
    // setTimeout: retry ของ chain รอ 1.5 วิ — ใน harness ให้ยิงทันทีไม่ต้องรอจริง
    const ctx = { console, fetch: fetchStub, Response, URL, setTimeout: fn => fn() };
    vm.createContext(ctx);
    vm.runInContext(pieces.join('\n') + '\nthis.__h = handleGeneralAI;', ctx);
    return ctx.__h;
  }
  const body = (provider) => ({ provider, modelKey: 'haiku', system: 's',
    messages: [{ role: 'user', content: 'hi' }], maxTokens: 20 });
  const read = async r => ({ status: r.status, body: JSON.parse(await r.text()) });

  // _callOneModel อ่าน body ด้วย res.text() ครั้งเดียวแล้วค่อย JSON.parse เอง
  // (กัน "body already read" ตอนต้องอ่านทั้งกรณีสำเร็จและกรณี error)
  const asRes = (ok, status, obj) => async () => ({ ok, status, text: async () => JSON.stringify(obj) });
  const okClaude = asRes(true, 200, { content: [{ type: 'text', text: 'สวัสดี' }] });
  const okGemini = asRes(true, 200, { candidates: [{ content: { parts: [{ text: 'สวัสดี' }] } }] });
  const dead = asRes(false, 404, { error: { message: 'model not found: ผีหลอก' } });

  (async () => {
    // 3a. ทางปกติ — ทั้งสอง provider ต้องคืน { text }
    let r = await read(await run(okClaude)(body('claude'), ENV));
    check('claude สำเร็จ → คืน { text } ที่มีข้อความจริง',
      r.status === 200 && r.body.text === 'สวัสดี', JSON.stringify(r));

    r = await read(await run(okGemini)(body('gemini'), ENV));
    check('gemini สำเร็จ → คืน { text } เหมือนกัน (เดิมคืน content[] ที่ client อ่านไม่เจอ)',
      r.status === 200 && r.body.text === 'สวัสดี', JSON.stringify(r));

    // 3b. ปลายทางพัง — ห้ามคืนค่าว่างเงียบๆ ต้องบอกสาเหตุ
    for (const p of ['claude', 'gemini']) {
      r = await read(await run(dead)(body(p), ENV));
      check(`${p} ปลายทางพัง → คืน error ที่มีสาเหตุจริง ไม่ใช่ { text: "" }`,
        r.status >= 400 && typeof r.body.error === 'string' &&
        /ผีหลอก/.test(r.body.error) && r.body.text !== '', JSON.stringify(r));
    }

    // 3c. รุ่นแรกตาย ต้องไล่ไปรุ่นสำรอง ไม่ใช่ตายยกระบบ
    let calls = 0;
    const firstDead = async (...a) => { calls++; return calls === 1 ? dead(...a) : okClaude(...a); };
    r = await read(await run(firstDead)(body('claude'), ENV));
    check('รุ่นแรกตาย → ตกไปรุ่นสำรองแล้วสำเร็จ',
      r.status === 200 && r.body.text === 'สวัสดี' && calls >= 2,
      `เรียก ${calls} ครั้ง · ${JSON.stringify(r)}`);

    // ── 4. ฝั่ง client ต้องไม่กลืนค่าว่าง ────────────────────────────────
    const callAiSrc = CI.slice(CI.indexOf('async function callAI(opts){'),
                               CI.indexOf('function setAiProvider('));
    check('client: ตอน !res.ok ดึงข้อความ error จาก JSON มาโชว์',
      /\.error/.test(callAiSrc) && /AI proxy/.test(callAiSrc));
    check('client: ได้ 200 แต่ข้อความว่าง = โยน error ไม่ปล่อยค่าว่างไหลเข้าหน้าจอ',
      /throw new Error\([^)]*ว่าง|ตอบกลับว่าง/.test(callAiSrc));

    console.log('\n' + (fail ? '❌' : '✅') +
      ' verify_ai_proxy_contract: ผ่าน ' + pass + ' · ไม่ผ่าน ' + fail);
    process.exit(fail ? 1 : 0);
  })();
} else {
  console.log('\n❌ verify_ai_proxy_contract: ผ่าน ' + pass + ' · ไม่ผ่าน ' + fail);
  process.exit(1);
}
