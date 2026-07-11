-- ════════════════════════════════════════════════════════════════════════════
-- Verify: Portfolio Pulse "จาก Sales" definition (2026-07-11)
-- One-off diagnostic query — NOT part of any CSV pipeline, nothing reads its
-- output. Run directly in the BigQuery console to independently confirm what
-- /nrr's #/pulse page computed client-side from kam_rep_view.csv: "0 accounts
-- this month with first_dollar_owner='SALE'".
--
-- Mirrors the EXACT same outlet_first_dollar logic already used by
-- sql/q3_2026_movement_rep_view.sql (lines ~134-149: same filters, same
-- ARRAY_AGG-ordered-by-delivery_date pattern for "owner of the very first
-- order, ever") — this is a from-scratch re-derivation straight off
-- freshket-rn.dwh.order, not a read of the CSV, so it's a real independent
-- check, not just re-running the same pipeline.
--
-- Rewritten (2026-07-11) as ONE single statement — the earlier multi-
-- statement CREATE TEMP TABLE version is correct but forces you to click
-- through BigQuery's per-statement "View results" job list, which is easy
-- to fumble in the console UI. This version has no DECLARE/SET/TEMP TABLE at
-- all — just one query, so results appear in the normal single results pane
-- the moment it finishes running. Run QUERY 1 first (the direct answer);
-- QUERY 2 below it (paste separately) shows the row-level detail if QUERY 1's
-- counts are non-zero and you want to see which accounts they are.
-- ════════════════════════════════════════════════════════════════════════════

-- ── QUERY 1 — the direct answer (one row) ───────────────────────────────────
WITH outlet_first_dollar AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(DATE(o.delivery_date)) AS first_dollar_date,
    ARRAY_AGG(
      UPPER(TRIM(o.commercial_owner))
      ORDER BY o.delivery_date ASC LIMIT 1
    )[SAFE_OFFSET(0)] AS first_dollar_owner,
    ARRAY_AGG(
      CAST(o.account_id AS STRING)
      ORDER BY o.delivery_date ASC LIMIT 1
    )[SAFE_OFFSET(0)] AS account_id
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),
sale_first_dollar AS (
  SELECT account_id, first_dollar_date
  FROM outlet_first_dollar
  WHERE first_dollar_owner = 'SALE'
)
SELECT
  (SELECT COUNT(DISTINCT account_id) FROM sale_first_dollar
    WHERE first_dollar_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), MONTH)
      AND first_dollar_date <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)) AS accounts_this_month,
  (SELECT COUNT(DISTINCT account_id) FROM sale_first_dollar
    WHERE first_dollar_date = DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)) AS accounts_yesterday,
  (SELECT MAX(first_dollar_date) FROM sale_first_dollar) AS most_recent_sale_first_dollar_date,
  DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), MONTH) AS month_start_used,
  DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY) AS lag_date_used;


-- ── QUERY 2 — row-level detail: the 20 most recent SALE-first-dollar
--    accounts regardless of date, so you can see how stale/fresh the tail
--    is even if QUERY 1's counts come back 0 (paste + run SEPARATELY) ───────
WITH outlet_first_dollar AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(DATE(o.delivery_date)) AS first_dollar_date,
    ARRAY_AGG(
      UPPER(TRIM(o.commercial_owner))
      ORDER BY o.delivery_date ASC LIMIT 1
    )[SAFE_OFFSET(0)] AS first_dollar_owner,
    ARRAY_AGG(
      STRUCT(CAST(o.account_id AS STRING) AS account_id,
             o.cdp_account_name AS account_name,
             o.cdp_res_name AS res_name)
      ORDER BY o.delivery_date ASC LIMIT 1
    )[SAFE_OFFSET(0)] AS first_order_ids
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
)
SELECT
  first_order_ids.account_id AS account_id,
  first_order_ids.account_name AS account_name,
  first_order_ids.res_name AS res_name,
  first_dollar_date,
  first_dollar_owner
FROM outlet_first_dollar
WHERE first_dollar_owner = 'SALE'
ORDER BY first_dollar_date DESC
LIMIT 20;
