-- ════════════════════════════════════════════════════════════════════════════
-- SALES TARGETS — Supabase INSERT script
-- Table: targets
-- Columns: period (text), level (text), for_email (text), gmv_target (numeric)
--
-- วิธีใช้:
-- 1. แทนที่ email และ target amount ตาม rep จริง
-- 2. รันใน Supabase SQL Editor
-- 3. level = 'sales' เสมอ (ต่างจาก KAM ที่ใช้ 'kam')
--
-- Key pattern ที่ app ใช้: `${period}|${level}|${for_email}`
-- getSalesTarget(period, email) calls _tgtGet(period, 'sales', email)
-- ════════════════════════════════════════════════════════════════════════════

-- ── Guitar (malisa.c) — ตั้ง target Jun 2026 ก่อน เพื่อทดสอบ ──
INSERT INTO targets (period, level, for_email, gmv_target)
VALUES
  ('2026-06', 'sales', 'malisa.c@freshket.co', 1600000)  -- ฿1.6M — แก้ตาม target จริง
ON CONFLICT (period, level, for_email)
DO UPDATE SET gmv_target = EXCLUDED.gmv_target;

-- ── Template: copy block ด้านล่างนี้สำหรับแต่ละ rep ──
-- แทน {EMAIL} ด้วย email จริง, {TARGET} ด้วยจำนวนเงิน (บาท, ไม่มีทศนิยม)
-- แทน {PERIOD} ด้วย "YYYY-MM" เช่น "2026-06"

/*
INSERT INTO targets (period, level, for_email, gmv_target)
VALUES
  ('{PERIOD}', 'sales', '{EMAIL}', {TARGET})
ON CONFLICT (period, level, for_email)
DO UPDATE SET gmv_target = EXCLUDED.gmv_target;
*/

-- ── Bulk INSERT template (ถ้ามี rep หลายคนพร้อมกัน) ──
/*
INSERT INTO targets (period, level, for_email, gmv_target)
VALUES
  ('2026-06', 'sales', 'rep1@freshket.co',  1600000),
  ('2026-06', 'sales', 'rep2@freshket.co',  1400000),
  ('2026-06', 'sales', 'rep3@freshket.co',  1200000),
  -- ... เพิ่มต่อ
  ('2026-06', 'sales', 'rep15@freshket.co', 1500000)
ON CONFLICT (period, level, for_email)
DO UPDATE SET gmv_target = EXCLUDED.gmv_target;
*/

-- ── Verify ──
SELECT period, level, for_email, gmv_target
FROM targets
WHERE level = 'sales'
ORDER BY period DESC, for_email;
