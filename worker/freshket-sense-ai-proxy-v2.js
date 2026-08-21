// Cloudflare Worker AI proxy for Freshket Sense — Echo v2 transcript
// freshket-sense-ai-proxy-v2.js
// v2: /transcript ใช้ Gemini 3.5 Flash audio-native (แทน Groq Whisper + Gemini Lite)
// /summarize /analyze /eval และ legacy routes คงเดิมทุกอย่าง
// ไฟล์นี้ deploy แยกจาก proxy เดิม — เปลี่ยน WORKER_URL ใน 09_conv_intel.js เพื่อ test
//
// Env secrets: ANTHROPIC_API_KEY, GROQ_API_KEY, GEMINI_API_KEY
//              SUPABASE_SERVICE_KEY (A2v2.1 — required by /process only; every
//              other endpoint works without it)
//              GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY,
//              GOOGLE_SHEETS_SPREADSHEET_ID (v_keyexport — Key SKU → Google
//              Sheets export only; scheduled() skips the export silently if
//              these are unset, everything else works without them)
//
// v4 (2026-06-15) — Echo v2 architecture per spec
//   /transcript  — audio → segments[] with segment_id + confidence (ground truth layer)
//   /summarize   — segments[] → summary + tone (insight layer)
//   /analyze     — segments[] + summary → skills + OCPB with segment_id evidence (insight layer)
//   /eval        — measure transcript quality against criteria
//   /analyze-audio (legacy) — kept, not deleted

// v_aifix (2026-08-08): สาย gemini 2.5 กำลังทยอยปิด (2.5 Pro ปิด ต.ค. 2026)
// และ claude-sonnet-4-6 ก็เป็นรุ่นเก่าแล้ว · บุชเคาะว่า "คงสองระดับ อัปเป็นรุ่น
// ใหม่ล่าสุดของแต่ละระดับ" — ระดับเร็ว/ถูกยังเป็น haiku (SKU matcher ยิงทีละตัว
// ปริมาณเยอะ) ระดับฉลาดขึ้นเป็น sonnet-5
const MODEL_MAP = {
  claude: { haiku: 'claude-haiku-4-5-20251001', sonnet: 'claude-sonnet-5' },
  gemini: {
    flash:      'gemini-3.5-flash',
    flash_lite: 'gemini-3.5-flash-lite',
    flash_35:   'gemini-3.5-flash',         // v2: used for transcript (audio-native)
  }
};

// รุ่นสำรองต่อระดับ — รุ่นแรกตายให้ไล่ลงตัวถัดไป ไม่ใช่ตายทั้งระบบ
// บทเรียน 2026-08-08: ช่องทาง AI กลางของ Sense ล้มทั้งยวงเพราะไม่มีสำรองเลย
// ชื่อรุ่นอิงเอกสารผู้ให้บริการ ณ ส.ค. 2026 · เช็คของจริงได้ที่ GET /models
const TEXT_MODEL_CHAIN = {
  claude: {
    haiku:  ['claude-haiku-4-5-20251001', 'claude-sonnet-5'],
    sonnet: ['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']
  },
  gemini: {
    haiku:  ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash'],
    sonnet: ['gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3.5-flash']
  }
};

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin':  env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(data, status = 200, env = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env) }
  });
}

// ── retry helper ─────────────────────────────────────────────────────────────
// v_queue (2026-08-12): เดิม fn คืน `null` เพื่อบอกว่า "ลองใหม่ได้" — แต่ null
// ไม่พกสาเหตุมาด้วย พอครบ 3 ครั้ง lastErr ยังเป็น undefined เลยโยนข้อความเปล่า
// 'All attempts failed' ออกไป · ผลคือ **429 (คิวรวมเต็ม ต้องรอเป็นชั่วโมง) กับ
// 503 (ปลายทางไม่ว่าง ลองใหม่ได้เลย) แยกกันไม่ออก** ทั้งที่ต้องปฏิบัติคนละแบบ
// ตอนนี้ให้คืน RETRY(status) แทน แล้วสาเหตุจะไหลไปถึง classifyFailure ได้
// (ยังรับ `null` แบบเดิมได้ เพื่อไม่ให้ call site ที่ยังไม่แก้พัง)
function RETRY(status, body) { return { __retry: true, status: status || 0, body: body || '' }; }

async function withRetry(fn, maxAttempts = 3, delays = [0, 2000, 5000]) {
  let lastErr = null, lastRetry = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, delays[attempt - 1] || 5000));
    try {
      const result = await fn(attempt);
      if (result && result.__retry) { lastRetry = result; continue; }
      if (result !== null) return result;
      lastRetry = lastRetry || RETRY(0);
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  const s = lastRetry && lastRetry.status;
  throw new Error('ปลายทางปฏิเสธทุกครั้ง (HTTP ' + (s || 'unknown') + ')' +
    (lastRetry && lastRetry.body ? ': ' + String(lastRetry.body).slice(0, 200) : ''));
}

// ── การจำแนกความล้มเหลว (v_queue) ────────────────────────────────────────
// บทเรียน 11-12 ส.ค.: pipeline ปฏิบัติกับความล้มเหลวทุกแบบเหมือนกันหมด คือ
// "ปล่อย claim แล้วให้ tick ถัดไปลองใหม่" — ซึ่งถูกสำหรับเน็ตล่ม แต่หายนะ
// สำหรับไฟล์ที่พังถาวร (วนตลอดกาล) และสำหรับ 429 (ยิ่งลองยิ่งตัน)
const FAIL_PERMANENT = 'permanent';   // ไม่มีวันสำเร็จ — ปิดคิว บอกผู้ใช้
const FAIL_THROTTLED = 'throttled';   // คิวรวมเต็ม ไม่ใช่ความผิดของงานนี้ — รอ
const FAIL_TRANSIENT = 'transient';   // น่าจะหายเอง — ถอยหลังแล้วลองใหม่

// โควตา Groq free เป็น "วินาทีเสียงต่อชั่วโมง" (7,200) — รอสั้นกว่าหน้าต่างนี้
// เท่ากับเดินเข้าไปโดน 429 ซ้ำแน่นอน
const THROTTLE_WAIT_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 4;
function backoffMs(attempts) {
  const mins = [10, 30, 120];
  return mins[Math.min(Math.max(attempts, 1), mins.length) - 1] * 60 * 1000;
}

function classifyFailure(err) {
  const msg = String((err && err.message) || err || '');
  // ── v_audiofix (2026-08-15): แยก "คำขอของเราเองผิด" ออกจาก "ไฟล์เสีย" ──
  // 14 ส.ค. bug ฝั่งเรา (prompt ยาวเกินเพดานไบต์) ทำให้ Groq ตอบ 400 แล้วโดน
  // เหมารวมเป็น "ไฟล์เสียงใช้ไม่ได้" → ปิดคิวถาวร งานที่กู้ได้ถูกฆ่าทิ้งเงียบๆ
  // ของแบบนี้ต้องลองใหม่ได้ เพราะพอแก้โค้ดแล้วมันจะผ่านทันที
  if (/prompt length|invalid[_ ]request|parameter|must be \d+ characters/i.test(msg)) {
    return { kind: FAIL_TRANSIENT, status: 400, ourFault: true };
  }
  // ไฟล์ที่ปลายทางอ่านไม่ออก / ไม่มีไฟล์ให้อ่าน = ลองอีกกี่ครั้งก็เหมือนเดิม
  if (/could not process file|invalid media|unsupported (file|format)|sbStorageGet 40[34]/i.test(msg)) {
    return { kind: FAIL_PERMANENT, status: 400 };
  }
  if (/\b429\b/.test(msg) || /rate.?limit|too many requests|quota/i.test(msg)) {
    return { kind: FAIL_THROTTLED, status: 429 };
  }
  const m = msg.match(/\b([45]\d\d)\b/);
  const status = m ? Number(m[1]) : 0;
  // 408/425 = จังหวะไม่ดี ไม่ใช่คำขอผิด · 4xx ที่เหลือ (401 key ผิด, 413 ใหญ่ไป)
  // ลองใหม่ก็ได้ผลเดิม
  if (status >= 400 && status < 500 && status !== 408 && status !== 425) {
    return { kind: FAIL_PERMANENT, status };
  }
  return { kind: FAIL_TRANSIENT, status };
}

// ── Supabase helpers (A2v2.1 async pipeline — service key, server-side only) ──
// /process runs after the rep has closed the app, so there is no user JWT.
// Requires worker secret SUPABASE_SERVICE_KEY (set in dashboard → Settings →
// Variables). All other endpoints work without it, exactly as before.
const SUPABASE_URL_DEFAULT = 'https://menslbnyyvpxiyvjywcm.supabase.co';
const AUDIO_BUCKET = 'ciq-data';

function _sbUrl(env)  { return env.SUPABASE_URL || SUPABASE_URL_DEFAULT; }
function _sbHeaders(env, extra) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    ...extra
  };
}
async function sbSelect(env, pathQuery) {
  const r = await fetch(`${_sbUrl(env)}/rest/v1/${pathQuery}`, { headers: _sbHeaders(env) });
  if (!r.ok) throw new Error(`sbSelect ${r.status}: ${await r.text().catch(() => '')}`);
  return r.json();
}
// Returns the updated rows (return=representation) so callers can detect
// 0-row claims (someone else owns the stage).
async function sbPatch(env, table, query, body) {
  const r = await fetch(`${_sbUrl(env)}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: _sbHeaders(env, { 'Content-Type': 'application/json', 'Prefer': 'return=representation' }),
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`sbPatch ${table} ${r.status}: ${await r.text().catch(() => '')}`);
  return r.json();
}
async function sbInsert(env, table, rows) {
  const r = await fetch(`${_sbUrl(env)}/rest/v1/${table}`, {
    method: 'POST',
    headers: _sbHeaders(env, { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }),
    body: JSON.stringify(rows)
  });
  if (!r.ok) throw new Error(`sbInsert ${table} ${r.status}: ${await r.text().catch(() => '')}`);
}
async function sbUpsert(env, table, row, onConflict) {
  const r = await fetch(`${_sbUrl(env)}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: _sbHeaders(env, { 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row)
  });
  if (!r.ok) throw new Error(`sbUpsert ${table} ${r.status}: ${await r.text().catch(() => '')}`);
}
async function sbDelete(env, table, query) {
  const r = await fetch(`${_sbUrl(env)}/rest/v1/${table}?${query}`, { method: 'DELETE', headers: _sbHeaders(env) });
  if (!r.ok) throw new Error(`sbDelete ${table} ${r.status}: ${await r.text().catch(() => '')}`);
}
async function sbStorageGet(env, path) {
  const r = await fetch(`${_sbUrl(env)}/storage/v1/object/${AUDIO_BUCKET}/${path}`, { headers: _sbHeaders(env) });
  if (!r.ok) throw new Error(`sbStorageGet ${r.status}: ${await r.text().catch(() => '')}`);
  return new Uint8Array(await r.arrayBuffer());
}
async function sbStorageDelete(env, path) {
  const r = await fetch(`${_sbUrl(env)}/storage/v1/object/${AUDIO_BUCKET}/${path}`, {
    method: 'DELETE', headers: _sbHeaders(env)
  });
  if (!r.ok) throw new Error(`sbStorageDelete ${r.status}`);
}
// v_cpudiet: _bytesToB64 ถูกถอดออก — มันคือฆาตกร exceededCpu บน Workers Free
// (สร้าง binary string ของไฟล์ 9-24MB = CPU เกิน 10ms แน่นอน) · เสียงดิบส่งเป็น
// body ของ fetch ตรงๆ ได้ทั้ง Groq (FormData) และ Gemini (Files API) โดยไม่ต้อง b64


// ── /transcript (v3 hybrid, 2026-07-21) ──────────────────────────────────────
// Groq Whisper (ถอดเสียง — หลักวินาที ถอดตรงตัว) + Gemini (ฟังเสียงจริงแต่ตอบ
// เฉพาะ "ประโยคไหนใครพูด" — output จิ๋ว = เร็ว)
//
// ทำไมเปลี่ยนจาก v2 (Gemini พิมพ์ transcript ทั้งบทเอง): พิสูจน์จาก app_errors
// จริง — visit ยาว 18-48 นาทีชน Cloudflare error 524 (~100s ceiling) ทุกครั้ง
// เพราะ Gemini ต้อง generate transcript ทั้งบทเป็น output tokens (หลายนาที
// สำหรับเสียงยาว) ส่วน Whisper เป็น ASR เฉพาะทาง ถอด 30 นาทีในหลัก 10-30 วิ
// และ Gemini ขั้นแยกคนพูด: อ่าน audio เป็น INPUT (เร็ว) + ตอบแค่ mapping
// (id→speaker) ไม่กี่ร้อย tokens — ทั้งสอง call อยู่ใต้เพดาน 524 สบายๆ
//
// Output format: segments[] หน้าตาเดิมทุก field — client ไม่ต้องแก้อะไรเลย
// source: 'groq_whisper_gemini_diarize' (ค่าที่ client รู้จักอยู่แล้ว) หรือ
// 'whisper_fallback' ถ้าขั้นแยกคนพูดพัง (ได้ transcript แต่ speaker='ไม่ทราบ')
// เส้น v2 เดิมยังอยู่ครบที่ /transcript-gemini สำหรับ A/B (tools/echo_ab_test.js)
function _b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function _fmtTs(sec) {
  const m = Math.floor((sec || 0) / 60), s = Math.floor((sec || 0) % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
async function handleTranscript(request, env) {
  if (!env.GROQ_API_KEY)   return json({ error: 'GROQ_API_KEY not set' }, 503, env);
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not set' }, 503, env);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }

  const { audio_b64, mime_type, duration_secs, account_name, sku_glossary } = body;
  if (!audio_b64) return json({ error: 'audio_b64 required' }, 400, env);

  try {
    const result = await runTranscribe(_b64ToBytes(audio_b64), mime_type, duration_secs, account_name, env, audio_b64, sku_glossary);
    return json({ text: JSON.stringify(result) }, 200, env);
  } catch (e) {
    return json({ error: e?.message || 'Transcript failed' }, 502, env);
  }
}

// A2v2.1: core extracted from handleTranscript so /process (async pipeline) can
// run the exact same logic server-side. Returns the result OBJECT (not a
// Response); throws on hard failure. audioB64 is optional — computed from
// bytes when absent (the async path only has bytes from storage).
// v_cpudiet (2026-08-12): อัปโหลดเสียงดิบเข้า Gemini Files API แทนการแปลง base64
//
// ทำไม: Workers Free plan ให้ CPU 10ms ต่อ invocation — _bytesToB64 ของไฟล์
// 9-24MB กินเกินนั้นแน่นอน ผลคือ cron ทุก tick โดนฆ่าด้วย outcome=exceededCpu
// (เห็นใน dashboard: error ทุก 2 นาทีตลอด 24 ชม. cpuTimeMs ชนเพดาน 10 พอดี)
// → pipeline เสียงค้างที่ 'uploaded' ทั้งหมด · การส่ง bytes ดิบเป็น body ของ
// fetch แทบไม่กิน CPU (runtime สตรีมให้เอง) จึงรอดใน 10ms ได้
// หมายเหตุ: ควรอัป Workers Paid ($5/เดือน = CPU 30 วิ) อยู่ดี — บุชรับทราบแล้ว
// ตัวนี้คือการลดความเสี่ยงเชิงโครงสร้าง ไม่ใช่ข้ออ้างให้อยู่ Free ตลอด
async function _geminiUploadAudio(env, bytes, mime) {
  const up = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'X-Goog-Upload-Protocol': 'raw', 'Content-Type': mime || 'audio/webm' },
      body: bytes
    });
  if (!up.ok) throw new Error(`Gemini file upload ${up.status}: ${await up.text().catch(() => '')}`);
  const meta = await up.json();
  const f = meta && meta.file;
  if (!f || !f.uri) throw new Error('Gemini file upload: no uri in response');
  // ไฟล์เสียงต้องผ่านสถานะ PROCESSING ก่อนใช้ได้ — โพลจนกว่า ACTIVE (I/O ล้วน แทบไม่กิน CPU)
  let state = f.state, name = f.name;
  for (let i = 0; i < 20 && state === 'PROCESSING'; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const chk = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}?key=${env.GEMINI_API_KEY}`);
    if (!chk.ok) break;
    const d = await chk.json().catch(() => null);
    state = d && d.state;
  }
  if (state !== 'ACTIVE') throw new Error(`Gemini file state=${state} (ไม่พร้อมใช้)`);
  return { uri: f.uri, name };
}

// v_filecleanup (2026-08-17): Google เองก็ล้างไฟล์ที่ไม่ได้สั่งลบทิ้งให้ใน ~48 ชม.
// (เพดานเดียวกับที่ file_uri หมดอายุ) ดังนั้นนี่ไม่ใช่ตัวกันไฟล์ค้างถาวร — แต่ลด
// ปริมาณไฟล์ที่ค้างอยู่บนโควตาฝั่ง Google ระหว่างรอ 48 ชม. นั้น best-effort ล้วน
// (การลบพลาดไม่ควรทำให้ pipeline หลักพัง — Google เก็บกวาดเองอยู่แล้วเป็นตาข่ายรอง)
async function _geminiDeleteFile(env, name) {
  if (!name) return;
  try {
    await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}?key=${env.GEMINI_API_KEY}`,
      { method: 'DELETE' });
  } catch (_) { /* best-effort — 48h TTL ฝั่ง Google เป็นตาข่ายรอง */ }
}

// ── v_audiofix (2026-08-15): วัดความยาวเป็นไบต์ ไม่ใช่ตัวอักษร ──────────────
// ผู้ให้บริการทุกเจ้าที่ประกาศเพดาน "characters" จริงๆ แล้ววัดเป็นไบต์ UTF-8
// ซึ่งภาษาไทยกิน 3 ไบต์ต่อตัว — การใช้ .length / .slice() จึงนับต่ำกว่าจริง 3 เท่า
function _utf8Bytes(str) {
  return new TextEncoder().encode(String(str || '')).length;
}
// ตัดให้พอดีเพดานไบต์ โดยไม่ตัดกลางตัวอักษร (ตัดกลางแล้วจะได้ตัวอักษรพัง)
function _clampBytes(str, maxBytes) {
  const s = String(str || '');
  if (_utf8Bytes(s) <= maxBytes) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (_utf8Bytes(s.slice(0, mid)) <= maxBytes) lo = mid; else hi = mid - 1;
  }
  return s.slice(0, lo).trim();
}

// เพดานขนาดไฟล์ของ Groq = 25MB · วัดจากของจริง 14 ส.ค.: 25.6MB โดน 413,
// 19.0MB ผ่าน · ของเดิมไม่เคยเช็คก่อนยิงเลย ทำให้ไฟล์ใหญ่ถูกตีตรา "ไฟล์เสีย"
// แล้วปิดคิวถาวร ทั้งที่ไฟล์ดีทุกอย่าง แค่ตัวถอดปัจจุบันรับไม่ไหว
const GROQ_MAX_AUDIO_BYTES = 24 * 1024 * 1024;
class AudioTooLargeForGroq extends Error {
  constructor(bytes) {
    super(`ไฟล์เสียง ${(bytes / 1048576).toFixed(1)}MB เกินขีดของตัวถอดปัจจุบัน (24MB) — รอเส้นทาง Gemini`);
    this.name = 'AudioTooLargeForGroq';
    this.tooLarge = true;
  }
}

// ── v_usability (2026-08-21): ตัวเลขที่โชว์เป็น "ความมั่นใจ" ต้องบอกได้ว่า *ผลใช้ได้
// จริงแค่ไหน* ไม่ใช่ค่าที่โมเดลเดาความมั่นใจตัวเอง
//
// ของเดิมสองฝั่งใช้ค่าที่ไม่เกี่ยวกับความใช้ได้เลย: ฝั่ง Whisper = ค่าเฉลี่ยของ
// exp(avg_logprob) รายท่อน · ฝั่ง Gemini = สัดส่วนท่อนที่ไม่ติดป้าย [ฟังไม่ชัด]
// ทั้งสองแยก "งานที่ใช้ได้" ออกจาก "งานที่พัง" ไม่ออก — หลักฐานจากของจริง:
// session 19 ส.ค. 14:06 (บุชยืนยันเองว่าผลแม่น) ได้ 0.56 แต่ 21 ส.ค. 14:09 ที่ถอดได้
// แค่ 27% ของคลิป ได้ 0.53 · ใกล้กันจนป้ายเตือนไม่มีประโยชน์
//
// สองตัวแปรที่แยกได้จริงจากข้อมูล 14-21 ส.ค.:
//   (1) ครอบคลุมกี่ % ของคลิป (งานพังจริงร่วงถึง 27-63%)
//   (2) ท่อนต่อนาทีของช่วงที่ถอดได้ (งานดี 5.0-13.7 · งานบาง 2.1-3.1)
// คูณกันแล้วตรวจกับ session จริงทุกตัวในชุดนั้น แยกถูกหมด (ดู tools/verify_listen_switch.js)
const USABILITY_TARGET_SEG_PER_MIN = 6;
function _usabilityScore(segments, durationSecs, unclearCount) {
  const segs = segments || [];
  if (!segs.length || !durationSecs) return null;
  let lastEnd = 0;
  for (const s of segs) {
    // ฝั่ง Whisper มี end_sec · ฝั่ง Gemini มีแต่ ts (ไม่มี end_sec) จึงถอยไปอ่าน ts
    const e = (typeof s.end_sec === 'number' && s.end_sec > 0) ? s.end_sec : _abTsToSec(s && s.ts);
    if (typeof e === 'number' && e > lastEnd) lastEnd = e;
  }
  if (!lastEnd) return null;
  const coverage   = Math.max(0, Math.min(1, lastEnd / durationSecs));
  const coveredMin = lastEnd / 60;
  const density    = coveredMin > 0 ? segs.length / coveredMin : 0;
  const densityScore = Math.max(0, Math.min(1, density / USABILITY_TARGET_SEG_PER_MIN));
  const clarity    = segs.length ? 1 - (Math.max(0, unclearCount || 0) / segs.length) : 1;
  return Math.round(coverage * densityScore * clarity * 1000) / 1000;
}

