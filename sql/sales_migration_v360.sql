-- ═══════════════════════════════════════════════════════════
-- Sales v360 Migration
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- 1. Add account_type to sales_pipeline
ALTER TABLE sales_pipeline
  ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'SA'
    CHECK (account_type IN ('SA','MC','Chain'));

-- 2. Add index for fast lookup
CREATE INDEX IF NOT EXISTS sales_pipeline_acct_type_idx
  ON sales_pipeline (account_type);

-- 3. Target levels for Sales (use existing targets table)
-- level='sales'      → per Sales rep  (for_email = rep email)
-- level='sales_team' → per Sales TL   (for_email = tl email)
-- Insert example (replace values):
-- INSERT INTO targets (period, level, for_email, gmv_target)
-- VALUES ('2026-06', 'sales_team', 'tao@freshket.co', 3000000)
-- ON CONFLICT (period, level, for_email) DO UPDATE SET gmv_target = EXCLUDED.gmv_target;

-- INSERT INTO targets (period, level, for_email, gmv_target)
-- VALUES ('2026-06', 'sales', 'malisa.c@freshket.co', 600000)
-- ON CONFLICT (period, level, for_email) DO UPDATE SET gmv_target = EXCLUDED.gmv_target;

