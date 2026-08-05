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

const MODEL_MAP = {
  claude: { haiku: 'claude-haiku-4-5-20251001', sonnet: 'claude-sonnet-4-6' },
  gemini: {
    flash:      'gemini-2.5-flash',
    flash_lite: 'gemini-2.5-flash-lite', // updated: 2.0-flash-lite shutdown 2026-06-01
    flash_35:   'gemini-3.5-flash',         // v2: used for transcript (audio-native)
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
async function withRetry(fn, maxAttempts = 3, delays = [0, 2000, 5000]) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, delays[attempt - 1] || 5000));
    try {
      const result = await fn(attempt);
      if (result !== null) return result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All attempts failed');
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
function _bytesToB64(bytes) {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}


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

  const { audio_b64, mime_type, duration_secs, account_name } = body;
  if (!audio_b64) return json({ error: 'audio_b64 required' }, 400, env);

  try {
    const result = await runTranscribe(_b64ToBytes(audio_b64), mime_type, duration_secs, account_name, env, audio_b64);
    return json({ text: JSON.stringify(result) }, 200, env);
  } catch (e) {
    return json({ error: e?.message || 'Transcript failed' }, 502, env);
  }
}

// A2v2.1: core extracted from handleTranscript so /process (async pipeline) can
// run the exact same logic server-side. Returns the result OBJECT (not a
// Response); throws on hard failure. audioB64 is optional — computed from
// bytes when absent (the async path only has bytes from storage).
async function runTranscribe(audioBytes, mimeType, durationSecs, accountName, env, audioB64) {
  const account_name = accountName;
  const mime_type = mimeType;
  const duration_secs = durationSecs;
  const audio_b64 = audioB64 || _bytesToB64(audioBytes);

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
  const basePrompt = 'บทสนทนาภาษาไทยระหว่างพนักงานขาย Freshket (วัตถุดิบอาหาร) กับเจ้าของร้านอาหาร อาจมีคำว่า Freshket, SKU, delivery, order, กิโล, ลัง';
  const safeAccountName = String(account_name || '').trim().slice(0, 80);
  const dynamicPrompt = safeAccountName
    ? `${basePrompt} ชื่อร้าน/บริษัทลูกค้าที่กำลังคุยด้วยคือ "${safeAccountName}"`
    : basePrompt;
  groqForm.append('prompt', dynamicPrompt);
  groqForm.append('response_format', 'verbose_json');
  groqForm.append('timestamp_granularities[]', 'segment');

  let groqData;
  try {
    const groqRes = await withRetry(async () => {
      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
        body: groqForm
      });
      if (r.ok) return r;
      if (r.status === 503 || r.status === 429) return null;
      throw new Error(`Groq ${r.status}: ${await r.text().catch(() => '')}`);
    }, 3, [0, 2000, 5000]);
    groqData = await groqRes.json();
  } catch (e) {
    throw new Error('Groq transcribe failed: ' + (e?.message || 'unknown'));
  }

  // Whisper hallucination guard: drop segments Whisper itself flags as
  // probably-not-speech AND low-confidence (its classic invent-text-on-
  // silence failure mode — restaurant background noise triggers it).
  const rawSegs = (groqData.segments || []).filter(s =>
    (s.text || '').trim() && !((s.no_speech_prob || 0) > 0.9 && (s.avg_logprob || 0) < -1)
  );
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
  const segLines = segments.map(s => `[${s.segment_id}] [${s.ts}] ${s.text}`).join('\n');
  const diarizePrompt = `ฟัง audio แล้วระบุว่าแต่ละ segment ของ transcript นี้ใครเป็นคนพูด

บริบท: สนทนาระหว่าง Sales rep ของ Freshket (จำหน่ายวัตถุดิบอาหาร) กับเจ้าของร้านอาหาร
speaker ที่ใช้ได้: "Sales" = คนขาย Freshket, "ลูกค้า" = ฝั่งร้าน (ถ้าได้ยินชื่อจริง เช่น "คุณมาลี" ใช้ชื่อนั้นแทน "ลูกค้า" ได้)

TRANSCRIPT (ถอดจาก audio เดียวกันนี้ — ห้ามแก้ text ห้ามเพิ่ม/ลบ segment):
${segLines}

ตอบ JSON เท่านั้น ไม่มี markdown:
{
  "assignments": [ { "id": 0, "speaker": "Sales", "confidence": 0.9 } ],
  "speakers_detected": ["Sales", "ลูกค้า"]
}`;

  let diarized = false, speakersDetected = [];
  try {
    const gemRes = await withRetry(async () => {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_MAP.gemini.flash_35}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              { inline_data: { mime_type: mime_type || 'audio/webm', data: audio_b64 } },
              { text: diarizePrompt }
            ]}],
            generationConfig: { temperature: 0.1, maxOutputTokens: 16384, responseMimeType: 'application/json' }
          })
        }
      );
      if (r.ok) return r;
      if (r.status === 503 || r.status === 429) return null;
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
      segments.forEach(s => {
        const a = byId[s.segment_id];
        if (a && a.speaker) {
          s.speaker = a.speaker;
          s.speaker_confidence = Math.max(0, Math.min(1, Number(a.confidence) || 0.5));
        }
      });
      speakersDetected = Array.isArray(parsed.speakers_detected) ? parsed.speakers_detected : [];
      diarized = segments.some(s => s.speaker !== 'ไม่ทราบ');
    }
  } catch (e) {
    // Diarize failure is non-fatal — the verbatim transcript is the ground
    // truth; ship it with unknown speakers (client already handles
    // 'whisper_fallback').
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
    if (r.status === 503 || r.status === 429) return null;
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
      if (r.status === 503 || r.status === 429) return null;
      throw new Error(`Gemini ${r.status}`);
    }, 3, [0, 2000, 4000]);

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return json({ text }, 200, env);
  } catch(e) {
    return json({ error: e?.message || 'Gemini failed' }, 502, env);
  }
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
    `ci_sessions?id=eq.${sessionId}&select=id,owner_email,owner_type,account_id,account_name,duration_secs,pipeline_stage,status,audio_path,transcript,processing_since`);
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
      const t = await runTranscribe(audioBytes, mime, row.duration_secs || 0, row.account_name || '', env);

      if (t.no_speech || !(t.segments || []).length) {
        // Nothing to analyze — record the outcome honestly instead of leaving
        // the row stuck (client history renders unknown stages as plain text).
        await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`,
          { pipeline_stage: 'no_speech', processing_since: null, audio_path: null });
        await sbStorageDelete(env, row.audio_path).catch(() => {});
        return;
      }

      await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`, {
        transcript:            t.segments,
        transcript_source:     t.source || 'unknown',
        transcript_confidence: (typeof t.avg_transcript_confidence === 'number') ? t.avg_transcript_confidence : null,
        speaker_confidence:    (typeof t.avg_speaker_confidence === 'number') ? t.avg_speaker_confidence : null,
        pipeline_stage:        'transcribed',
        processing_since:      null,
        audio_path:            null
      });
      await sbStorageDelete(env, row.audio_path).catch(() => {});

      // fresh invocation for the analyze stage
      await fetch(`${origin}/process`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId })
      }).catch(() => {});
    } catch (e) {
      // release the claim so the client sweep can retry this stage
      await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`, { processing_since: null }).catch(() => {});
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

      // Summary is non-fatal (matches the client pipeline's behavior)
      let summary = null;
      try { summary = (await runSummarize(segments, env)).parsed; } catch (_) {}

      const { parsed } = await runAnalyze(segments, summary, rubric, env);

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
        next_actions: parsed.next_actions || []
      };
      const nowIso = new Date().toISOString();

      await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`, {
        pipeline_stage: 'analyzed', status: 'saved',
        skill_scores: skillData, customer_intel: intelData, next_actions: intelData.next_actions,
        transcript_summary: summary?.transcript_summary || null,
        tone_signals: summary?.tone || null, summary_data: summary || null,
        processing_since: null
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
      await sbPatch(env, 'ci_sessions', `id=eq.${sessionId}`, { processing_since: null }).catch(() => {});
    }
    return;
  }
  // other stages (checked_in / analyzed / no_speech): nothing to do
}