async function runTranscribe(audioBytes, mimeType, durationSecs, accountName, env, audioB64, skuGlossary) {
  const account_name = accountName;
  const _audioBytesLen = audioBytes && (audioBytes.byteLength ?? audioBytes.length);
  if (_audioBytesLen > GROQ_MAX_AUDIO_BYTES) throw new AudioTooLargeForGroq(_audioBytesLen);
  const mime_type = mimeType;
  const duration_secs = durationSecs;
  // v_cpudiet: ห้ามแปลง b64 ที่นี่อีก — ดูคอมเมนต์ _geminiUploadAudio
  // (audioB64 ยังรับไว้เพื่อเส้นทาง legacy /transcript ที่ client ส่ง b64 มาแล้ว)

  // ── Step 1: Groq Whisper — verbatim transcription with real timestamps ──
  const groqForm = new FormData();
  groqForm.append('file', new Blob([audioBytes], { type: mime_type || 'audio/webm' }), 'recording.webm');
  groqForm.append('model', 'whisper-large-v3');
  groqForm.append('language', 'th');
  // Phase A0 (2026-08-05): initial_prompt is Whisper's standard way to bias
  // spelling of unfamiliar proper nouns — real example that motivated this:
  // a store's branch name got transcribed 2 different ways in the same
  // session because it wasn't in the (previously static) prompt vocabulary.
  // account_name is per-visit and known client-side at record time, so we
  // fold it into the prompt dynamically instead of a single fixed string.
  //
  // v_ears (2026-08-14) เขียนใหม่ทั้งท่อน — บทเรียนจากข้อมูลจริง:
  //
  // Whisper ตีความ `prompt` ว่าเป็น "บทที่ถอดมาก่อนหน้านี้" แล้วเขียนต่อ ไม่ใช่
  // คำสั่ง · prompt เดิมเขียนเป็นประโยคสมบูรณ์ ("บทสนทนาภาษาไทยระหว่าง…") จึง
  // ชวนให้มันคายกลับมาเป็นบทพูด · วัดจริง 14 ส.ค.: โผล่ใน transcript 60 ท่อน
  // จาก 16 ใน 52 session และ 17 ท่อนได้ conf > 0.8 (สูงสุด 0.96) = ตัววัดความ
  // มั่นใจจับไม่ได้เลย
  //
  // เขียนใหม่เป็น **รายการคำล้วน ไม่มีประโยค** — ไม่มีอะไรให้ "เขียนต่อ"
  // และเติม glossary ชื่อสินค้าจริงของร้านนั้น (client ส่งมา ดู _skuGlossaryFor)
  // ซึ่งเป็นของที่มีอยู่แล้วแต่ไม่เคยเอามาใช้เลย
  //
  // ⚠ v_audiofix (2026-08-15) — บทเรียนราคาแพง: **Groq วัดความยาว prompt เป็นไบต์
  // ไม่ใช่ตัวอักษร** แต่ของเดิมคุมด้วย .slice() ซึ่งนับเป็นตัวอักษร
  // ภาษาไทย 1 ตัวอักษร = 3 ไบต์ ใน UTF-8 → prompt ที่ JS บอกว่า 364 ตัวอักษร
  // จริงๆ คือ 1,012 ไบต์ เทียบเพดาน 896 ที่ Groq บังคับ
  // ผล: 14 ส.ค. **ทุก session ที่ร้านมีข้อมูลสินค้า ถูกปฏิเสธทั้งคำขอ**
  //   (400 "prompt length must be 896 characters or fewer, provided 932/980")
  //   ไม่เกี่ยวกับความยาวคลิปเลย — คลิป 4 นาทีก็ตาย
  // จึงต้องคุมเป็นไบต์ และตัด glossary เป็นส่วนแรกที่ยอมสละ (ชื่อร้าน + คำเฉพาะ
  // สำคัญกว่า เพราะเป็นตัวที่ทำให้ชื่อสาขาถอดตรงกันทั้ง session)
  const GROQ_PROMPT_MAX_BYTES = 800;   // เพดานจริง 896 — เผื่อไว้ 96
  const promptParts = ['Freshket', 'ออเดอร์', 'เครดิต', 'วางบิล', 'ใบเสนอราคา', 'กิโล', 'ลัง'];
  const safeAccountName = _clampBytes(String(account_name || '').trim(), 120);
  if (safeAccountName) promptParts.push(safeAccountName);
  const glossaryBudget = GROQ_PROMPT_MAX_BYTES - _utf8Bytes(promptParts.join(' ')) - 1;
  const safeGlossary = glossaryBudget > 30
    ? _clampBytes(String(skuGlossary || '').trim(), glossaryBudget)
    : '';
  if (safeGlossary) promptParts.push(safeGlossary);
  let dynamicPrompt = promptParts.join(' ');
  // กันชนสุดท้าย: ถ้ายังเกินอยู่ (ชื่อร้านยาวผิดปกติ) ยอมส่ง prompt สั้นลง
  // ดีกว่าปล่อยให้ Groq ปฏิเสธทั้งคำขอแล้วเสียบทสนทนาไปทั้งอัน
  if (_utf8Bytes(dynamicPrompt) > GROQ_PROMPT_MAX_BYTES) {
    dynamicPrompt = _clampBytes(dynamicPrompt, GROQ_PROMPT_MAX_BYTES);
    console.warn(`[transcribe] prompt ยังเกินหลังตัด glossary — ตัดซ้ำเหลือ ${_utf8Bytes(dynamicPrompt)} ไบต์`);
  }
  groqForm.append('prompt', dynamicPrompt);
  // temperature 0 = เลิกให้มันเดาแบบสร้างสรรค์ตอนเสียงไม่ชัด (ค่า default ของ
  // Whisper คือไล่ 0→0.2→…→1.0 เมื่อ decode ไม่ผ่านเกณฑ์ ซึ่งเป็นบ่อเกิดของ
  // ประโยคที่ฟังดูลื่นแต่ไม่มีใครพูด)
  groqForm.append('temperature', '0');
  groqForm.append('response_format', 'verbose_json');
  groqForm.append('timestamp_granularities[]', 'segment');

  let groqData;
  try {
    // v_queue: ยิงครั้งเดียวต่อ 1 รอบคิว — **ห้ามเพิ่มกลับเป็น 3**
    // โควตา Groq free คิดเป็น "วินาทีเสียง" ไม่ใช่จำนวนคำขอ · คลิป 19 นาที =
    // 1,140 วินาที ยิง 3 ครั้ง = 3,420 วินาทีต่อ tick เทียบโควตา 7,200/ชม.
    // ของเดิม (3 ครั้ง × 3 session × ทุก 2 นาที) เผาโควตาหมดตั้งแต่ต้นชั่วโมง
    // จนไฟล์ที่ดีก็ถอดไม่ผ่าน — ยืนยันกับข้อมูลจริงแล้ว 12 ส.ค.
    // การลองใหม่เป็นหน้าที่ของคิว (next_attempt_at) ไม่ใช่ของ loop ตรงนี้
    const groqRes = await withRetry(async () => {
      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
        body: groqForm
      });
      if (r.ok) return r;
      const body = await r.text().catch(() => '');
      if (r.status === 503 || r.status === 429) return RETRY(r.status, body);
      throw new Error(`Groq ${r.status}: ${body}`);
    }, 1);
    groqData = await groqRes.json();
  } catch (e) {
    throw new Error('Groq transcribe failed: ' + (e?.message || 'unknown'));
  }

  // v_transcribegap (2026-08-20): Groq บางครั้งตอบ 200 OK แต่ transcript หยุด
  // กลางคันเงียบๆ — ไม่ error ไม่ reject แค่ segments สุดท้ายจบก่อนความยาวคลิป
  // จริงมาก เจอจากข้อมูลจริง: สุ่ม 20 session ยาว (>15 นาที) ที่ใช้ whisper_fallback
  // 3 ใน 20 (15%) ขาดไปเกิน 10% ของความยาว — หนักสุดขาดไป 37% (2501 วิ เหลือแค่
  // 1570 วิ) และ 27% (2829 วิ เหลือแค่ 2070 วิ) เนื้อหาบทสนทนาจริงหายไปเงียบๆ
  // ก่อนถึงขั้น analyze ด้วยซ้ำ — pipeline_stage ยังขึ้น 'analyzed' ปกติ ทั้งที่
  // ไม่ครบ ไม่มีทางรู้เลยถ้าไม่เทียบ duration_secs กับ segment สุดท้ายเอง
  //
  // แก้: เทียบ timestamp ท่อนสุดท้ายกับความยาวคลิปจริง ถ้าขาดเกินเกณฑ์ ลองใหม่
  // อีก "ครั้งเดียว" (ไม่ใช่ 3 — โควตา Groq คิดเป็นวินาทีเสียง ตามบทเรียน 12 ส.ค.
  // ข้างบน) แล้วเลือกผลที่ครอบคลุมมากกว่า ไม่มีทางกู้ท่อนที่หายมาได้ถ้าลองซ้ำแล้ว
  // ยังขาดเหมือนเดิม แต่อย่างน้อยก็ไม่ปล่อยผ่านเงียบๆ โดยไม่ลองเลยสักครั้ง
  const GROQ_GAP_FLOOR_SEC = 60;     // ต่ำกว่านี้ถือเป็นความเงียบท้ายคลิปปกติ
  const GROQ_GAP_RATIO = 0.10;       // หรือเกิน 10% ของความยาวคลิป แล้วแต่ค่าไหนมากกว่า
  function _lastSegEnd(gd) {
    const segs = gd?.segments || [];
    return segs.length ? Math.max(...segs.map(s => s.end || 0)) : 0;
  }
  // v_gapscore (2026-08-21): ตัวเลือกผลรอบสองของเดิมเทียบแค่ timestamp ท่อนสุดท้าย
  // (`_retryGap < _firstGap`) → รอบสองที่ "ไปถึงท้ายกว่าแต่บางกว่า" ทับรอบแรกที่ละเอียด
  // กว่าได้ · เจอจริง: Dent 21 ส.ค. 12:54 (47.6 นาที) ได้ครอบคลุมเพิ่ม 8% แต่จำนวนท่อน
  // หายไป 49% เทียบกับคลิปยาวเท่ากันของคนเดียวกันเมื่อ 19 ส.ค. (224 → 115 ท่อน)
  // เกณฑ์ใหม่ = คะแนนเดียวกับ _usabilityScore (ครอบคลุม × ความละเอียด) ใช้รอบสอง
  // เฉพาะเมื่อคะแนนรวมดีกว่าจริง ไม่ใช่แค่ไปถึงนาทีท้ายกว่า
  function _groqCoverScore(gd) {
    const segs = (gd && gd.segments) || [];
    if (!segs.length || !duration_secs) return 0;
    const end = _lastSegEnd(gd);
    if (!end) return 0;
    const coverage = Math.max(0, Math.min(1, end / duration_secs));
    const density  = (end / 60) > 0 ? segs.length / (end / 60) : 0;
    return coverage * Math.max(0, Math.min(1, density / USABILITY_TARGET_SEG_PER_MIN));
  }
  const _gapThreshold = Math.max(GROQ_GAP_FLOOR_SEC, (duration_secs || 0) * GROQ_GAP_RATIO);
  const _firstGap = (duration_secs || 0) - _lastSegEnd(groqData);
  if (_firstGap > _gapThreshold) {
    console.warn(`[transcribe] ท่อนสุดท้ายจบที่ ${_lastSegEnd(groqData).toFixed(0)}s แต่คลิปยาว ${duration_secs}s (ขาด ${_firstGap.toFixed(0)}s) — ลองใหม่อีกครั้ง`);
    try {
      const retryRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
        body: groqForm
      });
      if (retryRes.ok) {
        const retryData = await retryRes.json();
        const _retryGap = (duration_secs || 0) - _lastSegEnd(retryData);
        const _s1 = _groqCoverScore(groqData), _s2 = _groqCoverScore(retryData);
        const _n1 = (groqData.segments || []).length, _n2 = (retryData.segments || []).length;
        if (_s2 > _s1) {
          console.warn(`[transcribe] รอบสองดีกว่าจริง (คะแนน ${_s2.toFixed(3)} > ${_s1.toFixed(3)} · ` +
            `ขาดเหลือ ${_retryGap.toFixed(0)}s จาก ${_firstGap.toFixed(0)}s · ท่อน ${_n2} จาก ${_n1}) — ใช้ผลรอบสองแทน`);
          groqData = retryData;
        } else {
          console.warn(`[transcribe] รอบสองไม่ได้ดีขึ้น (คะแนน ${_s2.toFixed(3)} ≤ ${_s1.toFixed(3)} · ` +
            `ท่อน ${_n2} เทียบ ${_n1}) — ใช้ผลรอบแรกต่อ`);
        }
      }
    } catch (e) {
      console.warn('[transcribe] ลองใหม่รอบสองล้มเหลว — ใช้ผลรอบแรกต่อ:', e?.message || e);
    }
  }

  // Whisper hallucination guard: drop segments Whisper itself flags as
  // probably-not-speech AND low-confidence (its classic invent-text-on-
  // silence failure mode — restaurant background noise triggers it).
  // v_ears: ตะแกรงชั้นสอง — ท่อนที่ "เป็นคำใน prompt ล้วนๆ" คือ prompt รั่ว
  // ไม่ใช่เสียงคน · เช็คด้วยสัดส่วนคำที่ทับกับ prompt เพราะ conf สูงจับไม่ได้
  // (บางท่อนได้ 0.96) · เกณฑ์ 0.6 = คำในท่อนนั้นมาจาก prompt เกินครึ่ง
  const _promptWords = new Set(
    dynamicPrompt.toLowerCase().split(/[\s,]+/).filter(w => w.length >= 3)
  );
  const _HALLUCINATION_PHRASES = [
    'โปรดติดตามตอนต่อไป',   // ติดมาจาก subtitle YouTube — คลาสสิกของ Whisper
    'ขอบคุณที่รับชม',
    'subscribe',
  ];
  function _looksLikePromptEcho(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    if (_HALLUCINATION_PHRASES.some(p => t.toLowerCase().includes(p.toLowerCase()))) return true;
    const words = t.toLowerCase().split(/[\s,]+/).filter(w => w.length >= 3);
    if (words.length < 3) return false;
    const hits = words.filter(w => _promptWords.has(w)).length;
    return (hits / words.length) >= 0.6;
  }
  let _echoDropped = 0;
  const rawSegs = (groqData.segments || []).filter(s => {
    const txt = (s.text || '').trim();
    if (!txt) return false;
    if ((s.no_speech_prob || 0) > 0.9 && (s.avg_logprob || 0) < -1) return false;
    if (_looksLikePromptEcho(txt)) { _echoDropped++; return false; }
    return true;
  });
  if (_echoDropped) console.log(`[transcribe] ตัดท่อนที่เป็น prompt รั่ว ${_echoDropped} ท่อน`);
  if (!rawSegs.length) {
    return {
      no_speech: true, segments: [], speakers_detected: [],
      duration_mins: 0, source: 'groq_whisper_v3', avg_speaker_confidence: 0, avg_transcript_confidence: 0
    };
  }

  const segments = rawSegs.map((s, i) => ({
    segment_id: i,
    ts: _fmtTs(s.start),
    start_sec: s.start || 0,
    end_sec: s.end || 0,
    speaker: 'ไม่ทราบ',
    text: (s.text || '').trim(),
    speaker_confidence: 0,
    // avg_logprob → rough 0..1 confidence (exp of mean token logprob)
    transcript_confidence: Math.max(0, Math.min(1, Math.exp(s.avg_logprob || -0.3)))
  }));

  // ── Step 2: Gemini — hears the REAL audio, assigns speakers only ────────
  // Output is a tiny id→speaker mapping (hundreds of tokens), so this call
  // stays fast regardless of visit length.
  // v_ears (2026-08-14): เลิกห้าม Gemini แก้คำ
  //
  // ของเดิมสั่ง "ห้ามแก้ text" แล้วใช้ Gemini แค่แปะชื่อคนพูด — ทั้งที่มันได้ยิน
  // เสียงจริงชุดเดียวกันและหูดีกว่า Whisper กับภาษาไทย เท่ากับจ่ายค่าโมเดลแพง
  // แล้วใช้แค่ 10% ของสิ่งที่มันทำได้
  //
  // แต่ปล่อยให้แก้ทั้งหมดก็อันตราย (มันจะ "เกลา" จนเพี้ยนจากที่ลูกค้าพูดจริง)
  // จึงล็อกไว้ 3 ชั้น: แก้ได้เฉพาะท่อนที่ Whisper เองไม่มั่นใจ (conf < 0.5) ·
  // ต้องมั่นใจจากเสียงจริงเท่านั้น ห้ามเดาจากบริบท · ทุกคำที่แก้ถูกตีตรา
  // corrected=true เก็บ text เดิมไว้คู่กัน เพื่อให้ตรวจย้อนได้เสมอ
  const LOW_CONF_EDIT_THRESHOLD = 0.5;
  const segLines = segments.map(s =>
    `[${s.segment_id}] [${s.ts}]${s.transcript_confidence < LOW_CONF_EDIT_THRESHOLD ? ' (ไม่ชัด)' : ''} ${s.text}`
  ).join('\n');
  const diarizePrompt = `ฟัง audio แล้วทำ 2 อย่างกับ transcript ข้างล่าง

บริบท: สนทนาระหว่าง Sales rep ของ Freshket (จำหน่ายวัตถุดิบอาหาร) กับเจ้าของร้านอาหาร
speaker ที่ใช้ได้: "Sales" = คนขาย Freshket, "ลูกค้า" = ฝั่งร้าน (ถ้าได้ยินชื่อจริง เช่น "คุณมาลี" ใช้ชื่อนั้นแทน "ลูกค้า" ได้)

งานที่ 1 — ระบุคนพูดของทุก segment

งานที่ 2 — แก้คำเฉพาะ segment ที่ติดป้าย (ไม่ชัด) เท่านั้น
- แก้ได้ต่อเมื่อ **ฟังจากเสียงจริงแล้วมั่นใจ** ว่าคำที่ถูกคืออะไร
- ห้ามเดาจากบริบท ห้ามเกลาสำนวน ห้ามเติมคำที่ไม่ได้ยิน ห้ามตัดคำที่ได้ยิน
- ถ้าฟังแล้วยังไม่ชัด **ไม่ต้องส่ง corrected_text มา** (ปล่อยของเดิมไว้ดีกว่าเดาผิด)
- segment ที่ไม่มีป้าย (ไม่ชัด) ห้ามแตะเด็ดขาด

TRANSCRIPT (ถอดจาก audio เดียวกันนี้ — ห้ามเพิ่ม/ลบ segment):
${segLines}

ตอบ JSON เท่านั้น ไม่มี markdown:
{
  "assignments": [
    { "id": 0, "speaker": "Sales", "confidence": 0.9 },
    { "id": 7, "speaker": "ลูกค้า", "confidence": 0.8, "corrected_text": "ถุงใส ยาว 22 เซนติเมตร" }
  ],
  "speakers_detected": ["Sales", "ลูกค้า"]
}`;

  let diarized = false, speakersDetected = [];
  let _diarizeFileName = null;   // v_filecleanup: ไฟล์ครั้งเดียวจบ — ลบทิ้งหลังใช้เสร็จ
  try {
    // v_cpudiet: เส้นทาง async (cron/process) ไม่มี b64 — อัปโหลดไฟล์ดิบแล้วอ้าง
    // ด้วย file_data · เส้นทาง legacy (/transcript) client ส่ง b64 มาอยู่แล้ว
    // ใช้ inline_data ต่อได้ฟรีๆ ไม่ต้องแปลงซ้ำ
    let audioPart;
    if (audioB64) {
      audioPart = { inline_data: { mime_type: mime_type || 'audio/webm', data: audioB64 } };
    } else {
      const uploaded = await _geminiUploadAudio(env, audioBytes, mime_type);
      _diarizeFileName = uploaded.name;
      audioPart = { file_data: { mime_type: mime_type || 'audio/webm', file_uri: uploaded.uri } };
    }
    const gemRes = await withRetry(async () => {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_MAP.gemini.flash_35}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              audioPart,
              { text: diarizePrompt }
            ]}],
            generationConfig: { temperature: 0.1, maxOutputTokens: 16384, responseMimeType: 'application/json' }
          })
        }
      );
      if (r.ok) return r;
      if (r.status === 503 || r.status === 429) return RETRY(r.status);   // v_queue: พกสถานะไปด้วย
      throw new Error(`Gemini diarize ${r.status}`);
    }, 3, [0, 2000, 5000]);
    const gemData = await gemRes.json();
    const rawText = gemData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let parsed;
    try { parsed = JSON.parse(rawText); }
    catch (_) {
      const s = rawText.indexOf('{'), e = rawText.lastIndexOf('}');
      if (s !== -1 && e !== -1) { try { parsed = JSON.parse(rawText.slice(s, e + 1)); } catch (_) {} }
    }
    if (parsed && Array.isArray(parsed.assignments)) {
      const byId = {};
      parsed.assignments.forEach(a => { if (a && a.id != null) byId[a.id] = a; });
      let _corrected = 0;
      segments.forEach(s => {
        const a = byId[s.segment_id];
        if (!a) return;
        if (a.speaker) {
          s.speaker = a.speaker;
          s.speaker_confidence = Math.max(0, Math.min(1, Number(a.confidence) || 0.5));
        }
        // v_ears: รับคำที่แก้ — เฉพาะท่อนที่เข้าเกณฑ์จริงเท่านั้น กันโมเดล
        // แถมมาเกินขอบเขตที่สั่งไว้ · เก็บ text เดิมไว้เสมอเพื่อให้ย้อนดูได้
        const fix = typeof a.corrected_text === 'string' ? a.corrected_text.trim() : '';
        if (fix && fix !== s.text && s.transcript_confidence < LOW_CONF_EDIT_THRESHOLD) {
          s.text_original = s.text;
          s.text = fix;
          s.corrected = true;
          _corrected++;
        }
      });
      if (_corrected) console.log(`[transcribe] Gemini แก้คำที่ Whisper ไม่มั่นใจ ${_corrected} ท่อน`);
      speakersDetected = Array.isArray(parsed.speakers_detected) ? parsed.speakers_detected : [];
      diarized = segments.some(s => s.speaker !== 'ไม่ทราบ');
    }
  } catch (e) {
    // Diarize failure is non-fatal — the verbatim transcript is the ground
    // truth; ship it with unknown speakers (client already handles
    // 'whisper_fallback').
    // v_cpudiet: แต่ห้ามเงียบ — log ไว้ให้เห็นใน observability ว่าตกชั้นเพราะอะไร
    console.error('[transcribe] diarize ล้มเหลว (non-fatal):', (e && e.message) || e);
  } finally {
    // v_filecleanup: ไฟล์นี้ใช้ครั้งเดียวจบภายใน call นี้ (ไม่ข้าม tick เหมือน
    // runListenStep) — ลบทิ้งได้ทันทีไม่ว่าสำเร็จหรือพัง
    if (_diarizeFileName) await _geminiDeleteFile(env, _diarizeFileName);
  }

  const n = segments.length;
  return {
    no_speech: false,
    segments,
    speakers_detected: speakersDetected.length ? speakersDetected : [...new Set(segments.map(s => s.speaker))],
    duration_mins: Math.round((duration_secs || segments[n - 1].end_sec || 0) / 60),
    source: diarized ? 'groq_whisper_gemini_diarize' : 'whisper_fallback',
    avg_speaker_confidence: n ? segments.reduce((a, s) => a + s.speaker_confidence, 0) / n : 0,
    // v_usability: เดิมเป็นค่าเฉลี่ยของ exp(avg_logprob) รายท่อน = Whisper เดาความมั่นใจ
    // ตัวเอง ซึ่งไม่บอกอะไรเรื่องความใช้ได้ (ดูเหตุผลเต็มที่ _usabilityScore) · ค่ารายท่อน
    // ยังคงไว้ครบใน segments[].transcript_confidence — ตัวกรอง hallucination กับด่าน
    // LOW_CONF_EDIT_THRESHOLD ของ diarize ยังใช้ค่าเดิมนั้นเหมือนเดิม ไม่กระทบ
    avg_transcript_confidence: _usabilityScore(segments, duration_secs, 0)
  };
}

