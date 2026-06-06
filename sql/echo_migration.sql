-- ══════════════════════════════════════════════════════════════════════
-- Freshket Sense — Echo Feature: Complete SQL Migration
-- รัน 1 ครั้งใน Supabase SQL Editor
-- idempotent: รันซ้ำได้ปลอดภัย (IF NOT EXISTS / IF EXISTS ทุกจุด)
-- สร้าง: 2026-06-06
-- ══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- STEP 1: kam_visits — เพิ่ม columns สำหรับ Echo
-- (table นี้มีอยู่แล้ว — แค่ ADD COLUMN)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE kam_visits
  ADD COLUMN IF NOT EXISTS ci_skill_scores     JSONB,
  ADD COLUMN IF NOT EXISTS ci_customer_signals JSONB,
  ADD COLUMN IF NOT EXISTS ci_next_actions     JSONB,
  ADD COLUMN IF NOT EXISTS ci_mode             TEXT,
  ADD COLUMN IF NOT EXISTS ci_created_at       TIMESTAMPTZ DEFAULT NOW();


-- ─────────────────────────────────────────────────────────────────────
-- STEP 2: kam_skill_log — สร้างใหม่ (ถ้ายังไม่มี)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kam_skill_log (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  kam_email        TEXT        NOT NULL,
  account_id       TEXT,                        -- nullable: Sales ไม่มี account_id
  session_date     DATE        NOT NULL,
  skill_code       TEXT        NOT NULL,
  score            TEXT        NOT NULL,
  evidence_summary TEXT,
  tl_override      TEXT,
  tl_note          TEXT,
  ci_session_id    UUID,                        -- FK จะ add หลัง ci_sessions สร้างแล้ว
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS kam_skill_log_email_idx
  ON kam_skill_log (kam_email, session_date DESC);
CREATE INDEX IF NOT EXISTS kam_skill_log_account_idx
  ON kam_skill_log (account_id) WHERE account_id IS NOT NULL;

-- RLS
ALTER TABLE kam_skill_log ENABLE ROW LEVEL SECURITY;

-- KAM เห็นเฉพาะของตัวเอง
DROP POLICY IF EXISTS "KAM sees own"  ON kam_skill_log;
CREATE POLICY "KAM sees own" ON kam_skill_log
  FOR SELECT USING (kam_email = auth.jwt()->>'email');

-- TL/Admin เห็นทั้งทีม
DROP POLICY IF EXISTS "TL sees team" ON kam_skill_log;
CREATE POLICY "TL sees team" ON kam_skill_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('tl','admin')
    )
  );

-- Insert: เฉพาะ authenticated
DROP POLICY IF EXISTS "authenticated insert skill" ON kam_skill_log;
CREATE POLICY "authenticated insert skill" ON kam_skill_log
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');


-- ─────────────────────────────────────────────────────────────────────
-- STEP 3: ci_sessions — สร้างใหม่ (Echo visit log)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ci_sessions (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_email    TEXT        NOT NULL,
  owner_type     TEXT        NOT NULL CHECK (owner_type IN ('kam','sales')),
  account_id     TEXT,                          -- NULL สำหรับ Sales lead
  account_name   TEXT,                          -- ชื่อร้าน (Sales พิมพ์เอง หรือ KAM resolved)
  visited_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_secs  INT,
  skill_scores   JSONB,
  customer_intel JSONB,
  next_actions   JSONB,
  status         TEXT        DEFAULT 'saved' CHECK (status IN ('draft','saved')),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS ci_sessions_owner_idx
  ON ci_sessions (owner_email, visited_at DESC);
CREATE INDEX IF NOT EXISTS ci_sessions_account_idx
  ON ci_sessions (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ci_sessions_name_trgm_idx
  ON ci_sessions USING gin (to_tsvector('simple', coalesce(account_name, '')));

-- RLS
ALTER TABLE ci_sessions ENABLE ROW LEVEL SECURITY;

-- เจ้าของเห็นของตัวเอง (KAM + Sales)
DROP POLICY IF EXISTS "owner sees own sessions" ON ci_sessions;
CREATE POLICY "owner sees own sessions" ON ci_sessions
  FOR ALL USING (owner_email = auth.jwt()->>'email');

-- TL/Admin เห็นทั้งหมด
DROP POLICY IF EXISTS "tl sees all sessions" ON ci_sessions;
CREATE POLICY "tl sees all sessions" ON ci_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('tl','admin')
    )
  );

-- Insert
DROP POLICY IF EXISTS "authenticated can insert" ON ci_sessions;
CREATE POLICY "authenticated can insert" ON ci_sessions
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');


-- ─────────────────────────────────────────────────────────────────────
-- STEP 4: FK จาก kam_skill_log → ci_sessions (หลังทั้งสอง table พร้อม)
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'kam_skill_log_ci_session_id_fkey'
    AND table_name = 'kam_skill_log'
  ) THEN
    ALTER TABLE kam_skill_log
      ADD CONSTRAINT kam_skill_log_ci_session_id_fkey
      FOREIGN KEY (ci_session_id)
      REFERENCES ci_sessions(id)
      ON DELETE SET NULL;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 5: profiles — รองรับ role 'sales'
-- รัน เฉพาะถ้า profiles.role มี CHECK constraint อยู่แล้ว
-- ตรวจสอบก่อน: SELECT * FROM information_schema.check_constraints WHERE constraint_name LIKE '%profile%role%';
-- ถ้าไม่มี constraint → ข้าม STEP นี้ได้เลย (text column รับ 'sales' ได้อยู่แล้ว)
-- ─────────────────────────────────────────────────────────────────────
-- ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
-- ALTER TABLE profiles
--   ADD CONSTRAINT profiles_role_check
--   CHECK (role IN ('rep','tl','admin','sales'));


-- ─────────────────────────────────────────────────────────────────────
-- STEP 6: acct_alternatives — ตรวจสอบว่ามีอยู่แล้ว (ไม่ต้องสร้าง)
-- table นี้ใช้ใน 01_core.js + 05_kam_view.js อยู่แล้ว
-- ─────────────────────────────────────────────────────────────────────
-- (no action needed)


-- ─────────────────────────────────────────────────────────────────────
-- VERIFY — รันหลังจบเพื่อ confirm ทุก table พร้อม
-- ─────────────────────────────────────────────────────────────────────
SELECT
  table_name,
  (SELECT count(*) FROM information_schema.columns c
   WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS col_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('kam_visits','kam_skill_log','ci_sessions','profiles','acct_alternatives')
ORDER BY table_name;
