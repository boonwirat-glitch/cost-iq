-- ════════════════════════════════════════════════════════════════════════════
-- Find real, valid outlet_id + kam_name values to plug into the diagnostic
-- queries — no guessing. Needs no input, run as-is.
-- ════════════════════════════════════════════════════════════════════════════
-- v2 fix: the first version computed "first_order_ever" from data already
-- filtered to >= 2026-07-01, so it could NEVER show anything before that —
-- every row came back 07-01/07-02 regardless of the outlet's true history,
-- which is meaningless for finding genuine Expansion candidates. Fixed by
-- computing each outlet's real lifetime-first order in a separate,
-- unfiltered CTE, then joining Q3 activity onto it.

WITH lifetime_first AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(DATE(o.delivery_date)) AS first_order_ever
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL AND o.gmv_ex_vat > 0
  GROUP BY 1
),
q3_activity AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    ANY_VALUE(o.ka_owner) AS ka_owner,
    ANY_VALUE(o.account_type) AS account_type,
    MAX(o.delivery_date) AS last_order_this_period,
    COUNT(DISTINCT o.order_id) AS orders_this_period,
    ROUND(SUM(i.gmv_ex_vat), 0) AS gmv_this_period
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  WHERE o.delivery_date >= '2026-07-01'
    AND o.delivery_date <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.ka_owner IS NOT NULL
    AND i.gmv_ex_vat > 0
  GROUP BY 1
)
SELECT
  q.outlet_id, q.ka_owner, q.account_type,
  lf.first_order_ever,
  IF(lf.first_order_ever >= '2026-07-01', 'YES — genuine Expansion candidate', 'no — existed before Q3')
    AS is_genuinely_new_this_quarter,
  q.last_order_this_period, q.orders_this_period, q.gmv_this_period
FROM q3_activity q
JOIN lifetime_first lf ON lf.outlet_id = q.outlet_id
ORDER BY (lf.first_order_ever >= '2026-07-01') DESC, q.gmv_this_period DESC
LIMIT 30;

-- Rows with is_genuinely_new_this_quarter = 'YES' are real Expansion
-- candidates — use their outlet_id/ka_owner to test
-- diagnose_expansion_cumulative.sql. Any row at all (YES or no) is a valid
-- outlet_id/ka_owner to test diagnose_upsell_p1p3.sql with (P1/P3 doesn't
-- require the outlet to be new, just the group_key).