// ── /transcript-gemini (v2 path, kept for A/B comparison) ────────────────────
// Gemini 3.5 Flash single call — ฟัง audio โดยตรง, transcript + diarization ในครั้งเดียว
// ⚠️ known limit: visit ยาว >~15 นาที เสี่ยงชน Cloudflare 524 (ดู v3 note ด้านบน)
async function handleTranscriptGeminiFull(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not set' }, 503, env);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }

  const { audio_b64, mime_type, duration_secs } = body;
  if (!audio_b64) return json({ error: 'audio_b64 required' }, 400, env);

  const diarizePrompt = `ฟัง audio การสนทนาแล้วถอด transcript พร้อมแยก speaker

บริบท: สนทนาระหว่าง Sales rep ของ Freshket (จำหน่ายวัตถุดิบอาหาร) กับเจ้าของร้านอาหาร
ภาษา: ไทย (อาจมีคำอังกฤษปน เช่น Freshket, SKU, delivery, order, kilo)

กฎสำคัญ:
1. ถอด text ตรงตามที่ได้ยินเท่านั้น ห้ามเติมหรือคาดเดา
2. speaker "Sales" = คนขาย Freshket, "ลูกค้า" = เจ้าของร้าน
3. ถ้าได้ยินชื่อจริงให้ใช้ชื่อนั้น เช่น "คุณมาลี" แทน "ลูกค้า"
4. ถ้าได้ยินไม่ชัดหรือไม่แน่ใจ — ให้ใส่ [ไม่ชัด] แทน ห้ามแต่งคำ
5. speaker_confidence: ความมั่นใจว่าระบุคนพูดถูก (0.0-1.0)
6. transcript_confidence: ความมั่นใจว่าถอด text ถูก (0.0-1.0)
7. ถ้าไม่มีเสียงคนพูดเลย ตอบ {"no_speech": true} เท่านั้น

ตอบ JSON เท่านั้น ไม่มี markdown:
{
  "no_speech": false,
  "segments": [
    {
      "segment_id": 0,
      "ts": "00:00",
      "start_sec": 0.0,
      "end_sec": 4.2,
      "speaker": "Sales",
      "text": "...",
      "speaker_confidence": 0.92,
      "transcript_confidence": 0.95
    }
  ],
  "speakers_detected": ["Sales", "ลูกค้า"],
  "duration_mins": 0,
  "avg_speaker_confidence": 0.0,
  "avg_transcript_confidence": 0.0
}`;

  const geminiBody = JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: mime_type || 'audio/webm', data: audio_b64 } },
        { text: diarizePrompt }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 65536,
      responseMimeType: 'application/json'
    }
  });

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, attempt === 2 ? 3000 : 8000));
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: geminiBody }
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => String(res.status));
        lastErr = new Error(`Gemini transcript ${res.status}: ${errText}`);
        if (res.status !== 503 && res.status !== 429) break;
        continue;
      }
      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // parse JSON
      let parsed;
      try { parsed = JSON.parse(rawText); }
      catch(_) {
        // fallback: ลอง extract JSON จาก raw
        const s = rawText.indexOf('{'), e = rawText.lastIndexOf('}');
        if (s !== -1 && e !== -1) {
          try { parsed = JSON.parse(rawText.slice(s, e+1)); } catch(_) {}
        }
      }

      if (!parsed) {
        lastErr = new Error('Gemini transcript: JSON parse failed');
        continue;
      }

      // no speech
      if (parsed.no_speech) {
        return json({ text: JSON.stringify({
          no_speech: true, segments: [], speakers_detected: [],
          duration_mins: 0, source: 'gemini-3.5-flash', avg_speaker_confidence: 0, avg_transcript_confidence: 0
        })}, 200, env);
      }

      // tag source
      parsed.source = 'gemini-3.5-flash';
      parsed.duration_mins = parsed.duration_mins || Math.round((duration_secs || 0) / 60);

      return json({ text: JSON.stringify(parsed) }, 200, env);

    } catch(e) {
      lastErr = e;
    }
  }

  return json({ error: lastErr?.message || 'Gemini transcript failed' }, 502, env);
}

async function handleSummarize(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not set' }, 503, env);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }

  const { segments } = body;
  if (!segments || !segments.length) return json({ error: 'segments required' }, 400, env);

  try {
    const { rawText } = await runSummarize(segments, env);
    return json({ text: rawText }, 200, env);
  } catch(e) {
    return json({ error: 'Summarize failed: ' + (e?.message || 'unknown') }, 502, env);
  }
}

// A2v2.1: core extracted so /process can reuse it. Returns { parsed, rawText };
// parsed is null when the model reply wasn't valid JSON (summary is non-fatal
// everywhere it's consumed, matching the client's existing graceful handling).
async function runSummarize(segments, env) {
  const transcriptText = segments.map(s =>
    `[seg:${s.segment_id}][${s.ts}] ${s.speaker}: ${s.text}`
  ).join('\n');

  const prompt = `อ่าน transcript นี้แล้วสรุปเป็น structured notes

TRANSCRIPT:
${transcriptText}

กฎ:
1. อ้างอิงจาก transcript เท่านั้น ห้ามเติมหรือคาดเดา
2. ทุก quote ต้องมาจาก transcript จริง พร้อม segment_id และ timestamp
3. ตอบภาษาไทย

ตอบ JSON เท่านั้น ไม่มี markdown:
{
  "transcript_summary": "สรุปภาพรวม 2-3 ประโยค",
  "notes": [
    {
      "heading": "หัวข้อ เช่น สินค้าที่สนใจ / ปัญหาที่เจอ / ข้อตกลง",
      "bullets": ["bullet point จาก transcript", "..."]
    }
  ],
  "customer_said": [
    {
      "point": "สิ่งที่ลูกค้าบอก",
      "quote": "คำพูดตรงๆ",
      "ts": "mm:ss",
      "segment_id": 0
    }
  ],
  "next_steps": [
    {
      "action": "สิ่งที่ต้องทำ",
      "owner": "Sales|TL",
      "urgency": "3_days|this_week|next_visit",
      "segment_id": 0
    }
  ],
  "tone": {
    "rep_confidence": "high|medium|low",
    "rep_confidence_note": "อธิบายสั้นๆ",
    "customer_engagement": "increasing|stable|decreasing",
    "customer_engagement_note": "อธิบายสั้นๆ"
  }
}`;

  const geminiRes = await withRetry(async () => {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_MAP.gemini.flash_lite}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json' }
        })
      }
    );
    if (r.ok) return r;
    if (r.status === 503 || r.status === 429) return RETRY(r.status);   // v_queue: พกสถานะไปด้วย
    throw new Error(`Gemini summarize ${r.status}`);
  }, 3, [0, 2000, 5000]);

  const data = await geminiRes.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let parsed = null;
  const s = rawText.indexOf('{'), e = rawText.lastIndexOf('}');
  if (s !== -1 && e !== -1) { try { parsed = JSON.parse(rawText.slice(s, e + 1)); } catch(_) {} }
  return { parsed, rawText };
}

// ── /analyze ──────────────────────────────────────────────────────────────────
// segments[] + summary → skills + OCPB with segment_id evidence
// Evidence MUST reference segment_id — unsupported facts → not_observed
async function handleAnalyze(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503, env);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }

  const { segments, summary, rubric } = body;
  if (!segments || !segments.length) return json({ error: 'segments required' }, 400, env);

  try {
    const { rawText } = await runAnalyze(segments, summary, rubric, env);
    return json({ text: rawText }, 200, env);
  } catch(e) {
    return json({ error: e?.message || 'Analyze failed' }, 502, env);
  }
}

// A2v2.1: core extracted so /process can reuse it. Returns { parsed, rawText };
// throws after all retries fail (analyze IS fatal — no result to save without it).
async function runAnalyze(segments, summary, rubric, env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const transcriptText = segments.map(s =>
    `[seg:${s.segment_id}][${s.ts}] ${s.speaker}: ${s.text}`
  ).join('\n');

  // v_echofix (2026-07-21): rubric text used to carry ONLY code+EN name+pass
  // test — it dropped `echo_observable`, the admin-editable field designed
  // specifically to tell the model WHAT TO LISTEN FOR per skill (a likely
  // driver of the 62% not_observed rate on real data). Now includes the
  // Thai name + the listen-for hint. The client already sends these fields
  // (rubric rows come from skill_definitions verbatim) — no client change.
  const rubricText = (rubric || []).map(s =>
    `[${s.skill_code}] ${s.skill_name_en}${s.skill_name_th ? ' (' + s.skill_name_th + ')' : ''}: ${(s.pass_test_th || '-').replace(/\//g, ' | ')}` +
    (s.echo_observable ? `\n  ฟังหา: ${s.echo_observable}` : '')
  ).join('\n');

  const summaryText = summary ? JSON.stringify(summary) : '';

  const prompt = `วิเคราะห์บทสนทนานี้ตาม skill rubric และ OCPB framework

TRANSCRIPT (ground truth — ใช้ segment_id อ้างอิงทุก evidence):
${transcriptText}

${summaryText ? `SUMMARY (verified context):\n${summaryText}\n` : ''}

SKILL RUBRIC:
${rubricText || 'ไม่มี rubric — ประเมินตาม best practice การขายทั่วไป'}

OCPB:
- O: Operation — การสั่งของ วัน/เวลา ปริมาณ ปัญหา ops
- C: Competitor — ซัพเดิม ราคา สินค้าที่ใช้
- P: Payment — วิธีจ่าย credit term
- B: Business Plan — แผนขยาย เปิดสาขา เปลี่ยน concept

กฎเหล็ก (spec principle: every fact must trace to evidence):
1. ทุก evidence MUST มี segment_id จาก transcript จริงเท่านั้น
2. ถ้าไม่มีหลักฐานใน transcript → score: "not_observed", segment_id: null ห้ามเดา
3. quote ต้องตรงกับ text ใน segment นั้นจริงๆ
4. ตอบภาษาไทย

ตอบ JSON เท่านั้น ไม่มี markdown:
{
  "skills": [
    {
      "code": "",
      "score": "pass|developing|not_observed|not_applicable",
      "evidence": "สรุปหลักฐานสั้นๆ",
      "quote": "คำพูดตรงๆ จาก transcript",
      "ts": "mm:ss",
      "segment_id": 0,
      "gap": "สิ่งที่ขาด",
      "coaching_note": "คำแนะนำ"
    }
  ],
  "pipc_stage": "Prepare|Identify|Probe|Close",
  "pipc_reached": "สรุปว่าถึง stage ไหน",
  "overall": "strong|developing|needs_work",
  "session_summary": "สรุปภาพรวม session",
  "ocpb_status": {
    "O": "answered|asked_no_answer|not_asked",
    "C": "answered|asked_no_answer|not_asked",
    "P": "answered|asked_no_answer|not_asked",
    "B": "answered|asked_no_answer|not_asked"
  },
  "ocpb_facts": [
    {
      "dim": "O|C|P|B",
      "summary": "สรุปสั้นๆ",
      "quote": "คำพูดตรงๆ",
      "ts": "mm:ss",
      "segment_id": 0,
      "tag": "pain_high|pain_medium|opportunity|null"
    }
  ]
}`;

  // Analyze with retry — both 503/429 AND json parse failures
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, attempt === 2 ? 3000 : 7000));
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: MODEL_MAP.claude.sonnet,
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => String(res.status));
        lastErr = new Error(`Analyze ${res.status}: ${errText}`);
        if (res.status !== 503 && res.status !== 429) throw lastErr;
        continue; // retry on 503/429
      }

      const d = await res.json();
      const text = d?.content?.[0]?.text || '';

      // Validate JSON parseable before returning
      const s = text.indexOf('{'), e = text.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        try {
          const parsed = JSON.parse(text.slice(s, e + 1));
          return { parsed, rawText: text };
        } catch(_) {
          lastErr = new Error('Analyze: JSON parse failed (partial response)');
          continue; // retry on parse fail
        }
      }
      lastErr = new Error('Analyze: no JSON in response');
      continue;

    } catch(e) {
      if (e.message && !e.message.includes('503') && !e.message.includes('429')) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error('Analyze failed');
}

// ── /eval ─────────────────────────────────────────────────────────────────────
// Measure transcript quality against spec criteria
// Input: { segments, ground_truth_text? }
// Output: scores for Thai accuracy, hallucination rate, speaker confidence, evidence coverage
async function handleEval(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503, env);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }

  const { segments, ground_truth_text, analysis_result } = body;
  if (!segments || !segments.length) return json({ error: 'segments required' }, 400, env);

  // ── Measurable metrics from data alone (no ground truth needed) ──────────
  const totalSegments     = segments.length;
  const avgSpeakerConf    = segments.reduce((s, x) => s + (x.speaker_confidence || 0), 0) / totalSegments;
  const avgTranscriptConf = segments.reduce((s, x) => s + (x.transcript_confidence || 0), 0) / totalSegments;
  const unknownSpeakers   = segments.filter(s => s.speaker === 'ไม่ทราบ' || !s.speaker).length;
  const speakerAccuracy   = totalSegments > 0 ? (totalSegments - unknownSpeakers) / totalSegments : 0;

  // Evidence coverage — how many analysis facts have segment_id
  let evidenceCoverage = null;
  if (analysis_result) {
    const allFacts = [
      ...(analysis_result.skills || []).filter(s => s.score !== 'not_observed' && s.score !== 'not_applicable'),
      ...(analysis_result.ocpb_facts || [])
    ];
    const withEvidence = allFacts.filter(f => f.segment_id !== null && f.segment_id !== undefined);
    evidenceCoverage = allFacts.length > 0 ? withEvidence.length / allFacts.length : 1.0;
  }

  // ── AI-assisted evaluation (hallucination check) ─────────────────────────
  let hallucinationScore = null;
  if (ground_truth_text && env.ANTHROPIC_API_KEY) {
    const evalPrompt = `เปรียบเทียบ transcript กับ ground truth แล้วหา hallucination

GROUND TRUTH (สิ่งที่พูดจริง):
${ground_truth_text}

TRANSCRIPT (สิ่งที่ถอดมา):
${segments.map(s => `[${s.ts}] ${s.speaker}: ${s.text}`).join('\n')}

นับคำใน transcript ที่ไม่มีอยู่ใน ground truth เลย (hallucinated words)
ตอบ JSON เท่านั้น:
{
  "hallucinated_words": ["word1", "word2"],
  "hallucination_rate": 0.0,
  "notes": "อธิบายสั้นๆ"
}`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL_MAP.claude.haiku, max_tokens: 1024, messages: [{ role: 'user', content: evalPrompt }] })
      });
      if (res.ok) {
        const d = await res.json();
        const t = d?.content?.[0]?.text || '';
        const s = t.indexOf('{'), e = t.lastIndexOf('}');
        if (s !== -1) {
          const parsed = JSON.parse(t.slice(s, e + 1));
          hallucinationScore = parsed.hallucination_rate || 0;
        }
      }
    } catch(_) {}
  }

  // ── Pass/fail against spec criteria ─────────────────────────────────────
  const criteria = {
    thai_accuracy: {
      target: 0.90,
      value: avgTranscriptConf,
      pass: avgTranscriptConf >= 0.90,
      note: 'avg transcript_confidence per segment'
    },
    speaker_attribution: {
      target: 0.90,
      value: speakerAccuracy,
      pass: speakerAccuracy >= 0.90,
      note: `${totalSegments - unknownSpeakers}/${totalSegments} segments with known speaker`
    },
    avg_speaker_confidence: {
      target: 0.85,
      value: avgSpeakerConf,
      pass: avgSpeakerConf >= 0.85,
      note: 'avg speaker_confidence per segment'
    },
    hallucination_rate: {
      target: 0.05,
      value: hallucinationScore,
      pass: hallucinationScore !== null ? hallucinationScore <= 0.05 : null,
      note: hallucinationScore !== null ? 'measured vs ground truth' : 'requires ground_truth_text'
    },
    evidence_coverage: {
      target: 1.0,
      value: evidenceCoverage,
      pass: evidenceCoverage !== null ? evidenceCoverage >= 1.0 : null,
      note: evidenceCoverage !== null ? 'all facts have segment_id' : 'requires analysis_result'
    }
  };

  const measuredCriteria = Object.values(criteria).filter(c => c.pass !== null);
  const passCount  = measuredCriteria.filter(c => c.pass).length;
  const overallPass = measuredCriteria.length > 0 && passCount === measuredCriteria.length;

  return json({
    overall_pass: overallPass,
    pass_count: passCount,
    total_criteria: measuredCriteria.length,
    criteria,
    meta: {
      total_segments: totalSegments,
      duration_secs: segments.length > 0 ? (segments[segments.length - 1].end_sec || 0) : 0,
      source: segments[0]?.source || 'unknown'
    }
  }, 200, env);
}

// ── Legacy /transcribe (Groq Whisper) ────────────────────────────────────────
async function handleTranscribe(request, env) {
  if (!env.GROQ_API_KEY) return json({ error: 'GROQ_API_KEY not set' }, 500, env);
  let formData;
  try { formData = await request.formData(); }
  catch { return json({ error: 'Expected multipart/form-data' }, 400, env); }
  const audioFile = formData.get('audio');
  if (!audioFile) return json({ error: 'Missing audio field' }, 400, env);

  const groqForm = new FormData();
  groqForm.append('file', audioFile, 'recording.webm');
  groqForm.append('model', 'whisper-large-v3');
  groqForm.append('language', 'th');
  groqForm.append('prompt', formData.get('prompt') || 'การสนทนาระหว่าง sales rep กับเจ้าของร้านอาหาร เรื่องวัตถุดิบ freshket');
  groqForm.append('response_format', 'json');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
    body: groqForm
  });
  if (!res.ok) return json({ error: 'Groq error', detail: await res.text() }, 502, env);
  const data = await res.json();
  return json({ text: data.text || '' }, 200, env);
}

// ── Legacy /analyze-audio ─────────────────────────────────────────────────────
async function handleAnalyzeAudio(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not set' }, 503, env);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }
  const { audio_b64, mime_type, prompt } = body;
  if (!audio_b64 || !prompt) return json({ error: 'audio_b64 and prompt required' }, 400, env);

  const geminiBody = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: mime_type || 'audio/webm', data: audio_b64 } }, { text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 16384, responseMimeType: 'application/json' }
  });

  try {
    const geminiRes = await withRetry(async () => {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: geminiBody }
      );
      if (r.ok) return r;
      if (r.status === 503 || r.status === 429) return RETRY(r.status);   // v_queue: พกสถานะไปด้วย
      throw new Error(`Gemini ${r.status}`);
    }, 3, [0, 2000, 4000]);

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return json({ text }, 200, env);
  } catch(e) {
    return json({ error: e?.message || 'Gemini failed' }, 502, env);
  }
}

// ── A2v2.2 BRAIN (2026-08-05) — one strong-model call for the whole analysis ──
// Replaces the summarize(flash-lite)+analyze(sonnet) pair INSIDE /process only
// (legacy endpoints untouched). Nobody waits on-screen anymore, so latency is
// free — spend it on the strongest available model and a richer prompt:
// restaurant-business lens, 3-level evidence discipline, skill decision tree,
// customer needs with implications, and cross-visit memory.

// Try strongest-first; fall through on 4xx (model not enabled for this key).
// The winner is stamped into ci_sessions.ai_model — after the first real run
// the DB itself answers "is gemini-3.5-pro enabled?".
// v_echor3 (2026-08-08): chain เดิมมี 'gemini-3.5-pro' อยู่บนสุด ซึ่ง **ไม่มีรุ่นนี้
// อยู่จริง** (สาย Pro ปัจจุบันคือ 3.1, ส่วน 3.5 มีแต่ Flash) → 404 แล้วตกลงมาชั้น
// ล่างสุดเงียบๆ · ข้อมูลจริงในDB: gemini-2.5-flash 17 ครั้ง, สองตัวบน 0 ครั้ง
// เราจึงจ่ายค่าโมเดลถูกที่สุดมาตลอดโดยคิดว่ากำลังใช้ตัวแรงสุด
//
// ชื่อรุ่นด้านล่างอิงเอกสาร Google ณ ส.ค. 2026 · **ห้ามเดาชื่อรุ่นอีก** —
// เปิด GET /models เพื่อดูว่า key นี้เรียกอะไรได้จริงก่อนแก้ทุกครั้ง
// และดู ci_sessions.ai_model_trail ว่าแต่ละครั้งตกชั้นเพราะอะไร
const BRAIN_MODEL_CHAIN = [
  { provider: 'gemini',    model: 'gemini-3.1-pro-preview' },      // reasoning แรงสุดที่ GA
  { provider: 'gemini',    model: 'gemini-3.6-flash' },    // GA ล่าสุด เร็วและเก่ง
  { provider: 'anthropic', model: 'claude-sonnet-5' },
  { provider: 'anthropic', model: 'claude-sonnet-4-6' },   // known-good today (= legacy /analyze)
  { provider: 'gemini',    model: 'gemini-3.5-flash' }     // floor (เลิกใช้ 2.5 — ใกล้ปิดตัว)
];

