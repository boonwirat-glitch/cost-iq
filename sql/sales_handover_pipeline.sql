-- ════════════════════════════════════════════════════════════════════════════
-- SALES_HANDOVER_PIPELINE v3 — Sales → KAM/PM/Admin handover forecast
-- Output:  sales_handover_pipeline.csv (upload to R2 root, same bucket as
--          company_gmv.csv)
-- Refresh: manual BigQuery run + manual R2 upload (daily recommended, same
--          cadence as company_gmv.csv — the pipeline shifts every day as
--          deadlines pass)
-- Columns (8): outlet_id, account_id, account_name, account_type, bucket,
--              new_user_exp_date, last_month_gmv, orders
-- Grain:   one row per outlet CURRENTLY owned by Sales. This is a
--          forward-looking snapshot, not a historical monthly series
--          (contrast with company_gmv.csv).
--
-- v2 fix: v1 determined "current owner" from dim.user_master.commercial_owner,
--   which is a stale dimension snapshot (confirmed via a real BigQuery run:
--   24,601 rows, 98.2% with ฿0 GMV, including TEST/Exclude account_types and
--   374 accounts literally named "...(Not Use)"). Sales GMV — like every
--   other segment in company_gmv.sql — is counted BY ORDER. This version
--   instead mirrors sql/q3_2026_movement_rep_view.sql's `latest_own` CTE:
--   current owner = whoever is tagged on the MOST RECENT row in dwh.order
--   for that outlet. An outlet with zero orders ever has no row here at
--   all — intentional (confirmed with user): a lead that has never ordered
--   isn't yet pipeline in $ terms, and this naturally drops the stale
--   zero-order zombie rows v1 was full of. Confirmed via a real re-run:
--   24,601 rows → 4,076 rows, new_user_exp_date coverage 5.6% → 90.1%,
--   GMV total unchanged (~5.6M) — no real revenue was dropped, only noise.
--
-- v3 fix: the account_type exclusion filter was case-sensitive ('TEST'
--   only), so 8 zero-GMV rows tagged lowercase/mixed-case 'Test' slipped
--   through in the v2 re-run. Now compares UPPER(TRIM(...)) so any casing
--   is caught.
--
-- Business rule (context — new_user_exp_date is already computed upstream,
--   NOT recomputed here): Sales must hand an account to KAM/PM/Admin within
--   45 days (SA accounts) or 90 days (MC/Chain accounts) of first order.
--   new_user_exp_date is that deadline, read straight off dwh.order (present
--   there directly — see q3_2026_movement_rep_view.sql's outlet_exp_date
--   CTE). Unlike that CTE (which only wants PAST exp dates for retrospective
--   movement classification), this export does NOT restrict to dates
--   <= yesterday, since a forward-looking pipeline needs future deadlines.
--
-- last_month_gmv: the most recently CLOSED calendar month's GMV for the
--   outlet (not current-MTD) — a stable run-rate estimate so a pipeline
--   forecast isn't skewed by partial-month noise.
--
-- Locked rules: gmv_ex_vat only, gmv_ex_vat > 0.
-- ════════════════════════════════════════════════════════════════════════════

DECLARE v_data_end          DATE DEFAULT DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY);
DECLARE v_last_closed_end   DATE DEFAULT DATE_SUB(DATE_TRUNC(v_data_end, MONTH), INTERVAL 1 DAY);
DECLARE v_last_closed_start DATE DEFAULT DATE_TRUNC(v_last_closed_end, MONTH);

WITH

-- ── Current owner = whoever is on the MOST RECENT order per outlet ───────
-- Same pattern as q3_2026_movement_rep_view.sql's `latest_own` CTE — the
-- codebase's established, trusted source of "who owns this outlet now."
latest_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    CAST(o.account_id AS STRING)    AS account_id,
    o.res_name                      AS account_name,
    o.account_type                  AS account_type,
    UPPER(TRIM(o.commercial_owner)) AS latest_commercial_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND UPPER(TRIM(IFNULL(o.account_type, ''))) NOT IN ('CONSUMER', 'ENDUSER', 'EXCLUDE', 'TEST')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── Handover deadline — forward-looking (no <= yesterday restriction) ────
outlet_exp_date AS (
  SELECT
    CAST(o.user_id AS STRING)      AS outlet_id,
    DATE(MAX(o.new_user_exp_date)) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.new_user_exp_date IS NOT NULL
    AND o.user_id IS NOT NULL
    AND UPPER(TRIM(IFNULL(o.account_type, ''))) NOT IN ('CONSUMER', 'ENDUSER', 'EXCLUDE', 'TEST')
  GROUP BY 1
),

-- ── Last closed month's GMV per outlet — stable run-rate proxy ───────────
last_month_gmv AS (
  SELECT
    CAST(user_id AS STRING)   AS outlet_id,
    ROUND(SUM(gmv_ex_vat), 0) AS gmv,
    COUNT(DISTINCT order_id)  AS orders
  FROM `freshket-rn.dwh.order`
  WHERE delivery_date >= v_last_closed_start
    AND delivery_date <= v_last_closed_end
    AND gmv_ex_vat > 0
  GROUP BY outlet_id
)

SELECT
  lo.outlet_id,
  lo.account_id,
  lo.account_name,
  lo.account_type,
  CASE
    WHEN lo.account_type = 'Chain'       THEN 'chain'
    WHEN lo.account_type IN ('SA', 'MC') THEN 'sa_mc'
    ELSE 'other'
  END AS bucket,
  IFNULL(CAST(oed.new_user_exp_date AS STRING), '') AS new_user_exp_date,
  IFNULL(lmg.gmv, 0)    AS last_month_gmv,
  IFNULL(lmg.orders, 0) AS orders
FROM latest_own lo
LEFT JOIN outlet_exp_date oed ON lo.outlet_id = oed.outlet_id
LEFT JOIN last_month_gmv lmg  ON lo.outlet_id = lmg.outlet_id
WHERE lo.latest_commercial_owner = 'SALE'
ORDER BY oed.new_user_exp_date, lo.account_name;
