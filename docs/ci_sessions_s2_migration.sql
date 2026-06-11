-- ══════════════════════════════════════════════════════════════
-- ci_sessions — add tl_note column (Session 2 migration)
-- Run in Supabase → SQL Editor → New query
-- ══════════════════════════════════════════════════════════════

-- 1. Add tl_note column (idempotent)
ALTER TABLE public.ci_sessions
  ADD COLUMN IF NOT EXISTS tl_note TEXT;

-- 2. Allow TL/admin to update tl_note
-- (existing RLS on ci_sessions should already allow TL to UPDATE
--  but if there's a row-level restriction, add policy here)

-- Verify
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'ci_sessions' 
  AND table_schema = 'public'
  AND column_name IN ('tl_note', 'tl_reviewed_at', 'tl_reviewed_by')
ORDER BY column_name;