// ── ชั้นล่างสุดของการเรียกโมเดล (v_aifix 2026-08-08) ────────────────────────
// ก่อนหน้านี้มี fetch ตรงกระจายอยู่ 3 ที่ (brain / ช่องทางกลาง / eval) แต่ละที่
// จัดการ error คนละแบบ และช่องทางกลาง "กลืน" สาเหตุทิ้งจนหาไม่เจอว่าพังเพราะอะไร
// ตัวนี้คือจุดเดียวที่ยิงโมเดลจริง — คืนสาเหตุกลับมาเสมอ ไม่โยน ไม่กลืน
async function _callOneModel(provider, model, env, payload) {
  const { system, messages, maxTokens, jsonMode } = payload;
  let res;
  try {
    if (provider === 'gemini') {
      const contents = (messages || []).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      // Gemini 3.x คิดในใจก่อนตอบ และ "ความคิด" กินโควตา maxOutputTokens ด้วย
      // ผู้เรียกที่ขอน้อยๆ (SKU matcher ขอ ~20) จะได้คำตอบว่าง finishReason=MAX_TOKENS
      // (เจอจริงตอนยิงทดสอบ 2026-08-08) → ตั้งพื้น 2048 เฉพาะฝั่ง gemini
      //
      // v_thinkfix (2026-08-20): พื้น 2048 ไม่พอสำหรับ prompt ยาว + ขอ JSON หลาย
      // field (เช่น KAM Brief) — เจอจริง: "ความคิด" กินไปเกือบหมด เหลือให้ตอบแค่
      // ~150 token ตอบได้ field เดียวแล้วขาดกลางประโยค JSON ไม่ปิดวงเล็บ ฝั่ง client
      // parse ไม่ออกเลยทั้งที่ AI ตอบมาจริง (response ไม่ใช่ error แต่ถูกตัดทิ้ง)
      // → ยกพื้นเป็น 4096 ให้มีที่ว่างพอทั้งความคิด+คำตอบจริง
      const gcfg = { maxOutputTokens: Math.max(maxTokens || 2000, 4096), temperature: 0.2 };
      if (jsonMode) gcfg.responseMimeType = 'application/json';
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: system ? { parts: [{ text: system }] } : undefined,
            contents, generationConfig: gcfg
          })
        });
    } else {
      // system: '' ทำให้ Anthropic ตอบ 400 — ต้องตัดคีย์ทิ้งไปเลยเมื่อว่าง
      const body = { model, max_tokens: maxTokens || 2000, messages: messages || [] };
      if (system) body.system = system;
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body)
      });
    }
  } catch (e) {
    return { ok: false, status: 0, text: '', errMsg: `${model}: ${e?.message || 'network error'}` };
  }

  // อ่าน body ครั้งเดียว แล้วค่อยแยกว่าเป็นผลลัพธ์หรือ error
  let d = null, raw = '';
  try { raw = await res.text(); d = raw ? JSON.parse(raw) : null; } catch (_) {}

  if (!res.ok) {
    const msg = d?.error?.message || d?.error?.status || raw.slice(0, 300) || `HTTP ${res.status}`;
    return { ok: false, status: res.status, text: '', errMsg: `${model}: ${msg}` };
  }
  const text = provider === 'gemini'
    ? (d?.candidates?.[0]?.content?.parts?.[0]?.text || '')
    : (d?.content?.[0]?.text || '');
  if (!text) {
    // ปลายทางตอบ 200 แต่ไม่มีเนื้อความ — เดิมกรณีนี้ไหลออกไปเป็นค่าว่างเงียบๆ
    // (เช่น Gemini ตอบ 200 พร้อม promptFeedback ว่าโดนบล็อก) ต้องนับเป็นล้มเหลว
    const why = d?.promptFeedback?.blockReason || d?.candidates?.[0]?.finishReason || d?.stop_reason || 'ไม่มีเนื้อความ';
    return { ok: false, status: 502, text: '', errMsg: `${model}: ตอบกลับว่าง (${why})` };
  }
  // v_thinkfix (2026-08-20): text ไม่ว่างแต่โดนตัดกลางคัน (finishReason=MAX_TOKENS)
  // เดิมไหลผ่านเป็น ok:true เพราะเช็คแค่ "!text" — ฝั่ง client ที่ขอ JSON โครงหลาย
  // field เจอ text ที่ขาดวงเล็บปิด parse ไม่ออกเลย แต่ error ที่เห็นคือ "ไม่มี JSON"
  // ทำให้ไล่ผิดทางว่า AI ไม่ตอบ ทั้งที่จริงตอบมาแล้วแค่ถูกตัด — นับเป็นล้มเหลว
  // แทน ให้เข้า retry/fallback chain เดิม (ลองรุ่นถัดไป) แทนที่จะส่ง JSON ค้างๆ
  // ไปให้ client เอง (ไม่เช็คกับ Anthropic เพราะยังไม่เคยเจอเคสนี้ฝั่ง Claude)
  const finishReason = provider === 'gemini' ? d?.candidates?.[0]?.finishReason : null;
  if (finishReason === 'MAX_TOKENS') {
    return { ok: false, status: 502, text: '', errMsg: `${model}: ตอบถูกตัดกลางคัน (MAX_TOKENS) — ${text.length} ตัวอักษรที่ได้มาไม่ใช้` };
  }
  return { ok: true, status: 200, text, errMsg: '' };
}

// ไล่รุ่นตาม chain — รุ่นแรกตายให้ลงรุ่นถัดไป · 429/5xx ลองซ้ำรุ่นเดิมหนึ่งครั้ง
// คืน trail มาด้วยเสมอ เพื่อให้รู้ว่าตกชั้นเพราะอะไร (บทเรียนจาก brain chain
// ที่วิ่งบนรุ่นล่างสุด 17/18 ครั้งโดยไม่มีใครรู้)
async function callTextModel(provider, tier, env, payload) {
  const chain = (TEXT_MODEL_CHAIN[provider] || {})[tier] || [];
  const trail = [];
  for (const model of chain) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) await new Promise(r => setTimeout(r, 1500));
      const r = await _callOneModel(provider, model, env, payload);
      if (r.ok) return { ok: true, text: r.text, model, trail: trail.join(' → ') };
      trail.push(r.errMsg);
      if (r.status === 429 || r.status >= 500) continue;  // ชั่วคราว — ลองรุ่นเดิมซ้ำ
      break;                                              // 4xx อื่น — รุ่นนี้ใช้ไม่ได้
    }
  }
  return { ok: false, text: '', model: chain[chain.length - 1] || null, trail: trail.join(' → ') };
}

// ── ช่องทาง AI กลางที่ Sense ทุกฟังก์ชันใช้ (POST /) ────────────────────────
// สัญญากับ client (src/03_rendering.js callAI): ต้องคืน { text } เสมอ
// เดิมฝั่ง gemini คืน { content: [...] } ซึ่ง client อ่านไม่เจอ → ได้ค่าว่างทุกครั้ง
// และเวลาปลายทางพังก็คืน { text: "" } เปล่าๆ จนไล่สาเหตุไม่ได้
async function handleGeneralAI(body, env) {
  const provider  = body.provider === 'gemini' ? 'gemini' : 'claude';
  const tier      = body.modelKey === 'sonnet' ? 'sonnet' : 'haiku';
  const system    = typeof body.system === 'string' ? body.system : '';
  const messages  = Array.isArray(body.messages) ? body.messages : [];
  const maxTokens = Math.min(Number(body.maxTokens || 2000), 6000);
  if (!messages.length) return json({ error: 'messages required' }, 400, env);
  if (provider === 'gemini' && !env.GEMINI_API_KEY)    return json({ error: 'Gemini not configured' }, 503, env);
  if (provider === 'claude' && !env.ANTHROPIC_API_KEY) return json({ error: 'Anthropic not configured' }, 503, env);

  const r = await callTextModel(provider, tier, env, { system, messages, maxTokens });
  if (!r.ok) {
    console.error(`[ai-proxy] ${provider}/${tier} ล้มทุกรุ่น — ${r.trail}`);
    // v_xfall (2026-08-12): fallback ข้ามค่าย — บทเรียนจริง: เครดิต Anthropic หมด
    // ทำให้ Brief/ทุกฟีเจอร์ฝั่ง claude ตายทั้งแอปเป็นวันๆ ทั้งที่ gemini ปกติดี
    // บุชเคาะ: ตกค่ายไหนก็ให้ข้ามไปอีกค่าย และใช้ "ตัวแรงสุดที่มี access" เสมอ
    // → ใช้ chain ระดับ sonnet ของค่ายสำรองไม่ว่า request เดิมขอ tier ไหน
    // (fallback ยิงเฉพาะตอนค่ายหลักล่มทั้ง chain — ไม่ใช่ต้นทุนประจำ)
    const alt = provider === 'claude' ? 'gemini' : 'claude';
    const altKey = alt === 'gemini' ? env.GEMINI_API_KEY : env.ANTHROPIC_API_KEY;
    if (altKey) {
      const r2 = await callTextModel(alt, 'sonnet', env, { system, messages, maxTokens });
      if (r2.ok) {
        console.warn(`[ai-proxy] ${provider}/${tier} ล่ม → ตอบด้วย ${alt}/${r2.model} แทน`);
        return json({
          text: r2.text, model: r2.model,
          fallback_from: `${provider}/${tier}`,
          content: [{ type: 'text', text: r2.text }]
        }, 200, env);
      }
      return json({
        error: `AI ล่มทั้งสองค่าย — ${provider}/${tier}: ${r.trail || 'ไม่มีรุ่นใน chain'} · ${alt}/sonnet: ${r2.trail || 'ไม่มีรุ่นใน chain'}`,
        provider, tier, trail: r.trail, alt_trail: r2.trail
      }, 502, env);
    }
    return json({
      error: `AI ปลายทางเรียกไม่สำเร็จ (${provider}/${tier}) — ${r.trail || 'ไม่มีรุ่นใน chain'}`,
      provider, tier, trail: r.trail
    }, 502, env);
  }
  // คง content[] ไว้ด้วยเพื่อความเข้ากันได้ย้อนหลังกับผู้เรียกเก่าที่อ่านโครงนั้น
  return json({ text: r.text, model: r.model, content: [{ type: 'text', text: r.text }] }, 200, env);
}

async function callBrainModel(prompt, env) {
  // v_aifix: ยิงผ่าน _callOneModel ตัวเดียวกับช่องทางกลาง — เดิมมี fetch ของตัวเอง
  // ซ้ำอีกชุด ทำให้กติกาการ retry/อ่าน error ไม่ตรงกันสองที่
  // เก็บ "ร่องรอย" ว่าไล่ผ่านรุ่นไหนมาบ้างและพังเพราะอะไร แล้วเขียนลง DB · เดิม
  // log ลง console อย่างเดียว = ไม่มีใครเห็น จึงไม่มีใครรู้ว่าตกชั้น
  const trail = [];
  let lastErr;
  for (const { provider, model } of BRAIN_MODEL_CHAIN) {
    if (provider === 'gemini' && !env.GEMINI_API_KEY) { trail.push(`${model}:ไม่มีkey`); continue; }
    if (provider === 'anthropic' && !env.ANTHROPIC_API_KEY) { trail.push(`${model}:ไม่มีkey`); continue; }
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) await new Promise(r => setTimeout(r, 3000));
      const r = await _callOneModel(provider === 'anthropic' ? 'claude' : 'gemini', model, env, {
        messages: [{ role: 'user', content: prompt }], maxTokens: 16384, jsonMode: true
      });
      if (!r.ok) {
        lastErr = new Error(r.errMsg);
        trail.push(r.errMsg);
        console.error(`[brain] ${r.errMsg}`);
        if (r.status === 429 || r.status >= 500) continue;   // ชั่วคราว — ลองรุ่นเดิมซ้ำ
        break;                                               // รุ่นนี้ใช้ไม่ได้ — ลงรุ่นถัดไป
      }
      const s = r.text.indexOf('{'), e = r.text.lastIndexOf('}');
      if (s === -1 || e === -1) {
        lastErr = new Error(`${model}: no JSON`); trail.push(`${model}:ไม่มีJSON`);
        console.error(`[brain] ${model}: response had no JSON — ${r.text.slice(0, 200)}`);
        continue;
      }
      try {
        return { parsed: JSON.parse(r.text.slice(s, e + 1)), model, trail: trail.join(' → ') || 'ตัวแรกผ่านเลย' };
      } catch (_) {
        lastErr = new Error(`${model}: JSON parse failed`); trail.push(`${model}:JSONพัง`);
        console.error(`[brain] ${model}: JSON parse failed — ${r.text.slice(0, 200)}`);
        continue;
      }
    }
  }
  throw lastErr || new Error('all brain models failed');
}

// บริบทงานจริงต่อ role — โมเดลใช้ตัดสิน "visit นี้เปิดโอกาสให้ใช้ skill นี้มั้ย"
// และแปลความหมายประโยคเดียวกันให้ถูกทิศ (จาก Sales = ปิดดีลใหม่, จาก KAM =
// อาจแปลว่าลูกค้ากำลังเทียบเจ้าอื่น)
const BRAIN_ROLE_CONTEXT = {
  kam:   'KAM (Key Account Manager) — ดูแลร้านลูกค้าเดิม: รักษายอดสั่งซื้อ ขยายตะกร้า (เพิ่มหมวดสินค้า/SKU) และกันคู่แข่งเข้ามาแย่ง share',
  sales: 'Sales (Hunter) — ล่าลูกค้าใหม่: สร้างความเชื่อใจครั้งแรก เก็บข้อมูลร้าน เปิดบัญชี และปิดออเดอร์แรกหรือนัดครั้งถัดไป',
  ad:    'AD (Account Development) — พัฒนาบัญชีที่เพิ่งเปิด: ทำให้ร้านติดนิสัยสั่งประจำ เพิ่มความถี่การสั่งและจำนวนหมวดสินค้า',
  pm:    'PM (Portfolio Manager) — ดูแลพอร์ต/เชนเชิงโครงการ: ประสานหลายสาขา เงื่อนไขราคา สัญญา และความสัมพันธ์ระดับผู้บริหารร้าน'
};

// v_echor2: ทำให้ next_actions อยู่ในรูปเดียวเสมอก่อนเก็บลง DB — โมเดลบางตัวคืน
// priority เป็น string, ใส่ "null" เป็นข้อความ, หรือคายมา 12 ข้อ · หน้าจอฝั่ง
// client ต้องเชื่อได้ว่า index 0 คือข้อสำคัญที่สุดเสมอ
function _normalizeActions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(a => a && typeof a.action === 'string' && a.action.trim())
    .map((a, i) => {
      const p = Number(a.priority);
      const nid = a.need_id;
      return {
        ...a,
        priority: Number.isFinite(p) && p > 0 ? p : i + 1,
        need_id: (typeof nid === 'string' && nid && nid !== 'null') ? nid : null
      };
    })
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 5)
    .map((a, i) => ({ ...a, priority: i + 1 }));
}

async function runBrain(segments, rubric, roleBucket, priorIntel, env) {
  // v_echor2: ติดธง "ฟังไม่ชัด" รายท่อน — transcript_confidence คำนวณไว้ตั้งแต่ขั้น
  // ถอดเสียงแล้ว (exp ของ avg_logprob) แต่เดิมไม่เคยส่งถึงสมองเลย สมองจึงมองทุก
  // ท่อนน่าเชื่อถือเท่ากันแล้วเดาทับท่อนที่เพี้ยน · ค่านี้เทียบกันได้เฉพาะ "ภายใน
  // คลิปเดียวกัน" ห้ามเอาไปเทียบข้ามคลิปหรือตั้งเป็นเป้า KPI
  const LOW_CONF = 0.40;
  const transcriptText = segments.map(s => {
    const flag = (typeof s.transcript_confidence === 'number' && s.transcript_confidence < LOW_CONF)
      ? '[ฟังไม่ชัด]' : '';
    return `[seg:${s.segment_id}][${s.ts}]${flag} ${s.speaker}: ${s.text}`;
  }).join('\n');
  const lowConfCount = segments.filter(s =>
    typeof s.transcript_confidence === 'number' && s.transcript_confidence < LOW_CONF).length;

  // 3 บรรทัดต่อ skill: ชื่อ+เจตนา / เกณฑ์ผ่าน / ฟังหา — model เห็นครบ ทำไม-อะไร-ยังไง
  const rubricText = (rubric || []).map(s => {
    const principle = (s.principle_th || '').slice(0, 200);
    return `[${s.skill_code}] ${s.skill_name_en}${s.skill_name_th ? ' (' + s.skill_name_th + ')' : ''}` +
      (principle ? `\n  เจตนา: ${principle}` : '') +
      `\n  เกณฑ์ผ่าน: ${(s.pass_test_th || '-').replace(/\//g, ' | ')}` +
      (s.echo_observable ? `\n  ฟังหา: ${s.echo_observable}` : '');
  }).join('\n');

  // ความจำจาก visit ก่อน (intel ที่เคยสกัดไว้ของ kam×account เดียวกัน) — ตัดขนาด
  // กันบวม; โมเดลใช้ทำ progress_vs_last เท่านั้น ห้ามลอก fact เก่ามาเป็นของรอบนี้
  let priorText = '';
  if (priorIntel && priorIntel.ci_customer_signals) {
    try {
      priorText = JSON.stringify({
        when: priorIntel.ci_created_at || null,
        intel: priorIntel.ci_customer_signals,
        next_actions: priorIntel.ci_next_actions || []
      }).slice(0, 6000);
    } catch (_) {}
  }

  const prompt = `คุณคือ Sales Director ของ Freshket (จำหน่ายวัตถุดิบอาหารให้ร้านอาหาร) ผู้เชี่ยวชาญธุรกิจร้านอาหาร
กำลังฟังบทสนทนา visit จริงระหว่างพนักงานของคุณกับลูกค้าร้านอาหาร เพื่อ (1) สรุป (2) ประเมิน skill พนักงาน (3) วิเคราะห์ลูกค้าเชิงธุรกิจ

ROLE ของพนักงานใน visit นี้: ${BRAIN_ROLE_CONTEXT[roleBucket] || BRAIN_ROLE_CONTEXT.kam}

เลนส์ธุรกิจร้านอาหาร — ฟังทุกประโยคผ่าน 6 มิตินี้ (เจ้าของร้านคิดเรื่องพวกนี้เสมอ):
1. ยอดขายหน้าร้าน + เมนู — ขายดีมั้ย เมนูไหนเดิน เมนูใหม่/โปรโมชั่น = โอกาส SKU ใหม่
2. Food cost / margin — คำบ่นเรื่อง "ราคา" ที่แท้คือเรื่อง margin ของร้าน
3. Supplier mix / share of wallet — ร้านซื้อหลายเจ้าเสมอ ใครถือหมวดไหน เพราะอะไร (ราคา/เครดิต/ความเคยชิน/ความสด)
4. ปฏิบัติการ — เวลาส่ง (ต้องถึงก่อนเตรียมครัว) คุณภาพต้องนิ่ง ที่เก็บจำกัด
5. เครดิต / เงินสด — ร้านหมุนเงินกับ credit term ของซัพพลายเออร์
6. ความเชื่อใจ — ของมีปัญหาแล้วใครแก้เร็ว ความสัมพันธ์กับคนส่ง/เซลส์

TRANSCRIPT (ground truth — อ้าง segment_id ทุกครั้ง):
${transcriptText}

${priorText ? `ข้อมูลจาก VISIT ครั้งก่อนของลูกค้ารายนี้ (ใช้เทียบความคืบหน้าเท่านั้น ห้ามนับเป็นข้อมูลของรอบนี้):\n${priorText}\n` : ''}
SKILL RUBRIC (ประเมินครบทุกตัว อย่างละ 1 รายการเป๊ะ ห้ามข้าม ห้ามเพิ่ม):
${rubricText || 'ไม่มี rubric — ประเมินตาม best practice การขายทั่วไป'}

วิธีให้คะแนน skill (ไล่ทีละขั้น ห้ามข้ามขั้น):
ขั้น 1: visit นี้เปิดโอกาสให้ใช้ skill นี้มั้ย (ดูจาก ROLE + สถานการณ์จริงในบทสนทนา)? ไม่มีโอกาส → "not_applicable"
ขั้น 2: มีหลักฐานว่าพนักงานพยายามใช้ skill นี้มั้ย? ไม่มี → "not_observed" และใน gap ต้องระบุว่า "โอกาสอยู่ตรงไหนที่พลาดไป" (ชี้ segment ได้ยิ่งดี — เพื่อให้โค้ชต่อได้)
ขั้น 3: ทำถึง "เกณฑ์ผ่าน/ฟังหา" มั้ย? ถึง → "pass" · พยายามแต่ไม่ถึง → "developing"
กติกา: pass/developing ต้องมี quote ตรงตัวจาก transcript เสมอ · coaching_note = "สิ่งที่ทำได้ดี + สิ่งที่ควรทำต่างใน visit หน้า" (ลงมือได้จริง ไม่ใช่คำชมลอยๆ)

วินัยหลักฐาน 3 ระดับ (ใช้กับการวิเคราะห์ลูกค้าทุก section):
- เห็นชัด: มี quote ตรงตัว + segment_id
- อนุมาน: ใส่ "intensity":"implied" + "inferred_from" อธิบายว่าอนุมานจากอะไร
- ยังไม่รู้: ใส่ลง "unknowns" เป็นคำถามภาษาพูดที่พนักงานหยิบไปถามได้จริง visit หน้า
- ช่วง transcript ที่อ่านไม่รู้เรื่อง (ถอดเสียงเพี้ยน): ห้ามเดา ให้ข้าม — ถ้าประเด็นสำคัญน่าจะอยู่ตรงนั้น ใส่ unknowns แทน
- ท่อนที่ติดป้าย [ฟังไม่ชัด] = ระบบถอดเสียงเองก็ไม่มั่นใจ${lowConfCount ? ` (รอบนี้มี ${lowConfCount} ท่อน)` : ''} ห้ามใช้เป็นหลักฐานเดี่ยวๆ ห้ามยกเป็น quote และห้ามเดาคำที่หายไป · ใช้ได้แค่ประกอบบริบทเมื่อมีท่อนชัดยืนยันเรื่องเดียวกัน · ถ้าประเด็นสำคัญตกอยู่ในท่อนพวกนี้ ให้ยกเป็นคำถามใน unknowns

needs (ความต้องการลูกค้า): ทุกข้อต้องมี "id" (n1, n2, ...) และ "implication" (กระทบ share of wallet/การรักษาลูกค้ายังไง) — fact เฉยๆ ไม่พอ ต้องบอกว่าแล้วไงต่อ
สิ่งที่ต้องลงมือทำ เขียนที่ "next_actions" ที่เดียวเท่านั้น (ห้ามเขียนซ้ำใน needs) · action ที่มาจาก need ให้ผูกกลับด้วย "need_id" · action ที่ไม่ได้มาจาก need ใดใส่ need_id เป็น null
headline: หนึ่งประโยคที่ตอบว่า "ลูกค้ารายนี้ติดอะไรอยู่ และโอกาสที่ใหญ่ที่สุดคืออะไร" — เขียนแบบพูดกับหัวหน้าทีมขาย ไม่ใช่สรุปเหตุการณ์

ตอบ JSON เท่านั้น ไม่มี markdown:
{
  "transcript_summary": "สรุปภาพรวม 2-3 ประโยค",
  "notes": [{ "heading": "หัวข้อ", "bullets": ["..."] }],
  "customer_said": [{ "point": "...", "quote": "...", "ts": "mm:ss", "segment_id": 0 }],
  "tone": { "rep_confidence": "high|medium|low", "rep_confidence_note": "...", "customer_engagement": "increasing|stable|decreasing", "customer_engagement_note": "..." },
  "skills": [{ "code": "", "score": "pass|developing|not_observed|not_applicable", "evidence": "...", "quote": "...", "ts": "mm:ss", "segment_id": 0, "gap": "...", "coaching_note": "..." }],
  "pipc_stage": "Prepare|Identify|Probe|Close",
  "pipc_reached": "...",
  "overall": "strong|developing|needs_work",
  "session_summary": "...",
  "ocpb_status": { "O": "answered|asked_no_answer|not_asked", "C": "...", "P": "...", "B": "..." },
  "ocpb_facts": [{ "dim": "O|C|P|B", "summary": "...", "quote": "...", "ts": "mm:ss", "segment_id": 0, "tag": "pain_high|pain_medium|opportunity|null" }],
  "headline": "หนึ่งประโยค: ลูกค้าติดอะไร + โอกาสที่ใหญ่ที่สุด",
  "needs": [{ "id": "n1", "need": "...", "type": "product|price|delivery|credit|quality|service|other", "intensity": "explicit|implied", "inferred_from": "เฉพาะเมื่อ implied", "status": "open|addressed", "quote": "...", "segment_id": 0, "implication": "..." }],
  "unknowns": ["คำถามที่ควรถามครั้งหน้า ภาษาพูด", "..."],
  "next_actions": [{ "action": "...", "need_id": "n1|null", "priority": 1, "owner": "Sales|TL", "urgency": "3_days|this_week|next_visit", "segment_id": 0, "reason": "..." }],
  "progress_vs_last": [{ "topic": "...", "before": "สถานะครั้งก่อน", "now": "สถานะรอบนี้", "verdict": "คืบหน้า|ถอยหลัง|ค้างที่เดิม" }]
}
progress_vs_last: เฉพาะประเด็นที่มีข้อมูลทั้งสองฝั่ง (ครั้งก่อน+รอบนี้) — ไม่มีข้อมูลครั้งก่อน → []
next_actions: เรียง priority 1 = สำคัญที่สุด ไล่ลงไป · ไม่เกิน 5 ข้อ ถ้าคิดได้มากกว่านั้นให้ตัดที่ผลกระทบน้อยทิ้ง`;

  return callBrainModel(prompt, env);
}

