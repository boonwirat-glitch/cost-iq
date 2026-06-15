-- Echo v2 — Add summary_data column to ci_sessions
-- Run in Supabase SQL editor

ALTER TABLE ci_sessions
  ADD COLUMN IF NOT EXISTS summary_data jsonb DEFAULT NULL;

COMMENT ON COLUMN ci_sessions.summary_data IS
  'Echo v2: full Gemini summary output — notes[], customer_said[], next_steps[] (separate from transcript_summary string)';
