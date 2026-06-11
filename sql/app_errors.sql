-- ═══════════════════════════════════════════════════════════════════
-- v556 Phase 0 — Sense Sentinel: client error telemetry
-- รันใน Supabase Dashboard → SQL Editor (ครั้งเดียว)
--
-- Client (Sense Sentinel ใน shell.html) จะ insert error rows อัตโนมัติ
-- เมื่อ user login อยู่ — ถ้า table ยังไม่มี insert จะ fail เงียบๆ
-- และ queue ค้างใน localStorage (cap 30 แถว) จนกว่าจะรัน migration นี้
--
-- ดู error ล่าสุด:
--   SELECT created_at, version, role, screen, kind, message, source, lineno, count
--   FROM app_errors ORDER BY created_at DESC LIMIT 50;
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS app_errors (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  client_ts  TIMESTAMPTZ,
  user_email TEXT,
  role       TEXT,
  version    TEXT,
  screen     TEXT,
  kind       TEXT,          -- 'error' | 'rejection' | 'resource'
  message    TEXT,
  source     TEXT,
  lineno     INT,
  colno      INT,
  stack      TEXT,
  ua         TEXT,
  count      INT DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_app_errors_created ON app_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_errors_version ON app_errors (version, created_at DESC);

ALTER TABLE app_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_errors_insert ON app_errors;
CREATE POLICY app_errors_insert ON app_errors
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS app_errors_select ON app_errors;
CREATE POLICY app_errors_select ON app_errors
  FOR SELECT TO authenticated USING (true);
