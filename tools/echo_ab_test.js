// tools/echo_ab_test.js — Echo transcript A/B: v3 hybrid (Whisper+Gemini
// diarize, /transcript) vs v2 Gemini-full (/transcript-gemini), per clip:
// wall-clock latency, /eval quality metrics, and a side-by-side extraction
// of every "money sentence" (ตัวเลข/ราคา/หน่วย) for human judgement.
//
// Usage:
//   1. Put real clips in a folder:      mkdir -p echo_ab_clips && cp *.m4a echo_ab_clips/
//      (supports .webm .m4a .mp3 .wav .ogg — เสียงจริงหน้าร้าน มีช่วงพูดราคา/ปริมาณ)
//   2. Optional ground truth per clip:  echo_ab_clips/<same-name>.txt
//      (พิมพ์สิ่งที่พูดจริง → ได้ hallucination rate เป็นตัวเลข)
//   3. Run:                             node tools/echo_ab_test.js [folder]
//   4. Read:                            echo_ab_report.md
//
// Safe: hits the worker directly — nothing is written to Supabase/ci_sessions.
// NOTE: /transcript must be the deployed v3 hybrid and /transcript-gemini the
// v2 path — i.e. deploy worker/freshket-sense-ai-proxy-v2.js first.

const fs = require('fs');
const path = require('path');

