-- ════════════════════════════════════════════════════════════
-- SALES_SKU_CURRENT v1
-- Output: ส่วน Sales ของ bulk_sku_current.csv
-- Window: current month MTD (day-1 lag)
-- Logic: dwh.order stamp commercial_owner + staff_owner ต่อ order
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
mtd_items AS (
  SELECT
    o.account_id,
    o.order_id,
    o.delivery_date,
    i.item_id,
    i.item_name_th,
    i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN sales_names sl ON LOWER(TRIM(o.staff_owner)) = LOWER(TRIM(sl.staff_owner))
  WHERE o.commercial_owner = 'SALE'
    AND o.delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), MONTH)
    AND o.delivery_date <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
    AND i.gmv_ex_vat > 0
)

SELECT
  account_id,
  CAST(item_id AS STRING)           AS item_id,
  ANY_VALUE(item_name_th)           AS item_name_th,
  COUNT(DISTINCT order_id)          AS order_count_mtd,
  ROUND(SUM(gmv_ex_vat), 2)        AS gmv_mtd,
  MAX(delivery_date)                AS last_order_date
FROM mtd_items
WHERE item_id IS NOT NULL
GROUP BY account_id, item_id
ORDER BY account_id, gmv_mtd DESC;
