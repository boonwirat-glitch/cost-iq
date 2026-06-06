-- ════════════════════════════════════════════════════════════════════════════
-- Q_SALES_SKUS_ALL_REPS v1
-- รันครั้งเดียว → export เป็น download_sales_skus.csv
-- ใช้ splitter.py แยกเป็น sense_skus_{safeKey}.csv ต่อ rep → upload R2
-- col[0] = sales_email (splitter key, removed before upload)
-- ════════════════════════════════════════════════════════════════════════════

WITH params AS (
  SELECT DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY) AS lag_date
),

sales_list AS (
  SELECT sales_email FROM UNNEST([
    'malisa.c@freshket.co',
    'nichapa.s@freshket.co',
    'nichita.n@freshket.co',
    'phongsakorn.j@freshket.co',
    'sirinrat.s@freshket.co',
    'wilailak.w@freshket.co',
    'benjawan.a@freshket.co',
    'kanokwan.w@freshket.co',
    'kanthicha.s@freshket.co',
    'nannapas.c@freshket.co',
    'pattama.t@freshket.co',
    'rujira.p@freshket.co',
    'sasaluk.t@freshket.co',
    'supanida.r@freshket.co',
    'thida.p@freshket.co'
  ]) AS sales_email
),

sales_outlets AS (
  SELECT
    LOWER(TRIM(sl.sales_email))         AS sales_email,
    CAST(um.res_id AS STRING)           AS res_id,
    CAST(um.account_guid AS STRING)     AS account_id
  FROM `freshket-rn.dim.user_master` um
  JOIN sales_list sl
    ON LOWER(TRIM(um.sales_owner_email)) = LOWER(TRIM(sl.sales_email))
  WHERE um.first_dollar_date IS NOT NULL
    AND um.new_user_exp_date >= (SELECT lag_date FROM params)
    AND um.user_status NOT IN ('suspended', 'deleted')
    AND um.res_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

raw AS (
  SELECT
    so.sales_email,
    so.account_id,
    DATE_TRUNC(o.delivery_date, MONTH)             AS month_date,
    CAST(i.item_id AS STRING)                      AS item_id,
    i.item_name_th,
    COALESCE(i.category_high_level_v2, i.category_high_level, '') AS dept,
    COALESCE(i.subclass_name, '')                  AS subclass,
    COALESCE(i.temperature, '')                    AS temperature,
    COALESCE(i.pack_size, '')                      AS pack_size,
    i.gmv_ex_vat,
    i.qty,
    i.price_ex_vat,
    o.order_id
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i, params p
  JOIN sales_outlets so ON CAST(o.user_id AS STRING) = so.res_id
  WHERE o.delivery_date >= DATE_SUB(DATE_TRUNC(p.lag_date, MONTH), INTERVAL 2 MONTH)
    AND o.delivery_date <= p.lag_date
    AND i.gmv_ex_vat > 0
)

SELECT
  sales_email,      -- col[0] splitter key
  account_id,
  FORMAT_DATE('%Y-%m', month_date)  AS month_str,
  item_id,
  MAX(item_name_th)                 AS item_name,
  MAX(dept)                         AS dept,
  MAX(subclass)                     AS subclass,
  MAX(temperature)                  AS temperature,
  MAX(pack_size)                    AS pack_size,
  ROUND(SUM(gmv_ex_vat), 0)        AS gmv,
  SUM(qty)                          AS qty,
  ROUND(AVG(price_ex_vat), 2)      AS avg_price,
  COUNT(DISTINCT order_id)          AS order_count
FROM raw
GROUP BY 1, 2, 3, 4
ORDER BY sales_email, account_id, month_str DESC, gmv DESC
;
