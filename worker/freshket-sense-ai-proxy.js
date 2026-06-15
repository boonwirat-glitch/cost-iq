// Cloudflare Worker AI proxy for Freshket Sense — Echo v2
// Env secrets: ANTHROPIC_API_KEY, GROQ_API_KEY, GEMINI_API_KEY
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

// ── /transcript ───────────────────────────────────────────────────────────────
// Echo v2: 2-step pipeline
//   Step 1: Groq Whisper → raw text + word-level timestamps
//   Step 2: Gemini Flash Lite → speaker diarization → segments[] with segment_id + confidence
//   Fallback: if Gemini diarize returns empty segments → use Whisper raw segments directly
//             transcript is NEVER thrown away even if diarization fails
async function handleTranscript(request, env) {
  if (!env.GROQ_API_KEY)   return json({ error: 'GROQ_API_KEY not set' }, 503, env);
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not set' }, 503, env);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }

  const { audio_b64, mime_type, duration_secs } = body;
  if (!audio_b64) return json({ error: 'audio_b64 required' }, 400, env);

  // ── Step 1: Groq Whisper ─────────────────────────────────────────────────
  const binaryStr = atob(audio_b64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const audioBlob = new Blob([bytes], { type: mime_type || 'audio/webm' });

  const groqForm = new FormData();
  groqForm.append('file', audioBlob, 'recording.webm');
  groqForm.append('model', 'whisper-large-v3');
  groqForm.append('language', 'th');
  groqForm.append('prompt', 'บทสนทนาภาษาไทย ระหว่างพนักงานขายกับเจ้าของร้านอาหาร');
  groqForm.append('response_format', 'verbose_json');
  groqForm.append('timestamp_granularities[]', 'segment');

  let groqData;
  try {
    const groqRes = await withRetry(async (attempt) => {
      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
        body: groqForm
      });
      if (r.ok) return r;
      if (r.status === 429 || r.status === 503) return null; // retry
      throw new Error(`Groq ${r.status}: ${await r.text().catch(() => String(r.status))}`);
    }, 3, [0, 3000, 8000]);
    groqData = await groqRes.json();
  } catch(e) {
    return json({ error: 'Groq transcription failed: ' + (e?.message || 'unknown') }, 502, env);
  }

  const groqSegments = groqData.segments || [];
  const fullText     = groqData.text || '';

  // ── Keyword correction map — Whisper mishears for Freshket context ───────
  // Applied to both fullText and groqSegments.text before diarization
  const KEYWORD_MAP = [
    // Brand name
    [/FredGate|FredeGate|FreshGate|Freshgate|FREDGET|FEDGET|fredgate|freshgate/gi, 'Freshket'],
    [/เฟดเก็ต|เฟรดเก็ต|เฟรชเกต|เฟรชเก็ต/gi, 'Freshket'],
    // Competitor
    [/m8\.co|M8\.co|m8co/gi, 'Makro'],
    [/แม็คโค|แม็คโคร|Macro(?!n)/gi, 'Makro'],
    // Common mishears
    [/เฟสเก็ต/gi, 'Freshket'],
  ];
  function applyKeywords(text) {
    if (!text) return text;
    let t = text;
    for (const [pattern, replacement] of KEYWORD_MAP) {
      t = t.replace(pattern, replacement);
    }
    return t;
  }
  const fullTextCorrected = applyKeywords(fullText);
  const groqSegmentsCorrected = groqSegments.map(s => ({
    ...s, text: applyKeywords(s.text)
  }));

  // no speech detected
  if (!fullTextCorrected.trim()) {
    return json({
      text: JSON.stringify({
        no_speech: true,
        segments: [],
        speakers_detected: [],
        duration_mins: 0,
        source: 'groq_whisper',
        whisper_confidence: 0
      })
    }, 200, env);
  }

  // Build segment lines with index for segment_id tracking
  const segmentLines = groqSegmentsCorrected.length
    ? groqSegments.map((s, i) => {
        const mm = String(Math.floor(s.start / 60)).padStart(2,'0');
        const ss = String(Math.floor(s.start % 60)).padStart(2,'0');
        const endMm = String(Math.floor((s.end || s.start + 3) / 60)).padStart(2,'0');
        const endSs = String(Math.floor((s.end || s.start + 3) % 60)).padStart(2,'0');
        return `[idx:${i}][${mm}:${ss}-${endMm}:${endSs}] ${s.text.trim()}`;
      }).join('\n')
    : fullText;

  // ── Step 2: Gemini Flash Lite — speaker diarization ─────────────────────
  const diarizePrompt = `อ่าน transcript นี้แล้วแยก speaker และประเมิน confidence ของแต่ละ segment

TRANSCRIPT:
${segmentLines}

บริบท: สนทนาระหว่าง Sales rep ของ Freshket (จำหน่ายวัตถุดิบ) กับเจ้าของร้านอาหาร

กฎ:
1. แยก speaker เป็น "Sales" กับ "ลูกค้า" — ถ้ามีลูกค้าหลายคนใช้ "ลูกค้า_1" / "ลูกค้า_2"
2. Sales มักพูดเรื่องสินค้า ราคา บริการ Freshket — ลูกค้ามักถามหรือตอบเรื่องร้าน
3. ถ้า speaker พูดชื่อตัวเองให้ใช้ชื่อนั้น
4. confidence: 0.0-1.0 — ความมั่นใจว่า speaker ถูกต้อง (1.0 = แน่ใจมาก, 0.5 = เดา)
5. transcript_confidence: 0.0-1.0 — ความมั่นใจว่า text ที่ถอดมาถูกต้อง
6. คง timestamp และ text ตรงตามที่ให้มา ห้ามเปลี่ยน
7. ใช้ idx จาก [idx:N] เป็น segment_id

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
    contents: [{ parts: [{ text: diarizePrompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 65536,
      responseMimeType: 'application/json'
    }
  });

  let diarizeResult = null;
  try {
    const geminiRes = await withRetry(async (attempt) => {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_MAP.gemini.flash_lite}:generateContent?key=${env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: geminiBody }
      );
      if (r.ok) return r;
      if (r.status === 503 || r.status === 429) return null;
      throw new Error(`Gemini diarize ${r.status}`);
    }, 3, [0, 2000, 4000]);

    if (geminiRes) {
      const gData = await geminiRes.json();
      const rawText = gData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      try {
        const parsed = JSON.parse(rawText);
        if (parsed?.segments?.length > 0) {
          diarizeResult = parsed;
        }
      } catch(_) { /* fallback below */ }
    }
  } catch(_) { /* fallback below */ }

  // ── Fallback: Gemini diarize failed → use Whisper raw segments ───────────
  // Spec principle: transcript is never thrown away
  if (!diarizeResult) {
    const fallbackSegments = groqSegments.length
      ? groqSegmentsCorrected.map((s, i) => ({
          segment_id:             i,
          ts:                     String(Math.floor(s.start/60)).padStart(2,'0') + ':' + String(Math.floor(s.start%60)).padStart(2,'0'),
          start_sec:              s.start,
          end_sec:                s.end || s.start + 3,
          speaker:                'ไม่ทราบ',
          text:                   s.text.trim(),
          speaker_confidence:     0.0,  // unknown speaker
          transcript_confidence:  0.85, // Whisper is generally reliable
        }))
      : [{ segment_id: 0, ts: '00:00', start_sec: 0, end_sec: 0, speaker: 'ไม่ทราบ', text: fullText, speaker_confidence: 0.0, transcript_confidence: 0.8 }];

    return json({
      text: JSON.stringify({
        no_speech:                  false,
        segments:                   fallbackSegments,
        speakers_detected:          ['ไม่ทราบ'],
        duration_mins:              Math.round((duration_secs || 0) / 60),
        source:                     'whisper_fallback', // signals diarize failed
        avg_speaker_confidence:     0.0,
        avg_transcript_confidence:  0.85,
      })
    }, 200, env);
  }

  // Success path — add source tag
  diarizeResult.source = 'groq_whisper_gemini_diarize';
  return json({ text: JSON.stringify(diarizeResult) }, 200, env);
}

// ── /summarize ────────────────────────────────────────────────────────────────
// segments[] → summary notes, customer_said, next_steps, tone
// Uses segment_id references for traceability
async function handleSummarize(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not set' }, 503, env);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, env); }

  const { segments } = body;
  if (!segments || !segments.length) return json({ error: 'segments required' }, 400, env);

  // Strip [seg:N] prefix from display text — keep only ts + speaker + text for readability
  const transcriptText = segments.map(s =>
    `[${s.ts}] ${s.speaker}: ${s.text}`
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

  try {
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
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return json({ text }, 200, env);
  } catch(e) {
    return json({ error: 'Summarize failed: ' + (e?.message || 'unknown') }, 502, env);
  }
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

  const transcriptText = segments.map(s =>
    `[seg:${s.segment_id}][${s.ts}] ${s.speaker}: ${s.text}`
  ).join('\n');

  const rubricText = (rubric || []).map(s =>
    `[${s.skill_code}] ${s.skill_name_en}: ${(s.pass_test_th || '-').replace(/\//g, ' | ')}`
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
          JSON.parse(text.slice(s, e + 1)); // validate only
          return json({ text }, 200, env);
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
  return json({ error: lastErr?.message || 'Analyze failed' }, 502, env);
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

// ── Router ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env) });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, env);
    const url = new URL(request.url);
    if (url.pathname === '/transcript')    return handleTranscript(request, env);
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