// ── /process (A2v2.1, 2026-08-05) — async pipeline stage machine ─────────────
// The rep uploads audio to Supabase Storage, updates their ci_sessions row to
// pipeline_stage='uploaded', fires ONE tiny keepalive call here, and closes
// the app. Everything below runs server-side with the service key.
//
// Design rules:
// - ONE stage per invocation (uploaded→transcribed→analyzed), each persisted
//   before moving on. After finishing a stage the worker re-triggers itself
//   via a subrequest so the next stage gets a fresh execution budget instead
//   of betting a 3-4 minute chain on a single waitUntil surviving.
// - Optimistic claim via processing_since: duplicate triggers (keepalive +
//   client sweep + self-trigger can race) update WHERE pipeline_stage=X AND
//   processing_since is null-or-stale — 0 rows back means someone else owns
//   the stage, so just exit. Stale (>3 min) means a previous run died and the
//   stage is safe to retry. On error the claim is released immediately.
// - Audio is deleted from storage the moment transcription lands (same
//   keep-transcript-only policy the client pipeline always had).
const PROCESS_CLAIM_STALE_MS = 3 * 60 * 1000;

// v_queue: จุดเดียวที่ตัดสินว่า "ล้มเหลวแล้วยังไงต่อ" — เดิมกระจายอยู่ 2 ที่และ
// ทำเหมือนกันหมดคือปล่อย claim ให้ tick ถัดไปลองใหม่ ซึ่งถูกสำหรับเน็ตล่ม
// แต่ทำให้ไฟล์พังถาวรวนตลอดกาล และทำให้ 429 ยิ่งลองยิ่งตัน
//   stageTag 'transcribe' → ล้มถาวร = ไฟล์เสียงใช้ไม่ได้ (failed_audio)
//   stageTag 'analyze'    → ล้มถาวร = ระบบวิเคราะห์ไม่ผ่าน (failed_system)
async function failStage(env, sessionId, stageTag, err, row) {
  const c = classifyFailure(err);
  const note = `${new Date().toISOString()} [${stageTag}] ${String((err && err.message) || err).slice(0, 400)}`;
  const patch = { processing_since: null, pipeline_error: note };

  // v_audiofix: ไฟล์ใหญ่เกินขีดของ Groq ไม่ใช่ "ไฟล์เสีย" — ไฟล์ดีทุกอย่าง
  // แค่ตัวถอดปัจจุบันรับไม่ไหว · พักไว้ที่ stage ของตัวเองรอเส้นทาง Gemini
  // มารับช่วง แทนที่จะปิดคิวถาวรแล้วเสียบทสนทนาไปเปล่าๆ
  if (err && err.tooLarge) {
    patch.pipeline_stage  = 'needs_gemini';
    patch.next_attempt_at = null;
    console.warn(`[process] ${sessionId} ไฟล์ใหญ่เกินขีด Groq → พักไว้ที่ needs_gemini`);
    await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`, patch).catch(() => {});
    return;
  }
  if (c.ourFault) {
    console.error(`[process] ⚠ ความผิดฝั่งเรา (ไม่ใช่ไฟล์เสีย) ${sessionId}: ${note}`);
  }

  if (c.kind === FAIL_PERMANENT) {
    patch.pipeline_stage  = stageTag === 'transcribe' ? 'failed_audio' : 'failed_system';
    patch.next_attempt_at = null;   // ปิดคิวถาวร — ไม่มีวันสำเร็จ ลองอีกก็เปลืองเปล่า
  } else if (c.kind === FAIL_THROTTLED) {
    // ไม่แตะ attempts โดยตั้งใจ: คิวรวมเต็มไม่ใช่ความผิดของงานนี้ ถ้านับเป็น
    // ความผิดจะกลายเป็นว่าไฟล์ดีถูกตีตรา failed_system ทั้งที่ไม่มีอะไรผิด
    patch.next_attempt_at = new Date(Date.now() + THROTTLE_WAIT_MS).toISOString();
  } else {
    const attempts = Number((row && row.attempts) || 0) + 1;
    patch.attempts = attempts;
    if (attempts >= MAX_ATTEMPTS) {
      patch.pipeline_stage  = 'failed_system';
      patch.next_attempt_at = null;
    } else {
      patch.next_attempt_at = new Date(Date.now() + backoffMs(attempts)).toISOString();
    }
  }
  console.error(`[process] ${stageTag} ล้มเหลว ${sessionId} (${c.kind}/${c.status || '-'}) →`,
    patch.pipeline_stage || ('นัดใหม่ ' + patch.next_attempt_at));
  await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`, patch).catch(() => {});
}

async function handleProcess(request, env, cfCtx) {
  if (!env.SUPABASE_SERVICE_KEY) return json({ error: 'SUPABASE_SERVICE_KEY not set — add it in worker Settings → Variables' }, 503, env);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }
  const sessionId = String(body.session_id || '').trim();
  // uuid only — this id is interpolated into PostgREST query strings
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return json({ error: 'valid session_id required' }, 400, env);

  const origin = new URL(request.url).origin;
  // v_resumefix (2026-08-17): เดิม /process ตอบ 202 เสมอไม่ว่า pipeline_stage
  // จะเป็นอะไร — processSession ไม่มี stage ไหนรับ failed_system เลย (เห็นแค่
  // uploaded/needs_gemini/transcribed) ทำให้ปุ่ม "ลองใหม่" ฝั่งแอปกด /process
  // แล้วได้ 202 (= ข้อความ "สำเร็จ") กลับมาทั้งที่ไม่มีอะไรเกิดขึ้นจริงเลย —
  // ปลุกกลับไปที่ transcribed ก่อน (มี transcript อยู่แล้วเสมอสำหรับ
  // failed_system เพราะพังตอน analyze ไม่ใช่ตอน transcribe) ให้ Stage 2 ทำงาน
  // จริงก่อนตอบ accepted — ทำให้ปุ่มนี้ "ลองใหม่" จริงไม่ว่าจะกดกี่ครั้งก็ตาม
  try {
    const rows = await sbSelect(env, `ci_sessions?id=eq.${sessionId}&select=pipeline_stage`);
    if (rows && rows[0] && rows[0].pipeline_stage === 'failed_system') {
      await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`,
        { pipeline_stage: 'transcribed', status: 'draft', attempts: 0, pipeline_error: null, next_attempt_at: null });
    }
  } catch (_) { /* เช็คไม่ผ่าน — ปล่อยให้ processSession ตัดสินตามสถานะเดิม */ }
  cfCtx.waitUntil(processSession(sessionId, origin, env).catch(() => {}));
  return json({ accepted: true, session_id: sessionId }, 202, env);
}

// ══ v_listen (2026-08-16): Gemini เป็นหูหลัก, Whisper เป็นตัวสำรอง ═══════════
//
// ทำไมเปลี่ยน — วัดจากคลิปจริง:
//   · Whisper ไม่มั่นใจในงานตัวเองเกินครึ่ง (3,605 ท่อน/50 การอัด: เฉลี่ย 0.570,
//     ต่ำกว่า 0.5 อยู่ 35.5%) และผิดแบบมั่นใจ (0.79-0.87) ในจุดที่สำคัญที่สุด
//     เช่น "เคลม"→"สมภัย", "Restaurant Manager"→"Reservoir Manager", ข้ามทั้งท่อน
//   · คลิปเดียวกัน Gemini ได้ 415 ท่อน / Whisper 277 และแยกคนพูดให้ในรอบเดียว
//
// ข้อจำกัดที่ต้องออกแบบรับ (วัดจริง 7 คลิป):
//   · คำขอตายที่ 128-131 วิเสมอ · ตัวชนเพดานคือ **จำนวน token ที่ต้องปั่นออกมา**
//     ไม่ใช่ความยาวไฟล์ (input 49,557 token กลืนสบาย)
//   · ความเร็ว generate แกว่ง 76-175 token/วิ ตามภาระฝั่ง Google → คลิปเดียวกัน
//     ผ่านตอนเช้า ตายตอนบ่ายได้ · **ห้ามตั้งขนาดงานจากวันที่เร็ว**
//   · Gemini ตัดช่วงเวลาไฟล์เสียงเองไม่ได้ แต่สั่งใน prompt ให้ถอดเฉพาะช่วงได้
//     และมันเชื่อ (วัด in_window_pct = 100% ทุกหน้าต่างที่ทดสอบ)
//
// จึงถอด **ทีละช่วง ข้าม cron tick** โดยจำสถานะไว้ที่ listen_state
// (อัปไฟล์ครั้งเดียว ใช้ file_uri ซ้ำได้ ~48 ชม.) และ **หดช่วงเองเมื่อหมดเวลา**
//
// v_windegrade (2026-08-19): เจอจริงจากการอ่าน transcript 2 เซสชันแยกกัน
// (Tape/Puttipong + Treerak/May) ว่าข้อความเริ่มเพี้ยน (เว้นวรรคทีละคำ/พยางค์แบบ
// ไม่เป็นธรรมชาติ) หลังผ่านไปประมาณครึ่งความยาวของ "หนึ่งคำขอ" เสมอ
// ไม่ว่าคำขอนั้นจะยาว 6 หรือ 12 นาที — ตัวชี้วัดความมั่นใจปัจจุบันจับจุดนี้ไม่ได้เลย
// (นับแค่ท่อนที่ Gemini ติดป้าย [ฟังไม่ชัด] เอง ซึ่งไม่เกิดกับข้อความที่เพี้ยนแบบนี้)
//
// v_winoverlap (2026-08-21): รอบ 19 ส.ค. พยายามแก้ด้วยการหดคำขอครึ่งหนึ่ง (12→6)
// ซึ่ง **ผิดโจทย์ตั้งแต่ต้น** — หลักฐานที่เขียนไว้เองข้างบนบอกว่าจุดเพี้ยนอยู่ที่
// "ครึ่งของคำขอ ไม่ว่าคำขอจะยาวเท่าไหร่" ⇒ หดแล้วสัดส่วนที่เพี้ยนก็ยัง 50% เท่าเดิม
// ได้แต่จำนวนคำขอที่เพิ่มเป็นเท่าตัว · ราคาที่จ่ายไปวัดได้จากของจริง: ตั้งแต่
// 19 ส.ค. 13:16 **ไม่มีคลิปยาวเกิน 6 นาทีถอดจบด้วย Gemini อีกเลย** ตกไป Whisper
// 100% (ท่อน/นาที ร่วงจาก 12.0-13.7 เหลือ 2.1-5.0) เพราะคำขอที่เพิ่มเป็นเท่าตัว
// ไปเจอกับ _listenCall ที่ไม่มี retry + ทางล้มที่ทิ้งหน้าต่างที่เสร็จแล้วทั้งหมด
//
// วิธีที่ถูกคือ **ซ้อนหน้าต่าง**: ขอ WIN นาที แต่ขยับทีละ STRIDE นาที แล้วเก็บเฉพาะ
// ท่อนใน STRIDE นาทีแรกของคำขอนั้น (ครึ่งที่ยังดี) — ครึ่งหลังที่เพี้ยนถูกทิ้ง และช่วง
// เวลานั้นจะถูกถอดใหม่ในฐานะ "ครึ่งแรก" ของคำขอถัดไป ⇒ ทุกท่อนที่เก็บมาจากครึ่งแรก
// เสมอ โดยไม่ต้องพึ่งสมมติฐานที่พิสูจน์แล้วว่าผิด · จำนวนคำขอคุมด้วย STRIDE ไม่ใช่ WIN
// จึงเท่ากับตอน 6 นาทีไม่ซ้อนเป๊ะ (คลิป 48 นาที = 8 คำขอ) ไม่ช้าลงกว่าวันนี้
const LISTEN_WIN_MIN = 12;
const LISTEN_STRIDE_MIN = 6;
// คลิปสั้นกว่านี้ = คำขอเดียวทั้งไฟล์ ไม่ซ้อน · คงไว้ที่ 6 เพราะคลิปสั้นในของจริง
// (158-241 วิ) ได้ผลดีอยู่แล้วทุกตัว — อาการเพี้ยนพบเฉพาะคลิปยาว (24.5 กับ 52 นาที)
const LISTEN_SINGLE_MAX_MIN = 6;
// v_winfloor (2026-08-21): 180→60 · ทางผ่าครึ่งจะทำงานได้ต่อเมื่อ to-from > ค่านี้×2
// ค่าเดิม 180 ทำให้หน้าต่าง 6 นาที (360 วิ) ผ่าต่อไม่ได้เลย (360 > 360 เป็นเท็จ) แล้ว
// โยน error ทิ้งทันที · เจอสดๆ จากของจริงวันนี้: session 19 ส.ค. 16:00 โดน Gemini 524
// ที่หน้าต่าง 12 นาที → ผ่าเหลือ 6 นาที → **524 ซ้ำที่ 6 นาที** → ตันเพราะหดต่อไม่ได้
// (บ่ายวันนี้ Gemini ช้ากว่าปกติ ตรงกับคำเตือนข้างบนว่า "ผ่านตอนเช้า ตายตอนบ่ายได้")
// ลดพื้นลงให้กลไกหดตัวทำงานได้จริงถึง ~1 นาที แทนที่จะยอมแพ้ที่ 6 นาที
const LISTEN_MIN_WIN_SEC = 60;
// v_winoverlap: 20→48 — stride 6 นาทีทำให้ visit 60 นาทีต้อง ~11 คำขอ บวกการผ่าครึ่ง
// ตอน 524 และ retry ที่กินงบด้วย · ค่า 20 เดิมทำคลิป ~50 นาทีชนเพดานจริง แล้วโดนทิ้ง
// ทั้งที่เสียงดีสมบูรณ์ (21 ส.ค. 10:18 = 25.41MB/8,640 B/s · 18 ส.ค. 11:08 เคสเดียวกัน)
const LISTEN_MAX_ATTEMPTS = 48;
// ถ้าหน้าต่างเดิมล้มติดกันครบเท่านี้ tick ถือว่า Gemini ไปต่อไม่ได้จริง ค่อยตกไป Whisper
// (แต่ละ tick มี retry ในตัวอีก 3 ครั้ง = ลองจริง 9 ครั้งก่อนยอมแพ้ ใช้เวลา ~15 นาที)
const LISTEN_WIN_MAX_FAILS = 3;

// v_winoverlap: วางแผนหน้าต่างแบบซ้อน · คืน [{from, to, keep_to}]
//   from/to  = ช่วงที่ "ขอ" ให้ Gemini ถอด
//   keep_to  = เก็บท่อนถึงวินาทีนี้ (ไม่รวม) · null = เก็บถึงท้ายไฟล์ (หน้าต่างสุดท้าย)
//   undefined = state รูปแบบเก่าก่อน 21 ส.ค. → _keepInWindow เก็บทั้งหมดแบบเดิม
// แยกออกมาเป็นฟังก์ชันเพื่อให้ harness รันจริงทดสอบได้ ไม่ใช่แค่ grep หาสตริง
function _planListenWindows(durSec, fromSec, winSecOverride) {
  const dur = Math.ceil(durSec || 0);
  const start = Math.max(0, Math.floor(fromSec || 0));
  // ทางลัด "คลิปสั้น = คำขอเดียวทั้งไฟล์" ใช้ได้เฉพาะการวางแผนครั้งแรก · ถ้ามี
  // winSecOverride แปลว่ากำลังหดเพราะ 524 ต้องได้หน้าต่างจริงออกไป ไม่ใช่ก้อนเดิมซ้ำ
  // (ไม่งั้นวนวางแผนเดิมไปเรื่อยๆ จนงบหมดโดยไม่มีอะไรเปลี่ยน)
  if (!start && !winSecOverride && dur / 60 <= LISTEN_SINGLE_MAX_MIN) {
    return [{ from: null, to: null, keep_to: null }];
  }
  // v_winmemory (2026-08-21): ขนาดคำขอเป็นพารามิเตอร์ได้ เพื่อให้ตอนเจอ 524 วางแผน
  // "ทุกหน้าต่างที่เหลือ" ด้วยขนาดที่เล็กลงในครั้งเดียว ไม่ใช่หดทีละหน้าต่างแล้วให้
  // หน้าต่างถัดไปไปเจอ 524 ใหม่เองอีก (เห็นสดวันนี้: หน้าต่าง 3 หดถึง 2 นาที แต่
  // หน้าต่าง 4-9 ยังจะเริ่มที่ 12 นาที = จ่ายค่าค้นพบซ้ำทุกหน้าต่าง)
  const win = Math.max(LISTEN_MIN_WIN_SEC * 2, winSecOverride || LISTEN_WIN_MIN * 60);
  const stride = Math.floor(win / 2);
  const out = [];
  for (let s = start; s < dur; s += stride) {
    const to = Math.min(s + win, dur);
    const keepTo = Math.min(s + stride, dur);
    // เศษท้ายไฟล์ที่สั้นกว่าครึ่ง stride ให้กลืนรวมกับหน้าต่างนี้ ไม่ต้องยิงคำขอจิ๋วอีกรอบ
    const isLast = (dur - keepTo) < stride / 2;
    out.push({ from: s, to, keep_to: isLast ? null : keepTo });
    if (isLast) break;
  }
  return out;
}

// เก็บเฉพาะท่อนที่อยู่ในช่วง keep ของหน้าต่างนี้ (ครึ่งแรกของคำขอ = ครึ่งที่ยังไม่เพี้ยน)
function _keepInWindow(segments, w) {
  const segs = segments || [];
  // คำขอเดียวทั้งไฟล์ (from เป็น null) หรือ state รูปแบบเก่าที่ไม่มี keep_to → เก็บทั้งหมด
  if (!w || w.from == null || w.keep_to === undefined) return segs;
  return segs.filter(s => {
    const t = _abTsToSec(s && s.ts);
    if (t == null) return false;
    return t >= w.from && (w.keep_to === null || t < w.keep_to);
  });
}

// v_driftmeter (2026-08-21): ตัววัดอาการเพี้ยนช่วงท้ายคำขอ — บทเรียนของรอบนี้คือผม
// ปล่อยสมมติฐานที่ "วัดไม่ได้" ลง production แล้วมันเสียหายเงียบๆ 2 วัน · อาการคือ
// ข้อความกลายเป็นคำ/พยางค์สั้นๆ ซึ่งค่าความมั่นใจจับไม่ได้เลย แต่ "ความยาวข้อความ
// เฉลี่ยต่อท่อน" จับได้ · เก็บครึ่งแรก vs ครึ่งหลังของแต่ละคำขอไว้ให้ query เทียบได้
// ratio ใกล้ 1 = ไม่เพี้ยน · ยิ่งต่ำ = ครึ่งหลังยิ่งแตกเป็นคำสั้น
function _windowDrift(segments, w, durSec) {
  const from = (w && w.from != null) ? w.from : 0;
  const to = (w && w.to != null) ? w.to : Math.ceil(durSec || 0);
  const mid = (from + to) / 2;
  let fN = 0, fLen = 0, bN = 0, bLen = 0;
  for (const s of segments || []) {
    const t = _abTsToSec(s && s.ts);
    if (t == null) continue;
    const L = String((s && s.text) || '').length;
    if (t < mid) { fN++; fLen += L; } else { bN++; bLen += L; }
  }
  const f = fN ? fLen / fN : 0, b = bN ? bLen / bN : 0;
  return { win: `${Math.round(from)}-${Math.round(to)}`, n: (segments || []).length,
           front: Math.round(f), back: Math.round(b),
           ratio: f ? Math.round((b / f) * 100) / 100 : null };
}

function _listenPrompt(fromSec, toSec, accountName) {
  const win = (fromSec == null) ? '' :
    `\n\n**ถอดเฉพาะช่วง ${_abSecToTs(fromSec)} ถึง ${_abSecToTs(toSec)} เท่านั้น** ` +
    `ช่วงก่อนหน้าและหลังจากนั้นข้ามไปทั้งหมด ห้ามถอด · ` +
    `เวลาที่ตอบต้องเป็นเวลาจริงนับจากต้นไฟล์ (ไม่ใช่นับใหม่จากต้นช่วง)`;
  const who = accountName ? `\nร้านที่ไปเยี่ยม: ${_clampBytes(String(accountName), 200)}` : '';
  return `ถอดเสียงบทสนทนาภาษาไทยนี้แบบคำต่อคำ (verbatim) พร้อมระบุคนพูด

บริบท: พนักงานขายของ Freshket (ขายวัตถุดิบอาหารให้ร้านอาหาร) คุยกับคนของร้านอาหาร ณ ร้าน อาจมีเสียงรบกวน${who}
- ถอดตามที่ได้ยินจริง ห้ามแต่งเติม ห้ามสรุป · ท่อนที่ฟังไม่ออกจริงๆ ใช้ "[ฟังไม่ชัด]"

ตอบเป็นข้อความล้วน บรรทัดละหนึ่งท่อน รูปแบบเป๊ะๆ นี้เท่านั้น:
mm:ss|ผู้พูด|ข้อความ

ผู้พูดใช้ตัวอักษรเดียว: S = พนักงานขาย Freshket, C = คนของร้าน
ห้ามใส่หัวข้อ ห้ามใส่เลขข้อ ห้ามใส่ JSON ห้ามใส่บรรทัดอื่นนอกจากรูปแบบข้างบน

ความละเอียดที่ต้องการ (สำคัญมาก):
- ขึ้นบรรทัดใหม่**ทุกครั้งที่เปลี่ยนคนพูด** และอย่างน้อยทุก 10-15 วินาทีถึงจะพูดคนเดียวยาว
- หนึ่งบรรทัดควรสั้น ประมาณหนึ่งถึงสองประโยค — **ห้ามรวบหลายประโยคยาวๆ เป็นบรรทัดเดียว**
- ต้องถอดต่อเนื่องตลอดทั้งช่วง ห้ามข้ามช่วงไหน แม้เป็นช่วงที่คุยเรื่องนอกเรื่องหรือเงียบนาน
- ห้ามสรุปหรือเรียบเรียงใหม่ ต้องเป็นคำพูดจริงที่ได้ยิน

ตัวอย่าง:
00:03|S|สวัสดีครับพี่ วันนี้มาส่งของครับ
00:07|C|ค่ะ วางตรงนี้เลย${win}`;
}

// v_listenretry (2026-08-21): ของเดิมไม่มี retry เลย — plain fetch แล้ว throw ทันทีที่
// ไม่ใช่ 2xx · 503 "high demand" หรือ 500 ครั้งเดียวก็ล้มทั้งคลิป (เห็นจริงใน
// listen_state.last_error ของ production: `Gemini 503`, `Gemini 524`) และเมื่อรวมกับ
// จำนวนคำขอที่เพิ่มเป็นเท่าตัวจาก v_windegrade กลายเป็นเหตุที่ Gemini ไม่เคยถอดคลิปยาว
// จบอีกเลยตั้งแต่ 19 ส.ค.
//
// ไม่ใช้ withRetry() ที่มีอยู่ เพราะมันลองซ้ำ *ทุก* error ซึ่งผิดสำหรับที่นี่:
//   · 524 = คำตอบยาวเกินกว่าฝั่งโน้นจะปั่นทัน — ยิงซ้ำขนาดเดิมมีแต่พังซ้ำและกินเวลา
//     รอบละหลายนาที ต้องโยนออกทันทีให้ผู้เรียกไปเข้าทาง "ผ่าครึ่งหน้าต่าง"
//   · 400/403 = คำขอ/กุญแจผิด ลองซ้ำเท่าไหร่ก็เหมือนเดิม
const LISTEN_RETRY_DELAYS = [0, 2000, 5000];
async function _listenCall(env, fileUri, fromSec, toSec, accountName) {
  const t0 = Date.now();
  let lastErr = null;
  for (let attempt = 0; attempt < LISTEN_RETRY_DELAYS.length; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, LISTEN_RETRY_DELAYS[attempt]));
    let r;
    try {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              { file_data: { mime_type: 'audio/webm', file_uri: fileUri } },
              { text: _listenPrompt(fromSec, toSec, accountName) }
            ]}],
            generationConfig: { temperature: 0, maxOutputTokens: 65536, responseMimeType: 'text/plain' }
          }) });
    } catch (e) {
      lastErr = new Error(`Gemini เชื่อมต่อไม่ได้: ${(e && e.message) || e}`);
      continue;
    }
    if (!r.ok) {
      const err = new Error(`Gemini ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
      if (r.status === 524 || r.status === 400 || r.status === 403) throw err;
      lastErr = err;
      continue;
    }
    const d = await r.json().catch(() => null);
    const raw = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const segments = _abParseCompact(raw);
    if (!segments) { lastErr = new Error(`Gemini ตอบมาแต่อ่านไม่ออก: ${raw.slice(0, 160)}`); continue; }
    if (attempt) console.warn(`[listen] สำเร็จในความพยายามครั้งที่ ${attempt + 1}`);
    return { segments, elapsed_ms: Date.now() - t0, tries: attempt + 1 };
  }
  throw lastErr || new Error('Gemini ล้มโดยไม่มีสาเหตุที่จับได้');
}

