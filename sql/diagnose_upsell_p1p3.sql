-- ════════════════════════════════════════════════════════════════════════════
-- Diagnostic 1 of 2: hand-trace ONE real outlet's P1/P3 group_key GMV
-- ════════════════════════════════════════════════════════════════════════════
-- Purpose: independent, from-scratch verification for the 2026-07-13
-- commission-quarterly-alignment fix to sql/q3c_upsell_team_summary_v4.sql
-- (v8 — the day-1-of-quarter date-anchor bug). NOT part of any CSV pipeline
-- — read-only, single self-contained script, run directly in the BigQuery
-- console. This is file 1 of 2 — see sql/diagnose_expansion_cumulative.sql
-- for the Expansion-tier check (kept as a SEPARATE file: BigQuery scripting
-- requires every DECLARE at the very start of a script, before any other
-- statement — combining both diagnostics in one file broke that rule).
--
-- v2 fix: originally filtered on `o.account_id`, which is NOT a real column
-- on dwh.order in this schema (account_id only exists derived from
-- dim.user_master.account_guid, confirmed by checking how
-- q3c_upsell_team_summary_v4.sql itself resolves it) — would have failed
-- with a column-not-found error. Filters on outlet_id (o.user_id, a real
-- column) directly instead — simpler and avoids the extra join entirely.
--
-- How to use: fill in v_outlet_id below with a real outlet's res_id/user_id
-- (e.g. copy one from Sense's own outlet detail view, or from
-- bulk_outlets.csv's outlet_id column), then run.
--
-- What to check against: per-month group_key totals here should match what
-- q3c_upsell_team_summary_v4.sql (now fixed) computes when cumulatively
-- summed for a trailing unbroken streak — hand-verify one group_key's P1/P3
-- classification and cumulative total against the SQL's own
-- p1_gmv/p3_incremental output for the same KAM.
-- ════════════════════════════════════════════════════════════════════════════

DECLARE v_outlet_id STRING DEFAULT 'REPLACE_ME';
DECLARE v_base_start DATE DEFAULT '2026-04-01';  -- Apr 1 (frozen Apr/May/Jun baseline pool)
DECLARE v_base_end   DATE DEFAULT '2026-06-30';
DECLARE v_q3_start   DATE DEFAULT '2026-07-01';
DECLARE v_q3_end     DATE DEFAULT DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY);

WITH raw AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    FORMAT_DATE('%Y-%m', o.delivery_date) AS month_key,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    i.gmv_ex_vat,
    o.delivery_date
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  WHERE CAST(o.user_id AS STRING) = v_outlet_id
    AND i.gmv_ex_vat > 0
    AND o.delivery_date >= v_base_start
    AND o.delivery_date <= v_q3_end
),
baseline AS (
  -- "has this group_key ever been bought before" — frozen Apr-Jun pool
  SELECT DISTINCT outlet_id, group_key
  FROM raw
  WHERE delivery_date >= v_base_start AND delivery_date <= v_base_end
),
monthly AS (
  SELECT outlet_id, group_key, month_key, ROUND(SUM(gmv_ex_vat), 0) AS gmv
  FROM raw
  WHERE delivery_date >= v_q3_start
  GROUP BY 1, 2, 3
)
SELECT
  m.outlet_id, m.group_key, m.month_key, m.gmv,
  IF(b.group_key IS NULL, 'P1 (new)', 'P3 (existing)') AS classification
FROM monthly m
LEFT JOIN baseline b ON m.outlet_id = b.outlet_id AND m.group_key = b.group_key
ORDER BY m.outlet_id, m.group_key, m.month_key;
