// Echo v2 — Eval Script
// ใช้หลัง session เสร็จเพื่อวัด criteria ตาม spec
//
// วิธีใช้:
//   node echo_eval.js <session_id>
//   node echo_eval.js <session_id> --ground-truth "ข้อความที่พูดจริง"
//
// ต้องการ env vars:
//   WORKER_URL=https://freshket-sense-ai-proxy.boonwirat-t.workers.dev
//   SUPABASE_URL=https://menslbnyyvpxiyvjywcm.supabase.co
//   SUPABASE_KEY=<service_role_key>

const WORKER_URL  = process.env.WORKER_URL  || 'https://freshket-sense-ai-proxy.boonwirat-t.workers.dev';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://menslbnyyvpxiyvjywcm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

// ── Spec criteria targets ────────────────────────────────────────────────────
const CRITERIA_TARGETS = {
  thai_accuracy:          { target: 0.90, label: 'Thai accuracy',         unit: '%' },
  speaker_attribution:    { target: 0.90, label: 'Speaker attribution',   unit: '%' },
  avg_speaker_confidence: { target: 0.85, label: 'Avg speaker confidence',unit: '%' },
  hallucination_rate:     { target: 0.05, label: 'Hallucination rate',    unit: '%', lower_is_better: true },
  evidence_coverage:      { target: 1.00, label: 'Evidence coverage',     unit: '%' },
};

async function fetchSession(sessionId) {
  if (!SUPABASE_KEY) throw new Error('SUPABASE_KEY not set');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ci_sessions?id=eq.${sessionId}&select=id,transcript,skill_scores,customer_intel,pipeline_stage,transcript_source,duration_secs,owner_email,visited_at`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`Session ${sessionId} not found`);
  return rows[0];
}

async function callEval(segments, analysisResult, groundTruthText) {
  const body = { segments };
  if (analysisResult) body.analysis_result = analysisResult;
  if (groundTruthText) body.ground_truth_text = groundTruthText;

  const res = await fetch(`${WORKER_URL}/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`/eval ${res.status}: ${await res.text()}`);
  return res.json();
}

