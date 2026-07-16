-- ════════════════════════════════════════════════════════════════════════════
-- NEW_SKUS_PORTFOLIO v3 — portfolio-wide "new-to-FRESHKET SKU adoption this month"
-- Output:  new_skus_portfolio.csv (upload to R2 root, same bucket as
--          company_gmv.csv / sales_handover_pipeline.csv)
-- Refresh: manual BigQuery run + manual R2 upload (monthly is enough — this
--          is a "what's catching on this month" signal, not a daily one,
--          but daily is harmless if run alongside the other CSVs)
-- Columns (4): item_id, item_name_th, new_gmv, account_count
--
-- v3 (2026-07-15): redefined "new". v2 counted an item as "new" if a given
-- ACCOUNT bought it for the first time this month (no purchase last month) —
-- summed across every account, so a long-established catalog item simply
-- reaching several new customers this month ranked as "new," which is why
-- the number looked suspiciously large. Redefined to: genuinely new to
-- FRESHKET — zero gmv_ex_vat > 0 anywhere on the platform, any account,
-- before this month. Only a real first-ever sale counts now.
--
-- Platform history window starts 2026-01-01 (v_history_start), matching
-- company_gmv.sql's own v_window_start — the same "since data collection
-- began" boundary already used elsewhere in this repo. If Freshket's real
-- sellable order history goes back further and that matters for this
-- signal, move this constant back too (and expect a much heavier scan).
-- ════════════════════════════════════════════════════════════════════════════

DECLARE v_data_end      DATE DEFAULT DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY);
DECLARE v_cur_month     DATE DEFAULT DATE_TRUNC(v_data_end, MONTH);
DECLARE v_history_start DATE DEFAULT DATE('2026-01-01');

WITH cur_raw AS (
  SELECT
    CAST(o.account_id AS STRING)    AS account_id,
    CAST(i.item_id AS STRING)       AS item_id,
    i.item_name_th,
    i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  WHERE o.delivery_date >= v_cur_month
    AND o.delivery_date <= v_data_end
    AND i.item_id IS NOT NULL
    AND i.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
),
cur AS (
  SELECT
    account_id, item_id,
    ANY_VALUE(item_name_th) AS item_name_th,
    SUM(gmv_ex_vat)         AS gmv
  FROM cur_raw
  GROUP BY account_id, item_id
  HAVING SUM(gmv_ex_vat) > 1000  -- same per-account-item adoption threshold as v2
),
platform_history AS (
  -- Every item sold ANYWHERE on the platform before this month — no
  -- per-account grain, no $ threshold: a single prior baht by any account,
  -- any time since v_history_start, disqualifies the item from "new."
  SELECT DISTINCT CAST(i.item_id AS STRING) AS item_id
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  WHERE o.delivery_date >= v_history_start
    AND o.delivery_date < v_cur_month
    AND i.item_id IS NOT NULL
    AND i.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
)

SELECT
  cur.item_id,
  ANY_VALUE(cur.item_name_th)    AS item_name_th,
  ROUND(SUM(cur.gmv), 0)         AS new_gmv,
  COUNT(DISTINCT cur.account_id) AS account_count
FROM cur
LEFT JOIN platform_history ph ON ph.item_id = cur.item_id
WHERE ph.item_id IS NULL   -- genuinely never sold before this month, anywhere
GROUP BY cur.item_id
ORDER BY new_gmv DESC;
