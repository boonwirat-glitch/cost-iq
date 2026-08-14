// Cloudflare Worker AI proxy for Freshket Sense — Echo v2 transcript
// freshket-sense-ai-proxy-v2.js
// v2: /transcript ใช้ Gemini 3.5 Flash audio-native (แทน Groq Whisper + Gemini Lite)
// /summarize /analyze /eval และ legacy routes คงเดิมทุกอย่าง
// ไฟล์นี้ deploy แยกจาก proxy เดิม — เปลี่ยน WORKER_URL ใน 09_conv_intel.js เพื่อ test
//
// Env secrets: ANTHROPIC_API_KEY, GROQ_API_KEY, GEMINI_API_KEY
//              SUPABASE_SERVICE_KEY (A2v2.1 — required by /process only; every
//              other endpoint works without it)
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

// ── v_ears P0 (2026-08-14): ห้องทดลอง A/B — Gemini ฟังเสียงตรง single-pass ──
// เทียบกับ pipeline ปัจจุบัน (Groq Whisper + Gemini diarize) บนคลิปจริงที่เก็บไว้
// ใน storage · **ชั่วคราว** — ถอดออกเมื่อ P0 จบและเคาะโมเดลแล้ว
//
// ทำไมอยู่ใน worker ไม่ใช่สคริปต์ local: API key ทุกตัวอยู่ที่นี่ (ไม่มีสำเนา
// ในเครื่อง dev) และ transcript ฝั่ง pipeline เดิมมีใน DB แล้ว ไม่ต้องรันซ้ำ
// จึงเหลือรันแค่ขา Gemini — 1 คลิปต่อ 1 คำขอ ยิงจาก curl ภายนอก
//
// กันคนนอกยิงเล่น (endpoint อื่นของ worker นี้เปิด CORS ไม่มี auth):
// ผู้เรียกต้องส่ง audio_path ที่ตรงกับแถวจริงใน DB มาด้วย — รู้ได้เฉพาะคนที่
// อ่าน DB ได้อยู่แล้ว (auth-by-knowledge, พอสำหรับ endpoint ทดลองอายุสั้น)
async function handleAbGeminiTranscribe(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not set' }, 503, env);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }
  const { session_id, audio_path, model, max_output_tokens, file_uri, from, to } = body || {};
  if (!session_id || !audio_path) return json({ error: 'session_id + audio_path required' }, 400, env);
  try {
  const rows = await sbSelect(env, `ci_sessions?id=eq.${session_id}&select=id,audio_path,duration_secs,account_id`);
  const row = rows && rows[0];
  if (!row || row.audio_path !== audio_path) return json({ error: 'session/audio_path mismatch' }, 403, env);

  const t0 = Date.now();
  // v_ears: อัปโหลดครั้งเดียวแล้วส่ง file_uri กลับ — รอบถัดไปส่งกลับมาได้เลย
  // ไม่ต้องโหลด+อัปซ้ำ (ไฟล์อยู่บน Gemini ~48 ชม.) · จำเป็นเพราะคลิป 19 นาที
  // ยิงรอบเดียวโดน 524 timeout ต้องซอยเป็นหน้าต่างละ ~5 นาทีแล้วยิงหลายรอบ
  const fileUri = file_uri || await _geminiUploadAudio(env, await sbStorageGet(env, row.audio_path), 'audio/webm');
  // แยกขั้น: รอบแรกอัปอย่างเดียวแล้วคืน uri (รู้ว่าอัปกินเวลาเท่าไร) รอบถัดไป
  // ค่อยถอดทีละหน้าต่าง — กัน 524 ที่เกิดจาก อัป+ถอด รวมกันเกิน gateway timeout
  if (body.upload_only) {
    return json({ session_id, file_uri: fileUri, upload_ms: Date.now() - t0 }, 200, env);
  }
  const windowNote = (from || to)
    ? `\n\n**ถอดเฉพาะช่วงเวลา ${from || '00:00'} ถึง ${to || 'จบไฟล์'} เท่านั้น** ข้ามช่วงอื่นทั้งหมด ts ที่ตอบให้อ้างอิงเวลาจริงในไฟล์`
    : '';

  // single-pass: ถอด + แยกคนพูดจากเสียงจริงในรอบเดียว (ต่างจาก pipeline เดิม
  // ที่ Whisper ถอดก่อนแล้ว Gemini แค่แปะชื่อ) — คำถามที่ P0 ต้องตอบคือ
  // "หูของ Gemini ฟังไทยในร้านอาหารจริงแม่นกว่า Whisper แค่ไหน"
  const prompt = `ถอดเสียงบทสนทนาภาษาไทยนี้แบบคำต่อคำ (verbatim) พร้อมระบุคนพูด

บริบท: พนักงานขายของ Freshket (บริษัทขายวัตถุดิบอาหารให้ร้านอาหาร) คุยกับคนของร้านอาหาร ณ ร้าน อาจมีเสียงรบกวน
- speaker: "Sales" = ฝั่ง Freshket, "ลูกค้า" = ฝั่งร้าน (ถ้าได้ยินชื่อจริงใช้ชื่อนั้นแทนได้)
- คำเฉพาะที่อาจได้ยิน: Freshket, SKU, order, delivery, กิโล, ลัง, เครดิต, วางบิล, ใบเสนอราคา
- ถอดตามที่ได้ยินจริง ห้ามแต่งเติม ห้ามสรุป · ท่อนที่ฟังไม่ออกจริงๆ ใช้ "[ฟังไม่ชัด]"

ตอบ JSON เท่านั้น:
{"segments":[{"ts":"mm:ss","speaker":"Sales","text":"..."}],"speakers_detected":["Sales","ลูกค้า"]}${windowNote}`;

  const useModel = model || 'gemini-3.1-pro-preview';
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { file_data: { mime_type: 'audio/webm', file_uri: fileUri } },
          { text: prompt }
        ]}],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: max_output_tokens || 65536,
          responseMimeType: 'application/json'
        }
      })
    });
  if (!r.ok) return json({ error: `Gemini ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}` }, 502, env);
  const data = await r.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let parsed = null;
  try { parsed = JSON.parse(rawText); }
  catch (_) {
    const s = rawText.indexOf('{'), e = rawText.lastIndexOf('}');
    if (s !== -1 && e !== -1) { try { parsed = JSON.parse(rawText.slice(s, e + 1)); } catch (_) {} }
  }
  return json({
    session_id,
    model: useModel,
    file_uri: fileUri,            // ส่งกลับให้รอบถัดไปใช้ซ้ำ ไม่ต้องอัปใหม่
    window: (from || to) ? `${from || '00:00'}-${to || 'end'}` : 'full',
    elapsed_ms: Date.now() - t0,
    finish_reason: data?.candidates?.[0]?.finishReason || null,
    usage: data?.usageMetadata || null,       // ใช้คิดต้นทุนจริงต่อคลิป
    parsed_ok: !!(parsed && Array.isArray(parsed.segments)),
    segments: parsed?.segments || null,
    speakers_detected: parsed?.speakers_detected || null,
    raw_head: parsed ? undefined : rawText.slice(0, 500)   // debug เมื่อ parse พัง
  }, 200, env);
  } catch (e) {
    // endpoint ทดลอง — ตอบสาเหตุตรงๆ ดีกว่าปล่อยเป็น 1101 ให้เดา
    return json({ error: String(e?.message || e) }, 500, env);
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
  return f.uri;
}

