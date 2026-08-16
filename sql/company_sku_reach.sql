-- ════════════════════════════════════════════════════════════════════════════
-- COMPANY_SKU_REACH v1 — Company-wide SKU Reach (Key SKU feature, criterion ข)
-- Output: company_sku_reach.csv  (upload to R2 root, same bucket as company_gmv.csv)
-- Refresh: manual BigQuery run + manual R2 upload, same cadence as SQL1/Q3B
-- Columns (4): item_id, distinct_account_count, total_gmv, total_order_count
--
-- Purpose: "sole-source" signal for the Key SKU feature — a SKU only 1-3
-- accounts company-wide buy from Freshket is a stock-out risk the KAM has no
-- visibility into from their own portfolio alone (SQL1/Q3B are KAM/account-
-- scoped). This file answers "across the WHOLE company, how many distinct
-- accounts order this item_id" — deliberately NOT restricted to any KAM
-- roster or account_type, because reach must count every real buyer or the
-- signal lies (an item bought by 2 KAM accounts + 5 non-KAM accounts is NOT
-- sole-source even though it looks like it from inside one KAM's portfolio).
--
-- Window: same 2-complete-months + current-month-MTD as SQL1/Q3B, so the app
-- compares reach over the identical period it already has SKU rows for.
-- Locked rules: gmv_ex_vat only, no order-status filter, item_id required.
-- No splitter — this is one company-wide file, not a per-KAM bundle.
-- ════════════════════════════════════════════════════════════════════════════

WITH raw AS (
  SELECT
    CAST(i.item_id AS STRING)  AS item_id,
    o.user_id,
    o.order_id,
    i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  WHERE o.delivery_date >= DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH), INTERVAL 2 MONTH)
    AND o.delivery_date <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)  -- day-1 lag guard, matches SQL1/Q3B
    AND i.item_id IS NOT NULL
)

SELECT
  item_id,
  COUNT(DISTINCT user_id)      AS distinct_account_count,
  ROUND(SUM(gmv_ex_vat), 2)    AS total_gmv,
  COUNT(DISTINCT order_id)     AS total_order_count
FROM raw
GROUP BY item_id
ORDER BY distinct_account_count ASC, total_gmv DESC;