// ── Router ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, cfCtx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env) });
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

    // Legacy general endpoint
    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON' }, 400, env); }
    const provider  = body.provider  === 'gemini' ? 'gemini' : 'claude';
    const modelKey  = body.modelKey  === 'sonnet'  ? 'sonnet' : 'haiku';
    const system    = typeof body.system   === 'string' ? body.system   : '';
    const messages  = Array.isArray(body.messages)      ? body.messages : [];
    const maxTokens = Math.min(Number(body.maxTokens || 2000), 6000);
    if (!messages.length) return json({ error: 'messages required' }, 400, env);
    if (provider === 'gemini') {
      if (!env.GEMINI_API_KEY) return json({ error: 'Gemini not configured' }, 503, env);
      const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const gemBody = { system_instruction: system ? { parts: [{ text: system }] } : undefined, contents, generationConfig: { maxOutputTokens: maxTokens } };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_MAP.gemini.flash}:generateContent?key=${env.GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gemBody) });
      const d = await res.json();
      return json({ content: [{ type: 'text', text: d?.candidates?.[0]?.content?.parts?.[0]?.text || '' }] }, 200, env);
    }
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Anthropic not configured' }, 503, env);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL_MAP.claude[modelKey], max_tokens: maxTokens, system, messages })
    });
    const _d = await res.json();
    const _text = _d?.content?.[0]?.text || _d?.text || '';
    return json({ text: _text }, res.status, env);
  }
};
