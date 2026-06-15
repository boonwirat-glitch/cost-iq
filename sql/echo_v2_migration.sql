-- Echo v2 Migration
-- Run in Supabase SQL editor
-- Adds transcript_source column + eval_log table

-- 1. Add transcript_source to ci_sessions
--    Tracks whether transcript came from full diarization or whisper fallback
ALTER TABLE ci_sessions
  ADD COLUMN IF NOT EXISTS transcript_source text DEFAULT 'unknown';

-- Values:
--   'groq_whisper_gemini_diarize'  → full pipeline, speaker labels assigned
--   'whisper_fallback'             → diarize failed, speaker = 'ไม่ทราบ'
--   'unknown'                      → legacy sessions before Echo v2

COMMENT ON COLUMN ci_sessions.transcript_source IS
  'Echo v2: source of transcript — groq_whisper_gemini_diarize | whisper_fallback | unknown';

-- 2. Add eval_log table for storing eval scores per session
--    Enables measuring spec criteria over time
CREATE TABLE IF NOT EXISTS echo_eval_log (
  id                        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id                uuid REFERENCES ci_sessions(id) ON DELETE CASCADE,
  evaluated_at              timestamptz DEFAULT now(),
  total_segments            int,
  avg_speaker_confidence    float,
  avg_transcript_confidence float,
  speaker_accuracy          float,
  hallucination_rate        float,     -- null if no ground truth
  evidence_coverage         float,     -- null if no analysis_result
  overall_pass              boolean,
  criteria_detail           jsonb,     -- full criteria breakdown from /eval
  source                    text       -- transcript_source from ci_sessions
);

COMMENT ON TABLE echo_eval_log IS
  'Echo v2: eval scores per session — measures spec criteria (Thai accuracy, hallucination, evidence coverage)';

-- 3. Index for querying eval history
CREATE INDEX IF NOT EXISTS idx_echo_eval_log_session
  ON echo_eval_log (session_id);

CREATE INDEX IF NOT EXISTS idx_echo_eval_log_evaluated_at
  ON echo_eval_log (evaluated_at DESC);

-- 4. View: sessions with eval summary (for monitoring)
CREATE OR REPLACE VIEW echo_eval_summary AS
SELECT
  s.id,
  s.owner_email,
  s.visited_at,
  s.duration_secs,
  s.transcript_source,
  s.pipeline_stage,
  e.avg_speaker_confidence,
  e.avg_transcript_confidence,
  e.speaker_accuracy,
  e.hallucination_rate,
  e.evidence_coverage,
  e.overall_pass,
  e.evaluated_at
FROM ci_sessions s
LEFT JOIN echo_eval_log e ON e.session_id = s.id
ORDER BY s.visited_at DESC;

COMMENT ON VIEW echo_eval_summary IS
  'Echo v2: monitoring view — sessions with quality scores';

