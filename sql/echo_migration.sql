-- ══════════════════════════════════════════════════════════
-- Echo Feature — Supabase Migration
-- รัน 1 ครั้งใน Supabase SQL Editor
-- Created: 2026-06-06
-- ══════════════════════════════════════════════════════════

-- 1. ci_sessions table (Echo visit log — append only)
CREATE TABLE IF NOT EXISTS ci_sessions (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_email    text NOT NULL,
  owner_type     text NOT NULL CHECK (owner_type IN ('kam','sales')),
  account_id     text,           -- NULL for Sales leads
  account_name   text,           -- free text name (Sales) or resolved name (KAM)
  visited_at     timestamptz NOT NULL DEFAULT now(),
  duration_secs  int,
  skill_scores   jsonb,
  customer_intel jsonb,
  next_actions   jsonb,
  status         text DEFAULT 'saved' CHECK (status IN ('draft','saved')),
  created_at     timestamptz DEFAULT now()
);

-- Index for fast lookup by owner + account
CREATE INDEX IF NOT EXISTS ci_sessions_owner_idx ON ci_sessions (owner_email, visited_at DESC);
CREATE INDEX IF NOT EXISTS ci_sessions_account_idx ON ci_sessions (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ci_sessions_name_idx ON ci_sessions USING gin (to_tsvector('simple', coalesce(account_name,'')));

-- RLS
ALTER TABLE ci_sessions ENABLE ROW LEVEL SECURITY;

-- KAM/Sales sees own sessions
CREATE POLICY "owner sees own sessions" ON ci_sessions
  FOR ALL USING (owner_email = auth.jwt()->>'email');

-- TL/Admin sees all
CREATE POLICY "tl sees all sessions" ON ci_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('tl','admin')
    )
  );

-- INSERT allowed for authenticated users
CREATE POLICY "authenticated can insert" ON ci_sessions
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ══════════════════════════════════════════════════════════

-- 2. kam_skill_log — add nullable account_id + ci_session_id
-- (ถ้า column มีอยู่แล้ว จะ skip อัตโนมัติ)
ALTER TABLE kam_skill_log
  ALTER COLUMN account_id DROP NOT NULL;

ALTER TABLE kam_skill_log
  ADD COLUMN IF NOT EXISTS ci_session_id uuid REFERENCES ci_sessions(id) ON DELETE SET NULL;

-- ══════════════════════════════════════════════════════════

-- 3. profiles — add 'sales' to allowed roles (if enum/check constraint exists)
-- ถ้า profiles.role เป็น text ธรรมดา (ไม่มี CHECK) ไม่ต้องรัน
-- ถ้ามี CHECK constraint ให้ drop แล้ว recreate:
-- ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
-- ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
--   CHECK (role IN ('rep','tl','admin','sales'));

-- ══════════════════════════════════════════════════════════

-- 4. Verify
SELECT 'ci_sessions created' as status, count(*) as rows FROM ci_sessions
UNION ALL
SELECT 'kam_skill_log ci_session_id', count(*) FROM kam_skill_log WHERE ci_session_id IS NOT NULL;
