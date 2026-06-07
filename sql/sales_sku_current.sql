-- ════════════════════════════════════════════════════════════
-- SALES_SKU_CURRENT v2
-- Output: Sales SKU MTD keyed by account_guid
-- Fix v2: JOIN dim.user_master เพื่อได้ account_guid
-- ════════════════════════════════════════════════════════════

WITH sales_names AS (
  SELECT DISTINCT staff_owner, staff_owner_email
  FROM `freshket-rn.dim.user_master`
  WHERE commercial_owner = 'SALE'
    AND staff_owner_email IN (
      'malisa.c@freshket.co','nichapa.s@freshket.co','nichita.n@freshket.co',
      'phongsakorn.j@freshket.co','sirinrat.s@freshket.co','wilailak.w@freshket.co',
      'benjawan.a@freshket.co','kanokwan.w@freshket.co','kanthicha.s@freshket.co',
      'nannapas.c@freshket.co','pattama.t@freshket.co','rujira.p@freshket.co',
      'sasaluk.t@freshket.co','supanida.r@freshket.co','thida.p@freshket.co'
    )
),
params AS (
  SELECT
    DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), MONTH) AS cur_month_start,
    DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)                    AS max_date
)

SELECT
  CAST(um.account_guid AS STRING)               AS account_id,
  CAST(i.item_id AS STRING)                     AS item_id,
  MAX(i.item_name_th)                           AS item_name_th,
  COUNT(DISTINCT o.order_id)                    AS orders_this_month,
  ROUND(SUM(i.gmv_ex_vat), 0)                  AS gmv_to_date,
  MAX(o.delivery_date)                          AS last_order_date

FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i
CROSS JOIN params p
JOIN sales_names sl ON LOWER(TRIM(o.staff_owner)) = LOWER(TRIM(sl.staff_owner))
JOIN `freshket-rn.dim.user_master` um
  ON CAST(o.user_id AS STRING) = CAST(um.res_id AS STRING)

WHERE o.commercial_owner = 'SALE'
  AND o.delivery_date >= p.cur_month_start
  AND o.delivery_date <= p.max_date
  AND i.gmv_ex_vat > 0
  AND um.account_guid IS NOT NULL

GROUP BY 1, 2
ORDER BY 1, gmv_to_date DESC;