const WORKER_URL = 'https://freshket-sense-ai-proxy.boonwirat-t.workers.dev';
const CLIP_DIR = process.argv[2] || 'echo_ab_clips';
const OUT_FILE = 'echo_ab_report.md';
const MIME = { '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
// ประโยคเงินๆ ทองๆ: ตัวเลข + หน่วยที่ชี้ว่าเป็นราคา/ปริมาณ/เงื่อนไขการค้า
const MONEY_RE = /\d[\d,.]*\s*(บาท|กิโล|กก|โล|ลัง|แพ็ค|กล่อง|ขวด|ถุง|เปอร์เซ็นต์|%|วัน|ครั้ง)|ราคา|เครดิต|ส่วนลด/;

async function callEndpoint(pathName, b64, mime, durationSecs) {
  const t0 = Date.now();
  try {
    const res = await fetch(WORKER_URL + pathName, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_b64: b64, mime_type: mime, duration_secs: durationSecs })
    });
    const ms = Date.now() - t0;
    const bodyText = await res.text();
    if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}: ${bodyText.slice(0, 200)}` };
    let parsed;
    try { parsed = JSON.parse(JSON.parse(bodyText).text); }
    catch (e) { return { ok: false, ms, error: 'parse: ' + e.message }; }
    return { ok: true, ms, result: parsed };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e.message };
  }
}

async function callEval(segments, groundTruth) {
  try {
    const res = await fetch(WORKER_URL + '/eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments, ground_truth_text: groundTruth || undefined })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

function moneyLines(segments) {
  return (segments || []).filter(s => MONEY_RE.test(s.text))
    .map(s => `[${s.ts}] ${s.speaker}: ${s.text}`);
}
function fmtSecs(ms) { return (ms / 1000).toFixed(1) + 's'; }
function pct(x) { return x == null ? '—' : Math.round(x * 100) + '%'; }

(async () => {
  if (!fs.existsSync(CLIP_DIR)) {
    console.error(`ไม่พบ folder "${CLIP_DIR}" — สร้างแล้วใส่คลิปเสียงก่อน (ดู usage หัวไฟล์)`);
    process.exit(1);
  }
  const clips = fs.readdirSync(CLIP_DIR).filter(f => MIME[path.extname(f).toLowerCase()]);
  if (!clips.length) { console.error('ไม่มีไฟล์เสียงใน ' + CLIP_DIR); process.exit(1); }

  const lines = ['# Echo transcript A/B — v3 hybrid vs v2 Gemini-full', '',
    `รันเมื่อ: ${new Date().toISOString()} · worker: ${WORKER_URL}`, ''];
  const summary = [];

  for (const clip of clips) {
    const full = path.join(CLIP_DIR, clip);
    const bytes = fs.readFileSync(full);
    const b64 = bytes.toString('base64');
    const mime = MIME[path.extname(clip).toLowerCase()];
    const gtPath = full.replace(/\.[^.]+$/, '.txt');
    const groundTruth = fs.existsSync(gtPath) ? fs.readFileSync(gtPath, 'utf8').trim() : null;
    console.log(`\n── ${clip} (${(bytes.length / 1024 / 1024).toFixed(1)}MB${groundTruth ? ', มีเฉลย' : ''})`);

    console.log('  → v3 hybrid (/transcript)...');
    const v3 = await callEndpoint('/transcript', b64, mime, 0);
    console.log(`    ${v3.ok ? 'OK' : 'FAIL: ' + v3.error} ใน ${fmtSecs(v3.ms)}`);
    console.log('  → v2 gemini-full (/transcript-gemini)...');
    const v2 = await callEndpoint('/transcript-gemini', b64, mime, 0);
    console.log(`    ${v2.ok ? 'OK' : 'FAIL: ' + v2.error} ใน ${fmtSecs(v2.ms)}`);

    const evalV3 = v3.ok && v3.result.segments?.length ? await callEval(v3.result.segments, groundTruth) : null;
    const evalV2 = v2.ok && v2.result.segments?.length ? await callEval(v2.result.segments, groundTruth) : null;

    lines.push(`## ${clip}`, '');
    lines.push('| | v3 hybrid (Whisper+Gemini) | v2 Gemini-full |');
    lines.push('|---|---|---|');
    lines.push(`| เวลา | **${fmtSecs(v3.ms)}** | **${fmtSecs(v2.ms)}** |`);
    lines.push(`| สถานะ | ${v3.ok ? '✅ ' + (v3.result.source || '') : '❌ ' + v3.error} | ${v2.ok ? '✅' : '❌ ' + v2.error} |`);
    lines.push(`| segments | ${v3.ok ? (v3.result.segments || []).length : '—'} | ${v2.ok ? (v2.result.segments || []).length : '—'} |`);
    lines.push(`| ความมั่นใจถอดคำ (avg) | ${v3.ok ? pct(v3.result.avg_transcript_confidence) : '—'} | ${v2.ok ? pct(v2.result.avg_transcript_confidence) : '—'} |`);
    lines.push(`| แยกคนพูดสำเร็จ (eval) | ${evalV3 ? pct(evalV3.criteria?.speaker_attribution?.value) : '—'} | ${evalV2 ? pct(evalV2.criteria?.speaker_attribution?.value) : '—'} |`);
    lines.push(`| hallucination (ต้องมีเฉลย) | ${evalV3 ? pct(evalV3.criteria?.hallucination_rate?.value) : '—'} | ${evalV2 ? pct(evalV2.criteria?.hallucination_rate?.value) : '—'} |`);
    lines.push('');
    lines.push('**ประโยคเงินๆ ทองๆ (ตรวจด้วยตาคน — จุดตัดสินจริง):**', '');
    lines.push('v3 hybrid:', '```');
    lines.push(...(v3.ok ? (moneyLines(v3.result.segments).length ? moneyLines(v3.result.segments) : ['(ไม่พบประโยคที่มีตัวเลข)']) : ['(fail)']));
    lines.push('```', 'v2 gemini-full:', '```');
    lines.push(...(v2.ok ? (moneyLines(v2.result.segments).length ? moneyLines(v2.result.segments) : ['(ไม่พบประโยคที่มีตัวเลข)']) : ['(fail)']));
    lines.push('```', '');
    lines.push('<details><summary>transcript เต็ม v3</summary>', '', '```');
    lines.push(...(v3.ok ? (v3.result.segments || []).map(s => `[${s.ts}] ${s.speaker}: ${s.text}`) : ['(fail)']));
    lines.push('```', '</details>', '');
    lines.push('<details><summary>transcript เต็ม v2</summary>', '', '```');
    lines.push(...(v2.ok ? (v2.result.segments || []).map(s => `[${s.ts}] ${s.speaker}: ${s.text}`) : ['(fail)']));
    lines.push('```', '</details>', '');

    summary.push({ clip, v3ms: v3.ms, v2ms: v2.ms, v3ok: v3.ok, v2ok: v2.ok });
  }

  lines.push('## สรุปเวลา', '', '| คลิป | v3 hybrid | v2 gemini-full | เร็วกว่ากี่เท่า |', '|---|---|---|---|');
  summary.forEach(s => lines.push(
    `| ${s.clip} | ${s.v3ok ? fmtSecs(s.v3ms) : 'FAIL'} | ${s.v2ok ? fmtSecs(s.v2ms) : 'FAIL'} | ${s.v3ok && s.v2ok ? (s.v2ms / s.v3ms).toFixed(1) + '×' : '—'} |`));

  fs.writeFileSync(OUT_FILE, lines.join('\n'));
  console.log(`\n✅ รายงานอยู่ที่ ${OUT_FILE}`);
})();
