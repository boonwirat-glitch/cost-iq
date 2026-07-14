-- ════════════════════════════════════════════════════════════════════════════
-- Sanity check A: does this outlet_id actually exist in dwh.order?
-- Run this FIRST if diagnose_upsell_p1p3.sql came back with 0 rows.
-- ════════════════════════════════════════════════════════════════════════════

DECLARE v_outlet_id STRING DEFAULT 'REPLACE_ME';

SELECT
  CAST(o.user_id AS STRING) AS outlet_id,
  o.ka_owner,
  o.commercial_owner,
  o.account_type,
  MIN(o.delivery_date) AS first_order_ever,
  MAX(o.delivery_date) AS last_order_ever,
  COUNT(DISTINCT o.order_id) AS total_orders,
  ROUND(SUM(i.gmv_ex_vat), 0) AS total_gmv
FROM `freshket-rn.dwh.order` o
CROSS JOIN UNNEST(o.item) AS i
WHERE CAST(o.user_id AS STRING) = v_outlet_id
GROUP BY 1, 2, 3, 4;

-- If this itself returns 0 rows: v_outlet_id doesn't exist in dwh.order at
-- all (wrong value copied, or it's an account_id/some other id, not the
-- outlet-level user_id) — go find a real one, e.g. from bulk_outlets.csv's
-- outlet_id column, or Sense's own outlet detail view.
-- If it returns a row: check first_order_ever — if that's BEFORE 2026-07-01,
-- this outlet already existed before Q3, so 0 rows from the P1/P3
-- diagnostic isn't necessarily wrong, it just means this specific outlet
-- had no NEW group_key purchases to classify. Try a different outlet if you
-- specifically wanted to see live P1/P3 classification happen.
