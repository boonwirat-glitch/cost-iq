// Cloudflare Worker AI proxy for Freshket Sense.
// Env secrets: ANTHROPIC_API_KEY, GROQ_API_KEY, GEMINI_API_KEY
//
// v3 (2026-06-14) — Pipeline architecture: 3 endpoints แยก task
//   /transcript  — audio → segments[] + speaker diarization
//   /summarize   — segments[] → summary + tone + next steps
//   /analyze     — segments[] + summary → 14 skills + OCPB
//   /analyze-audio (legacy) — ยังอยู่ ไม่ลบ

const MODEL_MAP = {
  claude: { haiku: 'claude-haiku-4-5-20251001', sonnet: 'claude-sonnet-4-6' },
  gemini: { flash: 'gemini-2.5-flash', flash_lite: 'gemini-2.0-flash' }
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

// ── /transcript — audio → segments[] ─────────────────────────────────────────
async function handleTranscript(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not set' }, 503, env);
  let body;
  try { body = await request.json(); } 
  catch { return json({ error: 'Invalid JSON' }, 400, env); }

  const { audio_b64, mime_type } = body;
  if (!audio_b64) return json({ error: 'audio_b64 required' }, 400, env);

  const prompt = `ฟัง audio การสนทนานี้แล้ว transcript ทุกคำที่ได้ยินจริง

กฎ:
1. จด ทุกคำที่พูด ห้ามตัดทอนหรือสรุป
2. แยก speaker: "Sales" สำหรับ sales rep, "ลูกค้า" ถ้ามีคนเดียว, "ลูกค้า_1"/"ลูกค้า_2" ถ้ามีหลายคน
3. ถ้า speaker พูดชื่อตัวเองในบทสนทนา ให้ใช้ชื่อนั้นแทน label — แต่ถ้าไม่แน่ใจให้ใช้ label ปกติ
4. timestamp ทุก segment รูปแบบ "mm:ss"
5. ตอบภาษาไทยเป็น default — ถ้า speaker พูดภาษาอื่นให้ transcript ตามที่พูดจริง
6. ถ้าไม่มีเสียงพูดใน audio ตอบ {"no_speech": true}

ตอบ JSON เท่านั้น ไม่มี markdown:
{
  "no_speech": false,
  "segments": [
    {"ts": "00:00", "speaker": "Sales", "text": "..."},
    {"ts": "00:15", "speaker": "ลูกค้า", "text": "..."}
  ],
  "speakers_detected": ["Sales", "ลูกค้า"],
  "duration_mins": 0
}`;

  const geminiBody = JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: mime_type || 'audio/webm', data: audio_b64 } },
        { text: prompt }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 65536,
      responseMimeType: 'application/json'
    }
  });

  // Retry 3 ครั้ง — transcript อาจใช้เวลานานสำหรับ audio ยาว
  let geminiRes = null, lastErrText = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, attempt === 2 ? 3000 : 6000));
    try {
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_MAP.gemini.flash}:generateContent?key=${env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: geminiBody }
      );
    } catch(e) {
      lastErrText = 'network: ' + (e?.message || 'fetch failed');
      geminiRes = null; continue;
    }
    if (geminiRes.ok) break;
    if (geminiRes.status !== 503 && geminiRes.status !== 429) break;
    lastErrText = await geminiRes.text().catch(() => String(geminiRes.status));
  }

  if (!geminiRes) return json({ error: lastErrText || 'Gemini unreachable' }, 502, env);
  if (!geminiRes.ok) {
    const err = lastErrText || await geminiRes.text().catch(() => String(geminiRes.status));
    return json({ error: err }, geminiRes.status, env);
  }

  const data = await geminiRes.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return json({ text }, 200, env);
}

// ── /summarize — segments[] → summary + tone ─────────────────────────────────
async function handleSummarize(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not set' }, 503, env);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }

  const { segments } = body;
  if (!segments || !segments.length) return json({ error: 'segments required' }, 400, env);

  const transcriptText = segments.map(s => `[${s.ts}] ${s.speaker}: ${s.text}`).join('\n');

  const prompt = `อ่าน transcript บทสนทนานี้แล้วสรุป

TRANSCRIPT:
${transcriptText}

กฎ:
1. อ้างอิงจาก transcript เท่านั้น ห้ามเติมหรือคาดเดาสิ่งที่ไม่มีใน transcript
2. ทุก fact ต้องมี quote และ timestamp จาก transcript จริง
3. ตอบภาษาไทย

ตอบ JSON เท่านั้น ไม่มี markdown:
{
  "transcript_summary": "สรุปภาพรวมบทสนทนา",
  "what_was_discussed": ["สิ่งที่คุยได้ข้อ 1", "ข้อ 2"],
  "customer_said": [
    {"point": "สิ่งที่ลูกค้าบอก", "quote": "คำพูดตรงๆ", "ts": "mm:ss"}
  ],
  "next_steps": [
    {"action": "สิ่งที่ต้องทำ", "owner": "Sales|TL", "urgency": "3_days|this_week|next_visit"}
  ],
  "tone": {
    "rep_confidence": "high|medium|low",
    "rep_confidence_note": "อธิบายสั้นๆ",
    "customer_engagement": "increasing|stable|decreasing",
    "customer_engagement_note": "อธิบายสั้นๆ"
  }
}`;

  const geminiBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json'
    }
  });

  let geminiRes = null, lastErrText = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, attempt === 2 ? 2000 : 4000));
    try {
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_MAP.gemini.flash}:generateContent?key=${env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: geminiBody }
      );
    } catch(e) {
      lastErrText = 'network: ' + (e?.message || 'fetch failed');
      geminiRes = null; continue;
    }
    if (geminiRes.ok) break;
    if (geminiRes.status !== 503 && geminiRes.status !== 429) break;
    lastErrText = await geminiRes.text().catch(() => String(geminiRes.status));
  }

  if (!geminiRes) return json({ error: lastErrText || 'Gemini unreachable' }, 502, env);
  if (!geminiRes.ok) {
    const err = lastErrText || await geminiRes.text().catch(() => String(geminiRes.status));
    return json({ error: err }, geminiRes.status, env);
  }

  const data = await geminiRes.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return json({ text }, 200, env);
}

