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
  gemini: { haiku: 'gemini-2.5-flash', sonnet: 'gemini-2.5-flash', flash: 'gemini-2.5-flash', flash_lite: 'gemini-2.0-flash' }
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

// ── /transcript — audio → segments[] via Groq Whisper + Gemini diarization ───
// v712: 2-step pipeline
//   Step 1: Groq Whisper → raw text (เร็ว, Thai accurate, มี timestamps)
//   Step 2: Gemini Flash → แปลง text → segments[] + speaker diarization
// ดีกว่า Gemini ฟัง audio ตรง เพราะ Whisper Thai accuracy สูงกว่ามาก
async function handleTranscript(request, env) {
  if (!env.GROQ_API_KEY) return json({ error: 'GROQ_API_KEY not set' }, 503, env);
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not set' }, 503, env);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }

  const { audio_b64, mime_type } = body;
  if (!audio_b64) return json({ error: 'audio_b64 required' }, 400, env);

  // ── Step 1: Groq Whisper — audio → raw text with word timestamps ─────────────
  // แปลง base64 กลับเป็น binary blob
  const binaryStr = atob(audio_b64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const audioBlob = new Blob([bytes], { type: mime_type || 'audio/webm' });

  const groqForm = new FormData();
  groqForm.append('file', audioBlob, 'recording.webm');
  groqForm.append('model', 'whisper-large-v3');
  groqForm.append('language', 'th');
  groqForm.append('prompt', 'การสนทนาระหว่าง sales rep กับเจ้าของร้านอาหาร เรื่องวัตถุดิบและการสั่งซื้อสินค้า Freshket');
  groqForm.append('response_format', 'verbose_json'); // ได้ segments + timestamps
  groqForm.append('timestamp_granularities[]', 'segment');

  let groqRes;
  try {
    groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
      body: groqForm
    });
  } catch(e) {
    return json({ error: 'Groq network error: ' + (e?.message || 'fetch failed') }, 502, env);
  }

  if (!groqRes.ok) {
    const errText = await groqRes.text().catch(() => String(groqRes.status));
    return json({ error: 'Groq error: ' + errText }, groqRes.status, env);
  }

  const groqData = await groqRes.json();
  // verbose_json คืน { text, segments: [{id, start, end, text}] }
  const groqSegments = groqData.segments || [];
  const fullText = groqData.text || '';

  if (!fullText.trim()) {
    return json({ text: JSON.stringify({ no_speech: true, segments: [], speakers_detected: [], duration_mins: 0 }) }, 200, env);
  }

  // ── Step 2: Gemini Flash — text → speaker diarization ────────────────────────
  // Groq ให้ text + timestamps แต่ไม่รู้ว่าใครพูด
  // Gemini อ่าน text ล้วน (เร็วกว่าฟัง audio มาก) แล้วแยก speaker
  const segmentLines = groqSegments.length
    ? groqSegments.map(s => {
        const mm = Math.floor(s.start / 60).toString().padStart(2,'0');
        const ss = Math.floor(s.start % 60).toString().padStart(2,'0');
        return `[${mm}:${ss}] ${s.text.trim()}`;
      }).join('\n')
    : fullText;

  const diarizePrompt = `อ่าน transcript บทสนทนานี้แล้วแยก speaker

TRANSCRIPT:
${segmentLines}

บริบท: เป็นการสนทนาระหว่าง Sales rep ของ Freshket (บริษัทจำหน่ายวัตถุดิบ) กับเจ้าของร้านอาหาร

กฎ:
1. แยก speaker เป็น "Sales" กับ "ลูกค้า" — ถ้ามีลูกค้าหลายคนให้ใช้ "ลูกค้า_1" / "ลูกค้า_2"
2. Sales มักพูดเรื่องสินค้า ราคา บริการ Freshket — ลูกค้ามักถามหรือตอบเรื่องร้าน
3. ถ้า speaker พูดชื่อตัวเองให้ใช้ชื่อนั้น
4. คง timestamp และ text ตรงตามที่ให้มา ห้ามเปลี่ยน
5. ถ้าไม่แน่ใจ speaker ให้ใช้ "ไม่ทราบ"

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
    contents: [{ parts: [{ text: diarizePrompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 32768,
      responseMimeType: 'application/json'
    }
  });

  let geminiRes = null, lastErrText = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, attempt === 2 ? 2000 : 4000));
    try {
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_MAP.gemini.flash_lite}:generateContent?key=${env.GEMINI_API_KEY}`,
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

  const geminiData = await geminiRes.json();
  const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
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

  const prompt = `อ่าน transcript บทสนทนานี้แล้วสรุปเป็น structured notes

TRANSCRIPT:
${transcriptText}

กฎ:
1. อ้างอิงจาก transcript เท่านั้น ห้ามเติมหรือคาดเดา
2. ทุก quote ต้องมาจาก transcript จริง พร้อม timestamp
3. ตอบภาษาไทย

ตอบ JSON เท่านั้น ไม่มี markdown:
{
  "transcript_summary": "สรุปภาพรวม 2-3 ประโยค",
  "notes": [
    {
      "heading": "หัวข้อ เช่น สินค้าที่สนใจ / ปัญหาที่เจอ / ข้อตกลง",
      "bullets": ["bullet point สั้นๆ จาก transcript", "..."]
    }
  ],
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
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_MAP.gemini.flash_lite}:generateContent?key=${env.GEMINI_API_KEY}`,
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