async function saveEvalResult(sessionId, evalResult) {
  if (!SUPABASE_KEY) return;
  const { criteria, meta } = evalResult;
  const row = {
    session_id:                 sessionId,
    total_segments:             meta?.total_segments || 0,
    avg_speaker_confidence:     criteria?.avg_speaker_confidence?.value || null,
    avg_transcript_confidence:  criteria?.thai_accuracy?.value || null,
    speaker_accuracy:           criteria?.speaker_attribution?.value || null,
    hallucination_rate:         criteria?.hallucination_rate?.value || null,
    evidence_coverage:          criteria?.evidence_coverage?.value || null,
    overall_pass:               evalResult.overall_pass || false,
    criteria_detail:            criteria || {},
    source:                     meta?.source || 'unknown',
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/echo_eval_log`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) console.warn('  ⚠ eval log save failed:', await res.text());
  else console.log('  ✓ eval result saved to echo_eval_log');
}

function printResult(evalResult, session) {
  const { criteria, overall_pass, pass_count, total_criteria, meta } = evalResult;

  console.log('\n══════════════════════════════════════════');
  console.log('  Echo v2 — Eval Report');
  console.log('══════════════════════════════════════════');
  console.log(`  Session:  ${session.id}`);
  console.log(`  Owner:    ${session.owner_email}`);
  console.log(`  Visited:  ${session.visited_at}`);
  console.log(`  Duration: ${Math.round((session.duration_secs||0)/60)} min`);
  console.log(`  Source:   ${session.transcript_source || 'unknown'}`);
  console.log(`  Stage:    ${session.pipeline_stage}`);
  console.log(`  Segments: ${meta?.total_segments || 0}`);
  console.log('──────────────────────────────────────────');
  console.log(`  Overall:  ${overall_pass ? '✅ PASS' : '❌ FAIL'} (${pass_count}/${total_criteria} criteria met)`);
  console.log('──────────────────────────────────────────');

  for (const [key, c] of Object.entries(criteria)) {
    const target = CRITERIA_TARGETS[key];
    if (!target) continue;

    const value = c.value;
    const pass  = c.pass;

    if (value === null || value === undefined) {
      console.log(`  ⬜ ${target.label.padEnd(28)} N/A  (${c.note || 'no data'})`);
      continue;
    }

    const pct = (value * 100).toFixed(1) + '%';
    const tgt = (target.target * 100).toFixed(0) + '%';
    const icon = pass === true ? '✅' : pass === false ? '❌' : '⬜';
    const bar  = buildBar(value, target.target, target.lower_is_better);

    console.log(`  ${icon} ${target.label.padEnd(28)} ${pct.padStart(6)}  (target: ${tgt})  ${bar}`);
    if (c.note) console.log(`     └─ ${c.note}`);
  }

  console.log('──────────────────────────────────────────');

  // Transcript source warning
  if (session.transcript_source === 'whisper_fallback') {
    console.log('  ⚠ transcript_source = whisper_fallback');
    console.log('    Gemini diarization failed — speaker labels are "ไม่ทราบ"');
    console.log('    Speaker attribution score will be 0%');
  }

  // Actionable recommendations
  const recs = [];
  if (criteria.speaker_attribution?.pass === false) {
    recs.push('Speaker attribution ต่ำ — ตรวจว่า recording มีเสียง 2 คนชัดเจน หรือ Gemini diarize prompt ต้องปรับ');
  }
  if (criteria.thai_accuracy?.pass === false) {
    recs.push('Thai accuracy ต่ำ — ตรวจ Groq Whisper language prompt หรือ audio quality');
  }
  if (criteria.evidence_coverage?.pass === false) {
    recs.push('Evidence coverage < 100% — บาง skill/OCPB fact ไม่มี segment_id — ตรวจ /analyze prompt');
  }
  if (criteria.hallucination_rate?.pass === false) {
    recs.push('Hallucination rate สูง — ตรวจ Whisper output vs ground truth');
  }

  if (recs.length) {
    console.log('\n  Recommendations:');
    recs.forEach(r => console.log(`  → ${r}`));
  }

  console.log('══════════════════════════════════════════\n');
}

function buildBar(value, target, lowerIsBetter) {
  const filled = Math.round(value * 10);
  const bar = '█'.repeat(Math.min(filled, 10)) + '░'.repeat(Math.max(0, 10 - filled));
  const pass = lowerIsBetter ? value <= target : value >= target;
  return `[${bar}]`;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log('Usage: node echo_eval.js <session_id> [--ground-truth "text"]');
    console.log('       node echo_eval.js latest  (ใช้ session ล่าสุด)');
    process.exit(1);
  }

  let sessionId = args[0];
  let groundTruth = null;
  const gtIdx = args.indexOf('--ground-truth');
  if (gtIdx >= 0 && args[gtIdx + 1]) groundTruth = args[gtIdx + 1];

  console.log(`\nFetching session: ${sessionId}...`);

  // Handle 'latest' shortcut
  if (sessionId === 'latest') {
    if (!SUPABASE_KEY) throw new Error('SUPABASE_KEY not set');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ci_sessions?select=id&order=visited_at.desc&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await res.json();
    if (!rows.length) throw new Error('No sessions found');
    sessionId = rows[0].id;
    console.log(`  → using latest session: ${sessionId}`);
  }

  const session = await fetchSession(sessionId);

  if (!session.transcript?.length) {
    console.error('❌ session has no transcript segments — pipeline may not have completed');
    process.exit(1);
  }

  console.log(`  ✓ session loaded: ${session.transcript.length} segments`);
  console.log(`  pipeline_stage:   ${session.pipeline_stage}`);
  console.log(`  transcript_source: ${session.transcript_source || 'unknown'}`);

  // Build analysis_result from saved data for evidence_coverage check
  const analysisResult = {
    skills:     session.skill_scores?.skills     || [],
    ocpb_facts: session.customer_intel?.ocpb_facts || [],
  };

  console.log('\nCalling /eval...');
  const evalResult = await callEval(session.transcript, analysisResult, groundTruth);

  printResult(evalResult, session);

  // Save to echo_eval_log
  if (SUPABASE_KEY) {
    await saveEvalResult(sessionId, evalResult);
  } else {
    console.log('  (SUPABASE_KEY not set — skipping eval log save)');
  }
}

main().catch(e => {
  console.error('\n❌ Error:', e.message);
  process.exit(1);
});