// ── /analyze — segments[] + summary → skills + OCPB ──────────────────────────
async function handleAnalyze(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 503, env);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }

  const { segments, summary, rubric } = body;
  if (!segments || !segments.length) return json({ error: 'segments required' }, 400, env);

  const transcriptText = segments.map(s => `[${s.ts}] ${s.speaker}: ${s.text}`).join('\n');
  const rubricText = (rubric || []).map(s =>
    `[${s.skill_code}] ${s.skill_name_en}: ${(s.pass_test_th || '-').replace(/\//g, ' | ')}`
  ).join('\n');

  const summaryText = summary ? JSON.stringify(summary) : '';

  const prompt = `วิเคราะห์บทสนทนานี้ตาม skill rubric และ OCPB framework

TRANSCRIPT:
${transcriptText}

${summaryText ? `SUMMARY (สรุปที่ verified แล้ว):\n${summaryText}\n` : ''}

SKILL RUBRIC:
${rubricText || 'ไม่มี rubric — ประเมินตาม best practice การขายทั่วไป'}

OCPB:
- O: Operation — การสั่งของ วัน/เวลา ปริมาณ ปัญหา ops
- C: Competitor — ซัพเดิม ราคา สินค้าที่ใช้
- P: Payment — วิธีจ่าย credit term
- B: Business Plan — แผนขยาย เปิดสาขา เปลี่ยน concept

กฎเหล็ก:
1. ทุก evidence ต้องมี quote และ timestamp จาก transcript จริงเท่านั้น
2. ถ้าไม่มีหลักฐานใน transcript → not_observed ห้ามเดา
3. ตอบภาษาไทย

ตอบ JSON เท่านั้น ไม่มี markdown:
{
  "skills": [{"code": "", "score": "pass|developing|not_observed|not_applicable", "evidence": "", "quote": "", "ts": "mm:ss", "gap": "", "coaching_note": ""}],
  "pipc_stage": "Prepare|Identify|Probe|Close",
  "pipc_reached": "",
  "overall": "strong|developing|needs_work",
  "session_summary": "",
  "ocpb_status": {"O": "answered|asked_no_answer|not_asked", "C": "answered|asked_no_answer|not_asked", "P": "answered|asked_no_answer|not_asked", "B": "answered|asked_no_answer|not_asked"},
  "ocpb_facts": [{"dim": "O|C|P|B", "summary": "", "quote": "", "ts": "mm:ss", "tag": "pain_high|pain_medium|opportunity|null"}]
}`;

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

  const d = await res.json();
  const text = d?.content?.[0]?.text || '';
  return json({ text }, res.status, env);
}

// ── Legacy /transcribe (Groq Whisper) — ยังอยู่ ──────────────────────────────
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

// ── Legacy /analyze-audio — ยังอยู่ ──────────────────────────────────────────
async function handleAnalyzeAudio(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not set' }, 503, env);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }
  const { audio_b64, mime_type, prompt } = body;
  if (!audio_b64 || !prompt) return json({ error: 'audio_b64 and prompt required' }, 400, env);

  const geminiBody = JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: mime_type || 'audio/webm', data: audio_b64 } },
        { text: prompt }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json'
    }
  });

  let geminiRes = null, lastErrText = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, attempt === 2 ? 2000 : 4000));
    try {
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: geminiBody }
      );
    } catch(e) {
      lastErrText = 'network: ' + (e?.message || 'fetch failed');
      geminiRes = null; continue;
    }
    if (geminiRes.ok) break;
    if (geminiRes.status !== 503 && geminiRes.status !== 429) break;
    lastErrText = await geminiRes.text().catch(() => String(geminiRes.status));
  }

  if (!geminiRes) return json({ error: lastErrText || 'Gemini unreachable' }, 502, env);
  if (!geminiRes.ok) {
    const err = lastErrText || await geminiRes.text().catch(() => String(geminiRes.status));
    return json({ error: err }, geminiRes.status, env);
  }
  const data = await geminiRes.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return json({ text }, 200, env);
}

// ── Router ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env) });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, env);
    const url = new URL(request.url);
    if (url.pathname === '/transcript')    return handleTranscript(request, env);
    if (url.pathname === '/summarize')     return handleSummarize(request, env);
    if (url.pathname === '/analyze')       return handleAnalyze(request, env);
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