// ทำ "หนึ่งขั้น" ของการถอดด้วย Gemini · คืน null = ยังไม่จบ ให้ tick ถัดไปทำต่อ
// คืน {segments,…} = จบแล้ว · throw = ล้มแบบที่ควรตกไป Whisper
async function runListenStep(env, row, audioBytes) {
  const st = row.listen_state || {};
  const attempts = (st.attempts || 0) + 1;
  if (attempts > LISTEN_MAX_ATTEMPTS) {
    throw new Error(`ถอดด้วย Gemini ไม่จบใน ${LISTEN_MAX_ATTEMPTS} รอบ — ตกไปใช้ตัวสำรอง`);
  }
  const save = (patch) => sbPatch(env, 'ci_sessions', `id=eq.${row.id}`,
    { listen_state: { ...st, ...patch, attempts, updated_at: new Date().toISOString() } });

  // ── ขั้นที่ 1: อัปไฟล์เข้า Gemini ครั้งเดียว แล้ววางแผนช่วงเวลา
  if (!st.file_uri) {
    const uploaded = await _geminiUploadAudio(env, audioBytes, 'audio/webm');
    const dur = row.duration_secs || 0;
    const windows = _planListenWindows(dur);
    // v_filecleanup: เก็บ file_name (คนละอันกับ file_uri) ไว้ด้วย — ต้องใช้ตอนสั่งลบ
    // ไฟล์ทิ้งเมื่อถอดจบ/เลิกใช้ (ดู _geminiDeleteFile)
    await save({ file_uri: uploaded.uri, file_name: uploaded.name, windows, next: 0, segs: [] });
    console.log(`[listen] ${row.id} อัปไฟล์เสร็จ — ${windows.length} ช่วง`);
    return null;
  }

  // ── ขั้นที่ 2..N: ถอดทีละช่วง
  const windows = st.windows || [];
  const i = st.next || 0;
  const w = windows[i];
  if (!w) throw new Error('listen_state เพี้ยน — ไม่มีช่วงให้ทำ');

  // v_attemptvisible (2026-08-21): บันทึกว่า "กำลังจะลอง" **ก่อน** ยิง ไม่ใช่หลังสำเร็จ
  //
  // ยืนยันจาก wrangler tail จริง: เส้น HTTP /process ตอบ 202 ทันทีแล้วทำงานต่อใน
  // waitUntil ซึ่ง Cloudflare **ยกเลิกทิ้ง** ถ้าคำขอ Gemini ใช้เวลานานเกินโควตา
  //   "waitUntil() tasks did not complete within the allowed time
  //    after invocation end and have been cancelled"
  // ผลคือไม่สำเร็จ ไม่ error ไม่มีตัวนับไหนขยับ = มองไม่เห็นเลยว่าเกิดอะไรขึ้น
  // (session 51 นาที 2 ตัวค้างที่หน้าต่างแรก 1.5 ชม. โดยไม่มีร่องรอยอะไรทั้งสิ้น)
  // ซึ่งเป็นบั๊กชนิดเดียวกับลูป 22 ชม. ของ Tape: เพดานที่อ่านตัวนับซึ่งไม่เคยขยับ
  // ย่อมไม่มีวันทำงาน
  //
  // เขียนก่อนยิงทำให้ความพยายามที่ถูกฆ่ากลางทางถูกนับจริง เพดาน
  // LISTEN_MAX_ATTEMPTS จึงมีผลกับความล้มเหลวแบบนี้ด้วย และ query ดูย้อนได้
  await save({});

  let res;
  try {
    res = await _listenCall(env, st.file_uri, w.from, w.to, row.account_name);
  } catch (e) {
    const msg = String(e?.message || e);
    // หมดเวลา = คำตอบยาวเกินกว่าฝั่งโน้นจะปั่นทัน "ในวันนี้" → ผ่าช่วงนั้นครึ่งหนึ่ง
    // แล้วไปต่อ · ลองขนาดเดิมซ้ำมีแต่จะพังซ้ำและเผาเงินเปล่า
    if (/\b524\b|timeout|timed out/i.test(msg)) {
      // v_winmemory: 524 บอกว่า "ขนาดคำขอนี้ใหญ่เกินไปสำหรับวันนี้" ซึ่งเป็นข้อมูลระดับ
      // session ไม่ใช่ระดับหน้าต่าง ⇒ หดแล้ววางแผน **ทุกหน้าต่างที่เหลือ** ใหม่ทีเดียว
      // แล้วจำขนาดไว้ใน listen_state.win_sec · จ่ายค่าค้นพบครั้งเดียวต่อ session
      // (คงกติกา "ขอ 2 เท่าของที่เก็บ" เสมอ เพราะ _planListenWindows คุมให้อยู่แล้ว)
      const _curWin = st.win_sec || (LISTEN_WIN_MIN * 60);
      const _newWin = Math.max(LISTEN_MIN_WIN_SEC * 2, Math.floor(_curWin / 2));
      const _keepStart = (w.from == null) ? 0 : w.from;
      if (_newWin < _curWin) {
        const remaining = _planListenWindows(row.duration_secs, _keepStart, _newWin);
        if (remaining && remaining.length) {
          windows.splice(i, windows.length - i, ...remaining);
          await save({ windows, win_sec: _newWin });
          console.warn(`[listen] ${row.id} ช่วง ${i} หมดเวลา — หดคำขอ ` +
            `${Math.round(_curWin / 60)}→${Math.round(_newWin / 60)} นาที แล้ววางแผนที่เหลือใหม่ ` +
            `${remaining.length} ก้อน (เก็บ ${Math.round(_newWin / 120)} นาที/ก้อน)`);
          return null;
        }
      }
    }
    throw e;   // เหตุอื่น (หรือหดจนสุดแล้วยังพัง) → ให้ผู้เรียกตัดสินใจตกไป Whisper
  }

  // v_winoverlap: หน้าต่างซ้อนกันแล้ว — เก็บเฉพาะครึ่งแรกของคำขอ (ครึ่งที่ยังไม่เพี้ยน)
  // ครึ่งหลังทิ้งไป เพราะช่วงเวลานั้นจะถูกถอดใหม่เป็นครึ่งแรกของคำขอถัดไป
  const kept = _keepInWindow(res.segments, w);
  const drift = (st.drift || []).concat([_windowDrift(res.segments, w, row.duration_secs)]);
  const segs = (st.segs || []).concat(kept);
  const done = i + 1 >= windows.length;
  if (!done) {
    // fails: 0 — ล้างตัวนับล้มติดกันทุกครั้งที่คืบหน้าได้จริง (ดู LISTEN_WIN_MAX_FAILS)
    await save({ next: i + 1, segs, drift, fails: 0 });
    console.log(`[listen] ${row.id} ช่วง ${i + 1}/${windows.length} เสร็จใน ${Math.round(res.elapsed_ms / 1000)} วิ ` +
      `— เก็บ ${kept.length}/${res.segments.length} ท่อน`);
    return null;
  }
  await save({ segs, drift, fails: 0 });

  // ── รวมผลทุกช่วงเป็นบทเดียว เรียงตามเวลาจริง
  // v_winoverlap: ช่วงที่ "ขอ" ซ้อนกันแล้ว แต่ช่วงที่ "เก็บ" ยังไม่ซ้อนกันโดยการออกแบบ
  // (keep ของหน้าต่าง i จบตรงที่ from ของหน้าต่าง i+1 พอดี) — ถึงอย่างนั้นก็กันซ้ำไว้อีก
  // ชั้น เพราะ Gemini ตอบเวลาคลาดออกนอกช่วงที่สั่งได้เอง และ state รูปแบบเก่า
  // (ก่อน 21 ส.ค.) ที่ยังค้างอยู่ในคิวไม่มี keep_to จะเก็บทับกันได้
  const _seen = new Set();
  const merged = segs
    .filter(s => {
      const k = `${s && s.ts}|${(s && s.text) || ''}`;
      if (_seen.has(k)) return false;
      _seen.add(k); return true;
    })
    .sort((a, b) => (_abTsToSec(a?.ts) ?? 0) - (_abTsToSec(b?.ts) ?? 0));

  // Gemini ไม่ให้ตัวเลขความมั่นใจรายท่อนแบบ Whisper — แต่มันติดป้าย "[ฟังไม่ชัด]"
  // ตามที่ prompt สั่ง จึงใช้สัดส่วนท่อนที่ฟังออกเป็นตัวแทน เพื่อให้ป้ายเตือน
  // "ถอดเสียงไม่ชัดเจน" ในแอปยังทำงานต่อได้ (ถ้าปล่อยเป็น null ป้ายจะเงียบไปเฉยๆ
  // = เสียตัวกันความผิดพลาดที่ทำไว้แล้วไปเปล่าๆ)
  const unclear = merged.filter(s => /\[ฟังไม่ชัด\]/.test(s.text || '')).length;
  // v_usability: เดิมใช้แค่สัดส่วนท่อนที่ไม่ติดป้าย [ฟังไม่ชัด] ซึ่งกระจุกใกล้ 1.0 เกือบ
  // ทุกแถวจนแยกงานดี/งานพังไม่ออก · ตอนนี้รวมความครอบคลุมกับความละเอียดเข้าไปด้วย
  const conf = _usabilityScore(merged, row.duration_secs || 0, unclear);

  const _dLast = drift[drift.length - 1];
  console.log(`[listen] ${row.id} ถอดจบ — ${merged.length} ท่อน จาก ${windows.length} ช่วง ` +
    `(ฟังไม่ชัด ${unclear} · คะแนนใช้ได้ ${conf} · drift ท้ายสุด ${_dLast ? _dLast.ratio : 'n/a'})`);
  // v_filecleanup: ถอดครบทุกช่วงแล้ว ไม่ต้องใช้ไฟล์นี้อีก — ลบทิ้ง (best-effort,
  // Google เก็บกวาดเองใน 48 ชม. เป็นตาข่ายรองอยู่แล้วถ้าลบตรงนี้พลาด)
  if (st.file_name) await _geminiDeleteFile(env, st.file_name);
  return {
    segments: merged,
    source: 'gemini-3.1-pro',
    avg_transcript_confidence: conf,
    avg_speaker_confidence: null,  // แยกคนพูดมาในรอบเดียวกัน ไม่มีคะแนนแยก
    drift                          // v_driftmeter: ส่งต่อให้ processSession เก็บลง ab_gemini
  };
}

