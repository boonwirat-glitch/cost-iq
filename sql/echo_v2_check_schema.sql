-- Echo v2 — Pre-migration schema check
-- รันก่อน echo_v2_migration.sql เพื่อดูว่ามีอะไรอยู่แล้ว

-- 1. Tables ที่ Echo ใช้ — มีครบไหม
SELECT
  table_name,
  CASE
    WHEN table_name = 'ci_sessions'           THEN '🔑 core — Echo sessions'
    WHEN table_name = 'echo_eval_log'         THEN '🆕 new in v2'
    WHEN table_name = 'echo_skill_observations' THEN 'Skills bridge'
    WHEN table_name = 'skill_definitions'     THEN 'Rubric'
    WHEN table_name = 'kam_skill_log'         THEN 'Skill log'
    WHEN table_name = 'kam_visits'            THEN 'Visit log'
    ELSE table_name
  END AS note
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'ci_sessions', 'echo_eval_log', 'echo_skill_observations',
    'skill_definitions', 'kam_skill_log', 'kam_visits',
    'covisit_events', 'profiles', 'targets'
  )
ORDER BY table_name;

-- 2. Columns ที่มีอยู่แล้วใน ci_sessions
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ci_sessions'
ORDER BY ordinal_position;

-- 3. Columns ที่ migration จะเพิ่ม — มีแล้วหรือยัง
SELECT
  column_name,
  data_type,
  CASE
    WHEN column_name = 'transcript_source' THEN 'echo_v2_migration เพิ่มให้ — ถ้ามีแล้วข้ามได้'
    WHEN column_name = 'pipeline_stage'    THEN 'ควรมีแล้วจาก v709'
    WHEN column_name = 'transcript'        THEN 'ควรมีแล้วจาก v709'
  END AS migration_note
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ci_sessions'
  AND column_name IN ('transcript_source', 'pipeline_stage', 'transcript')
ORDER BY column_name;

-- 4. echo_eval_log — มีแล้วหรือยัง
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'echo_eval_log'
    )
    THEN '⚠ echo_eval_log มีแล้ว — ข้าม CREATE TABLE ได้'
    ELSE '✓ echo_eval_log ยังไม่มี — migration สร้างได้เลย'
  END AS echo_eval_log_status;

-- 5. View echo_eval_summary — มีแล้วหรือยัง
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'echo_eval_summary'
    )
    THEN '⚠ echo_eval_summary view มีแล้ว — ข้าม CREATE VIEW ได้ (หรือจะ DROP แล้วสร้างใหม่)'
    ELSE '✓ echo_eval_summary ยังไม่มี — migration สร้างได้เลย'
  END AS eval_summary_view_status;
