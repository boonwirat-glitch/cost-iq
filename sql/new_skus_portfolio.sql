-- ════════════════════════════════════════════════════════════════════════════
-- NEW_SKUS_PORTFOLIO v2 — portfolio-wide "new SKU adoption this month" ranking
-- Output:  new_skus_portfolio.csv (upload to R2 root, same bucket as
--          company_gmv.csv / sales_handover_pipeline.csv)
-- Refresh: manual BigQuery run + manual R2 upload (monthly is enough — this
--          is a "what's catching on this month" signal, not a daily one,
--          but daily is harmless if run alongside the other CSVs)
-- Columns (4): item_id, item_name_th, new_gmv, account_count
--
-- Why this file exists: /nrr's "Portfolio Pulse" signage page (#/pulse) had
-- a bare "+N SKU sold this month" COUNT with no names — no existing export
-- covers this at portfolio grain. `SQL1_sense_skus.sql` (the only other SKU-
-- level export) is per-KAM, joined through a hardcoded KAM email allowlist
-- (`kam_outlets` CTE) — wrong grain for a company-wide signal that should
-- also catch Sales/PM/Admin-owned outlets, not just KAM ones.
--
-- Definition — deliberately mirrors the EXISTING per-account "new SKU"
-- signal already used in the /nrr Account view (nrrSkuPositiveSignals,
-- src/nrr/nrr_account.js:308-330: an item is "new" for an account if it has
-- a row THIS month, no row LAST month, and gmv_ex_vat > 1000 for that
-- account-item pair) — but summed ACROSS every account, so an item many
-- different customers discovered this month ranks higher than one big
-- account's one-off purchase of something obscure.
--
-- Locked rules: gmv_ex_vat only, gmv_ex_vat > 0 at the line-item level
-- (matches every other export in this repo).
--
-- v2: removed the `LIMIT 20` — the Pulse page now shows a real "N SKU ใหม่"
-- COUNT (`newSkuItems.length` in nrr_pulse.js), which needs every qualifying
-- row, not just the top 20 by ฿. Only the UI truncates to a rotating top-N
-- for display; the underlying count must be the true total. Expected volume
-- stays small (the >1000-baht-per-account-item threshold is the real
-- filter) — safe to export in full.
-- ════════════════════════════════════════════════════════════════════════════

DECLARE v_data_end   DATE DEFAULT DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY);
DECLARE v_cur_month  DATE DEFAULT DATE_TRUNC(v_data_end, MONTH);
DECLARE v_last_month DATE DEFAULT DATE_SUB(v_cur_month, INTERVAL 1 MONTH);

WITH raw AS (
  SELECT
    CAST(o.account_id AS STRING)    AS account_id,
    DATE_TRUNC(o.delivery_date, MONTH) AS month_date,
    CAST(i.item_id AS STRING)       AS item_id,
    i.item_name_th,
    i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  WHERE o.delivery_date >= v_last_month
    AND o.delivery_date <= v_data_end
    AND i.item_id IS NOT NULL
    AND i.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
),
acct_item_month AS (
  SELECT
    account_id, item_id, month_date,
    ANY_VALUE(item_name_th) AS item_name_th,
    SUM(gmv_ex_vat)         AS gmv
  FROM raw
  GROUP BY account_id, item_id, month_date
),
cur AS (
  SELECT * FROM acct_item_month
  WHERE month_date = v_cur_month AND gmv > 1000  -- same threshold as nrrSkuPositiveSignals
),
last AS (
  SELECT DISTINCT account_id, item_id FROM acct_item_month WHERE month_date = v_last_month
)

SELECT
  cur.item_id,
  ANY_VALUE(cur.item_name_th) AS item_name_th,
  ROUND(SUM(cur.gmv), 0)      AS new_gmv,
  COUNT(DISTINCT cur.account_id) AS account_count
FROM cur
LEFT JOIN last ON last.account_id = cur.account_id AND last.item_id = cur.item_id
WHERE last.item_id IS NULL   -- genuinely new to THAT account this month (not portfolio-new)
GROUP BY cur.item_id
ORDER BY new_gmv DESC;