async function processSession(sessionId, origin, env) {
  const rows = await sbSelect(env,
    `ci_sessions?id=eq.${sessionId}&select=id,owner_email,owner_type,account_id,account_name,sku_glossary,duration_secs,pipeline_stage,status,audio_path,transcript,processing_since,attempts,listen_state`);
  const row = rows && rows[0];
  if (!row) return;

  const staleIso = new Date(Date.now() - PROCESS_CLAIM_STALE_MS).toISOString();
  const claimQuery = (stage) =>
    `id=eq.${sessionId}&pipeline_stage=eq.${stage}&or=(processing_since.is.null,processing_since.lt.${encodeURIComponent(staleIso)})`;

  // ── Stage 1: uploaded / needs_gemini → transcribed ───────────────────────
  // v_needsgemini (2026-08-17): เดิม needs_gemini ไม่มี cron ไหนหยิบเลย — ไฟล์
  // ค้างตลอดกาลทั้งที่ Gemini (ตัวหลักตอนนี้) รับไฟล์ใหญ่ได้สบาย ไม่ผูกกับเพดาน
  // 24MB ของ Groq · เข้า stage นี้แปลว่า Whisper พิสูจน์แล้วว่ารับไม่ไหว จึงบังคับ
  // ใช้ Gemini อย่างเดียว ห้ามตกกลับไป Whisper ซ้ำ (จะเจอ tooLarge วนอีก)
  if ((row.pipeline_stage === 'uploaded' || row.pipeline_stage === 'needs_gemini') && row.audio_path) {
    const forcedGemini = row.pipeline_stage === 'needs_gemini';
    const claimed = await sbPatch(env, 'ci_sessions', claimQuery(row.pipeline_stage), { processing_since: new Date().toISOString() });
    if (!claimed.length) return; // another invocation owns this stage
    try {
      // v_lazyaudio (2026-08-21): เดิมโหลดไฟล์เสียงเต็มก้อนทุก tick ก่อนจะรู้ด้วยซ้ำว่า
      // ต้องใช้ไบต์หรือไม่ · คลิปยาวถอดข้าม tick ทีละหน้าต่าง และหลังอัปเข้า Gemini
      // ครั้งแรกแล้ว runListenStep ใช้แต่ file_uri **ไม่แตะ audioBytes เลย** ⇒ ทุก tick
      // ที่เหลือคือการดาวน์โหลด 15-26MB ทิ้งเปล่าๆ
      //
      // นี่คือต้นเหตุของยอด egress ที่พุ่งวันที่ 18-19 ส.ค. ที่บุชเห็น: session ของ Tape
      // (26.56MB) ติดลูป needs_gemini อยู่ 22+ ชม. โดย cron หยิบทุก 5 นาที
      // ≈ 264 tick × 26.56MB ≈ **7 GB** ดาวน์โหลดซ้ำไฟล์เดียว (โควตา free = 5 GB/เดือน)
      // บั๊กลูปนั้นปิดไปแล้วเมื่อ 19 ส.ค. (v_hiccupbudget) แต่ตัวดาวน์โหลดทิ้งยังอยู่ —
      // วัดสดวันนี้: 7 ครั้ง 99MB ทั้งที่ทำงานจริงแค่ไม่กี่หน้าต่าง
      //
      // แก้: โหลดเมื่อจำเป็นจริงเท่านั้น — รอบแรก (ยังไม่มี file_uri) หรือตอนตกไป Whisper
      const mime = row.audio_path.endsWith('.mp4') ? 'audio/mp4' : 'audio/webm';
      let audioBytes = null;
      const _haveGeminiFile = !!(row.listen_state && row.listen_state.file_uri);
      const _fetchAudio = async () => {
        if (!audioBytes) audioBytes = await sbStorageGet(env, row.audio_path);
        return audioBytes;
      };
      if (!_haveGeminiFile) await _fetchAudio();

      // ── v_listen: Gemini เป็นหูหลัก · Whisper เป็นตัวสำรอง ──────────────
      // สวิตช์ย้อนกลับ: ตั้ง env var LISTEN_ENGINE=whisper แล้วกลับไปใช้ของเดิม
      // ได้ทันทีโดยไม่ต้องแก้โค้ด (เผื่อ Gemini มีปัญหาแล้วต้องถอยด่วน)
      let t = null;
      // v_enginelatch (2026-08-21): เมื่อยอมแพ้ Gemini แล้วต้อง "ล็อก" ไว้ว่า session นี้
      // ใช้ Whisper ต่อไป · ของเดิมล้าง listen_state เป็น null แล้วส่งต่อให้ Whisper
      // ซึ่งถูก แต่ถ้ารอบ Whisper ถูกฆ่ากลางทาง (waitUntil / invocation ตาย) แถวก็กลับ
      // เป็น uploaded + listen_state null = tick ถัดไป **เริ่ม Gemini ใหม่จากศูนย์
      // อัปไฟล์ใหม่ทั้งก้อน** วนได้ไม่จำกัดโดยไม่มีตัวนับไหนขยับเลย
      // (ci_sessions.attempts ของจริงเป็น 0 ทุกแถว — ตรวจแล้ว ไม่มีเพดานคุมวงจรนี้)
      // นี่คือความล้มแบบมองไม่เห็นชนิดเดียวกับลูป 22 ชม. เป็นครั้งที่สามของวันนี้
      const _latchedWhisper = !!(row.listen_state && row.listen_state.engine === 'whisper');
      const useGemini = !_latchedWhisper &&
        (forcedGemini || (env.LISTEN_ENGINE !== 'whisper' && !!env.GEMINI_API_KEY));
      if (useGemini) {
        if (!env.GEMINI_API_KEY) {
          // ตกมาที่นี่เพราะ Whisper รับไม่ไหว แต่ไม่มีกุญแจ Gemini เลย — ไม่มีทางออก
          // ตอนนี้ ปล่อย claim + เลื่อนนัดยาว (ไม่ปิดถาวร เผื่อมีคนตั้งกุญแจให้ภายหลัง)
          await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`,
            { processing_since: null, next_attempt_at: new Date(Date.now() + THROTTLE_WAIT_MS).toISOString() });
          return;
        }
        try {
          const step = await runListenStep(env, row, audioBytes);
          if (!step) {
            // ยังไม่จบ — ปล่อย claim ให้ tick ถัดไปทำช่วงต่อไป (stage เดิม)
            // v_queuefair (2026-08-21): เซ็ต next_attempt_at ด้วย = "ยอมคิว" · order ของ
            // sweepPending คือ next_attempt_at.asc.nullsfirst,visited_at.asc และคอมเมนต์
            // ผู้เขียนระบุเจตนาว่า "ไม่มีใครผูกขาด" — แต่เส้นทางสำเร็จไม่เคยเซ็ตค่านี้เลย
            // จึงค้าง null ตลอดกาลแล้วตัว visited_at เก่าสุดยึดคิวคนเดียว (เห็นสดวันนี้:
            // session 19 ส.ค. กินคิวทั้งบ่าย อีก 2 ตัว attempts ยังเป็น 0) · ใส่เวลา
            // "เดี๋ยวนี้" ไม่ใช่อนาคต ⇒ ยังหยิบได้ tick ถัดไป แต่ไปต่อท้ายคนที่ยังไม่ได้คิว
            await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`,
              { processing_since: null, next_attempt_at: new Date().toISOString() });
            return;
          }
          t = step;
        } catch (e) {
          if (forcedGemini) {
            // v_attemptbudget (2026-08-17): needs_gemini ไม่มี Whisper ให้ถอยแล้ว —
            // ตัวคุมงบลองใหม่ที่ถูกต้องคือ listen_state.attempts/LISTEN_MAX_ATTEMPTS
            // (ตั้งไว้กว้างสำหรับ Gemini โดยเฉพาะ อยู่แล้ว) ไม่ใช่ ci_sessions.attempts/
            // MAX_ATTEMPTS ทั่วไป (เพดานแค่ 4) — ถ้าปล่อยให้ general attempts นับทุก
            // hiccup ชั่วคราว (429/500 ของหน้าต่างเดียว) จะปิดคิวถาวรทั้งที่งบ Gemini
            // จริงยังเหลือเยอะ (สองงบไม่ผูกกัน = ตายเพราะ blip ที่ไม่เกี่ยวกับ Gemini)
            const genuinelyExhausted = /ไม่จบใน \d+ รอบ/.test(String((e && e.message) || e));
            if (genuinelyExhausted) {
              // งบ Gemini เองก็หมดแล้ว (LISTEN_MAX_ATTEMPTS) และ Whisper ไม่ใช่ทางเลือก
              // สำหรับไฟล์นี้อยู่แล้ว — นี่คือความล้มเหลวถาวรจริงๆ ไม่ใช่ hiccup ชั่วคราว
              // เขียนตรง ไม่ผ่าน failStage/classifyFailure เพราะข้อความนี้สร้างเอง
              // ไม่ใช่รูปแบบ 4xx/429 ที่ classifyFailure รู้จัก จะถูกเดาผิดเป็น transient
              // v_filecleanup: จบถาวรแล้ว ไม่ใช้ไฟล์นี้อีก — ลบทิ้ง (best-effort)
              if (row.listen_state && row.listen_state.file_name) {
                await _geminiDeleteFile(env, row.listen_state.file_name);
              }
              // v_honestlabel (2026-08-21): เดิมลง failed_audio ซึ่งแอปแปลว่า "ไฟล์เสียง
              // ใช้ไม่ได้" — **โกหก** เพราะเคสนี้ไฟล์เสียงดีสมบูรณ์ ปัญหาอยู่ที่ตัวถอด
              // ไปต่อไม่ได้ล้วนๆ (ของจริง 21 ส.ค. 10:18 = 25.41MB ที่ 8,640 B/s ซึ่ง
              // อยู่ในย่านไฟล์ดี 5,150-8,910 เต็มๆ · 18 ส.ค. 11:08 เคสเดียวกัน)
              // ป้ายผิดทำให้ไล่ผิดทาง — บุชอ่าน log แล้วเข้าใจว่าไมค์พังอีกรอบ ทั้งที่
              // ไมค์ไม่เกี่ยวเลย · failed_system แอปแปลว่า "วิเคราะห์ไม่สำเร็จ" ตรงกว่า
              // และไม่ต้องแก้ฝั่งแอปเลย · ล้าง listen_state ด้วยเพื่อให้การ re-queue
              // ด้วยมือเริ่มจากแผนหน้าต่างชุดใหม่ ไม่ใช่ของเก่าที่ค้างอยู่
              await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`, {
                pipeline_stage: 'failed_system', processing_since: null, next_attempt_at: null,
                listen_state: null,
                pipeline_error: `${new Date().toISOString()} [transcribe] ไฟล์เสียงปกติดี แต่ถอดด้วย Gemini ไม่จบใน ${LISTEN_MAX_ATTEMPTS} รอบ (ไฟล์ใหญ่เกิน Whisper จึงไม่มีตัวสำรอง) — กู้ได้ด้วยการ re-queue ตราบใดที่ไฟล์เสียงยังอยู่: ${String((e && e.message) || e).slice(0, 240)}`
              }).catch(() => {});
              return;
            }
            // hiccup ชั่วคราวรายหน้าต่าง (เช่น 500 ของ Gemini ครั้งเดียว) — ปล่อย claim
            // ให้ tick ถัดไปลองซ้ำหน้าต่างเดิม (file_uri/windows ที่เสร็จแล้วยังอยู่ครบ
            // ไม่เสียความคืบหน้า) โดยไม่แตะ general attempts เลย
            //
            // v_hiccupbudget (2026-08-19): เดิมจุดนี้ไม่เคยเขียน listen_state.attempts
            // เลย — ตัวเลขนี้ถูกอัปเดตเฉพาะตอน runListenStep ไปถึง save() ของมันเอง
            // (อัปโหลดไฟล์เสร็จ/ถอดจบหน้าต่าง/หมดเวลาแล้วผ่าครึ่ง) ถ้า error ที่โดน catch
            // ตรงนี้ไม่ใช่ 524 (เช่น Gemini ตอบ 500/ตอบมาอ่านไม่ออกซ้ำๆ ที่หน้าต่างเดียวกัน)
            // จะ throw ตรงจาก _listenCall/runListenStep โดยไม่แตะ listen_state เลย —
            // attempts ที่เก็บใน DB เลยแช่นิ่งตลอดกาล ทำให้ genuinelyExhausted (เช็คจาก
            // ข้อความ "ไม่จบใน N รอบ" ที่ runListenStep โยนก็ต่อเมื่อ st.attempts>20)
            // ไม่มีทางถูก trigger เลย — วนซ้ำหน้าต่างเดิม hiccup ไปเรื่อยๆ ไม่จบไม่สิ้น
            // ไม่มีใครเห็น ไม่มีที่ไหนบันทึก (เจอจริงจาก session ของ Tape ที่ค้าง 22+ ชม.
            // แม้ cron จะ claim ใหม่ทุก tick — processing_since ขยับทุก 5 นาทีจริง แต่
            // listen_state.attempts ไม่ขยับเลยสักครั้งเดียว) แก้โดยนับ attempt นี้เข้าไป
            // ในงบจริง แม้จะยังไม่ใช่ progress ก็ตาม — ให้ hiccup ที่เกิดซ้ำๆ ที่หน้าต่าง
            // เดิมในที่สุดชนเพดาน LISTEN_MAX_ATTEMPTS แล้วจบแบบเห็นได้ (failed_audio)
            // แทนที่จะค้างเงียบตลอดกาล
            const hiccupAttempts = ((row.listen_state && row.listen_state.attempts) || 0) + 1;
            // v_hiccupvisibility (2026-08-19): console.warn alone is only visible via
            // live `wrangler tail` — which failed to capture ANY output across 4
            // separate attempts this session (cron-triggered AND HTTP-triggered),
            // a real tooling gap on this account/setup, not an event-type issue.
            // Persisting the actual error text here means a hiccup's cause is
            // queryable straight from ci_sessions afterward — no live tail needed.
            const hiccupMsg = String((e && e.message) || e).slice(0, 300);
            console.warn(`[listen] ${sessionId} needs_gemini hiccup ชั่วคราว (ครั้งที่ ${hiccupAttempts}/${LISTEN_MAX_ATTEMPTS}) — ลอง tick ถัดไป: ${hiccupMsg}`);
            await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`, {
              processing_since: null,
              next_attempt_at: new Date().toISOString(),   // v_queuefair: ยอมคิว
              listen_state: { ...(row.listen_state || {}), attempts: hiccupAttempts, last_error: hiccupMsg, updated_at: new Date().toISOString() }
            }).catch(() => {});
            return;
          }
          // v_keepprogress (2026-08-21): เดิมจุดนี้ล้าง listen_state ทิ้ง **ทันทีที่ล้ม
          // ครั้งแรก** — ทุกหน้าต่างที่ถอดเสร็จแล้วหายหมด แล้วเริ่มใหม่ด้วย Whisper
          // รวมกับ _listenCall ที่ไม่มี retry (v_listenretry) และจำนวนคำขอที่เพิ่มเป็น
          // เท่าตัวจาก v_windegrade = 503/524 ครั้งเดียวเสียงานทั้งคลิป · นี่คือกลไก
          // ที่ทำให้ตั้งแต่ 19 ส.ค. 13:16 ไม่มีคลิปยาวไหนถอดจบด้วย Gemini อีกเลย
          //
          // แก้: เก็บความคืบหน้าไว้ ให้ tick ถัดไปลองหน้าต่างเดิมต่อ (แบบเดียวกับทาง
          // forcedGemini ข้างบนที่ทำถูกอยู่แล้ว) · ตกไป Whisper เฉพาะเมื่อหน้าต่างเดิม
          // ล้มติดกันครบ LISTEN_WIN_MAX_FAILS tick หรืองบรวมหมด — มีเพดานชัดเจน
          // ไม่ปล่อยค้างตลอดกาลเหมือนบั๊ก 22 ชม. ของ Tape (v_hiccupbudget)
          const _emsg = String((e && e.message) || e);
          const _exhausted = /ไม่จบใน \d+ รอบ/.test(_emsg);
          // อ่าน listen_state ล่าสุดก่อนเขียนกลับ — **ห้าม** spread ของที่อ่านมาตอนต้น
          // ฟังก์ชัน เพราะ runListenStep อาจ save() ความคืบหน้าไปแล้วในรอบนี้ (อัปไฟล์
          // เสร็จ / ผ่าครึ่งหน้าต่างตอน 524) เขียนทับด้วยของเก่า = ลบความคืบหน้าทิ้ง
          // ซึ่งเป็นบั๊กชนิดเดียวกับที่กำลังแก้อยู่ตรงนี้
          let _cur = row.listen_state || {};
          try {
            const _fresh = await sbSelect(env, `ci_sessions?id=eq.${sessionId}&select=listen_state`);
            if (_fresh && _fresh[0] && _fresh[0].listen_state) _cur = _fresh[0].listen_state;
          } catch (_) { /* อ่านไม่ได้ก็ใช้ของที่มี ดีกว่าไม่เขียนอะไรเลย */ }
          const _fails = (_cur.fails || 0) + 1;
          if (!_exhausted && _fails < LISTEN_WIN_MAX_FAILS) {
            console.warn(`[listen] ${sessionId} Gemini สะดุด (ล้มติดกัน ${_fails}/${LISTEN_WIN_MAX_FAILS}) — ` +
              `เก็บ ${(_cur.segs || []).length} ท่อนที่ถอดไว้แล้ว ลอง tick ถัดไป: ${_emsg}`);
            await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`, {
              processing_since: null,
              next_attempt_at: new Date().toISOString(),   // v_queuefair: ยอมคิว
              listen_state: { ..._cur, fails: _fails, last_error: _emsg.slice(0, 300), updated_at: new Date().toISOString() }
            }).catch(() => {});
            return;
          }
          // ยอมแพ้จริง → ปล่อย Whisper รับช่วง งานต้องไม่ค้างเพราะฝั่งใดฝั่งหนึ่งมีปัญหา
          console.warn(`[listen] ${sessionId} Gemini ไปต่อไม่ได้ ` +
            `(${_exhausted ? 'งบหมด' : `ล้มติดกัน ${_fails} ครั้ง`}) → ใช้ตัวสำรอง Whisper: ${_emsg}`);
          // v_filecleanup: เลิกใช้ไฟล์นี้แล้ว (Whisper รับช่วงต่อจาก audioBytes ในเครื่อง
          // ไม่ใช้ file_uri) — ลบทิ้งก่อนล้าง state (best-effort)
          if (_cur.file_name) await _geminiDeleteFile(env, _cur.file_name);
          // v_enginelatch: ล็อกเป็น Whisper แทนการล้างเป็น null — ถ้ารอบ Whisper ถูกฆ่า
          // กลางทาง tick ถัดไปจะลอง Whisper ซ้ำ (ถูกและเร็ว) ไม่ใช่เริ่ม Gemini ใหม่
          // ทั้งก้อนแล้ววนเผาโควตาไปเรื่อยๆ · ความล้มของ Whisper มี failStage +
          // ci_sessions.attempts คุมเพดานอยู่แล้ว จึงจบได้จริง
          await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`,
            { listen_state: { engine: 'whisper', gave_up_at: new Date().toISOString(),
                              reason: _emsg.slice(0, 200) } }).catch(() => {});
          t = null;
        }
      }
      if (!t) {
        // v_lazyaudio: ตกมาถึงตรงนี้แปลว่าต้องใช้ไบต์จริง — ถ้ายังไม่ได้โหลดค่อยโหลดตอนนี้
        t = await runTranscribe(await _fetchAudio(), mime, row.duration_secs || 0, row.account_name || '', env, undefined, row.sku_glossary || '');
      }

      if (t.no_speech || !(t.segments || []).length) {
        // Nothing to analyze — record the outcome honestly instead of leaving
        // the row stuck (client history renders unknown stages as plain text).
        await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`,
          { pipeline_stage: 'no_speech', processing_since: null, pipeline_error: null,
            attempts: 0, next_attempt_at: null });
        // v_echor3: ไม่ลบเสียงทิ้งแล้ว — เคส no_speech ยิ่งต้องเก็บไว้ฟัง เพราะ
        // "ไม่มีเสียงพูด" อาจแปลว่าไมค์มีปัญหา ไม่ใช่ว่าไม่มีใครพูดจริงๆ
        return;
      }

      await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`, {
        transcript:            t.segments,
        transcript_source:     t.source || 'unknown',
        transcript_confidence: (typeof t.avg_transcript_confidence === 'number') ? t.avg_transcript_confidence : null,
        speaker_confidence:    (typeof t.avg_speaker_confidence === 'number') ? t.avg_speaker_confidence : null,
        pipeline_stage:        'transcribed',
        processing_since:      null,
        pipeline_error:        null,
        attempts:              0,      // ผ่าน stage แล้ว งบเริ่มนับใหม่สำหรับ stage หน้า
        next_attempt_at:       null,   // พร้อมให้ tick ถัดไปหยิบทันที
        listen_state:          null,   // v_listen: ถอดจบแล้ว ไม่ต้องเก็บสถานะระหว่างทาง
        // v_driftmeter (2026-08-21): ตัววัด drift สะสมอยู่ใน listen_state ระหว่างทาง
        // แต่บรรทัดข้างบนล้าง listen_state ทิ้งตอนสำเร็จ = ข้อมูลหายตอนที่อยากอ่านที่สุด
        // (เคสสำเร็จคือเคสที่ต้องรู้ว่าครึ่งหลังของคำขอเพี้ยนหรือยัง) จึงย้ายมาเก็บที่
        // ab_gemini ซึ่งว่างสนิทตั้งแต่ A/B harness เดิมถูกลบไปเมื่อ 17 ส.ค. (grep แล้ว
        // ไม่มีใครอ่านคอลัมน์นี้อีกเลยทั้ง worker และแอป) — ไม่ต้องเพิ่มคอลัมน์ใหม่
        ...(t.drift && t.drift.length
          ? { ab_gemini: { drift: t.drift, source: t.source || null, measured_at: new Date().toISOString() } }
          : {})
      });
      // v_echor3 (2026-08-08): เดิมลบไฟล์เสียงทิ้งตรงนี้ทันที — ผลคือคลิปจริง 43
      // จาก 44 หายถาวร พอมีคนบอกว่า "ฟังไม่รู้เรื่อง" เราจึงกลับไปฟังต้นฉบับไม่ได้
      // ลองโมเดลใหม่กับคลิปเดิมไม่ได้ พิสูจน์ไม่ได้ว่าการแก้แต่ละครั้งดีขึ้นจริง
      // → ทุกการแก้กลายเป็นการเดา นี่คือเหตุผลเชิงโครงสร้างที่ปัญหานี้วนไม่จบ
      // ตอนนี้เก็บไว้ AUDIO_RETENTION_DAYS วัน แล้ว cron ค่อยกวาดลบ (ดู sweepExpiredAudio)

      // v_queue: เลิกต่อ stage 2 ในตัวเอง — Free plan ให้ 50 subrequest ต่อ
      // invocation และ stage1+stage2 รวมกันใช้ได้ถึง ~51 · นี่คือการกลับไปทำตาม
      // หลักการที่ไฟล์นี้ประกาศไว้เองข้างบน ("ONE stage per invocation")
      // จาก HTTP: จุดชนวน invocation ใหม่ให้ (best-effort เผื่อคลิปสั้นจบทัน)
      // จาก cron: ไม่ต้องทำอะไร — แถวพร้อมแล้ว tick ถัดไปหยิบไปทำ stage 2 เอง
      if (origin) {
        await fetch(`${origin}/process`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId })
        }).catch(() => {});
      }
    } catch (e) {
      // v_queue: ปล่อย claim + ตัดสินชะตาตามสาเหตุ (ดู failStage)
      await failStage(env, sessionId, 'transcribe', e, row);
    }
    return;
  }

  // ── Stage 2: transcribed → analyzed ──────────────────────────────────────
  if (row.pipeline_stage === 'transcribed' && row.status !== 'saved') {
    const claimed = await sbPatch(env, 'ci_sessions', claimQuery('transcribed'), { processing_since: new Date().toISOString() });
    if (!claimed.length) return;
    try {
      const segments = Array.isArray(row.transcript) ? row.transcript : [];
      if (!segments.length) { // defensive — shouldn't happen past stage 1
        await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`, { processing_since: null });
        return;
      }

      // Rubric from DB, filtered by this row's role bucket — same semantics as
      // the client-side Phase R filter (null/empty roles = applies to all).
      const defs = await sbSelect(env,
        `skill_definitions?echo_enabled=eq.true&select=skill_code,skill_name_en,skill_name_th,principle_th,pass_test_th,echo_observable,roles&order=skill_code`);
      const bucket = row.owner_type || 'kam';
      const rubric = (defs || []).filter(d => !d.roles || !d.roles.length || d.roles.includes(bucket));

      // A2v2.2: cross-visit memory — the intel this kam extracted at this
      // account last time (kam_visits is upserted per kam×account below, so
      // this read IS last visit's snapshot). Non-fatal if missing.
      let priorIntel = null;
      if (row.account_id) {
        try {
          const pv = await sbSelect(env,
            `kam_visits?kam_email=eq.${encodeURIComponent(row.owner_email)}&account_id=eq.${row.account_id}&select=ci_customer_signals,ci_next_actions,ci_created_at`);
          if (pv && pv[0]) priorIntel = pv[0];
        } catch (_) {}
      }

      // A2v2.2: one strong-model call replaces summarize+analyze — the model
      // sees everything at once (summary/skills/customer stay coherent)
      const { parsed, model: aiModel, trail: aiTrail } = await runBrain(segments, rubric, bucket, priorIntel, env);
      const summary = {
        transcript_summary: parsed.transcript_summary || null,
        notes:              Array.isArray(parsed.notes) ? parsed.notes : [],
        customer_said:      Array.isArray(parsed.customer_said) ? parsed.customer_said : [],
        tone:               parsed.tone || null
      };

      // Guard: drop skill codes outside the rubric we sent (mirror of v953 client guard)
      const sentCodes = new Set(rubric.map(d => d.skill_code));
      const skills = (parsed.skills || []).filter(s => sentCodes.has(s.code));

      const skillData = {
        no_speech: false, skills,
        pipc_stage: parsed.pipc_stage || null, pipc_reached: parsed.pipc_reached || null,
        overall: parsed.overall || null, session_summary: parsed.session_summary || null
      };
      const intelData = {
        ocpb_status: parsed.ocpb_status || null,
        ocpb_facts: Array.isArray(parsed.ocpb_facts) ? parsed.ocpb_facts : [],
        next_actions: _normalizeActions(parsed.next_actions),
        // v_echor2: สรุปหนึ่งประโยคที่หน้าลูกค้าเอาไปขึ้นหัว
        headline:         typeof parsed.headline === 'string' ? parsed.headline.trim() : null,
        // A2v2.2: restaurant-lens customer intelligence
        needs:            Array.isArray(parsed.needs) ? parsed.needs : [],
        unknowns:         Array.isArray(parsed.unknowns) ? parsed.unknowns : [],
        progress_vs_last: Array.isArray(parsed.progress_vs_last) ? parsed.progress_vs_last : []
      };
      const nowIso = new Date().toISOString();

      await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`, {
        pipeline_stage: 'analyzed', status: 'saved',
        skill_scores: skillData, customer_intel: intelData, next_actions: intelData.next_actions,
        transcript_summary: summary?.transcript_summary || null,
        tone_signals: summary?.tone || null, summary_data: summary || null,
        ai_model: aiModel || null,
        ai_model_trail: aiTrail || null,   // v_echor3: ตกชั้นเพราะอะไร ดูตรงนี้
        processing_since: null,
        pipeline_error: null,
        attempts: 0,
        next_attempt_at: null
      });

      // Side tables — same writes the client pipeline did in
      // _saveAnalysisToExistingSession; the claim above guarantees single-run
      // so these inserts can't duplicate.
      if (skills.length) {
        const today = nowIso.split('T')[0];
        await sbInsert(env, 'kam_skill_log', skills.map(s => ({
          kam_email: row.owner_email, account_id: row.account_id || null,
          session_date: today, skill_code: s.code, score: s.score,
          evidence_summary: s.evidence || '', ci_session_id: sessionId
        }))).catch(() => {});

        try {
          const prof = await sbSelect(env, `profiles?email=eq.${encodeURIComponent(row.owner_email)}&select=id`);
          const userId = prof && prof[0] && prof[0].id;
          if (userId) {
            const VALID_SCORES = ['pass', 'developing', 'not_observed', 'not_applicable'];
            await sbInsert(env, 'echo_skill_observations', skills.map(s => ({
              session_id: sessionId, user_id: userId,
              skill_code: s.code, echo_code: s.code,
              ai_score: VALID_SCORES.includes(s.score) ? s.score : 'not_observed',
              evidence: s.evidence || null, coaching_note: s.coaching_note || null,
              gap: s.gap || null, observed_at: nowIso
            })));
          }
        } catch (_) {}
      }

      if (row.account_id) {
        await sbUpsert(env, 'kam_visits', {
          kam_email: row.owner_email, account_id: row.account_id,
          ci_skill_scores: skillData, ci_customer_signals: intelData,
          ci_next_actions: intelData.next_actions, ci_mode: 'echo',
          ci_created_at: nowIso, last_seen: nowIso, modes: ['echo']
        }, 'kam_email,account_id').catch(() => {});
      }
    } catch (e) {
      // v_queue: ปล่อย claim + ตัดสินชะตาตามสาเหตุ (ดู failStage)
      await failStage(env, sessionId, 'analyze', e, row);
    }
    return;
  }
  // other stages (checked_in / analyzed / no_speech): nothing to do
}

// ── Cron sweep (A2v2.2 hotfix, 2026-08-05) ───────────────────────────────────
// Live test proved the HTTP-triggered waitUntil path gets hard-killed ~30s
// after the 202 response — before the brain call (30-120s) can finish; the
// claim stayed set and the catch never ran (kill, not exception). Cron
// invocations get a full multi-minute budget, so the cron is the real engine
// and /process (HTTP) is just a best-effort fast path for short jobs.
// Requires a Cron Trigger on the worker: Settings → Triggers → ดู wrangler.toml
//
// v_queue (2026-08-12): หยิบทีละ "1 ขั้นของ 1 session" เท่านั้น
//   เพดาน Free plan คือ 50 subrequest ต่อ invocation · stage 1 ใช้ได้ถึง ~31
//   (อ่านแถว + จอง + โหลดเสียง + Groq + อัป Gemini + โพลสถานะ + diarize + เขียน)
//   และ stage 2 อีก ~19 · ของเดิม limit=3 จึงใช้ได้ถึง 51-204 = เกินเพดานอยู่แล้ว
//   (ยังไม่ระเบิดเพราะทุก session ล้มเร็ว) · ปล่อยให้ tick ถัดไปหยิบต่อ ถูกกว่า
//   และตรงกับหลักการ "ONE stage per invocation" ที่ประกาศไว้ตอนออกแบบ A2v2.1
// v_queuethru (2026-08-21): เดิม limit=1 ⇒ ทั้งระบบไหลแค่ "1 หน้าต่างต่อ 5 นาที รวม
// ทุกคน" · คลิป 51 นาที = 9 หน้าต่าง = 45 นาทีอย่างต่ำแม้คิวว่าง และวันที่ 19 ส.ค.
// มี 10 session เข้าคิวพร้อมกัน — นี่คือเหตุผลจริงที่น้องๆ รอนาน
//
// เหตุผลเดิมของ limit=1 คือเพดาน **50 subrequest ต่อ invocation** (คอมเมนต์ข้างบน:
// stage 1 กินได้ถึง ~31) ซึ่ง **เปลี่ยนไปแล้ว** หลัง v_lazyaudio: ขั้น "ถอดหนึ่ง
// หน้าต่าง" ไม่โหลดไฟล์เสียงอีก เหลือ อ่านแถว + จอง + save(attempt) + Gemini +
// save(ผล) + ปล่อย claim ≈ **6 subrequest**
//
// งบ worst case ของค่าที่ตั้งไว้ข้างล่าง: 3 หน้าต่าง × 6 + 1 analyze × 19 = **37 < 50**
// ⇒ ปลอดภัยแม้อยู่ Free plan · ถ้าจะขยับค่าพวกนี้ ต้องคิดเลขนี้ใหม่ทุกครั้ง
// v_pause (2026-08-21): สวิตช์พักสายถอดเสียง — ดูเหตุผลเต็มที่จุดใช้ในตัว scheduled()
// true = พัก · เปิดคืนได้ด้วย env var ECHO_PIPELINE_RESUME=1 โดยไม่ต้อง deploy
const ECHO_PIPELINE_PAUSED = true;

const SWEEP_MAX_STEPS   = 4;        // จำนวนขั้นต่อ tick
const SWEEP_MAX_ANALYZE = 1;        // ขั้น analyze กิน subrequest หนัก (~19) จำกัด 1
const SWEEP_DEADLINE_MS = 150000;   // ไม่เริ่มขั้นใหม่หลังผ่านไป 2.5 นาที (กัน tick ซ้อน)

async function sweepPending(env) {
  const _t0 = Date.now();
  const staleIso = new Date(Date.now() - PROCESS_CLAIM_STALE_MS).toISOString();
  const nowIso   = new Date().toISOString();
  let rows = [];
  try {
    // เงื่อนไข 3 ชั้น: เป็นงานที่ยังไม่จบ · ไม่มีใครถืออยู่ (หรือถือค้างเกิน 3 นาที)
    // · และ **ถึงเวลานัดแล้ว** — ชั้นที่สามคือของใหม่ ก่อนหน้านี้แถวที่เพิ่งล้ม
    // กลับเข้าคิวทันทีใน tick ถัดไป จึงวนลองไฟล์เดิมได้ตลอดกาล
    // เรียงตามเวลานัด (ยังไม่เคยนัด = มาก่อน) แล้วค่อยตามลำดับ visit → ไม่มีใครผูกขาด
    rows = await sbSelect(env,
      `ci_sessions?select=id,pipeline_stage,status,processing_since,attempts` +
      // v_needsgemini (2026-08-17): needs_gemini เดิมไม่มี cron ไหนหยิบเลย — เพิ่มเข้ามา
      // ให้เข้าคิวเหมือน uploaded (ดู processSession Stage 1 สำหรับตรรกะบังคับ Gemini)
      `&and=(or(pipeline_stage.eq.uploaded,pipeline_stage.eq.needs_gemini,and(pipeline_stage.eq.transcribed,status.eq.draft)),` +
      `or(processing_since.is.null,processing_since.lt.${encodeURIComponent(staleIso)}),` +
      `or(next_attempt_at.is.null,next_attempt_at.lte.${encodeURIComponent(nowIso)}))` +
      `&order=next_attempt_at.asc.nullsfirst,visited_at.asc&limit=${SWEEP_MAX_STEPS}`);
  } catch (_) { return; }
  let _analyzeDone = 0, _steps = 0;
  for (const r of rows) {
    // เลยกำหนดเวลาแล้ว = หยุดรับงานใหม่ ปล่อยให้ tick ถัดไปทำต่อ (แถวที่เหลือยังอยู่
    // ในคิว ไม่ได้ถูก claim จึงไม่มีอะไรค้าง)
    if (Date.now() - _t0 > SWEEP_DEADLINE_MS) {
      console.log(`[sweep] ถึงกำหนดเวลา — ทำได้ ${_steps}/${rows.length} ขั้น ที่เหลือรอ tick ถัดไป`);
      break;
    }
    // ขั้น analyze (transcribed→analyzed) กิน subrequest หนักกว่ามาก จำกัดต่อ tick
    const _isAnalyze = r.pipeline_stage === 'transcribed';
    if (_isAnalyze && _analyzeDone >= SWEEP_MAX_ANALYZE) continue;
    if (_isAnalyze) _analyzeDone++;
    _steps++;
    try { await processSession(r.id, null, env); } catch (_) {}
  }
  await _alertIfFailingOften(env);
}

