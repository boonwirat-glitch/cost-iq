-- Echo v2 — Pull session data for hallucination testing
-- รันใน Supabase SQL editor
-- เปลี่ยน :session_id เป็น UUID จริง หรือใช้ query ที่ 2 เพื่อดึง session ล่าสุด

-- ── 1. ดึง session ล่าสุด (ไม่ต้องรู้ id) ───────────────────────────────────
SELECT
  id,
  owner_email,
  visited_at,
  duration_secs,
  pipeline_stage,
  transcript_source,
  jsonb_array_length(transcript)              AS segment_count,

  -- Transcript segments แบบ readable
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',         seg->>'segment_id',
        'ts',         seg->>'ts',
        'speaker',    seg->>'speaker',
        'text',       seg->>'text',
        'spk_conf',   seg->>'speaker_confidence',
        'txt_conf',   seg->>'transcript_confidence'
      )
    )
    FROM jsonb_array_elements(transcript) AS seg
  )                                            AS segments_readable,

  -- Speaker breakdown
  (
    SELECT COUNT(*)
    FROM jsonb_array_elements(transcript) AS seg
    WHERE seg->>'speaker' = 'Sales'
  )                                            AS sales_segments,

  (
    SELECT COUNT(*)
    FROM jsonb_array_elements(transcript) AS seg
    WHERE seg->>'speaker' = 'ลูกค้า'
  )                                            AS customer_segments,

  (
    SELECT COUNT(*)
    FROM jsonb_array_elements(transcript) AS seg
    WHERE seg->>'speaker' = 'ไม่ทราบ' OR seg->>'speaker' IS NULL
  )                                            AS unknown_segments,

  -- Avg confidence
  (
    SELECT ROUND(AVG((seg->>'speaker_confidence')::float)::numeric, 3)
    FROM jsonb_array_elements(transcript) AS seg
  )                                            AS avg_speaker_conf,

  (
    SELECT ROUND(AVG((seg->>'transcript_confidence')::float)::numeric, 3)
    FROM jsonb_array_elements(transcript) AS seg
  )                                            AS avg_transcript_conf,

  transcript_summary,
  skill_scores->'overall'                      AS overall_score

FROM ci_sessions
WHERE transcript IS NOT NULL
ORDER BY visited_at DESC
LIMIT 5;


-- ── 2. ดึง transcript text ล้วนๆ สำหรับ copy ไป compare กับเสียงจริง ────────
SELECT
  id,
  visited_at,
  duration_secs,
  transcript_source,
  string_agg(
    '[' || (seg->>'ts') || '] ' ||
    COALESCE(seg->>'speaker', '?') || ': ' ||
    COALESCE(seg->>'text', ''),
    E'\n'
    ORDER BY (seg->>'segment_id')::int
  ) AS full_transcript_text
FROM ci_sessions,
     jsonb_array_elements(transcript) AS seg
WHERE transcript IS NOT NULL
ORDER BY visited_at DESC
LIMIT 1;


-- ── 3. Confidence distribution — ดูว่า segment ไหน confidence ต่ำสุด ────────
SELECT
  (seg->>'segment_id')::int                       AS segment_id,
  seg->>'ts'                                       AS ts,
  seg->>'speaker'                                  AS speaker,
  ROUND((seg->>'speaker_confidence')::numeric, 2)  AS spk_conf,
  ROUND((seg->>'transcript_confidence')::numeric, 2) AS txt_conf,
  LEFT(seg->>'text', 80)                           AS text_preview
FROM ci_sessions,
     jsonb_array_elements(transcript) AS seg
WHERE transcript IS NOT NULL
  AND visited_at = (SELECT MAX(visited_at) FROM ci_sessions WHERE transcript IS NOT NULL)
ORDER BY (seg->>'transcript_confidence')::float ASC
LIMIT 20;
