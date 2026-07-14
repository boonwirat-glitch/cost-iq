-- ════════════════════════════════════════════════════════════════════════════
-- Diagnostic 2 of 2: hand-trace ONE real KAM's Expansion-tier cumulative GMV
-- ════════════════════════════════════════════════════════════════════════════
-- Purpose: independent, from-scratch verification for the 2026-07-13 fix
-- making the Expansion commission tier cumulative across the quarter (was
-- previously only reading the single latest elapsed month). NOT part of any
-- CSV pipeline — read-only, single self-contained script, run directly in
-- the BigQuery console. This is file 2 of 2 — see sql/diagnose_upsell_p1p3.sql
-- for the P1/P3 check (kept as a SEPARATE file: BigQuery scripting requires
-- every DECLARE at the very start of a script, before any other statement).
--
-- How to use: fill in v_kam_name below with a real KAM's ka_owner value.
-- Confirmed (sql/Q8E_portview_v3.sql:134-144,173) ka_owner stores a NAME,
-- not an email — matched against kam_name elsewhere in this codebase, e.g.
-- 'Puttipong (Tape) Wanithaweewat' — NOT an @freshket.co address.
--
-- What to check against: sum expansion_gmv across ALL month_key rows for one
-- outlet_id below — that cumulative total is what the fixed Expansion tier
-- should now show for that outlet, in both Sense (07a_commission_engine.js's
-- _commComputeUpsellOutlet) and /nrr, instead of just the latest month.
-- ════════════════════════════════════════════════════════════════════════════

DECLARE v_kam_name STRING DEFAULT 'REPLACE_ME';  -- e.g. 'Puttipong (Tape) Wanithaweewat' — a name, not an email
DECLARE v_q3_start DATE DEFAULT '2026-07-01';
DECLARE v_q3_end   DATE DEFAULT DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY);

WITH outlet_first_dollar AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(DATE(o.delivery_date)) AS first_dollar_date,
    ARRAY_AGG(UPPER(TRIM(o.commercial_owner)) ORDER BY o.delivery_date ASC LIMIT 1)[SAFE_OFFSET(0)] AS first_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),
expansion_outlets AS (
  SELECT outlet_id FROM outlet_first_dollar
  -- v2 fix: `first_owner != 'SALE'` silently drops any row where first_owner
  -- is NULL (SQL three-valued logic — NULL != 'SALE' evaluates to NULL, not
  -- TRUE, so WHERE excludes it) — a brand-new outlet's very first order can
  -- easily have a NULL/blank commercial_owner. COALESCE to '' first so a
  -- NULL is treated as "not SALE" (correct — NULL is definitely not the
  -- literal string 'SALE') instead of being silently dropped.
  WHERE first_dollar_date >= v_q3_start AND COALESCE(first_owner, '') != 'SALE'
),
raw AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    FORMAT_DATE('%Y-%m', o.delivery_date) AS month_key,
    i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  WHERE o.ka_owner = v_kam_name
    AND CAST(o.user_id AS STRING) IN (SELECT outlet_id FROM expansion_outlets)
    AND i.gmv_ex_vat > 0
    AND o.delivery_date >= v_q3_start AND o.delivery_date <= v_q3_end
)
SELECT month_key, outlet_id, ROUND(SUM(gmv_ex_vat), 0) AS expansion_gmv
FROM raw
GROUP BY 1, 2
ORDER BY outlet_id, month_key;

-- If this still comes back empty for an outlet_id you already confirmed is
-- real and active (via find_test_values.sql), run this fallback to see
-- exactly which stage drops it — paste separately, fill in v_check_outlet:
--
-- DECLARE v_check_outlet STRING DEFAULT 'REPLACE_ME';
-- SELECT
--   CAST(o.user_id AS STRING) AS outlet_id,
--   MIN(DATE(o.delivery_date)) AS first_dollar_date,
--   ARRAY_AGG(UPPER(TRIM(o.commercial_owner)) ORDER BY o.delivery_date ASC LIMIT 1)[SAFE_OFFSET(0)] AS first_owner,
--   ARRAY_AGG(o.ka_owner ORDER BY o.delivery_date ASC LIMIT 1)[SAFE_OFFSET(0)] AS first_owner_ka
-- FROM `freshket-rn.dwh.order` o
-- WHERE CAST(o.user_id AS STRING) = v_check_outlet AND o.user_id IS NOT NULL AND o.gmv_ex_vat > 0
-- GROUP BY 1;
-- Check: is first_dollar_date really >= 2026-07-01? Is first_owner really
-- not 'SALE' (case/whitespace exact)? Does o.ka_owner on THAT first row
-- match the KAM name you're filtering by in the main query (a handover
-- outlet's first order might show a DIFFERENT ka_owner than its current
-- one — this diagnostic filters the FINAL query by current ka_owner, but
-- classifies "expansion" off the very first order's owner, which is
-- intentional/correct, just worth knowing about when interpreting results).
