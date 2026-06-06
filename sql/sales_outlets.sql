-- ════════════════════════════════════════════════════════════
-- SALES_OUTLETS v1
-- Output: ส่วน Sales ของ bulk_outlets.csv
-- Columns: account_id, month_label, outlet_id, outlet_name,
--          gmv_ex_vat, orders, shipping_incvat, mode_timeslot,
--          last_order_date, first_dollar_date
-- Window: last 6 complete months + current month MTD
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
raw AS (
  SELECT
    o.account_id,
    DATE_TRUNC(o.delivery_date, MONTH)  AS month_date,
    o.delivery_date,
    CAST(o.user_id AS STRING)           AS outlet_id,
    o.res_name                          AS outlet_name,
    o.gmv_ex_vat,
    o.order_id,
    o.po_time_slot,
    o.shipping_cost
  FROM `freshket-rn.dwh.order` o
  JOIN sales_names sl ON LOWER(TRIM(o.staff_owner)) = LOWER(TRIM(sl.staff_owner))
  WHERE o.commercial_owner = 'SALE'
    AND o.delivery_date >= DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH), INTERVAL 6 MONTH)
    AND o.delivery_date <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
    AND o.gmv_ex_vat > 0
),
agg AS (
  SELECT
    account_id,
    month_date,
    outlet_id,
    ANY_VALUE(outlet_name)                                        AS outlet_name,
    ROUND(SUM(gmv_ex_vat), 2)                                    AS gmv_ex_vat,
    COUNT(DISTINCT order_id)                                      AS orders,
    ROUND(SUM(shipping_cost), 2)                                 AS shipping_incvat,
    CAST(
      COALESCE(
        APPROX_TOP_COUNT(po_time_slot, 1)[SAFE_OFFSET(0)].value,
        0
      ) AS FLOAT64
    )                                                            AS mode_timeslot,
    MAX(delivery_date)                                           AS last_order_date
  FROM raw
  GROUP BY account_id, month_date, outlet_id
),
first_order_per_outlet AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(o.delivery_date)      AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
    AND o.gmv_ex_vat > 0
  GROUP BY 1
)

SELECT
  a.account_id,
  CONCAT(
    CASE EXTRACT(MONTH FROM month_date)
      WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
      WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
      WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
      WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
    END,
    ' ',
    CAST(EXTRACT(YEAR FROM a.month_date) + 543 AS STRING)
  )                                                              AS month_label,
  a.outlet_id,
  a.outlet_name,
  a.gmv_ex_vat,
  a.orders,
  a.shipping_incvat,
  a.mode_timeslot,
  FORMAT_DATE('%Y-%m-%d', a.last_order_date)                    AS last_order_date,
  FORMAT_DATE('%Y-%m-%d', fdo.first_dollar_date)                AS first_dollar_date
FROM agg a
LEFT JOIN first_order_per_outlet fdo ON a.outlet_id = fdo.outlet_id
ORDER BY a.account_id, a.month_date DESC, a.gmv_ex_vat DESC;