async function runTranscribe(audioBytes, mimeType, durationSecs, accountName, env, audioB64, skuGlossary) {
  const account_name = accountName;
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
  const promptParts = ['Freshket', 'ออเดอร์', 'เครดิต', 'วางบิล', 'ใบเสนอราคา', 'กิโล', 'ลัง'];
  const safeAccountName = String(account_name || '').trim().slice(0, 60);
  if (safeAccountName) promptParts.push(safeAccountName);
  const safeGlossary = String(skuGlossary || '').trim().slice(0, 300);
  if (safeGlossary) promptParts.push(safeGlossary);
  const dynamicPrompt = promptParts.join(' ');
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
  try {
    // v_cpudiet: เส้นทาง async (cron/process) ไม่มี b64 — อัปโหลดไฟล์ดิบแล้วอ้าง
    // ด้วย file_data · เส้นทาง legacy (/transcript) client ส่ง b64 มาอยู่แล้ว
    // ใช้ inline_data ต่อได้ฟรีๆ ไม่ต้องแปลงซ้ำ
    const audioPart = audioB64
      ? { inline_data: { mime_type: mime_type || 'audio/webm', data: audioB64 } }
      : { file_data: { mime_type: mime_type || 'audio/webm', file_uri: await _geminiUploadAudio(env, audioBytes, mime_type) } };
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
  }

  const n = segments.length;
  return {
    no_speech: false,
    segments,
    speakers_detected: speakersDetected.length ? speakersDetected : [...new Set(segments.map(s => s.speaker))],
    duration_mins: Math.round((duration_secs || segments[n - 1].end_sec || 0) / 60),
    source: diarized ? 'groq_whisper_gemini_diarize' : 'whisper_fallback',
    avg_speaker_confidence: n ? segments.reduce((a, s) => a + s.speaker_confidence, 0) / n : 0,
    avg_transcript_confidence: n ? segments.reduce((a, s) => a + s.transcript_confidence, 0) / n : 0
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
      const gcfg = { maxOutputTokens: Math.max(maxTokens || 2000, 2048), temperature: 0.2 };
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
  cfCtx.waitUntil(processSession(sessionId, origin, env).catch(() => {}));
  return json({ accepted: true, session_id: sessionId }, 202, env);
}

async function processSession(sessionId, origin, env) {
  const rows = await sbSelect(env,
    `ci_sessions?id=eq.${sessionId}&select=id,owner_email,owner_type,account_id,account_name,sku_glossary,duration_secs,pipeline_stage,status,audio_path,transcript,processing_since,attempts`);
  const row = rows && rows[0];
  if (!row) return;

  const staleIso = new Date(Date.now() - PROCESS_CLAIM_STALE_MS).toISOString();
  const claimQuery = (stage) =>
    `id=eq.${sessionId}&pipeline_stage=eq.${stage}&or=(processing_since.is.null,processing_since.lt.${encodeURIComponent(staleIso)})`;

  // ── Stage 1: uploaded → transcribed ──────────────────────────────────────
  if (row.pipeline_stage === 'uploaded' && row.audio_path) {
    const claimed = await sbPatch(env, 'ci_sessions', claimQuery('uploaded'), { processing_since: new Date().toISOString() });
    if (!claimed.length) return; // another invocation owns this stage
    try {
      const audioBytes = await sbStorageGet(env, row.audio_path);
      const mime = row.audio_path.endsWith('.mp4') ? 'audio/mp4' : 'audio/webm';
      const t = await runTranscribe(audioBytes, mime, row.duration_secs || 0, row.account_name || '', env, undefined, row.sku_glossary || '');

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
        next_attempt_at:       null    // พร้อมให้ tick ถัดไปหยิบทันที
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
async function sweepPending(env) {
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
      `&and=(or(pipeline_stage.eq.uploaded,and(pipeline_stage.eq.transcribed,status.eq.draft)),` +
      `or(processing_since.is.null,processing_since.lt.${encodeURIComponent(staleIso)}),` +
      `or(next_attempt_at.is.null,next_attempt_at.lte.${encodeURIComponent(nowIso)}))` +
      `&order=next_attempt_at.asc.nullsfirst,visited_at.asc&limit=1`);
  } catch (_) { return; }
  for (const r of rows) {
    try { await processSession(r.id, null, env); } catch (_) {}
  }
}

// v_echor3: เก็บไฟล์เสียงไว้กี่วันก่อนลบ · ตั้งค่าได้ผ่าน env ถ้าอยากยืด/หด
// โดยไม่ต้อง deploy ใหม่ · ตั้ง AUDIO_RETENTION_DAYS=0 = ปิดการลบทั้งหมด
const AUDIO_RETENTION_DAYS = 30;

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


// ── v_ears P0 (2026-08-14): งานเทียบโมเดลบน cron — **ชั่วคราว ถอดออกเมื่อเคาะแล้ว**
//
// ทำไมต้องอยู่บน cron ไม่ใช่ HTTP: แค่ขั้นโหลดไฟล์เสียง 9MB จาก storage แล้ว
// อัปเข้า Gemini Files API ก็เกิน 100 วินาที ซึ่งเป็นเพดานของคำขอผ่านเว็บของ
// Cloudflare (ลองแล้วโดน 524 สามรอบ) · cron ได้เวลาเป็นนาทีจึงทำได้
//
// สั่งงานด้วย SQL: update ci_sessions set ab_gemini='{"requested":true}' where id=...
// ทำทีละ 1 แถวต่อ tick และ **แทนที่งานปกติของ tick นั้น** เพราะ Free plan ให้
// 50 subrequest ต่อ invocation และงานนี้ใช้ ~24 (โหลด+อัป+โพลสถานะ+ถอด+เขียน)
// เพดานที่วัดได้จริง (7 คลิป, 14 ส.ค.): คำขอตายที่ **128-131 วินาที** เสมอ
// ตัวที่ชนเพดานคือ "ความยาวคำตอบ" ไม่ใช่ความยาวไฟล์ — output คงที่ ~530 token
// ต่อนาทีของเสียง · 33.2 นาที = 17,498 token = 100 วิ รอด / 36.1 นาทีขึ้นไป
// ตายหมด · ฝั่ง input ไม่ใช่ปัญหา (กลืน 49,557 token สบาย)
// → ทางออกคือให้มันตอบทีละช่วง ไม่ใช่หั่นไฟล์เสียง (ซึ่ง Worker ทำไม่ได้อยู่แล้ว
//   เพราะถอดรหัส/ประกอบ container ใหม่ไม่ไหวใน CPU 10ms)
// ⚠ เพดานไม่คงที่ — วัดซ้ำ 14 ส.ค. บ่าย: คลิป 20.2 นาทีที่เคยผ่านใน 65 วิ
// **โดน 524 ซ้ำสองรอบ** ด้วยคำขอแบบเดียวกันเป๊ะ · ความเร็ว generate ที่วัดได้
// แกว่ง 76-175 token/วิ (ต่างกันเท่าตัว) ตามภาระฝั่ง Google
// → ห้ามตั้งขนาดหน้าต่างจาก "วันที่เร็ว" ต้องคิดจากวันที่ช้าสุด:
//   งบเวลาปลอดภัย 110 วิ × 76 token/วิ ≈ 8,400 token ≈ 16 นาทีของเสียง
//   จึงตั้ง 12 นาที (≈6,400 token) ให้เหลือที่หายใจ
// และต่อให้ตั้งดีแค่ไหนก็ยังพลาดได้ → มีตัวหดหน้าต่างอัตโนมัติเมื่อโดน 524
const AB_WIN_MIN = 12;          // ≈6,400 token ≈ 40-85 วิ แล้วแต่วัน
const AB_SINGLE_MAX_MIN = 12;   // สั้นกว่านี้ยิงรอบเดียวพอ (20 นาทีพิสูจน์แล้วว่าเสี่ยง)
const AB_MIN_WIN_SEC = 180;     // หดได้ต่ำสุด 3 นาที — ต่ำกว่านี้แปลว่าปัญหาไม่ใช่ความยาว
const AB_MAX_ATTEMPTS = 20;     // กันแถวค้างบล็อกคิวตลอดกาล (เผื่อรอบที่ใช้หดหน้าต่าง)

function _abTsToSec(ts) {
  const m = String(ts || '').match(/^(\d+):(\d+)(?::(\d+))?$/);
  if (!m) return null;
  return m[3] ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) : (+m[1] * 60 + +m[2]);
}
function _abSecToTs(sec) {
  const s = Math.max(0, Math.round(sec));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// Gemini คืนได้ทั้ง {"segments":[…]} และ **array เปล่าๆ** (responseMimeType=json
// บังคับให้เป็น JSON ที่ถูกต้อง แต่ไม่บังคับโครง) — รับทั้งสองแบบ ดีกว่าดัด prompt
// แล้วหวังว่ามันจะเชื่อ · เผื่อกรณีมีข้อความห่อหน้า/หลัง JSON ด้วย
function _abParseSegments(raw) {
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_) {
    const a = raw.indexOf('['), z = raw.lastIndexOf(']');
    if (a !== -1 && z > a) { try { parsed = JSON.parse(raw.slice(a, z + 1)); } catch (_) {} }
    if (!parsed) {
      const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
      if (s !== -1 && e > s) { try { parsed = JSON.parse(raw.slice(s, e + 1)); } catch (_) {} }
    }
  }
  if (Array.isArray(parsed)) parsed = { segments: parsed };
  return (parsed && Array.isArray(parsed.segments)) ? parsed.segments : null;
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
    const m = line.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\|\s*([^|]{0,20}?)\s*\|\s*(.+?)\s*$/);
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

function _abPromptCompact(fromSec, toSec) {
  const win = (fromSec == null) ? '' :
    `\n\n**ถอดเฉพาะช่วง ${_abSecToTs(fromSec)} ถึง ${_abSecToTs(toSec)} เท่านั้น** ` +
    `ช่วงก่อนหน้าและหลังจากนั้นข้ามไปทั้งหมด ห้ามถอด · ` +
    `เวลาที่ตอบต้องเป็นเวลาจริงนับจากต้นไฟล์ (ไม่ใช่นับใหม่จากต้นช่วง)`;
  return `ถอดเสียงบทสนทนาภาษาไทยนี้แบบคำต่อคำ (verbatim) พร้อมระบุคนพูด

บริบท: พนักงานขายของ Freshket (ขายวัตถุดิบอาหารให้ร้านอาหาร) คุยกับคนของร้านอาหาร ณ ร้าน อาจมีเสียงรบกวน
- ถอดตามที่ได้ยินจริง ห้ามแต่งเติม ห้ามสรุป · ท่อนที่ฟังไม่ออกจริงๆ ใช้ "[ฟังไม่ชัด]"

ตอบเป็นข้อความล้วน บรรทัดละหนึ่งท่อน รูปแบบเป๊ะๆ นี้เท่านั้น:
mm:ss|ผู้พูด|ข้อความ

ผู้พูดใช้ตัวอักษรเดียว: S = พนักงานขาย Freshket, C = คนของร้าน
ห้ามใส่หัวข้อ ห้ามใส่เลขข้อ ห้ามใส่ JSON ห้ามใส่บรรทัดอื่นนอกจากรูปแบบข้างบน

ตัวอย่าง:
00:03|S|สวัสดีครับพี่ วันนี้มาส่งของครับ
00:07|C|ค่ะ วางตรงนี้เลย${win}`;
}

function _abPrompt(fromSec, toSec) {
  const win = (fromSec == null) ? '' :
    `\n\n**ถอดเฉพาะช่วง ${_abSecToTs(fromSec)} ถึง ${_abSecToTs(toSec)} เท่านั้น** ` +
    `ช่วงก่อนหน้าและหลังจากนั้นข้ามไปทั้งหมด ห้ามถอด · ` +
    `ts ที่ตอบต้องเป็นเวลาจริงนับจากต้นไฟล์ (ไม่ใช่นับใหม่จากต้นช่วง)`;
  return `ถอดเสียงบทสนทนาภาษาไทยนี้แบบคำต่อคำ (verbatim) พร้อมระบุคนพูด

บริบท: พนักงานขายของ Freshket (ขายวัตถุดิบอาหารให้ร้านอาหาร) คุยกับคนของร้านอาหาร ณ ร้าน อาจมีเสียงรบกวน
- speaker: "Sales" = ฝั่ง Freshket, "ลูกค้า" = ฝั่งร้าน
- ถอดตามที่ได้ยินจริง ห้ามแต่งเติม ห้ามสรุป · ท่อนที่ฟังไม่ออกจริงๆ ใช้ "[ฟังไม่ชัด]"

ตอบ JSON เท่านั้น:
{"segments":[{"ts":"mm:ss","speaker":"Sales","text":"..."}]}${win}`;
}

async function _abCallGemini(env, fileUri, fromSec, toSec, fmt) {
  const t0 = Date.now();
  const compact = fmt === 'compact';
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${env.GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { file_data: { mime_type: 'audio/webm', file_uri: fileUri } },
          { text: compact ? _abPromptCompact(fromSec, toSec) : _abPrompt(fromSec, toSec) }
        ]}],
        generationConfig: { temperature: 0, maxOutputTokens: 65536,
          responseMimeType: compact ? 'text/plain' : 'application/json' }
      }) });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  const d = await r.json();
  const raw = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const segments = compact ? _abParseCompact(raw) : _abParseSegments(raw);
  return {
    segments,
    elapsed_ms: Date.now() - t0,
    finish_reason: d?.candidates?.[0]?.finishReason || null,
    usage: d?.usageMetadata || null,
    raw_head: segments ? undefined : raw.slice(0, 1200)
  };
}

