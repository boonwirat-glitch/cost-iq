-- ══════════════════════════════════════════════════════════════
-- Supabase Migration: Q3 Commission Mode
-- Run this in Supabase SQL Editor BEFORE deploying preview branch
-- Date: 2026-06-30
-- ══════════════════════════════════════════════════════════════

-- Add commission_mode and quarter_id columns to nrr_policies
-- DEFAULT 'monthly' ensures existing rows are backward-compatible (T9 pass)
ALTER TABLE nrr_policies
  ADD COLUMN IF NOT EXISTS commission_mode text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS quarter_id text;

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'nrr_policies'
  AND column_name IN ('commission_mode', 'quarter_id');

-- Expected output:
-- commission_mode | text | 'monthly'
-- quarter_id      | text | NULL

-- ══════════════════════════════════════════════════════════════
-- NOTES:
-- - commission_mode: 'monthly' (rolling MoM) | 'quarterly' (fixed base)
-- - quarter_id: '2026-Q3' when commission_mode = 'quarterly'
-- - Existing rows default to 'monthly' — MoM engine unaffected (T9)
-- - After running, Admin can toggle mode via Commission Cockpit UI
-- ══════════════════════════════════════════════════════════════