// v_audiofix (2026-08-15): 14 ส.ค. การอัด 5 จาก 6 คลิปล้ม แล้ว **ไม่มีใครรู้เลย**
// จนบุชมาถามเองในวันถัดมา · ไม่มีที่ไหนในระบบที่ส่งเสียงเมื่อของพังเป็นชุด
// ตัวนี้ไม่ได้กันพัง แต่ทำให้ "พังแล้วรู้ภายในวันเดียว" ซึ่งคือส่วนที่ขาดจริงๆ
// (อ่านผ่าน `npx wrangler tail` — ยังไม่ผูกกับช่องทางแจ้งเตือนภายนอก)
let _lastFailAlertAt = 0;
async function _alertIfFailingOften(env) {
  if (Date.now() - _lastFailAlertAt < 6 * 3600 * 1000) return;   // เตือนอย่างมาก 4 ครั้ง/วัน
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const rows = await sbSelect(env,
      `ci_sessions?select=id,pipeline_stage,pipeline_error` +
      `&pipeline_stage=in.(failed_audio,failed_system)&created_at=gte.${encodeURIComponent(since)}&limit=20`);
    if (!rows || rows.length < 2) return;
    _lastFailAlertAt = Date.now();
    console.error(`[ALERT] 🔴 การถอดเสียงล้ม ${rows.length} รายการใน 24 ชม. — ตัวอย่างสาเหตุ:`);
    for (const r of rows.slice(0, 3)) {
      console.error(`  · ${r.id} (${r.pipeline_stage}) ${String(r.pipeline_error || '').slice(0, 160)}`);
    }
  } catch (_) { /* การเตือนพังต้องไม่ทำให้คิวพัง */ }
}

// v_echor3: เก็บไฟล์เสียงไว้กี่วันก่อนลบ · ตั้งค่าได้ผ่าน env ถ้าอยากยืด/หด
// โดยไม่ต้อง deploy ใหม่ · ตั้ง AUDIO_RETENTION_DAYS=0 = ปิดการลบทั้งหมด
// v_retention7 (2026-08-17): 30→7 ตามที่บุชเคาะ — นี่คือค่าสำรองกรณีไม่มี env
// var ตั้งไว้เลย (ดู wrangler.toml [vars] สำหรับค่าจริงที่ deploy จริง)
const AUDIO_RETENTION_DAYS = 7;

// กวาดลบไฟล์เสียงที่เกินอายุ — แทนที่การลบทันทีหลังถอดเสร็จแบบเดิม
// เจตนา: ต้องเก็บนานพอให้กลับไปฟัง ลองโมเดลใหม่ และสร้างชุดทดสอบจากของจริงได้
// แต่ไม่เก็บถาวร (ทั้งเรื่องค่า storage และเรื่องข้อมูลลูกค้าในคลิป)
async function sweepExpiredAudio(env) {
  const days = Number(env.AUDIO_RETENTION_DAYS ?? AUDIO_RETENTION_DAYS);
  if (!Number.isFinite(days) || days <= 0) return;   // 0 = ปิดการลบ
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  let rows = [];
  try {
    rows = await sbSelect(env,
      `ci_sessions?select=id,audio_path,visited_at` +
      `&audio_path=not.is.null&visited_at=lt.${encodeURIComponent(cutoff)}` +
      `&order=visited_at.asc&limit=25`);
  } catch (_) { return; }
  for (const r of rows) {
    try {
      await sbStorageDelete(env, r.audio_path);
      await sbPatch(env, 'ci_sessions', `id=eq.${r.id}`, { audio_path: null });
    } catch (e) {
      // ลบไม่สำเร็จ = ปล่อยไว้ให้ tick หน้าลองใหม่ · ห้าม null คอลัมน์ทิ้ง
      // เพราะจะกลายเป็นไฟล์กำพร้าใน storage ที่ไม่มีใครรู้ว่ามีอยู่
      console.error(`[audio-sweep] ${r.id} ลบไม่สำเร็จ: ${e?.message || e}`);
    }
  }
}

// v_skilllog (2026-08-17): echo_skill_observations/kam_skill_log ไม่มีนโยบายลบ
// เลยมาก่อน ต่างจากไฟล์เสียงที่มี sweepExpiredAudio อยู่แล้ว — ตอนนี้ยังเล็กมาก
// (880KB/432KB, ~1,100/~1,000 แถว) ไม่เร่งด่วน แต่โตขึ้นเรื่อยๆ ตาม session ที่
// วิเคราะห์เสร็จ ควรมีเพดานไว้ก่อนสเกล
//
// ตั้งยาวกว่าเสียงมาก (คนละธรรมชาติข้อมูล — นี่คือบันทึก coaching/skill trend
// ไม่ใช่เสียงดิบลูกค้า ไม่มีเหตุผลเรื่อง privacy ต้องรีบลบเหมือนเสียง) 400 วัน
// ครอบคลุมเกิน 4 ไตรมาสเผื่อดู skill trend ย้อนหลังข้ามปี — ปรับได้ผ่าน env
// ถ้าต้องการสั้น/ยาวกว่านี้ (0 = ปิดการลบทั้งหมด เหมือน AUDIO_RETENTION_DAYS)
const SKILL_LOG_RETENTION_DAYS = 400;
// v_errretention (2026-08-21): app_errors เป็นตารางใหญ่สุดของฐาน (4,166 แถว / 2.1MB
// จากฐานทั้งก้อน 24MB) และไม่มีนโยบายลบเลยมาก่อน · เป็น log ไล่ปัญหา ไม่ใช่ข้อมูล
// ธุรกิจ — 30 วันพอสำหรับการไล่บั๊ก (render storm ที่เจอเมื่อ 20 ส.ค. ใช้ข้อมูล 7 วัน)
const ERROR_LOG_RETENTION_DAYS = 30;

async function sweepExpiredSkillLogs(env) {
  const days = Number(env.SKILL_LOG_RETENTION_DAYS ?? SKILL_LOG_RETENTION_DAYS);
  if (!Number.isFinite(days) || days <= 0) return;   // 0 = ปิดการลบ
  const cutoffIso  = new Date(Date.now() - days * 86400000).toISOString();
  const cutoffDate = cutoffIso.slice(0, 10);   // kam_skill_log.session_date เป็น DATE ไม่ใช่ timestamp
  try {
    await sbDelete(env, 'echo_skill_observations', `observed_at=lt.${encodeURIComponent(cutoffIso)}`);
  } catch (e) { console.error('[skill-log-sweep] echo_skill_observations ลบไม่สำเร็จ:', e?.message || e); }
  try {
    await sbDelete(env, 'kam_skill_log', `session_date=lt.${encodeURIComponent(cutoffDate)}`);
  } catch (e) { console.error('[skill-log-sweep] kam_skill_log ลบไม่สำเร็จ:', e?.message || e); }
  // v_errretention (2026-08-21): app_errors ไม่มีนโยบายลบเลยมาก่อน และตอนนี้เป็น
  // ตารางใหญ่สุดของฐาน (4,166 แถว / 2.1MB จากฐานทั้งก้อน 24MB) · เป็น log สำหรับไล่
  // ปัญหา ไม่ใช่ข้อมูลธุรกิจ เก็บ 30 วันพอ · เกาะรอบ 03:00 UTC เดียวกัน ไม่เพิ่ม cron
  const errCutoff = new Date(Date.now() - ERROR_LOG_RETENTION_DAYS * 86400000).toISOString();
  try {
    await sbDelete(env, 'app_errors', `created_at=lt.${encodeURIComponent(errCutoff)}`);
  } catch (e) { console.error('[skill-log-sweep] app_errors ลบไม่สำเร็จ:', e?.message || e); }
}

async function handleListModels(env) {
  if (!env.GEMINI_API_KEY) return json({ error: 'ไม่มี GEMINI_API_KEY' }, 400, env);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}&pageSize=200`);
    const d = await r.json();
    const usable = (d?.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => (m.name || '').replace(/^models\//, ''))
      .sort();
    return json({
      gemini_ที่เรียกได้: usable,
      chain_ที่ตั้งไว้: BRAIN_MODEL_CHAIN.filter(m => m.provider === 'gemini').map(m => m.model),
      ตัวที่ตั้งไว้แต่เรียกไม่ได้: BRAIN_MODEL_CHAIN
        .filter(m => m.provider === 'gemini' && !usable.includes(m.model)).map(m => m.model)
    }, 200, env);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502, env);
  }
}


function _abTsToSec(ts) {
  const m = String(ts || '').match(/^(\d+):(\d+)(?::(\d+))?$/);
  if (!m) return null;
  return m[3] ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) : (+m[1] * 60 + +m[2]);
}
function _abSecToTs(sec) {
  const s = Math.max(0, Math.round(sec));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// ── รูปแบบคำตอบแบบประหยัด (v_ears 14 ส.ค. เย็น) ───────────────────────────
// วัดจริง: JSON หนึ่งท่อนกิน ~54 token ทั้งที่เนื้อความจริงราว 20-30
// ({"ts": "00:01", "speaker": "Sales", "text": "…"} = โครงห่อล้วนๆ ~25 token)
// เปลี่ยนเป็นบรรทัดละท่อน `mm:ss|S|ข้อความ` ตัดทิ้งได้ ~40%
// สำคัญเพราะ **ตัวชนเพดาน 128 วิ คือจำนวน token ที่ต้องปั่น** — คำตอบสั้นลง 40%
// = คลิปยาวขึ้น 1.6 เท่าถึงจะชนเพดาน และค่าใช้จ่ายฝั่ง output ลดตามตรง
function _abParseCompact(raw) {
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    // v_tslong (2026-08-21): เดิมรับนาทีแค่ 1-2 หลัก แต่ _abSecToTs ออก 3 หลักเมื่อ
    // เกิน 100 นาที ⇒ คลิปยาวเกิน 100 นาทีทุกบรรทัดไม่ match แล้ว _abParseCompact
    // คืน null → "Gemini ตอบมาแต่อ่านไม่ออก" ทั้งไฟล์ · ไม่เคยระเบิดเพราะเพดาน
    // LISTEN_MAX_ATTEMPTS เดิมตัดคลิปยาวออกไปก่อนอยู่แล้ว แต่ตอนนี้เพดานขยายเป็น 48
    // ทำให้คลิปยาวขนาดนั้นถึงจุดนี้ได้จริง (ของจริงมีถึง 79 นาทีแล้ว)
    const m = line.match(/^\s*(\d{1,3}:\d{2}(?::\d{2})?)\s*\|\s*([^|]{0,20}?)\s*\|\s*(.+?)\s*$/);
    if (!m) continue;
    const sp = m[2].trim();
    out.push({
      ts: m[1],
      speaker: sp === 'S' ? 'Sales' : (sp === 'C' ? 'ลูกค้า' : sp),
      text: m[3].trim()
    });
  }
  return out.length ? out : null;
}

// ── Key SKU → Google Sheets export (v_keyexport, 2026-08-16) ───────────────
// บุชขอ: ไม่ต้องอัปเดตถี่ (ทีม supply เช็ควันละไม่กี่ครั้งพอ) แค่ 4 รอบ/วันตาม
// เวลาไทยที่กำหนด และห้ามให้โครงสร้างนี้กินพื้นที่ Supabase เพิ่ม (free plan)
// — เกาะกับ cron ที่มีอยู่แล้ว (ทุก 5 นาที 2-15 UTC ใน wrangler.toml) เหมือน
// sweepExpiredAudio ทำ ไม่เพิ่ม cron trigger ใหม่เลย (ทุกเวลาข้างล่างอยู่ในช่วง
// 2-15 UTC เดิมพอดี) และไม่เพิ่มตาราง/คอลัมน์ใหม่ — ใช้ key_skus_export_state
// แถวเดียว (id=1, สร้างไว้แล้วตั้งแต่ KEY-9) แค่เก็บ last_exported_at เฉยๆ
// เป็นสแนปช็อตทั้งก้อนทุกรอบ (ไม่ใช่ event queue) พลาดรอบไหนไม่มีข้อมูลหาย
// รอบถัดไปส่งของปัจจุบันซ้ำเองอยู่แล้ว จึงไม่ต้องมี retry/backoff ก็ได้
//   12:00 / 15:00 / 17:00 / 20:00 น. ไทย = 05:00 / 08:00 / 10:00 / 13:00 UTC
const KEY_EXPORT_UTC_HOURS = [5, 8, 10, 13];

function _b64urlFromBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64urlJson(obj) {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _pemToDer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
                 .replace(/-----END PRIVATE KEY-----/, '')
                 .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Self-signed JWT → Google OAuth token (RFC 7523 service-account flow) เซ็นด้วย
// Web Crypto API เพราะ Workers ไม่มี Node crypto ให้ใช้
async function _googleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${_b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${_b64urlJson({
    iss: env.GOOGLE_SA_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  })}`;
  const key = await crypto.subtle.importKey('pkcs8', _pemToDer(env.GOOGLE_SA_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${_b64urlFromBytes(new Uint8Array(sigBuf))}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`
  });
  if (!r.ok) throw new Error(`google token ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
  return (await r.json()).access_token;
}

function _sheetsValuesUrl(env, range, suffix, qs) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEETS_SPREADSHEET_ID}` +
    `/values/${encodeURIComponent(range)}${suffix || ''}`;
  return qs ? `${base}?${qs}` : base;
}
async function _sheetsFetch(token, url, method, body) {
  const r = await fetch(url, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(`sheets ${method} ${url} ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
  return r.json();
}
function _keyExportThaiStamp(d) {
  const t = new Date(d.getTime() + 7 * 3600 * 1000); // ไม่พึ่ง Intl locale data
  const p = n => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())} น.`;
}

async function exportKeySkusToSheet(env) {
  if (!env.GOOGLE_SA_CLIENT_EMAIL || !env.GOOGLE_SA_PRIVATE_KEY || !env.GOOGLE_SHEETS_SPREADSHEET_ID) {
    console.log('[key-sku-export] ยังไม่ได้ตั้ง Google secrets — ข้ามรอบนี้');
    return;
  }
  const rows = await sbSelect(env,
    `key_skus?status=eq.active&select=account_name,outlet_id,outlet_name,sku_id,sku_name,set_by,set_at` +
    `&order=account_name.asc,outlet_name.asc,sku_name.asc&limit=5000`);

  // v_keyoutlet 2026-08-16: supply planning works at outlet grain — res_name/
  // res_id (their terms) = outlet_name/outlet_id here. account_name kept as
  // context since one account can have several outlets.
  const header = ['บริษัท (account)', 'res_name', 'res_id (user_id)', 'รหัส SKU', 'ชื่อ SKU', 'ผู้บันทึกโดย (KAM)', 'วันที่บันทึก'];
  const body = rows.map(r => [
    r.account_name || '', r.outlet_name || '', r.outlet_id || '', r.sku_id || '', r.sku_name || '',
    r.set_by || '', r.set_at ? _keyExportThaiStamp(new Date(r.set_at)) : ''
  ]);
  const now = new Date();

  const token = await _googleAccessToken(env);
  await _sheetsFetch(token, _sheetsValuesUrl(env, "'Key SKUs'!A1:Z10000", ':clear'), 'POST', {});
  await _sheetsFetch(token, _sheetsValuesUrl(env, "'Key SKUs'!A1", '', 'valueInputOption=USER_ENTERED'), 'PUT',
    { values: [header, ...body] });
  await _sheetsFetch(token, _sheetsValuesUrl(env, "'Change Log'!A1", ':append',
    'valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS'), 'POST',
    { values: [[_keyExportThaiStamp(now), body.length]] });

  // แถวเดียว ไม่มี insert เพิ่ม — ไม่กินพื้นที่โตขึ้นเลย
  await sbPatch(env, 'key_skus_export_state', 'id=eq.1', { last_exported_at: now.toISOString() })
    .catch(e => console.warn('[key-sku-export] อัป last_exported_at ไม่ผ่าน (ไม่ critical)', e));

  console.log(`[key-sku-export] ส่งออกสำเร็จ ${body.length} รายการ`);
}

// ── Router ────────────────────────────────────────────────────────────────────
export default {
  async scheduled(event, env, cfCtx) {
    if (!env.SUPABASE_SERVICE_KEY) return;
    // v_needsgemini (2026-08-17): เดิมมีด่าน sweepAbGemini (ห้องทดลอง A/B) คั่นหน้า
    // sweepPending ทุก tick — เคาะโมเดลจบแล้ว (Gemini ชนะ) ถอดออกแล้วตามที่ตั้งใจ
    // ไว้ตั้งแต่แรก (docs/supabase-migration-ears-ab-2026-08-14.sql) เพราะมันกัน
    // คิวจริงได้นานสุด ~100 นาที/แถวที่ติดธง และปิดเสียงแจ้งเตือนความล้มเหลวไปด้วย
    // v_queue: กวาดไฟล์เสียงหมดอายุวันละครั้งพอ (03:00 UTC = 10 โมงเช้าไทย)
    // ของเดิมยิงคู่กับ sweepPending ทุก tick — งานนั้นใช้ได้ถึง 51 subrequest
    // ในตัวมันเอง จึงแย่งเพดาน 50 ของ invocation เดียวกันกับงานหลักโดยไม่จำเป็น
    const at = new Date(event && event.scheduledTime ? event.scheduledTime : Date.now());
    const _isDailyTick = at.getUTCHours() === 3 && at.getUTCMinutes() < 5;
    // v_sweepsolo (2026-08-21): tick ของงานกวาดรายวัน **ไม่ต้องทำคิวด้วย** · ตอนนี้
    // sweepPending กินเวลาได้ถึง 150 วิ (v_queuethru) ถ้าปล่อยคู่กันใน waitUntil
    // เดียวกัน งานกวาดจะเสี่ยงถูกยกเลิกทิ้งแบบเดียวกับที่ /process เจอ — และงานกวาด
    // ที่ถูกฆ่าจะไม่ทิ้งร่องรอยอะไรเลยเหมือนกัน · เสียคิวไป 5 นาทีวันละครั้งคุ้มกว่า
    if (_isDailyTick) {
      cfCtx.waitUntil(sweepExpiredAudio(env));
      // v_skilllog: เกาะรอบ 03:00 UTC เดียวกัน — ไม่เพิ่ม cron trigger ใหม่
      cfCtx.waitUntil(sweepExpiredSkillLogs(env));
    } else if (ECHO_PIPELINE_PAUSED && env.ECHO_PIPELINE_RESUME !== '1') {
      // v_pause (2026-08-21 20:xx +07): หยุดสายถอดเสียงชั่วคราว
      //
      // ทำไม: Supabase Cached Egress เกินโควตา 327% (16.33/5 GB) และ grace period
      // หมด 22 ส.ค. · ต้นเหตุคือการดึงไฟล์เสียงออกจาก Supabase Storage ไปถอด
      // (71 จาก 88 request ใน 24 ชม. เป็น cache HIT = ถูกนับเต็มขนาดไฟล์ทุกครั้ง)
      // ยอดที่ใช้ไปแล้วลบไม่ได้ แต่หยุดไม่ให้โตต่อได้ ⇒ พักไว้จนกว่าจะย้ายไฟล์เสียง
      // ไป R2 เสร็จ (R2 ไม่คิดค่าขาออก) หรือจนกว่าจะอัปแผน
      //
      // **การอัดเสียงยังทำงานปกติ ไม่มีอะไรหาย** — ไฟล์ยังถูกอัปโหลดและ row ยังถูก
      // สร้างครบ แค่ยังไม่ถูกถอดเป็นข้อความจนเปิดคืน
      //
      // เปิดคืน 2 ทาง: (1) ตั้ง env var ECHO_PIPELINE_RESUME=1 บน Cloudflare
      // dashboard ได้ทันทีโดยไม่ต้อง deploy · (2) แก้ค่าคงที่ข้างล่างเป็น false
      console.warn('[pause] สายถอดเสียงถูกพักไว้ (v_pause) — ตั้ง ECHO_PIPELINE_RESUME=1 เพื่อเปิดคืน');
    } else {
      cfCtx.waitUntil(sweepPending(env));
    }
    // v_keyexport: ส่งออก Key SKU ไป Google Sheets 4 รอบ/วันตามเวลาไทยที่บุชขอ
    if (KEY_EXPORT_UTC_HOURS.includes(at.getUTCHours()) && at.getUTCMinutes() < 5) {
      cfCtx.waitUntil(exportKeySkusToSheet(env).catch(e => console.error('[key-sku-export] ล้มเหลว', e)));
    }
  },
  async fetch(request, env, cfCtx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env) });
    // v_echor3: /models = ถาม Google ตรงๆ ว่า key นี้เรียกรุ่นไหนได้บ้าง
    // มีเพราะ chain เดิมใส่ชื่อรุ่นที่ "ไม่มีอยู่จริง" ไว้บนสุด แล้วตกลงมาชั้นล่างสุด
    // เงียบๆ 17 จาก 18 ครั้ง — ต่อไปอย่าเดาชื่อรุ่น ให้เปิดอันนี้ดูก่อน (GET ได้)
    if (new URL(request.url).pathname === '/models') return handleListModels(env);
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, env);
    const url = new URL(request.url);
    if (url.pathname === '/process')           return handleProcess(request, env, cfCtx);
    if (url.pathname === '/transcript')        return handleTranscript(request, env);
    if (url.pathname === '/transcript-gemini') return handleTranscriptGeminiFull(request, env); // v2 path, kept for A/B
    if (url.pathname === '/summarize')     return handleSummarize(request, env);
    if (url.pathname === '/analyze')       return handleAnalyze(request, env);
    if (url.pathname === '/eval')          return handleEval(request, env);
    if (url.pathname === '/transcribe')    return handleTranscribe(request, env);
    if (url.pathname === '/analyze-audio') return handleAnalyzeAudio(request, env);

    // ช่องทาง AI กลางของ Sense (ไม่มี path) — ตัวจริงอยู่ใน handleGeneralAI
    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON' }, 400, env); }
    return handleGeneralAI(body, env);
  }
};