// สั่งงานด้วย SQL:
//   update ci_sessions set ab_gemini='{"requested":true,"status":"queued"}' where id=…
// **ต้องมี status:"queued"** — ตัวเลือกแถวกรองด้วย status ถ้าเป็น NULL จะไม่ถูกหยิบ
//
// หนึ่ง tick ทำหนึ่งขั้นเท่านั้น (อัปโหลด หรือ หนึ่งหน้าต่าง) ตามแพตเทิร์นเดียว
// กับ sweepPending — และ **แทนที่งานปกติของ tick นั้น** เพราะ Free plan ให้
// 50 subrequest ต่อ invocation ส่วนขั้นอัปโหลดใช้ ~24 (โหลด+อัป+โพลสถานะ+เขียน)
async function sweepAbGemini(env) {
  const rows = await sbSelect(env,
    `ci_sessions?ab_gemini->>requested=eq.true&ab_gemini->>status=in.(queued,running)` +
    `&audio_path=not.is.null&select=id,audio_path,account_name,duration_secs,ab_gemini&limit=1`);
  const row = rows && rows[0];
  if (!row) return false;
  const st = row.ab_gemini || {};
  const attempts = (st.attempts || 0) + 1;
  // เขียนกลับแบบ compare-and-set: อ่านสถานะสดก่อนเสมอ ถ้ามีใครแก้ระหว่างที่
  // tick นี้ทำงานอยู่ (เช่นคนสั่งหยุดด้วย SQL) ให้ยอมแพ้ ไม่เขียนทับ
  // — เจอจริง 14 ส.ค.: ตั้ง status='parked' ด้วยมือแล้วโดน tick ที่ค้างอยู่
  //   เขียน {...st} ทับ กลับไปเป็น 'running' แล้ววนลองซ้ำต่อ
  const save = async (patch) => {
    const fresh = await sbSelect(env, `ci_sessions?id=eq.${row.id}&select=ab_gemini`);
    const now = fresh && fresh[0] && fresh[0].ab_gemini;
    if (now && now.status && now.status !== 'queued' && now.status !== 'running') {
      console.log(`[ab-gemini] ${row.id} ถูกสั่ง ${now.status} ระหว่างทาง — ไม่เขียนทับ`);
      return false;
    }
    await sbPatch(env, 'ci_sessions', `id=eq.${row.id}`,
      { ab_gemini: { ...st, ...patch, attempts, updated_at: new Date().toISOString() } });
    return true;
  };

  if (attempts > AB_MAX_ATTEMPTS) {
    await save({ status: 'failed', error: `เกิน ${AB_MAX_ATTEMPTS} รอบแล้วยังไม่จบ — หยุดกันคิวตัน` });
    return true;
  }

  try {
    // ── ขั้นที่ 1: อัปไฟล์เข้า Gemini ครั้งเดียว แล้วใช้ uri ซ้ำทุกหน้าต่าง (ไฟล์อยู่ ~48 ชม.)
    if (!st.file_uri) {
      const t0 = Date.now();
      const fileUri = await _geminiUploadAudio(env, await sbStorageGet(env, row.audio_path), 'audio/webm');
      const dur = row.duration_secs || 0;
      const winMin = st.win_min || AB_WIN_MIN;
      const windows = [];
      // st.single = true → บังคับยิงรอบเดียวไม่ว่ายาวแค่ไหน (ใช้ตอนทดลองว่ารูปแบบ
      // คำตอบแบบประหยัดทำให้คลิปยาวรอดโดยไม่ต้องซอยจริงไหม)
      if (st.single === true || dur / 60 <= AB_SINGLE_MAX_MIN) {
        windows.push({ from: null, to: null });     // สั้นพอ ยิงรอบเดียว
      } else {
        for (let s = 0; s < dur; s += winMin * 60) {
          windows.push({ from: s, to: Math.min(s + winMin * 60, Math.ceil(dur)) });
        }
      }
      await save({ status: 'running', file_uri: fileUri, upload_ms: Date.now() - t0,
                   win_min: winMin, windows, next: 0, model: 'gemini-3.1-pro-preview' });
      console.log(`[ab-gemini] อัปเสร็จ ${row.id} — ${windows.length} หน้าต่าง`);
      return true;
    }

    // ── ขั้นที่ 2..N: ถอดทีละหน้าต่าง
    const windows = st.windows || [];
    const i = st.next || 0;
    if (i < windows.length) {
      const w = windows[i];
      const res = await _abCallGemini(env, st.file_uri, w.from, w.to, st.fmt);
      const segs = res.segments || [];
      // ตัววัดว่ามันเชื่อคำสั่ง "ถอดเฉพาะช่วง" จริงไหม — ถ้าไม่เชื่อ แผนนี้ใช้ไม่ได้
      let inWin = null;
      if (w.from != null && segs.length) {
        const ok = segs.filter(s => {
          const t = _abTsToSec(s && s.ts);
          return t != null && t >= w.from - 30 && t <= w.to + 30;
        }).length;
        inWin = Math.round(ok / segs.length * 100);
      }
      windows[i] = { ...w, status: res.segments ? 'done' : 'parse_failed',
                     elapsed_ms: res.elapsed_ms, finish_reason: res.finish_reason,
                     out_tok: res.usage?.candidatesTokenCount ?? null,
                     in_tok: res.usage?.promptTokenCount ?? null,
                     seg_count: segs.length, in_window_pct: inWin,
                     raw_head: res.raw_head, segments: segs };
      const done = i + 1 >= windows.length;
      if (!done) {
        await save({ windows, next: i + 1 });
        console.log(`[ab-gemini] ${row.id} หน้าต่าง ${i + 1}/${windows.length} เสร็จใน ${Math.round(res.elapsed_ms / 1000)} วิ`);
        return true;
      }
      // ── รวมผลทุกหน้าต่างเป็นบทเดียว (หน้าต่างไม่ซ้อนกัน จึงไม่ต้องกันซ้ำ)
      const merged = windows.flatMap(x => x.segments || [])
        .sort((a, b) => (_abTsToSec(a?.ts) ?? 0) - (_abTsToSec(b?.ts) ?? 0));
      const meta = windows.map(x => ({ from: x.from, to: x.to, status: x.status,
        elapsed_ms: x.elapsed_ms, out_tok: x.out_tok, in_tok: x.in_tok,
        seg_count: x.seg_count, in_window_pct: x.in_window_pct, raw_head: x.raw_head }));
      await save({
        status: 'done', windows: meta, next: windows.length, segments: merged,
        total_elapsed_ms: meta.reduce((a, x) => a + (x.elapsed_ms || 0), 0) + (st.upload_ms || 0),
        total_out_tok: meta.reduce((a, x) => a + (x.out_tok || 0), 0),
        total_in_tok: meta.reduce((a, x) => a + (x.in_tok || 0), 0)
      });
      console.log(`[ab-gemini] เสร็จทั้งคลิป ${row.id} — ${merged.length} ท่อน`);
      return true;
    }
    await save({ status: 'failed', error: 'ไม่มีหน้าต่างให้ทำ (state เพี้ยน)' });
  } catch (e) {
    const msg = String(e?.message || e);
    // ล้มตอนอัป = ตายเลย ยังไม่มีอะไรให้ต่อ
    if (!st.file_uri) {
      await save({ status: 'failed', error: msg });
      console.error('[ab-gemini] อัปไม่สำเร็จ', row.id, msg);
      return true;
    }
    // ── หมดเวลา (524) = คำตอบยาวเกินกว่าที่ฝั่งโน้นจะปั่นทัน "ในวันนี้"
    // ลองขนาดเดิมซ้ำก็มีแต่จะพังซ้ำ → **ผ่าหน้าต่างนั้นครึ่งหนึ่ง** แล้วไปต่อ
    // (ทำให้ระบบหาขนาดที่วิ่งไหวของวันนั้นเองโดยไม่ต้องมีคนมาจูน)
    const windows = st.windows || [];
    const i = st.next || 0;
    const w = windows[i];
    const timedOut = /\b524\b|timeout|timed out/i.test(msg);
    if (timedOut && w) {
      const from = w.from == null ? 0 : w.from;
      const to = w.to == null ? Math.ceil(row.duration_secs || 0) : w.to;
      const mid = Math.floor((from + to) / 2);
      if (to - from > AB_MIN_WIN_SEC * 2) {
        windows.splice(i, 1, { from, to: mid }, { from: mid, to });
        await save({ status: 'running', windows, error: msg,
                     note: `หด ${Math.round((to-from)/60)} → ${Math.round((mid-from)/60)} นาที เพราะหมดเวลา` });
        console.warn(`[ab-gemini] ${row.id} หน้าต่าง ${i} หมดเวลา — ผ่าครึ่งเป็น ${Math.round((mid-from)/60)} นาที`);
        return true;
      }
      await save({ status: 'failed', error: `หดจนถึง ${Math.round((to-from)/60)} นาทีแล้วยังหมดเวลา — ปัญหาไม่ใช่ความยาว: ${msg}` });
      return true;
    }
    // เหตุอื่น (เน็ต/500 ชั่วคราว) — ปล่อยให้ tick ถัดไปลองหน้าต่างเดิมซ้ำ
    await save({ status: 'running', error: msg });
    console.error('[ab-gemini] ล้มเหลว', row.id, msg);
  }
  return true;
}

// ── Router ────────────────────────────────────────────────────────────────────
export default {
  async scheduled(event, env, cfCtx) {
    if (!env.SUPABASE_SERVICE_KEY) return;
    // v_ears P0: ถ้ามีงานเทียบโมเดลค้างอยู่ ให้ tick นี้ทำงานนั้นแทนงานปกติ
    // (กันแย่งเพดาน 50 subrequest กัน) · ไม่มีงานค้าง = ทำงานปกติตามเดิม
    cfCtx.waitUntil((async () => {
      const didAb = await sweepAbGemini(env).catch(e => { console.error('[ab-gemini] sweep error', e); return false; });
      if (!didAb) await sweepPending(env);
    })());
    // v_queue: กวาดไฟล์เสียงหมดอายุวันละครั้งพอ (03:00 UTC = 10 โมงเช้าไทย)
    // ของเดิมยิงคู่กับ sweepPending ทุก tick — งานนั้นใช้ได้ถึง 51 subrequest
    // ในตัวมันเอง จึงแย่งเพดาน 50 ของ invocation เดียวกันกับงานหลักโดยไม่จำเป็น
    const at = new Date(event && event.scheduledTime ? event.scheduledTime : Date.now());
    if (at.getUTCHours() === 3 && at.getUTCMinutes() < 5) {
      cfCtx.waitUntil(sweepExpiredAudio(env));
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
    if (url.pathname === '/ab-gemini')         return handleAbGeminiTranscribe(request, env); // v_ears P0 — ชั่วคราว
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
